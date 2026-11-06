import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ContentQuerySchema, IdSchema } from '@shoushang/contracts';
import type { ApiError, ContentQuery, Craft, Exhibit, Page, PublicTemplate, Story } from '@shoushang/contracts';
import type { ContentDatabase } from '../database';
import { publicCraft, publicExhibit, publicStory, publicTemplate } from './dto';
import { OFFICIAL_ADDITIVE_TEMPLATES } from './official-templates';

interface PublicSnapshot { crafts: Craft[]; templates: PublicTemplate[]; exhibits: Exhibit[]; stories: Story[] }
// One public-only snapshot per service, bounded by serialized size and row count.
// This is a retention budget, not a promise about total V8/process memory usage.
const MAX_CACHED_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_ROWS = 10000;
function freezeSnapshot(value: PublicSnapshot): PublicSnapshot {
  function freeze(object: object): void {
    for (const child of Object.values(object)) if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) freeze(child);
    Object.freeze(object);
  }
  freeze(value); return value;
}
export class PublicContentService {
  private cache: { version: string; value: PublicSnapshot } | undefined;
  constructor(private readonly database: ContentDatabase) {}
  /** Compatibility/testing boundary: callers always receive an independent value. */
  snapshot(): PublicSnapshot { return structuredClone(this.currentSnapshot()); }
  private currentSnapshot(): PublicSnapshot {
    const read = this.database.readPublicSnapshotSince(this.cache?.version);
    if (!read.snapshot && this.cache) return this.cache.value;
    // Invalidate before validation: corrupt new content must fail closed, not reuse old data.
    this.cache = undefined;
    const raw = read.snapshot;
    if (!raw) throw new Error('Missing public snapshot');
    const crafts: Craft[] = [], templates: PublicTemplate[] = [], exhibits: Exhibit[] = [], stories: Story[] = [];
    for (const row of raw.rows) {
      if (typeof row.payload !== 'string') throw new Error('Invalid stored content');
      const payload: unknown = JSON.parse(row.payload);
      switch (row.kind) {
        case 'craft': crafts.push(publicCraft(payload)); break;
        case 'template': templates.push(publicTemplate(payload)); break;
        case 'exhibit': exhibits.push(publicExhibit(payload)); break;
        case 'story': stories.push(publicStory(payload)); break;
      }
    }
    const revoked = new Set(raw.revokedMedia);
    const craftIds = new Set(crafts.map(c => c.id));
    const active = new Set(crafts.filter(c => c.status === 'active' && c.supportsExperience).map(c => c.id));
    const templateById = new Map(templates.filter(t => t.enabled && active.has(t.craftId)).map(template => [template.id, template]));
    for (const template of OFFICIAL_ADDITIVE_TEMPLATES) if (template.enabled && active.has(template.craftId) && !templateById.has(template.id)) templateById.set(template.id, template);
    const availableTemplates = [...templateById.values()].sort((a, b) => a.id.localeCompare(b.id, 'en-US'));
    const availableExhibits = exhibits.filter(e => craftIds.has(e.craftId) && e.media.every(m => !revoked.has(m.id)));
    const availableStories = stories.filter(s => s.craftIds.every(id => craftIds.has(id)) && !revoked.has(s.cover.id));
    const templateIds = new Set(availableTemplates.map(t => t.id));
    const exhibitIds = new Set(availableExhibits.map(e => e.id));
    const storyIds = new Set(availableStories.map(s => s.id));
    const value: PublicSnapshot = {
      crafts: crafts.sort((a, b) => a.id.localeCompare(b.id, 'en-US')),
      templates: availableTemplates,
      exhibits: availableExhibits.map(e => publicExhibit({ ...e, storyIds: e.storyIds.filter(id => storyIds.has(id)), templateIds: e.templateIds.filter(id => templateIds.has(id)) })).sort(compare),
      stories: availableStories.map(s => {
        const { templateId, ...rest } = s;
        return publicStory({ ...rest, exhibitIds: s.exhibitIds.filter(id => exhibitIds.has(id)), ...(templateId && templateIds.has(templateId) ? { templateId } : {}) });
      }).sort(compare),
    };
    if (raw.rows.length <= MAX_CACHED_ROWS && Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_CACHED_BYTES) {
      this.cache = { version: read.version, value: freezeSnapshot(value) };
    }
    return value;
  }
  listTemplates(query: ContentQuery = {}) {
    const q = ContentQuerySchema.parse(query);
    return structuredClone(paginate(this.currentSnapshot().templates.filter(r => (!q.craftId || r.craftId === q.craftId) && (!q.q || r.name.toLowerCase().includes(q.q))), q));
  }
  listExhibits(query: ContentQuery = {}) {
    const q = ContentQuerySchema.parse(query);
    return structuredClone(paginate(this.currentSnapshot().exhibits.filter(r => (!q.craftId || r.craftId === q.craftId) && (!q.category || r.category === q.category) && (!q.tag || r.tags.includes(q.tag)) && (!q.q || [r.title, r.summary, ...r.tags].join(' ').toLowerCase().includes(q.q))), q));
  }
  listStories(query: ContentQuery = {}) {
    const q = ContentQuerySchema.parse(query);
    return structuredClone(paginate(this.currentSnapshot().stories.filter(r => (!q.craftId || r.craftIds.includes(q.craftId)) && (!q.q || [r.title, r.summary, r.personName].join(' ').toLowerCase().includes(q.q))), q));
  }
  home() { const s = this.currentSnapshot(); return structuredClone({ exhibits: s.exhibits.slice(0, 6), stories: s.stories.slice(0, 3) }); }
}
function compare(a: { sortOrder: number; id: string }, b: { sortOrder: number; id: string }) { return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, 'en-US'); }
function paginate<T>(items: T[], q: { page: number; pageSize: number }): Page<T> {
  const offset = BigInt(q.page - 1) * BigInt(q.pageSize);
  return { items: offset >= BigInt(items.length) ? [] : items.slice(Number(offset), Number(offset) + q.pageSize), total: items.length, page: q.page, pageSize: q.pageSize };
}
class InvalidQuery extends Error {}
function queryFromUrl(url: string, allowQuery: boolean): ContentQuery {
  const params = new URL(url, 'http://local').searchParams;
  const record: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!allowQuery || !['q', 'craftId', 'category', 'tag', 'page', 'pageSize'].includes(key) || key in record) throw new InvalidQuery('查询参数不支持或重复');
    if (key === 'page' || key === 'pageSize') {
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new InvalidQuery('页码必须为安全正整数');
      record[key] = Number(value);
    } else record[key] = value;
  }
  const parsed = ContentQuerySchema.safeParse(record);
  if (!parsed.success) throw new InvalidQuery('查询参数非法');
  return parsed.data;
}

/** Mount with app.register(contentRoutes, {database}); lifecycle ownership stays with caller. */
export async function contentRoutes(app: FastifyInstance, options: { database: ContentDatabase }): Promise<void> {
  const service = new PublicContentService(options.database);
  // Encapsulated error handlers also cover malformed path encoding within this plugin.
  app.setErrorHandler((error, _request, reply) => {
    const requestId = randomUUID();
    const invalid = typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 400;
    if (!invalid) app.log.error({ err: error, requestId }, 'Public content request failed');
    reply.header('x-request-id', requestId).header('cache-control', 'no-store').code(invalid ? 400 : 500).send(failure(invalid ? 'INVALID_INPUT' : 'INTERNAL_ERROR', invalid ? '请求格式非法' : '内容服务暂时不可用', requestId));
  });
  const routes = ['home', 'crafts', 'templates', 'exhibits', 'stories'] as const;
  for (const resource of routes) {
    for (const detail of resource === 'home' || resource === 'crafts' ? [false] : [false, true]) {
      app.get(`/api/v1/${resource}${detail ? '/:id' : ''}`, async (request, reply) => {
        const requestId = randomUUID();
        reply.header('x-request-id', requestId).header('cache-control', 'no-store');
        try {
          const query = queryFromUrl(request.raw.url ?? '', !detail && resource !== 'home' && resource !== 'crafts');
          if (detail) {
            const id = IdSchema.safeParse(Object.fromEntries(Object.entries(request.params ?? {})).id);
            if (!id.success) throw new InvalidQuery('内容 ID 非法');
            const value = service.snapshot()[resource === 'templates' ? 'templates' : resource === 'exhibits' ? 'exhibits' : 'stories'].find(r => r.id === id.data);
            if (!value) return reply.code(404).send(failure('NOT_FOUND', '内容不存在或不可公开访问', requestId));
            return { ok: true, value };
          }
          const value = resource === 'home' ? service.home() : resource === 'crafts' ? service.snapshot().crafts : resource === 'templates' ? service.listTemplates(query) : resource === 'exhibits' ? service.listExhibits(query) : service.listStories(query);
          return { ok: true, value };
        } catch (error) {
          if (error instanceof InvalidQuery) return reply.code(400).send(failure('INVALID_INPUT', error.message, requestId));
          // Do not serialize SQL, payloads, private proofs or exceptions.
          app.log.error({ err: error, requestId }, 'Public content request failed');
          return reply.code(500).send(failure('INTERNAL_ERROR', '内容服务暂时不可用', requestId));
        }
      });
    }
  }
}
function failure(code: ApiError['code'], message: string, requestId: string) {
  return { ok: false, error: { code, message, requestId, fieldErrors: [] } };
}
