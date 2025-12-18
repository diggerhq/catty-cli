// Track if global handlers are registered (only register once)
let globalHandlersRegistered = false;
let activeTerminal: Terminal | null = null;

export class Terminal {
  private wasRaw = false;
  private cleanupDone = false;

  isTerminal(): boolean {
    return process.stdin.isTTY === true;
  }

  makeRaw(): void {
    if (!this.isTerminal()) return;
    if (this.wasRaw) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    this.wasRaw = true;
    activeTerminal = this;

    // Register global handlers once
    if (!globalHandlersRegistered) {
      globalHandlersRegistered = true;
      
      const cleanup = () => {
        if (activeTerminal) {
          activeTerminal.restore();
        }
      };

      // Normal exit
      process.on('exit', cleanup);

      // Ctrl+C
      process.on('SIGINT', () => {
        cleanup();
        process.exit(130); // 128 + SIGINT(2)
      });

      // Kill signal
      process.on('SIGTERM', () => {
        cleanup();
        process.exit(143); // 128 + SIGTERM(15)
      });

      // Terminal window closed (SSH disconnect, etc.)
      process.on('SIGHUP', () => {
        cleanup();
        process.exit(129); // 128 + SIGHUP(1)
      });

      // Ctrl+Z - suspend (IMPORTANT: restore terminal before suspending)
      process.on('SIGTSTP', () => {
        cleanup();
        // Re-emit SIGTSTP with default handler to actually suspend
        process.kill(process.pid, 'SIGTSTP');
      });

      // When resumed after Ctrl+Z, re-enter raw mode
      process.on('SIGCONT', () => {
        if (activeTerminal && activeTerminal.wasRaw === false && !activeTerminal.cleanupDone) {
          // Terminal was suspended, but we've already cleaned up
          // Show a message to help the user
          process.stderr.write('\r\n\x1b[33m⚠ Session suspended. Run "fg" or reconnect with "catty connect <label>"\x1b[0m\r\n');
        }
      });

      // Uncaught exceptions - restore terminal before crashing
      process.on('uncaughtException', (err) => {
        cleanup();
        process.stderr.write(`\r\n\x1b[31m✗ Unexpected error: ${err.message}\x1b[0m\r\n`);
        process.stderr.write(`\x1b[90mReconnect with: catty connect <session-label>\x1b[0m\r\n`);
        process.exit(1);
      });

      // Unhandled promise rejections
      process.on('unhandledRejection', (reason) => {
        cleanup();
        const message = reason instanceof Error ? reason.message : String(reason);
        process.stderr.write(`\r\n\x1b[31m✗ Unexpected error: ${message}\x1b[0m\r\n`);
        process.stderr.write(`\x1b[90mReconnect with: catty connect <session-label>\x1b[0m\r\n`);
        process.exit(1);
      });
    }
  }

  restore(): void {
    if (this.cleanupDone) return;
    if (this.wasRaw && process.stdin.isTTY) {
      try {
        // Reset terminal state
        process.stdin.setRawMode(false);
        // Send terminal reset sequences
        process.stdout.write('\x1b[?2004l'); // Disable bracketed paste
        process.stdout.write('\x1b[?25h');   // Show cursor (in case it was hidden)
      } catch {
        // Ignore errors during cleanup
      }
      this.wasRaw = false;
    }
    this.cleanupDone = true;
    if (activeTerminal === this) {
      activeTerminal = null;
    }
  }

  /**
   * Force reset terminal to a known good state.
   * Call this if you suspect the terminal is corrupted.
   */
  static forceReset(): void {
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      // Reset all terminal modes
      process.stdout.write('\x1b[?2004l'); // Disable bracketed paste
      process.stdout.write('\x1b[?25h');   // Show cursor
      process.stdout.write('\x1bc');       // Full terminal reset (RIS)
    } catch {
      // Best effort
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

  /**
   * Enable bracketed paste mode.
   * When enabled, pasted text is wrapped in escape sequences:
   * - Start: \x1b[200~
   * - End: \x1b[201~
   * This allows detecting drag-and-drop file paths.
   */
  enableBracketedPaste(): void {
    process.stdout.write('\x1b[?2004h');
  }

  /**
   * Disable bracketed paste mode.
   */
  disableBracketedPaste(): void {
    process.stdout.write('\x1b[?2004l');
  }
}
