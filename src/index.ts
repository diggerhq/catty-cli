#!/usr/bin/env node
import { program } from 'commander';
import { newCommand } from './commands/new.js';
import { connectCommand } from './commands/connect.js';
import { listCommand } from './commands/list.js';
import { stopCommand } from './commands/stop.js';
import { stopAllCommand } from './commands/stopall.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { versionCommand } from './commands/version.js';

// VERSION is replaced at build time by tsup
declare const __VERSION__: string;
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

program
  .name('catty')
  .description('Catty - Remote AI agent sessions')
  .option('--api <url>', 'API server address')
  .version(version);

program.addCommand(newCommand);
program.addCommand(connectCommand);
program.addCommand(listCommand);
program.addCommand(stopCommand);
program.addCommand(stopAllCommand, { hidden: true });
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(versionCommand);

// Handle errors gracefully
program.exitOverride();

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    if (err instanceof Error) {
      // Commander throws for help/version, ignore those
      if (
        err.name === 'CommanderError' &&
        ['commander.helpDisplayed', 'commander.version'].includes(
          (err as { code?: string }).code || ''
        )
      ) {
        process.exit(0);
      }

      console.error(`Error: ${err.message}`);
    } else {
      console.error(`Error: ${err}`);
    }
    process.exit(1);
  }
}

main();
