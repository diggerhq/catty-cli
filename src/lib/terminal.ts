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

    // Ensure terminal is restored on process exit
    const cleanup = () => this.restore();

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
    if (this.cleanupDone) return;
    if (this.wasRaw && process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors during cleanup
      }
      this.wasRaw = false;
    }
    this.cleanupDone = true;
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
