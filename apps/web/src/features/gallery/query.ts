import { ContentQuerySchema } from '@shoushang/contracts';
import type { ContentClient, ContentQuery, Craft } from '@shoushang/contracts';

export function parseQuery(search: string) {
  const params = new URLSearchParams(search);
  const input: Record<string, unknown> = { pageSize: 12 };
  for (const key of ['q', 'craftId', 'category', 'tag', 'page']) {
    const values = params.getAll(key);
    if (values.length > 1) return { ok: false as const, error: `${key} 不可重复` };
    if (!values.length) continue;
    const raw = values[0]!;
    if (!raw.trim()) return { ok: false as const, error: `${key} 不能为空；请删除该参数或填写有效值` };
    if (key === 'page') {
      if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return { ok: false as const, error: 'page 必须是从 1 开始的安全整数' };
      input[key] = Number(raw);
    } else input[key] = raw;
  }
  const parsed = ContentQuerySchema.safeParse(input);
  return parsed.success ? { ok: true as const, value: parsed.data } : { ok: false as const, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') };
}
export function galleryUrl(query: ContentQuery = {}) {
  const p = new URLSearchParams();
  for (const key of ['q', 'craftId', 'category', 'tag'] as const) if (query[key]) p.set(key, query[key]!);
  if (query.page && query.page !== 1) p.set('page', String(query.page));
  return `/gallery${p.size ? `?${p}` : ''}`;
}
export function safeReturn(raw: string | null): string {
  if (!raw) return '/gallery';
  try {
    const u = new URL(raw, 'https://gallery.invalid');
    if (u.origin !== 'https://gallery.invalid' || u.hash || !['/gallery', '/my/favorites'].includes(u.pathname)) return '/gallery';
    if (u.pathname === '/gallery') return parseQuery(u.search).ok ? u.pathname + u.search : '/gallery';
    return u.search ? '/gallery' : '/my/favorites';
  } catch { return '/gallery'; }
}
export interface Vocabulary { crafts: Craft[]; categories: string[]; tags: string[] }
// No facet endpoint exists in v1. Exhaust all public pages, never infer facets from one page.
// Keep only vocabulary, no persistent media/content cache. M12 should supply a facet port.
export async function loadVocabulary(client: ContentClient): Promise<Vocabulary> {
  const crafts = await client.listCrafts();
  if (!crafts.ok) throw new Error(`${crafts.error.code}：${crafts.error.message}`);
  const categories = new Set<string>(), tags = new Set<string>();
  let total = 0, count = 0;
  for (let page = 1; ; page++) {
    const r = await client.listExhibits({ page, pageSize: 50 });
    if (!r.ok) throw new Error(`${r.error.code}：${r.error.message}`);
    if (page === 1) total = r.value.total;
    if (total !== r.value.total || (count < total && !r.value.items.length)) throw new Error('内容目录正在变化，请重试筛选选项');
    for (const e of r.value.items) { categories.add(e.category); e.tags.forEach(t => tags.add(t)); }
    count += r.value.items.length;
    if (count >= total) break;
  }
  return { crafts: crafts.value, categories: [...categories].sort(), tags: [...tags].sort() };
}
export async function mapLimited<T, U>(rows: readonly T[], run: (row: T) => Promise<U>, concurrency = 3): Promise<U[]> {
  const results: U[] = new Array(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (next < rows.length) { const index = next++; results[index] = await run(rows[index]!); }
  }));
  return results;
}

// Shared per client: StrictMode/re-entry may leave old requests in flight without AbortSignal.
const verificationQueues = new WeakMap<ContentClient, { active: number; waiting: (() => void)[] }>();
export async function verificationSlot<T>(client: ContentClient, run: () => Promise<T>): Promise<T> {
  let queue = verificationQueues.get(client);
  if (!queue) { queue = { active: 0, waiting: [] }; verificationQueues.set(client, queue); }
  if (queue.active >= 3) await new Promise<void>(resolve => queue.waiting.push(resolve));
  else queue.active++;
  try { return await run(); }
  finally { const next = queue.waiting.shift(); if (next) next(); else queue.active--; }
}
