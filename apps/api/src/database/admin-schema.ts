import { createHash } from 'node:crypto';
import { ExhibitSchema, StorySchema, IdSchema, SourceSchema } from '@shoushang/contracts';
import type { ApiError } from '@shoushang/contracts';
export type AdminKind = 'exhibit' | 'story';
export type Role = 'editor' | 'admin';
export interface Identity {
    id: string;
    username: string;
    role: Role;
    version: number;
}
export interface Access {
    tokenDigest: string;
    requestId: string;
}
export class AdminError extends Error {
    constructor(readonly code: ApiError['code'], message: string, readonly fields: ApiError['fieldErrors'] = []) { super(message); }
}
export function fail(code: ApiError['code'], message: string): never { throw new AdminError(code, message); }
export function required(value: unknown, path: string, max = 2000): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\u0000]/u.test(value))
        throw new AdminError('INVALID_INPUT', '字段格式不正确', [{ path, message: '请填写有效纯文本' }]);
    return value.trim();
}
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
        fail('INVALID_INPUT', '请求字段不正确');
    return value as Record<string, unknown>;
}
export function positive(value: unknown, nullable = false): number | null {
    if (nullable && value === null)
        return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
        fail('INVALID_INPUT', '修订号不正确');
    return value;
}
export function kindOf(value: unknown): AdminKind { if (value !== 'exhibit' && value !== 'story')
    fail('INVALID_INPUT', '内容类型不支持'); return value; }
export function idOf(value: unknown): string { const p = IdSchema.safeParse(value); if (!p.success)
    fail('INVALID_INPUT', 'ID 不正确'); return p.data; }
export function canonical(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object')
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
export function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
const sourcesDraft = SourceSchema.partial().array().max(100).optional();
const exhibitDraft = ExhibitSchema.omit({ id: true, revision: true, updatedAt: true, media: true }).partial().extend({ mediaIds: IdSchema.array().max(20).optional(), sources: sourcesDraft });
const storyDraft = StorySchema.omit({ id: true, revision: true, updatedAt: true, cover: true }).partial().extend({ mediaIds: IdSchema.array().max(1).optional(), sources: sourcesDraft, timeline: StorySchema.shape.timeline.element.partial().extend({ sources: sourcesDraft }).array().max(100).optional() });
export function parseDraft(kind: AdminKind, value: unknown): Record<string, unknown> {
    const p = (kind === 'exhibit' ? exhibitDraft : storyDraft).safeParse(value);
    if (!p.success)
        throw new AdminError('INVALID_INPUT', '草稿字段不正确', p.error.issues.map(i => ({ path: i.path.join('.') || 'draft', message: i.message })));
    const check = (v: unknown): void => {
        if (typeof v === 'string' && (v.length > 20000 || /[<>\u0000]/u.test(v)))
            fail('INVALID_INPUT', '正文必须为受控纯文本');
        if (Array.isArray(v)) {
            if (v.length > 100)
                fail('INVALID_INPUT', '条目过多');
            v.forEach(check);
        }
        else if (v && typeof v === 'object')
            Object.values(v).forEach(check);
    };
    check(p.data);
    return p.data;
}
export const adminMigration = { version: 2, sql: `
CREATE TABLE admin_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('editor','admin')),password_hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,auth_version INTEGER NOT NULL DEFAULT 1,row_version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,last_login_at TEXT);
CREATE TABLE admin_sessions(digest TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES admin_accounts(id),auth_version INTEGER NOT NULL,csrf_digest TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE admin_challenges(digest TEXT PRIMARY KEY,csrf_digest TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE admin_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);
CREATE TABLE admin_reviews(id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,payload_digest TEXT NOT NULL,media_versions TEXT NOT NULL,evidence TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,decision TEXT NOT NULL);
CREATE TABLE admin_idempotency(actor_id TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_digest TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(actor_id,operation,key));
CREATE TABLE admin_media(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES admin_accounts(id),object_key TEXT NOT NULL UNIQUE,proof_key TEXT,proof_hashes TEXT,format TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,original_hash TEXT NOT NULL,thumbnail_hash TEXT NOT NULL,license TEXT NOT NULL DEFAULT '{}',state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','approved','revoked')),version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE admin_audit(sequence INTEGER PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,revision INTEGER,result TEXT NOT NULL,request_id TEXT NOT NULL,created_at TEXT NOT NULL,reason_code TEXT NOT NULL);
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE ON admin_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER admin_audit_retain BEFORE DELETE ON admin_audit BEGIN SELECT RAISE(ABORT,'retain audit'); END;
CREATE TABLE admin_vocabulary(kind TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,value));
INSERT INTO admin_vocabulary VALUES('category','开发示意'),('tag','开发示意');
CREATE TABLE admin_backup_jobs(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,manifest_hash TEXT,failure_code TEXT);
CREATE TABLE admin_maintenance(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
` } as const;

// Append-only ordering independent of wall-clock precision, preserved across restarts.
export const reviewOrderMigration = { version: 3, sql: `
CREATE TABLE admin_review_order(sequence INTEGER PRIMARY KEY AUTOINCREMENT,review_id TEXT UNIQUE NOT NULL REFERENCES admin_reviews(id));
INSERT INTO admin_review_order(review_id) SELECT id FROM admin_reviews ORDER BY rowid;
CREATE TRIGGER admin_review_sequence AFTER INSERT ON admin_reviews BEGIN INSERT INTO admin_review_order(review_id) VALUES(NEW.id); END;
CREATE TRIGGER admin_reviews_immutable BEFORE UPDATE ON admin_reviews BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER admin_reviews_retain BEFORE DELETE ON admin_reviews BEGIN SELECT RAISE(ABORT,'retain review'); END;
CREATE TRIGGER admin_review_order_immutable BEFORE UPDATE ON admin_review_order BEGIN SELECT RAISE(ABORT,'immutable review order'); END;
CREATE TRIGGER admin_review_order_retain BEFORE DELETE ON admin_review_order BEGIN SELECT RAISE(ABORT,'retain review order'); END;
` } as const;
