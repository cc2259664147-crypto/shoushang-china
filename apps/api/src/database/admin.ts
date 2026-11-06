import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ExhibitSchema, StorySchema, MediaSchema } from '@shoushang/contracts';
import type { Media, ApiError } from '@shoushang/contracts';
import { AdminError, canonical, digest, fail, idOf, kindOf, parseDraft, positive, record, required } from './admin-schema';
import type { Access, AdminKind, Identity, Role } from './admin-schema';
type Row = Record<string, SQLOutputValue>;
type CommandResult<T> = {ok:true;value:T}|{ok:false;error:{code:ApiError['code'];message:string;fields:ApiError['fieldErrors']}};
export interface MediaFile {
    objectKey: string;
    format: string;
    width: number;
    height: number;
    originalHash: string;
    thumbnailHash: string;
}
export function assertNoMaintenance(db: DatabaseSync): void {
    // Expiry is diagnostic only. Never resume writes automatically while a crashed/slow copier may run.
    if (db.prepare('SELECT 1 FROM admin_maintenance').get())
        fail('REVISION_CONFLICT', '备份维护中，请稍后重试');
}
function json(value: SQLOutputValue | undefined): unknown { if (typeof value !== 'string')
    fail('INTERNAL_ERROR', '存储数据不可用'); return JSON.parse(value) as unknown; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INTERNAL_ERROR', '存储数据不可用'); return value as Record<string, unknown>; }
function page<T>(items: T[], input: unknown = {}) {
    const q = record(input, ['page', 'pageSize', 'q', 'kind', 'state', 'action', 'targetId']);
    const n = q.page === undefined ? 1 : positive(q.page)!;
    const size = q.pageSize === undefined ? 12 : positive(q.pageSize)!;
    if (size > 50)
        fail('INVALID_INPUT', '每页最多50条');
    const offset = BigInt(n - 1) * BigInt(size);
    return { items: offset >= BigInt(items.length) ? [] : items.slice(Number(offset), Number(offset) + size), total: items.length, page: n, pageSize: size };
}
/** Internal collaborator of ContentDatabase. Never exported from the database root as a constructor. */
export class AdminStore {
    constructor(private readonly db: DatabaseSync) { }
    private tx<T>(fn: () => T, maintenance = false): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            if (!maintenance)
                assertNoMaintenance(this.db);
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
    private audit(actor: string, action: string, target: string, revision: number | null, request: string, result = 'success', reason = ''): void {
        this.db.prepare('INSERT INTO admin_audit(actor_id,action,target_id,revision,result,request_id,created_at,reason_code) VALUES(?,?,?,?,?,?,?,?)').run(actor, action, target, revision, result, request, new Date().toISOString(), reason);
    }
    failure(access: Access | null, action: string, requestId: string, code: string): void {
        // Never persist attacker controlled body/header values in audit.
        this.tx(() => {
            const actor=access?this.identityOrNull(access.tokenDigest)?.id??'anonymous':'anonymous';
            const key=`failure-audit:${actor}`,now=Date.now();
            this.db.prepare('DELETE FROM admin_limits WHERE key=? AND until_at<?').run(key,now);
            this.db.prepare('INSERT INTO admin_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+60000);
            const count=Number(this.db.prepare('SELECT count FROM admin_limits WHERE key=?').get(key)!.count);
            // Keep aggregate attempts durable, with bounded detailed rows under unauthenticated floods.
            if(count<=60)this.audit(actor, action, 'request', null, requestId, 'failed', code);
        });
    }
    private identityOrNull(tokenDigest: string): Identity | null {
        const r = this.db.prepare('SELECT a.* FROM admin_sessions s JOIN admin_accounts a ON a.id=s.account_id WHERE s.digest=? AND s.revoked=0 AND s.expires_at>? AND a.disabled=0 AND s.auth_version=a.auth_version').get(tokenDigest, Date.now());
        return r ? { id: String(r.id), username: String(r.username), role: String(r.role) as Role, version: Number(r.row_version) } : null;
    }
    identity(access: Access, admin = false): Identity {
        const who = this.identityOrNull(access.tokenDigest);
        if (!who)
            fail('UNAUTHENTICATED', '请重新登录');
        if (admin && who.role !== 'admin')
            fail('FORBIDDEN', '需要管理员权限');
        return who;
    }
    session(access: Access) {
        const account = this.identity(access);
        const r = this.db.prepare('SELECT expires_at,csrf_digest FROM admin_sessions WHERE digest=?').get(access.tokenDigest)!;
        return { account, expiresAt: new Date(Number(r.expires_at)).toISOString(), csrfDigest: String(r.csrf_digest) };
    }
    maintenanceAccount(username: string, role: Role, passwordHash: string, reset = false): string {
        username = required(username, 'username', 80).toLowerCase();
        if (!/^[a-z0-9][a-z0-9_.-]{2,79}$/u.test(username) || !['editor', 'admin'].includes(role) || !passwordHash.startsWith('scrypt$'))
            fail('INVALID_INPUT', '账号格式不正确');
        return this.tx(() => {
            const old = this.db.prepare('SELECT * FROM admin_accounts WHERE username=?').get(username);
            if (reset) {
                if (!old)
                    fail('NOT_FOUND', '账号不存在');
                this.db.prepare('UPDATE admin_accounts SET password_hash=?,auth_version=auth_version+1,row_version=row_version+1 WHERE id=?').run(passwordHash, old.id!);
                this.db.prepare('UPDATE admin_sessions SET revoked=1 WHERE account_id=?').run(old.id!);
            }
            else {
                if (old)
                    fail('REVISION_CONFLICT', '账号已存在');
                const id = randomUUID();
                this.db.prepare('INSERT INTO admin_accounts(id,username,role,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, username, role, passwordHash, new Date().toISOString());
                this.audit('maintenance', 'account-create', id, null, randomUUID());
                return id;
            }
            this.audit('maintenance', 'password-reset', String(old!.id), null, randomUUID());
            return String(old!.id);
        });
    }
    maintainVocabulary(kind: 'category' | 'tag', value: string): void { required(value, 'value', 80); this.tx(() => { this.db.prepare('INSERT INTO admin_vocabulary VALUES(?,?) ON CONFLICT DO NOTHING').run(kind, value); this.audit('maintenance', 'vocabulary-add', kind, null, randomUUID()); }); }
    maintainAccountState(username: string, disabled: boolean): void { this.tx(() => { const r = this.db.prepare('SELECT * FROM admin_accounts WHERE username=?').get(username.toLowerCase()); if (!r)
        fail('NOT_FOUND', '账号不存在'); if (disabled && r.role === 'admin' && Number(this.db.prepare("SELECT count(*) n FROM admin_accounts WHERE role='admin' AND disabled=0").get()!.n) <= 1)
        fail('FORBIDDEN', '必须保留启用管理员'); this.db.prepare('UPDATE admin_accounts SET disabled=?,auth_version=auth_version+1,row_version=row_version+1 WHERE id=?').run(disabled ? 1 : 0, r.id!); this.db.prepare('UPDATE admin_sessions SET revoked=1 WHERE account_id=?').run(r.id!); this.audit('maintenance', disabled ? 'account-disable' : 'account-enable', String(r.id), null, randomUUID()); }); }
    credential(username: string): {
        id: string;
        passwordHash: string;
        version: number;
    } | null {
        const r = this.db.prepare('SELECT id,password_hash,auth_version FROM admin_accounts WHERE username=? AND disabled=0').get(username.toLowerCase());
        return r ? { id: String(r.id), passwordHash: String(r.password_hash), version: Number(r.auth_version) } : null;
    }
    rate(key: string, limit: number, durationMs: number): void {
        const allowed = this.tx(() => {
            const now = Date.now();
            this.db.prepare('DELETE FROM admin_limits WHERE until_at<?').run(now);
            const r = this.db.prepare('SELECT count,until_at FROM admin_limits WHERE key=?').get(key);
            if (r && Number(r.count) >= limit)
                return false;
            if (!r && Number(this.db.prepare('SELECT COUNT(*) n FROM admin_limits').get()!.n) >= 10000)
                return false;
            this.db.prepare('INSERT INTO admin_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, 1, now + durationMs);
            return true;
        });
        if (!allowed)
            fail('RATE_LIMITED', '操作频繁，请稍后重试');
    }
    challenge(tokenDigest: string, csrfDigest: string): void {
        this.tx(() => { this.db.prepare('DELETE FROM admin_challenges WHERE expires_at<?').run(Date.now()); this.db.prepare('INSERT INTO admin_challenges VALUES(?,?,?)').run(tokenDigest, csrfDigest, Date.now() + 300000); });
    }
    consumeChallenge(tokenDigest: string, csrfDigest: string): void {
        const valid = this.tx(() => this.db.prepare('DELETE FROM admin_challenges WHERE digest=? AND csrf_digest=? AND expires_at>?').run(tokenDigest, csrfDigest, Date.now()).changes === 1);
        if (!valid)
            fail('FORBIDDEN', '登录验证已失效，请重试');
    }
    login(accountId: string, authVersion: number, tokenDigest: string, csrfDigest: string, oldDigest: string | null, requestId: string) {
        return this.tx(() => {
            const r = this.db.prepare('SELECT * FROM admin_accounts WHERE id=? AND disabled=0 AND auth_version=?').get(accountId, authVersion);
            if (!r)
                fail('UNAUTHENTICATED', '账号或密码不正确');
            if (oldDigest)
                this.db.prepare('UPDATE admin_sessions SET revoked=1 WHERE digest=?').run(oldDigest);
            const expires = Date.now() + 28800000;
            this.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,0)').run(tokenDigest, accountId, authVersion, csrfDigest, expires);
            this.db.prepare('UPDATE admin_accounts SET last_login_at=? WHERE id=?').run(new Date().toISOString(), accountId);
            this.audit(accountId, 'login', accountId, null, requestId);
            return { account: { id: accountId, username: String(r.username), role: String(r.role) as Role, version: Number(r.row_version) }, expiresAt: new Date(expires).toISOString() };
        });
    }
    logout(access: Access): void { this.tx(() => { const a = this.identity(access); this.db.prepare('UPDATE admin_sessions SET revoked=1 WHERE digest=?').run(access.tokenDigest); this.audit(a.id, 'logout', a.id, null, access.requestId); }); }
    accounts(access: Access, query: unknown) { this.identity(access, true); return page(this.db.prepare('SELECT id,username,role,disabled,row_version version FROM admin_accounts ORDER BY username').all(), query); }
    disable(access: Access, id: string, input: unknown, key: string) {
        const p = record(input, ['expectedVersion', 'reason']);
        positive(p.expectedVersion);
        required(p.reason, 'reason');
        return this.command(access, 'account-disable', key, { id, ...p }, a => {
            if (a.id === id)
                fail('FORBIDDEN', '不能停用当前账号');
            const target = this.db.prepare('SELECT * FROM admin_accounts WHERE id=? AND row_version=? AND disabled=0').get(id, p.expectedVersion as number);
            if (!target)
                fail('REVISION_CONFLICT', '账号版本已变化');
            if (target.role === 'admin' && Number(this.db.prepare("SELECT count(*) n FROM admin_accounts WHERE role='admin' AND disabled=0").get()!.n) <= 1)
                fail('FORBIDDEN', '必须保留启用管理员');
            this.db.prepare('UPDATE admin_accounts SET disabled=1,auth_version=auth_version+1,row_version=row_version+1 WHERE id=?').run(id);
            this.db.prepare('UPDATE admin_sessions SET revoked=1 WHERE account_id=?').run(id);
            this.audit(a.id, 'account-disable', id, null, access.requestId, 'success', String(p.reason));
            return { id, disabled: true };
        });
    }
    private command<T>(access: Access, op: string, key: string, input: unknown, fn: (a: Identity) => T): T {
        if (!/^[a-zA-Z0-9_-]{16,128}$/u.test(key))
            fail('INVALID_INPUT', '需要有效幂等键');
        const result = this.tx<CommandResult<T>>(() => {
            const a = this.identity(access, true);
            const hash = digest(canonical(input));
            const r = this.db.prepare('SELECT * FROM admin_idempotency WHERE actor_id=? AND operation=? AND key=?').get(a.id, op, key);
            if (r) {
                if (r.request_digest !== hash)
                    fail('REVISION_CONFLICT', '同一幂等键不能用于不同请求');
                return json(r.response) as CommandResult<T>;
            }
            this.db.exec('SAVEPOINT admin_command');
            let outcome:CommandResult<T>;
            try {
                outcome={ok:true,value:fn(a)};
                this.db.exec('RELEASE admin_command');
            } catch(error) {
                this.db.exec('ROLLBACK TO admin_command; RELEASE admin_command');
                if(!(error instanceof AdminError))throw error;
                outcome={ok:false,error:{code:error.code,message:error.message,fields:error.fields}};
                this.audit(a.id,`${op}-rejected`,'request',null,access.requestId,'failed',error.code);
            }
            this.db.prepare('INSERT INTO admin_idempotency VALUES(?,?,?,?,?)').run(a.id, op, key, hash, JSON.stringify(outcome));
            return outcome;
        });
        if(!result.ok)throw new AdminError(result.error.code,result.error.message,result.error.fields);
        return result.value;
    }
    private head(kind: AdminKind, id: string, expected?: number) {
        const r = this.db.prepare('SELECT * FROM entities WHERE kind=? AND id=?').get(kind, id);
        if (!r)
            fail('NOT_FOUND', '内容不存在');
        if (expected !== undefined && r.latest_revision !== expected)
            fail('REVISION_CONFLICT', '内容已有新修订，请保留输入并重新读取');
        return r;
    }
    private revision(kind: AdminKind, id: string, revision: number): Row {
        const r = this.db.prepare('SELECT * FROM revisions WHERE kind=? AND entity_id=? AND revision=?').get(kind, id, revision);
        if (!r)
            fail('NOT_FOUND', '修订不存在');
        return r;
    }
    contents(access: Access, query: unknown) {
        this.identity(access);
        const q = record(query, ['kind', 'state', 'q', 'page', 'pageSize']);
        if (q.kind !== undefined)
            kindOf(q.kind);
        if (q.state !== undefined && !['draft', 'pending', 'published', 'withdrawn'].includes(String(q.state)))
            fail('INVALID_INPUT', '状态不正确');
        if (q.q !== undefined && (typeof q.q !== 'string' || q.q.length > 100))
            fail('INVALID_INPUT', '关键词不正确');
        const rows = this.db.prepare("SELECT e.kind,e.id,e.latest_revision revision,e.public_revision publicRevision,r.state,r.payload FROM entities e JOIN revisions r ON e.kind=r.kind AND e.id=r.entity_id AND e.latest_revision=r.revision WHERE e.kind IN ('exhibit','story') ORDER BY r.created_at DESC,e.id").all();
        const items = rows.map(r => ({ kind: String(r.kind), id: String(r.id), revision: Number(r.revision), publicRevision: r.publicRevision === null ? null : Number(r.publicRevision), state: String(r.state), title: String(object(json(r.payload)).title ?? '未命名草稿') })).filter(r => (!q.kind || r.kind === q.kind) && (!q.state || r.state === q.state) && (!q.q || r.title.toLowerCase().includes(String(q.q).toLowerCase())));
        return page(items, q);
    }
    content(access: Access, kind: AdminKind, id: string, rev?: number) {
        this.identity(access);
        const h = this.head(kind, id);
        const r = this.revision(kind, id, rev ?? Number(h.latest_revision));
        const review = this.latestReview(kind, id, Number(r.revision));
        return { id, kind, revision: Number(r.revision), publicRevision: h.public_revision === null ? null : Number(h.public_revision), latestRevision: Number(h.latest_revision), state: String(r.state), draft: object(json(r.payload)), review: review ? { id: String(review.id), decision: String(review.decision), evidence: json(review.evidence) } : null };
    }
    history(access: Access, kind: AdminKind, id: string, query: unknown) { this.identity(access); this.head(kind, id); return page(this.db.prepare('SELECT revision,state,created_at createdAt FROM revisions WHERE kind=? AND entity_id=? ORDER BY revision DESC').all(kind, id), query); }
    vocabulary(access: Access) {
        this.identity(access);
        const rows = this.db.prepare("SELECT r.kind,r.payload FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE r.state='published' AND r.kind IN ('craft','template')").all();
        return { crafts: rows.filter(r => r.kind === 'craft').map(r => object(json(r.payload))), templates: rows.filter(r => r.kind === 'template').map(r => object(json(r.payload))), categories: this.db.prepare("SELECT value FROM admin_vocabulary WHERE kind='category'").all().map(r => String(r.value)), tags: this.db.prepare("SELECT value FROM admin_vocabulary WHERE kind='tag'").all().map(r => String(r.value)) };
    }
    private insertDraft(actor: string, kind: AdminKind, id: string, input: unknown, expected: number | null) {
        const h = this.db.prepare('SELECT latest_revision FROM entities WHERE kind=? AND id=?').get(kind, id);
        if ((h ? Number(h.latest_revision) : null) !== expected)
            fail('REVISION_CONFLICT', '内容已有新修订');
        const draft = parseDraft(kind, input);
        const ids = (draft.mediaIds ?? []) as string[];
        delete draft.mediaIds;
        const media = ids.map(mid => this.mediaDto(mid));
        const revision = (expected ?? 0) + 1;
        const payload = { ...draft, id, revision, updatedAt: new Date().toISOString(), ...(kind === 'exhibit' ? { media } : { ...(media[0] ? { cover: media[0] } : {}) }) };
        if (!h)
            this.db.prepare('INSERT INTO entities(kind,id) VALUES(?,?)').run(kind, id);
        this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,NULL)').run(kind, id, revision, JSON.stringify(payload), 'draft', actor, new Date().toISOString());
        this.db.prepare('UPDATE entities SET latest_revision=? WHERE kind=? AND id=?').run(revision, kind, id);
        return { id, revision, state: 'draft', publicRevision: this.head(kind, id).public_revision };
    }
    save(access: Access, kind: AdminKind, id: string | null, input: unknown, expected: number | null) {
        kindOf(kind);
        positive(expected, true);
        if (id)
            idOf(id);
        return this.tx(() => { const a = this.identity(access); const value = this.insertDraft(a.id, kind, id ?? randomUUID(), input, expected); this.audit(a.id, 'draft-save', value.id, value.revision, access.requestId); return value; });
    }
    private candidate(kind: AdminKind, id: string, rev: number) {
        const r = this.revision(kind, id, rev);
        const parsed = (kind === 'exhibit' ? ExhibitSchema : StorySchema).safeParse(json(r.payload));
        if (!parsed.success)
            throw new AdminError('INVALID_INPUT', '发布字段尚未完整', parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })));
        const dto = parsed.data;
        const media = 'media' in dto ? dto.media : [dto.cover];
        for (const m of media) {
            const actual = this.mediaDto(m.id, true);
            if (canonical(actual) !== canonical(m))
                fail('REVISION_CONFLICT', '媒体许可已更新，请创建新草稿');
        }
        const crafts = 'craftId' in dto ? [dto.craftId] : dto.craftIds;
        const refs: [
            string,
            string
        ][] = [...crafts.map(cid => ['craft', cid] as [
                string,
                string
            ]), ...('storyIds' in dto ? dto.storyIds.map(s => ['story', s] as [
                string,
                string
            ]) : dto.exhibitIds.map(e => ['exhibit', e] as [
                string,
                string
            ])), ...('templateIds' in dto ? dto.templateIds : dto.templateId ? [dto.templateId] : []).map(t => ['template', t] as [
                string,
                string
            ])];
        for (const [k, rid] of refs) {
            const ref = this.db.prepare("SELECT r.payload FROM entities e JOIN revisions r ON e.kind=r.kind AND e.id=r.entity_id AND e.public_revision=r.revision WHERE e.kind=? AND e.id=? AND r.state='published'").get(k, rid);
            if (!ref)
                fail('INVALID_INPUT', '关联内容不存在或未发布');
            const target = object(json(ref.payload));
            if (k === 'template') {
                if (target.enabled !== true)
                    fail('INVALID_INPUT', '模板不可用');
                const craft = this.db.prepare("SELECT r.payload FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE e.kind='craft' AND e.id=? AND r.state='published'").get(String(target.craftId));
                const c = craft ? object(json(craft.payload)) : {};
                if (c.status !== 'active' || c.supportsExperience !== true || !crafts.includes(String(target.craftId)))
                    fail('INVALID_INPUT', '模板工艺不可体验或关联不匹配');
            }
            if (k === 'exhibit' || k === 'story') {
                const ms = (target.media ?? (target.cover ? [target.cover] : [])) as Media[];
                if (ms.some(m => this.db.prepare('SELECT 1 FROM revoked_media WHERE id=?').get(m.id)))
                    fail('INVALID_INPUT', '关联内容媒体已撤权');
            }
        }
        if ('category' in dto && !this.db.prepare("SELECT 1 FROM admin_vocabulary WHERE kind='category' AND value=?").get(dto.category))
            fail('INVALID_INPUT', '请选择词表中的分类');
        if ('tags' in dto)
            for (const tag of dto.tags)
                if (!this.db.prepare("SELECT 1 FROM admin_vocabulary WHERE kind='tag' AND value=?").get(tag))
                    fail('INVALID_INPUT', '请选择词表中的标签');
        return { dto, mediaVersions: media.map(m => ({ id: m.id, version: Number(this.mediaRow(m.id).version) })) };
    }
    submit(access: Access, kind: AdminKind, id: string, input: unknown) {
        const p = record(input, ['revision', 'expectedLatest']);
        const rev = positive(p.revision)!;
        const expected = positive(p.expectedLatest)!;
        return this.tx(() => { const a = this.identity(access); this.head(kind, id, expected); if (rev !== expected)
            fail('REVISION_CONFLICT', '只能提交最新草稿'); this.candidate(kind, id, rev); if (this.db.prepare("UPDATE revisions SET state='pending' WHERE kind=? AND entity_id=? AND revision=? AND state='draft'").run(kind, id, rev).changes !== 1)
            fail('REVISION_CONFLICT', '草稿状态已变化'); this.audit(a.id, 'submit', id, rev, access.requestId); return { id, revision: rev, state: 'pending' }; });
    }
    private latestReview(kind: AdminKind, id: string, revision: number) {
        return this.db.prepare('SELECT r.* FROM admin_reviews r JOIN admin_review_order o ON o.review_id=r.id WHERE r.kind=? AND r.entity_id=? AND r.revision=? ORDER BY o.sequence DESC LIMIT 1').get(kind, id, revision);
    }
    review(access: Access, kind: AdminKind, id: string, input: unknown) {
        const p = record(input, ['revision', 'expectedLatest', 'decision', 'evidence']);
        const rev = positive(p.revision)!;
        if (p.decision !== 'approved' && p.decision !== 'rejected')
            fail('INVALID_INPUT', '审核决定不正确');
        const e = record(p.evidence, ['sources', 'identity', 'quotations']);
        required(e.sources, 'evidence.sources');
        if (kind === 'story') {
            required(e.identity, 'evidence.identity');
            required(e.quotations, 'evidence.quotations');
        }
        return this.tx(() => { const a = this.identity(access, true); this.head(kind, id, positive(p.expectedLatest)!); if (rev !== p.expectedLatest || this.revision(kind, id, rev).state !== 'pending')
            fail('REVISION_CONFLICT', '审核修订已变化'); const c = this.candidate(kind, id, rev); const rid = randomUUID(); this.db.prepare('INSERT INTO admin_reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(rid, kind, id, rev, digest(canonical(c.dto)), JSON.stringify(c.mediaVersions), JSON.stringify(e), a.id, new Date().toISOString(), String(p.decision)); this.audit(a.id, 'review', id, rev, access.requestId); return { reviewId: rid, decision: p.decision, revision: rev }; });
    }
    publish(access: Access, kind: AdminKind, id: string, input: unknown, key: string) {
        const p = record(input, ['revision', 'expectedLatest', 'expectedPublic', 'reviewId']);
        const rev = positive(p.revision)!;
        positive(p.expectedLatest);
        positive(p.expectedPublic, true);
        idOf(p.reviewId);
        return this.command(access, 'publish', key, { kind, id, ...p }, a => {
            const h = this.head(kind, id, p.expectedLatest as number);
            if (h.public_revision !== p.expectedPublic || rev !== p.expectedLatest || this.revision(kind, id, rev).state !== 'pending')
                fail('REVISION_CONFLICT', '公开版本或编辑头已变化');
            const c = this.candidate(kind, id, rev);
            const review = this.latestReview(kind, id, rev);
            if (!review || review.id !== p.reviewId || review.decision !== 'approved' || review.payload_digest !== digest(canonical(c.dto)) || review.media_versions !== JSON.stringify(c.mediaVersions))
                fail('INVALID_INPUT', '需要与当前修订绑定的核验记录');
            this.db.prepare("UPDATE revisions SET state='published' WHERE kind=? AND entity_id=? AND revision=?").run(kind, id, rev);
            this.db.prepare('UPDATE entities SET public_revision=? WHERE kind=? AND id=?').run(rev, kind, id);
            this.audit(a.id, 'publish', id, rev, access.requestId);
            return { id, revision: rev, state: 'published', publicRevision: rev };
        });
    }
    unpublish(access: Access, kind: AdminKind, id: string, input: unknown, key: string) {
        const p = record(input, ['expectedLatest', 'expectedPublic', 'reason']);
        positive(p.expectedLatest);
        const rev = positive(p.expectedPublic)!;
        required(p.reason, 'reason');
        return this.command(access, 'unpublish', key, { kind, id, ...p }, a => { const h = this.head(kind, id, p.expectedLatest as number); if (h.public_revision !== rev)
            fail('REVISION_CONFLICT', '公开版本已变化'); this.db.prepare('UPDATE entities SET public_revision=NULL WHERE kind=? AND id=?').run(kind, id); this.db.prepare("UPDATE revisions SET state='withdrawn' WHERE kind=? AND entity_id=? AND revision=?").run(kind, id, rev); this.audit(a.id, 'unpublish', id, rev, access.requestId, 'success', String(p.reason)); return { id, publicRevision: null, state: 'withdrawn' }; });
    }
    restore(access: Access, kind: AdminKind, id: string, input: unknown, key: string) {
        const p = record(input, ['sourceRevision', 'expectedLatest', 'reason']);
        positive(p.sourceRevision);
        positive(p.expectedLatest);
        required(p.reason, 'reason');
        return this.command(access, 'restore', key, { kind, id, ...p }, a => { this.head(kind, id, p.expectedLatest as number); const { dto } = this.candidate(kind, id, p.sourceRevision as number); const data = object(dto); const { id: ignored, revision: ignored2, updatedAt: ignored3, media, cover, ...draft } = data; void ignored; void ignored2; void ignored3; const ms = (media ?? (cover ? [cover] : [])) as Media[]; const value = this.insertDraft(a.id, kind, id, { ...draft, mediaIds: ms.map(m => m.id) }, p.expectedLatest as number); this.audit(a.id, 'restore', id, value.revision, access.requestId, 'success', String(p.reason)); return value; });
    }
    private mediaRow(id: string): Row { const r = this.db.prepare('SELECT * FROM admin_media WHERE id=?').get(id); if (!r)
        fail('NOT_FOUND', '媒体不存在'); return r; }
    private mediaDto(id: string, approved = false): Media {
        const r = this.mediaRow(id);
        if (r.state === 'revoked' || this.db.prepare('SELECT 1 FROM revoked_media WHERE id=?').get(id))
            fail('INVALID_INPUT', '媒体已撤权');
        if (approved && r.state !== 'approved')
            fail('INVALID_INPUT', '媒体许可尚未审核');
        const l = object(json(r.license));
        return MediaSchema.parse({ id, url: `/api/v1/media/${id}/original`, alt: l.alt ?? '待补充替代文本', author: l.author ?? '待核验', license: { name: l.licenseType ?? '待审核', attribution: l.attribution ?? '待核验', ...(l.licenseUrl ? { url: l.licenseUrl } : {}) }, ...(l.source ? { source: l.source } : {}), ...(l.modification ? { modification: l.modification } : {}), width: Number(r.width), height: Number(r.height), kind: l.kind ?? 'illustration' });
    }
    stageMedia(access: Access, file: MediaFile) {
        return this.tx(() => { const a = this.identity(access); const id = randomUUID(); idOf(file.objectKey); if (!['jpeg', 'png', 'webp'].includes(file.format) || file.width < 1 || file.height < 1 || file.width > 6000 || file.height > 6000)
            fail('INVALID_INPUT', '图片尺寸或格式不正确'); this.db.prepare('INSERT INTO admin_media(id,owner_id,object_key,format,width,height,original_hash,thumbnail_hash) VALUES(?,?,?,?,?,?,?,?)').run(id, a.id, file.objectKey, file.format, file.width, file.height, file.originalHash, file.thumbnailHash); this.audit(a.id, 'media-upload', id, 1, access.requestId); return { id, revision: 1, state: 'staged', width: file.width, height: file.height, format: file.format, thumbnailReady: true }; });
    }
    private owns(access: Access, r: Row) { const a = this.identity(access); if (a.role !== 'admin' && a.id !== r.owner_id)
        fail('FORBIDDEN', '仅上传者和管理员可操作'); return a; }
    mediaList(access: Access, query: unknown) { const a = this.identity(access); return page(this.db.prepare('SELECT id,owner_id ownerId,format,width,height,state,version revision,license FROM admin_media ORDER BY id').all().map(r => { const l = object(json(r.license)); if (a.role !== 'admin' && a.id !== r.ownerId)
        delete l.licenseUrl; return { ...r, license: l }; }), query); }
    license(access: Access, id: string, input: unknown) {
        const p = record(input, ['expectedRevision', 'alt', 'author', 'source', 'licenseType', 'usageScope', 'attribution', 'licenseUrl', 'modification', 'kind']);
        positive(p.expectedRevision);
        for (const k of ['alt', 'author', 'source', 'licenseType', 'usageScope', 'attribution'])
            required(p[k], k);
        if (!['site-display', 'site-display-and-thumbnail'].includes(String(p.usageScope)))
            fail('INVALID_INPUT', '使用范围必须涵盖网站及缩略图');
        if (p.licenseUrl !== undefined && !/^https?:\/\//u.test(required(p.licenseUrl, 'licenseUrl')))
            fail('INVALID_INPUT', '许可地址必须为 HTTP(S)');
        if (p.modification !== undefined)
            required(p.modification, 'modification');
        if (p.kind !== undefined && !['illustration', 'photograph'].includes(String(p.kind)))
            fail('INVALID_INPUT', '媒体类型不正确');
        return this.tx(() => { const r = this.mediaRow(id); const a = this.owns(access, r); if (r.version !== p.expectedRevision || r.state !== 'staged')
            fail('REVISION_CONFLICT', '已审核或撤权台账不能原位修改'); const { expectedRevision, ...license } = p; void expectedRevision; this.db.prepare('UPDATE admin_media SET license=?,version=version+1 WHERE id=?').run(JSON.stringify(license), id); this.audit(a.id, 'media-license', id, Number(r.version) + 1, access.requestId); return { id, revision: Number(r.version) + 1, state: 'staged' }; });
    }
    proof(access: Access, id: string, file: MediaFile) { return this.tx(() => { const r = this.mediaRow(id); const a = this.owns(access, r); if (r.state !== 'staged' || r.proof_key !== null)
        fail('REVISION_CONFLICT', '凭证已存在或台账已冻结'); idOf(file.objectKey); this.db.prepare('UPDATE admin_media SET proof_key=?,proof_hashes=?,version=version+1 WHERE id=?').run(file.objectKey, JSON.stringify({ original: file.originalHash, thumbnail: file.thumbnailHash }), id); this.audit(a.id, 'media-proof', id, Number(r.version) + 1, access.requestId); return { id, revision: Number(r.version) + 1 }; }); }
    reviewMedia(access: Access, id: string, input: unknown) { const p = record(input, ['expectedRevision', 'decision', 'reason', 'verifiedScope']); positive(p.expectedRevision); required(p.reason, 'reason'); if (p.decision !== 'approved' || p.verifiedScope !== 'site-display-and-thumbnail')
        fail('INVALID_INPUT', '必须核验网站及缩略图使用范围'); return this.tx(() => { const a = this.identity(access, true); const r = this.mediaRow(id); if (r.state !== 'staged' || r.version !== p.expectedRevision)
        fail('REVISION_CONFLICT', '媒体状态或版本已变化'); const l = object(json(r.license)); for (const k of ['alt', 'author', 'source', 'licenseType', 'usageScope', 'attribution'])
        required(l[k], k); if (l.usageScope !== 'site-display-and-thumbnail' || !r.proof_key)
        fail('INVALID_INPUT', '许可范围或凭证不完整'); this.db.prepare("UPDATE admin_media SET state='approved',version=version+1 WHERE id=?").run(id); this.audit(a.id, 'media-review', id, Number(r.version) + 1, access.requestId, 'success', String(p.reason)); return { id, revision: Number(r.version) + 1, state: 'approved' }; }); }
    revokeMedia(access: Access, id: string, input: unknown, key: string) { const p = record(input, ['expectedRevision', 'reason']); positive(p.expectedRevision); required(p.reason, 'reason'); return this.command(access, 'media-revoke', key, { id, ...p }, a => { const r = this.mediaRow(id); if (r.version !== p.expectedRevision)
        fail('REVISION_CONFLICT', '媒体版本已变化'); this.db.prepare("UPDATE admin_media SET state='revoked',version=version+1 WHERE id=?").run(id); this.db.prepare('INSERT INTO revoked_media VALUES(?,?) ON CONFLICT DO NOTHING').run(id, new Date().toISOString()); this.audit(a.id, 'media-revoke', id, Number(r.version) + 1, access.requestId, 'success', String(p.reason)); return { id, state: 'revoked' }; }); }
    mediaFile(access: Access | null, id: string, variant: 'original' | 'thumbnail' | 'proof') {
        return this.readSnapshot(() => {
            const r = this.mediaRow(id);
            if (variant === 'proof') {
                if (!access)
                    fail('NOT_FOUND', '媒体不可用');
                this.owns(access, r);
                if (!r.proof_key)
                    fail('NOT_FOUND', '凭证不存在');
                return { objectKey: String(r.proof_key), filename: 'original.png', mime: 'image/png', expectedHash: String(object(json(r.proof_hashes)).original) };
            }
            if (r.state === 'revoked' || this.db.prepare('SELECT 1 FROM revoked_media WHERE id=?').get(id))
                fail('NOT_FOUND', '媒体不可用');
            if (access)
                this.identity(access);
            else {
                if (r.state !== 'approved')
                    fail('NOT_FOUND', '媒体不可用');
                const refs = this.db.prepare("SELECT r.payload FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE r.state='published' AND r.kind IN ('exhibit','story')").all();
                const referenced = refs.some(row => {
                    const p = object(json(row.payload));
                    const ms = (p.media ?? (p.cover ? [p.cover] : [])) as Media[];
                    const craftIds = (p.craftId ? [p.craftId] : p.craftIds) as string[];
                    return Array.isArray(craftIds) && craftIds.every(cid => this.db.prepare("SELECT 1 FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE e.kind='craft' AND e.id=? AND r.state='published'").get(cid)) && ms.some(m => m.id === id) && ms.every(m => !this.db.prepare('SELECT 1 FROM revoked_media WHERE id=?').get(m.id));
                });
                if (!referenced)
                    fail('NOT_FOUND', '媒体不可用');
            }
            return { objectKey: String(r.object_key), filename: variant === 'thumbnail' ? 'thumbnail.png' : 'original.png', mime: 'image/png', expectedHash: String(variant === 'thumbnail' ? r.thumbnail_hash : r.original_hash) };
        });
    }
    private readSnapshot<T>(fn: () => T): T { this.db.exec('BEGIN'); try {
        const v = fn();
        this.db.exec('COMMIT');
        return v;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    audits(access: Access, query: unknown) { this.identity(access, true); return page(this.db.prepare('SELECT sequence,actor_id actorId,action,target_id targetId,revision,result,request_id requestId,created_at createdAt,reason_code reasonCode FROM admin_audit ORDER BY sequence DESC').all(), query); }
    queueBackup(access: Access, input: unknown, key: string) { const p = record(input, ['reason']); required(p.reason, 'reason'); return this.command(access, 'backup', key, p, a => { if (this.db.prepare('SELECT 1 FROM admin_backup_jobs WHERE actor_id=? AND created_at>?').get(a.id, new Date(Date.now() - 300000).toISOString()))
        fail('RATE_LIMITED', '每五分钟最多创建一次备份'); const id = randomUUID(); this.db.prepare("INSERT INTO admin_backup_jobs(id,actor_id,state,created_at) VALUES(?,?,'queued',?)").run(id, a.id, new Date().toISOString()); this.audit(a.id, 'backup-queued', id, null, access.requestId, 'success', String(p.reason)); return { jobId: id, state: 'queued' }; }); }
    backupStatus(access: Access, id: string) { this.identity(access, true); const r = this.db.prepare('SELECT id jobId,state,created_at createdAt,completed_at completedAt,failure_code failureCode FROM admin_backup_jobs WHERE id=?').get(id); if (!r)
        fail('NOT_FOUND', '任务不存在'); return r; }
    storageInventory(hostsStopped:boolean) {
        if(!hostsStopped)fail('FORBIDDEN','离线对账须先停止全部宿主和复制进程');
        return this.db.prepare('SELECT object_key,proof_key,original_hash,thumbnail_hash,proof_hashes FROM admin_media').all().flatMap(r=>[{key:String(r.object_key),original:String(r.original_hash),thumbnail:String(r.thumbnail_hash)},...(r.proof_key?[{key:String(r.proof_key),original:String(object(json(r.proof_hashes)).original),thumbnail:String(object(json(r.proof_hashes)).thumbnail)}]:[])]);
    }
    startBackup(access: Access, id: string) { return this.tx(() => { const a = this.identity(access, true); const r = this.db.prepare("SELECT 1 FROM admin_backup_jobs WHERE id=? AND state='queued'").get(id); if (!r)
        fail('REVISION_CONFLICT', '任务已处理'); this.db.prepare('INSERT INTO admin_maintenance VALUES(1,?,?)').run(id, Date.now() + 300000); this.db.prepare("UPDATE admin_backup_jobs SET state='running' WHERE id=?").run(id); this.audit(a.id, 'backup-start', id, null, access.requestId); return this.db.prepare('SELECT object_key,proof_key,original_hash,thumbnail_hash,proof_hashes FROM admin_media').all().flatMap(r => [{ key: String(r.object_key), original: String(r.original_hash), thumbnail: String(r.thumbnail_hash) }, ...(r.proof_key ? [{ key: String(r.proof_key), original: String(object(json(r.proof_hashes)).original), thumbnail: String(object(json(r.proof_hashes)).thumbnail) }] : [])]); }); }
    backupSnapshot(jobId: string, destination: string): void { const lock = this.db.prepare('SELECT * FROM admin_maintenance WHERE owner=?').get(jobId); if (!lock || Number(lock.expires_at) < Date.now())
        fail('REVISION_CONFLICT', '备份租约失效，需受控恢复'); this.db.prepare('VACUUM INTO ?').run(destination); }
    finishBackup(jobId: string, hash: string | null): void { this.tx(() => { const lock = this.db.prepare('SELECT * FROM admin_maintenance WHERE owner=?').get(jobId); if (!lock || Number(lock.expires_at) < Date.now())
        fail('REVISION_CONFLICT', '备份租约失效，保持锁定等待维护'); this.db.prepare('UPDATE admin_backup_jobs SET state=?,completed_at=?,manifest_hash=?,failure_code=? WHERE id=?').run(hash ? 'succeeded' : 'failed', new Date().toISOString(), hash, hash ? null : 'BACKUP_FAILED', jobId); const r = this.db.prepare('SELECT actor_id FROM admin_backup_jobs WHERE id=?').get(jobId)!; this.audit(String(r.actor_id), hash ? 'backup-complete' : 'backup-failed', jobId, null, randomUUID(), hash ? 'success' : 'failed'); this.db.prepare('DELETE FROM admin_maintenance WHERE owner=?').run(jobId); }, true); }
    /** Operator must first stop ALL hosts/copiers. Expired leases never auto-unlock. */
    recoverMaintenance(confirmedHostsStopped: boolean): void { if (!confirmedHostsStopped)
        fail('FORBIDDEN', '必须先停止全部写入宿主和复制进程'); this.tx(() => { const r = this.db.prepare('SELECT * FROM admin_maintenance').get(); if (r && Number(r.expires_at) > Date.now())
        fail('REVISION_CONFLICT', '维护租约尚未过期'); if (r) {
        this.db.prepare("UPDATE admin_backup_jobs SET state='failed',failure_code='RECOVERED_AFTER_CRASH' WHERE id=?").run(r.owner!);
        this.db.prepare('DELETE FROM admin_maintenance').run();
        this.audit('maintenance', 'backup-recover', String(r.owner), null, randomUUID());
    } }, true); }
    prepareRestoredDatabase(hostsStopped: boolean): void { if (!hostsStopped)
        fail('FORBIDDEN', '先停止全部宿主'); this.tx(() => { this.db.prepare('UPDATE admin_accounts SET disabled=1,auth_version=auth_version+1,row_version=row_version+1').run(); this.db.prepare('UPDATE admin_sessions SET revoked=1').run(); this.db.prepare('DELETE FROM admin_challenges').run(); this.db.prepare("UPDATE admin_backup_jobs SET state='failed',failure_code='RESTORED_OFFLINE' WHERE state IN ('running','queued')").run(); this.db.prepare('DELETE FROM admin_maintenance').run(); this.audit('maintenance', 'restore-quarantine', 'all', null, randomUUID()); }, true); }
}
