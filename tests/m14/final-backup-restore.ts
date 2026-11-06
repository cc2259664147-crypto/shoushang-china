/** M14-5 isolated joint backup/restore acceptance. Never targets a normal or production database. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { ContentDatabase } from '../../apps/api/src/database';
import { PublicContentService } from '../../apps/api/src/content';
import { countActiveSessions } from './session-count';

type Json = Record<string, unknown>;
type Session = { cookie: string; csrf: string };
const source = resolve(process.argv[2] ?? '');
const evidence = resolve(process.argv[3] ?? '');
const rel = relative(tmpdir(), source);
if (!isAbsolute(process.argv[2] ?? '') || !rel.startsWith('m14-4-') || rel.includes('..') || !existsSync(join(source, 'content.sqlite')))
  throw new Error('Explicit existing M14 candidate root under the system temporary directory required');
if (!isAbsolute(process.argv[3] ?? '') || existsSync(evidence)) throw new Error('Explicit new evidence directory required');
mkdirSync(evidence, { recursive: true });
const database = join(source, 'content.sqlite'), media = join(source, 'media'), backups = join(source, 'backups');
const restored = join(tmpdir(), `m14-5-restored-${randomUUID()}`);
const entry = resolve('apps/api/dist/server.js'), cli = resolve('apps/api/dist/admin/maintenance.js');
const origin = 'http://127.0.0.1:5214';
const raw = new DatabaseSync(database);
const account = String(raw.prepare("SELECT username FROM admin_accounts WHERE role='admin' AND disabled=0 ORDER BY rowid DESC LIMIT 1").get()?.username ?? '');
raw.close();
assert(account, 'No enabled isolated administrator');
const password = randomBytes(32).toString('base64url');
const reset = spawnSync(process.execPath, [cli, 'reset-password', database, account, 'admin'], { input: `${password}\n${password}\n`, encoding: 'utf8', windowsHide: true, timeout: 30000 });
assert.equal(reset.status, 0, 'Controlled password reset failed');
const wrapper = join(source, 'm14-5-backup-server.mjs');
writeFileSync(wrapper, `import {startServer} from ${JSON.stringify(pathToFileURL(entry).href)};const app=await startServer();process.stdin.resume();process.stdin.once('end',()=>void app.close().then(()=>process.exit(0)));`);
const env = { ...process.env, CONTENT_DATABASE_PATH: database, ADMIN_MEDIA_ROOT: media, ADMIN_BACKUP_ROOT: backups, ADMIN_ENABLED: '1', ADMIN_ORIGIN: origin, ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '0' };
async function start(): Promise<{ child: ChildProcessWithoutNullStreams; url: string }> {
  const child = spawn(process.execPath, [wrapper], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const url = await new Promise<string>((ok, fail) => { let out = ''; const timer = setTimeout(() => fail(new Error('API startup timeout')), 20000); child.stdout.on('data', (b: Buffer) => { out += b.toString(); const m = /API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(out); if (m) { clearTimeout(timer); ok(m[1]!); } }); child.once('error', fail); child.once('exit', c => fail(new Error(`API exited ${String(c)}`))); });
  return { child, url };
}
async function stop(child: ChildProcessWithoutNullStreams): Promise<void> { const done = new Promise<void>((ok, fail) => { const timer = setTimeout(() => { child.kill(); fail(new Error('Graceful stop timeout')); }, 20000); child.once('exit', c => { clearTimeout(timer); c === 0 ? ok() : fail(new Error(`Stop ${String(c)}`)); }); }); child.stdin.end(); await done; }
async function json(response: Response): Promise<Json> { const v = await response.json() as Json; assert.equal(v.ok, true); return v.value as Json; }
async function login(url: string): Promise<Session> { const c = await fetch(`${url}/api/v1/admin/csrf`, { headers: { origin } }); assert.equal(c.status, 200); const cv = await json(c); const cc = c.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); const r = await fetch(`${url}/api/v1/admin/session`, { method: 'POST', headers: { origin, cookie: cc, 'x-csrf-token': String(cv.csrfToken), 'content-type': 'application/json' }, body: JSON.stringify({ username: account, password }) }); assert.equal(r.status, 200); const rv = await json(r); return { cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '), csrf: String(rv.csrfToken) }; }
async function admin(url: string, path: string, method: string, session: Session, body?: unknown, idempotent = false): Promise<Response> { return fetch(url + path, { method, headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotent ? { 'idempotency-key': randomUUID() } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

async function main(): Promise<void> {
let server: Awaited<ReturnType<typeof start>> | undefined; let session: Session | undefined;
try {
const started = performance.now(); server = await start(); session = await login(server.url);
const queued = await admin(server.url, '/api/v1/admin/backups', 'POST', session, { reason: 'M14-5 isolated candidate joint backup acceptance' }, true);
assert.equal(queued.status, 202); const q = await json(queued); const jobId = String(q.jobId ?? q.id ?? ''); assert(jobId);
let state = ''; for (let i = 0; i < 120; i++) { const r = await admin(server.url, `/api/v1/admin/backups/${jobId}`, 'GET', session); assert.equal(r.status, 200); state = String((await json(r)).state); if (state === 'succeeded' || state === 'failed') break; await new Promise(ok => setTimeout(ok, 250)); }
assert.equal(state, 'succeeded'); const backupMs = performance.now() - started;
assert.equal((await admin(server.url, '/api/v1/admin/session', 'DELETE', session)).status, 204);
assert.equal((await admin(server.url, '/api/v1/admin/session', 'GET', session)).status, 401);
session = undefined; await stop(server.child); server = undefined;
const backup = join(backups, jobId), manifestPath = join(backup, 'manifest.json'); assert(existsSync(manifestPath));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { databaseHash: string; files: { key: string; file: string; hash: string }[] };
assert.equal(createHash('sha256').update(readFileSync(join(backup, 'content.sqlite'))).digest('hex'), manifest.databaseHash);
for (const file of manifest.files) { const bytes = readFileSync(join(backup, file.key, file.file)); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.hash); }
const restoreStarted = performance.now(); const restore = spawnSync(process.execPath, [cli, 'restore', backup, restored, '--all-hosts-stopped'], { encoding: 'utf8', windowsHide: true, timeout: 120000 }); assert.equal(restore.status, 0, 'Built restore command failed'); const restoreMs = performance.now() - restoreStarted;
const restoredRaw = new DatabaseSync(join(restored, 'content.sqlite'));
const accountCounts = { enabledAccounts: Number(restoredRaw.prepare('SELECT count(*) n FROM admin_accounts WHERE disabled=0').get()?.n), activeSessions: countActiveSessions(restoredRaw) };
restoredRaw.close();
const restoredDb = new ContentDatabase({ path: join(restored, 'content.sqlite') }); const snapshot = new PublicContentService(restoredDb).snapshot(); restoredDb.close();
const counts = { ...accountCounts, exhibits: snapshot.exhibits.length, stories: snapshot.stories.length, templates: snapshot.templates.length };
assert.deepEqual(counts, { enabledAccounts: 0, activeSessions: 0, exhibits: 12, stories: 3, templates: 3 });
const sourceRaw = new DatabaseSync(database); const activeSourceSessions = countActiveSessions(sourceRaw); sourceRaw.close(); assert.equal(activeSourceSessions, 0);
const report = { notice: '自动化隔离技术验证，非人工批准或生产恢复演练', source, backupDirectory: backup, restoredDirectory: restored, jobId, manifest: basename(manifestPath), manifestFiles: manifest.files.length, hashesVerified: manifest.files.length, backupMilliseconds: backupMs, restoreMilliseconds: restoreMs, restored: counts, sourceActiveSessions: activeSourceSessions, serviceStopped: true, formalPublication: 0 };
writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report) + '\n');
} finally {
  if (server && session) { try { await admin(server.url, '/api/v1/admin/session', 'DELETE', session); } catch { /* offline reset below is authoritative */ } }
  if (server) { try { await stop(server.child); } catch { server.child.kill(); } }
  // The controlled reset is safe with the service stopped and revokes every session for the retained last administrator.
  const cleanup = spawnSync(process.execPath, [cli, 'reset-password', database, account, 'admin'], { input: `${password}\n${password}\n`, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(cleanup.status, 0, 'Failed to revoke sessions during final cleanup');
  const check = new DatabaseSync(database, { readOnly: true }); const active = countActiveSessions(check); check.close(); assert.equal(active, 0, 'Active source session remained after cleanup');
}
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
