import { Command } from 'commander';
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getAPIAddr } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { APIClient } from '../lib/api-client.js';

async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', tarPath, '-C', destDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    tar.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    tar.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar extraction failed: ${stderr || `exit code ${code}`}`));
      }
    });

    tar.on('error', reject);
  });
}

export const downloadCommand = new Command('download')
  .description('Download workspace from a session')
  .argument('<label>', 'Session label (e.g., brave-tiger-1234)')
  .argument('[path]', 'Destination path (default: ./<label>)')
  .option('--format <type>', 'Output format: dir or tar.gz', 'dir')
  .action(async function (this: Command, label: string, destPath?: string) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(apiAddr);

    console.log(`Fetching download URL for ${label}...`);

    let downloadInfo;
    try {
      downloadInfo = await client.getSessionDownload(label);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`✗ ${err.message}`);
      } else {
        console.error('✗ Failed to get download URL');
      }
      process.exit(1);
    }

    const dest = destPath || `./${label}`;

    if (opts.format === 'tar.gz') {
      // Download as tarball
      const tarPath = dest.endsWith('.tar.gz') ? dest : `${dest}.tar.gz`;
      console.log(`Downloading to ${tarPath}...`);

      const response = await fetch(downloadInfo.download_url);
      if (!response.ok || !response.body) {
        if (response.status === 404) {
          console.error(`✗ No workspace snapshot found for ${label}`);
          console.error('  The session may not have saved yet or was just created.');
        } else {
          console.error(`✗ Download failed: ${response.statusText}`);
        }
        process.exit(1);
      }

      const fileStream = createWriteStream(tarPath);
      await pipeline(Readable.fromWeb(response.body as never), fileStream);

      const sizeKB = downloadInfo.size_bytes
        ? Math.round(downloadInfo.size_bytes / 1024)
        : 'unknown';
      console.log(`✓ Downloaded ${tarPath} (${sizeKB} KB)`);
    } else {
      // Download and extract to directory
      console.log(`Downloading and extracting to ${dest}/...`);

      if (existsSync(dest)) {
        console.error(`✗ Destination already exists: ${dest}`);
        console.error('  Remove it first or specify a different path.');
        process.exit(1);
      }

      // Download to temp file first
      const tempPath = `/tmp/catty-download-${Date.now()}.tar.gz`;
      const response = await fetch(downloadInfo.download_url);
      if (!response.ok || !response.body) {
        if (response.status === 404) {
          console.error(`✗ No workspace snapshot found for ${label}`);
          console.error('  The session may not have saved yet (saves every 30s) or was just created.');
        } else {
          console.error(`✗ Download failed: ${response.statusText}`);
        }
        process.exit(1);
      }

      const fileStream = createWriteStream(tempPath);
      await pipeline(Readable.fromWeb(response.body as never), fileStream);

      // Extract
      mkdirSync(dest, { recursive: true });
      try {
        await extractTarGz(tempPath, dest);
      } finally {
        // Clean up temp file
        try {
          unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      console.log(`✓ Downloaded to ${dest}/`);
    }
  });

