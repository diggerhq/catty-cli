# Catty CLI - Agent Reference

TypeScript CLI for Catty. Runs Claude Code sessions in the cloud, streams PTY to local terminal.

**Commits:** One-liners only. Example: `Fix upload timeout in workspace sync`

**Time estimates:** Never include them. Focus on what, not when.

---

## Project Structure

```
catty-cli/
├── src/
│   ├── index.ts              # Entry point, CLI setup with commander
│   ├── commands/             # CLI commands
│   │   ├── new.ts            # catty new - create session
│   │   ├── connect.ts        # catty connect - reconnect to session
│   │   ├── list.ts           # catty list - show sessions
│   │   ├── stop.ts           # catty stop - stop session
│   │   ├── stopall.ts        # catty stopall - stop all sessions
│   │   ├── login.ts          # catty login - device auth flow
│   │   ├── logout.ts         # catty logout - remove credentials
│   │   ├── secrets.ts        # catty secrets - manage session secrets
│   │   ├── sync.ts           # catty sync - manual workspace sync
│   │   ├── download.ts       # catty download - download workspace
│   │   ├── update.ts         # catty update - self-update
│   │   └── version.ts        # catty version
│   ├── lib/
│   │   ├── api-client.ts     # HTTP client with auth token refresh
│   │   ├── auth.ts           # Credential storage (~/.catty/)
│   │   ├── config.ts         # Constants and helpers
│   │   ├── terminal.ts       # Raw mode, resize, signal handling
│   │   ├── websocket.ts      # WebSocket connection + PTY streaming
│   │   ├── workspace.ts      # Zip creation + upload
│   │   ├── syncback.ts       # Apply remote file changes locally
│   │   ├── secrets.ts        # Local secrets file management (~/.catty/secrets.json)
│   │   ├── file-upload.ts    # Image/document upload via drag-drop
│   │   └── version-checker.ts # Auto-update checking
│   ├── protocol/
│   │   └── messages.ts       # WebSocket message types
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── docs/                     # Mintlify docs (docs.catty.dev)
│   ├── mint.json             # Mintlify config
│   └── *.mdx                 # Documentation pages
├── package.json
├── tsconfig.json
└── tsup.config.ts            # Build config
```

## Key Dependencies

- `commander` - CLI framework
- `ws` - WebSocket client
- `archiver` - Zip creation for workspace upload
- `ignore` - .gitignore parsing
- `open` - Browser opening for auth

## Build & Run

```bash
npm install
npm run build     # Compile with tsup
./bin/catty.js    # Run locally
```

## Credentials

Stored at `~/.catty/credentials.json` with 0600 permissions. Contains access token, refresh token, user ID, and email.

## Secrets

Stored at `~/.catty/secrets.json` with 0600 permissions. Key-value pairs injected as environment variables in sessions.

Commands:
- `catty secrets set KEY=value` - Add/update a secret
- `catty secrets list` - List secrets (values masked)
- `catty secrets delete KEY` - Remove a secret

## Environment Variables

- `CATTY_API_ADDR` - Override API URL (default: https://api.catty.dev)
- `CATTY_DEBUG` - Enable debug logging

## Workspace Upload

Files are zipped using `.gitignore` rules (via `ignore` library). Max upload size: 100MB.
