import { writeFileSync, unlinkSync, mkdirSync, renameSync } from 'fs';
import { join, dirname, normalize, isAbsolute, sep } from 'path';
import type { FileChangeMessage } from '../protocol/messages.js';

/**
 * Apply a remote file change to the local filesystem.
 * Best-effort: errors are logged but don't break the terminal.
 */
export function applyRemoteFileChange(msg: FileChangeMessage): void {
  // Validate path (no absolute, no traversal)
  const rel = normalize(msg.path.replace(/^\.\//, ''));

  if (!rel || rel === '.') return;

  if (isAbsolute(rel)) {
    console.error(`sync-back rejected absolute path: ${rel}`);
    return;
  }

  if (rel === '..' || rel.startsWith('..' + sep)) {
    console.error(`sync-back rejected traversal path: ${rel}`);
    return;
  }

  const cwd = process.cwd();
  const destPath = join(cwd, rel);

  // Ensure destPath is within cwd (resolve any remaining symlinks/tricks)
  const resolvedCwd = normalize(cwd);
  const resolvedDest = normalize(destPath);

  if (!resolvedDest.startsWith(resolvedCwd + sep) && resolvedDest !== resolvedCwd) {
    console.error(`sync-back rejected path outside base: ${destPath}`);
    return;
  }

  try {
    if (msg.action === 'delete') {
      unlinkSync(destPath);
    } else if (msg.action === 'write') {
      const content = Buffer.from(msg.content || '', 'base64');
      mkdirSync(dirname(destPath), { recursive: true });

      // Atomic write via temp file
      const tmpPath = join(dirname(destPath), `.catty-sync-${Date.now()}`);
      writeFileSync(tmpPath, content, { mode: msg.mode || 0o644 });
      renameSync(tmpPath, destPath);
    }
  } catch {
    // Best-effort, don't break terminal
  }
}
