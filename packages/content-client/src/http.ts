import { ApiErrorSchema, ContentQuerySchema, CraftSchema, ExhibitSchema, IdSchema, PublicTemplateSchema, StorySchema, pageSchema } from '@shoushang/contracts';
import type { ApiError, ContentClient, ContentQuery, Result } from '@shoushang/contracts';
import { generateUuid } from './uuid';

export interface HttpContentClientOptions {
  /** Absolute http(s) origin or deployment prefix; browser defaults to location.origin. Excludes /api/v1. */
  baseUrl?: string;
  /** Lifetime cancellation for this adapter instance; use a separate instance for each cancellation scope. */
  signal?: AbortSignal;
  /** Total operation budget INCLUDING body and the optional retry. Default/max 10000ms. */
  timeoutMs?: number;
}
interface Validator<T> { safeParse(value: unknown): { success: true; data: T } | { success: false } }
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }
const homeSchema = {
  safeParse(value: unknown) {
    const row = object(value);
    const exhibits = ExhibitSchema.array().safeParse(row?.exhibits), stories = StorySchema.array().safeParse(row?.stories);
    if (!row || !exact(row, ['exhibits', 'stories']) || !exhibits.success || !stories.success) return { success: false } as const;
    return { success: true, data: { exhibits: exhibits.data, stories: stories.data } } as const;
  },
};
const statusCodes: Readonly<Record<number, ApiError['code']>> = {
  400: 'INVALID_INPUT', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'REVISION_CONFLICT',
  413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 502: 'INTERNAL_ERROR', 503: 'INTERNAL_ERROR', 504: 'INTERNAL_ERROR',
};
const fail = (code: ApiError['code'], message: string, requestId: string): { ok: false; error: ApiError } => ({ ok: false, error: { code, message, requestId, fieldErrors: [] } });

export function createHttpContentClient(options: HttpContentClientOptions = {}): ContentClient {
  const timeoutMs = options.timeoutMs ?? 10000;
  const signal = options.signal;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) throw new Error('timeoutMs must be within (0,10000]');
  const base = new URL(options.baseUrl ?? (typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:3001'));
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid content base URL');
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;

  async function request<T>(path: string, schema: Validator<T>, query?: ContentQuery, id?: string, detailRequest = false): Promise<Result<T>> {
    const localId = `http-client-${generateUuid()}`;
    const parsedQuery = ContentQuerySchema.safeParse(query === undefined ? {} : query);
    if (!parsedQuery.success || (detailRequest && !IdSchema.safeParse(id).success)) return fail('INVALID_INPUT', '内容请求参数非法', localId);
    const url = new URL(`api/v1/${path}${id !== undefined ? `/${encodeURIComponent(id)}` : ''}`, base);
    if (query !== undefined) for (const [key, value] of Object.entries(parsedQuery.data)) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const deadline = performance.now() + timeoutMs;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) return fail('ABORTED', '内容请求已取消', localId);
        if (timedOut || performance.now() >= deadline) return fail('TIMEOUT', '内容请求超时', localId);
        let response: Response;
        let body: string;
        try {
          response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal, cache: 'no-store', redirect: 'manual', credentials: 'omit' });
          body = await response.text(); // Timer and abort listener stay live through complete body read.
        } catch {
          if (signal?.aborted) return fail('ABORTED', '内容请求已取消', localId);
          if (timedOut || performance.now() >= deadline) return fail('TIMEOUT', '内容请求超时', localId);
          if (attempt === 0) continue; // Transport connection/body interruption only.
          return fail('NETWORK_ERROR', '无法连接内容服务', localId);
        }
        if (signal?.aborted) return fail('ABORTED', '内容请求已取消', localId);
        if (timedOut || performance.now() >= deadline) return fail('TIMEOUT', '内容请求超时', localId);
        let decoded: unknown;
        try { decoded = JSON.parse(body); } catch { return fail('NETWORK_ERROR', '内容响应不是有效 JSON', localId); }
        const envelope = object(decoded);
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !envelope) return fail('NETWORK_ERROR', '内容响应格式不匹配', localId);
        if (response.status === 200 && envelope.ok === true && exact(envelope, ['ok', 'value'])) {
          const value = schema.safeParse(envelope.value);
          if (!value.success) return fail('NETWORK_ERROR', '内容响应校验失败', localId);
          const detail = object(value.data);
          if (id !== undefined && detail?.id !== id) return fail('NETWORK_ERROR', '内容响应 ID 不匹配', localId);
          if (query !== undefined && (detail?.page !== parsedQuery.data.page || detail?.pageSize !== parsedQuery.data.pageSize)) return fail('NETWORK_ERROR', '内容响应分页不匹配', localId);
          return { ok: true, value: value.data };
        }
        if (envelope.ok === false && exact(envelope, ['ok', 'error'])) {
          const error = ApiErrorSchema.safeParse(envelope.error);
          if (!error.success || statusCodes[response.status] !== error.data.code) return fail('NETWORK_ERROR', 'HTTP 状态与错误结构不匹配', localId);
          if (attempt === 0 && [502, 503, 504].includes(response.status)) continue;
          return { ok: false, error: error.data };
        }
        return fail('NETWORK_ERROR', 'HTTP 状态与响应语义不匹配', localId);
      }
      return fail('NETWORK_ERROR', '无法连接内容服务', localId);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    mode: 'http',
    listCrafts: () => request('crafts', CraftSchema.array()),
    listTemplates: (q = {}) => request('templates', pageSchema(PublicTemplateSchema), q),
    getTemplate: id => request('templates', PublicTemplateSchema, undefined, id, true),
    listExhibits: (q = {}) => request('exhibits', pageSchema(ExhibitSchema), q),
    getExhibit: id => request('exhibits', ExhibitSchema, undefined, id, true),
    listStories: (q = {}) => request('stories', pageSchema(StorySchema), q),
    getStory: id => request('stories', StorySchema, undefined, id, true),
    getHome: () => request('home', homeSchema),
  };
}
