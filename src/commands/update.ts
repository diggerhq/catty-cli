import { Command } from 'commander';
import { checkForUpdate, runUpdate } from '../lib/version-checker.js';

declare const __VERSION__: string;

export const updateCommand = new Command('update')
  .description('Update catty to the latest version')
  .action(async () => {
    try {
      const currentVersion = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

      if (currentVersion === 'dev') {
        console.log('Cannot update in development mode.');
        return;
      }

      console.log('Checking for updates...');
      const { updateAvailable, latestVersion } = await checkForUpdate({
        bypassCache: true,
      });

      if (!updateAvailable || !latestVersion) {
        console.log(`You are already using the latest version (${currentVersion}).`);
        return;
      }

      // When manually running update command, always update regardless of declined status
      await runUpdate(currentVersion, latestVersion);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    }
  });
