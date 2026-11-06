import { ApiErrorSchema } from '@shoushang/contracts';
import type { ApiError } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
export class AdminHttpError extends Error {
    constructor(readonly detail: ApiError, readonly status: number) { super(detail.message); }
}
export function asRecord(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('管理接口响应格式不正确'); return v as Record<string, unknown>; }
export function asItems(v: unknown): Record<string, unknown>[] { const p = asRecord(v); if (!Array.isArray(p.items))
    throw new Error('管理列表响应格式不正确'); return p.items.map(asRecord); }
function stable(v: unknown): string { if (Array.isArray(v))
    return `[${v.map(stable).join(',')}]`; if (v && typeof v === 'object')
    return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`; return JSON.stringify(v) ?? 'null'; }
export interface AdminClient {
    call(method: string, path: string, body?: unknown, idempotent?: boolean | string): Promise<unknown>;
    session(): Promise<Record<string, unknown>>;
    login(username: string, password: string): Promise<Record<string, unknown>>;
    logout(): Promise<void>;
}
export function createAdminHttpClient(options: {
    baseUrl?: string;
    signal?: AbortSignal;
} = {}): AdminClient {
    const base = new URL(options.baseUrl ?? window.location.origin);
    if (base.origin !== window.location.origin || base.pathname !== '/' || base.search || base.hash || base.username || base.password)
        throw new Error('管理接口必须同源');
    let csrf = '';
    const keys = new Map<string, string>();
    async function call(method: string, path: string, body?: unknown, idempotent: boolean | string = false): Promise<unknown> {
        if (!/^\/[a-zA-Z0-9_/?=&%-]+$/u.test(path) || path.includes('..') || path.startsWith('//'))
            throw new Error('管理接口路径不正确');
        const signature = method + path + stable(body);
        let key = typeof idempotent === 'string' ? idempotent : keys.get(signature);
        if (idempotent && !key) {
            if (keys.size >= 100)
                throw new Error('待确认操作过多，请先确认原操作结果');
            key = generateUuid();
            keys.set(signature, key);
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted)
            controller.abort();
        const timer = setTimeout(abort, 10000);
        const complete = () => { if (idempotent === true && keys.get(signature) === key) keys.delete(signature); };
        try {
            const response = await fetch(new URL('/api/v1/admin' + path, base), { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { ...(body === undefined ? {} : { 'content-type': body instanceof Blob ? 'application/octet-stream' : 'application/json' }), ...(method === 'GET' ? {} : { 'x-csrf-token': csrf }), ...(idempotent ? { 'idempotency-key': key! } : {}) }, ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }) });
            if (response.status === 204 && method === 'DELETE') { complete(); return undefined; }
            const raw: unknown = await response.json();
            const envelope = asRecord(raw);
            if (Object.keys(envelope).sort().join(',') !== (envelope.ok === true ? 'ok,value' : 'error,ok'))
                throw new Error('管理接口响应格式不正确');
            if (envelope.ok === false) {
                const parsed = ApiErrorSchema.safeParse(envelope.error);
                if (!parsed.success)
                    throw new Error('管理接口错误格式不正确');
                if (response.ok)
                    throw new Error('管理接口状态不一致');
                if (response.status >= 400 && response.status < 500) complete();
                throw new AdminHttpError(parsed.data, response.status);
            }
            if (envelope.ok !== true || !response.ok)
                throw new Error('管理接口状态不正确');
            complete();
            return envelope.value;
        }
        catch (e) {
            if (controller.signal.aborted)
                throw new Error('请求超时或已取消；请保留输入并确认结果后重试');
            throw e;
        }
        finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
        }
    }
    function sessionValue(value: unknown) { const p = asRecord(value), a = asRecord(p.account); if (typeof a.id !== 'string' || typeof a.username !== 'string' || !['admin', 'editor'].includes(String(a.role)) || typeof p.csrfToken !== 'string' || typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.expiresAt)))
        throw new Error('会话响应格式不正确'); csrf = p.csrfToken; return p; }
    return { call, session: async () => sessionValue(await call('GET', '/session')), login: async (username, password) => { const challenge = asRecord(await call('GET', '/csrf')); if (typeof challenge.csrfToken !== 'string')
            throw new Error('登录验证响应不正确'); csrf = challenge.csrfToken; return sessionValue(await call('POST', '/session', { username, password })); }, logout: async () => { await call('DELETE', '/session'); csrf = ''; } };
}
