import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { HealthSchema, ReadinessSchema } from '@shoushang/contracts';
import { exhibits } from '@shoushang/fixtures';
import sharp from 'sharp';
import { createApp, projectRoot, resolveAdminConfig, resolveDatabasePath } from './app';
import { ContentDatabase, migrations } from './database';
import { developmentData } from './database/development';
import * as content from './content';
import { startServer } from './server';
import { randomBytes, randomUUID } from 'node:crypto';
import { prepareAdminIntegration } from '../testing/prepare-admin-integration';
import { MediaStorage } from './admin/media';
const directories: string[] = [];
function path() { const dir = mkdtempSync(join(tmpdir(), 'm12-integration-unit-')); directories.push(dir); return join(dir, 'content.sqlite'); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('mounts real content without seed and distinguishes liveness from readiness over HTTP', async () => {
  const app = await createApp({ databasePath: path() });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/health`);
    expect(response.status).toBe(200); expect(HealthSchema.parse(await response.json()).contentMode).toBe('http');
    expect(ReadinessSchema.parse(await (await fetch(`${address}/ready`)).json()).status).toBe('ready');
    expect(await (await fetch(`${address}/api/v1/exhibits`)).json()).toMatchObject({ ok: true, value: { items: [], total: 0 } });
    vi.spyOn(ContentDatabase.prototype, 'readPublicSnapshot').mockImplementation(() => { throw new Error('private path SQL credentials stack'); });
    const unavailable = await fetch(`${address}/ready`);
    expect(unavailable.status).toBe(503); expect(ReadinessSchema.parse(await unavailable.json()).status).toBe('not-ready');
    expect((await fetch(`${address}/health`)).status).toBe(200);
    const failure = await fetch(`${address}/api/v1/home`); expect(failure.status).toBe(500);
    expect(await failure.text()).not.toMatch(/private|SQL|credentials|stack/);
  } finally { await app.close(); }
});
it('owns one database, closes once and backs up existing data before opening without re-seeding', async () => {
  const databasePath = path(); const seed = new ContentDatabase({ path: databasePath }); seed.initializeDevelopment(developmentData); seed.unpublish('template', 'template-dev-paper', 1, 'test-actor'); seed.close();
  const close = vi.spyOn(ContentDatabase.prototype, 'close');
  const app = await createApp({ databasePath });
  const response = await app.inject('/api/v1/templates'); expect(response.json().value.items.map((item: { id: string }) => item.id)).toEqual(['template-v2-c04']);
  expect(readdirSync(`${databasePath}.backups`)).toHaveLength(1);
  await app.close(); await app.close(); expect(close).toHaveBeenCalledTimes(1);
});
it('fails opening/migration/registration without fallback and releases the owned connection', async () => {
  await expect(createApp({ databasePath: directories[0] ?? '' })).rejects.toThrow();
  const unavailablePath = path(); mkdirSync(unavailablePath);
  await expect(createApp({ databasePath: unavailablePath })).rejects.toThrow();
  const databasePath = path(); const seed = new ContentDatabase({ path: databasePath }); seed.close();
  const raw = new DatabaseSync(databasePath);
  try { raw.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migrations.length + 1, '2026-10-19T00:00:00Z'); }
  finally { raw.close(); }
  await expect(createApp({ databasePath })).rejects.toThrow('Unsupported migration history');
  const close = vi.spyOn(ContentDatabase.prototype, 'close');
  vi.spyOn(content, 'contentRoutes').mockImplementationOnce(async () => { throw new Error('registration failed'); });
  await expect(createApp({ databasePath: path() })).rejects.toThrow('registration failed'); expect(close).toHaveBeenCalledTimes(1);
});
it('releases database and signal handlers on listen failure and ordinary close', async () => {
  vi.stubEnv('CONTENT_DATABASE_PATH', path()); vi.stubEnv('PORT', '0');
  const before = process.listenerCount('SIGTERM'); const first = await startServer();
  try {
    const address = first.server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
    vi.stubEnv('PORT', String(address.port)); vi.stubEnv('CONTENT_DATABASE_PATH', path());
    const close = vi.spyOn(ContentDatabase.prototype, 'close');
    await expect(startServer()).rejects.toThrow(); expect(close).toHaveBeenCalledTimes(1);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
  } finally { await first.close(); }
  expect(process.listenerCount('SIGTERM')).toBe(before);
});
it('anchors default and relative database paths to the project rather than cwd and forbids memory fallback', () => {
  vi.stubEnv('CONTENT_DATABASE_PATH', 'var/example.sqlite');
  expect(resolveDatabasePath()).toBe(join(projectRoot, 'var/example.sqlite'));
  expect(() => resolveDatabasePath(':memory:')).toThrow(); expect(() => resolveDatabasePath('')).toThrow();
});
it('keeps administration off by default and rejects partial, unsafe or conflicting configuration', async () => {
  expect(resolveAdminConfig({})).toBeNull();
  const app = await createApp({ databasePath: path() });
  try { expect((await app.inject('/api/v1/admin/csrf')).statusCode).toBe(404); }
  finally { await app.close(); }
  const dir = mkdtempSync(join(tmpdir(), 'm13-config-')); directories.push(dir);
  const base = { ADMIN_ENABLED: '1', ADMIN_ORIGIN: 'http://127.0.0.1:5193', ADMIN_SECURITY_MODE: 'loopback-http', ADMIN_MEDIA_ROOT: join(dir, 'media'), ADMIN_BACKUP_ROOT: join(dir, 'backups'), HOST: '127.0.0.1' };
  expect(resolveAdminConfig(base)?.securityMode).toBe('loopback-http');
  expect(() => resolveAdminConfig({ ...base, ADMIN_ENABLED: '0' })).toThrow('ADMIN_ENABLED=1');
  expect(() => resolveAdminConfig({ ...base, ADMIN_ORIGIN: '' })).toThrow('requires');
  expect(() => resolveAdminConfig({ ...base, ADMIN_SECURITY_MODE: 'http' })).toThrow('SECURITY_MODE');
  expect(() => resolveAdminConfig({ ...base, ADMIN_MEDIA_ROOT: 'relative' })).toThrow('absolute');
  await expect(createApp({ databasePath: path(), admin: { ...resolveAdminConfig(base)!, mediaRoot: resolve(projectRoot, 'apps/web/public/private') } })).rejects.toThrow('private roots');
  await expect(createApp({ databasePath: path(), admin: { ...resolveAdminConfig(base)!, mediaRoot: resolve(projectRoot, 'var/private-media') } })).rejects.toThrow('private roots');
  await expect(createApp({ databasePath: resolve(projectRoot, 'var/m13-unsafe.sqlite'), admin: resolveAdminConfig(base)! })).rejects.toThrow('private database');
  await expect(createApp({ databasePath: '../other/content.sqlite', admin: resolveAdminConfig(base)! })).rejects.toThrow('absolute private database');
  await expect(createApp({ databasePath: path(), admin: { ...resolveAdminConfig(base)!, origin: 'http://evil.example' } })).rejects.toThrow('loopback');
});
it('allows a private public-media root while administration is off and rejects unsafe roots before opening a database', async () => {
  const databasePath = path(), mediaRoot = join(resolve(databasePath, '..'), 'media');
  expect(resolveAdminConfig({ ADMIN_ENABLED: '0', ADMIN_MEDIA_ROOT: mediaRoot })).toBeNull();
  expect(resolveAdminConfig({ ADMIN_MEDIA_ROOT: mediaRoot })).toBeNull();
  expect(() => resolveAdminConfig({ ADMIN_ENABLED: '0', ADMIN_MEDIA_ROOT: 'relative-media' })).toThrow('absolute');
  expect(() => resolveAdminConfig({ ADMIN_ENABLED: '0', ADMIN_MEDIA_ROOT: '' })).toThrow('absolute');
  await expect(createApp({ databasePath, admin: null, mediaRoot: 'relative-media' })).rejects.toThrow('absolute');
  await expect(createApp({ databasePath, admin: null, mediaRoot: join(projectRoot, 'apps/web/public/private-media') })).rejects.toThrow('private roots');
  await expect(createApp({ databasePath: join(projectRoot, 'var/forbidden-public-media.sqlite'), admin: null, mediaRoot })).rejects.toThrow('private roots');
  await expect(createApp({ databasePath, admin: null, mediaRoot: resolve(databasePath, '..') })).rejects.toThrow('private roots');
  expect(existsSync(databasePath)).toBe(false);
});
it('serves only currently referenced approved media with administration off, denies proof/static paths, and enforces hash and withdrawal', async () => {
  const databasePath = path(), root = resolve(databasePath, '..'), mediaRoot = join(root, 'media');
  const seed = new ContentDatabase({ path: databasePath });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    seed.initializeDevelopment(developmentData);
    const account = seed.admin.maintenanceAccount('isolated-public-media-admin', 'admin', 'scrypt$test-boundary');
    const tokenDigest = randomUUID(), access = { tokenDigest, requestId: randomUUID() };
    seed.admin.login(account, 1, tokenDigest, randomUUID(), null, randomUUID());
    const storage = new MediaStorage(mediaRoot);
    const png = await sharp({ create: { width: 12, height: 10, channels: 4, background: '#b82025' } }).png().toBuffer();
    const file = await storage.put(png), proof = await storage.put(png);
    const staged = seed.admin.stageMedia(access, file);
    const unapproved = seed.admin.stageMedia(access, proof);
    seed.admin.license(access, staged.id, { expectedRevision: 1, alt: '隔离软件测试图', author: '隔离测试自制', source: '软件测试', licenseType: '隔离测试许可', usageScope: 'site-display-and-thumbnail', attribution: '隔离测试自制', modification: '程序生成', kind: 'illustration' });
    seed.admin.proof(access, staged.id, proof);
    seed.admin.reviewMedia(access, staged.id, { expectedRevision: 3, decision: 'approved', reason: '仅隔离软件测试', verifiedScope: 'site-display-and-thumbnail' });
    vi.stubEnv('ADMIN_ENABLED', '0'); vi.stubEnv('ADMIN_MEDIA_ROOT', mediaRoot);
    app = await createApp({ databasePath });
    for (const endpoint of ['/api/v1/admin/csrf', '/api/v1/admin/session', '/api/v1/admin/contents']) expect((await app.inject(endpoint)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/session', payload: { username: 'admin', password: 'not-a-credential' } })).statusCode).toBe(404);
    for (const id of [staged.id, unapproved.id]) expect((await app.inject(`/api/v1/media/${id}/original`)).statusCode).toBe(404);
    const original = exhibits[0]!;
    const { id: oldId, revision: oldRevision, updatedAt: oldTime, media: oldMedia, ...draft } = original;
    void oldId; void oldRevision; void oldTime; void oldMedia;
    const input = { ...draft, category: '开发示意', tags: ['开发示意'], storyIds: [], templateIds: [], mediaIds: [staged.id], title: '隔离公开媒体测试' };
    const created = seed.admin.save(access, 'exhibit', null, input, null);
    const publish = (revision: number) => {
      seed.admin.submit(access, 'exhibit', created.id, { revision, expectedLatest: revision });
      const review = seed.admin.review(access, 'exhibit', created.id, { revision, expectedLatest: revision, decision: 'approved', evidence: { sources: '仅隔离软件验证，无真实文化主张或人工批准' } });
      seed.admin.publish(access, 'exhibit', created.id, { revision, expectedLatest: revision, expectedPublic: null, reviewId: review.reviewId }, randomUUID());
    };
    publish(1);
    for (const [variant, filename] of [['original', 'original.png'], ['thumbnail', 'thumbnail.png']] as const) {
      const response = await app.inject(`/api/v1/media/${staged.id}/${variant}`);
      expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toMatch(/^image\/png/u);
      expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.rawPayload).toEqual(await storage.read(file.objectKey, filename));
      const decoded = await sharp(response.rawPayload).raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width).toBeGreaterThan(0); expect(decoded.info.height).toBeGreaterThan(0); expect(decoded.data.length).toBeGreaterThan(0);
    }
    expect((await app.inject(`/api/v1/media/${unapproved.id}/original`)).statusCode).toBe(404);
    for (const endpoint of [`/api/v1/media/${staged.id}/proof`, `/api/v1/admin/media/${staged.id}/proof`, `/media/${file.objectKey}/original.png`, '/media/', '/backups/', '/content.sqlite']) {
      const response = await app.inject(endpoint); expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(mediaRoot); expect(response.body).not.toContain(proof.objectKey);
    }
    const publicContent = (await app.inject('/api/v1/exhibits')).json() as { ok: boolean; value: { total: number } };
    expect(publicContent).toMatchObject({ ok: true, value: { total: 1 } });
    expect(JSON.stringify(publicContent)).not.toMatch(/proofRef|objectKey|passwordHash|csrfDigest|tokenDigest/u);
    const storedOriginal = await storage.read(file.objectKey, 'original.png');
    writeFileSync(join(mediaRoot, file.objectKey, 'original.png'), Buffer.from('isolated corruption'));
    const damaged = await app.inject(`/api/v1/media/${staged.id}/original`);
    expect(damaged.statusCode).toBe(500); expect(damaged.json()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(damaged.body).not.toContain(mediaRoot); expect(damaged.body).not.toContain(file.objectKey);
    writeFileSync(join(mediaRoot, file.objectKey, 'original.png'), storedOriginal);
    seed.admin.unpublish(access, 'exhibit', created.id, { expectedLatest: 1, expectedPublic: 1, reason: '隔离下架测试' }, randomUUID());
    expect((await app.inject(`/api/v1/media/${staged.id}/original`)).statusCode).toBe(404);
    seed.admin.save(access, 'exhibit', created.id, input, 1); publish(2);
    expect((await app.inject(`/api/v1/media/${staged.id}/original`)).statusCode).toBe(200);
    seed.admin.revokeMedia(access, staged.id, { expectedRevision: 4, reason: '隔离撤权测试' }, randomUUID());
    for (const variant of ['original', 'thumbnail']) expect((await app.inject(`/api/v1/media/${staged.id}/${variant}`)).statusCode).toBe(404);
    expect((await app.inject('/api/v1/exhibits')).json()).toMatchObject({ ok: true, value: { total: 0 } });
    seed.admin.logout(access);
  } finally {
    await app?.close();
    try { seed.admin.prepareRestoredDatabase(true); } finally { seed.close(); }
  }
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    expect(raw.prepare('SELECT COUNT(*) n FROM admin_accounts WHERE disabled=0').get()!.n).toBe(0);
    expect(raw.prepare('SELECT COUNT(*) n FROM admin_sessions WHERE revoked=0 AND expires_at>?').get(Date.now())!.n).toBe(0);
  } finally { raw.close(); }
}, 30000);
it('registers admin only in its scope and rejects a non-loopback actual listener', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm13-listener-')); directories.push(dir);
  const admin = resolveAdminConfig({ ADMIN_ENABLED: '1', ADMIN_ORIGIN: 'http://127.0.0.1:5193', ADMIN_SECURITY_MODE: 'loopback-http', ADMIN_MEDIA_ROOT: join(dir, 'media'), ADMIN_BACKUP_ROOT: join(dir, 'backups'), HOST: '127.0.0.1' })!;
  const app = await createApp({ databasePath: path(), admin });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${address}/health`)).status).toBe(200);
    expect((await fetch(`${address}/ready`)).status).toBe(200);
    expect((await fetch(`${address}/api/v1/exhibits`)).status).toBe(200);
    expect((await fetch(`${address}/api/v1/admin/contents`)).status).toBe(401);
    expect((await fetch(`${address}/api/v1/admin/csrf`, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(`${address}/api/v1/admin/session`, { method: 'POST', headers: { origin: admin.origin }, body: '{}' })).status).toBe(403);
  } finally { await app.close(); }
  const wrong = await createApp({ databasePath: path(), admin });
  try {
    const address = await wrong.listen({ host: '0.0.0.0', port: 0 });
    expect((await fetch(`${address}/api/v1/admin/csrf`)).status).toBe(403);
  }
  finally { await wrong.close(); }
  vi.stubEnv('CONTENT_DATABASE_PATH', path()); vi.stubEnv('PORT', '0'); vi.stubEnv('HOST', '0.0.0.0');
  vi.stubEnv('ADMIN_ENABLED', '1'); vi.stubEnv('ADMIN_ORIGIN', admin.origin);
  vi.stubEnv('ADMIN_SECURITY_MODE', admin.securityMode); vi.stubEnv('ADMIN_MEDIA_ROOT', admin.mediaRoot); vi.stubEnv('ADMIN_BACKUP_ROOT', admin.backupRoot);
  await expect(startServer()).rejects.toThrow('loopback');
});
it('waits for an accepted joint backup before closing its single database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm13-close-backup-')); directories.push(dir);
  const password = randomBytes(32).toString('base64url');
  await prepareAdminIntegration(dir, password);
  const admin = resolveAdminConfig({ ADMIN_ENABLED: '1', ADMIN_ORIGIN: 'http://127.0.0.1:5193', ADMIN_SECURITY_MODE: 'loopback-http', ADMIN_MEDIA_ROOT: join(dir, 'media'), ADMIN_BACKUP_ROOT: join(dir, 'backups'), HOST: '127.0.0.1' })!;
  const app = await createApp({ databasePath: join(dir, 'content.sqlite'), admin });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const challenge = await fetch(`${address}/api/v1/admin/csrf`);
    const challengeBody = await challenge.json() as { value: { csrfToken: string } };
    const challengeCookie = challenge.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const login = await fetch(`${address}/api/v1/admin/session`, { method: 'POST', headers: { origin: admin.origin, cookie: challengeCookie, 'x-csrf-token': challengeBody.value.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'integration-admin', password }) });
    expect(login.status).toBe(200);
    const session = await login.json() as { value: { csrfToken: string } };
    const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const backup = await fetch(`${address}/api/v1/admin/backups`, { method: 'POST', headers: { origin: admin.origin, cookie, 'x-csrf-token': session.value.csrfToken, 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, body: JSON.stringify({ reason: '关闭时等待隔离备份' }) });
    expect(backup.status).toBe(202);
    const job = await backup.json() as { value: { jobId: string } };
    await app.close();
    const raw = new DatabaseSync(join(dir, 'content.sqlite'));
    try { expect(raw.prepare('SELECT state FROM admin_backup_jobs WHERE id=?').get(job.value.jobId)!.state).toBe('succeeded'); }
    finally { raw.close(); }
    expect(existsSync(join(dir, 'backups', job.value.jobId, 'manifest.json'))).toBe(true);
  } finally { await app.close(); }
});
