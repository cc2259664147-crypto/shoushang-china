import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContentDatabase } from '../database';
import { digest } from '../database/admin-schema';
import { developmentData } from '../database/development';
import { PublicContentService } from '../content';
import { MediaStorage, runBackup } from './media';
import { restoreBackup } from './restore';
import sharp from 'sharp';
const clean: (() => void)[] = [];
afterEach(() => { for (const f of clean.splice(0).reverse())
    f(); });
it('coordinates database, actual image/proof files, manifest and offline restore without reviving sessions/accounts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm13-backup-'));
    clean.push(() => rmSync(root, { recursive: true, force: true }));
    const db = new ContentDatabase({ path: join(root, 'db.sqlite') });
    clean.push(() => db.close());
    db.initializeDevelopment(developmentData);
    const aid = db.admin.maintenanceAccount('backup-admin', 'admin', 'scrypt$test');
    const access = { tokenDigest: digest(randomUUID()), requestId: randomUUID() };
    db.admin.login(aid, 1, access.tokenDigest, digest(randomUUID()), null, access.requestId);
    const storage = new MediaStorage(join(root, 'media'));
    const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: 'red' } }).png().toBuffer();
    const f = await storage.put(bytes);
    const m = db.admin.stageMedia(access, f);
    const proof = await storage.put(bytes);
    db.admin.proof(access, m.id, proof);
    const job = db.admin.queueBackup(access, { reason: '隔离数据库与媒体联合恢复验证' }, randomUUID());
    await runBackup(db, access, job.jobId, storage, join(root, 'backups'));
    expect(db.admin.backupStatus(access, job.jobId).state).toBe('succeeded');
    const backup = join(root, 'backups', job.jobId);
    const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')) as {
        files: unknown[];
    };
    expect(manifest.files).toHaveLength(4);
    const restored = join(root, 'restored');
    await expect(restoreBackup({ backupDirectory: backup, newDirectory: restored, hostsStopped: false })).rejects.toThrow();
    await expect(restoreBackup({ backupDirectory: backup, newDirectory: restored, hostsStopped: true })).resolves.toMatchObject({ accountsDisabled: true, sessionsRevoked: true });
    const reopened = new ContentDatabase({ path: join(restored, 'content.sqlite') });
    try {
        expect(new PublicContentService(reopened).snapshot()).toEqual(new PublicContentService(db).snapshot());
        expect(() => reopened.admin.identity(access)).toThrow('重新登录');
        reopened.admin.maintainAccountState('backup-admin', false);
        expect(() => reopened.admin.identity(access)).toThrow('重新登录');
    }
    finally {
        reopened.close();
    }
    writeFileSync(join(backup, f.objectKey, 'original.png'), 'tampered');
    await expect(restoreBackup({ backupDirectory: backup, newDirectory: join(root, 'bad-restore'), hostsStopped: true })).rejects.toThrow('checksum');
    expect(db.admin.identity(access).id).toBe(aid);
});
it('marks a missing-media backup failed instead of claiming a database-only snapshot is complete', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm13-backup-fail-'));
    clean.push(() => rmSync(root, { recursive: true, force: true }));
    const db = new ContentDatabase({ path: join(root, 'db.sqlite') });
    clean.push(() => db.close());
    const aid = db.admin.maintenanceAccount('backup-admin', 'admin', 'scrypt$test');
    const access = { tokenDigest: digest(randomUUID()), requestId: randomUUID() };
    db.admin.login(aid, 1, access.tokenDigest, digest(randomUUID()), null, access.requestId);
    db.admin.stageMedia(access, { objectKey: randomUUID(), format: 'png', width: 10, height: 10, originalHash: 'missing', thumbnailHash: 'missing' });
    const job = db.admin.queueBackup(access, { reason: '失败演练' }, randomUUID());
    await runBackup(db, access, job.jobId, new MediaStorage(join(root, 'missing')), join(root, 'backups'));
    expect(db.admin.backupStatus(access, job.jobId).state).toBe('failed');
    expect(db.admin.save(access, 'story', null, {}, null).state).toBe('draft');
});
