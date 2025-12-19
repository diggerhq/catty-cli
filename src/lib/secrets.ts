import { homedir, hostname } from 'os';
import { join } from 'path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from 'fs';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
} from 'crypto';
import { CREDENTIALS_DIR, SECRETS_FILE } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'catty-secrets-v1';

interface SecretsStore {
  version: number;
  secrets: Record<string, string>; // name -> encrypted value
}

/**
 * Get machine-specific encryption key.
 * Uses hostname + homedir as entropy (unique per machine).
 */
function getEncryptionKey(): Buffer {
  const machineId = createHash('sha256')
    .update(`${hostname()}:${homedir()}:catty-machine-key`)
    .digest('hex');
  return scryptSync(machineId, SALT, 32);
}

function getSecretsDir(): string {
  return join(homedir(), CREDENTIALS_DIR);
}

function getSecretsPath(): string {
  return join(getSecretsDir(), SECRETS_FILE);
}

function loadStore(): SecretsStore {
  const path = getSecretsPath();
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as SecretsStore;
  } catch {
    return { version: 1, secrets: {} };
  }
}

function saveStore(store: SecretsStore): void {
  const dir = getSecretsDir();
  const path = getSecretsPath();

  // Create directory with 0700 permissions
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Write file with 0600 permissions
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/**
 * Encrypt a secret value.
 */
function encrypt(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(value, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  // Format: version:iv:authTag:encrypted
  return `v1:${iv.toString('base64')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a secret value.
 */
function decrypt(encrypted: string): string | null {
  try {
    const [version, ivB64, authTagB64, data] = encrypted.split(':');
    if (version !== 'v1') return null;

    const key = getEncryptionKey();
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Set a secret value.
 */
export function setSecret(name: string, value: string): void {
  const store = loadStore();
  store.secrets[name] = encrypt(value);
  saveStore(store);
}

/**
 * Get a secret value.
 */
export function getSecret(name: string): string | null {
  const store = loadStore();
  const encrypted = store.secrets[name];
  if (!encrypted) return null;
  return decrypt(encrypted);
}

/**
 * Delete a secret.
 */
export function deleteSecret(name: string): boolean {
  const store = loadStore();
  if (!(name in store.secrets)) return false;
  delete store.secrets[name];
  saveStore(store);
  return true;
}

/**
 * List all secret names (not values).
 */
export function listSecretNames(): string[] {
  const store = loadStore();
  return Object.keys(store.secrets);
}

/**
 * Get all secrets as key-value pairs (decrypted).
 * Used when passing to API for session creation.
 */
export function getAllSecrets(): Record<string, string> {
  const store = loadStore();
  const result: Record<string, string> = {};

  for (const name of Object.keys(store.secrets)) {
    const value = decrypt(store.secrets[name]);
    if (value !== null) {
      result[name] = value;
    }
  }

  return result;
}

/**
 * Check if secrets file exists.
 */
export function hasSecrets(): boolean {
  return existsSync(getSecretsPath());
}

/**
 * Clear all secrets.
 */
export function clearAllSecrets(): void {
  const path = getSecretsPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/**
 * Verify a GitHub token is valid and return user info.
 */
export async function verifyGitHubToken(
  token: string
): Promise<{ valid: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'catty-cli',
      },
    });

    if (res.status === 401) {
      return { valid: false, error: 'Invalid token' };
    }

    if (!res.ok) {
      return { valid: false, error: `GitHub API error: ${res.status}` };
    }

    const user = (await res.json()) as { login: string };
    return { valid: true, username: user.login };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

