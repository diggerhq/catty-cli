import type { SessionInfo } from '../types/index.js';
import * as readline from 'readline';

const PAGE_SIZE = 10;

/**
 * Human-readable time ago formatting
 */
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

/**
 * Format a session for display in the picker
 */
function formatSession(session: SessionInfo): string {
  const age = formatAge(new Date(session.created_at));
  const statusColor =
    session.status === 'running'
      ? '\x1b[32m'
      : session.status === 'stopped'
        ? '\x1b[31m'
        : '\x1b[33m';
  const reset = '\x1b[0m';

  return `${session.label.padEnd(24)} ${statusColor}${session.status.padEnd(10)}${reset} ${session.region.padEnd(8)} ${age}`;
}

/**
 * Interactive session picker using arrow keys with pagination
 * Returns the selected session or null if cancelled
 */
export async function pickSession(
  sessions: SessionInfo[]
): Promise<SessionInfo | null> {
  if (sessions.length === 0) {
    console.log('No sessions found.');
    return null;
  }

  // Sort by created_at descending (most recent first)
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (sortedSessions.length === 0) {
    console.log('No sessions available.');
    return null;
  }

  return new Promise((resolve) => {
    let selectedIndex = 0;
    let currentPage = 0;
    const items = sortedSessions;
    const totalPages = Math.ceil(items.length / PAGE_SIZE);

    const getPageItems = () => {
      const start = currentPage * PAGE_SIZE;
      return items.slice(start, start + PAGE_SIZE);
    };

    const render = () => {
      const pageItems = getPageItems();

      // Move cursor up to redraw - always use PAGE_SIZE + 2 for consistent layout
      const linesToClear = PAGE_SIZE + 2;
      process.stdout.write(`\x1b[${linesToClear}A`);

      // Header with page indicator
      const pageInfo =
        totalPages > 1 ? ` \x1b[2m(page ${currentPage + 1}/${totalPages})\x1b[0m` : '';
      console.log(
        `\x1b[1mSelect a session to connect:\x1b[0m${pageInfo}                              `
      );

      // Items - always render PAGE_SIZE lines for consistent height
      for (let i = 0; i < PAGE_SIZE; i++) {
        if (i < pageItems.length) {
          const prefix = i === selectedIndex ? '\x1b[36m❯ ' : '  ';
          const suffix = i === selectedIndex ? '\x1b[0m' : '';
          console.log(
            `${prefix}${formatSession(pageItems[i])}${suffix}                    `
          );
        } else {
          // Empty line to maintain consistent height
          console.log('                                                                    ');
        }
      }

      // Instructions
      const navHint = totalPages > 1 ? '←/→ pages, ' : '';
      console.log(
        `\x1b[2m${navHint}↑/↓ navigate, Enter select, q/Esc cancel\x1b[0m                  `
      );
    };

    // Initial render - print placeholder lines first
    for (let i = 0; i < PAGE_SIZE + 2; i++) {
      console.log('');
    }

    render();

    // Set up raw mode for keyboard input
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
    }

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeListener('keypress', onKeypress);
    };

    const onKeypress = (
      _str: string,
      key: { name: string; ctrl: boolean; sequence: string }
    ) => {
      if (!key) return;

      const pageItems = getPageItems();

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        selectedIndex = Math.min(pageItems.length - 1, selectedIndex + 1);
        render();
      } else if (key.name === 'left' || key.name === 'h') {
        // Previous page
        if (currentPage > 0) {
          currentPage--;
          selectedIndex = 0;
          render();
        }
      } else if (key.name === 'right' || key.name === 'l') {
        // Next page
        if (currentPage < totalPages - 1) {
          currentPage++;
          selectedIndex = 0;
          render();
        }
      } else if (key.name === 'return') {
        cleanup();
        resolve(pageItems[selectedIndex]);
      } else if (
        key.name === 'escape' ||
        key.name === 'q' ||
        (key.ctrl && key.name === 'c')
      ) {
        cleanup();
        if (key.ctrl && key.name === 'c') {
          console.log('');
          process.exit(130);
        }
        resolve(null);
      }
    };

    process.stdin.on('keypress', onKeypress);
    process.stdin.resume();
  });
}
