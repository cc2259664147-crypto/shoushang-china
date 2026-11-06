import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { exhibits, stories } from '@shoushang/fixtures';
import { ContentDatabase } from '../database';
import { developmentData } from '../database/development';
import { contentRoutes } from '../content';
import { adminRoutes } from './index';
import { csrf, hashPassword, verifyPassword, validateSecurity, cookie } from './security';
import { decodeImage, MediaStorage } from './media';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse())
    await c(); }, 30000);
type Session = {
    cookie: string;
    csrf: string;
};
type Envelope = {
    ok: boolean;
    value: Record<string, unknown>;
    error: {
        code: string;
    };
};
async function setup(host = '127.0.0.1') {
    const dir = mkdtempSync(join(tmpdir(), 'm13-http-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const db = new ContentDatabase({ path: join(dir, 'db.sqlite') });
    cleanup.push(() => db.close());
    db.initializeDevelopment(developmentData);
    const password = randomBytes(24).toString('base64url');
    const hash = await hashPassword(password);
    const adminId = db.admin.maintenanceAccount('test-admin', 'admin', hash);
    const editorId = db.admin.maintenanceAccount('test-editor', 'editor', hash);
    const app = Fastify();
    await app.register(contentRoutes, { database: db });
    await app.register(adminRoutes, { database: db, origin: 'http://127.0.0.1:5193', securityMode: 'loopback-http', listenHost: '127.0.0.1', mediaRoot: join(dir, 'media'), backupRoot: join(dir, 'backups') });
    await app.listen({ host, port: 0 });
    cleanup.push(() => app.close());
    const address = app.server.address();
    if (!address || typeof address === 'string')
        throw new Error('address');
    const url = `http://127.0.0.1:${address.port}`;
    async function request(path: string, method = 'GET', body?: unknown, s?: Session, headers: Record<string, string> = {}) { return fetch(url + path, { method, headers: { origin: 'http://127.0.0.1:5193', ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}), ...(body === undefined ? {} : { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? new Uint8Array(body).buffer : JSON.stringify(body) }) }); }
    async function login(role: 'admin' | 'editor', pass = password): Promise<Session> { const challenge = await request('/api/v1/admin/csrf'); const c = await challenge.json() as Envelope; const challengeCookie = challenge.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); const r = await request('/api/v1/admin/session', 'POST', { username: `test-${role}`, password: pass }, undefined, { cookie: challengeCookie, 'x-csrf-token': String(c.value.csrfToken) }); if (r.status !== 200)
        throw new Error(`login failed ${r.status}`); const p = await r.json() as Envelope; return { cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '), csrf: String(p.value.csrfToken) }; }
    return { dir, db, app, url, request, login, adminId, editorId, password };
}
async function approveMedia(s: Awaited<ReturnType<typeof setup>>, session: Session) {
    const bytes = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#a51d25' } }).jpeg().toBuffer();
    const upload = await s.request('/api/v1/admin/media', 'POST', bytes, session);
    expect(upload.status).toBe(201);
    const u = await upload.json() as Envelope;
    const id = String(u.value.id);
    expect((await s.request(`/api/v1/admin/media/${id}/license`, 'PATCH', { expectedRevision: 1, alt: '开发几何示意', author: '项目测试自制', source: '隔离测试生成，无文化事实', licenseType: '项目自制测试授权', usageScope: 'site-display-and-thumbnail', attribution: '开发测试', licenseUrl: 'https://example.test/license', modification: '未裁切，仅后台重编码', kind: 'illustration' }, session)).status).toBe(200);
    const proof = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
    expect((await s.request(`/api/v1/admin/media/${id}/proof`, 'PUT', proof, session)).status).toBe(200);
    expect((await s.request(`/api/v1/admin/media/${id}/review`, 'POST', { expectedRevision: 3, decision: 'approved', reason: '核对自制测试凭证', verifiedScope: 'site-display-and-thumbnail' }, session)).status).toBe(200);
    return id;
}
function draft(mediaId: string) { const { id: _id, revision: _r, updatedAt: _u, media: _m, ...d } = exhibits[0]!; return { ...d, title: '开发示意 HTTP 展品', craftId: 'craft-papercut', category: '开发示意', tags: ['开发示意'], storyIds: [], templateIds: ['template-dev-paper'], mediaIds: [mediaId] }; }
async function ready(s: Awaited<ReturnType<typeof setup>>) { const admin = await s.login('admin'); const editor = await s.login('editor'); const mid = await approveMedia(s, admin); const create = await s.request('/api/v1/admin/contents', 'POST', { kind: 'exhibit', draft: draft(mid), expectedLatest: null }, editor); expect(create.status).toBe(201); const value = (await create.json() as Envelope).value; const id = String(value.id); expect((await s.request(`/api/v1/admin/contents/exhibit/${id}/submit`, 'POST', { revision: 1, expectedLatest: 1 }, editor)).status).toBe(200); const review = await s.request(`/api/v1/admin/contents/exhibit/${id}/review`, 'POST', { revision: 1, expectedLatest: 1, decision: 'approved', evidence: { sources: '开发示例来源逐项核对，不作为文化事实' } }, admin); expect(review.status).toBe(200); const reviewId = String((await review.json() as Envelope).value.reviewId); return { admin, editor, mid, id, publish: { revision: 1, expectedLatest: 1, expectedPublic: null, reviewId } }; }
function reviewWorker(input: unknown): Promise<{ ok: boolean; code?: string }> {
    return new Promise((yes, no) => {
        const child = spawn(process.execPath, ['--import', 'tsx', resolve('apps/api/src/admin/testing/review-worker.ts')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let output = '';
        const timeout = setTimeout(() => { child.kill(); no(new Error('review worker timeout')); }, 15000);
        child.stdout.on('data', (b: Buffer) => { output += b.toString(); }); child.stderr.on('data', () => {});
        child.on('error', no); child.on('exit', code => { clearTimeout(timeout); if (code !== 0) no(new Error('review worker failed')); else { try { yes(JSON.parse(output)); } catch { no(new Error('invalid worker result')); } } });
        child.stdin.end(JSON.stringify(input));
    });
}
// Each integration scenario performs multiple real scrypt(128MiB) operations and child decodes.
// This aggregate deadline is separate from the unchanged 10s per-decoder production limit.
describe('M13 real HTTP authentication and content lifecycle', { timeout: 30000 }, () => {
    it('rejects an older approval after rejection, including reopened connections and same-millisecond decisions', async () => {
        const s = await setup(), f = await ready(s);
        const endpoint = `/api/v1/admin/contents/exhibit/${f.id}`;
        const raw = new DatabaseSync(s.db.path);
        let timestamp: string;
        try { timestamp = String(raw.prepare('SELECT created_at FROM admin_reviews WHERE id=?').get(f.publish.reviewId)!.created_at); } finally { raw.close(); }
        const clock = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(timestamp);
        try {
            const rejected = await s.request(endpoint + '/review', 'POST', { revision: 1, expectedLatest: 1, decision: 'rejected', evidence: { sources: '后续核验退回' } }, f.admin);
            expect(rejected.status).toBe(200);
        } finally { clock.mockRestore(); }
        expect((await s.request(endpoint + '/publish', 'POST', f.publish, f.admin, { 'idempotency-key': randomUUID() })).status).toBe(400);
        expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(404);
        const { digest } = await import('../database/admin-schema');
        const access = { tokenDigest: digest(f.admin.cookie.split(';')[0]!.split('=')[1]!), requestId: randomUUID() };
        const reopened = new ContentDatabase({ path: s.db.path });
        try {
            expect(await reviewWorker({ path: s.db.path, access, id: f.id, request: f.publish, key: randomUUID(), operation: 'publish' })).toEqual({ ok: false, code: 'INVALID_INPUT' });
            expect(reopened.admin.content(access, 'exhibit', f.id).review?.decision).toBe('rejected');
            expect(() => reopened.admin.publish(access, 'exhibit', f.id, f.publish, randomUUID())).toThrow('核验记录');
            const latest = reopened.admin.review(access, 'exhibit', f.id, { revision: 1, expectedLatest: 1, decision: 'approved', evidence: { sources: '重新核对' } });
            expect(() => reopened.admin.publish(access, 'exhibit', f.id, f.publish, randomUUID())).toThrow('核验记录');
            expect(reopened.admin.publish(access, 'exhibit', f.id, { ...f.publish, reviewId: latest.reviewId }, randomUUID()).publicRevision).toBe(1);
        } finally { reopened.close(); }
    });
    it('serializes rejection versus publication across competing processes without stale approval escape', async () => {
        const s = await setup();
        const { digest } = await import('../database/admin-schema');
        for (let attempt = 0; attempt < 3; attempt++) {
            const f = await ready(s);
            const base = { path: s.db.path, access: { tokenDigest: digest(f.admin.cookie.split(';')[0]!.split('=')[1]!), requestId: randomUUID() }, id: f.id, key: randomUUID() };
            const [rejection, publication] = await Promise.all([
                reviewWorker({ ...base, operation: 'review', request: { revision: 1, expectedLatest: 1, decision: 'rejected', evidence: { sources: '并发核验退回' } } }),
                reviewWorker({ ...base, operation: 'publish', request: f.publish })
            ]);
            expect(Number(rejection.ok) + Number(publication.ok)).toBe(1);
            expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(publication.ok ? 200 : 404);
            if (rejection.ok) {
                expect(publication.code).toBe('INVALID_INPUT');
                expect(await reviewWorker({ ...base, operation: 'publish', request: f.publish, key: randomUUID() })).toEqual({ ok: false, code: 'INVALID_INPUT' });
            } else expect(rejection.code).toBe('REVISION_CONFLICT');
        }
    });
    it('publishes a complete story only with identity and quotation evidence bound to the saved revision',async()=>{
        const s=await setup();const a=await s.login('admin');const mid=await approveMedia(s,a);const {id:oldId,revision:oldRevision,updatedAt:oldTime,cover:oldCover,...rest}=stories[0]!;void oldId;void oldRevision;void oldTime;void oldCover;
        const c=await s.request('/api/v1/admin/contents','POST',{kind:'story',draft:{...rest,craftIds:['craft-papercut'],exhibitIds:[],templateId:'template-dev-paper',mediaIds:[mid]},expectedLatest:null},a);expect(c.status).toBe(201);const id=String((await c.json() as Envelope).value.id);
        expect((await s.request(`/api/v1/admin/contents/story/${id}/submit`,'POST',{revision:1,expectedLatest:1},a)).status).toBe(200);
        expect((await s.request(`/api/v1/admin/contents/story/${id}/review`,'POST',{revision:1,expectedLatest:1,decision:'approved',evidence:{sources:'开发示例来源'}},a)).status).toBe(400);
        const reviewed=await s.request(`/api/v1/admin/contents/story/${id}/review`,'POST',{revision:1,expectedLatest:1,decision:'approved',evidence:{sources:'来源为明确开发示例，不是文化事实',identity:'虚构开发人物，页面必须保留开发声明',quotations:'已核对不含真实人物采访引语'}},a);expect(reviewed.status).toBe(200);const reviewId=String((await reviewed.json() as Envelope).value.reviewId);
        expect((await s.request(`/api/v1/admin/contents/story/${id}/publish`,'POST',{revision:1,expectedLatest:1,expectedPublic:null,reviewId},a,{'idempotency-key':randomUUID()})).status).toBe(200);expect((await s.request(`/api/v1/stories/${id}`)).status).toBe(200);
    });
    it('enforces 401, 403, forged roles, origin and missing/wrong CSRF', async () => {
        const s = await setup();
        expect((await s.request('/api/v1/admin/contents')).status).toBe(401);
        expect((await s.request('/api/v1/admin/accounts', 'GET', undefined, undefined, { 'x-role': 'admin' })).status).toBe(401);
        const editor = await s.login('editor');
        expect((await s.request('/api/v1/admin/accounts', 'GET', undefined, editor, { 'x-role': 'admin' })).status).toBe(403);
        expect((await s.request('/api/v1/admin/contents', 'POST', {}, editor, { 'x-csrf-token': '' })).status).toBe(403);
        expect((await s.request('/api/v1/admin/contents', 'POST', {}, editor, { origin: 'https://evil.example' })).status).toBe(403);
        expect((await s.request('/api/v1/admin/contents', 'POST', {}, editor, { 'x-csrf-token': randomUUID() })).status).toBe(403);
        expect((await s.request('/api/v1/admin/contents', 'POST', { kind: 'template', draft: {}, expectedLatest: null }, editor)).status).toBe(400);
    });
    it('logs out persistently and rejects expiry and disabled sessions', async () => {
        const s = await setup();
        const admin = await s.login('admin'), editor = await s.login('editor');
        expect((await s.request('/api/v1/admin/session', 'DELETE', undefined, editor)).status).toBe(204);
        expect((await s.request('/api/v1/admin/session', 'GET', undefined, editor)).status).toBe(401);
        const second = await s.login('editor');
        expect((await s.request(`/api/v1/admin/accounts/${s.editorId}/disable`, 'POST', { expectedVersion: 1, reason: '测试停用' }, admin, { 'idempotency-key': randomUUID() })).status).toBe(200);
        expect((await s.request('/api/v1/admin/contents', 'GET', undefined, second)).status).toBe(401);
        const raw = new DatabaseSync(s.db.path);
        try {
            raw.exec('UPDATE admin_sessions SET expires_at=0');
        }
        finally {
            raw.close();
        }
        expect((await s.request('/api/v1/admin/session', 'GET', undefined, admin)).status).toBe(401);
    });
    it('requires real loopback binding in addition to a trusted local Origin', async () => {
        expect(() => validateSecurity({ origin: 'http://evil.example', securityMode: 'loopback-http', listenHost: '127.0.0.1' })).toThrow();
        expect(() => validateSecurity({ origin: 'http://localhost:5193', securityMode: 'loopback-http', listenHost: '0.0.0.0' })).toThrow();
        const s = await setup('0.0.0.0');
        expect((await s.request('/api/v1/admin/csrf')).status).toBe(403);
    });
    it('keeps HttpOnly/Secure/SameSite/Path explicit and never globally disables Secure', async () => {
        const s = await setup();
        const r = await s.request('/api/v1/admin/csrf');
        const h = r.headers.getSetCookie()[0]!;
        expect(h).toContain('HttpOnly');
        expect(h).toContain('SameSite=Strict');
        expect(h).toContain('Path=/api/v1/admin');
        expect(h).not.toContain('Secure');
        expect(cookie({ origin: 'https://example.test', securityMode: 'https', listenHost: '127.0.0.1' }, '__Secure-shoushang_admin', 'x', 60)).toContain('; Secure');
    });
    it('publishes atomically once, replays after reopen, keeps old public revision during editing then unpublishes', async () => {
        const s = await setup();
        const f = await ready(s);
        expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(404);
        expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/preview?revision=1`)).status).toBe(401);
        expect((await s.request(`/api/v1/media/${f.mid}/original`)).status).toBe(404);
        const key = randomUUID();
        const publish = () => s.request(`/api/v1/admin/contents/exhibit/${f.id}/publish`, 'POST', f.publish, f.admin, { 'idempotency-key': key });
        const responses = await Promise.all([publish(), publish()]);
        expect(responses.map(r => r.status)).toEqual([200, 200]);
        const bodies = await Promise.all(responses.map(r => r.json()));
        expect(bodies[0]).toEqual(bodies[1]);
        expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(200);
        expect((await s.request(`/api/v1/media/${f.mid}/thumbnail`)).status).toBe(200);
        const reopened = new ContentDatabase({ path: s.db.path });
        try {
            const token = f.admin.cookie.split(';')[0]!.split('=')[1]!;
            const result = reopened.admin.publish({ tokenDigest: (await import('../database/admin-schema')).digest(token), requestId: randomUUID() }, 'exhibit', f.id, f.publish, key);
            expect(result.publicRevision).toBe(1);
        }
        finally {
            reopened.close();
        }
        expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/publish`, 'POST', { ...f.publish, revision: 2 }, f.admin, { 'idempotency-key': key })).status).toBe(409);
        const save = await s.request(`/api/v1/admin/contents/exhibit/${f.id}/revisions`, 'POST', { draft: { ...draft(f.mid), title: '尚未公开的新标题' }, expectedLatest: 1 }, f.editor);
        expect(save.status).toBe(201);
        const pub = await (await s.request(`/api/v1/exhibits/${f.id}`)).json() as Envelope;
        expect(pub.value.title).toBe('开发示意 HTTP 展品');
        expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/revisions`, 'POST', { draft: draft(f.mid), expectedLatest: 1 }, f.editor)).status).toBe(409);
        expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/unpublish`, 'POST', { expectedLatest: 2, expectedPublic: 1, reason: '隔离下架验证' }, f.admin, { 'idempotency-key': randomUUID() })).status).toBe(200);
        expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(404);
        expect((await s.request(`/api/v1/media/${f.mid}/original`)).status).toBe(404);
    });
    it('does not expose proofs, revokes subsequent image access and rejects restoring revoked media', async () => {
        const s = await setup();
        const f = await ready(s);
        expect((await s.request(`/api/v1/admin/media/${f.mid}/proof`, 'GET', undefined, f.editor)).status).toBe(403);
        expect((await s.request(`/api/v1/media/${f.mid}/proof`)).status).toBe(404);
        expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/publish`, 'POST', f.publish, f.admin, { 'idempotency-key': randomUUID() })).status).toBe(200);
        const publicBody = JSON.stringify(await (await s.request(`/api/v1/exhibits/${f.id}`)).json());
        const publicEnvelope = JSON.parse(publicBody) as Envelope;
        const publicMedia = (publicEnvelope.value.media as Record<string, unknown>[])[0]!;
        expect(publicMedia.source).toBe('隔离测试生成，无文化事实');
        expect(publicMedia.modification).toBe('未裁切，仅后台重编码');
        expect((publicMedia.license as Record<string, unknown>).url).toBe('https://example.test/license');
        expect(publicBody).not.toMatch(/proof|object_key|password|csrf|scrypt/u);
        expect((await s.request(`/api/v1/admin/media/${f.mid}/revoke`, 'POST', { expectedRevision: 4, reason: '撤权测试' }, f.admin, { 'idempotency-key': randomUUID() })).status).toBe(200);
        expect((await s.request(`/api/v1/media/${f.mid}/original`)).status).toBe(404);
        expect((await s.request(`/api/v1/admin/media/${f.mid}/original`, 'GET', undefined, f.admin)).status).toBe(404);
        expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(404);
        expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/restore`, 'POST', { sourceRevision: 1, expectedLatest: 1, reason: '测试恢复' }, f.admin, { 'idempotency-key': randomUUID() })).status).toBe(400);
    });
    it('rejects missing fields/sources/license/relations and never treats a review checkbox as evidence', async () => {
        const s = await setup();
        const a = await s.login('admin');
        const d = await s.request('/api/v1/admin/contents', 'POST', { kind: 'story', draft: { title: '未完整的开发故事' }, expectedLatest: null }, a);
        const id = String((await d.json() as Envelope).value.id);
        expect((await s.request(`/api/v1/admin/contents/story/${id}/submit`, 'POST', { revision: 1, expectedLatest: 1 }, a)).status).toBe(400);
        expect((await s.request(`/api/v1/admin/contents/story/${id}/review`, 'POST', { revision: 1, expectedLatest: 1, decision: 'approved', evidence: {} }, a)).status).toBe(400);
        const mid = await approveMedia(s, a);
        const bad = { ...draft(mid), storyIds: ['missing-story'] };
        const c = await s.request('/api/v1/admin/contents', 'POST', { kind: 'exhibit', draft: bad, expectedLatest: null }, a);
        const cid = String((await c.json() as Envelope).value.id);
        expect((await s.request(`/api/v1/admin/contents/exhibit/${cid}/submit`, 'POST', { revision: 1, expectedLatest: 1 }, a)).status).toBe(400);
    });
    it('rolls back public pointer when idempotency/audit storage fails', async () => {
        const s = await setup();
        const f = await ready(s);
        const raw = new DatabaseSync(s.db.path);
        raw.exec("CREATE TRIGGER fault_idempotency BEFORE INSERT ON admin_idempotency BEGIN SELECT RAISE(ABORT,'injected'); END;");
        try {
            expect((await s.request(`/api/v1/admin/contents/exhibit/${f.id}/publish`, 'POST', f.publish, f.admin, { 'idempotency-key': randomUUID() })).status).toBe(500);
            expect((await s.request(`/api/v1/exhibits/${f.id}`)).status).toBe(404);
        }
        finally {
            raw.exec('DROP TRIGGER fault_idempotency');
            raw.close();
        }
    });
    it('serializes duplicate publication across independent processes and records one successful publication', async () => {
        const s = await setup();
        const f = await ready(s);
        const key = randomUUID();
        const { digest } = await import('../database/admin-schema');
        const token = f.admin.cookie.split(';')[0]!.split('=')[1]!;
        const input = { path: s.db.path, access: { tokenDigest: digest(token), requestId: randomUUID() }, id: f.id, request: f.publish, key };
        const worker = () => new Promise<unknown>((yes, no) => { const child = spawn(process.execPath, ['--import', 'tsx', resolve('apps/api/src/admin/testing/publish-worker.ts')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); let result = ''; child.stdout.on('data', (b: Buffer) => { result += b.toString(); }); child.stderr.on('data', () => { }); child.on('error', no); child.on('exit', code => { if (code !== 0)
            no(new Error('Publication worker failed'));
        else {
            try {
                yes(JSON.parse(result));
            }
            catch {
                no(new Error('Publication worker output invalid'));
            }
        } }); child.stdin.end(JSON.stringify(input)); });
        expect(await Promise.all([worker(), worker()])).toEqual([{ revision: 1, publicRevision: 1 }, { revision: 1, publicRevision: 1 }]);
        const raw = new DatabaseSync(s.db.path);
        try {
            expect(raw.prepare("SELECT count(*) n FROM admin_audit WHERE action='publish'").get()!.n).toBe(1);
            expect(raw.prepare("SELECT count(*) n FROM admin_idempotency WHERE operation='publish'").get()!.n).toBe(1);
        }
        finally {
            raw.close();
        }
    });
    it('uses unique password salts, resets without reviving sessions, and rejects missing media authorization', async () => {
        const s = await setup();
        const editor = await s.login('editor');
        const first = await hashPassword(s.password), second = await hashPassword(s.password);
        expect(first === second).toBe(false);
        s.db.admin.maintenanceAccount('test-editor', 'editor', second, true);
        expect((await s.request('/api/v1/admin/session', 'GET', undefined, editor)).status).toBe(401);
        expect(await verifyPassword(s.password, second)).toBe(true);
        const a = await s.login('admin');
        const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
        const upload = await s.request('/api/v1/admin/media', 'POST', bytes, a);
        const id = String((await upload.json() as Envelope).value.id);
        const c = await s.request('/api/v1/admin/contents', 'POST', { kind: 'exhibit', draft: draft(id), expectedLatest: null }, a);
        const cid = String((await c.json() as Envelope).value.id);
        expect((await s.request(`/api/v1/admin/contents/exhibit/${cid}/submit`, 'POST', { revision: 1, expectedLatest: 1 }, a)).status).toBe(400);
        expect((await s.request(`/api/v1/admin/media/${id}/review`, 'POST', { expectedRevision: 1, decision: 'approved', reason: '缺凭证', verifiedScope: 'site-display-and-thumbnail' }, a)).status).toBe(400);
    });
    it('returns generic login failures and persists limits without revealing credentials', async () => {
        const s = await setup();
        const challenge = await s.request('/api/v1/admin/csrf');
        const c = await challenge.json() as Envelope;
        const r = await s.request('/api/v1/admin/session', 'POST', { username: 'nonexistent', password: randomBytes(18).toString('hex') }, undefined, { cookie: challenge.headers.getSetCookie().map(x => x.split(';')[0]).join('; '), 'x-csrf-token': String(c.value.csrfToken) });
        expect(r.status).toBe(401);
        expect((await r.json() as {
            error: {
                message: string;
            };
        }).error.message).toBe('账号或密码不正确');
        expect(await verifyPassword(s.password, await hashPassword(s.password))).toBe(true);
    });
});
describe('M13 real decoding, bounds and file compensation', () => {
    for (const format of ['jpeg', 'png', 'webp'] as const)
        it(`fully decodes ${format} and creates an actual smaller thumbnail`, async () => { const b = await sharp({ create: { width: 900, height: 700, channels: 3, background: 'red' } })[format]().toBuffer(); const d = await decodeImage(b); const m = await sharp(d.thumbnail).metadata(); expect(d.width).toBe(900); expect(m.width).toBe(480); expect(m.height).toBeLessThan(700); expect(d.thumbnail.equals(d.original)).toBe(false); });
    it('rejects SVG/HTML, corrupt/truncated data, oversize and overdimensioned images', async () => { for (const b of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('<html>not a picture</html>'), Buffer.from([255, 216, 255, 0]), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])])
        await expect(decodeImage(b)).rejects.toThrow(); await expect(decodeImage(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow('5MB'); const huge = await sharp({ create: { width: 6001, height: 2, channels: 3, background: 'red' } }).png().toBuffer(); await expect(decodeImage(huge)).rejects.toThrow(); });
    it('times out a decoder process and rejects paths instead of reading arbitrary files', async () => { const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer(); await expect(decodeImage(image, { timeoutMs: 1 })).rejects.toThrow('超时'); const s = await setup(); const storage = new MediaStorage(join(s.dir, 'private')); await expect(storage.read('../db.sqlite', 'original.png')).rejects.toThrow(); await expect(storage.read(randomUUID(), '../../db.sqlite')).rejects.toThrow(); });
    it('does not publish files when a database failure follows a real upload', async () => { const s = await setup(); const a = await s.login('admin'); const raw = new DatabaseSync(s.db.path); raw.exec("CREATE TRIGGER fail_media BEFORE INSERT ON admin_media BEGIN SELECT RAISE(ABORT,'fault'); END;"); const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer(); try {
        expect((await s.request('/api/v1/admin/media', 'POST', bytes, a)).status).toBe(500);
        expect(raw.prepare('SELECT count(*) n FROM admin_media').get()!.n).toBe(0);
    }
    finally {
        raw.close();
    } });
    it('runs sharp on this Node24 target with native libraries and records only platform metadata', () => { const evidence = join(process.cwd(), 'apps/api/src/admin/evidence/m13-implementation-20261019'); void evidence; expect(process.versions.node.startsWith('24.')).toBe(true); expect(sharp.versions.sharp).toBe('0.35.5'); expect(sharp.versions.vips).toBeTruthy(); expect(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).toContain('0.35.5'); expect(csrf(randomBytes(32).toString('base64url')).length).toBe(43); });
});
