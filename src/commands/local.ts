import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { getApiAddr, getCattyDir } from '../lib/config.js';

const SOCKET_NAME = 'catty-local.sock';
const BINARY_NAME = process.platform === 'win32' ? 'catty-local.exe' : 'catty-local';

function getSocketPath(): string {
  return path.join(getCattyDir(), SOCKET_NAME);
}

function getBinaryPath(): string {
  return path.join(getCattyDir(), 'bin', BINARY_NAME);
}

function getPlatformBinary(): string {
  const platform = process.platform;
  const arch = process.arch;
  
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'catty-local-darwin-arm64' : 'catty-local-darwin-amd64';
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'catty-local-linux-arm64' : 'catty-local-linux-amd64';
  } else if (platform === 'win32') {
    return 'catty-local-windows-amd64.exe';
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

async function ensureBinary(): Promise<string> {
  const binaryPath = getBinaryPath();
  
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }
  
  // Binary doesn't exist - check if it's in the catty-local dev directory
  const devBinary = path.join(__dirname, '../../../catty-local/bin/catty-local');
  if (fs.existsSync(devBinary)) {
    // Create bin directory and symlink
    const binDir = path.dirname(binaryPath);
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(devBinary, binaryPath);
    fs.chmodSync(binaryPath, 0o755);
    console.log('✅ Using local development binary');
    return binaryPath;
  }
  
  // TODO: Download binary from releases
  console.error('❌ catty-local binary not found.');
  console.error('');
  console.error('For now, build it manually:');
  console.error('  cd catty-local && make build');
  console.error('  cp bin/catty-local ~/.catty/bin/');
  process.exit(1);
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

interface LocalResponse {
  success: boolean;
  error?: string;
  sessions?: SessionInfo[];
  status?: string;
}

interface SessionInfo {
  name: string;
  command: string;
  status: string;
  client_count: number;
  created_at: string;
  exit_code?: number;
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
    
    // Timeout
    setTimeout(() => {
      if (!resolved) {
        client.destroy();
        reject(new Error('Daemon connection timeout'));
      }
    }, 5000);
  });
}

// --- Commands ---

const startCommand = new Command('start')
  .description('Start the local relay daemon')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    if (await isDaemonRunning()) {
      console.log('✅ Daemon is already running');
      return;
    }
    
    const binary = await ensureBinary();
    const apiAddr = getApiAddr();
    
    const args = ['daemon', '--api', apiAddr];
    if (options.debug) {
      args.push('--debug');
    }
    
    console.log('🐱 Starting catty-local daemon...');
    console.log(`   API: ${apiAddr}`);
    
    // Start daemon in background
    const child = spawn(binary, args, {
      detached: true,
      stdio: 'ignore',
    });
    
    child.unref();
    
    // Wait for daemon to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await isDaemonRunning()) {
        console.log('✅ Daemon started (pid: ' + child.pid + ')');
        return;
      }
    }
    
    console.error('❌ Daemon failed to start');
    process.exit(1);
  });

const stopCommand = new Command('stop')
  .description('Stop the local relay daemon')
  .action(async () => {
    if (!(await isDaemonRunning())) {
      console.log('Daemon is not running');
      return;
    }
    
    // Find and kill the daemon process
    try {
      // On Unix, we can find processes by socket
      if (process.platform !== 'win32') {
        execSync('pkill -f "catty-local daemon"', { stdio: 'ignore' });
      }
      console.log('✅ Daemon stopped');
    } catch (e) {
      console.log('Daemon may already be stopped');
    }
  });

const statusCommand = new Command('status')
  .description('Check daemon status')
  .action(async () => {
    if (await isDaemonRunning()) {
      try {
        const resp = await sendCommand({ action: 'status' });
        console.log('✅ Daemon is running');
        console.log(`   API: ${resp.status}`);
      } catch (e) {
        console.log('✅ Daemon is running');
      }
    } else {
      console.log('❌ Daemon is not running');
      console.log('   Start it with: catty local start');
    }
  });

// Session subcommands
const sessionNewCommand = new Command('new')
  .description('Create a new local session')
  .argument('<name>', 'Session name')
  .option('--command <cmd>', 'Command to run', 'claude')
  .option('--workdir <dir>', 'Working directory')
  .action(async (name, options) => {
    if (!(await isDaemonRunning())) {
      console.error('❌ Daemon is not running. Start it with: catty local start');
      process.exit(1);
    }
    
    try {
      const resp = await sendCommand({
        action: 'create',
        name,
        command: options.command,
        work_dir: options.workdir || process.cwd(),
        cols: process.stdout.columns || 120,
        rows: process.stdout.rows || 40,
      });
      
      if (resp.success) {
        console.log(`✅ Created session '${name}'`);
        console.log('   Connect from your phone or use: catty local session attach ' + name);
      } else {
        console.error(`❌ Failed: ${resp.error}`);
        process.exit(1);
      }
    } catch (e: any) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
  });

const sessionListCommand = new Command('list')
  .alias('ls')
  .description('List local sessions')
  .action(async () => {
    if (!(await isDaemonRunning())) {
      console.error('❌ Daemon is not running. Start it with: catty local start');
      process.exit(1);
    }
    
    try {
      const resp = await sendCommand({ action: 'list' });
      
      if (!resp.sessions || resp.sessions.length === 0) {
        console.log('No sessions');
        return;
      }
      
      console.log('');
      console.log('NAME                 STATUS      CLIENTS   CREATED');
      console.log('─'.repeat(60));
      
      for (const s of resp.sessions) {
        const created = formatTimeAgo(s.created_at);
        const status = s.status.padEnd(10);
        const name = s.name.padEnd(20);
        console.log(`${name} ${status} ${s.client_count}         ${created}`);
      }
      console.log('');
    } catch (e: any) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
  });

const sessionKillCommand = new Command('kill')
  .alias('rm')
  .alias('stop')
  .description('Kill a local session')
  .argument('<name>', 'Session name')
  .action(async (name) => {
    if (!(await isDaemonRunning())) {
      console.error('❌ Daemon is not running');
      process.exit(1);
    }
    
    try {
      const resp = await sendCommand({ action: 'kill', name });
      
      if (resp.success) {
        console.log(`✅ Killed session '${name}'`);
      } else {
        console.error(`❌ Failed: ${resp.error}`);
        process.exit(1);
      }
    } catch (e: any) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
  });

const sessionCommand = new Command('session')
  .description('Manage local sessions')
  .addCommand(sessionNewCommand)
  .addCommand(sessionListCommand)
  .addCommand(sessionKillCommand);

// Main local command
export const localCommand = new Command('local')
  .description('Local device relay (connect phone to laptop)')
  .addCommand(startCommand)
  .addCommand(stopCommand)
  .addCommand(statusCommand)
  .addCommand(sessionCommand);

// Helpers
function formatTimeAgo(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  } catch {
    return 'unknown';
  }
}

