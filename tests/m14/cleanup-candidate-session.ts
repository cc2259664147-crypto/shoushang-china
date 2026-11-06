/** Revokes every session for one stopped, isolated candidate administrator and proves a fresh session can be logged out. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Envelope = { ok: boolean; value: Record<string, unknown> };
const isolatedRoot = resolve(process.argv[2] ?? '');
const username = process.argv[3] ?? '';
const evidence = resolve(process.argv[4] ?? '');
assert(isolatedRoot && username && evidence, 'isolated root, username and evidence directory are required');
assert(!existsSync(evidence), `Evidence directory exists: ${evidence}`);
mkdirSync(evidence, { recursive: true });
const databasePath = join(isolatedRoot, 'content.sqlite');
const entry = resolve('apps/api/dist/server.js');
const cli = resolve('apps/api/dist/admin/maintenance.js');
for (const path of [databasePath, entry, cli]) assert(existsSync(path), `Missing ${path}`);

function activeSessions(): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT count(*) count FROM admin_sessions s JOIN admin_accounts a ON a.id=s.account_id
      WHERE a.username=? AND s.revoked=0 AND s.expires_at>? AND s.auth_version=a.auth_version AND a.disabled=0`).get(username, Date.now()) as { count: number };
    return Number(row.count);
  } finally { db.close(); }
}

async function main(): Promise<void> {
const before = activeSessions();
const password = randomBytes(32).toString('base64url');
const reset = spawnSync(process.execPath, [cli, 'reset-password', databasePath, username, 'admin'], {
  input: `${password}\n${password}\n`, encoding: 'utf8', windowsHide: true, timeout: 30000,
});
assert.equal(reset.status, 0, 'maintenance password reset failed');
const afterReset = activeSessions();
assert.equal(afterReset, 0, 'password reset must revoke all old sessions');

const origin = 'http://127.0.0.1:5198';
const env = { ...process.env, CONTENT_DATABASE_PATH: databasePath, ADMIN_MEDIA_ROOT: join(isolatedRoot, 'media'), ADMIN_BACKUP_ROOT: join(isolatedRoot, 'backups'), ADMIN_ENABLED: '1', ADMIN_ORIGIN: origin, ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '0' };
const wrapper = join(isolatedRoot, 'session-cleanup-server.mjs');
writeFileSync(wrapper, `import { startServer } from ${JSON.stringify(pathToFileURL(entry).href)};\nconst app=await startServer();\nprocess.stdin.resume();\nprocess.stdin.once('end',()=>void app.close().then(()=>process.exit(0)));\n`);
const child = spawn(process.execPath, [wrapper], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const output: string[] = [];
const url = await new Promise<string>((accept, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error('API startup timeout')); }, 20000);
  const consume = (chunk: Buffer) => { output.push(chunk.toString()); const match = /API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output.join('')); if (match) { clearTimeout(timer); accept(match[1]!); } };
  child.stdout.on('data', consume); child.stderr.on('data', consume); child.once('error', reject);
});
async function json(response: Response): Promise<Envelope> { return await response.json() as Envelope; }
const challenge = await fetch(`${url}/api/v1/admin/csrf`, { headers: { origin } });
assert.equal(challenge.status, 200);
const challengeBody = await json(challenge);
const challengeCookie = challenge.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const login = await fetch(`${url}/api/v1/admin/session`, { method: 'POST', headers: { origin, cookie: challengeCookie, 'x-csrf-token': String(challengeBody.value.csrfToken), 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
assert.equal(login.status, 200);
const loginBody = await json(login);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const csrf = String(loginBody.value.csrfToken);
assert.equal((await fetch(`${url}/api/v1/admin/session`, { headers: { cookie } })).status, 200);
assert.equal((await fetch(`${url}/api/v1/admin/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } })).status, 204);
const rejectedAfterLogout = (await fetch(`${url}/api/v1/admin/session`, { headers: { cookie } })).status;
assert.equal(rejectedAfterLogout, 401);
const stopped = await new Promise<boolean>((accept, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error('API graceful stop timeout')); }, 20000);
  child.once('exit', code => { clearTimeout(timer); accept(code === 0); }); child.stdin.end();
});
assert.equal(stopped, true);
const finalActiveSessions = activeSessions();
assert.equal(finalActiveSessions, 0);
writeFileSync(join(evidence, 'session-cleanup.json'), JSON.stringify({ notice: '隔离候选环境会话收尾，不是正式账号或人工审批', isolatedRoot, username, oldActiveSessionsObserved: before, activeAfterPasswordReset: afterReset, freshSessionLogoutStatus: 204, freshSessionRejectedAfterLogout: rejectedAfterLogout, finalActiveSessions, serverStopped: stopped }, null, 2));
writeFileSync(join(evidence, 'README.md'), `# M14-4 隔离会话收尾证据\n\n通过既有维护入口重置最后一个隔离管理员的随机密码，撤销其全部旧会话；随后使用正常 HTTP 登录/注销流程确认新会话返回401，并正常停止服务。密码、Cookie、CSRF 和 token 未写入证据或仓库。\n`);
console.log(JSON.stringify({ evidence, before, afterReset, rejectedAfterLogout, finalActiveSessions, stopped }));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
