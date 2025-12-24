// catty new - Creates a LOCAL session (the default!)
// For cloud sessions, use: catty remote

import { Command } from 'commander';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { isLoggedIn } from '../lib/auth.js';
import { getApiAddr, getCattyDir } from '../lib/config.js';
import { Terminal } from '../lib/terminal.js';

const SOCKET_NAME = 'catty-local.sock';
const BINARY_NAME = process.platform === 'win32' ? 'catty-local.exe' : 'catty-local';

function getSocketPath(): string {
  return path.join(getCattyDir(), SOCKET_NAME);
}

function getBinaryPath(): string {
  return path.join(getCattyDir(), 'bin', BINARY_NAME);
}

async function isDaemonRunning(): Promise<boolean> {
  const socketPath = getSocketPath();
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.end();
      resolve(true);
    });
    client.on('error', () => resolve(false));
  });
}

async function ensureDaemon(): Promise<void> {
  if (await isDaemonRunning()) {
    return;
  }

  const binaryPath = getBinaryPath();
  if (!fs.existsSync(binaryPath)) {
    // Check development path
    const devBinary = path.join(process.cwd(), '../catty-local/bin/catty-local');
    if (fs.existsSync(devBinary)) {
      const binDir = path.dirname(binaryPath);
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(devBinary, binaryPath);
      fs.chmodSync(binaryPath, 0o755);
    } else {
      console.error('❌ catty-local binary not found.');
      console.error('');
      console.error('Build it with:');
      console.error('  cd catty-local && make build');
      console.error('  mkdir -p ~/.catty/bin && cp bin/catty-local ~/.catty/bin/');
      process.exit(1);
    }
  }

  const apiAddr = getApiAddr();
  console.log('🐱 Starting local daemon...');

  const child = spawn(binaryPath, ['daemon', '--api', apiAddr], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for daemon to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await isDaemonRunning()) {
      return;
    }
  }

  console.error('❌ Failed to start daemon');
  process.exit(1);
}

interface LocalResponse {
  success: boolean;
  error?: string;
  sessions?: SessionInfo[];
}

interface SessionInfo {
  name: string;
  status: string;
}

async function sendCommand(cmd: object): Promise<LocalResponse> {
  const socketPath = getSocketPath();

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(cmd) + '\n');
    });

    let data = '';
    let resolved = false;

    client.on('data', (chunk) => {
      data += chunk.toString();
      // Try to parse as complete JSON
      try {
        const response = JSON.parse(data);
        resolved = true;
        client.end();
        resolve(response);
      } catch {
        // Not complete JSON yet, wait for more data
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        reject(new Error(`Cannot connect to daemon: ${err.message}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        client.destroy();
        reject(new Error('Daemon connection timeout'));
      }
    }, 5000);
  });
}

function generateSessionName(): string {
  // Use current directory name as default session name
  const cwd = process.cwd();
  const dirName = path.basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return dirName || 'session';
}

export const newCommand = new Command('new')
  .description('Start a new local Claude session')
  .argument('[name]', 'Session name (default: current directory name)')
  .option('--workdir <dir>', 'Working directory', process.cwd())
  .action(async function (this: Command, name?: string) {
    const opts = this.opts();

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    // Generate session name if not provided
    const sessionName = name || generateSessionName();

    // Ensure daemon is running
    await ensureDaemon();

    // Check if session already exists
    try {
      const listResp = await sendCommand({ action: 'list' });
      const existing = listResp.sessions?.find(s => s.name === sessionName);
      
      if (existing) {
        if (existing.status === 'running') {
          console.log(`Session '${sessionName}' already exists and is running.`);
          console.log('Attaching...');
          console.log('');
          await attachToLocalSession(sessionName, opts.workdir);
          return;
        } else {
          // Session exists but not running - recreate it
          await sendCommand({ action: 'kill', name: sessionName });
        }
      }
    } catch {
      // Ignore errors checking existing sessions
    }

    // Create the session
    console.log(`🐱 Creating local session '${sessionName}'...`);
    console.log(`   Working directory: ${opts.workdir}`);

    const cols = process.stdout.columns || 120;
    const rows = process.stdout.rows || 40;

    try {
      const resp = await sendCommand({
        action: 'create',
        name: sessionName,
        command: 'claude',
        work_dir: opts.workdir,
        cols,
        rows,
      });

      if (!resp.success) {
        console.error(`❌ Failed to create session: ${resp.error}`);
        process.exit(1);
      }

      console.log(`✅ Session '${sessionName}' created`);
      console.log('');

      // Now attach to the session
      await attachToLocalSession(sessionName, opts.workdir);

    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

// Attach to a local session DIRECTLY via Unix socket (fast, no cloud roundtrip!)
async function attachToLocalSession(sessionName: string, workDir: string): Promise<void> {
  const socketPath = getSocketPath();
  const terminal = new Terminal();

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';
    let attached = false;

    const sendCmd = (cmd: object) => {
      client.write(JSON.stringify(cmd) + '\n');
    };

    client.on('connect', () => {
      console.log('💡 Tips:');
      console.log('   • Phone: Devices → Sessions → Attach');
      console.log(`   • Push to cloud: catty push ${sessionName}`);
      console.log('   • Detach: Ctrl+C (session keeps running)');
      console.log('');

      // Send attach_stream command to enter streaming mode
      sendCmd({
        action: 'attach_stream',
        name: sessionName,
        cols: terminal.getSize().cols,
        rows: terminal.getSize().rows,
      });
    });

    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      
      // Parse newline-delimited JSON messages
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        
        if (!line.trim()) continue;
        
        try {
          const msg = JSON.parse(line);
          
          if (!attached) {
            // First message is the attach response
            if (!msg.success) {
              terminal.restore();
              console.error(`❌ Failed to attach: ${msg.error}`);
              client.end();
              reject(new Error(msg.error));
              return;
            }
            
            attached = true;
            
            // Now in streaming mode - set up terminal
            terminal.makeRaw();
            
            // Forward stdin directly to daemon
            process.stdin.on('data', (data: Buffer) => {
              sendCmd({
                action: 'data',
                data: data.toString('base64'),
              });
            });

            // Handle resize
            const handleResize = () => {
              sendCmd({
                action: 'resize',
                cols: terminal.getSize().cols,
                rows: terminal.getSize().rows,
              });
            };
            terminal.onResize(handleResize);
            continue;
          }
          
          // Streaming messages
          if (msg.type === 'data') {
            // Decode base64 and write to stdout immediately
            const decoded = Buffer.from(msg.data, 'base64');
            process.stdout.write(decoded);
          } else if (msg.type === 'exit') {
            terminal.restore();
            console.log(`\nSession exited with code ${msg.exit_code}`);
            client.end();
            resolve();
          } else if (msg.type === 'error') {
            terminal.restore();
            console.error(`\nError: ${msg.error}`);
            client.end();
            reject(new Error(msg.error));
          }
        } catch (e) {
          // Partial JSON, wait for more
        }
      }
    });

    client.on('error', (err) => {
      terminal.restore();
      console.error(`Connection error: ${err.message}`);
      reject(err);
    });

    client.on('close', () => {
      terminal.restore();
      if (attached) {
        console.log('\nDisconnected from session');
      }
      resolve();
    });

    // Handle Ctrl+C gracefully - detach but don't kill session
    process.on('SIGINT', () => {
      terminal.restore();
      sendCmd({ action: 'detach' });
      console.log('\n\nDetached from session (session still running)');
      console.log(`Reattach with: catty local session attach ${sessionName}`);
      client.end();
      process.exit(0);
    });
  });
}
