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

That's it. Your files sync to the cloud, and any changes Claude makes sync back in real-time.

## Why Catty?

- **Sessions persist** - Start at work, reconnect from home. Sessions keep running until you stop them.
- **Two-way sync** - Your workspace uploads automatically, changes sync back in real-time.
- **Native terminal** - Full PTY streaming means colors, vim, and interactive prompts all work.
- **Multiple sessions** - Run parallel sessions for different projects or tasks.

## Commands

```bash
catty login                  # Authenticate (one-time)
catty logout                 # Remove stored credentials

catty new                    # Start a new session (uploads current directory)
catty new --no-upload        # Start without uploading workspace
catty new --no-sync-back     # Disable sync-back of remote changes
catty new --enable-prompts   # Enable permission prompts (default: auto-approve)

catty connect <label>        # Reconnect to an existing session
catty list                   # List your sessions
catty stop <label>           # Stop a session

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

## File Upload

Drag and drop file paths into your terminal to upload images and documents to the session:

- **Images**: PNG, JPG, GIF, WEBP, BMP, SVG
- **Documents**: PDF, TXT, MD, JSON, XML, CSV

Files are uploaded to `/workspace/.catty-uploads/` and can be referenced by Claude.

## Auto-Reconnect

If your connection drops, Catty automatically attempts to reconnect (up to 5 times). Use `--no-auto-reconnect` to disable this behavior.

## Requirements

- Node.js 18+
- macOS (Intel or Apple Silicon) or Linux (x64 or ARM64)

## Documentation

Full documentation: [docs.catty.dev](https://docs.catty.dev)

## License

MIT
