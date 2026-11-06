import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { crafts, exhibits, stories, templates } from '@shoushang/fixtures';
import { CraftSchema, ExhibitSchema, StorySchema, TemplateVersionSchema } from '@shoushang/contracts';
import { backupBeforeMigration, ContentDatabase, migrations, runMigrations } from '../database';
import type { ContentKind } from '../database';
import { developmentData } from '../database/development';
import { contentRoutes, PublicContentService } from './index';
import { publicCraft, publicExhibit, publicStory, publicTemplate } from './dto';

const dirs: string[] = [], databases: ContentDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'shoushang-m12-db-')); dirs.push(dir);
  const path = join(dir, 'content.sqlite');
  const database = new ContentDatabase({ path }); databases.push(database);
  return { database, dir, path, service: new PublicContentService(database) };
}
function publish<T extends { id: string }>(database: ContentDatabase, kind: ContentKind, row: T, latest: number | null = null, previous: number | null = null) {
  const revision = database.createRevision(kind, row, latest, 'test-actor', 'private-proof-do-not-publish');
  database.submit(kind, row.id, revision, 'test-actor'); database.publish(kind, row.id, revision, previous, 'test-actor');
  return revision;
}
function seed(db: ContentDatabase) { for (const [kind, rows] of [['craft', crafts], ['template', templates], ['exhibit', exhibits], ['story', stories]] as const) for (const row of rows) publish(db, kind, row); }

describe('real SQLite revisions, migration and restore', () => {
  it('requires development labels even for the canonical papercut craft and rejects unrelated identities', () => {
    const { database, service } = setup();
    const craft = CraftSchema.parse(developmentData.crafts[0]);
    const template = TemplateVersionSchema.parse(developmentData.templates[0]);
    const invalidDatasets = [
      { ...developmentData, crafts: [{ ...craft, name: '剪纸' }] },
      { ...developmentData, crafts: [{ ...craft, description: '正式内容说明' }] },
      { ...developmentData, crafts: [{ ...craft, id: 'craft-other' }] },
      { ...developmentData, crafts: [{ ...craft, slug: 'other' }] },
      { ...developmentData, templates: [{ ...template, id: 'template-paper' }] },
      { ...developmentData, templates: [{ ...template, name: '方纸' }] },
      { ...developmentData, templates: [{ ...template, digitalNotice: '正式模板' }] },
      { ...developmentData, exhibits: [{ ...ExhibitSchema.parse(exhibits[0]), developmentOnly: false }] },
      { ...developmentData, stories: [{ ...StorySchema.parse(stories[0]), developmentOnly: false }] },
    ];
    for (const dataset of invalidDatasets) {
      expect(() => database.initializeDevelopment(dataset)).toThrow('Development data must be explicitly labeled');
      expect(service.snapshot()).toEqual({ crafts: [], templates: [], exhibits: [], stories: [] });
    }
    expect(database.initializeDevelopment(developmentData)).toBe(true);
    expect(service.listTemplates({ craftId: 'craft-papercut' }).items.map(item => item.id)).toEqual(['template-dev-paper', 'template-v2-c04']);
  });
  it('refuses to seed an occupied database even when its content is explicitly development data', () => {
    const { database, service } = setup();
    const craft = CraftSchema.parse(developmentData.crafts[0]);
    publish(database, 'craft', craft);
    const before = service.snapshot();
    expect(() => database.initializeDevelopment(developmentData)).toThrow('requires an empty database');
    expect(service.snapshot()).toEqual(before);
  });
  it('initializes the versioned V1 base once and protects non-empty databases', () => {
    const { database, service } = setup();
    const releaseTemplates = [1, 2, 3].map(index => ({
      ...TemplateVersionSchema.parse(developmentData.templates[0]),
      id: `template-v1-test-${index}`,
      name: `V1 测试模板 ${index}`,
      digitalNotice: '项目数字练习，不等同于传统流派工序或实体剪裁保证。',
    }));
    expect(database.initializeBaseContent('v1-test-set', { crafts: developmentData.crafts, templates: releaseTemplates })).toBe(true);
    expect(service.snapshot().templates).toHaveLength(4);
    expect(database.initializeBaseContent('v1-test-set', { crafts: developmentData.crafts, templates: releaseTemplates })).toBe(false);
    const edited = { ...releaseTemplates[0]!, name: '用户维护修订', version: 2 };
    database.createRevision('template', edited, 1, 'test-editor');
    expect(database.initializeBaseContent('v1-test-set', { crafts: developmentData.crafts, templates: releaseTemplates })).toBe(false);
    expect(() => database.createRevision('template', edited, 1, 'test-editor')).toThrow('REVISION_CONFLICT');
    expect(service.snapshot().templates.find(item => item.id === edited.id)?.name).toBe(releaseTemplates[0]!.name);
    expect(() => database.initializeBaseContent('v1-other-set', { crafts: developmentData.crafts, templates: releaseTemplates })).toThrow('requires an empty database');
    expect(() => database.initializeBaseContent('latest', { crafts: developmentData.crafts, templates: releaseTemplates })).toThrow('versioned V1');
  });
  it('refuses an account-only database and rolls back malformed V1 base data', () => {
    const { database, service } = setup();
    const releaseTemplates = [1, 2, 3].map(index => ({ ...TemplateVersionSchema.parse(developmentData.templates[0]), id: `template-v1-${index}` }));
    expect(() => database.initializeBaseContent('v1-invalid', { crafts: developmentData.crafts, templates: [releaseTemplates[0], releaseTemplates[0], releaseTemplates[2]] })).toThrow('independent identities');
    expect(service.snapshot().crafts).toHaveLength(0);
    expect(() => database.initializeBaseContent('v1-invalid', { crafts: developmentData.crafts, templates: releaseTemplates.map((item, index) => index === 2 ? { ...item, craftId: 'craft-other' } : item) })).toThrow('craft mapping');
    expect(service.snapshot().crafts).toHaveLength(0);
    database.admin.maintenanceAccount('existing-owner', 'editor', 'scrypt$test-only-not-a-real-password');
    expect(() => database.initializeBaseContent('v1-occupied', { crafts: developmentData.crafts, templates: releaseTemplates })).toThrow('requires an empty database');
    expect(database.admin.credential('existing-owner')).not.toBeNull();
    expect(service.snapshot().crafts).toHaveLength(0);
  });
  it('retains content after close/reopen and an independent Node process restart', () => {
    const { database, path } = setup(); seed(database);
    database.close(); database.close();
    backupBeforeMigration(path, join(dirs[0]!, 'pre-migration.sqlite'));
    const reopened = new ContentDatabase({ path }); databases.push(reopened);
    expect(new PublicContentService(reopened).home().exhibits[0]?.id).toBe(exhibits[0]?.id);
    reopened.close();
    const process = spawnSync(globalThis.process.execPath, ['--import', 'tsx', resolve('apps/api/src/content/test-server.ts'), '--m12-inspect', path], { encoding: 'utf8' });
    expect(process.status, process.stderr).toBe(0);
    expect(JSON.parse(process.stdout).exhibits[0].id).toBe(exhibits[0]?.id);
  });
  it('does not repeat migrations; rolls back DDL and ledger on failure and refuses newer histories', () => {
    const { path, database } = setup(); database.close();
    const db = new DatabaseSync(path);
    try {
      runMigrations(db); runMigrations(db);
      expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n).toBe(migrations.length);
      expect(() => runMigrations(db, [...migrations, { version: migrations.length + 1, sql: 'CREATE TABLE half_done(id); INSERT INTO missing_table VALUES (1);' }])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='half_done'").get()).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n).toBe(migrations.length);
      runMigrations(db, [...migrations, { version: migrations.length + 1, sql: 'CREATE TABLE completed(id);' }]);
      expect(() => runMigrations(db)).toThrow('Unsupported migration history');
    } finally { db.close(); }
  });
  it('rolls back the initial migration and initialization atomically', () => {
    const db = new DatabaseSync(':memory:');
    try {
      expect(() => runMigrations(db, [{ version: 1, sql: 'CREATE TABLE partial(id); invalid SQL;' }])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('partial','schema_migrations')").all()).toEqual([]);
    } finally { db.close(); }
    const { database, service } = setup();
    expect(() => database.initializeDevelopment({ ...developmentData, stories: [{}] })).toThrow();
    expect(service.snapshot().crafts).toEqual([]);
    expect(database.initializeDevelopment(developmentData)).toBe(true);
    expect(database.initializeDevelopment(developmentData)).toBe(false);
    database.unpublish('template', 'template-dev-paper', 1, 'test-actor');
    expect(database.initializeDevelopment(developmentData)).toBe(false);
    expect(service.snapshot().templates.map(item => item.id)).toEqual(['template-v2-c04']);
  });
  it('keeps old public revision while drafts/pending exist, switches atomically and withdraws', () => {
    const { database, service } = setup(); seed(database);
    const original = ExhibitSchema.parse(exhibits[0]);
    const revision = database.createRevision('exhibit', { ...original, title: '开发修订二' }, 1, 'test-actor');
    expect(service.home().exhibits[0]?.title).toBe(original.title);
    expect(() => database.publish('exhibit', original.id, revision, 1, 'test-actor')).toThrow();
    database.submit('exhibit', original.id, revision, 'test-actor');
    expect(service.listExhibits().items[0]?.title).toBe(original.title);
    expect(() => database.publish('exhibit', original.id, revision, null, 'test-actor')).toThrow('REVISION_CONFLICT');
    database.publish('exhibit', original.id, revision, 1, 'test-actor');
    expect(service.home().exhibits[0]?.title).toBe('开发修订二');
    expect(() => database.createRevision('exhibit', original, 1, 'test-actor')).toThrow('REVISION_CONFLICT');
    database.unpublish('exhibit', original.id, revision, 'test-actor');
    expect(service.listExhibits().items).toEqual([]);
    expect(service.snapshot().stories[0]?.exhibitIds).toEqual([]);
  });
  it('makes template versions immutable and rejects raw payload rewrites', () => {
    const { database, path, service } = setup(); seed(database);
    const t = TemplateVersionSchema.parse(templates[0]);
    expect(() => database.createRevision('template', { ...t, name: 'rewrite' }, 1, 'test-actor')).toThrow();
    expect(service.snapshot().templates[0]).toEqual(t);
    publish(database, 'template', { ...t, version: 2 }, 1, 1);
    expect(service.snapshot().templates[0]?.version).toBe(2);
    const raw = new DatabaseSync(path);
    try { expect(() => raw.prepare('UPDATE revisions SET payload=? WHERE kind=?').run('{}', 'template')).toThrow('immutable revision'); }
    finally { raw.close(); }
    expect(t.version).toBe(1);
  });
  it('uses consistent WAL backup and restores public state, draft, revoked media and query results', () => {
    const { database, dir, service } = setup(); seed(database);
    database.createRevision('story', { ...StorySchema.parse(stories[0]), title: '尚未公开的开发草稿' }, 1, 'test-actor');
    database.unpublish('template', TemplateVersionSchema.parse(templates[0]).id, 1, 'test-actor');
    const before = service.snapshot();
    const backup = join(dir, 'backup', 'content.sqlite'); database.backup(backup);
    expect(existsSync(backup)).toBe(true);
    expect(() => database.backup(backup)).toThrow();
    const restoredPath = join(dir, 'restored', 'content.sqlite');
    // Destination is a separate existing directory; no live database file is copied.
    const restoreDir = join(dir, 'restored');
    const createDirectory = new ContentDatabase({ path: join(restoreDir, 'placeholder.sqlite') }); createDirectory.close();
    copyFileSync(backup, restoredPath);
    const restored = new ContentDatabase({ path: restoredPath }); databases.push(restored);
    expect(new PublicContentService(restored).snapshot()).toEqual(before);
    expect(new PublicContentService(restored).listExhibits({ q: '几何', tag: '占位' })).toEqual(service.listExhibits({ q: '几何', tag: '占位' }));
    expect(() => restored.createRevision('story', stories[0], 1, 'test-actor')).toThrow('REVISION_CONFLICT');
  });
});

describe('public query and route boundaries', () => {
  it('filters draft/pending/withdrawn content of every kind and caps sorted home selections', () => {
    const { database, service } = setup(); seed(database);
    for (const [kind, rows] of [['craft', crafts], ['template', templates], ['exhibit', exhibits], ['story', stories]] as const) {
      const original = rows[0]; if (!original) throw new Error('Missing fixture');
      for (const state of ['draft', 'pending', 'withdrawn']) {
        const id = `${kind}-${state}`;
        const input = { ...original, id, ...('slug' in original ? { slug: `craft-${state}` } : {}) };
        const revision = database.createRevision(kind, input, null, 'test-actor');
        if (state !== 'draft') database.submit(kind, id, revision, 'test-actor');
        if (state === 'withdrawn') { database.publish(kind, id, revision, null, 'test-actor'); database.unpublish(kind, id, revision, 'test-actor'); }
      }
    }
    expect(service.snapshot().crafts).toHaveLength(1); expect(service.snapshot().templates).toHaveLength(2);
    expect(service.home().exhibits).toHaveLength(1); expect(service.home().stories).toHaveLength(1);
    publish(database, 'template', { ...TemplateVersionSchema.parse(templates[0]), id: 'template-disabled', enabled: false });
    expect(service.snapshot().templates).toHaveLength(2);
    for (let i = 0; i < 8; i++) publish(database, 'exhibit', { ...ExhibitSchema.parse(exhibits[0]), id: `exhibit-public-${i}`, sortOrder: -1 });
    for (let i = 0; i < 5; i++) publish(database, 'story', { ...StorySchema.parse(stories[0]), id: `story-public-${i}`, sortOrder: -1 });
    expect(service.home().exhibits.map(e => e.id)).toEqual(Array.from({ length: 6 }, (_, i) => `exhibit-public-${i}`));
    expect(service.home().stories.map(s => s.id)).toEqual(Array.from({ length: 3 }, (_, i) => `story-public-${i}`));
  });
  it('preserves filter intersection, literal special characters, stable pagination and safe integer edges', () => {
    const { database, service } = setup(); seed(database);
    const original = ExhibitSchema.parse(exhibits[0]);
    for (const id of ['exhibit-z', 'exhibit-a', 'exhibit-b']) publish(database, 'exhibit', { ...original, id, title: '开发特殊 %_\' OR 1=1 -- A&B + 中文' });
    expect(service.listExhibits({ q: '  a&b + 中文  ', category: original.category, tag: '占位', craftId: original.craftId }).total).toBe(3);
    expect(service.listExhibits({ q: "%_' OR 1=1 --" }).total).toBe(3);
    expect(service.listExhibits({ q: "' UNION SELECT * FROM revisions --" }).items).toEqual([]);
    expect(service.listExhibits({ q: '特殊', category: 'missing' }).total).toBe(0);
    expect(service.listExhibits({ q: '特殊', page: 1, pageSize: 2 }).items.map(e => e.id)).toEqual(['exhibit-a', 'exhibit-b']);
    expect(service.listExhibits({ q: '特殊', page: 2, pageSize: 2 }).items.map(e => e.id)).toEqual(['exhibit-z']);
    expect(service.listExhibits({ page: Number.MAX_SAFE_INTEGER, pageSize: 50 }).items).toEqual([]);
    expect(service.listTemplates({ category: 'ignored', tag: 'ignored' }).total).toBe(2);
    expect(service.listStories({ category: 'ignored', tag: 'ignored' }).total).toBe(1);
  });
  it('removes invalid associations, disables new templates on archive, and fails closed for revoked media', () => {
    const { database, service } = setup(); seed(database);
    const craft = CraftSchema.parse(crafts[0]);
    publish(database, 'craft', { ...craft, status: 'archived' }, 1, 1);
    expect(service.snapshot().templates).toEqual([]);
    expect(service.home().exhibits[0]?.templateIds).toEqual([]);
    expect(service.home().stories[0]?.templateId).toBeUndefined();
    expect(service.home().exhibits).toHaveLength(1);
    database.revokeMedia(ExhibitSchema.parse(exhibits[0]).media[0]!.id, 'test-actor');
    expect(service.home()).toEqual({ exhibits: [], stories: [] });
  });
  it('projects explicit nested DTO allowlists and never serializes private record fields', () => {
    const e = ExhibitSchema.parse(exhibits[0]), s = StorySchema.parse(stories[0]);
    const secrets = { proofRef: 'private-proof', passwordHash: 'secret', internalLicenseUrl: 'https://private.invalid' };
    expect(publicExhibit({ ...e, ...secrets, media: e.media.map(m => ({ ...m, ...secrets, license: { ...m.license, ...secrets } })), sources: e.sources.map(v => ({ ...v, ...secrets })) })).toEqual(e);
    expect(publicStory({ ...s, ...secrets, cover: { ...s.cover, ...secrets } })).toEqual(s);
    expect(publicTemplate({ ...templates[0], ...secrets })).toEqual(templates[0]);
    expect(publicCraft({ ...crafts[0], ...secrets })).toEqual(crafts[0]);
    const { database, service } = setup(); seed(database);
    expect(JSON.stringify(service.snapshot())).not.toMatch(/proof|passwordHash|internalLicense|actor_id|SELECT|stack/);
  });
  it('serves real HTTP, validates duplicates/IDs/query, hides all unpublished states and generates request IDs', async () => {
    const { database } = setup(); seed(database);
    const app = Fastify(); await app.register(contentRoutes, { database });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const e = ExhibitSchema.parse(exhibits[0]);
      for (const [id, pending] of [['exhibit-draft', false], ['exhibit-pending', true]] as const) {
        const revision = database.createRevision('exhibit', { ...e, id }, null, 'test-actor');
        if (pending) database.submit('exhibit', id, revision, 'test-actor');
      }
      for (const id of ['exhibit-draft', 'exhibit-pending', 'missing']) {
        const response = await fetch(`${address}/api/v1/exhibits/${id}`);
        expect(response.status).toBe(404); expect((await response.json()).error.code).toBe('NOT_FOUND');
      }
      for (const suffix of ['?page=1&page=2', '?q=a&q=b', '?page=0', '?page=1e2', '?page=9007199254740992', '?pageSize=51', '?craftId=bad%2Fid', `?q=${'x'.repeat(101)}`, '?unknown=x', '/bad%2Fid']) {
        const response = await fetch(`${address}/api/v1/exhibits${suffix}`);
        expect(response.status, suffix).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_INPUT');
      }
      const a = await fetch(`${address}/api/v1/home`), b = await fetch(`${address}/api/v1/exhibits`);
      expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
      expect(a.headers.get('cache-control')).toBe('no-store');
      expect((await a.json()).value.exhibits).toHaveLength(1);
      expect((await b.json()).value.total).toBe(1);
      database.unpublish('exhibit', e.id, 1, 'test-actor');
      expect((await fetch(`${address}/api/v1/exhibits/${e.id}`)).status).toBe(404);
      expect((await (await fetch(`${address}/api/v1/home`)).json()).value.exhibits).toEqual([]);
      expect((await (await fetch(`${address}/api/v1/exhibits`)).json()).value).toMatchObject({ items: [], total: 0 });
      database.close();
      const failed = await fetch(`${address}/api/v1/home`);
      expect(failed.status).toBe(500); expect(await failed.text()).not.toMatch(/sqlite|SELECT|stack|proof/i);
    } finally { await app.close(); }
  });
});
