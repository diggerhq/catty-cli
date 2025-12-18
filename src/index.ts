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
import { updateCommand } from './commands/update.js';
import { secretsCommand } from './commands/secrets.js';
import { downloadCommand } from './commands/download.js';
import {
  checkForUpdate,
  printUpdateAvailable,
  promptForUpdate,
  runUpdate,
  recordDeclinedUpdate,
} from './lib/version-checker.js';

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
program.addCommand(updateCommand);
program.addCommand(secretsCommand);
program.addCommand(downloadCommand);

// Handle errors gracefully
program.exitOverride();

async function main() {
  try {
    await program.parseAsync(process.argv);

    // Check for updates after command execution
    // Skip if running version, update, or help commands
    const command = process.argv[2];
    const skipUpdateCheck = [
      'version',
      'update',
      '-v',
      '--version',
      '-h',
      '--help',
      'help',
    ];
    if (command && !skipUpdateCheck.includes(command)) {
      const { updateAvailable, currentVersion, latestVersion, shouldPrompt } =
        await checkForUpdate();
      if (updateAvailable && latestVersion && shouldPrompt) {
        printUpdateAvailable(currentVersion, latestVersion);
        const shouldUpdate = await promptForUpdate();
        if (shouldUpdate) {
          try {
            await runUpdate(currentVersion, latestVersion);
          } catch (err) {
            // Update failed, but don't exit the process
            // Error message already printed by runUpdate
          }
        } else {
          // User declined - record it so we don't ask again for 2 days
          recordDeclinedUpdate(latestVersion);
        }
      }
    }
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
