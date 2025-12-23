import { homedir } from 'os';
import { join } from 'path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from 'fs';
import { CREDENTIALS_DIR, CREDENTIALS_FILE } from './config.js';
import type { Credentials } from '../types/index.js';

export function getCredentialsDir(): string {
  return join(homedir(), CREDENTIALS_DIR);
}

export function getCredentialsPath(): string {
  return join(getCredentialsDir(), CREDENTIALS_FILE);
}

export function loadCredentials(): Credentials | null {
  const path = getCredentialsPath();
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  const dir = getCredentialsDir();
  const path = getCredentialsPath();

  // Create directory with 0700 permissions
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Write file with 0600 permissions
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function deleteCredentials(): void {
  const path = getCredentialsPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function isLoggedIn(): boolean {
  const creds = loadCredentials();
  if (!creds) return false;

  // Check if token exists
  if (!creds.access_token) return false;

  // If there's an expiry and no refresh token, check if expired
  if (creds.expires_at && !creds.refresh_token) {
    const expiresAt = new Date(creds.expires_at);
    if (expiresAt <= new Date()) {
      return false;
    }
  }

  // If we have a refresh token, we can refresh even if access token expired
  return true;
}

export function getAccessToken(): string | null {
  const creds = loadCredentials();
  return creds?.access_token || null;
}

export function getRefreshToken(): string | null {
  const creds = loadCredentials();
  return creds?.refresh_token || null;
}

// Extract session ID from JWT token (from 'sid' claim)
export function getSessionId(): string | null {
  const token = getAccessToken();
  if (!token) return null;

  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (base64url encoded)
    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');

    const decoded = JSON.parse(jsonPayload);
    const sid = decoded.sid || null;
    return sid;
  } catch (err) {
    console.error('Failed to extract session ID from token:', err);
    return null;
  }
}
