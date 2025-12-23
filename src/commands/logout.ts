import { Command } from 'commander';
import { isLoggedIn, loadCredentials, deleteCredentials } from '../lib/auth.js';

export const logoutCommand = new Command('logout')
  .description('Log out of Catty')
  .action(async () => {
    if (!isLoggedIn()) {
      console.log('Not logged in');
      return;
    }

    const creds = loadCredentials();
    const email = creds?.email || '';

    deleteCredentials();

    if (email) {
      console.log(`Logged out from ${email}`);
    } else {
      console.log('Logged out');
    }
  });
