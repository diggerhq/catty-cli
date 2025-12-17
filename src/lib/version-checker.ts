import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { spawn } from 'child_process';
import { CREDENTIALS_DIR } from './config.js';

declare const __VERSION__: string;

function logDebug(message: string): void {
  if (process.env.DEBUG || process.env.CATTY_DEBUG) {
    console.log(`\x1b[2m[DEBUG] ${message}\x1b[0m`);
  }
}

interface VersionCache {
  latestVersion: string;
  lastChecked: number;
  declinedVersion?: string;
  declinedAt?: number;
}

const VERSION_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
const DECLINED_VERSION_REMINDER_INTERVAL = 2 * 24 * 60 * 60 * 1000; // 2 days
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@diggerhq/catty/latest';

function getVersionCachePath(): string {
  return join(homedir(), CREDENTIALS_DIR, 'version-cache.json');
}

function getCachedVersion(): VersionCache | null {
  try {
    const cachePath = getVersionCachePath();
    if (!existsSync(cachePath)) {
      return null;
    }
    const data = readFileSync(cachePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function setCachedVersion(version: string, declined?: boolean): void {
  try {
    const cachePath = getVersionCachePath();
    const cacheDir = join(homedir(), CREDENTIALS_DIR);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Preserve existing declined info if not updating it
    const existing = getCachedVersion();
    const cache: VersionCache = {
      latestVersion: version,
      lastChecked: Date.now(),
      declinedVersion: declined ? version : existing?.declinedVersion,
      declinedAt: declined ? Date.now() : existing?.declinedAt,
    };

    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Silently fail if we can't write cache
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.version || null;
  } catch {
    return null;
  }
}

function compareVersions(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const curr = currentParts[i] || 0;
    const lat = latestParts[i] || 0;
    if (lat > curr) return true;
    if (lat < curr) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<{
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  shouldPrompt: boolean;
}> {
  const currentVersion =
    typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

  // Don't check in dev mode
  if (currentVersion === 'dev') {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      shouldPrompt: false,
    };
  }

  // Check cache first
  const cached = getCachedVersion();
  const now = Date.now();

  let latestVersion: string | null = null;

  if (cached && now - cached.lastChecked < VERSION_CHECK_INTERVAL) {
    // Use cached version
    latestVersion = cached.latestVersion;
  } else {
    // Fetch latest version
    latestVersion = await fetchLatestVersion();
    if (latestVersion) {
      setCachedVersion(latestVersion);
    }
  }

  if (!latestVersion) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      shouldPrompt: false,
    };
  }

  const updateAvailable = compareVersions(currentVersion, latestVersion);

  // Check if user previously declined this version
  let shouldPrompt = updateAvailable;
  if (updateAvailable && cached?.declinedVersion === latestVersion && cached.declinedAt) {
    // User declined this version - only prompt again after the reminder interval
    const timeSinceDeclined = now - cached.declinedAt;
    shouldPrompt = timeSinceDeclined >= DECLINED_VERSION_REMINDER_INTERVAL;
  }

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    shouldPrompt,
  };
}

export function printUpdateAvailable(
  currentVersion: string,
  latestVersion: string
): void {
  console.log('');
  console.log(`\x1b[33mUpdate available:\x1b[0m \x1b[2m${currentVersion}\x1b[0m → \x1b[32m${latestVersion}\x1b[0m`);
}

export async function promptForUpdate(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Would you like to update? (Y/n): ', (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      // Default to yes if empty or starts with 'y'
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

export function recordDeclinedUpdate(version: string): void {
  setCachedVersion(version, true);
}

function detectPackageManager(): string {
  // Check if npm is available
  const userAgent = process.env.npm_config_user_agent || '';

  if (userAgent.includes('yarn')) {
    return 'yarn';
  } else if (userAgent.includes('pnpm')) {
    return 'pnpm';
  } else if (userAgent.includes('bun')) {
    return 'bun';
  }

  return 'npm';
}

export async function runUpdate(
  currentVersion: string,
  latestVersion: string
): Promise<void> {
  console.log(`\nUpdating from ${currentVersion} to ${latestVersion}...\n`);

  const packageManager = detectPackageManager();
  const packageName = `@diggerhq/catty@${latestVersion}`;
  let command: string;
  let args: string[];

  switch (packageManager) {
    case 'yarn':
      command = 'yarn';
      args = ['global', 'add', packageName];
      break;
    case 'pnpm':
      command = 'pnpm';
      args = ['add', '-g', packageName];
      break;
    case 'bun':
      command = 'bun';
      args = ['install', '-g', packageName];
      break;
    default:
      command = 'npm';
      args = ['install', '-g', packageName];
  }

  logDebug(`Package manager: ${packageManager}`);
  logDebug(`Command: ${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(
          `\n\x1b[32m✓\x1b[0m Successfully updated to version ${latestVersion}`
        );
        resolve();
      } else {
        console.error(
          `\n\x1b[31m✗\x1b[0m Update failed with exit code ${code}`
        );
        reject(new Error(`Update process exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      console.error(
        `\n\x1b[31m✗\x1b[0m Failed to run update command: ${err.message}`
      );
      reject(err);
    });
  });
}
