# Catty CLI TypeScript Rewrite - Implementation Plan

## Overview

Rewrite the `catty` CLI client from Go to TypeScript for faster npm installation. The CLI is ~2,000 lines of Go code that maps cleanly to Node.js APIs without requiring native modules.

**Goal**: Eliminate the postinstall binary download step, reducing install time from 5-15s to 1-3s.

---

## Current Architecture (Go)

```
cmd/catty/
├── main.go          # Cobra CLI setup, root command
├── new.go           # Start new session
├── connect.go       # Reconnect to existing session
├── list.go          # List sessions
├── stop.go          # Stop a session
├── stopall.go       # Stop all sessions (dangerous)
├── login.go         # Device auth flow
├── logout.go        # Remove credentials
└── version.go       # Print version

internal/cli/
├── client.go        # API client with auth token refresh
├── run.go           # Session creation + WebSocket streaming
├── terminal.go      # Raw terminal mode handling
├── workspace.go     # Zip creation with .gitignore
├── syncback.go      # Apply remote file changes locally
├── auth.go          # Credential storage (~/.catty/)
└── connect.go       # Reconnect logic

internal/protocol/
└── messages.go      # WebSocket message types
```

---

## Target Architecture (TypeScript)

```
cli-ts/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, CLI setup
│   ├── commands/
│   │   ├── new.ts            # catty new
│   │   ├── connect.ts        # catty connect <label>
│   │   ├── list.ts           # catty list
│   │   ├── stop.ts           # catty stop <label>
│   │   ├── stopall.ts        # catty stop-all-sessions-dangerously
│   │   ├── login.ts          # catty login
│   │   ├── logout.ts         # catty logout
│   │   └── version.ts        # catty version
│   ├── lib/
│   │   ├── api-client.ts     # HTTP client with auth refresh
│   │   ├── terminal.ts       # Raw mode, resize handling
│   │   ├── websocket.ts      # WebSocket connection + streaming
│   │   ├── workspace.ts      # Zip creation + upload
│   │   ├── syncback.ts       # Apply remote file changes
│   │   ├── auth.ts           # Credential storage
│   │   └── config.ts         # Constants, defaults
│   ├── protocol/
│   │   └── messages.ts       # Message types + parser
│   └── types/
│       └── index.ts          # Shared TypeScript interfaces
├── bin/
│   └── catty.js              # Shebang wrapper
└── dist/                     # Compiled output
```

---

## Dependencies

```json
{
  "name": "@diggerhq/catty",
  "version": "0.1.0",
  "bin": {
    "catty": "./bin/catty.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "ws": "^8.18.0",
    "archiver": "^7.0.1",
    "ignore": "^5.3.2",
    "open": "^10.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "@types/archiver": "^6.0.2",
    "typescript": "^5.6.0",
    "tsup": "^8.3.0"
  }
}
```

**Why these dependencies:**
- `commander` - Industry standard CLI framework, similar API to Cobra
- `ws` - Most popular WebSocket library, handles binary/text frames
- `archiver` - Streaming zip creation, handles large directories
- `ignore` - Exact `.gitignore` spec implementation
- `open` - Cross-platform browser opening
- `tsup` - Fast bundler, produces single-file output

---

## Implementation Tasks

### Phase 1: Project Setup (0.5 days)

- [ ] Initialize npm package with correct metadata
- [ ] Configure TypeScript (strict mode, ES2022 target)
- [ ] Configure tsup for bundling
- [ ] Create bin/catty.js shebang wrapper
- [ ] Set up basic CLI with commander

**Acceptance criteria:**
```bash
npm run build
./bin/catty.js --help
# Shows help output
```

### Phase 2: Core Infrastructure (1 day)

#### 2.1 Config & Types (`src/lib/config.ts`, `src/types/index.ts`)

```typescript
// config.ts
export const DEFAULT_API_ADDR = 'https://api.catty.dev';
export const CREDENTIALS_DIR = '.catty';
export const CREDENTIALS_FILE = 'credentials.json';
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB

// Helper to get API address (checks flag, env var, or default)
export function getAPIAddr(cliOption?: string): string {
  if (cliOption) return cliOption;
  if (process.env.CATTY_API_ADDR) return process.env.CATTY_API_ADDR;
  return DEFAULT_API_ADDR;
}

// Sleep helper for polling
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// types/index.ts
export interface Credentials {
  access_token: string;
  refresh_token?: string;
  user_id: string;
  email: string;
  expires_at?: string;
}

export interface CreateSessionRequest {
  agent: string;
  cmd: string[];
  region: string;
  cpus: number;
  memory_mb: number;
  ttl_sec: number;
}

export interface CreateSessionResponse {
  session_id: string;
  label: string;
  machine_id: string;
  connect_url: string;
  connect_token: string;
  headers: Record<string, string>;
}

export interface SessionInfo {
  session_id: string;
  label: string;
  machine_id: string;
  connect_url: string;
  connect_token?: string;
  region: string;
  status: string;
  created_at: string;
  machine_state?: string;
}

// Command options
export interface RunOptions {
  agent: string;
  cmd: string[];
  region: string;
  cpus: number;
  memoryMB: number;
  ttlSec: number;
  apiAddr: string;
  uploadWorkspace: boolean;
  syncBack: boolean;
}

export interface ConnectOptions {
  sessionLabel: string;
  apiAddr: string;
  syncBack: boolean;
}

export interface ListOptions {
  apiAddr: string;
}

export interface StopOptions {
  sessionID: string;
  delete: boolean;
  apiAddr: string;
}
```

#### 2.2 Auth Storage (`src/lib/auth.ts`)

Port from `internal/cli/auth.go`:

```typescript
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';

export function getCredentialsPath(): string {
  return join(homedir(), '.catty', 'credentials.json');
}

export function loadCredentials(): Credentials | null {
  // Read and parse JSON, return null if not found
}

export function saveCredentials(creds: Credentials): void {
  // Create dir with 0700, write file with 0600
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function deleteCredentials(): void {
  // Remove file if exists
}

export function isLoggedIn(): boolean {
  // Check credentials exist and not expired (or have refresh token)
}

export function getAccessToken(): string | null {
  // Return stored access token
}
```

#### 2.3 API Client (`src/lib/api-client.ts`)

Port from `internal/cli/client.go`:

```typescript
// Timeout for API requests (machine creation can be slow)
const API_TIMEOUT_MS = 120_000; // 120 seconds, matches Go client

export class APIClient {
  private baseURL: string;
  private authToken: string | null;

  constructor(baseURL?: string) {
    this.baseURL = baseURL || process.env.CATTY_API_ADDR || DEFAULT_API_ADDR;
    this.authToken = getAccessToken();
  }

  private async doRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` }),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async doRequestWithRefresh(method: string, path: string, body?: unknown): Promise<Response> {
    // Try request, if 401 refresh token and retry
    let response = await this.doRequest(method, path, body);
    if (response.status === 401) {
      const refreshed = await this.refreshAuthToken();
      if (refreshed) {
        response = await this.doRequest(method, path, body);
      }
    }
    return response;
  }

  private async refreshAuthToken(): Promise<boolean> {
    // Load refresh token from credentials, call /v1/auth/refresh, save new tokens
  }

  async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> { }
  async listSessions(): Promise<SessionInfo[]> { }
  async getSession(id: string, live?: boolean): Promise<SessionInfo> { }
  async stopSession(id: string, del?: boolean): Promise<void> { }
  async createCheckoutSession(): Promise<string> { }
}

export class APIError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public upgradeURL?: string
  ) {
    super(message);
  }

  isQuotaExceeded(): boolean {
    return this.statusCode === 402 && this.errorCode === 'quota_exceeded';
  }
}
```

### Phase 3: Protocol Messages (0.5 days)

Port from `internal/protocol/messages.go`:

```typescript
// src/protocol/messages.ts

export const MessageType = {
  RESIZE: 'resize',
  SIGNAL: 'signal',
  PING: 'ping',
  PONG: 'pong',
  READY: 'ready',
  EXIT: 'exit',
  ERROR: 'error',
  SYNC_BACK: 'sync_back',
  SYNC_BACK_ACK: 'sync_back_ack',
  FILE_CHANGE: 'file_change',
} as const;

export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface ExitMessage {
  type: 'exit';
  code: number;
  signal: string | null;
}

export interface FileChangeMessage {
  type: 'file_change';
  action: 'write' | 'delete';
  path: string;
  content?: string; // base64
  mode?: number;
}

// ... other message types

export type Message = ResizeMessage | ExitMessage | FileChangeMessage | /* ... */;

export function parseMessage(data: string): Message {
  const base = JSON.parse(data);
  // Return typed message based on base.type
}

export function createResizeMessage(cols: number, rows: number): string {
  return JSON.stringify({ type: 'resize', cols, rows });
}

// ... other factory functions
```

### Phase 4: Terminal Handling (0.5 days)

Port from `internal/cli/terminal.go`:

```typescript
// src/lib/terminal.ts

export class Terminal {
  private wasRaw = false;
  private cleanupHandlers: (() => void)[] = [];

  isTerminal(): boolean {
    return process.stdin.isTTY === true;
  }

  makeRaw(): void {
    if (!this.isTerminal()) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    this.wasRaw = true;

    // Ensure terminal is restored on process exit
    const cleanup = () => this.restore();
    this.cleanupHandlers.push(cleanup);

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(130); // 128 + SIGINT(2)
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(143); // 128 + SIGTERM(15)
    });
  }

  restore(): void {
    if (this.wasRaw && process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      this.wasRaw = false;
    }
  }

  getSize(): { cols: number; rows: number } {
    return {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    };
  }

  onResize(callback: () => void): void {
    process.stdout.on('resize', callback);
  }

  offResize(callback: () => void): void {
    process.stdout.off('resize', callback);
  }
}
```

**Key differences from Go**:
- Node.js uses event-based resize handling instead of SIGWINCH signals
- Signal handlers ensure terminal is restored even on Ctrl+C

### Phase 5: WebSocket Streaming (1 day)

Port from `internal/cli/run.go`:

```typescript
// src/lib/websocket.ts
import WebSocket from 'ws';

// Timeouts matching the Go implementation
const WRITE_TIMEOUT_MS = 10_000;  // 10 seconds for writes
const READ_TIMEOUT_MS = 60_000;   // 60 seconds (must be > 25s ping interval)
const SYNC_BACK_ACK_TIMEOUT_MS = 2_000; // Warn if no sync-back ack after 2s

// WebSocket close codes
const WS_POLICY_VIOLATION = 1008; // Connection replaced by new one

export interface WebSocketConnectOptions {
  connectURL: string;
  connectToken: string;
  headers: Record<string, string>;
  syncBack: boolean;
  onExit?: (code: number) => void;
}

export async function connectToSession(opts: WebSocketConnectOptions): Promise<void> {
  const terminal = new Terminal();

  if (!terminal.isTerminal()) {
    throw new Error('stdin is not a terminal');
  }

  const ws = new WebSocket(opts.connectURL, {
    headers: {
      ...opts.headers,
      'Authorization': `Bearer ${opts.connectToken}`,
    },
  });

  return new Promise((resolve, reject) => {
    let syncBackAcked = false;

    ws.on('open', () => {
      // Enable sync-back if requested
      if (opts.syncBack) {
        ws.send(JSON.stringify({ type: 'sync_back', enabled: true }));

        // Warn if no ack after 2s
        setTimeout(() => {
          if (!syncBackAcked) {
            process.stderr.write('\r\n(sync-back) No ack from executor yet...\r\n');
          }
        }, 2000);
      }

      // Enter raw mode
      terminal.makeRaw();

      // Send initial size
      const { cols, rows } = terminal.getSize();
      ws.send(createResizeMessage(cols, rows));
    });

    // Relay stdin -> WebSocket
    process.stdin.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data); // Binary
      }
    });

    // Relay WebSocket -> stdout
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        process.stdout.write(data as Buffer);
      } else {
        const msg = parseMessage(data.toString());
        handleControlMessage(msg, ws, { syncBackAcked, resolve, reject, opts });
      }
    });

    // Handle resize
    terminal.onResize(() => {
      const { cols, rows } = terminal.getSize();
      ws.send(createResizeMessage(cols, rows));
    });

    // Cleanup on close
    ws.on('close', (code, reason) => {
      terminal.restore();
      // Code 1008 (WS_POLICY_VIOLATION) = connection replaced by new one
      // This is a clean termination, not an error
      if (code === WS_POLICY_VIOLATION) {
        resolve();
      } else {
        resolve();
      }
    });

    ws.on('error', (err) => {
      terminal.restore();
      reject(err);
    });

    // Handle process exit
    process.on('exit', () => {
      terminal.restore();
      ws.close();
    });
  });
}

function handleControlMessage(msg: Message, ws: WebSocket, ctx: any) {
  switch (msg.type) {
    case 'exit':
      ctx.opts.onExit?.(msg.code);
      process.stderr.write(`\r\nProcess exited with code ${msg.code}\r\n`);
      ctx.resolve();
      break;
    case 'error':
      process.stderr.write(`\r\nError: ${msg.message}\r\n`);
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    case 'file_change':
      applyRemoteFileChange(msg);
      break;
    case 'sync_back_ack':
      ctx.syncBackAcked = true;
      break;
  }
}
```

### Phase 6: Workspace Upload (0.5 days)

Port from `internal/cli/workspace.go`:

```typescript
// src/lib/workspace.ts
import archiver from 'archiver';
import ignore from 'ignore';
import { createReadStream, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Readable } from 'stream';

const DEFAULT_IGNORES = [
  '.git', '.git/**',
  'node_modules', 'node_modules/**',
  '__pycache__', '__pycache__/**',
  '.venv', '.venv/**', 'venv', 'venv/**',
  '.env', '*.pyc', '.DS_Store', '*.log',
];

export async function createWorkspaceZip(dir: string): Promise<Buffer> {
  const ig = ignore().add(DEFAULT_IGNORES);

  // Load .gitignore if exists
  try {
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8');
    ig.add(gitignore);
  } catch {}

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Walk directory and add files
    walkDir(dir, dir, ig, archive);
    archive.finalize();
  });
}

function walkDir(baseDir: string, currentDir: string, ig: ignore.Ignore, archive: archiver.Archiver) {
  // Recursive walk, check ig.ignores(relativePath), add to archive
}

export async function uploadWorkspace(
  uploadURL: string,
  token: string,
  machineID: string
): Promise<void> {
  const cwd = process.cwd();
  const zipData = await createWorkspaceZip(cwd);

  if (zipData.length > MAX_UPLOAD_SIZE) {
    throw new Error(`Workspace too large (${zipData.length} bytes, max ${MAX_UPLOAD_SIZE})`);
  }

  console.log(`Uploading ${zipData.length} bytes to ${uploadURL}`);

  const response = await fetch(uploadURL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'fly-force-instance-id': machineID,
    },
    body: zipData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} - ${text}`);
  }
}
```

### Phase 7: Sync-back (0.5 days)

Port from `internal/cli/syncback.go`:

```typescript
// src/lib/syncback.ts
import { writeFileSync, unlinkSync, mkdirSync, renameSync } from 'fs';
import { join, dirname, normalize, isAbsolute, sep } from 'path';
import { tmpdir } from 'os';

export function applyRemoteFileChange(msg: FileChangeMessage): void {
  // Validate path (no absolute, no traversal)
  const rel = normalize(msg.path.replace(/^\.\//, ''));

  if (!rel || rel === '.') return;
  if (isAbsolute(rel)) {
    console.error(`sync-back rejected absolute path: ${rel}`);
    return;
  }
  if (rel === '..' || rel.startsWith('..' + sep)) {
    console.error(`sync-back rejected traversal path: ${rel}`);
    return;
  }

  const cwd = process.cwd();
  const destPath = join(cwd, rel);

  // Ensure destPath is within cwd
  if (!destPath.startsWith(cwd + sep) && destPath !== cwd) {
    console.error(`sync-back rejected path outside base: ${destPath}`);
    return;
  }

  try {
    if (msg.action === 'delete') {
      unlinkSync(destPath);
    } else if (msg.action === 'write') {
      const content = Buffer.from(msg.content || '', 'base64');
      mkdirSync(dirname(destPath), { recursive: true });

      // Atomic write via temp file
      const tmpPath = join(dirname(destPath), `.catty-sync-${Date.now()}`);
      writeFileSync(tmpPath, content, { mode: msg.mode || 0o644 });
      renameSync(tmpPath, destPath);
    }
  } catch (err) {
    // Best-effort, don't break terminal
  }
}
```

### Phase 8: CLI Commands (1 day)

#### 8.1 Entry Point (`src/index.ts`)

```typescript
#!/usr/bin/env node
import { program } from 'commander';
import { newCommand } from './commands/new';
import { connectCommand } from './commands/connect';
import { listCommand } from './commands/list';
import { stopCommand } from './commands/stop';
import { stopAllCommand } from './commands/stopall';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { versionCommand } from './commands/version';

const VERSION = '__VERSION__'; // Replaced at build time

program
  .name('catty')
  .description('Catty - Remote AI agent sessions')
  .option('--api <url>', 'API server address')
  .version(VERSION);

program.addCommand(newCommand);
program.addCommand(connectCommand);
program.addCommand(listCommand);
program.addCommand(stopCommand);
program.addCommand(stopAllCommand.hideHelp()); // Hidden dangerous command
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(versionCommand);

program.parse();
```

#### 8.2 Login Command (`src/commands/login.ts`)

```typescript
import { Command } from 'commander';
import open from 'open';

export const loginCommand = new Command('login')
  .description('Log in to Catty')
  .action(async () => {
    if (isLoggedIn()) {
      const creds = loadCredentials();
      console.log(`Already logged in as ${creds?.email}`);
      console.log("Run 'catty logout' to log out first");
      return;
    }

    const apiAddr = getAPIAddr();
    console.log('Starting login...');

    // Step 1: Start device auth flow
    const authResp = await fetch(`${apiAddr}/v1/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const auth = await authResp.json();

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
      const token = await tokenResp.json();

      if (token.pending) continue;
      if (token.error) throw new Error(token.error);

      if (token.access_token) {
        saveCredentials({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          user_id: token.user?.id,
          email: token.user?.email,
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
```

#### 8.3 New Command (`src/commands/new.ts`)

```typescript
import { Command } from 'commander';

export const newCommand = new Command('new')
  .description('Start a new remote agent session')
  .option('--agent <name>', 'Agent to use: claude or codex', 'claude')
  .option('--no-upload', "Don't upload current directory")
  .option('--no-sync-back', 'Disable sync-back')
  .action(async (opts) => {
    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(getAPIAddr());

    console.log('Creating session...');

    let session: CreateSessionResponse;
    try {
      session = await client.createSession({
        agent: opts.agent,
        cmd: opts.agent === 'claude' ? ['claude-wrapper'] : ['codex'],
        region: 'iad',
        cpus: 1,
        memory_mb: 1024,
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
      const uploadURL = session.connect_url
        .replace('wss://', 'https://')
        .replace('ws://', 'http://')
        .replace('/connect', '/upload');

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
```

#### 8.4 Connect Command (`src/commands/connect.ts`)

```typescript
import { Command } from 'commander';

export const connectCommand = new Command('connect')
  .description('Reconnect to an existing session')
  .argument('<label>', 'Session label (e.g., brave-tiger-1234)')
  .option('--sync-back', 'Sync remote file changes back to local', true)
  .option('--no-sync-back', 'Disable sync-back')
  .action(async (label, opts) => {
    if (!isLoggedIn()) {
      console.error("Not logged in. Please run 'catty login' first.");
      process.exit(1);
    }

    const client = new APIClient(getAPIAddr());

    console.log(`Looking up session ${label}...`);
    const session = await client.getSession(label, true);

    if (session.status === 'stopped') {
      throw new Error(`Session ${session.label} is stopped`);
    }
    if (session.machine_state && session.machine_state !== 'started') {
      throw new Error(`Machine is not running (state: ${session.machine_state})`);
    }

    console.log(`Reconnecting to ${session.label}...`);

    await connectToSession({
      connectURL: session.connect_url,
      connectToken: session.connect_token!,
      headers: { 'fly-force-instance-id': session.machine_id },
      syncBack: opts.syncBack,
    });
  });
```

#### 8.5 List Command (`src/commands/list.ts`)

```typescript
import { Command } from 'commander';

export const listCommand = new Command('list')
  .aliases(['ls'])  // Support 'catty ls' alias
  .description('List all sessions')
  .action(async () => {
    const client = new APIClient(getAPIAddr());
    const sessions = await client.listSessions();

    if (sessions.length === 0) {
      console.log('No sessions found');
      return;
    }

    // Simple table output (no external dependency needed)
    const header = 'LABEL                  STATUS    REGION  CREATED';
    console.log(header);
    for (const s of sessions) {
      const age = formatAge(new Date(s.created_at));
      const row = [
        s.label.padEnd(22),
        s.status.padEnd(9),
        s.region.padEnd(7),
        age,
      ].join(' ');
      console.log(row);
    }
  });

// Human-readable time ago formatting
function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

#### 8.6 Stop Command (`src/commands/stop.ts`)

```typescript
import { Command } from 'commander';

export const stopCommand = new Command('stop')
  .description('Stop a session')
  .argument('<label>', 'Session ID or label')
  .option('--delete', 'Delete the machine after stopping', false)
  .action(async (label, opts) => {
    const client = new APIClient(getAPIAddr());

    await client.stopSession(label, opts.delete);

    if (opts.delete) {
      console.log(`Session ${label} stopped and deleted`);
    } else {
      console.log(`Session ${label} stopped`);
    }
  });
```

#### 8.7 Stop All Command (`src/commands/stopall.ts`)

```typescript
import { Command } from 'commander';

export const stopAllCommand = new Command('stop-all-sessions-dangerously')
  .description('Stop and delete ALL sessions')
  .option('--yes-i-mean-it', 'Confirm you want to stop all sessions', false)
  .action(async (opts) => {
    if (!opts.yesIMeanIt) {
      throw new Error('Must pass --yes-i-mean-it to confirm');
    }

    const client = new APIClient(getAPIAddr());
    const sessions = await client.listSessions();

    if (sessions.length === 0) {
      console.log('No sessions to stop');
      return;
    }

    console.log(`Stopping ${sessions.length} sessions...`);

    for (const s of sessions) {
      process.stdout.write(`  Stopping ${s.session_id}... `);
      try {
        await client.stopSession(s.session_id, true);
        console.log('done');
      } catch (err) {
        console.log(`ERROR: ${err}`);
      }
    }
  });

// Note: This command should be hidden from --help
// In index.ts: program.addCommand(stopAllCommand.hideHelp());
```

#### 8.8 Logout Command (`src/commands/logout.ts`)

```typescript
import { Command } from 'commander';

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
```

#### 8.9 Version Command (`src/commands/version.ts`)

```typescript
import { Command } from 'commander';

// VERSION is replaced at build time by tsup
declare const __VERSION__: string;

export const versionCommand = new Command('version')
  .description('Print the version number')
  .action(() => {
    console.log(__VERSION__);
  });
```

### Phase 9: Build & Package (0.5 days)

#### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

#### tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  clean: true,
  minify: true,
  sourcemap: true,
  define: {
    '__VERSION__': JSON.stringify(process.env.npm_package_version || 'dev'),
  },
});
```

#### bin/catty.js

```javascript
#!/usr/bin/env node
require('../dist/index.js');
```

#### package.json scripts

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "prepublishOnly": "npm run build"
  }
}
```

---

## Testing Strategy

### Manual Testing Checklist

**Commands:**
- [ ] `catty login` - Complete device auth flow
- [ ] `catty new` - Create session, upload workspace, connect
- [ ] `catty new --no-upload` - Skip workspace upload
- [ ] `catty new --no-sync-back` - Disable sync-back
- [ ] `catty new --agent codex` - Use codex agent
- [ ] `catty connect <label>` - Reconnect to existing session
- [ ] `catty connect <label> --no-sync-back` - Reconnect without sync
- [ ] `catty list` - Show sessions with formatting
- [ ] `catty ls` - Alias for list
- [ ] `catty stop <label>` - Stop a session
- [ ] `catty stop <label> --delete` - Stop and delete machine
- [ ] `catty logout` - Remove credentials
- [ ] `catty version` - Print version
- [ ] `catty --help` - Show help (stopall should be hidden)
- [ ] `catty stop-all-sessions-dangerously` - Should fail without flag
- [ ] `catty stop-all-sessions-dangerously --yes-i-mean-it` - Stop all

**Terminal Behavior:**
- [ ] Terminal resize while connected (resize message sent)
- [ ] Ctrl+C handling in raw mode (terminal restored)
- [ ] Process exit code passed through from remote
- [ ] Connection replaced message (1008 close code)

**Sync & Upload:**
- [ ] Workspace zip respects .gitignore
- [ ] Sync-back file creation
- [ ] Sync-back file modification
- [ ] Sync-back file deletion
- [ ] Sync-back rejects path traversal (../)
- [ ] Upload size limit enforced (>100MB fails)

**Auth & Errors:**
- [ ] Quota exceeded → browser opens checkout
- [ ] Token refresh on 401
- [ ] Expired token with no refresh → prompts re-login
- [ ] Already logged in message

### Edge Cases

- [ ] Not a terminal (piped input)
- [ ] Large workspace (>100MB)
- [ ] Network interruption during session
- [ ] Invalid/expired credentials
- [ ] Session already stopped

---

## Migration Plan

1. **Develop in `CLI-ts/`** alongside existing Go CLI
2. **Test thoroughly** against production API
3. **Update npm package** to use TypeScript version:
   - Remove postinstall binary download
   - Point bin to compiled JS
4. **Publish new version** to npm
5. **Archive Go CLI code** (keep for reference, executor still uses Go)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Terminal handling edge cases | Test on macOS, Linux; handle Windows gracefully (fail with clear message) |
| WebSocket reconnect behavior | Match Go behavior exactly, test thoroughly |
| Large zip memory usage | Use streaming archiver (already planned) |
| Node.js version compatibility | Target Node 18+ (native fetch), document in package.json engines |
| Credentials file permissions | Use `mode: 0o600` on write, verify on all platforms |
| Signal handling on Windows | SIGINT works, SIGTERM may not - handle gracefully |
| Binary vs text WebSocket frames | `ws` library handles this, but test with actual executor |

## Implementation Notes

### Behavioral Parity Checklist

These behaviors must match the Go implementation exactly:

1. **Credential storage**: `~/.catty/credentials.json` with 0600 permissions
2. **API timeout**: 120 seconds for session creation (machines take time to start)
3. **WebSocket timeouts**: 10s write, 60s read (must be > 25s ping interval)
4. **Sync-back ack warning**: Show after 2 seconds if no ack received
5. **Exit on connection replace**: Close code 1008 is clean termination
6. **Upload URL conversion**: `wss://` → `https://`, `/connect` → `/upload`
7. **Token refresh**: On 401, try refresh once, then retry original request
8. **Default ignores**: Must match Go's list exactly (node_modules, .git, .env, etc.)

### Error Messages

Keep error messages consistent with Go for user familiarity:
- `"Not logged in. Please run 'catty login' first."`
- `"Session {label} is stopped"`
- `"Machine is not running (state: {state})"`
- `"Workspace too large ({size} bytes, max {max})"`

---

## Success Criteria

1. `npm install -g @diggerhq/catty` completes in <5 seconds
2. All existing CLI functionality works identically
3. No native module compilation required
4. Works on macOS (Intel + ARM) and Linux (x64 + ARM64)
5. Package size <500KB (vs ~15MB Go binary)
