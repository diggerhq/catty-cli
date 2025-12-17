import WebSocket from 'ws';
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
  type Message,
  type ExitMessage,
  type ErrorMessage,
  type FileChangeMessage,
} from '../protocol/messages.js';
import { applyRemoteFileChange } from './syncback.js';

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

    const handleResize = () => {
      const { cols, rows } = terminal.getSize();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(createResizeMessage(cols, rows));
      }
    };

    const cleanup = () => {
      terminal.restore();
      terminal.offResize(handleResize);
      process.stdin.off('data', handleStdinData);
    };

    const handleStdinData = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data); // Binary
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
