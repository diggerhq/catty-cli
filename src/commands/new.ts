import { Command } from 'commander';
import open from 'open';
import { getAPIAddr, sleep } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { APIClient, APIError } from '../lib/api-client.js';
import { connectToSession, type ConnectionResult } from '../lib/websocket.js';
import { uploadWorkspace, buildUploadURL } from '../lib/workspace.js';
import { getAllSecrets, listSecretNames } from '../lib/secrets.js';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

export const newCommand = new Command('new')
  .description('Start a new remote agent session')
  .option('--agent <name>', 'Agent to use: claude or codex', 'claude')
  .option('--no-upload', "Don't upload current directory")
  .option('--no-auto-reconnect', 'Disable automatic reconnection on disconnect')
  .option('--no-secrets', "Don't pass stored secrets to session")
  .option(
    '--enable-prompts',
    'Enable permission prompts (by default, all permissions are auto-approved)',
    false
  )
  .action(async function (this: Command) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);
    const autoReconnect = opts.autoReconnect !== false;

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(apiAddr);

    console.log('Creating session...');

    // Determine command arguments based on agent and prompts setting
    let cmdArgs: string[];
    switch (opts.agent) {
      case 'claude':
        if (opts.enablePrompts) {
          // User wants prompts - don't skip permissions
          cmdArgs = ['claude-wrapper'];
        } else {
          // Default: auto-approve all permissions
          cmdArgs = ['claude-wrapper', '--dangerously-skip-permissions'];
        }
        break;
      case 'codex':
        cmdArgs = ['codex'];
        break;
      default:
        console.error(
          `Unknown agent: ${opts.agent} (must be 'claude' or 'codex')`
        );
        process.exit(1);
    }

    // Gather secrets to pass to session
    let secrets: Record<string, string> | undefined;
    if (opts.secrets !== false) {
      secrets = getAllSecrets();
      const secretNames = listSecretNames();
      if (secretNames.length > 0) {
        console.log(`Secrets: ${secretNames.join(', ')}`);
      }
    }

    let session;
    try {
      session = await client.createSession({
        agent: opts.agent,
        cmd: cmdArgs,
        region: 'iad',
        ttl_sec: 7200,
        secrets,
      });
    } catch (err) {
      if (err instanceof APIError && err.isQuotaExceeded()) {
        await handleQuotaExceeded(client);
        return;
      }
      throw err;
    }

    console.log(`Session created: ${session.label}`);
    console.log(`  Reconnect with: catty connect ${session.label}`);

    // Upload workspace
    if (opts.upload !== false) {
      console.log('Uploading workspace...');
      const uploadURL = buildUploadURL(session.connect_url);

      await uploadWorkspace(
        uploadURL,
        session.connect_token,
        session.headers['fly-force-instance-id']
      );
      console.log('Workspace uploaded.');
    }

    console.log(`Connecting to ${session.connect_url}...`);

    // Connection loop with auto-reconnect
    let reconnectAttempts = 0;

    while (true) {
      try {
        const result: ConnectionResult = await connectToSession({
          connectURL: session.connect_url,
          connectToken: session.connect_token,
          headers: session.headers,
        });

        // Handle the connection result
        if (result.type === 'exit') {
          // Clean exit - process ended normally
          process.exit(result.code);
        } else if (result.type === 'interrupted') {
          // User pressed Ctrl+C - exit cleanly, don't reconnect
          process.exit(130);
        } else if (result.type === 'replaced') {
          // Connection was replaced by another client - don't reconnect
          console.log('Session taken over by another client.');
          process.exit(0);
        } else if (result.type === 'disconnected') {
          // Connection lost - try to reconnect
          if (!autoReconnect) {
            console.error(`Disconnected: ${result.reason}`);
            process.exit(1);
          }

          reconnectAttempts++;
          if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            console.error(`\x1b[31m✗ Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts\x1b[0m`);
            console.error(`Run 'catty connect ${session.label}' to try again manually.`);
            process.exit(1);
          }

          console.log(`\x1b[33m⟳ Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`);
          await sleep(RECONNECT_DELAY_MS);

          // Refresh session info before reconnecting
          try {
            session = await client.getSession(session.label, true);
            if (session.status === 'stopped') {
              console.error(`\x1b[31m✗ Session has stopped\x1b[0m`);
              process.exit(1);
            }
          } catch {
            // Session lookup failed, try with existing info
          }
        }
      } catch (err) {
        if (reconnectAttempts > 0 && autoReconnect) {
          reconnectAttempts++;
          if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            console.error(`\x1b[31m✗ Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts\x1b[0m`);
            process.exit(1);
          }
          console.error(`\x1b[33m⟳ Reconnect failed, retrying (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`);
          await sleep(RECONNECT_DELAY_MS);
        } else {
          throw err;
        }
      }
    }
  });

async function handleQuotaExceeded(client: APIClient): Promise<void> {
  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  Free tier quota exceeded (1M tokens/month)');
  console.error('  Upgrade to Pro for unlimited usage.');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');

  try {
    const checkoutURL = await client.createCheckoutSession();
    console.error('Opening upgrade page in your browser...');
    await open(checkoutURL);
  } catch (err) {
    console.error(`Failed to create checkout session: ${err}`);
    console.error('Please visit https://catty.dev to upgrade.');
  }
}
