import { Command } from 'commander';
import { getAPIAddr } from '../lib/config.js';
import { APIClient } from '../lib/api-client.js';

export const stopAllCommand = new Command('stop-all-sessions-dangerously')
  .description('Stop and delete ALL sessions')
  .option('--yes-i-mean-it', 'Confirm you want to stop all sessions', false)
  .action(async function (this: Command) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (!opts.yesIMeanIt) {
      throw new Error('Must pass --yes-i-mean-it to confirm');
    }

    const client = new APIClient(apiAddr);
    const sessions = await client.listSessions();

    if (sessions.length === 0) {
      console.log('No sessions to stop');
      return;
    }

    console.log(`Stopping ${sessions.length} sessions...`);

    for (const s of sessions) {
      process.stdout.write(`  Stopping ${s.session_id}... `);
      try {
        await client.stopSession(s.session_id, true);
        console.log('done');
      } catch (err) {
        console.log(`ERROR: ${err}`);
      }
    }
  });
