import { Command } from 'commander';
import { getAPIAddr } from '../lib/config.js';
import { APIClient } from '../lib/api-client.js';

export const listCommand = new Command('list')
  .aliases(['ls'])
  .description('List all sessions')
  .action(async function (this: Command) {
    const apiAddr = getAPIAddr(this.optsWithGlobals().api);
    const client = new APIClient(apiAddr);

    const sessions = await client.listSessions();

    if (sessions.length === 0) {
      console.log('No sessions found');
      return;
    }

    // Simple table output
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
