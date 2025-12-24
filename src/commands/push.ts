// catty push - Push a local session to the cloud
// This uploads the working directory and creates a cloud session

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { isLoggedIn } from '../lib/auth.js';
import { getAPIAddr, getCattyDir } from '../lib/config.js';
import { APIClient, APIError } from '../lib/api-client.js';
import { uploadWorkspace, buildUploadURL } from '../lib/workspace.js';
import { getAllSecrets, listSecretNames } from '../lib/secrets.js';
import { connectToSession, type ConnectionResult } from '../lib/websocket.js';

const SOCKET_NAME = 'catty-local.sock';

function getSocketPath(): string {
  return path.join(getCattyDir(), SOCKET_NAME);
}

interface LocalResponse {
  success: boolean;
  error?: string;
  sessions?: SessionInfo[];
  history?: string;
}

interface SessionInfo {
  name: string;
  command: string;
  status: string;
  work_dir?: string;
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

export const pushCommand = new Command('push')
  .description('Push a local session to the cloud')
  .argument('[name]', 'Local session name to push')
  .option('--keep', 'Keep local session running after push')
  .option('--no-git', "Don't upload .git directory")
  .option('--no-secrets', "Don't pass stored secrets to cloud session")
  .action(async function (this: Command, name?: string) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    // If no name provided, try to find the only running session
    let sessionName = name;
    let workDir = process.cwd();

    if (await isDaemonRunning()) {
      try {
        const listResp = await sendCommand({ action: 'list' });
        const sessions = listResp.sessions || [];
        const runningSessions = sessions.filter(s => s.status === 'running');

        if (!sessionName) {
          if (runningSessions.length === 0) {
            console.log('No local sessions running.');
            console.log('');
            console.log('To push current directory to cloud without a local session:');
            console.log('  catty remote');
            process.exit(0);
          } else if (runningSessions.length === 1) {
            sessionName = runningSessions[0].name;
            console.log(`Using session: ${sessionName}`);
          } else {
            console.error('Multiple sessions running. Please specify which one:');
            for (const s of runningSessions) {
              console.error(`  catty push ${s.name}`);
            }
            process.exit(1);
          }
        }

        // Find the session to get its working directory
        const session = sessions.find(s => s.name === sessionName);
        if (session?.work_dir) {
          workDir = session.work_dir;
        }
      } catch {
        // Daemon not reachable, use current directory
      }
    }

    // Fetch history from daemon before pushing
    let sessionHistory = '';
    if (sessionName && await isDaemonRunning()) {
      try {
        const historyResp = await sendCommand({ action: 'history', name: sessionName });
        if (historyResp.success && historyResp.history) {
          sessionHistory = historyResp.history;
          console.log(`📜 Retrieved session history (${Math.round(sessionHistory.length / 1024)}KB)`);
        }
      } catch {
        // History fetch failed, continue without it
      }
    }

    console.log('☁️  Pushing to cloud...');
    console.log(`   Local session: ${sessionName || '(none)'}`);
    console.log(`   Working directory: ${workDir}`);
    console.log('');

    const client = new APIClient(apiAddr);

    // Gather secrets
    let secrets: Record<string, string> | undefined;
    if (opts.secrets !== false) {
      secrets = getAllSecrets();
      const secretNames = listSecretNames();
      if (secretNames.length > 0) {
        console.log(`Secrets: ${secretNames.join(', ')}`);
      }
    }

    // Create cloud session with same name as local session
    let cloudSession;
    try {
      cloudSession = await client.createSession({
        agent: 'claude',
        cmd: ['claude-wrapper', '--dangerously-skip-permissions'],
        region: 'iad',
        ttl_sec: 7200,
        secrets,
        label: sessionName, // Keep the same name!
      });
    } catch (err) {
      if (err instanceof APIError && err.isQuotaExceeded()) {
        console.error('');
        console.error(`❌ ${err.message}`);
        console.error('');
        try {
          const checkoutURL = await client.createCheckoutSession();
          console.error(`Upgrade: ${checkoutURL}`);
        } catch {
          console.error('Visit https://catty.dev to upgrade');
        }
        process.exit(1);
      }
      throw err;
    }

    console.log(`Cloud session created: ${cloudSession.label}`);

    // Upload workspace from the local session's working directory
    console.log('Uploading workspace...');
    const originalCwd = process.cwd();
    let tempClaudeMd: string | null = null;
    
    try {
      process.chdir(workDir);
      
      // If we have history, create CLAUDE.md with session context
      if (sessionHistory) {
        const claudeMdPath = path.join(workDir, 'CLAUDE.md');
        const existingContent = fs.existsSync(claudeMdPath) 
          ? fs.readFileSync(claudeMdPath, 'utf8') 
          : '';
        
        // Create history context for Claude
        const historyContext = `# Session History

This session was pushed from a local catty session. Below is the conversation history
from the local session to provide context for continuing the work.

<session_history>
${sessionHistory}
</session_history>

---

${existingContent}`;
        
        // Backup existing CLAUDE.md if it exists
        if (existingContent) {
          tempClaudeMd = existingContent;
        }
        
        fs.writeFileSync(claudeMdPath, historyContext);
        console.log('📜 Added session history to CLAUDE.md');
      }
      
      const uploadURL = buildUploadURL(cloudSession.connect_url);
      await uploadWorkspace(
        uploadURL,
        cloudSession.connect_token,
        cloudSession.headers['fly-force-instance-id'],
        { excludeGit: opts.git === false }
      );
      
      // Restore original CLAUDE.md if we modified it
      if (tempClaudeMd !== null) {
        fs.writeFileSync(path.join(workDir, 'CLAUDE.md'), tempClaudeMd);
      } else if (sessionHistory) {
        // Remove the CLAUDE.md we created if there wasn't one before
        fs.unlinkSync(path.join(workDir, 'CLAUDE.md'));
      }
    } finally {
      process.chdir(originalCwd);
    }
    console.log('Workspace uploaded.');

    // Kill local session if not keeping
    if (sessionName && !opts.keep && await isDaemonRunning()) {
      try {
        await sendCommand({ action: 'kill', name: sessionName });
        console.log(`Local session '${sessionName}' stopped.`);
      } catch {
        // Ignore errors stopping local session
      }
    }

    console.log('');
    console.log('✅ Pushed to cloud!');
    console.log(`   Reconnect with: catty connect ${cloudSession.label}`);
    console.log('');

    // Connect to the cloud session
    console.log(`Connecting to cloud session...`);

    const result: ConnectionResult = await connectToSession({
      connectURL: cloudSession.connect_url,
      connectToken: cloudSession.connect_token,
      headers: cloudSession.headers,
      syncBack: true,
    });

    if (result.type === 'exit') {
      process.exit(result.code);
    } else if (result.type === 'interrupted') {
      process.exit(130);
    } else {
      process.exit(0);
    }
  });

