import { Command } from 'commander';
import open from 'open';
import { getAPIAddr, sleep } from '../lib/config.js';
import { isLoggedIn, loadCredentials, saveCredentials } from '../lib/auth.js';
import type { DeviceAuthResponse, TokenResponse } from '../types/index.js';

export const loginCommand = new Command('login')
  .description('Log in to Catty')
  .action(async function (this: Command) {
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (isLoggedIn()) {
      const creds = loadCredentials();
      console.log(`Already logged in as ${creds?.email}`);
      console.log("Run 'catty logout' to log out first");
      return;
    }

    console.log('Starting login...');

    // Step 1: Start device auth flow
    const authResp = await fetch(`${apiAddr}/v1/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    if (!authResp.ok) {
      throw new Error(`Failed to start auth: ${authResp.statusText}`);
    }

    const auth: DeviceAuthResponse = await authResp.json();

    // Step 2: Show code and open browser
    console.log('\nYour confirmation code:\n');
    console.log(`    ${auth.user_code}\n`);
    console.log(`Opening ${auth.verification_uri_complete}\n`);

    await open(auth.verification_uri_complete);
    console.log('Waiting for authentication...');

    // Step 3: Poll for token
    const interval = (auth.interval || 5) * 1000;
    const deadline = Date.now() + auth.expires_in * 1000;

    while (Date.now() < deadline) {
      await sleep(interval);

      const tokenResp = await fetch(`${apiAddr}/v1/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: auth.device_code }),
      });

      const token: TokenResponse = await tokenResp.json();

      if (token.pending) continue;
      if (token.error) throw new Error(token.error);

      if (token.access_token) {
        saveCredentials({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          user_id: token.user?.id || '',
          email: token.user?.email || '',
          expires_at: token.expires_in
            ? new Date(Date.now() + (token.expires_in - 30) * 1000).toISOString()
            : undefined,
        });
        console.log(`\nLogged in as ${token.user?.email}`);
        console.log("You can now run 'catty new' to start a session");
        return;
      }
    }

    throw new Error('Authentication timed out');
  });
