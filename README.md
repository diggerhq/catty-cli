# Catty

Run Claude Code sessions in the cloud.

Catty spins up isolated Claude Code environments on-demand, syncs your local workspace, and streams the terminal to your machine. Work with Claude Code as if it's running locally, but with cloud persistence.

## Quick Start

```bash
# Install
npm install -g @diggerhq/catty

# Login (one-time)
catty login

# Start a session in your project
cd your-project
catty new
```

That's it. Your files sync to the cloud, and you can download them anytime.

## Why Catty?

- **Sessions persist** - Start at work, reconnect from home. Sessions keep running until you stop them.
- **Cloud persistence** - Workspaces auto-save to the cloud. Download anytime with `catty download`.
- **Git integration** - Add your GitHub token once, Claude can clone, push, and create PRs.
- **Native terminal** - Full PTY streaming means colors, vim, and interactive prompts all work.

## Commands

```bash
catty login                  # Authenticate (one-time)
catty logout                 # Remove stored credentials

catty new                    # Start a new session (uploads current directory)
catty new --no-upload        # Start without uploading workspace
catty new --enable-prompts   # Enable permission prompts (default: auto-approve)

catty connect <label>        # Reconnect to an existing session
catty list                   # List your sessions
catty stop <label>           # Stop a session
catty download <label>       # Download workspace to local directory

catty secrets add github     # Add GitHub token (interactive)
catty secrets list           # List configured secrets
catty secrets remove <name>  # Remove a secret

catty update                 # Update to latest version
catty version                # Print version
```

## What Gets Synced

When you run `catty new`, your current directory is zipped and uploaded. These are automatically excluded:

- `.git/` directory
- `node_modules/`
- Python virtual environments (`.venv`, `venv`)
- `.env` files
- Anything in your `.gitignore`

Maximum upload size: 100MB

## Secrets

Store secrets locally (encrypted) and they're automatically available in your sessions:

```bash
catty secrets add github     # Guided GitHub token setup
catty secrets set MY_KEY xyz # Set any secret
```

Secrets are passed as environment variables. With a GitHub token configured, Claude can use `git` and `gh` CLI to clone repos, push commits, and create PRs.

## File Upload

Drag and drop file paths into your terminal to upload images and documents to the session. Files are uploaded to `/workspace/.catty-uploads/` and can be referenced by Claude.

## Auto-Reconnect

If your connection drops, Catty automatically attempts to reconnect (up to 5 times). Use `--no-auto-reconnect` to disable this behavior.

## Requirements

- Node.js 18+
- macOS (Intel or Apple Silicon) or Linux (x64 or ARM64)

## Documentation

Full documentation: [docs.catty.dev](https://docs.catty.dev)

## License

MIT
