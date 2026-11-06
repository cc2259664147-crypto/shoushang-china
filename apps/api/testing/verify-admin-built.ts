import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { prepareAdminIntegration } from './prepare-admin-integration';
import sharp from 'sharp';

const reportPath = resolve(process.argv[2] ?? 'docs/api/evidence/m13-integration-20261019/built-admin.json');
const entry = resolve('apps/api/dist/server.js'), cli = resolve('apps/api/dist/admin/maintenance.js');
if (!existsSync(entry) || !existsSync(cli)) throw new Error('Built API and maintenance CLI required');
const root = mkdtempSync(join(tmpdir(), 'm13-built-normal-'));
const password = randomBytes(32).toString('base64url');
await prepareAdminIntegration(root, password);
const command = spawnSync(process.execPath, [cli, 'create-account', join(root, 'content.sqlite'), 'integration-cli', 'editor'], { input: `${password}\n${password}\n`, encoding: 'utf8', windowsHide: true, timeout: 20000 });
if (command.status !== 0) throw new Error('Built hidden-password maintenance command failed');
const wrapper = join(root, 'entry.mjs');
writeFileSync(wrapper, `import { startServer } from ${JSON.stringify(pathToFileURL(entry).href)};\nconst app = await startServer();\nprocess.stdin.resume();\nprocess.stdin.once('end', () => void app.close().then(() => process.exit(0)));\n`);
const env = { ...process.env, CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), HOST: '127.0.0.1', PORT: '0', ADMIN_ENABLED: '1', ADMIN_SECURITY_MODE: 'loopback-http', ADMIN_ORIGIN: 'http://127.0.0.1:5194', ADMIN_MEDIA_ROOT: join(root, 'media'), ADMIN_BACKUP_ROOT: join(root, 'backups') };
async function start() {
  const child = spawn(process.execPath, [wrapper], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const url = await new Promise<string>((yes, no) => {
    let output = '';
    const timer = setTimeout(() => { child.kill(); no(new Error('Built API startup timeout')); }, 15000);
    child.stdout.on('data', (b: Buffer) => { output += b.toString(); const m = /API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output); if (m) { clearTimeout(timer); yes(m[1]!); } });
    child.on('exit', () => { clearTimeout(timer); no(new Error('Built API exited during startup')); });
    child.on('error', no);
  });
  return { child, url };
}
async function close(child: ReturnType<typeof spawn>) {
  const done = new Promise<void>((yes, no) => { const timer = setTimeout(() => { child.kill(); no(new Error('Built API close timeout')); }, 15000); child.once('exit', code => { clearTimeout(timer); code === 0 ? yes() : no(new Error('Built API close failed')); }); });
  if (!child.stdin) throw new Error('Built API control channel missing');
  child.stdin.end(); await done;
}
let sessionCookie = '';
let sessionCsrf = '';
const first = await start();
try {
  if ((await fetch(`${first.url}/health`)).status !== 200 || (await fetch(`${first.url}/ready`)).status !== 200 || (await fetch(`${first.url}/api/v1/admin/contents`)).status !== 401) throw new Error('Built API endpoints invalid');
  const challenge = await fetch(`${first.url}/api/v1/admin/csrf`);
  const csrf = (await challenge.json() as { value: { csrfToken: string } }).value.csrfToken;
  const login = await fetch(`${first.url}/api/v1/admin/session`, { method: 'POST', headers: { origin: env.ADMIN_ORIGIN, cookie: challenge.headers.getSetCookie().map(x => x.split(';')[0]).join('; '), 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ username: 'integration-cli', password }) });
  if (login.status !== 200) throw new Error('Built CLI account login failed');
  sessionCsrf = (await login.json() as { value: { csrfToken: string } }).value.csrfToken;
  sessionCookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
  if ((await fetch(`${first.url}/api/v1/admin/contents`, { headers: { cookie: sessionCookie } })).status !== 200) throw new Error('Built admin session invalid');
  const bytes = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#a5232b' } }).png().toBuffer();
  const uploaded = await fetch(`${first.url}/api/v1/admin/media`, { method: 'POST', headers: { origin: env.ADMIN_ORIGIN, cookie: sessionCookie, 'x-csrf-token': sessionCsrf, 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
  if (uploaded.status !== 201) throw new Error('Built normal-server image decode/upload failed');
  const mediaId = (await uploaded.json() as { value: { id: string } }).value.id;
  const thumb = await fetch(`${first.url}/api/v1/admin/media/${mediaId}/thumbnail`, { headers: { cookie: sessionCookie } });
  if (thumb.status !== 200 || (await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width !== 480) throw new Error('Built normal-server thumbnail invalid');
} finally { await close(first.child); }
const disabled = spawnSync(process.execPath, [cli, 'disable-account', join(root, 'content.sqlite'), 'integration-cli'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
if (disabled.status !== 0) throw new Error('Built CLI account disable failed');
const restarted = await start();
try {
  if ((await fetch(`${restarted.url}/api/v1/admin/contents`, { headers: { cookie: sessionCookie } })).status !== 401) throw new Error('Disabled session revived after built restart');
  if ((await fetch(`${restarted.url}/api/v1/templates`)).status !== 200) throw new Error('Public content failed after built restart');
} finally { await close(restarted.child); }
const report = { ordinaryNode: true, normalServerBundle: true, builtMaintenanceCli: true, boundedStdinConfirmation: true, adminLogin: true, realImageUpload: true, decodedThumbnailWidth: 480, restart: true, disabledSessionRejected: true, publicContentReadable: true };
writeFileSync(reportPath, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report) + '\n');
