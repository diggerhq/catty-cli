import WebSocket from 'ws';
import { appendFileSync } from 'fs';
import { homedir } from 'os';
import { Terminal } from './terminal.js';
import {
  SYNC_BACK_ACK_TIMEOUT_MS,
  WS_POLICY_VIOLATION,
} from './config.js';
import {
  parseMessage,
  createResizeMessage,
  createPongMessage,
  createSyncBackMessage,
  createFileUploadMessage,
  createFileUploadChunkMessage,
  type Message,
  type ExitMessage,
  type ErrorMessage,
  type FileChangeMessage,
} from '../protocol/messages.js';
import { applyRemoteFileChange } from './syncback.js';
import {
  detectFilePaths,
  shouldAutoUpload,
  generateUniqueFilename,
  CHUNK_SIZE,
} from './file-upload.js';

// Debug logging to file (avoids terminal corruption)
function debugLog(msg: string): void {
  if (process.env.CATTY_DEBUG === '1') {
    const logFile = `${homedir()}/.catty-debug.log`;
    appendFileSync(logFile, `${new Date().toISOString()} [ws] ${msg}\n`);
  }
}

// Bracketed paste escape sequences
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export interface WebSocketConnectOptions {
  connectURL: string;
  connectToken: string;
  headers: Record<string, string>;
  syncBack: boolean;
  onExit?: (code: number) => void;
}

export async function connectToSession(
  opts: WebSocketConnectOptions
): Promise<void> {
  const terminal = new Terminal();

  if (!terminal.isTerminal()) {
    throw new Error('stdin is not a terminal');
  }

  const ws = new WebSocket(opts.connectURL, {
    headers: {
      ...opts.headers,
      Authorization: `Bearer ${opts.connectToken}`,
    },
  });

  return new Promise((resolve, reject) => {
    let syncBackAcked = false;
    let exitCode = 0;

    // Paste detection state
    let inPaste = false;
    let pasteBuffer = '';
    let inputBuffer = '';

    const handleResize = () => {
      const { cols, rows } = terminal.getSize();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(createResizeMessage(cols, rows));
      }
    };

    const cleanup = () => {
      terminal.disableBracketedPaste();
      terminal.restore();
      terminal.offResize(handleResize);
      process.stdin.off('data', handleStdinData);
    };

    const handleStdinData = (data: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const str = data.toString('utf-8');
        
        // Simple approach: check if this chunk contains paste markers
        if (!inPaste) {
          const pasteStartIdx = str.indexOf(PASTE_START);
          
          if (pasteStartIdx === -1) {
            // No paste sequence - send data through immediately
            ws.send(data);
            return;
          }
          
          // Found paste start
          if (pasteStartIdx > 0) {
            // Send content before paste
            ws.send(Buffer.from(str.slice(0, pasteStartIdx), 'utf-8'));
          }
          
          // Check if paste end is also in this chunk
          const afterStart = str.slice(pasteStartIdx + PASTE_START.length);
          const pasteEndIdx = afterStart.indexOf(PASTE_END);
          
          if (pasteEndIdx !== -1) {
            // Complete paste in one chunk
            const pastedContent = afterStart.slice(0, pasteEndIdx);
            handlePastedContent(pastedContent);
            
            // Send any content after paste end
            const afterEnd = afterStart.slice(pasteEndIdx + PASTE_END.length);
            if (afterEnd) {
              ws.send(Buffer.from(afterEnd, 'utf-8'));
            }
          } else {
            // Paste spans multiple chunks
            inPaste = true;
            pasteBuffer = afterStart;
          }
        } else {
          // We're in a paste, look for end
          const pasteEndIdx = str.indexOf(PASTE_END);
          
          if (pasteEndIdx === -1) {
            // Still no end - keep buffering
            pasteBuffer += str;
          } else {
            // Found end
            pasteBuffer += str.slice(0, pasteEndIdx);
            inPaste = false;
            handlePastedContent(pasteBuffer);
            pasteBuffer = '';
            
            // Send any content after paste end
            const afterEnd = str.slice(pasteEndIdx + PASTE_END.length);
            if (afterEnd) {
              ws.send(Buffer.from(afterEnd, 'utf-8'));
            }
          }
        }
      } catch (err) {
        // On error, try to forward data as-is to avoid breaking terminal
        try {
          ws.send(data);
        } catch {
          // Ignore
        }
      }
    };

    const uploadFile = async (filePath: string): Promise<string | null> => {
      const uploadInfo = shouldAutoUpload(filePath);

      debugLog(`shouldAutoUpload: ${uploadInfo.shouldUpload}, size: ${uploadInfo.content?.length || 0}`);

      if (
        !uploadInfo.shouldUpload ||
        !uploadInfo.content ||
        !uploadInfo.filename ||
        !uploadInfo.remotePath ||
        !uploadInfo.mimeType
      ) {
        return null;
      }

      // Generate unique filename to avoid collisions
      const uniqueFilename = generateUniqueFilename(uploadInfo.filename);
      const uniqueRemotePath = `/workspace/.catty-uploads/${uniqueFilename}`;

      debugLog(`uploading to: ${uniqueRemotePath}`);

      const fileSize = uploadInfo.content.length;
      
      // Use chunked upload for files larger than chunk size
      if (fileSize > CHUNK_SIZE) {
        const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const base64Content = uploadInfo.content.toString('base64');
        const totalChunks = Math.ceil(base64Content.length / (CHUNK_SIZE * 1.34)); // base64 is ~1.34x larger
        const chunkSize = Math.ceil(base64Content.length / totalChunks);
        
        debugLog(`chunked upload: ${totalChunks} chunks, ~${chunkSize} bytes each`);
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, base64Content.length);
          const chunk = base64Content.slice(start, end);
          
          const chunkMsg = createFileUploadChunkMessage(
            uploadId,
            uniqueFilename,
            uniqueRemotePath,
            i,
            totalChunks,
            chunk,
            uploadInfo.mimeType
          );
          
          ws.send(chunkMsg);
          debugLog(`sent chunk ${i + 1}/${totalChunks}`);
          
          // Small delay between chunks to avoid overwhelming the connection
          if (i < totalChunks - 1) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      } else {
        // Small file - send in one message
        const uploadMsg = createFileUploadMessage(
          uniqueFilename,
          uniqueRemotePath,
          uploadInfo.content,
          uploadInfo.mimeType
        );
        
        debugLog(`single message size: ${uploadMsg.length} bytes`);
        ws.send(uploadMsg);
      }

      return uniqueRemotePath;
    };

    const handlePastedContent = async (content: string) => {
      try {
        // Skip empty pastes
        if (!content || !content.trim()) {
          return;
        }

        // Check if the pasted content contains file paths
        const filePaths = detectFilePaths(content);

        if (filePaths.length > 0) {
          debugLog(`found ${filePaths.length} files to upload`);
          
          const uploadedPaths: string[] = [];
          
          // Upload all files
          for (const filePath of filePaths) {
            const remotePath = await uploadFile(filePath);
            if (remotePath) {
              uploadedPaths.push(remotePath);
            }
          }
          
          if (uploadedPaths.length > 0) {
            debugLog(`uploaded ${uploadedPaths.length} files, sending paths`);
            
            // Send all remote paths separated by spaces
            const pathsStr = uploadedPaths.join(' ');
            ws.send(Buffer.from(pathsStr, 'utf-8'));
            
            debugLog(`paths sent: ${pathsStr}`);
            return;
          }
        }

        // Not a file or upload not needed, send pasted content as-is
        ws.send(Buffer.from(content, 'utf-8'));
      } catch (err) {
        debugLog(`ERROR in handlePastedContent: ${err}`);
        // On any error, try to send original content to avoid breaking terminal
        try {
          ws.send(Buffer.from(content, 'utf-8'));
        } catch {
          // Ignore - can't do anything
        }
      }
    };

    ws.on('open', () => {
      // Enable sync-back if requested
      if (opts.syncBack) {
        ws.send(createSyncBackMessage(true));

        // Warn if no ack after timeout
        setTimeout(() => {
          if (!syncBackAcked) {
            process.stderr.write(
              '\r\n(sync-back) No ack from executor yet — this machine may be running an older catty-exec image without sync-back.\r\n'
            );
          }
        }, SYNC_BACK_ACK_TIMEOUT_MS);
      }

      // Enter raw mode
      terminal.makeRaw();

      // Enable bracketed paste mode for drag-and-drop file detection
      terminal.enableBracketedPaste();

      // Send initial size
      const { cols, rows } = terminal.getSize();
      ws.send(createResizeMessage(cols, rows));

      // Handle resize
      terminal.onResize(handleResize);

      // Relay stdin -> WebSocket
      process.stdin.on('data', handleStdinData);
    });

    // Relay WebSocket -> stdout
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        process.stdout.write(data as Buffer);
      } else {
        try {
          const msg = parseMessage(data.toString());
          handleControlMessage(msg);
        } catch {
          // Ignore parse errors
        }
      }
    });

    function handleControlMessage(msg: Message) {
      switch (msg.type) {
        case 'exit': {
          const exitMsg = msg as ExitMessage;
          exitCode = exitMsg.code;
          opts.onExit?.(exitMsg.code);
          process.stderr.write(`\r\nProcess exited with code ${exitMsg.code}\r\n`);
          cleanup();
          ws.close();
          resolve();
          break;
        }
        case 'error': {
          const errorMsg = msg as ErrorMessage;
          process.stderr.write(`\r\nError: ${errorMsg.message}\r\n`);
          break;
        }
        case 'ping':
          ws.send(createPongMessage());
          break;
        case 'file_change':
          applyRemoteFileChange(msg as FileChangeMessage);
          break;
        case 'sync_back_ack':
          syncBackAcked = true;
          break;
      }
    }

    ws.on('close', (code: number) => {
      cleanup();
      // Code 1008 (WS_POLICY_VIOLATION) = connection replaced by new one
      // This is a clean termination, not an error
      if (code === WS_POLICY_VIOLATION) {
        resolve();
      } else {
        resolve();
      }
    });

    ws.on('error', (err: Error) => {
      cleanup();
      reject(err);
    });

    // Handle process exit
    process.on('exit', () => {
      cleanup();
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  });
}
