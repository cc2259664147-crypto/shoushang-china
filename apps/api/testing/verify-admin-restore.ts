import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ContentDatabase } from '../src/database';

const root = resolve(process.argv[2] ?? ''), reportPath = resolve(process.argv[3] ?? '');
const withinTemp = relative(tmpdir(), root);
if (!isAbsolute(process.argv[2] ?? '') || !isAbsolute(process.argv[3] ?? '') || !withinTemp.startsWith('m13-normal-app-') || withinTemp.includes('..') || !existsSync(join(root, 'sample.png')))
  throw new Error('Explicit isolated M13 normal-app root and absolute report required');
const raw = new DatabaseSync(join(root, 'content.sqlite'));
let jobId: string;
try {
  jobId = String(raw.prepare("SELECT id FROM admin_backup_jobs WHERE state='succeeded' ORDER BY rowid DESC LIMIT 1").get()?.id ?? '');
  if (raw.prepare("SELECT disabled FROM admin_accounts WHERE username='integration-editor'").get()?.disabled !== 1)
    throw new Error('Disabled editor state did not persist after server exit');
}
finally { raw.close(); }
const original = new ContentDatabase({ path: join(root, 'content.sqlite') });
try { if (original.readPublicSnapshot().rows.some(row => row.kind === 'exhibit')) throw new Error('Takedown did not persist after server exit'); }
finally { original.close(); }
if (!jobId || !existsSync(join(root, 'backups', jobId, 'manifest.json'))) throw new Error('No completed joint backup');
const backup = join(root, 'backups', jobId), recovered = join(root, 'restored');
if (existsSync(recovered)) throw new Error('Restore destination must be new');
const child = spawnSync(process.execPath, [resolve('apps/api/dist/admin/maintenance.js'), 'restore', backup, recovered, '--all-hosts-stopped'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (child.status !== 0) throw new Error('Built offline maintenance CLI restore failed');
const db = new ContentDatabase({ path: join(recovered, 'content.sqlite') });
try {
  const status = new DatabaseSync(join(recovered, 'content.sqlite'));
  try {
    const accounts = status.prepare('SELECT count(*) n FROM admin_accounts WHERE disabled=0').get()!;
    const sessions = status.prepare('SELECT count(*) n FROM admin_sessions WHERE revoked=0').get()!;
    if (Number(accounts.n) !== 0 || Number(sessions.n) !== 0) throw new Error('Restored accounts or sessions active');
  } finally { status.close(); }
  if (db.readPublicSnapshot().rows.some(row => row.kind === 'exhibit')) throw new Error('Withdrawn exhibit unexpectedly public after restore');
} finally { db.close(); }
const mediaCount = readdirSync(join(recovered, 'media')).length;
if (!mediaCount) throw new Error('Restored media is empty');
const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')) as { files: unknown[] };
const report = { builtOfflineCli: true, normalDatabaseReopened: true, disabledEditorPersisted: true, takedownPersisted: true, freshDirectory: true, restoredDatabaseVerified: true, accountsDisabled: true, sessionsRevoked: true, withdrawnContentStillPrivate: true, mediaObjects: mediaCount, manifestFiles: manifest.files.length };
writeFileSync(reportPath, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report) + '\n');
