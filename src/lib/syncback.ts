import { mkdirSync, writeFileSync, unlinkSync, existsSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { appendFileSync } from 'fs';
import type { FileChangeMessage } from '../protocol/messages.js';

// Debug logging to file (avoids terminal corruption)
function debugLog(msg: string): void {
  if (process.env.CATTY_DEBUG === '1') {
    const logFile = `${homedir()}/.catty-debug.log`;
    appendFileSync(logFile, `${new Date().toISOString()} [syncback] ${msg}\n`);
  }
}

/**
 * Apply a remote file change to the local filesystem.
 * Called when the executor sends a file_change message.
 */
export function applyRemoteFileChange(msg: FileChangeMessage): void {
  try {
    // Get the local path - remove /workspace prefix and use cwd
    const relativePath = msg.path.replace(/^\/workspace\/?/, '');
    if (!relativePath) {
      debugLog('ignoring change to workspace root');
      return;
    }

    const localPath = join(process.cwd(), relativePath);

    // Security check: ensure we're not writing outside cwd
    const cwd = process.cwd();
    const resolved = join(cwd, relativePath);
    if (!resolved.startsWith(cwd)) {
      debugLog(`SECURITY: attempted write outside cwd: ${resolved}`);
      return;
    }

    if (msg.action === 'delete') {
      if (existsSync(localPath)) {
        unlinkSync(localPath);
        debugLog(`deleted: ${relativePath}`);
      }
    } else if (msg.action === 'write') {
      if (!msg.content) {
        debugLog(`write without content: ${relativePath}`);
        return;
      }

      // Ensure directory exists
      const dir = dirname(localPath);
      mkdirSync(dir, { recursive: true });

      // Decode base64 content and write
      const content = Buffer.from(msg.content, 'base64');
      writeFileSync(localPath, content);

      // Apply mode if provided
      if (msg.mode !== undefined) {
        try {
          chmodSync(localPath, msg.mode);
        } catch {
          // Ignore chmod errors (may not be supported on all platforms)
        }
      }

      debugLog(`wrote: ${relativePath} (${content.length} bytes)`);
    }
  } catch (err) {
    debugLog(`ERROR applying change: ${err}`);
  }
}

