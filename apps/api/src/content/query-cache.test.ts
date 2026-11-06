import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { crafts, templates, exhibits, stories } from '@shoushang/fixtures';
import { ContentDatabase } from '../database';
import type { ContentKind } from '../database';
import { PublicContentService, contentRoutes } from './index';
import { OFFICIAL_ADDITIVE_TEMPLATES } from './official-templates';
import { referenceSnapshot, referenceExhibits } from './query-reference';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'm14-query-cache-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'content.sqlite'), db = new ContentDatabase({ path }); cleanup.push(() => db.close());
  for (const [kind, rows] of [['craft', crafts], ['template', templates], ['exhibit', exhibits], ['story', stories]] as const) for (const row of rows) publish(db, kind, row);
  return { db, path, service: new PublicContentService(db) };
}
function publish<T extends { id: string }>(db: ContentDatabase, kind: ContentKind, row: T, latest: number | null = null, previous: number | null = null) {
  const revision = db.createRevision(kind, row, latest, 'query-test'); db.submit(kind, row.id, revision, 'query-test'); db.publish(kind, row.id, revision, previous, 'query-test'); return revision;
}
function worker(input: unknown) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('apps/api/src/content/query-worker.ts')], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  expect(result.status, result.stderr).toBe(0); expect(result.stdout).toBe('ok');
}
function referenceWithOfficial(db: ContentDatabase) {
  const snapshot = referenceSnapshot(db);
  const active = new Set(snapshot.crafts.filter(craft => craft.status === 'active' && craft.supportsExperience).map(craft => craft.id));
  return { ...snapshot, templates: [...snapshot.templates, ...OFFICIAL_ADDITIVE_TEMPLATES.filter(template => active.has(template.craftId) && !snapshot.templates.some(item => item.id === template.id))].sort((a, b) => a.id.localeCompare(b.id, 'en-US')) };
}
describe('M14-2A public snapshot coherence and ownership', () => {
  it('matches the original validated pipeline for cold/repeated queries, intersections, literal search, sorting and huge pages', () => {
    const { db, service } = setup();
    for (let i = 0; i < 27; i++) publish(db, 'exhibit', { ...exhibits[0]!, id: `case-${String(i).padStart(2, '0')}`, title: i % 2 ? "中文 %_' OR A&B" : 'ABC', category: i % 3 ? '甲' : '乙', tags: [i % 2 ? '奇' : '偶'], sortOrder: i % 4 });
    const queries = [{}, { page: 2, pageSize: 12 }, { page: 3, pageSize: 12 }, { q: '  AbC ' }, { q: "%_' OR", category: '甲', tag: '奇', craftId: crafts[0]!.id }, { tag: 'missing' }, { page: Number.MAX_SAFE_INTEGER, pageSize: 50 }];
    expect(service.snapshot()).toEqual(referenceWithOfficial(db));
    for (const query of queries) { expect(service.listExhibits(query)).toEqual(referenceExhibits(db, query)); expect(service.listExhibits(query)).toEqual(referenceExhibits(db, query)); }
    expect(service.listStories().items).toEqual(referenceSnapshot(db).stories); expect(service.listTemplates().items).toEqual(referenceWithOfficial(db).templates);
    expect(service.home()).toEqual({ exhibits: referenceSnapshot(db).exhibits.slice(0, 6), stories: referenceSnapshot(db).stories.slice(0, 3) });
  });
  it('keeps old public content during drafts/pending, then invalidates same-connection publication, withdrawal and revocation', () => {
    const { db, service } = setup(), exhibit = exhibits[0]!;
    const original = service.snapshot();
    const revision = db.createRevision('exhibit', { ...exhibit, title: '新版' }, 1, 'query-test');
    expect(service.snapshot()).toEqual(original); db.submit('exhibit', exhibit.id, revision, 'query-test'); expect(service.snapshot()).toEqual(original);
    db.publish('exhibit', exhibit.id, revision, 1, 'query-test'); expect(service.home().exhibits[0]?.title).toBe('新版');
    db.unpublish('exhibit', exhibit.id, revision, 'query-test'); expect(service.listExhibits()).toMatchObject({ total: 0, items: [] });
    expect(service.listStories().items[0]?.exhibitIds).toEqual([]);
    db.revokeMedia(stories[0]!.cover.id, 'query-test'); expect(service.home()).toEqual({ exhibits: [], stories: [] });
  });
  it('invalidates for a second connection including template disable, craft archive and association removal', () => {
    const { db, path, service } = setup(), other = new ContentDatabase({ path }); cleanup.push(() => other.close());
    expect(service.listExhibits().items[0]?.templateIds).toHaveLength(1);
    publish(other, 'template', { ...templates[0]!, version: 2, enabled: false }, 1, 1);
    expect(service.listTemplates().total).toBe(1); expect(service.listExhibits().items[0]?.templateIds).toEqual([]); expect(service.listStories().items[0]?.templateId).toBeUndefined();
    publish(other, 'template', { ...templates[0]!, version: 3 }, 2, 2); expect(service.listTemplates().total).toBe(2);
    publish(other, 'craft', { ...crafts[0]!, status: 'archived' }, 1, 1); expect(service.listTemplates().total).toBe(0); expect(service.listExhibits().total).toBe(1);
    other.unpublish('story', stories[0]!.id, 1, 'query-test'); expect(service.listExhibits().items[0]?.storyIds).toEqual([]);
    other.revokeMedia(exhibits[0]!.media[0]!.id, 'query-test'); expect(service.home()).toEqual({ exhibits: [], stories: [] });
    expect(db.readPublicSnapshot().rows.length).toBeGreaterThan(0);
  });
  it('refreshes an already-running real HTTP service after independent-process publish, unpublish and media revoke', async () => {
    const { db, path } = setup(), app = Fastify(); await app.register(contentRoutes, { database: db });
    const address = await app.listen({ host: '127.0.0.1', port: 0 }); cleanup.push(() => app.close());
    const read = async () => (await (await fetch(`${address}/api/v1/exhibits`)).json()) as { value: { items: { title: string }[]; total: number } };
    expect((await read()).value.total).toBe(1);
    worker({ path, operation: 'publish', kind: 'exhibit', id: exhibits[0]!.id, payload: { ...exhibits[0]!, title: '独立进程新版本' }, latest: 1, previous: 1 });
    expect((await read()).value.items[0]?.title).toBe('独立进程新版本');
    worker({ path, operation: 'unpublish', kind: 'exhibit', id: exhibits[0]!.id, previous: 2 }); expect((await read()).value).toMatchObject({ total: 0, items: [] });
    const story = async () => (await (await fetch(`${address}/api/v1/stories`)).json()) as { value: { total: number } };
    expect((await story()).value.total).toBe(1);
    worker({ path, operation: 'revoke', id: stories[0]!.cover.id }); expect((await story()).value.total).toBe(0);
  });
  it('never exposes rolled-back public pointers, either on the same connection or after an external rollback', () => {
    const { db, path, service } = setup(), old = service.snapshot();
    const revision = db.createRevision('exhibit', { ...exhibits[0]!, title: '不能提交' }, 1, 'query-test'); db.submit('exhibit', exhibits[0]!.id, revision, 'query-test');
    const raw = new DatabaseSync(path); cleanup.push(() => raw.close());
    raw.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON content_events WHEN NEW.action='publish' BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END;");
    expect(() => db.publish('exhibit', exhibits[0]!.id, revision, 1, 'query-test')).toThrow('injected transaction failure');
    expect(service.snapshot()).toEqual(old);
    raw.exec("BEGIN IMMEDIATE;UPDATE entities SET public_revision=NULL WHERE kind='exhibit';ROLLBACK;"); expect(service.snapshot()).toEqual(old);
    raw.exec('DROP TRIGGER injected_failure'); db.publish('exhibit', exhibits[0]!.id, revision, 1, 'query-test'); expect(service.listExhibits().items[0]?.title).toBe('不能提交');
  });
  it('pins the version and raw data to one WAL read snapshot even if another connection commits during the read', () => {
    const { db, path, service } = setup(); service.snapshot();
    const raw = new DatabaseSync(path), writer = new DatabaseSync(path); cleanup.push(() => writer.close()); cleanup.push(() => raw.close());
    raw.exec('BEGIN'); raw.prepare('SELECT id FROM entities LIMIT 1').get();
    const version = raw.prepare('PRAGMA data_version').get()!.data_version;
    writer.prepare("UPDATE entities SET public_revision=NULL WHERE kind='exhibit'").run();
    expect(raw.prepare('PRAGMA data_version').get()!.data_version).toBe(version);
    expect(raw.prepare("SELECT public_revision FROM entities WHERE kind='exhibit'").get()!.public_revision).toBe(1);
    raw.exec('COMMIT'); expect(raw.prepare('PRAGMA data_version').get()!.data_version).not.toBe(version);
    expect(service.listExhibits()).toMatchObject({ items: [], total: 0 });
    expect(db.readPublicSnapshotSince().snapshot?.rows.some(row => row.kind === 'exhibit')).toBe(false);
  });
  it('isolates database instances/restarts and does not serve a cached response after close', () => {
    const a = setup(), b = setup(); expect(a.service.home().exhibits.map(e => e.id)).toEqual(b.service.home().exhibits.map(e => e.id));
    publish(b.db, 'exhibit', { ...exhibits[0]!, title: '仅B实例' }, 1, 1);
    expect(b.service.home().exhibits[0]?.title).toBe('仅B实例'); expect(a.service.home().exhibits[0]?.title).toBe(exhibits[0]!.title);
    a.db.revokeMedia(exhibits[0]!.media[0]!.id, 'query-test'); expect(a.service.listExhibits().total).toBe(0); expect(b.service.listExhibits().total).toBe(1);
    const token = b.db.readPublicSnapshotSince().version; expect(a.db.readPublicSnapshotSince(token).snapshot).not.toBeNull();
    a.db.close(); expect(() => a.service.home()).toThrow(); const reopened = new ContentDatabase({ path: a.path }); cleanup.push(() => reopened.close());
    expect(new PublicContentService(reopened).home()).toEqual({ exhibits: [], stories: [] });
  });
  it('cannot label old rows with a later commit when a writer commits between version checking and row retrieval', () => {
    const { path, service } = setup(), writer = new ContentDatabase({ path }); cleanup.push(() => writer.close());
    const prepare = DatabaseSync.prototype.prepare; let injected = false;
    const interception = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (!injected && sql.startsWith('SELECT e.kind,r.payload')) {
        injected = true; writer.unpublish('exhibit', exhibits[0]!.id, 1, 'query-test');
      }
      return prepare.call(this, sql); // Actual SQL still reads the pinned pre-commit WAL snapshot.
    });
    try { expect(service.listExhibits().total).toBe(1); } finally { interception.mockRestore(); }
    expect(service.listExhibits()).toMatchObject({ total: 0, items: [] });
    expect(service.home().exhibits).toEqual([]); expect(service.listStories().items[0]?.exhibitIds).toEqual([]);
  });
  it('returns independent nested values from snapshot, list, home and templates without leaking private fields', () => {
    const { service } = setup(), original = service.snapshot(), list = service.listExhibits(), home = service.home(), template = service.listTemplates();
    list.items[0]!.media[0]!.license.name = '污染'; list.items[0]!.tags.push('污染'); home.exhibits[0]!.sources[0]!.title = '污染'; template.items[0]!.geometry.allowedRegion[0]!.x = 0.99;
    const copy = service.snapshot(); copy.exhibits.splice(0); expect(service.snapshot()).toEqual(original);
    expect(JSON.stringify(service.snapshot())).not.toMatch(/proofRef|passwordHash|tokenDigest|actor_id|private-proof/);
  });
  it('retains full behavior for oversized uncached public data and still isolates returned values', () => {
    const { db, service } = setup(), description = '界'.repeat(3 * 1024 * 1024);
    publish(db, 'exhibit', { ...exhibits[0]!, description }, 1, 1);
    const first = service.listExhibits(); expect(first.items[0]?.description.length).toBe(description.length); first.items[0]!.description = '污染';
    expect(service.listExhibits().items[0]?.description.length).toBe(description.length);
    db.revokeMedia(exhibits[0]!.media[0]!.id, 'query-test'); expect(service.listExhibits().total).toBe(0);
  });
  it('keeps invalid query errors, fresh request IDs, no-store and fail-closed behavior with a warm cache', async () => {
    const { db, service } = setup(); service.home(); expect(() => service.listExhibits({ page: 0 })).toThrow();
    const app = Fastify(); await app.register(contentRoutes, { database: db }); cleanup.push(() => app.close());
    const first = await app.inject('/api/v1/exhibits'), repeat = await app.inject('/api/v1/exhibits');
    expect(first.json()).toEqual(repeat.json()); expect(first.headers['x-request-id']).not.toBe(repeat.headers['x-request-id']); expect(repeat.headers['cache-control']).toBe('no-store');
    for (const path of ['?page=0', '?page=1&page=2', '?page=9007199254740992', '?pageSize=51', '?unknown=1']) expect((await app.inject('/api/v1/exhibits' + path)).statusCode).toBe(400);
    expect((await app.inject('/api/v1/exhibits?q=%20')).statusCode).toBe(200); // Empty normalized keyword remains legal.
    const raw = new DatabaseSync(db.path); cleanup.push(() => raw.close());
    raw.exec("UPDATE revisions SET state='draft' WHERE kind='exhibit'"); expect((await app.inject('/api/v1/exhibits')).json().value.total).toBe(0);
    db.close(); const failed = await app.inject('/api/v1/exhibits'); expect(failed.statusCode).toBe(500); expect(failed.body).not.toMatch(/SELECT|sqlite|stack|proof/i);
  });
  it('detects M13 draft writes and maintenance locking without mutating the existing public revision', () => {
    const { db, service } = setup(), old = service.snapshot(), account = db.admin.maintenanceAccount('cache-admin', 'admin', 'scrypt$test-boundary');
    const tokenDigest = randomUUID(); db.admin.login(account, 1, tokenDigest, randomUUID(), null, randomUUID()); const access = { tokenDigest, requestId: randomUUID() };
    db.admin.save(access, 'exhibit', exhibits[0]!.id, { title: '后台未发布修订' }, 1); expect(service.snapshot()).toEqual(old);
    const job = db.admin.queueBackup(access, { reason: '缓存维护锁验证' }, randomUUID()); db.admin.startBackup(access, job.jobId);
    expect(() => db.revokeMedia(exhibits[0]!.media[0]!.id, 'query-test')).toThrow('维护'); expect(service.snapshot()).toEqual(old);
    db.admin.finishBackup(job.jobId, 'isolated-manifest'); db.revokeMedia(exhibits[0]!.media[0]!.id, 'query-test'); expect(service.home()).toEqual({ exhibits: [], stories: [] });
  });
  it('observes same-connection M13 publication, failed publication rollback, unpublish and approved media revocation', () => {
    const { db, path, service } = setup(), account = db.admin.maintenanceAccount('command-admin', 'admin', 'scrypt$test-boundary');
    const tokenDigest = randomUUID(); db.admin.login(account, 1, tokenDigest, randomUUID(), null, randomUUID()); const access = { tokenDigest, requestId: randomUUID() };
    const file = { objectKey: randomUUID(), format: 'png', width: 100, height: 100, originalHash: 'a'.repeat(64), thumbnailHash: 'b'.repeat(64) };
    // DB-boundary fixture metadata only; normal browser regression separately decodes real images.
    const media = db.admin.stageMedia(access, file);
    db.admin.license(access, media.id, { expectedRevision: 1, alt: '隔离示意', author: '测试自制', source: '软件测试', licenseType: '隔离测试', usageScope: 'site-display-and-thumbnail', attribution: '测试', kind: 'illustration' });
    db.admin.proof(access, media.id, { ...file, objectKey: randomUUID() });
    db.admin.reviewMedia(access, media.id, { expectedRevision: 3, decision: 'approved', reason: '测试许可核对', verifiedScope: 'site-display-and-thumbnail' });
    const { id: _id, revision: _revision, updatedAt: _updatedAt, media: _media, ...draft } = exhibits[0]!;
    void _id; void _revision; void _updatedAt; void _media;
    const candidate = db.admin.save(access, 'exhibit', null, { ...draft, category: '开发示意', tags: ['开发示意'], storyIds: [], mediaIds: [media.id], title: '后台公开' }, null);
    const old = service.snapshot(); expect(old.exhibits.some(e => e.id === candidate.id)).toBe(false);
    db.admin.submit(access, 'exhibit', candidate.id, { revision: 1, expectedLatest: 1 });
    const review = db.admin.review(access, 'exhibit', candidate.id, { revision: 1, expectedLatest: 1, decision: 'approved', evidence: { sources: '仅隔离软件样例来源' } });
    const request = { revision: 1, expectedLatest: 1, expectedPublic: null, reviewId: review.reviewId };
    const raw = new DatabaseSync(path); cleanup.push(() => raw.close());
    raw.exec("CREATE TRIGGER fail_admin_publication BEFORE INSERT ON admin_audit WHEN NEW.action='publish' BEGIN SELECT RAISE(ABORT,'injected M13 audit failure'); END;");
    expect(() => db.admin.publish(access, 'exhibit', candidate.id, request, randomUUID())).toThrow(); expect(service.snapshot()).toEqual(old);
    raw.exec('DROP TRIGGER fail_admin_publication');
    db.admin.publish(access, 'exhibit', candidate.id, request, randomUUID()); expect(service.listExhibits().items.some(e => e.id === candidate.id)).toBe(true);
    db.admin.unpublish(access, 'exhibit', candidate.id, { expectedLatest: 1, expectedPublic: 1, reason: '测试下架' }, randomUUID());
    expect(service.listExhibits().items.some(e => e.id === candidate.id)).toBe(false);
    // Republish through a new legacy revision referencing the very same controlled media DTO.
    const original = { ...exhibits[0]!, id: 'controlled-reference', media: [{ id: media.id, url: `/api/v1/media/${media.id}/original`, alt: '隔离示意', author: '测试自制', license: { name: '隔离测试', attribution: '测试' }, width: 100, height: 100, kind: 'illustration' as const }] };
    publish(db, 'exhibit', original); expect(service.listExhibits().items.some(e => e.id === original.id)).toBe(true);
    db.admin.revokeMedia(access, media.id, { expectedRevision: 4, reason: '测试撤权' }, randomUUID());
    expect(service.listExhibits().items.some(e => e.id === original.id)).toBe(false);
  });
});
