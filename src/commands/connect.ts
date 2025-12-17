import { Command } from 'commander';
import { getAPIAddr } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { APIClient } from '../lib/api-client.js';
import { connectToSession } from '../lib/websocket.js';

export const connectCommand = new Command('connect')
  .description('Reconnect to an existing session')
  .argument('<label>', 'Session label (e.g., brave-tiger-1234)')
  .option('--sync-back', 'Sync remote file changes back to local', true)
  .option('--no-sync-back', 'Disable sync-back')
  .action(async function (this: Command, label: string) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(apiAddr);

    console.log(`Looking up session ${label}...`);
    const session = await client.getSession(label, true);

    if (session.status === 'stopped') {
      throw new Error(`Session ${session.label} is stopped`);
    }
    if (session.machine_state && session.machine_state !== 'started') {
      throw new Error(`Machine is not running (state: ${session.machine_state})`);
    }

    console.log(`Reconnecting to ${session.label}...`);

    await connectToSession({
      connectURL: session.connect_url,
      connectToken: session.connect_token!,
      headers: { 'fly-force-instance-id': session.machine_id },
      syncBack: opts.syncBack,
    });
  });
