import { Command } from 'commander';
import open from 'open';
import { getAPIAddr } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { APIClient, APIError } from '../lib/api-client.js';
import { connectToSession } from '../lib/websocket.js';
import { uploadWorkspace, buildUploadURL } from '../lib/workspace.js';

export const newCommand = new Command('new')
  .description('Start a new remote agent session')
  .option('--agent <name>', 'Agent to use: claude or codex', 'claude')
  .option('--no-upload', "Don't upload current directory")
  .option('--no-sync-back', 'Disable sync-back')
  .option(
    '--enable-prompts',
    'Enable permission prompts (by default, all permissions are auto-approved)',
    false
  )
  .action(async function (this: Command) {
    const opts = this.opts();
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);

    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(apiAddr);

    console.log('Creating session...');

    // Determine command arguments based on agent and prompts setting
    let cmdArgs: string[];
    switch (opts.agent) {
      case 'claude':
        if (opts.enablePrompts) {
          // User wants prompts - don't skip permissions
          cmdArgs = ['claude-wrapper'];
        } else {
          // Default: auto-approve all permissions
          cmdArgs = ['claude-wrapper', '--dangerously-skip-permissions'];
        }
        break;
      case 'codex':
        cmdArgs = ['codex'];
        break;
      default:
        console.error(
          `Unknown agent: ${opts.agent} (must be 'claude' or 'codex')`
        );
        process.exit(1);
    }

    let session;
    try {
      session = await client.createSession({
        agent: opts.agent,
        cmd: cmdArgs,
        region: 'iad',
        ttl_sec: 7200,
      });
    } catch (err) {
      if (err instanceof APIError && err.isQuotaExceeded()) {
        await handleQuotaExceeded(client);
        return;
      }
      throw err;
    }

    console.log(`Session created: ${session.label}`);
    console.log(`  Reconnect with: catty connect ${session.label}`);

    // Upload workspace
    if (opts.upload !== false) {
      console.log('Uploading workspace...');
      const uploadURL = buildUploadURL(session.connect_url);

      await uploadWorkspace(
        uploadURL,
        session.connect_token,
        session.headers['fly-force-instance-id']
      );
      console.log('Workspace uploaded.');
    }

    console.log(`Connecting to ${session.connect_url}...`);

    await connectToSession({
      connectURL: session.connect_url,
      connectToken: session.connect_token,
      headers: session.headers,
      syncBack: opts.syncBack !== false,
    });
  });

async function handleQuotaExceeded(client: APIClient): Promise<void> {
  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  Free tier quota exceeded (1M tokens/month)');
  console.error('  Upgrade to Pro for unlimited usage.');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');

  try {
    const checkoutURL = await client.createCheckoutSession();
    console.error('Opening upgrade page in your browser...');
    await open(checkoutURL);
  } catch (err) {
    console.error(`Failed to create checkout session: ${err}`);
    console.error('Please visit https://catty.dev to upgrade.');
  }
}
