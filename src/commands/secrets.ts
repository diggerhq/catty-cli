import { Command } from 'commander';
import { createInterface } from 'readline';
import open from 'open';
import {
  setSecret,
  getSecret,
  deleteSecret,
  listSecretNames,
  verifyGitHubToken,
} from '../lib/secrets.js';

/**
 * Read a line from stdin with hidden input (for secrets).
 */
async function readHiddenInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide input by writing asterisks
    process.stdout.write(prompt);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = '';

    const onData = (char: Buffer) => {
      const c = char.toString();

      if (c === '\n' || c === '\r') {
        // Enter pressed
        stdin.removeListener('data', onData);
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (c === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(130);
      } else if (c === '\u007F' || c === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c.charCodeAt(0) >= 32) {
        // Printable character
        input += c;
        process.stdout.write('•');
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Read a line from stdin (visible input).
 */
async function readInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Interactive GitHub token setup.
 */
async function setupGitHub(): Promise<void> {
  console.log(`
┌──────────────────────────────────────────────────────────────┐
│  GitHub Personal Access Token Setup                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Go to: https://github.com/settings/tokens/new             │
│                                                               │
│  2. Create a token with these scopes:                         │
│     ✓ repo (Full control of private repositories)            │
│                                                               │
│  3. Generate and copy the token                               │
│                                                               │
└──────────────────────────────────────────────────────────────┘
`);

  const openBrowser = await readInput('Open GitHub in browser? [Y/n] ');
  if (openBrowser.toLowerCase() !== 'n') {
    await open(
      'https://github.com/settings/tokens/new?scopes=repo&description=Catty%20CLI'
    );
    console.log('');
  }

  const token = await readHiddenInput('Paste your token: ');

  if (!token || token.trim() === '') {
    console.error('✗ No token provided');
    process.exit(1);
  }

  console.log('Verifying token...');
  const result = await verifyGitHubToken(token.trim());

  if (!result.valid) {
    console.error(`✗ ${result.error}`);
    process.exit(1);
  }

  // Save both common names for the token
  setSecret('GH_TOKEN', token.trim());
  setSecret('GITHUB_TOKEN', token.trim());

  console.log(`✓ Token verified (user: ${result.username})`);
  console.log('✓ Saved securely');
  console.log('');
  console.log('Your sessions will now have GitHub access.');
  console.log('Claude can clone repos, push commits, and more.');
}

export const secretsCommand = new Command('secrets')
  .description('Manage secrets for remote sessions')
  .addCommand(
    new Command('add')
      .description('Add a secret')
      .argument('[name]', 'Secret name (or "github" for guided setup)')
      .action(async (name?: string) => {
        if (!name) {
          console.error('Usage: catty secrets add <name>');
          console.error('       catty secrets add github   (guided setup)');
          process.exit(1);
        }

        if (name.toLowerCase() === 'github') {
          await setupGitHub();
          return;
        }

        // Generic secret
        const value = await readHiddenInput(`Enter value for ${name}: `);
        if (!value || value.trim() === '') {
          console.error('✗ No value provided');
          process.exit(1);
        }

        setSecret(name, value.trim());
        console.log(`✓ Secret "${name}" saved`);
      })
  )
  .addCommand(
    new Command('set')
      .description('Set a secret (non-interactive)')
      .argument('<name>', 'Secret name')
      .argument('<value>', 'Secret value')
      .action((name: string, value: string) => {
        setSecret(name, value);
        console.log(`✓ Secret "${name}" saved`);
      })
  )
  .addCommand(
    new Command('list')
      .description('List configured secrets')
      .action(() => {
        const names = listSecretNames();
        if (names.length === 0) {
          console.log('No secrets configured.');
          console.log('');
          console.log('Add secrets with:');
          console.log('  catty secrets add github   # GitHub token (guided)');
          console.log('  catty secrets add <NAME>   # Any secret');
          return;
        }

        console.log('Configured secrets:');
        for (const name of names) {
          console.log(`  • ${name}`);
        }
        console.log('');
        console.log('Secrets are passed to sessions as environment variables.');
      })
  )
  .addCommand(
    new Command('remove')
      .description('Remove a secret')
      .argument('<name>', 'Secret name')
      .action((name: string) => {
        const deleted = deleteSecret(name);
        if (deleted) {
          // Also delete paired token if removing GitHub
          if (name === 'GH_TOKEN') deleteSecret('GITHUB_TOKEN');
          if (name === 'GITHUB_TOKEN') deleteSecret('GH_TOKEN');

          console.log(`✓ Secret "${name}" removed`);
        } else {
          console.error(`✗ Secret "${name}" not found`);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('test')
      .description('Test a secret (e.g., verify GitHub token)')
      .argument('<name>', 'Secret name (currently only "github" supported)')
      .action(async (name: string) => {
        if (name.toLowerCase() === 'github') {
          const token = getSecret('GH_TOKEN') || getSecret('GITHUB_TOKEN');
          if (!token) {
            console.error('✗ No GitHub token configured');
            console.error('  Run: catty secrets add github');
            process.exit(1);
          }

          console.log('Testing GitHub token...');
          const result = await verifyGitHubToken(token);

          if (result.valid) {
            console.log(`✓ Token valid (user: ${result.username})`);
          } else {
            console.error(`✗ ${result.error}`);
            console.error('  Run: catty secrets add github');
            process.exit(1);
          }
        } else {
          console.error(
            `✗ Testing "${name}" is not supported. Only "github" can be tested.`
          );
          process.exit(1);
        }
      })
  );

