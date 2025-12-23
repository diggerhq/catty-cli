import { Command } from 'commander';
import open from 'open';
import { isLoggedIn, loadCredentials, deleteCredentials } from '../lib/auth.js';
import { getAPIAddr } from '../lib/config.js';
import { APIClient } from '../lib/api-client.js';

export const logoutCommand = new Command('logout')
  .description('Log out of Catty')
  .action(async function (this: Command) {
    if (!isLoggedIn()) {
      console.log('Not logged in');
      return;
    }

    const creds = loadCredentials();
    const email = creds?.email || '';

    // Try to get WorkOS logout URL from backend
    let logoutUrl: string | undefined;
    try {
      const apiAddr = getAPIAddr(this.optsWithGlobals().api);
      const client = new APIClient(apiAddr);
      const response = await client.logout();
      logoutUrl = response.logout_url;
    } catch (err) {
      // Log error but continue with local logout
      console.error('Warning: Failed to get logout URL from server:', err instanceof Error ? err.message : String(err));
    }

    // Clear local credentials
    deleteCredentials();

    if (email) {
      console.log(`Logged out from ${email}`);
    } else {
      console.log('Logged out');
    }

    // Open browser to WorkOS logout URL to clear session
    if (logoutUrl) {
      console.log('\nClearing WorkOS session...');
      try {
        await open(logoutUrl);
        console.log('Browser opened to complete logout');
      } catch (err) {
        console.error('Warning: Failed to open browser:', err instanceof Error ? err.message : String(err));
        console.log('\nTo complete logout and clear your browser session, visit:');
        console.log(logoutUrl);
      }
    } else {
      console.log('\nNote: Could not retrieve WorkOS logout URL.');
      console.log('Your local session has been cleared, but browser session may persist.');
    }
  });
