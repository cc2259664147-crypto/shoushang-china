import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { countActiveSessions } from './session-count';

const database = new DatabaseSync(':memory:');
database.exec('CREATE TABLE admin_sessions (digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL)');
const now = 1_800_000_000_000;
database.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run('valid', now + 60_000, 0);
database.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run('expired', now - 1, 0);
database.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run('revoked', now + 60_000, 1);
assert.equal(countActiveSessions(database, now), 1);
assert.equal(Number(database.prepare("SELECT count(*) n FROM admin_sessions WHERE revoked=0 AND expires_at > datetime('now')").get()?.n), 0, 'Regression fixture must demonstrate the old mixed-type query miscount');
database.close();
process.stdout.write('session timestamp boundary passed: one valid millisecond session counted; expired/revoked excluded\n');
