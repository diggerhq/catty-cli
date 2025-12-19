import WebSocket from 'ws';
import { appendFileSync } from 'fs';
import { homedir } from 'os';
import { Terminal } from './terminal.js';
import {
  WS_POLICY_VIOLATION,
  WS_READ_TIMEOUT_MS,
} from './config.js';
import {
  parseMessage,
  createResizeMessage,
  createPongMessage,
  createFileUploadMessage,
  createFileUploadChunkMessage,
  createSyncBackMessage,
  type Message,
  type ExitMessage,
  type ErrorMessage,
  type FileChangeMessage,
  type SyncBackAckMessage,
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

// Connection result types
export type ConnectionResult = 
  | { type: 'exit'; code: number }
  | { type: 'disconnected'; reason: string }
  | { type: 'replaced' }
  | { type: 'interrupted' };  // User pressed Ctrl+C

// Bracketed paste escape sequences
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export interface WebSocketConnectOptions {
  connectURL: string;
  connectToken: string;
  headers: Record<string, string>;
  syncBack?: boolean; // Enable sync-back of remote file changes to local
  onExit?: (code: number) => void;
}

export async function connectToSession(
  opts: WebSocketConnectOptions
): Promise<ConnectionResult> {
  const terminal = new Terminal();

  if (!terminal.isTerminal()) {
    throw new Error('stdin is not a terminal');
  }

  const ws = new WebSocket(opts.connectURL, {
    headers: {
      ...opts.headers,
      Authorization: `Bearer ${opts.connectToken}`,
    },
    handshakeTimeout: 30_000, // 30s timeout for initial connection
  });

  return new Promise((resolve, reject) => {
    let exitCode = 0;
    let connectionClosed = false;
    let connectionOpened = false;
    let userInterrupted = false;  // Track if user pressed Ctrl+C
    let resolved = false;  // Prevent double resolution

    // Safe resolve that only runs once
    const safeResolve = (result: ConnectionResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // Paste detection state
    let inPaste = false;
    let pasteBuffer = '';
    let inputBuffer = '';

    // Double Ctrl+C detection - if user presses Ctrl+C twice within 1 second, exit catty
    let lastCtrlC = 0;
    const DOUBLE_CTRLC_MS = 1000;

    // Handle Ctrl+C from signal (works when NOT in raw mode)
    const handleSigint = () => {
      userInterrupted = true;
      if (opts.syncBack) {
        process.stderr.write('\r\n\x1b[33mSync paused. Run `catty sync <label>` to pull latest changes.\x1b[0m\r\n');
      }
      cleanup();
      try {
        ws.close();
      } catch {
        // Ignore
      }
      safeResolve({ type: 'interrupted' });
    };
    process.once('SIGINT', handleSigint);

    // Force quit with Ctrl+\ (SIGQUIT) - works even in raw mode
    const handleSigquit = () => {
      userInterrupted = true;
      process.stderr.write('\r\n\x1b[33mForce quit (Ctrl+\\)\x1b[0m\r\n');
      if (opts.syncBack) {
        process.stderr.write('\x1b[33mSync paused. Run `catty sync <label>` to pull latest changes.\x1b[0m\r\n');
      }
      cleanup();
      try {
        ws.close();
      } catch {
        // Ignore
      }
      safeResolve({ type: 'interrupted' });
    };
    process.once('SIGQUIT', handleSigquit);

    // Connection timeout - if we don't connect within 30s, give up
    const connectionTimeout = setTimeout(() => {
      if (!connectionOpened && !connectionClosed) {
        connectionClosed = true;
        process.stderr.write(`\r\n\x1b[31m✗ Connection timeout: server not responding\x1b[0m\r\n`);
        try {
          ws.terminate();
        } catch {
          // Ignore
        }
        safeResolve({ type: 'disconnected', reason: 'Connection timeout' });
      }
    }, 30_000);

    // Client-side connection health monitoring
    let lastDataReceived = Date.now();
    const CLIENT_TIMEOUT_MS = WS_READ_TIMEOUT_MS + 15_000; // 75s (server is 60s, give buffer)
    
    const healthCheckInterval = setInterval(() => {
      if (connectionClosed) return;
      
      const timeSinceData = Date.now() - lastDataReceived;
      if (timeSinceData > CLIENT_TIMEOUT_MS) {
        debugLog(`Client-side timeout: no data for ${timeSinceData}ms`);
        clearInterval(healthCheckInterval);
        
        // Show clear message to user
        const timeoutSecs = Math.round(timeSinceData / 1000);
        process.stderr.write(`\r\n\x1b[31m✗ Connection timed out (no data for ${timeoutSecs}s)\x1b[0m\r\n`);
        
        // Force close the connection
        try {
          ws.terminate();
        } catch {
          // Ignore
        }
        
        cleanup();
        safeResolve({ type: 'disconnected', reason: 'Connection timed out (no data received)' });
      }
    }, 5000);

    const handleResize = () => {
      const { cols, rows } = terminal.getSize();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(createResizeMessage(cols, rows));
      }
    };

    const cleanup = () => {
      connectionClosed = true;
      clearTimeout(connectionTimeout);
      clearInterval(healthCheckInterval);
      terminal.disableBracketedPaste();
      terminal.restore();
      terminal.offResize(handleResize);
      process.stdin.off('data', handleStdinData);
      process.off('SIGINT', handleSigint);
      process.off('SIGQUIT', handleSigquit);
    };

    const handleStdinData = (data: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Detect Ctrl+C (0x03) for double-tap exit
      // Check if buffer contains Ctrl+C (could be alone or with other bytes)
      const ctrlCIndex = data.indexOf(0x03);
      if (ctrlCIndex !== -1) {
        const now = Date.now();
        if (now - lastCtrlC < DOUBLE_CTRLC_MS) {
          // Double Ctrl+C detected - exit catty immediately
          userInterrupted = true;
          process.stderr.write('\r\n');
          if (opts.syncBack) {
            process.stderr.write('\x1b[33mSync paused. Run `catty sync <label>` to pull latest changes.\x1b[0m\r\n');
          }
          cleanup();
          try {
            ws.close();
          } catch {
            // Ignore
          }
          safeResolve({ type: 'interrupted' });
          return;
        }
        lastCtrlC = now;
        // First Ctrl+C - just send to remote, no hint (cleaner UX)
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
      // Connection established - clear the timeout
      connectionOpened = true;
      clearTimeout(connectionTimeout);

      // Enter raw mode
      terminal.makeRaw();

      // Enable bracketed paste mode for drag-and-drop file detection
      terminal.enableBracketedPaste();

      // Send initial size
      const { cols, rows } = terminal.getSize();
      ws.send(createResizeMessage(cols, rows));

      // Request sync-back if enabled
      if (opts.syncBack) {
        debugLog('requesting sync-back');
        ws.send(createSyncBackMessage(true));
      }

      // Handle resize
      terminal.onResize(handleResize);

      // Relay stdin -> WebSocket
      process.stdin.on('data', handleStdinData);
    });

    // Relay WebSocket -> stdout
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      // Update last data received time for health monitoring
      lastDataReceived = Date.now();
      
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
          safeResolve({ type: 'exit', code: exitMsg.code });
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
        case 'sync_back_ack': {
          const ackMsg = msg as SyncBackAckMessage;
          debugLog(`sync-back ack: enabled=${ackMsg.enabled}, dir=${ackMsg.workspace_dir}`);
          break;
        }
        case 'file_change': {
          const changeMsg = msg as FileChangeMessage;
          debugLog(`file change: ${changeMsg.action} ${changeMsg.path}`);
          applyRemoteFileChange(changeMsg);
          break;
        }
      }
    }

    ws.on('close', (code: number, reason: Buffer) => {
      if (connectionClosed) return; // Already handled
      
      cleanup();
      
      // If user pressed Ctrl+C, don't show disconnect message
      if (userInterrupted) {
        return; // Already resolved in handleSigint
      }
      
      // Code 1008 (WS_POLICY_VIOLATION) = connection replaced by new one
      if (code === WS_POLICY_VIOLATION) {
        process.stderr.write('\r\n\x1b[33m⚠ Connection replaced by another client\x1b[0m\r\n');
        safeResolve({ type: 'replaced' });
      } else {
        const reasonStr = reason?.toString() || `code ${code}`;
        process.stderr.write(`\r\n\x1b[31m✗ Connection lost: ${reasonStr}\x1b[0m\r\n`);
        safeResolve({ type: 'disconnected', reason: reasonStr });
      }
    });

    ws.on('error', (err: Error) => {
      if (connectionClosed) return; // Already handled
      
      cleanup();
      
      // If user pressed Ctrl+C, don't show error message
      if (userInterrupted) {
        return; // Already resolved in handleSigint
      }
      
      // Show user-friendly error message
      process.stderr.write(`\r\n\x1b[31m✗ Connection error: ${err.message}\x1b[0m\r\n`);
      safeResolve({ type: 'disconnected', reason: err.message });
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
