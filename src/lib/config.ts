export const DEFAULT_API_ADDR = 'https://api.catty.dev';
export const CREDENTIALS_DIR = '.catty';
export const CREDENTIALS_FILE = 'credentials.json';
export const SECRETS_FILE = 'secrets.json';
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB

// Timeouts
export const API_TIMEOUT_MS = 120_000; // 120 seconds for API requests (machine creation can be slow)
export const WS_WRITE_TIMEOUT_MS = 10_000; // 10 seconds for WebSocket writes
export const WS_READ_TIMEOUT_MS = 60_000; // 60 seconds (must be > 25s ping interval)

// WebSocket close codes
export const WS_POLICY_VIOLATION = 1008; // Connection replaced by new one

// Helper to get API address (checks flag, env var, or default)
export function getAPIAddr(cliOption?: string): string {
  if (cliOption) return cliOption;
  if (process.env.CATTY_API_ADDR) return process.env.CATTY_API_ADDR;
  return DEFAULT_API_ADDR;
}

// Sleep helper for polling
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
