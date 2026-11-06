import type { DatabaseSync } from 'node:sqlite';

/** Admin session expiries are Unix milliseconds; SQL datetime strings are a different domain. */
export function countActiveSessions(database: DatabaseSync, now = Date.now()): number {
  return Number(database.prepare('SELECT count(*) n FROM admin_sessions WHERE revoked=0 AND expires_at > ?').get(now)?.n);
}
