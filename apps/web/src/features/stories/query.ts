import { ContentQuerySchema } from '@shoushang/contracts';
import type { ContentQuery } from '@shoushang/contracts';
export function parseStoryQuery(search: string) {
  const params = new URLSearchParams(search);
  const input: Record<string, unknown> = { pageSize: 12 };
  for (const key of ['craftId', 'page']) {
    const values = params.getAll(key);
    if (values.length > 1) return { ok: false as const, error: `${key} 不可重复` };
    if (!values.length) continue;
    const raw = values[0]!;
    if (!raw.trim()) return { ok: false as const, error: `${key} 不能为空` };
    if (key === 'page') {
      if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return { ok: false as const, error: 'page 必须是从 1 开始的安全整数' };
      input[key] = Number(raw);
    } else input[key] = raw;
  }
  for (const key of params.keys()) if (!['craftId', 'page'].includes(key)) return { ok: false as const, error: `不支持的故事查询参数：${key}` };
  const result = ContentQuerySchema.safeParse(input);
  return result.success ? { ok: true as const, value: result.data } : { ok: false as const, error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') };
}
export function storiesUrl(query: ContentQuery = {}) {
  const params = new URLSearchParams();
  if (query.craftId) params.set('craftId', query.craftId);
  if (query.page && query.page !== 1) params.set('page', String(query.page));
  return `/stories${params.size ? `?${params}` : ''}`;
}
export function storyReturn(raw: string | null) {
  if (!raw || !raw.startsWith('/stories')) return '/stories';
  try { const url = new URL(raw, 'https://stories.invalid'); return url.origin === 'https://stories.invalid' && url.pathname === '/stories' && !url.hash && parseStoryQuery(url.search).ok ? url.pathname + url.search : '/stories'; } catch { return '/stories'; }
}
