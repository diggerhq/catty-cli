import { Command } from 'commander';
import { getAPIAddr, sleep } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { APIClient } from '../lib/api-client.js';
import { connectToSession, type ConnectionResult } from '../lib/websocket.js';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

export const connectCommand = new Command('connect')
  .description('Reconnect to an existing session')
  .argument('<label>', 'Session label (e.g., brave-tiger-1234)')
  .option('--no-auto-reconnect', 'Disable automatic reconnection on disconnect')
  .option('--no-sync-back', "Don't sync remote file changes back to local")
  .action(async function (this: Command, label: string) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);
    const autoReconnect = opts.autoReconnect !== false;

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(apiAddr);
    let reconnectAttempts = 0;

    while (true) {
      try {
        console.log(`Looking up session ${label}...`);
        const session = await client.getSession(label, true);

        if (session.status === 'stopped') {
          throw new Error(`Session ${session.label} is stopped`);
        }
        if (session.machine_state && session.machine_state !== 'started') {
          throw new Error(`Machine is not running (state: ${session.machine_state})`);
        }

        if (reconnectAttempts > 0) {
          console.log(`\x1b[32m✓ Reconnected to ${session.label}\x1b[0m`);
        } else {
          console.log(`Connecting to ${session.label}...`);
          if (opts.syncBack) {
            console.log(`  Sync-back: enabled (remote changes will sync to local)`);
          }
        }

        const result: ConnectionResult = await connectToSession({
          connectURL: session.connect_url,
          connectToken: session.connect_token!,
          headers: { 'fly-force-instance-id': session.machine_id },
          syncBack: opts.syncBack !== false,
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
            console.error(`Run 'catty connect ${label}' to try again manually.`);
            process.exit(1);
          }

          console.log(`\x1b[33m⟳ Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`);
          await sleep(RECONNECT_DELAY_MS);
          // Loop continues to reconnect
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
