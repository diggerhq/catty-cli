import { Command } from 'commander';
import { createWriteStream, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getAPIAddr } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { APIClient } from '../lib/api-client.js';

async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // BSD tar (macOS) overwrites by default, GNU tar needs explicit flag
    // Use basic flags that work on both
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
        reject(
          new Error(`tar extraction failed: ${stderr || `exit code ${code}`}`)
        );
      }
    });

    tar.on('error', reject);
  });
}

async function listTarContents(tarPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-tzf', tarPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    tar.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    tar.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    tar.on('close', (code) => {
      if (code === 0) {
        resolve(
          stdout
            .split('\n')
            .filter((f) => f.trim())
            .filter((f) => !f.endsWith('/'))
        );
      } else {
        reject(new Error(`tar list failed: ${stderr || `exit code ${code}`}`));
      }
    });

    tar.on('error', reject);
  });
}

export const syncCommand = new Command('sync')
  .description('Sync remote workspace to current directory')
  .argument('<label>', 'Session label (e.g., brave-tiger-1234)')
  .option('--dry-run', 'Show what would be synced without making changes')
  .action(async function (this: Command, label: string) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(apiAddr);

    console.log(`Fetching workspace for ${label}...`);

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

    // Download to temp file
    const tempPath = `/tmp/catty-sync-${Date.now()}.tar.gz`;
    const response = await fetch(downloadInfo.download_url);
    if (!response.ok || !response.body) {
      if (response.status === 404) {
        console.error(`✗ No workspace snapshot found for ${label}`);
        console.error(
          '  The session may not have saved yet (saves every 30s).'
        );
      } else {
        console.error(`✗ Download failed: ${response.statusText}`);
      }
      process.exit(1);
    }

    const fileStream = createWriteStream(tempPath);
    await pipeline(Readable.fromWeb(response.body as never), fileStream);

    try {
      if (opts.dryRun) {
        // List what would be synced
        const files = await listTarContents(tempPath);
        console.log(`\nWould sync ${files.length} files:`);
        const maxShow = 20;
        for (let i = 0; i < Math.min(files.length, maxShow); i++) {
          console.log(`  ${files[i]}`);
        }
        if (files.length > maxShow) {
          console.log(`  ... and ${files.length - maxShow} more`);
        }
        console.log('\nRun without --dry-run to apply.');
      } else {
        // Extract to current directory
        await extractTarGz(tempPath, '.');
        console.log(`✓ Synced workspace from ${label} to current directory`);
      }
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

