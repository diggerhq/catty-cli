import { Command } from 'commander';
import { getAPIAddr } from '../lib/config.js';
import { APIClient } from '../lib/api-client.js';

export const stopCommand = new Command('stop')
  .description('Stop a session')
  .argument('<label>', 'Session ID or label')
  .option('--delete', 'Delete the machine after stopping', false)
  .action(async function (this: Command, label: string) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);
    const client = new APIClient(apiAddr);

    await client.stopSession(label, opts.delete);

    if (opts.delete) {
      console.log(`Session ${label} stopped and deleted`);
    } else {
      console.log(`Session ${label} stopped`);
    }
  });
