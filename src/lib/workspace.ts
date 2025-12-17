import archiver from 'archiver';
import ignore, { type Ignore } from 'ignore';
import { createReadStream, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { MAX_UPLOAD_SIZE } from './config.js';

const DEFAULT_IGNORES = [
  '.git',
  '.git/**',
  'node_modules',
  'node_modules/**',
  '__pycache__',
  '__pycache__/**',
  '.venv',
  '.venv/**',
  'venv',
  'venv/**',
  '.env',
  '*.pyc',
  '.DS_Store',
  '*.log',
];

export async function createWorkspaceZip(dir: string): Promise<Buffer> {
  const ig = ignore().add(DEFAULT_IGNORES);

  // Load .gitignore if exists
  try {
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8');
    ig.add(gitignore);
  } catch {
    // No .gitignore, use defaults only
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Walk directory and add files
    walkDir(dir, dir, ig, archive);
    archive.finalize();
  });
}

function walkDir(
  baseDir: string,
  currentDir: string,
  ig: Ignore,
  archive: archiver.Archiver
): void {
  let entries: string[];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry);
    const relativePath = relative(baseDir, fullPath);

    // Check if ignored
    if (ig.ignores(relativePath)) {
      continue;
    }

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      // Also check directory with trailing slash
      if (ig.ignores(relativePath + '/')) {
        continue;
      }
      walkDir(baseDir, fullPath, ig, archive);
    } else if (stat.isFile()) {
      archive.file(fullPath, { name: relativePath });
    }
  }
}

export async function uploadWorkspace(
  uploadURL: string,
  token: string,
  machineID: string
): Promise<void> {
  const cwd = process.cwd();
  const zipData = await createWorkspaceZip(cwd);

  if (zipData.length > MAX_UPLOAD_SIZE) {
    throw new Error(
      `Workspace too large (${zipData.length} bytes, max ${MAX_UPLOAD_SIZE})`
    );
  }

  const response = await fetch(uploadURL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'fly-force-instance-id': machineID,
    },
    body: zipData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} - ${text}`);
  }
}

/**
 * Build upload URL from connect URL.
 * Converts wss://app.fly.dev/connect to https://app.fly.dev/upload
 */
export function buildUploadURL(connectURL: string): string {
  return connectURL
    .replace('wss://', 'https://')
    .replace('ws://', 'http://')
    .replace('/connect', '/upload');
}
