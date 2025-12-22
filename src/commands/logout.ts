import { Command } from 'commander';
import open from 'open';
import { isLoggedIn, loadCredentials, deleteCredentials } from '../lib/auth.js';
import { getAPIAddr } from '../lib/config.js';

export const logoutCommand = new Command('logout')
  .description('Log out of Catty')
  .action(async function (this: Command) {
    if (!isLoggedIn()) {
      console.log('Not logged in');
      return;
    }

    const creds = loadCredentials();
    const email = creds?.email || '';
    const token = creds?.access_token;

    // Open browser to invalidate server-side session
    if (token) {
      const apiAddr = getAPIAddr(this.optsWithGlobals().api);
      const logoutURL = `${apiAddr}/logout?token=${encodeURIComponent(token)}`;

      console.log('Opening browser to complete logout...');
      try {
        await open(logoutURL);
      } catch (err) {
        console.warn('Could not open browser. Server session may remain active.');
        console.warn('To complete logout, visit:');
        console.warn(`  ${logoutURL}`);
      }
    }

    // Delete local credentials
    deleteCredentials();

    if (email) {
      console.log(`Logged out from ${email}`);
    } else {
      console.log('Logged out');
    }
  });
