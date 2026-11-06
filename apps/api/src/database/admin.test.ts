import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentDatabase, migrations, runMigrations } from './index';
import { digest } from './admin-schema';
import { developmentData } from './development';
import { PublicContentService } from '../content';
const clean: (() => void)[] = [];
afterEach(() => { for (const f of clean.splice(0).reverse())
    f(); });
function setup() { const dir = mkdtempSync(join(tmpdir(), 'm13-db-')); clean.push(() => rmSync(dir, { recursive: true, force: true })); const path = join(dir, 'content.sqlite'); const db = new ContentDatabase({ path }); clean.push(() => db.close()); return { dir, path, db }; }
function actor(db: ContentDatabase, role: 'admin' | 'editor' = 'admin') {
    const id = db.admin.maintenanceAccount(`u-${randomUUID()}`, role, 'scrypt$test-db-boundary');
    const tokenDigest = digest(randomBytes(32));
    db.admin.login(id, 1, tokenDigest, digest(randomBytes(32)), null, randomUUID());
    return { access: { tokenDigest, requestId: randomUUID() }, id };
}
describe('M13 SQLite migration and transactional administration', () => {
    it('upgrades v2 same-time reviews in insertion order and rolls back a failed v3 migration', () => {
        const raw = new DatabaseSync(':memory:');
        try {
            runMigrations(raw, migrations.slice(0, 2));
            const insert = raw.prepare('INSERT INTO admin_reviews VALUES(?,?,?,?,?,?,?,?,?,?)');
            for (const [id, decision] of [['z-first', 'approved'], ['a-later', 'rejected']]) insert.run(id!, 'exhibit', 'legacy', 1, 'digest', '{}', '{}', 'actor', '2026-10-19T00:00:00.000Z', decision!);
            expect(() => runMigrations(raw, [...migrations.slice(0, 2), { version: 3, sql: migrations[2]!.sql + ' INSERT INTO missing_table VALUES(1);' }])).toThrow();
            expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='admin_review_order'").get()).toBeUndefined();
            expect(raw.prepare('SELECT COUNT(*) n FROM schema_migrations').get()!.n).toBe(2);
            expect(raw.prepare('SELECT COUNT(*) n FROM admin_reviews').get()!.n).toBe(2);
            runMigrations(raw);
            expect(raw.prepare('SELECT review_id FROM admin_review_order ORDER BY sequence').all().map(r => r.review_id)).toEqual(['z-first', 'a-later']);
            insert.run('third', 'exhibit', 'legacy', 1, 'digest', '{}', '{}', 'actor', '2020-01-01T00:00:00.000Z', 'approved');
            expect(raw.prepare('SELECT review_id FROM admin_review_order ORDER BY sequence DESC LIMIT 1').get()!.review_id).toBe('third');
            expect(() => raw.exec("UPDATE admin_reviews SET decision='approved'")).toThrow('immutable');
            expect(() => raw.exec('DELETE FROM admin_review_order')).toThrow('retain');
        } finally { raw.close(); }
    });
    it('persists rejected command keys without side effects and rejects a different request using the same key',()=>{
        const {db,path}=setup();const a=actor(db);const e=actor(db,'editor');const key=randomUUID();
        const request={expectedVersion:999,reason:'测试过期账号版本'};
        expect(()=>db.admin.disable(a.access,e.id,request,key)).toThrow('账号版本');
        expect(db.admin.identity(e.access).id).toBe(e.id);
        const reopened=new ContentDatabase({path});clean.push(()=>reopened.close());
        expect(()=>reopened.admin.disable(a.access,e.id,request,key)).toThrow('账号版本');
        expect(()=>reopened.admin.disable(a.access,e.id,{expectedVersion:1,reason:'不同请求'},key)).toThrow('同一幂等键');
        reopened.admin.disable(a.access,e.id,{expectedVersion:1,reason:'新键确认停用'},randomUUID());
        expect(()=>db.admin.identity(e.access)).toThrow('重新登录');
    });
    it('upgrades an actual v1 file without rewriting immutable payload or hiding old public content', () => {
        const { db, path } = setup();
        db.close();
        const old = new DatabaseSync(path);
        old.close();
        const dir = mkdtempSync(join(tmpdir(), 'm13-v1-'));
        clean.push(() => rmSync(dir, { recursive: true, force: true }));
        const v1 = join(dir, 'v1.sqlite');
        const raw = new DatabaseSync(v1);
        runMigrations(raw, migrations.slice(0, 1));
        const craft = developmentData.crafts[0]!;
        const body = JSON.stringify(craft);
        raw.prepare("INSERT INTO entities(kind,id,latest_revision) VALUES('craft',?,1)").run(craft.id);
        raw.prepare("INSERT INTO revisions VALUES('craft',?,1,?,'published','v1-actor',?,NULL)").run(craft.id, body, new Date().toISOString());
        raw.prepare("UPDATE entities SET public_revision=1 WHERE kind='craft'").run();
        raw.close();
        const upgraded = new ContentDatabase({ path: v1 });
        clean.push(() => upgraded.close());
        expect(new PublicContentService(upgraded).snapshot().crafts).toEqual([craft]);
        upgraded.close();
        const inspect = new DatabaseSync(v1);
        try {
            expect(inspect.prepare('SELECT payload FROM revisions').get()!.payload).toBe(body);
            expect(inspect.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version)).toEqual(migrations.map(m => m.version));
        }
        finally {
            inspect.close();
        }
    });
    it('rolls back the complete v2 migration and ledger on injected failure', () => {
        const raw = new DatabaseSync(':memory:');
        try {
            runMigrations(raw, migrations.slice(0, 1));
            expect(() => runMigrations(raw, [migrations[0]!, { version: 2, sql: migrations[1]!.sql + ' INSERT INTO missing_table VALUES(1);' }])).toThrow();
            expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='admin_accounts'").get()).toBeUndefined();
            expect(raw.prepare('SELECT COUNT(*) n FROM schema_migrations').get()!.n).toBe(1);
        }
        finally {
            raw.close();
        }
    });
    it('persists incomplete drafts, rejects public projection and preserves a competing writer', () => {
        const { db, path } = setup();
        const a = actor(db, 'editor');
        const d = db.admin.save(a.access, 'exhibit', null, { title: '开发草稿' }, null);
        expect(new PublicContentService(db).snapshot().exhibits).toEqual([]);
        expect(() => db.admin.submit(a.access, 'exhibit', d.id, { revision: 1, expectedLatest: 1 })).toThrow('发布字段');
        const other = new ContentDatabase({ path });
        clean.push(() => other.close());
        other.admin.save(a.access, 'exhibit', d.id, { title: '新修订' }, 1);
        expect(() => db.admin.save(a.access, 'exhibit', d.id, { title: '过期修改' }, 1)).toThrow('新修订');
        expect(db.admin.content(a.access, 'exhibit', d.id).draft.title).toBe('新修订');
    });
    it('rechecks disabled accounts inside writes even when an earlier identity check succeeded', () => {
        const { db } = setup();
        const admin = actor(db);
        const edit = actor(db, 'editor');
        expect(db.admin.identity(edit.access).role).toBe('editor');
        db.admin.disable(admin.access, edit.id, { expectedVersion: 1, reason: '测试停用' }, randomUUID());
        expect(() => db.admin.save(edit.access, 'story', null, { title: '旧会话' }, null)).toThrow('重新登录');
        expect(() => db.admin.identity(edit.access)).toThrow('重新登录');
    });
    it('persists logout, disabled accounts and rate windows after reopening', () => {
        const { db, path } = setup();
        const a = actor(db);
        db.admin.logout(a.access);
        db.admin.rate('bounded-key', 1, 60000);
        db.close();
        const reopened = new ContentDatabase({ path });
        clean.push(() => reopened.close());
        expect(() => reopened.admin.identity(a.access)).toThrow('重新登录');
        expect(() => reopened.admin.rate('bounded-key', 1, 60000)).toThrow('频繁');
        for(let i=0;i<65;i++)reopened.admin.failure(null,'read-denied',randomUUID(),'UNAUTHENTICATED');
        const inspect=new DatabaseSync(path);try{expect(inspect.prepare("SELECT count(*) n FROM admin_audit WHERE actor_id='anonymous'").get()!.n).toBe(60);expect(inspect.prepare("SELECT count FROM admin_limits WHERE key='failure-audit:anonymous'").get()!.count).toBe(65);}finally{inspect.close();}
    });
    it('guards legacy writes and all admin writes for the full backup file phase', () => {
        const { db, dir } = setup();
        db.initializeDevelopment(developmentData);
        const a = actor(db);
        const job = db.admin.queueBackup(a.access, { reason: '隔离测试' }, randomUUID());
        db.admin.startBackup(a.access, job.jobId);
        expect(() => db.createRevision('craft', { ...developmentData.crafts[0], name: '开发新修订' }, 1, 'test-actor')).toThrow('维护');
        expect(() => db.submit('craft', 'craft-papercut', 1, 'test-actor')).toThrow('维护');
        expect(() => db.publish('craft', 'craft-papercut', 1, 1, 'test-actor')).toThrow('维护');
        expect(() => db.unpublish('craft', 'craft-papercut', 1, 'test-actor')).toThrow('维护');
        expect(() => db.revokeMedia('media-test', 'test-actor')).toThrow('维护');
        expect(() => db.initializeDevelopment(developmentData)).toThrow('维护');
        expect(() => db.backup(join(dir, 'bypass.sqlite'))).toThrow('维护');
        expect(() => db.admin.maintenanceAccount('another', 'editor', 'scrypt$test')).toThrow('维护');
        expect(() => db.admin.save(a.access, 'exhibit', null, {}, null)).toThrow('维护');
        expect(() => db.admin.recoverMaintenance(false)).toThrow('停止');
        expect(() => db.admin.recoverMaintenance(true)).toThrow('尚未过期');
        db.admin.backupSnapshot(job.jobId, join(dir, 'snapshot.sqlite'));
        db.admin.finishBackup(job.jobId, 'test-manifest');
        expect(db.admin.backupStatus(a.access, job.jobId).state).toBe('succeeded');
    });
    it('keeps an expired lease fail-closed until explicit quiescent recovery', () => {
        const { db, path } = setup();
        const a = actor(db);
        const job = db.admin.queueBackup(a.access, { reason: '测试' }, randomUUID());
        db.admin.startBackup(a.access, job.jobId);
        const raw = new DatabaseSync(path);
        try {
            raw.prepare('UPDATE admin_maintenance SET expires_at=0').run();
        }
        finally {
            raw.close();
        }
        expect(() => db.admin.finishBackup(job.jobId, 'hash')).toThrow('失效');
        expect(() => db.admin.save(a.access, 'story', null, {}, null)).toThrow('维护');
        db.admin.recoverMaintenance(true);
        expect(db.admin.backupStatus(a.access, job.jobId).state).toBe('failed');
        db.admin.prepareRestoredDatabase(true);
        expect(() => db.admin.identity(a.access)).toThrow('重新登录');
    });
    it('rolls back account state when success audit insertion fails', () => {
        const { db, path } = setup();
        const a = actor(db);
        const e = actor(db, 'editor');
        const raw = new DatabaseSync(path);
        raw.exec("CREATE TRIGGER fault_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'injected audit fault'); END;");
        try {
            expect(() => db.admin.disable(a.access, e.id, { expectedVersion: 1, reason: '测试' }, randomUUID())).toThrow('injected audit fault');
            expect(db.admin.identity(e.access).id).toBe(e.id);
        }
        finally {
            raw.exec('DROP TRIGGER fault_audit');
            raw.close();
        }
    });
});
