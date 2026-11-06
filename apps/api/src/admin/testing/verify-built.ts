import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
const dir = await mkdtemp(join(tmpdir(), 'm13-built-'));
await symlink(resolve('apps/api/node_modules'), join(dir, 'node_modules'), 'junction');
await writeFile(join(dir, 'package.json'), ' {"type":"module"}');
await build({ entryPoints: [resolve('apps/api/src/admin/testing/server.ts')], bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['fastify', 'sharp'], outfile: join(dir, 'server.mjs') });
await build({ entryPoints: [resolve('apps/api/src/admin/decoder-worker.ts')], bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['sharp'], outfile: join(dir, 'decoder-worker.js') });
const password = randomBytes(32).toString('base64url');
const databaseDir = join(dir, 'state');
await (await import('node:fs/promises')).mkdir(databaseDir);
async function start(restart = false) {
    const child = spawn(process.execPath, [join(dir, 'server.mjs'), '--isolated-admin-server'], { env: { ...process.env, M13_TEST_ROOT: databaseDir, M13_TEST_PASSWORD: password, M13_TEST_PORT: '0', M13_TEST_RESTART: restart ? '1' : '0', M13_CLOSE_ON_STDIN: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const address = await new Promise<{
        port: number;
    }>((yes, no) => { const timeout = setTimeout(() => { child.kill(); no(new Error('Built server startup timeout')); }, 15000); child.stdout.on('data', (b: Buffer) => { output += b.toString(); const line = output.split('\n')[0]; if (line?.startsWith('{')) {
        try {
            const r = JSON.parse(line) as {
                address: {
                    port: number;
                };
            };
            clearTimeout(timeout);
            yes(r.address);
        }
        catch { }
    } }); child.on('exit', () => { clearTimeout(timeout); no(new Error('Built server exited before ready')); }); child.stderr.on('data', () => { }); });
    return { url: `http://127.0.0.1:${address.port}`, close: async () => { child.stdin.end(); await new Promise<void>(r => child.once('exit', () => r())); } };
}
const origin = 'http://127.0.0.1:5193';
let server = await start();
let sessionCookie = '', sessionCsrf = '';
try {
    const c = await fetch(server.url + '/api/v1/admin/csrf');
    const cv = await c.json() as {
        value: {
            csrfToken: string;
        };
    };
    const cookie = c.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
    const login = await fetch(server.url + '/api/v1/admin/session', { method: 'POST', headers: { origin, cookie, 'x-csrf-token': cv.value.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'browser-admin', password }) });
    if (login.status !== 200)
        throw new Error('Built login failed');
    const session = await login.json() as {
        value: {
            csrfToken: string;
        };
    };
    sessionCsrf = session.value.csrfToken;
    sessionCookie = login.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
    const bytes = await sharp({ create: { width: 900, height: 700, channels: 3, background: 'red' } }).webp().toBuffer();
    const upload = await fetch(server.url + '/api/v1/admin/media', { method: 'POST', headers: { origin, cookie: sessionCookie, 'x-csrf-token': sessionCsrf, 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes).buffer });
    if (upload.status !== 201)
        throw new Error('Built decoder upload failed');
    const v = await upload.json() as {
        value: {
            id: string;
        };
    };
    const thumb = await fetch(server.url + `/api/v1/admin/media/${v.value.id}/thumbnail`, { headers: { cookie: sessionCookie } });
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    if (meta.width !== 480)
        throw new Error('Built thumbnail is not resized');
    const logout = await fetch(server.url + '/api/v1/admin/session', { method: 'DELETE', headers: { origin, cookie: sessionCookie, 'x-csrf-token': sessionCsrf } });
    if (logout.status !== 204)
        throw new Error('Built logout failed');
    await server.close();
    server = await start(true);
    const old = await fetch(server.url + '/api/v1/admin/session', { headers: { cookie: sessionCookie } });
    if (old.status !== 401)
        throw new Error('Restart revived a revoked session');
    const newChallenge = await fetch(server.url + '/api/v1/admin/csrf');
    const newCv = await newChallenge.json() as {
        value: {
            csrfToken: string;
        };
    };
    const newLogin = await fetch(server.url + '/api/v1/admin/session', { method: 'POST', headers: { origin, cookie: newChallenge.headers.getSetCookie().map(s => s.split(';')[0]).join('; '), 'x-csrf-token': newCv.value.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'browser-admin', password }) });
    if (newLogin.status !== 200)
        throw new Error('Restarted login failed');
    const newCookie = newLogin.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
    const listing = await fetch(server.url + '/api/v1/admin/media', { headers: { cookie: newCookie } });
    const media = await listing.json() as {
        value: {
            items: {
                id: string;
            }[];
        };
    };
    if (!media.value.items.some(m => m.id === v.value.id))
        throw new Error('Restart lost media ledger');
    const auditResponse = await fetch(server.url + '/api/v1/admin/audit?pageSize=50', { headers: { cookie: newCookie } });
    const audit = await auditResponse.json() as {
        value: {
            items: {
                action: string;
            }[];
        };
    };
    if (!audit.value.items.some(a => a.action === 'logout') || !audit.value.items.some(a => a.action === 'media-upload'))
        throw new Error('Restart lost audit');
    const report = { ordinaryNode: true, noTsxLoader: true, sharp: sharp.versions.sharp, node: process.version, platform: process.platform, arch: process.arch, realWebpDecode: true, thumbnailWidth: meta.width, compiledWorker: true, independentProcessRestart: true, revokedSessionRejected: true, privateMediaPersisted: true };
    await writeFile(resolve(process.argv[2] ?? 'apps/api/src/admin/evidence/m13-implementation-20261019/built-report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
}
finally {
    await server.close();
}
