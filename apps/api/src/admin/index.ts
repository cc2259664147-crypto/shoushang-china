import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AdminError } from '../database';
import type { Access, ContentDatabase } from '../database';
import { digest, idOf, kindOf, positive, record, required } from '../database/admin-schema';
import { assertAdminListener, cookie, cookieName, csrf, equal, opaque, readCookie, validateSecurity, verifyPassword } from './security';
import type { SecurityConfig } from './security';
import { MediaStorage, runBackup } from './media';
export { assertAdminListener } from './security';
export type { SecurityConfig } from './security';
export interface AdminOptions extends SecurityConfig {
    database: ContentDatabase;
    mediaRoot: string;
    backupRoot: string;
}
interface Context {
    requestId: string;
    access: Access | null;
    token: string | null;
}
const base = '/api/v1/admin';
const statuses = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, REVISION_CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, RATE_LIMITED: 429, INTERNAL_ERROR: 500 };
async function readMedia(database: ContentDatabase, storage: MediaStorage, id: string, variant: 'original' | 'thumbnail' | 'proof', access: Access | null) {
    const file = database.admin.mediaFile(access, id, variant);
    let bytes: Buffer;
    try { bytes = await storage.read(file.objectKey, file.filename); }
    catch { throw new AdminError('NOT_FOUND', '媒体不可用'); }
    // Recheck authorization after disk I/O so concurrent withdrawal fails closed.
    database.admin.mediaFile(access, id, variant);
    if (digest(bytes) !== file.expectedHash) throw new AdminError('INTERNAL_ERROR', '媒体完整性检查失败');
    return { bytes, mime: file.mime };
}
function mediaReply(reply: FastifyReply, file: { bytes: Buffer; mime: string }) {
    return reply.header('cache-control', 'private, no-store').header('content-security-policy', "default-src 'none'").header('x-content-type-options', 'nosniff').type(file.mime).send(file.bytes);
}
/** Read-only media projection; no admin accounts, parsers, sessions or write routes. */
export async function publicMediaRoutes(app: FastifyInstance, options: { database: ContentDatabase; mediaRoot: string }): Promise<void> {
    const storage = new MediaStorage(options.mediaRoot);
    app.get('/api/v1/media/:id/:variant', async (request, reply) => {
        const requestId = randomUUID();
        reply.header('x-request-id', requestId).header('cache-control', 'no-store');
        try {
            const p = record(request.params, ['id', 'variant']);
            if (!['original', 'thumbnail'].includes(String(p.variant))) throw new AdminError('NOT_FOUND', '媒体不可用');
            return mediaReply(reply, await readMedia(options.database, storage, idOf(p.id), p.variant as 'original' | 'thumbnail', null));
        } catch (error) {
            const code = error instanceof AdminError && error.code === 'INTERNAL_ERROR' ? 'INTERNAL_ERROR' : 'NOT_FOUND';
            return reply.code(code === 'INTERNAL_ERROR' ? 500 : 404).send({ ok: false, error: { code, message: code === 'INTERNAL_ERROR' ? '媒体完整性检查失败' : '媒体不可用', requestId, fieldErrors: [] } });
        }
    });
}
export async function adminRoutes(app: FastifyInstance, o: AdminOptions): Promise<void> {
    validateSecurity(o);
    const db = o.database.admin;
    const storage = new MediaStorage(o.mediaRoot);
    await storage.initialize();
    const contexts = new WeakMap<FastifyRequest, Context>();
    const jobs = new Set<Promise<void>>();
    app.addContentTypeParser(/^(?:application\/octet-stream|image\/[^;]+)(?:;.*)?$/u, { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    const context = (r: FastifyRequest) => contexts.get(r)!;
    function errorReply(e: unknown, r: FastifyRequest, reply: FastifyReply) {
        const c = contexts.get(r) ?? { requestId: randomUUID(), access: null, token: null };
        const status = typeof e === 'object' && e !== null && 'statusCode' in e ? e.statusCode : null;
        const err = e instanceof AdminError ? e : new AdminError(status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 || status === 415 ? 'INVALID_INPUT' : 'INTERNAL_ERROR', status === 413 ? '单文件不得超过5MB' : status === 400 || status === 415 ? '请求格式不正确' : '服务暂时不可用，请保留输入重试');
        const code = err.code in statuses ? err.code as keyof typeof statuses : 'INTERNAL_ERROR';
        try {
            if(r.url.split('?')[0]!.startsWith(`${base}/`))db.failure(c.access, r.method === 'GET' ? 'read-denied' : 'write-failed', c.requestId, code);
        }
        catch { /* No success is reported when failure audit storage is unavailable. */ }
        if (code === 'UNAUTHENTICATED')
            reply.header('set-cookie', cookie(o, cookieName(o), '', 0));
        if (code === 'RATE_LIMITED')
            reply.header('retry-after', '60');
        return reply.code(statuses[code]).header('x-request-id', c.requestId).header('cache-control', 'no-store').send({ ok: false, error: { code, message: err.message, requestId: c.requestId, fieldErrors: err.fields } });
    }
    app.setErrorHandler(errorReply);
    app.addHook('onRequest', async (r, reply) => {
        const token = readCookie(r.headers.cookie, cookieName(o));
        const requestId = randomUUID();
        const c = { requestId, token, access: token ? { tokenDigest: digest(token), requestId } : null };
        contexts.set(r, c);
        reply.header('x-request-id', requestId).header('cache-control', 'no-store').header('x-content-type-options', 'nosniff');
        const path = r.url.split('?')[0]!;
        if (!path.startsWith(`${base}/`))
            return;
        assertAdminListener(app, o);
        const anonymous = path === `${base}/csrf` || path === `${base}/session` && r.method === 'POST';
        if (!anonymous) {
            if (!c.access)
                throw new AdminError('UNAUTHENTICATED', '请先登录');
            db.identity(c.access);
        }
        if (r.method !== 'GET' && r.method !== 'HEAD') {
            if (r.headers.origin !== o.origin || r.headers['sec-fetch-site'] === 'cross-site')
                throw new AdminError('FORBIDDEN', '写入必须来自可信同源页面');
            const h = r.headers['x-csrf-token'];
            if (typeof h !== 'string')
                throw new AdminError('FORBIDDEN', '缺少CSRF验证');
            if (!anonymous) {
                const s = db.session(c.access!);
                if (!equal(digest(h), s.csrfDigest))
                    throw new AdminError('FORBIDDEN', 'CSRF验证失败');
                db.rate(`write:${s.account.id}`, 30, 60000);
            }
        }
        if (path === `${base}/csrf` && r.headers.origin !== undefined && r.headers.origin !== o.origin)
            throw new AdminError('FORBIDDEN', '来源不可信');
    });
    app.addHook('onClose', async () => { await Promise.allSettled(jobs); });
    const access = (r: FastifyRequest): Access => { const a = context(r).access; if (!a)
        throw new AdminError('UNAUTHENTICATED', '请先登录'); return a; };
    const params = (r: FastifyRequest) => record(r.params, ['kind', 'id', 'variant']);
    const key = (r: FastifyRequest) => typeof r.headers['idempotency-key'] === 'string' ? r.headers['idempotency-key'] : '';
    const query = (r: FastifyRequest, allowed: string[]) => { const result: Record<string, unknown> = {}; for (const [k, v] of new URL(r.url, 'http://local').searchParams) {
        if (!allowed.includes(k) || k in result)
            throw new AdminError('INVALID_INPUT', '查询参数不正确');
        if (['page', 'pageSize', 'revision'].includes(k)) {
            if (!/^[1-9][0-9]*$/u.test(v) || !Number.isSafeInteger(Number(v)))
                throw new AdminError('INVALID_INPUT', '页码或修订不正确');
            result[k] = Number(v);
        }
        else
            result[k] = v;
    } return result; };
    function route(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, fn: (r: FastifyRequest, reply: FastifyReply) => unknown, bodyLimit = 256 * 1024) { app.route({ method, url: base + path, bodyLimit, handler: async (r, reply) => { try {
            return await fn(r, reply);
        }
        catch (e) {
            return errorReply(e, r, reply);
        } } }); }
    const ok = (value: unknown) => ({ ok: true, value });
    route('GET', '/csrf', r => { query(r, []); db.rate(`challenge:${digest(r.ip)}`, 30, 900000); const token = opaque(), value = csrf(token); db.challenge(digest(token), digest(value)); return ok({ csrfToken: value, expiresAt: new Date(Date.now() + 300000).toISOString(), challenge: token }); });
    // Cookie is set in preSerialization; challenge never crosses JSON to JavaScript.
    app.addHook('preSerialization', async (_r, reply, payload: unknown) => { if (payload && typeof payload === 'object' && 'value' in payload) {
        const v = (payload as {
            value: unknown;
        }).value;
        if (v && typeof v === 'object' && 'challenge' in v) {
            const { challenge, ...rest } = v as Record<string, unknown>;
            reply.header('set-cookie', cookie(o, `${cookieName(o)}_challenge`, String(challenge), 300));
            return { ok: true, value: rest };
        }
    } return payload; });
    route('POST', '/session', async (r, reply) => {
        const p = record(r.body, ['username', 'password']);
        const username = required(p.username, 'username', 80).toLowerCase();
        if (typeof p.password !== 'string' || p.password.length > 128)
            throw new AdminError('UNAUTHENTICATED', '账号或密码不正确');
        db.rate(`login-ip:${digest(r.ip)}`, 30, 900000);
        db.rate(`login-account:${digest(username)}`, 5, 900000);
        const challenge = readCookie(r.headers.cookie, `${cookieName(o)}_challenge`);
        const h = r.headers['x-csrf-token'];
        if (!challenge || typeof h !== 'string')
            throw new AdminError('FORBIDDEN', '请重新验证登录请求');
        db.consumeChallenge(digest(challenge), digest(h));
        const credential = db.credential(username);
        const verified = await verifyPassword(p.password, credential?.passwordHash ?? null);
        if (!verified || !credential)
            throw new AdminError('UNAUTHENTICATED', '账号或密码不正确');
        const token = opaque(), ct = csrf(token);
        const value = db.login(credential.id, credential.version, digest(token), digest(ct), context(r).token ? digest(context(r).token!) : null, context(r).requestId);
        reply.header('set-cookie', [cookie(o, cookieName(o), token, 28800), cookie(o, `${cookieName(o)}_challenge`, '', 0)]);
        return ok({ ...value, csrfToken: ct });
    });
    route('GET', '/session', r => { query(r, []); const { csrfDigest: ignored, ...s } = db.session(access(r)); void ignored; return ok({ ...s, csrfToken: csrf(context(r).token!) }); });
    route('DELETE', '/session', (r, reply) => { db.logout(access(r)); return reply.header('set-cookie', cookie(o, cookieName(o), '', 0)).code(204).send(); });
    route('GET', '/contents', r => ok(db.contents(access(r), query(r, ['kind', 'state', 'q', 'page', 'pageSize']))));
    route('POST', '/contents', (r, reply) => { const p = record(r.body, ['kind', 'draft', 'expectedLatest']); if (p.expectedLatest !== null)
        throw new AdminError('INVALID_INPUT', '新建预期修订必须为null'); const v = db.save(access(r), kindOf(p.kind), null, p.draft, null); return reply.code(201).send(ok(v)); });
    route('GET', '/contents/:kind/:id', r => { const p = params(r); const q = query(r, ['revision']); return ok(db.content(access(r), kindOf(p.kind), idOf(p.id), q.revision as number | undefined)); });
    route('GET', '/contents/:kind/:id/history', r => { const p = params(r); return ok(db.history(access(r), kindOf(p.kind), idOf(p.id), query(r, ['page', 'pageSize']))); });
    route('GET', '/contents/:kind/:id/preview', r => { const p = params(r); const q = query(r, ['revision']); return ok(db.content(access(r), kindOf(p.kind), idOf(p.id), positive(q.revision)!)); });
    route('POST', '/contents/:kind/:id/revisions', (r, reply) => { const p = params(r); const b = record(r.body, ['draft', 'expectedLatest']); const v = db.save(access(r), kindOf(p.kind), idOf(p.id), b.draft, positive(b.expectedLatest)!); return reply.code(201).send(ok(v)); });
    for (const op of ['submit', 'review', 'publish', 'unpublish', 'restore'] as const)
        route('POST', `/contents/:kind/:id/${op}`, r => { const p = params(r), kind = kindOf(p.kind), id = idOf(p.id); return ok(op === 'submit' ? db.submit(access(r), kind, id, r.body) : op === 'review' ? db.review(access(r), kind, id, r.body) : db[op](access(r), kind, id, r.body, key(r))); });
    route('GET', '/vocabulary', r => { query(r, []); return ok(db.vocabulary(access(r))); });
    route('GET', '/media', r => ok(db.mediaList(access(r), query(r, ['page', 'pageSize']))));
    async function upload(r: FastifyRequest, proofId?: string) { const a = access(r); const who = db.identity(a); db.rate(`upload:${who.id}`, 10, 600000); if (!Buffer.isBuffer(r.body))
        throw new AdminError('INVALID_INPUT', '请发送图片二进制'); const file = await storage.put(r.body); try {
        return proofId ? db.proof(a, proofId, file) : db.stageMedia(a, file);
    }
    catch (e) {
        await storage.discard(file.objectKey).catch(() => { });
        throw e;
    } }
    route('POST', '/media', async (r, reply) => reply.code(201).send(ok(await upload(r))), 5 * 1024 * 1024);
    route('PUT', '/media/:id/proof', r => upload(r, idOf(params(r).id)).then(ok), 5 * 1024 * 1024);
    route('PATCH', '/media/:id/license', r => ok(db.license(access(r), idOf(params(r).id), r.body)));
    route('POST', '/media/:id/review', r => ok(db.reviewMedia(access(r), idOf(params(r).id), r.body)));
    route('POST', '/media/:id/revoke', r => ok(db.revokeMedia(access(r), idOf(params(r).id), r.body, key(r))));
    async function sendMedia(r: FastifyRequest, reply: FastifyReply, a: Access | null) { const p = params(r); const id = idOf(p.id); if (!['original', 'thumbnail', 'proof'].includes(String(p.variant)))
        throw new AdminError('NOT_FOUND', '媒体不可用'); return mediaReply(reply, await readMedia(o.database, storage, id, p.variant as 'original' | 'thumbnail' | 'proof', a)); }
    route('GET', '/media/:id/:variant', (r, reply) => sendMedia(r, reply, access(r)));
    app.get('/api/v1/media/:id/:variant', async (r, reply) => { try {
        return await sendMedia(r, reply, null);
    }
    catch (e) {
        return errorReply(e, r, reply);
    } });
    route('GET', '/audit', r => ok(db.audits(access(r), query(r, ['page', 'pageSize']))));
    route('GET', '/accounts', r => ok(db.accounts(access(r), query(r, ['page', 'pageSize']))));
    route('POST', '/accounts/:id/disable', r => ok(db.disable(access(r), idOf(params(r).id), r.body, key(r))));
    route('POST', '/backups', (r, reply) => { const a = access(r); db.identity(a, true); const result = db.queueBackup(a, r.body, key(r)); if (result.state === 'queued') {
        const job = runBackup(o.database, a, result.jobId, storage, o.backupRoot).catch(() => { });
        jobs.add(job);
        void job.finally(() => jobs.delete(job));
    } return reply.code(202).send(ok(result)); });
    route('GET', '/backups/:id', r => ok(db.backupStatus(access(r), idOf(params(r).id))));
}
