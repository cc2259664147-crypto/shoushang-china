import { ContentQuerySchema } from '@shoushang/contracts';
import type { ApiError, ContentClient, ContentQuery, Page, Result } from '@shoushang/contracts';
import { crafts, exhibits, stories, templates } from '@shoushang/fixtures';

export type MockScenario = 'normal' | 'empty' | 'failure';
function fail(code: ApiError['code'], message: string): { ok: false; error: ApiError } {
  return { ok: false, error: { code, message, requestId: 'mock-content-request', fieldErrors: [] } };
}
/** Factory-scoped deterministic fault injection; no random failure or hidden global switch. */
export function createMockContentClient(scenario: MockScenario = 'normal'): ContentClient {
  const copy = <T>(value: T): Result<T> => ({ ok: true, value: structuredClone(value) });
  const unavailable = () => fail('NETWORK_ERROR', '开发测试：指定接口失败');
  function list<T>(rows: readonly T[], query: ContentQuery, matches: (row: T, q: ReturnType<typeof ContentQuerySchema.parse>) => boolean): Result<Page<T>> {
    const parsed = ContentQuerySchema.safeParse(query);
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: '查询参数非法', requestId: 'mock-content-request', fieldErrors: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } };
    if (scenario === 'failure') return unavailable();
    const q = parsed.data;
    const filtered = scenario === 'empty' ? [] : rows.filter(row => matches(row, q));
    return copy({ items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: filtered.length, page: q.page, pageSize: q.pageSize });
  }
  function get<T extends { id: string }>(rows: readonly T[], id: string): Result<T> {
    if (scenario === 'failure') return unavailable();
    const row = scenario === 'empty' ? undefined : rows.find(r => r.id === id);
    return row ? copy(row) : fail('NOT_FOUND', '内容不存在或不可公开访问');
  }
  return {
    mode: 'mock',
    async listCrafts() { return scenario === 'failure' ? unavailable() : copy(scenario === 'empty' ? [] : crafts); },
    async listTemplates(q = {}) { return list(templates.filter(t => t.enabled), q, (r, f) => (!f.craftId || r.craftId === f.craftId) && (!f.q || r.name.toLowerCase().includes(f.q))); },
    async getTemplate(id) { return get(templates.filter(t => t.enabled), id); },
    async listExhibits(q = {}) { return list([...exhibits].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)), q, (r, f) =>
      (!f.craftId || r.craftId === f.craftId) && (!f.category || r.category === f.category) && (!f.tag || r.tags.includes(f.tag)) && (!f.q || [r.title, r.summary, ...r.tags].join(' ').toLowerCase().includes(f.q))); },
    async getExhibit(id) { return get(exhibits, id); },
    async listStories(q = {}) { return list([...stories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)), q, (r, f) => (!f.craftId || r.craftIds.includes(f.craftId)) && (!f.q || [r.title, r.summary, r.personName].join(' ').toLowerCase().includes(f.q))); },
    async getStory(id) { return get(stories, id); },
    async getHome() { return scenario === 'failure' ? unavailable() : copy({ exhibits: scenario === 'empty' ? [] : exhibits, stories: scenario === 'empty' ? [] : stories }); },
  };
}
export { createHttpContentClient } from './http';
export type { HttpContentClientOptions } from './http';
export { generateUuid } from './uuid';
export type { UuidCrypto } from './uuid';
