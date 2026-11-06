import { EditorProfileRegistryEntryV2Schema, FavoriteSchema, IdSchema, PaginationSchema } from '@shoushang/contracts';
import type { EditorProfileRegistryEntryV2, Favorite, LocalRepository, LocalWorkQuery, Page, Result, SaveWorkInput, StorageFailure, Work, WorkV1, WorkV2 } from '@shoushang/contracts';
import { createPapercutCore } from '@shoushang/papercut-core';
import { canonicalizeJsonJcs, sha256CanonicalJson, validateNewOrSaveAsWorkV2, validateStoredWork, type StorageValidationOptions, type ValidatedStoredWork } from './v2-validation';

const core = createPapercutCore();
const VERSION = 3;
const DEFAULT_NAME = 'shoushang-local-v1';
type Failure = { ok: false; error: StorageFailure };
export type StoredThumbnail = { workId: string; workRevision: number; state: 'ready' | 'pending'; blob?: Blob };
type Thumbnail = StoredThumbnail;
export type EditorStep = 'template' | 'color' | 'cut' | 'preview' | 'save';
export interface EditorDraft { workId: string; work: Work; step: EditorStep; revision: number; baseRevision: number | null; updatedAt: string }
type DraftMetadata = Omit<EditorDraft, 'work'>;
export type ValidatedStoredDraft =
  | (DraftMetadata & { readonly schemaVersion: 1; readonly work: WorkV1 })
  | (DraftMetadata & { readonly schemaVersion: 2; readonly work: WorkV2; readonly historicalMode: EditorProfileRegistryEntryV2['lifecycle']['historicalMode'] });
export interface DraftInput { work: Work; step: EditorStep; expectedDraftRevision: number | null; baseRevision: number | null }
export interface CommitDraftInput { workId: string; expectedDraftRevision: number; expectedWorkRevision: number | null; thumbnail?: Blob }
export interface SaveV2Input { work: WorkV2; expectedRevision: number | null }
export interface V2DraftInput { work: WorkV2; step: EditorStep; expectedDraftRevision: number | null; baseRevision: number | null }
export interface CommitV2DraftInput { workId: string; expectedDraftRevision: number; expectedWorkRevision: number | null; thumbnail?: Blob }
export interface EditorDraftV2 { workId: string; work: WorkV2; step: EditorStep; revision: number; baseRevision: number | null; updatedAt: string }
interface SaveV1AsV2Common { sourceWorkId: string; expectedSourceRevision: number; newWorkId: string }
export type SaveV1AsV2Input =
  | (SaveV1AsV2Common & { target: 'draft'; step: EditorStep })
  | (SaveV1AsV2Common & { target: 'completed'; thumbnail?: Blob });
export type SaveV1AsV2Result =
  | { target: 'draft'; draft: EditorDraftV2 }
  | { target: 'completed'; work: WorkV2; thumbnail: StoredThumbnail };
/** Converts the newest v1 standalone draft content. Never substitutes the same-ID completed work. */
export interface SaveV1DraftAsV2Input {
  sourceWorkId: string;
  expectedSourceDraftRevision: number;
  expectedSourceWorkRevision: number | null;
  newWorkId: string;
}
/** null means the corresponding record must not exist. Neither revision may be ignored. */
export interface ManageWorkInput { workId: string; expectedWorkRevision: number | null; expectedDraftRevision: number | null }
export interface RenameWorkInput extends ManageWorkInput { name: string }
export interface ManagedWork { work: Work | null; draft: EditorDraft | null }
export interface ManagedAnyWork { work: ValidatedStoredWork | null; draft: ValidatedStoredDraft | null }
export interface RecordIssue { store: 'works' | 'drafts' | 'draftRevisions' | 'thumbnails' | 'favorites'; key: string; code: 'INVALID_INPUT' | 'UNSUPPORTED_VERSION'; fieldErrors: StorageFailure['fieldErrors'] }
export interface RawBackup { databaseName: string; exportedAt: string; records: Record<string, { key: string; value: unknown }[]> }
export interface IndexedDbRepository extends LocalRepository {
  readonly persistence: 'indexeddb';
  readonly favorites: { list(): Promise<Result<Favorite[], StorageFailure>>; put(favorite: Favorite): Promise<Result<Favorite, StorageFailure>>; remove(exhibitId: string): Promise<Result<{ exhibitId: string }, StorageFailure>> };
  saveWithThumbnail(input: SaveWorkInput, thumbnail?: Blob): Promise<Result<Work, StorageFailure>>;
  saveDraft(input: DraftInput): Promise<Result<EditorDraft, StorageFailure>>;
  readDraft(workId: string): Promise<Result<EditorDraft, StorageFailure>>;
  listDrafts(): Promise<Result<EditorDraft[], StorageFailure>>;
  discardDraft(workId: string, expectedDraftRevision: number): Promise<Result<{ workId: string }, StorageFailure>>;
  commitDraft(input: CommitDraftInput): Promise<Result<Work, StorageFailure>>;
  renameWork(input: RenameWorkInput): Promise<Result<ManagedWork, StorageFailure>>;
  deleteWork(input: ManageWorkInput): Promise<Result<{ workId: string }, StorageFailure>>;
  renameAnyWork(input: RenameWorkInput): Promise<Result<ManagedAnyWork, StorageFailure>>;
  deleteAnyWork(input: ManageWorkInput): Promise<Result<{ workId: string }, StorageFailure>>;
  readThumbnail(workId: string): Promise<Result<Thumbnail, StorageFailure>>;
  rebuildThumbnail(workId: string, expectedWorkRevision: number, blob: Blob): Promise<Result<Thumbnail, StorageFailure>>;
  readAnyWork(id: string): Promise<Result<ValidatedStoredWork, StorageFailure>>;
  listAnyWorks(query?: LocalWorkQuery): Promise<Result<Page<ValidatedStoredWork>, StorageFailure>>;
  readAnyDraft(workId: string): Promise<Result<ValidatedStoredDraft, StorageFailure>>;
  listAnyDrafts(): Promise<Result<ValidatedStoredDraft[], StorageFailure>>;
  saveV2WithThumbnail(input: SaveV2Input, thumbnail?: Blob): Promise<Result<WorkV2, StorageFailure>>;
  saveV2Draft(input: V2DraftInput): Promise<Result<EditorDraftV2, StorageFailure>>;
  commitV2Draft(input: CommitV2DraftInput): Promise<Result<WorkV2, StorageFailure>>;
  discardV2Draft(workId: string, expectedDraftRevision: number): Promise<Result<{ workId: string }, StorageFailure>>;
  readAnyThumbnail(workId: string): Promise<Result<StoredThumbnail, StorageFailure>>;
  rebuildV2Thumbnail(workId: string, expectedWorkRevision: number, blob: Blob): Promise<Result<StoredThumbnail, StorageFailure>>;
  saveV1AsV2(input: SaveV1AsV2Input): Promise<Result<SaveV1AsV2Result, StorageFailure>>;
  saveV1DraftAsV2(input: SaveV1DraftAsV2Input): Promise<Result<EditorDraftV2, StorageFailure>>;
  inspectRecords(): Promise<Result<RecordIssue[], StorageFailure>>;
  exportRawBackup(): Promise<Result<RawBackup, StorageFailure>>;
  close(): void;
}
export interface IndexedDbOptions { name?: string; now?: () => string; openTimeoutMs?: number; onVersionChange?: () => void; v2ProfileRegistry?: readonly EditorProfileRegistryEntryV2[]; v2Validation?: StorageValidationOptions; /** Tests only: abort after a successful write request. */ testAbortAfterWrite?: boolean; /** Tests only: abort the real transaction at the database boundary and report simulated quota exhaustion. */ testQuotaAfterWrite?: boolean }

function fail(code: Exclude<StorageFailure['code'], 'REVISION_CONFLICT'>, message: string, fieldErrors: StorageFailure['fieldErrors'] = []): Failure {
  return { ok: false, error: { code, message, requestId: 'indexeddb-v1', fieldErrors } };
}
function conflict(expectedRevision: number | null, actualRevision: number | null): Failure {
  return { ok: false, error: { code: 'REVISION_CONFLICT', message: '修订冲突，请重新载入或保留当前内容', requestId: 'indexeddb-v1', fieldErrors: [], expectedRevision, actualRevision } };
}
function idValid(id: string): boolean { return IdSchema.safeParse(id).success; }
function revValid(n: number | null): boolean { return n === null || Number.isSafeInteger(n) && n >= 0; }
function recordRevision(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const revision = Reflect.get(value, 'revision');
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}
function clone<T>(value: T): T { return structuredClone(value); }
function checked(value: unknown): Result<Work, StorageFailure> {
  const result = core.validate(value as Work);
  if (result.ok) return { ok: true, value: result.value };
  return fail(result.error.code === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT', result.error.message, result.error.fieldErrors);
}
function draftChecked(value: unknown): Result<EditorDraft, StorageFailure> {
  if (!value || typeof value !== 'object') return fail('INVALID_INPUT', '草稿结构非法', [{ path: 'draft', message: '需要对象' }]);
  const d = value as Partial<EditorDraft>;
  const w = checked(d.work);
  if (!w.ok) return w;
  if (!idValid(d.workId ?? '') || d.workId !== w.value.id || !['template','color','cut','preview','save'].includes(d.step ?? '') || !Number.isSafeInteger(d.revision) || (d.revision ?? 0) < 1 || !('baseRevision' in d) || !revValid(d.baseRevision ?? null) || (d.baseRevision !== null && (d.baseRevision ?? 0) < 1) || typeof d.updatedAt !== 'string' || Number.isNaN(Date.parse(d.updatedAt))) return fail('INVALID_INPUT', '草稿元数据非法', [{ path: 'draft', message: 'ID、步骤或修订不合法' }]);
  return { ok: true, value: clone(d as EditorDraft) };
}
function schemaVersionOf(value: unknown): unknown { return value && typeof value === 'object' ? Reflect.get(value, 'schemaVersion') : undefined; }
function v2RegistryRequired(): Failure { return fail('UNSUPPORTED_VERSION', '读取 v2 记录需要配置编辑器 profile 注册表', [{ path: 'v2ProfileRegistry', message: '未提供 v2 profile 注册表' }]); }
function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowedKeys.has(key));
}
function draftMetadata(value: unknown): Result<DraftMetadata, StorageFailure> {
  if (!value || typeof value !== 'object') return fail('INVALID_INPUT', '草稿结构非法', [{ path: 'draft', message: '需要对象' }]);
  const d = value as Partial<EditorDraft>;
  if (!hasOnlyKeys(value, ['workId','work','step','revision','baseRevision','updatedAt'])) return fail('INVALID_INPUT', '草稿结构非法', [{ path: 'draft', message: '草稿不得包含历史或其他额外字段' }]);
  if (!idValid(d.workId ?? '') || !['template','color','cut','preview','save'].includes(d.step ?? '') || !Number.isSafeInteger(d.revision) || (d.revision ?? 0) < 1 || !('baseRevision' in d) || !revValid(d.baseRevision ?? null) || (d.baseRevision !== null && (d.baseRevision ?? 0) < 1) || typeof d.updatedAt !== 'string' || Number.isNaN(Date.parse(d.updatedAt))) return fail('INVALID_INPUT', '草稿元数据非法', [{ path: 'draft', message: 'ID、步骤或修订不合法' }]);
  const { work: _work, ...metadata } = d as EditorDraft;
  return { ok: true, value: clone(metadata) };
}
function request<T>(req: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function complete(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError')); tx.onerror = () => reject(tx.error ?? new DOMException('error', 'UnknownError')); }); }
function translated(e: unknown): Failure { return fail(e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') ? 'QUOTA_EXCEEDED' : 'STORAGE_UNAVAILABLE', '本地存储操作失败'); }
function nextTime(now: () => string, createdAt: string, previous?: string): string | null {
  const current = Date.parse(now()), created = Date.parse(createdAt), old = previous ? Date.parse(previous) : created;
  if (![current, created, old].every(Number.isFinite)) return null;
  return new Date(Math.max(current, created, previous ? old + 1 : created)).toISOString();
}
function keysCount(works: IDBObjectStore, drafts: IDBObjectStore): Promise<number> { return Promise.all([request(works.getAllKeys()), request(drafts.getAllKeys())]).then(([a,b]) => new Set([...a,...b].map(String)).size); }

/** Opens real IndexedDB. A rejected open never falls back to memory. */
export async function openIndexedDbRepository(options: IndexedDbOptions = {}): Promise<Result<IndexedDbRepository, StorageFailure>> {
  if (typeof indexedDB === 'undefined') return fail('STORAGE_UNAVAILABLE', '此浏览器不支持 IndexedDB');
  const name = options.name ?? DEFAULT_NAME, timeout = options.openTimeoutMs ?? 3000, now = options.now ?? (() => new Date().toISOString());
  if (!name || !Number.isFinite(timeout) || timeout < 1) return fail('INVALID_INPUT', '数据库参数非法');
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, VERSION);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new DOMException('open timeout', 'TimeoutError')); }, timeout);
      open.onupgradeneeded = event => {
        const d = open.result, tx = open.transaction;
        if (!tx) return;
        const testLegacy=event.oldVersion===1 && d.objectStoreNames.contains('m05-test-legacy-works') && d.objectStoreNames.contains('m05-test-legacy-favorites') && d.objectStoreNames.length===2;
        const previousM05=event.oldVersion===2 && ['works','drafts','thumbnails','favorites'].every(store=>d.objectStoreNames.contains(store));
        if(event.oldVersion!==0 && !testLegacy && !previousM05){tx.abort();return;}
        const works=previousM05?tx.objectStore('works'):d.createObjectStore('works',{keyPath:'id'});
        if(!previousM05)works.createIndex('updatedAt','updatedAt');
        const drafts=previousM05?tx.objectStore('drafts'):d.createObjectStore('drafts',{keyPath:'workId'});
        if(!previousM05)d.createObjectStore('thumbnails',{keyPath:'workId'});
        const favorites=previousM05?tx.objectStore('favorites'):d.createObjectStore('favorites',{keyPath:'exhibitId'});
        const draftRevisions=d.createObjectStore('draftRevisions',{keyPath:'workId'});
        if(previousM05){
          // Bump active v2 drafts during upgrade. Existing tabs close on versionchange;
          // stale pre-upgrade revision numbers cannot match the migrated draft.
          const oldDrafts=drafts.getAll();
          oldDrafts.onsuccess=()=>{for(const raw of oldDrafts.result){const parsed=draftChecked(raw);if(!parsed.ok)continue;const revision=Math.max(parsed.value.revision+1,Date.now());if(!Number.isSafeInteger(revision)){tx.abort();return;}drafts.put({...parsed.value,revision});draftRevisions.put({workId:parsed.value.workId,revision});}};
        }
        if(event.oldVersion===1){
          // Explicitly test-only legacy fixture. No public historical format exists.
          const oldWorks=tx.objectStore('m05-test-legacy-works').getAll();
          oldWorks.onsuccess=()=>{for(const raw of oldWorks.result){if(!raw||typeof raw!=='object'||!('work' in raw)){tx.abort();return;}const parsed=checked((raw as {work:unknown}).work);if(!parsed.ok){tx.abort();return;}works.put(parsed.value);}};
          const oldFavorites=tx.objectStore('m05-test-legacy-favorites').getAll();
          oldFavorites.onsuccess=()=>{for(const raw of oldFavorites.result){if(!raw||typeof raw!=='object'||!('favorite' in raw)){tx.abort();return;}const parsed=FavoriteSchema.safeParse((raw as {favorite:unknown}).favorite);if(!parsed.success){tx.abort();return;}favorites.put(parsed.data);}};
        }
      };
      open.onsuccess = () => { clearTimeout(timer); if (expired) open.result.close(); else resolve(open.result); };
      open.onerror = () => { clearTimeout(timer); reject(open.error); };
      open.onblocked = () => { /* bounded timer reports a recoverable unavailable result */ };
    });
  } catch (e) { return e instanceof DOMException && e.name === 'VersionError' ? fail('UNSUPPORTED_VERSION', '数据库版本高于当前程序，请使用兼容版本') : fail('STORAGE_UNAVAILABLE', '无法打开本地数据库；如有旧标签页，请关闭后重试'); }
  let closed = false;
  const close = () => { if (!closed) { closed = true; db.close(); } };
  db.onversionchange = () => { close(); options.onVersionChange?.(); };
  async function run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => Promise<Result<T, StorageFailure>>): Promise<Result<T, StorageFailure>> {
    if (closed) return fail('STORAGE_UNAVAILABLE', '数据库连接已关闭，请重新打开');
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, mode); } catch { return fail('STORAGE_UNAVAILABLE', '无法开始本地事务'); }
    const done = complete(tx);
    try {
      const result = await body(tx);
      const injectedQuota=options.testQuotaAfterWrite && mode === 'readwrite' && result.ok;
      if ((options.testAbortAfterWrite || injectedQuota) && mode === 'readwrite' && result.ok) tx.abort();
      try { await done; } catch (e) { return injectedQuota ? fail('QUOTA_EXCEEDED', '测试注入：事务在写入后因容量不足回滚') : translated(e); }
      return result.ok ? { ok: true, value: clone(result.value) } : result;
    } catch (e) { try { tx.abort(); } catch { /* already finished */ } try { await done; } catch { /* handled below */ } return translated(e); }
  }
  async function validateAny(raw: unknown): Promise<Result<ValidatedStoredWork, StorageFailure>> {
    if (schemaVersionOf(raw) === 2 && options.v2ProfileRegistry === undefined) return v2RegistryRequired();
    return validateStoredWork(raw, options.v2ProfileRegistry ?? [], options.v2Validation);
  }
  async function validateAnyDraft(raw: unknown): Promise<Result<ValidatedStoredDraft, StorageFailure>> {
    const metadata = draftMetadata(raw);
    if (!metadata.ok) return metadata;
    const stored = raw as { work?: unknown };
    const validated = await validateAny(stored.work);
    if (!validated.ok) return validated;
    if (metadata.value.workId !== validated.value.work.id) return fail('INVALID_INPUT', '草稿元数据非法', [{ path: 'workId', message: '草稿 workId 与作品 id 不一致' }]);
    return validated.value.schemaVersion === 1
      ? { ok: true, value: { ...metadata.value, schemaVersion: 1, work: validated.value.work } }
      : { ok: true, value: { ...metadata.value, schemaVersion: 2, work: validated.value.work, historicalMode: validated.value.historicalMode } };
  }
  async function readRawRecord(storeName: 'works' | 'drafts' | 'draftRevisions' | 'thumbnails', key: string): Promise<Result<unknown, StorageFailure>> {
    return run([storeName], 'readonly', async tx => ({ ok: true, value: await request(tx.objectStore(storeName).get(key)) }));
  }
  function snapshotSignature(value: unknown): Result<string, StorageFailure> {
    return canonicalizeJsonJcs(value);
  }
  function snapshotMatches(value: unknown, signature: string): Result<boolean, StorageFailure> {
    const current = snapshotSignature(value);
    return current.ok ? { ok: true, value: current.value === signature } : current;
  }
  async function validatedV2(value: unknown): Promise<Result<Extract<ValidatedStoredWork, { schemaVersion: 2 }>, StorageFailure>> {
    const result = await validateAny(value);
    if (!result.ok) return result;
    return result.value.schemaVersion === 2 ? { ok: true, value: result.value } : fail('INVALID_INPUT', '同一作品 ID 已属于 v1，不能由 v2 写入覆盖', [{ path: 'schemaVersion', message: '跨版本覆盖被拒绝' }]);
  }
  async function validatedV2Draft(value: unknown): Promise<Result<Extract<ValidatedStoredDraft, { schemaVersion: 2 }>, StorageFailure>> {
    const result = await validateAnyDraft(value);
    if (!result.ok) return result;
    return result.value.schemaVersion === 2 ? { ok: true, value: result.value } : fail('INVALID_INPUT', '同一草稿 ID 已属于 v1，不能由 v2 写入覆盖', [{ path: 'work.schemaVersion', message: '跨版本覆盖被拒绝' }]);
  }
  function requireEditable(mode: EditorProfileRegistryEntryV2['lifecycle']['historicalMode']): Failure | null {
    return mode === 'editable' ? null : fail('INVALID_INPUT', '该历史作品仅允许读取和导出', [{ path: 'lifecycle.historicalMode', message: 'read-export-only 作品不可写入创作变更' }]);
  }
  function checkedLedger(value: unknown, workId: string): Result<number, StorageFailure> {
    if (value === undefined) return { ok: true, value: 0 };
    const ledger = value as { workId?: unknown; revision?: unknown } | null;
    return ledger && ledger.workId === workId && typeof ledger.revision === 'number' && Number.isSafeInteger(ledger.revision) && ledger.revision >= 1
      ? { ok: true, value: ledger.revision }
      : fail('INVALID_INPUT', '草稿修订记录损坏', [{ path: 'draftRevisions', message: '修订记录损坏' }]);
  }
  function immutableV2Matches(previous: WorkV2, next: WorkV2): boolean {
    const previousTemplate = snapshotSignature(previous.templateSnapshot);
    const nextTemplate = snapshotSignature(next.templateSnapshot);
    const previousProfile = snapshotSignature(previous.editorProfileSnapshot);
    const nextProfile = snapshotSignature(next.editorProfileSnapshot);
    return previous.id === next.id && previous.schemaVersion === next.schemaVersion && previous.craftId === next.craftId
      && previousTemplate.ok && nextTemplate.ok && previousTemplate.value === nextTemplate.value
      && previousProfile.ok && nextProfile.ok && previousProfile.value === nextProfile.value;
  }
  async function profileForV1Source(source: WorkV1): Promise<Result<EditorProfileRegistryEntryV2, StorageFailure>> {
    if(options.v2ProfileRegistry===undefined)return v2RegistryRequired();
    const entries:EditorProfileRegistryEntryV2[]=[];
    for(const [index,entry] of options.v2ProfileRegistry.entries()){
      const parsed=EditorProfileRegistryEntryV2Schema.safeParse(entry);
      if(!parsed.success)return fail('INVALID_INPUT','v2 profile 注册表损坏',parsed.error.issues.map(issue=>({path:['v2ProfileRegistry',index,...issue.path].join('.'),message:issue.message})));
      entries.push(parsed.data);
    }
    const digest=await sha256CanonicalJson(source.templateSnapshot,options.v2Validation);if(!digest.ok)return digest;
    const matches=entries.filter(entry=>entry.profile.sourceTemplate.id===source.templateSnapshot.id&&entry.profile.sourceTemplate.version===source.templateSnapshot.version&&entry.profile.sourceTemplate.snapshotSha256===digest.value);
    if(matches.length===0)return fail('UNSUPPORTED_VERSION','源模板没有精确匹配的可用 v2 profile',[{path:'templateSnapshot',message:'必须同时匹配模板 id、version 和 SHA-256 摘要'}]);
    if(matches.length!==1)return fail('INVALID_INPUT','源模板匹配到多个 v2 profile',[{path:'v2ProfileRegistry',message:'模板 id、version 和摘要必须唯一匹配'}]);
    const match=matches[0]!;
    if(!match.lifecycle.newWorkEnabled)return fail('INVALID_INPUT','匹配的 v2 profile 已禁止新建或另存',[{path:'lifecycle.newWorkEnabled',message:'该 profile 不允许另存新副本'}]);
    return {ok:true,value:match};
  }
  const repository: IndexedDbRepository = {
    persistence: 'indexeddb', close,
    list(query: LocalWorkQuery = {}) { return run(['works'], 'readonly', async tx => {
      const p = PaginationSchema.safeParse({ page: query.page, pageSize: query.pageSize });
      if (!p.success || query.status !== undefined && query.status !== 'draft' && query.status !== 'completed') return fail('INVALID_INPUT', '列表参数非法');
      const raw = await request(tx.objectStore('works').getAll());
      const rows: Work[] = [];
      for (const item of raw) { const w = checked(item); if (w.ok && (!query.status || w.value.status === query.status)) rows.push(w.value); }
      rows.sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
      const { page, pageSize } = p.data;
      return { ok: true, value: { items: rows.slice((page-1)*pageSize,page*pageSize), total: rows.length, page, pageSize } };
    }); },
    read(id) { if (!idValid(id)) return Promise.resolve(fail('INVALID_INPUT','作品ID非法')); return run(['works'], 'readonly', async tx => { const raw: unknown = await request(tx.objectStore('works').get(id)); return raw === undefined ? fail('NOT_FOUND','作品不存在') : checked(raw); }); },
    async readAnyWork(id) {
      if (!idValid(id)) return fail('INVALID_INPUT','作品ID非法');
      const snapshot = await run(['works'], 'readonly', async tx => {
        const raw: unknown = await request(tx.objectStore('works').get(id));
        return raw === undefined ? fail('NOT_FOUND','作品不存在') : { ok: true, value: raw };
      });
      return snapshot.ok ? validateAny(snapshot.value) : snapshot;
    },
    async listAnyWorks(query = {}) {
      const parsed = PaginationSchema.safeParse({ page: query.page, pageSize: query.pageSize });
      if (!parsed.success || query.status !== undefined && query.status !== 'draft' && query.status !== 'completed') return fail('INVALID_INPUT', '列表参数非法');
      const snapshot = await run(['works'], 'readonly', async tx => ({ ok: true, value: await request(tx.objectStore('works').getAll()) }));
      if (!snapshot.ok) return snapshot;
      const rows: ValidatedStoredWork[] = [];
      for (const raw of snapshot.value) {
        const item = await validateAny(raw);
        if (item.ok) {
          if (!query.status || item.value.work.status === query.status) rows.push(item.value);
        } else if (item.error.code === 'STORAGE_UNAVAILABLE' || schemaVersionOf(raw) === 2 && options.v2ProfileRegistry === undefined) {
          return item;
        }
      }
      rows.sort((a,b) => Date.parse(b.work.updatedAt)-Date.parse(a.work.updatedAt) || a.work.id.localeCompare(b.work.id));
      const { page, pageSize } = parsed.data;
      return { ok: true, value: clone({ items: rows.slice((page-1)*pageSize,page*pageSize), total: rows.length, page, pageSize }) };
    },
    async readAnyDraft(workId) {
      if (!idValid(workId)) return fail('INVALID_INPUT','ID非法');
      const snapshot = await run(['drafts'], 'readonly', async tx => {
        const raw: unknown = await request(tx.objectStore('drafts').get(workId));
        return raw === undefined ? fail('NOT_FOUND','草稿不存在') : { ok: true, value: raw };
      });
      return snapshot.ok ? validateAnyDraft(snapshot.value) : snapshot;
    },
    async listAnyDrafts() {
      const snapshot = await run(['drafts'], 'readonly', async tx => ({ ok: true, value: await request(tx.objectStore('drafts').getAll()) }));
      if (!snapshot.ok) return snapshot;
      const items: ValidatedStoredDraft[] = [];
      for (const raw of snapshot.value) {
        const item = await validateAnyDraft(raw);
        if (item.ok) items.push(item.value);
        else if (item.error.code === 'STORAGE_UNAVAILABLE' || schemaVersionOf((raw as { work?: unknown })?.work) === 2 && options.v2ProfileRegistry === undefined) return item;
      }
      items.sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt) || a.workId.localeCompare(b.workId));
      return { ok: true, value: clone(items) };
    },
    async saveV2WithThumbnail(input, thumbnail) {
      if (!input || typeof input !== 'object' || !hasOnlyKeys(input, ['work','expectedRevision']) || !revValid(input.expectedRevision) || thumbnail !== undefined && !(thumbnail instanceof Blob)) return fail('INVALID_INPUT','v2 作品修订或缩略图非法');
      if (options.v2ProfileRegistry === undefined) return v2RegistryRequired();
      if (input.work?.status !== 'completed' || input.work.revision !== (input.expectedRevision ?? 0)) return fail('INVALID_INPUT','v2 完成版状态或修订非法',[{path:'work',message:'完成版必须为 completed，且输入 revision 必须等于预期修订'}]);
      let work: WorkV2;
      if (input.expectedRevision === null) {
        const proposed = await validateNewOrSaveAsWorkV2(input.work, options.v2ProfileRegistry, options.v2Validation);
        if (!proposed.ok) return proposed;
        work = proposed.value;
      } else {
        const proposed = await validateStoredWork(input.work, options.v2ProfileRegistry, options.v2Validation);
        if (!proposed.ok) return proposed;
        if (proposed.value.schemaVersion !== 2) return fail('INVALID_INPUT','v2 写入只接受 WorkV2');
        const editableFailure = requireEditable(proposed.value.historicalMode); if (editableFailure) return editableFailure;
        work = proposed.value.work;
      }
      const snapshot = await run(['works','drafts'],'readonly',async tx=>{const [storedWork,storedDraft]=await Promise.all([request(tx.objectStore('works').get(work.id)),request(tx.objectStore('drafts').get(work.id))]);return {ok:true,value:{storedWork,storedDraft}};});
      if (!snapshot.ok) return snapshot;
      let previous: Extract<ValidatedStoredWork, { schemaVersion: 2 }> | null = null;
      let previousSignature: string | null = null;
      if (snapshot.value.storedWork !== undefined) {
        const checked = await validatedV2(snapshot.value.storedWork);
        if (!checked.ok) return checked;
        previous = checked.value;
        const editableFailure = requireEditable(previous.historicalMode); if (editableFailure) return editableFailure;
        if (input.expectedRevision === null || previous.work.revision !== input.expectedRevision) return conflict(input.expectedRevision, previous.work.revision);
        if (!immutableV2Matches(previous.work, work)) return fail('INVALID_INPUT','v2 编辑不得替换模板、profile、工艺或 schemaVersion',[{path:'work',message:'不可变作品身份不一致'}]);
        const signature = snapshotSignature(snapshot.value.storedWork); if (!signature.ok) return signature; previousSignature = signature.value;
      } else if (input.expectedRevision !== null) return conflict(input.expectedRevision, null);
      let previousDraftRevision: number | null = null;
      let previousDraftSignature: string | null = null;
      if(snapshot.value.storedDraft!==undefined){
        const checked=await validatedV2Draft(snapshot.value.storedDraft);if(!checked.ok)return checked;
        const editableFailure=requireEditable(checked.value.historicalMode);if(editableFailure)return editableFailure;
        if(!immutableV2Matches(checked.value.work,work))return fail('INVALID_INPUT','待清理草稿与 v2 完成版的不可变身份不一致',[{path:'draft.work',message:'不可变作品身份不一致'}]);
        previousDraftRevision=checked.value.revision;
        const signature=snapshotSignature(snapshot.value.storedDraft);if(!signature.ok)return signature;previousDraftSignature=signature.value;
      }
      return run(['works','drafts','thumbnails'], 'readwrite', async tx => {
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts');
        const [currentRaw,currentDraftRaw]=await Promise.all([request(works.get(work.id)),request(drafts.get(work.id))]);
        if (previousSignature === null) {
          if (currentRaw !== undefined) return conflict(input.expectedRevision, recordRevision(currentRaw));
        } else {
          if (currentRaw === undefined) return conflict(input.expectedRevision,null);
          const same=snapshotMatches(currentRaw,previousSignature);if(!same.ok)return same;if(!same.value)return conflict(input.expectedRevision,recordRevision(currentRaw));
        }
        if(previousDraftSignature===null){
          if(currentDraftRaw!==undefined)return conflict(null,recordRevision(currentDraftRaw));
        }else{
          if(currentDraftRaw===undefined)return conflict(previousDraftRevision,null);
          const same=snapshotMatches(currentDraftRaw,previousDraftSignature);if(!same.ok)return same;if(!same.value)return conflict(previousDraftRevision,recordRevision(currentDraftRaw));
        }
        if (currentRaw !== undefined && (schemaVersionOf(currentRaw)!==2 || recordRevision(currentRaw)!==input.expectedRevision)) return conflict(input.expectedRevision,recordRevision(currentRaw));
        if (currentRaw===undefined && await keysCount(works,drafts)>=100 && currentDraftRaw===undefined) return fail('QUOTA_EXCEEDED','已达到100件作品上限');
        const createdAt=previous?.work.createdAt??work.createdAt,updatedAt=nextTime(now,createdAt,previous?.work.updatedAt);if(!updatedAt)return fail('INVALID_INPUT','时钟或作品时间非法',[{path:'updatedAt',message:'时间非法'}]);
        const saved:WorkV2={...work,status:'completed',createdAt,updatedAt,revision:(input.expectedRevision??0)+1};
        await request(works.put(saved));
        await request(tx.objectStore('thumbnails').put({workId:saved.id,workRevision:saved.revision,state:thumbnail?'ready':'pending',...(thumbnail?{blob:thumbnail}:{})} satisfies Thumbnail));
        await request(drafts.delete(saved.id));
        return {ok:true,value:saved};
      });
    },
    async saveV2Draft(input) {
      if (!input || typeof input !== 'object' || !hasOnlyKeys(input, ['work','step','expectedDraftRevision','baseRevision']) || !['template','color','cut','preview','save'].includes(input.step) || !revValid(input.expectedDraftRevision) || !revValid(input.baseRevision)) return fail('INVALID_INPUT','v2 草稿参数非法');
      if (options.v2ProfileRegistry === undefined) return v2RegistryRequired();
      if (input.work?.status !== 'draft' || input.work.revision !== (input.baseRevision ?? 0) || input.baseRevision === 0) return fail('INVALID_INPUT','v2 草稿状态或基线修订非法',[{path:'work.revision',message:'草稿 revision 必须等于 baseRevision；新草稿均为0'}]);
      const [workSnapshot,draftSnapshot,ledgerSnapshot]=await Promise.all([readRawRecord('works',input.work.id),readRawRecord('drafts',input.work.id),readRawRecord('draftRevisions',input.work.id)]);
      if(!workSnapshot.ok)return workSnapshot;if(!draftSnapshot.ok)return draftSnapshot;if(!ledgerSnapshot.ok)return ledgerSnapshot;
      const completed=workSnapshot.value===undefined?null:await validatedV2(workSnapshot.value);if(completed&&!completed.ok)return completed;
      const current=draftSnapshot.value===undefined?null:await validatedV2Draft(draftSnapshot.value);if(current&&!current.ok)return current;
      if(completed){const denied=requireEditable(completed.value.historicalMode);if(denied)return denied;}
      if(current){const denied=requireEditable(current.value.historicalMode);if(denied)return denied;}
      if((current?.value.revision??null)!==input.expectedDraftRevision)return conflict(input.expectedDraftRevision,current?.value.revision??null);
      if((completed?.value.work.revision??null)!==input.baseRevision || current&&current.value.baseRevision!==input.baseRevision)return conflict(input.baseRevision,completed?.value.work.revision??null);
      let proposedWork: WorkV2;
      if (current || completed) {
        const proposed=await validateStoredWork(input.work,options.v2ProfileRegistry,options.v2Validation);if(!proposed.ok)return proposed;
        if(proposed.value.schemaVersion!==2)return fail('INVALID_INPUT','v2 草稿只接受 WorkV2');
        const denied=requireEditable(proposed.value.historicalMode);if(denied)return denied;
        proposedWork=proposed.value.work;
      } else {
        const proposed=await validateNewOrSaveAsWorkV2(input.work,options.v2ProfileRegistry,options.v2Validation);if(!proposed.ok)return proposed;
        proposedWork=proposed.value;
      }
      if(completed&&!immutableV2Matches(completed.value.work,proposedWork) || current&&!immutableV2Matches(current.value.work,proposedWork))return fail('INVALID_INPUT','v2 草稿不得替换模板、profile、工艺或 schemaVersion');
      const ledger=checkedLedger(ledgerSnapshot.value,input.work.id);if(!ledger.ok)return ledger;
      const workSignature=workSnapshot.value===undefined?null:snapshotSignature(workSnapshot.value);if(workSignature&&!workSignature.ok)return workSignature;
      const draftSignature=draftSnapshot.value===undefined?null:snapshotSignature(draftSnapshot.value);if(draftSignature&&!draftSignature.ok)return draftSignature;
      const ledgerSignature=ledgerSnapshot.value===undefined?null:snapshotSignature(ledgerSnapshot.value);if(ledgerSignature&&!ledgerSignature.ok)return ledgerSignature;
      const revisionSeed=Date.now();
      return run(['works','drafts','draftRevisions'],'readwrite',async tx=>{
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts'),revisions=tx.objectStore('draftRevisions');
        const [workRaw,draftRaw,ledgerRaw]=await Promise.all([request(works.get(input.work.id)),request(drafts.get(input.work.id)),request(revisions.get(input.work.id))]);
        if(workSignature===null?workRaw!==undefined:workRaw===undefined)return conflict(input.baseRevision,recordRevision(workRaw));
        if(workSignature){const same=snapshotMatches(workRaw,workSignature.value);if(!same.ok)return same;if(!same.value)return conflict(input.baseRevision,recordRevision(workRaw));}
        if(draftSignature===null?draftRaw!==undefined:draftRaw===undefined)return conflict(input.expectedDraftRevision,recordRevision(draftRaw));
        if(draftSignature){const same=snapshotMatches(draftRaw,draftSignature.value);if(!same.ok)return same;if(!same.value)return conflict(input.expectedDraftRevision,recordRevision(draftRaw));}
        if(ledgerSignature===null?ledgerRaw!==undefined:ledgerRaw===undefined)return conflict(input.expectedDraftRevision,recordRevision(draftRaw));
        if(ledgerSignature){const same=snapshotMatches(ledgerRaw,ledgerSignature.value);if(!same.ok)return same;if(!same.value)return conflict(input.expectedDraftRevision,recordRevision(draftRaw));}
        if(!completed&&!current&&await keysCount(works,drafts)>=100)return fail('QUOTA_EXCEEDED','已达到100件作品上限');
        const createdAt=current?.value.work.createdAt??completed?.value.work.createdAt??proposedWork.createdAt;
        const updatedAt=nextTime(now,createdAt,current?.value.updatedAt??completed?.value.work.updatedAt);if(!updatedAt)return fail('INVALID_INPUT','草稿时间非法');
        const revision=Math.max(current?.value.revision??0,ledger.value,revisionSeed)+1;if(!Number.isSafeInteger(revision))return fail('QUOTA_EXCEEDED','草稿修订号已达上限');
        const work:WorkV2={...proposedWork,status:'draft',revision:input.baseRevision??0,createdAt,updatedAt};
        const draft:EditorDraftV2={workId:work.id,work,step:input.step,revision,baseRevision:input.baseRevision,updatedAt};
        await request(drafts.put(draft));await request(revisions.put({workId:work.id,revision}));return {ok:true,value:draft};
      });
    },
    async commitV2Draft(input) {
      if(!input||typeof input!=='object'||!hasOnlyKeys(input,['workId','expectedDraftRevision','expectedWorkRevision','thumbnail'])||!idValid(input.workId)||!Number.isInteger(input.expectedDraftRevision)||input.expectedDraftRevision<1||!revValid(input.expectedWorkRevision)||input.expectedWorkRevision===0||input.thumbnail!==undefined&&!(input.thumbnail instanceof Blob))return fail('INVALID_INPUT','v2 草稿提交参数非法');
      if(options.v2ProfileRegistry===undefined)return v2RegistryRequired();
      const [workSnapshot,draftSnapshot]=await Promise.all([readRawRecord('works',input.workId),readRawRecord('drafts',input.workId)]);if(!workSnapshot.ok)return workSnapshot;if(!draftSnapshot.ok)return draftSnapshot;
      if(draftSnapshot.value===undefined)return fail('NOT_FOUND','草稿不存在');
      const draft=await validatedV2Draft(draftSnapshot.value);if(!draft.ok)return draft;const draftDenied=requireEditable(draft.value.historicalMode);if(draftDenied)return draftDenied;
      const completed=workSnapshot.value===undefined?null:await validatedV2(workSnapshot.value);if(completed&&!completed.ok)return completed;
      if(completed){const denied=requireEditable(completed.value.historicalMode);if(denied)return denied;}
      const actual=completed?.value.work.revision??null;
      if(draft.value.revision!==input.expectedDraftRevision)return conflict(input.expectedDraftRevision,draft.value.revision);
      if(actual!==input.expectedWorkRevision||draft.value.baseRevision!==input.expectedWorkRevision)return conflict(input.expectedWorkRevision,actual);
      if(completed&&!immutableV2Matches(completed.value.work,draft.value.work))return fail('INVALID_INPUT','v2 草稿与完成版的不可变身份不一致');
      const workSignature=workSnapshot.value===undefined?null:snapshotSignature(workSnapshot.value);if(workSignature&&!workSignature.ok)return workSignature;
      const draftSignature=snapshotSignature(draftSnapshot.value);if(!draftSignature.ok)return draftSignature;
      return run(['works','drafts','thumbnails'],'readwrite',async tx=>{
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts');const [workRaw,draftRaw]=await Promise.all([request(works.get(input.workId)),request(drafts.get(input.workId))]);
        if(workSignature===null?workRaw!==undefined:workRaw===undefined)return conflict(input.expectedWorkRevision,recordRevision(workRaw));
        if(workSignature){const same=snapshotMatches(workRaw,workSignature.value);if(!same.ok)return same;if(!same.value)return conflict(input.expectedWorkRevision,recordRevision(workRaw));}
        if(draftRaw===undefined)return conflict(input.expectedDraftRevision,null);const sameDraft=snapshotMatches(draftRaw,draftSignature.value);if(!sameDraft.ok)return sameDraft;if(!sameDraft.value)return conflict(input.expectedDraftRevision,recordRevision(draftRaw));
        const createdAt=completed?.value.work.createdAt??draft.value.work.createdAt,updatedAt=nextTime(now,createdAt,completed?.value.work.updatedAt??draft.value.updatedAt);if(!updatedAt)return fail('INVALID_INPUT','时间非法');
        const saved:WorkV2={...draft.value.work,status:'completed',revision:(actual??0)+1,createdAt,updatedAt};
        await request(works.put(saved));await request(tx.objectStore('thumbnails').put({workId:input.workId,workRevision:saved.revision,state:input.thumbnail?'ready':'pending',...(input.thumbnail?{blob:input.thumbnail}:{})} satisfies Thumbnail));await request(drafts.delete(input.workId));return {ok:true,value:saved};
      });
    },
    async discardV2Draft(workId,expectedDraftRevision) {
      if(!idValid(workId)||!Number.isInteger(expectedDraftRevision)||expectedDraftRevision<1)return fail('INVALID_INPUT','v2 草稿 ID 或修订非法');
      const snapshot=await readRawRecord('drafts',workId);if(!snapshot.ok)return snapshot;if(snapshot.value===undefined)return fail('NOT_FOUND','草稿不存在');
      const draft=await validatedV2Draft(snapshot.value);if(!draft.ok)return draft;const denied=requireEditable(draft.value.historicalMode);if(denied)return denied;
      if(draft.value.revision!==expectedDraftRevision)return conflict(expectedDraftRevision,draft.value.revision);
      const signature=snapshotSignature(snapshot.value);if(!signature.ok)return signature;
      return run(['drafts'],'readwrite',async tx=>{const store=tx.objectStore('drafts'),raw:unknown=await request(store.get(workId));if(raw===undefined)return conflict(expectedDraftRevision,null);const same=snapshotMatches(raw,signature.value);if(!same.ok)return same;if(!same.value)return conflict(expectedDraftRevision,recordRevision(raw));await request(store.delete(workId));return {ok:true,value:{workId}};});
    },
    async readAnyThumbnail(workId) {
      if(!idValid(workId))return fail('INVALID_INPUT','ID非法');
      const snapshot=await run(['works','thumbnails'],'readonly',async tx=>{const [work,thumbnail]=await Promise.all([request(tx.objectStore('works').get(workId)),request(tx.objectStore('thumbnails').get(workId))]);return {ok:true,value:{work,thumbnail}};});if(!snapshot.ok)return snapshot;
      if(snapshot.value.thumbnail===undefined)return fail('NOT_FOUND','缩略图不存在');if(snapshot.value.work===undefined)return fail('INVALID_INPUT','缩略图缺少对应作品');
      const work=await validateAny(snapshot.value.work);if(!work.ok)return work;
      const thumbnail=snapshot.value.thumbnail as Partial<Thumbnail>;
      if(thumbnail.workId!==workId||!Number.isInteger(thumbnail.workRevision)||thumbnail.workRevision!==work.value.work.revision||thumbnail.state!=='ready'&&thumbnail.state!=='pending'||thumbnail.state==='ready'&&!(thumbnail.blob instanceof Blob)||!hasOnlyKeys(thumbnail,['workId','workRevision','state','blob']))return fail('INVALID_INPUT','缩略图记录损坏');
      return {ok:true,value:clone(thumbnail as Thumbnail)};
    },
    async rebuildV2Thumbnail(workId,expectedWorkRevision,blob) {
      if(!idValid(workId)||!Number.isInteger(expectedWorkRevision)||expectedWorkRevision<1||!(blob instanceof Blob))return fail('INVALID_INPUT','v2 缩略图参数非法');
      const snapshot=await readRawRecord('works',workId);if(!snapshot.ok)return snapshot;if(snapshot.value===undefined)return conflict(expectedWorkRevision,null);
      const work=await validatedV2(snapshot.value);if(!work.ok)return work;if(work.value.work.revision!==expectedWorkRevision)return conflict(expectedWorkRevision,work.value.work.revision);
      const signature=snapshotSignature(snapshot.value);if(!signature.ok)return signature;
      return run(['works','thumbnails'],'readwrite',async tx=>{const raw:unknown=await request(tx.objectStore('works').get(workId));if(raw===undefined)return conflict(expectedWorkRevision,null);const same=snapshotMatches(raw,signature.value);if(!same.ok)return same;if(!same.value||recordRevision(raw)!==expectedWorkRevision||schemaVersionOf(raw)!==2)return conflict(expectedWorkRevision,recordRevision(raw));const thumbnail:Thumbnail={workId,workRevision:expectedWorkRevision,state:'ready',blob};await request(tx.objectStore('thumbnails').put(thumbnail));return {ok:true,value:thumbnail};});
    },
    async saveV1AsV2(input) {
      if(!input||typeof input!=='object'||!idValid(input.sourceWorkId)||!idValid(input.newWorkId)||input.sourceWorkId===input.newWorkId||!Number.isInteger(input.expectedSourceRevision)||input.expectedSourceRevision<0)return fail('INVALID_INPUT','v1 另存 v2 参数非法');
      if(input.target==='draft'){
        if(!hasOnlyKeys(input,['sourceWorkId','expectedSourceRevision','newWorkId','target','step'])||!['template','color','cut','preview','save'].includes(input.step))return fail('INVALID_INPUT','v1 另存草稿参数非法');
      }else if(input.target==='completed'){
        if(!hasOnlyKeys(input,['sourceWorkId','expectedSourceRevision','newWorkId','target','thumbnail'])||input.thumbnail!==undefined&&!(input.thumbnail instanceof Blob))return fail('INVALID_INPUT','v1 另存完成版参数非法');
      }else return fail('INVALID_INPUT','v1 另存目标非法');
      const sourceSnapshot=await readRawRecord('works',input.sourceWorkId);if(!sourceSnapshot.ok)return sourceSnapshot;if(sourceSnapshot.value===undefined)return fail('NOT_FOUND','源 v1 作品不存在');
      const source=checked(sourceSnapshot.value);if(!source.ok)return source;
      if(source.value.id!==input.sourceWorkId||source.value.schemaVersion!==1)return fail('INVALID_INPUT','源记录必须是合法 WorkV1',[{path:'sourceWorkId',message:'源记录 ID 或 schemaVersion 不匹配'}]);
      if(source.value.revision!==input.expectedSourceRevision)return conflict(input.expectedSourceRevision,source.value.revision);
      const sourceSignature=snapshotSignature(sourceSnapshot.value);if(!sourceSignature.ok)return sourceSignature;
      const profile=await profileForV1Source(source.value);if(!profile.ok)return profile;
      const createdAt=nextTime(now,source.value.createdAt,source.value.updatedAt);if(!createdAt)return fail('INVALID_INPUT','另存时间非法');
      const candidate:WorkV2={
        id:input.newWorkId,name:source.value.name,craftId:source.value.craftId,templateSnapshot:clone(source.value.templateSnapshot),editorProfileSnapshot:clone(profile.value.profile),palette:clone(source.value.palette),
        operations:source.value.operations.map(operation=>({kind:'parametric' as const,id:operation.id,order:operation.order,parameterVersion:2 as const,shape:operation.shape,center:clone(operation.center),width:operation.width,height:operation.height,angleDeg:operation.angleDeg})),
        status:input.target, schemaVersion:2,revision:0,createdAt,updatedAt:createdAt,
      };
      const validated=await validateNewOrSaveAsWorkV2(candidate,options.v2ProfileRegistry??[],options.v2Validation);if(!validated.ok)return validated;
      const revisionSeed=Date.now();
      return run<SaveV1AsV2Result>(['works','drafts','draftRevisions','thumbnails'],'readwrite',async tx=>{
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts'),revisions=tx.objectStore('draftRevisions');
        const [currentSource,targetWork,targetDraft,ledgerRaw]=await Promise.all([request(works.get(input.sourceWorkId)),request(works.get(input.newWorkId)),request(drafts.get(input.newWorkId)),request(revisions.get(input.newWorkId))]);
        if(currentSource===undefined)return conflict(input.expectedSourceRevision,null);
        if(schemaVersionOf(currentSource)!==1||recordRevision(currentSource)!==input.expectedSourceRevision)return schemaVersionOf(currentSource)===1?conflict(input.expectedSourceRevision,recordRevision(currentSource)):fail('INVALID_INPUT','源记录不再是 WorkV1');
        const sameSource=snapshotMatches(currentSource,sourceSignature.value);if(!sameSource.ok)return sameSource;if(!sameSource.value)return conflict(input.expectedSourceRevision,recordRevision(currentSource));
        if(targetWork!==undefined||targetDraft!==undefined)return conflict(null,recordRevision(targetWork??targetDraft));
        if(await keysCount(works,drafts)>=100)return fail('QUOTA_EXCEEDED','已达到100件作品上限');
        if(input.target==='draft'){
          const ledger=checkedLedger(ledgerRaw,input.newWorkId);if(!ledger.ok)return ledger;
          const revision=Math.max(ledger.value,revisionSeed)+1;if(!Number.isSafeInteger(revision))return fail('QUOTA_EXCEEDED','草稿修订号已达上限');
          const draft:EditorDraftV2={workId:validated.value.id,work:{...validated.value,status:'draft',revision:0},step:input.step,revision,baseRevision:null,updatedAt:validated.value.updatedAt};
          await request(drafts.put(draft));await request(revisions.put({workId:input.newWorkId,revision}));return {ok:true,value:{target:'draft' as const,draft}};
        }
        const work:WorkV2={...validated.value,status:'completed',revision:1};
        const thumbnail:Thumbnail={workId:work.id,workRevision:1,state:input.thumbnail?'ready':'pending',...(input.thumbnail?{blob:input.thumbnail}:{})};
        await request(works.put(work));await request(tx.objectStore('thumbnails').put(thumbnail));return {ok:true,value:{target:'completed' as const,work,thumbnail}};
      });
    },
    async saveV1DraftAsV2(input) {
      if(!input||typeof input!=='object'||!hasOnlyKeys(input,['sourceWorkId','expectedSourceDraftRevision','expectedSourceWorkRevision','newWorkId'])||!idValid(input.sourceWorkId)||!idValid(input.newWorkId)||input.sourceWorkId===input.newWorkId||!Number.isInteger(input.expectedSourceDraftRevision)||input.expectedSourceDraftRevision<1||!revValid(input.expectedSourceWorkRevision)||input.expectedSourceWorkRevision===0)return fail('INVALID_INPUT','v1 草稿另存 v2 参数非法');
      if(options.v2ProfileRegistry===undefined)return v2RegistryRequired();
      const draftSnapshot=await readRawRecord('drafts',input.sourceWorkId);if(!draftSnapshot.ok)return draftSnapshot;if(draftSnapshot.value===undefined)return fail('NOT_FOUND','源 v1 草稿不存在');
      const sourceDraft=await validateAnyDraft(draftSnapshot.value);if(!sourceDraft.ok)return sourceDraft;
      if(sourceDraft.value.schemaVersion!==1)return fail('INVALID_INPUT','源记录必须是合法 WorkV1 草稿',[{path:'sourceWorkId',message:'源草稿 schemaVersion 必须为1'}]);
      if(sourceDraft.value.work.id!==input.sourceWorkId)return fail('INVALID_INPUT','源草稿 ID 不一致',[{path:'sourceWorkId',message:'草稿 work.id 必须匹配 sourceWorkId'}]);
      if(sourceDraft.value.baseRevision!==input.expectedSourceWorkRevision)return conflict(input.expectedSourceWorkRevision,sourceDraft.value.baseRevision);
      const workSnapshot=await readRawRecord('works',input.sourceWorkId);if(!workSnapshot.ok)return workSnapshot;
      const completed=(workSnapshot.value===undefined?null:await validateAny(workSnapshot.value));if(completed&&!completed.ok)return completed;
      if(completed&&completed.value.schemaVersion!==1)return fail('INVALID_INPUT','同 ID 完成版不是 WorkV1',[{path:'works',message:'源完成版 schemaVersion 必须为1'}]);
      const draftSignature=snapshotSignature(draftSnapshot.value);if(!draftSignature.ok)return draftSignature;
      const workSignature=workSnapshot.value===undefined?null:snapshotSignature(workSnapshot.value);if(workSignature&&!workSignature.ok)return workSignature;
      if(input.expectedSourceWorkRevision===null){
        if(completed!==null)return conflict(null,completed.value.work.revision);
      }else{
        if(completed===null)return conflict(input.expectedSourceWorkRevision,null);
        if(completed.value.work.revision!==input.expectedSourceWorkRevision)return conflict(input.expectedSourceWorkRevision,completed.value.work.revision);
      }
      const profile=await profileForV1Source(sourceDraft.value.work);if(!profile.ok)return profile;
      const createdAt=nextTime(now,sourceDraft.value.work.createdAt,sourceDraft.value.work.updatedAt);if(!createdAt)return fail('INVALID_INPUT','另存时间非法');
      const candidate:WorkV2={
        id:input.newWorkId,name:sourceDraft.value.work.name,craftId:sourceDraft.value.work.craftId,templateSnapshot:clone(sourceDraft.value.work.templateSnapshot),editorProfileSnapshot:clone(profile.value.profile),palette:clone(sourceDraft.value.work.palette),
        operations:sourceDraft.value.work.operations.map(operation=>({kind:'parametric' as const,id:operation.id,order:operation.order,parameterVersion:2 as const,shape:operation.shape,center:clone(operation.center),width:operation.width,height:operation.height,angleDeg:operation.angleDeg})),
        status:'draft',schemaVersion:2,revision:0,createdAt,updatedAt:createdAt,
      };
      const validated=await validateNewOrSaveAsWorkV2(candidate,options.v2ProfileRegistry,options.v2Validation);if(!validated.ok)return validated;
      const revisionSeed=Date.now(),step=sourceDraft.value.step;
      return run(['works','drafts','draftRevisions','thumbnails'],'readwrite',async tx=>{
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts'),revisions=tx.objectStore('draftRevisions');
        const [draftRaw,workRaw,targetWork,targetDraft,ledgerRaw]=await Promise.all([request(drafts.get(input.sourceWorkId)),request(works.get(input.sourceWorkId)),request(works.get(input.newWorkId)),request(drafts.get(input.newWorkId)),request(revisions.get(input.newWorkId))]);
        if(draftRaw===undefined)return conflict(input.expectedSourceDraftRevision,null);
        if(recordRevision(draftRaw)!==input.expectedSourceDraftRevision)return conflict(input.expectedSourceDraftRevision,recordRevision(draftRaw));
        const sameDraft=snapshotMatches(draftRaw,draftSignature.value);if(!sameDraft.ok)return sameDraft;if(!sameDraft.value)return conflict(input.expectedSourceDraftRevision,recordRevision(draftRaw));
        if(workSignature===null){
          if(workRaw!==undefined)return conflict(null,recordRevision(workRaw));
        }else{
          if(workRaw===undefined)return conflict(input.expectedSourceWorkRevision,null);
          const sameWork=snapshotMatches(workRaw,workSignature.value);if(!sameWork.ok)return sameWork;
          if(!sameWork.value||schemaVersionOf(workRaw)!==1||recordRevision(workRaw)!==input.expectedSourceWorkRevision)return conflict(input.expectedSourceWorkRevision,recordRevision(workRaw));
        }
        const currentBaseRevision=(draftRaw as {baseRevision?:unknown}).baseRevision;
        if(currentBaseRevision!==input.expectedSourceWorkRevision)return conflict(input.expectedSourceWorkRevision,typeof currentBaseRevision==='number'?currentBaseRevision:null);
        if(targetWork!==undefined||targetDraft!==undefined)return conflict(null,recordRevision(targetWork??targetDraft));
        if(await keysCount(works,drafts)>=100)return fail('QUOTA_EXCEEDED','已达到100件作品上限');
        const ledger=checkedLedger(ledgerRaw,input.newWorkId);if(!ledger.ok)return ledger;
        const revision=Math.max(ledger.value,revisionSeed)+1;if(!Number.isSafeInteger(revision))return fail('QUOTA_EXCEEDED','草稿修订号已达上限');
        const draft:EditorDraftV2={workId:validated.value.id,work:{...validated.value,status:'draft',revision:0},step,revision,baseRevision:null,updatedAt:validated.value.updatedAt};
        await request(drafts.put(draft));await request(revisions.put({workId:input.newWorkId,revision}));return {ok:true,value:draft};
      });
    },
    save(input) { return repository.saveWithThumbnail(input); },
    saveWithThumbnail(input, thumbnail) { const valid = checked(input.work); if (!valid.ok) return Promise.resolve(valid);
      if (!revValid(input.expectedRevision) || valid.value.revision !== (input.expectedRevision ?? 0) || thumbnail !== undefined && !(thumbnail instanceof Blob)) return Promise.resolve(fail('INVALID_INPUT','作品修订或缩略图非法'));
      return run(['works','drafts','thumbnails'], 'readwrite', async tx => {
        const works = tx.objectStore('works'), drafts = tx.objectStore('drafts');
        const current: unknown = await request(works.get(valid.value.id));
        const old = current === undefined ? null : checked(current);
        if (old && !old.ok) return old;
        const actual = old?.value.revision ?? null;
        if (actual !== input.expectedRevision) return conflict(input.expectedRevision, actual);
        if (current === undefined && await keysCount(works,drafts) >= 100 && await request(drafts.getKey(valid.value.id)) === undefined) return fail('QUOTA_EXCEEDED','已达到100件作品上限');
        const createdAt = old?.value.createdAt ?? valid.value.createdAt, updatedAt = nextTime(now,createdAt,old?.value.updatedAt);
        if (!updatedAt) return fail('INVALID_INPUT','时钟或作品时间非法',[{path:'updatedAt',message:'时间非法'}]);
        const saved = checked({ ...valid.value, createdAt, updatedAt, revision: (actual ?? 0)+1 }); if (!saved.ok) return saved;
        await request(works.put(saved.value));
        await request(tx.objectStore('thumbnails').put({ workId:saved.value.id, workRevision:saved.value.revision, state:thumbnail ? 'ready':'pending', ...(thumbnail ? {blob:thumbnail}: {}) } satisfies Thumbnail));
        await request(drafts.delete(saved.value.id));
        return saved;
      });
    },
    delete(id, expectedRevision) { if (!idValid(id) || !Number.isInteger(expectedRevision) || expectedRevision < 1) return Promise.resolve(fail('INVALID_INPUT','ID或修订非法'));
      return run(['works','drafts','thumbnails'], 'readwrite', async tx => {
        const works = tx.objectStore('works'), raw: unknown = await request(works.get(id));
        if (raw === undefined) return fail('NOT_FOUND','作品不存在');
        const old = checked(raw); if (!old.ok) return old;
        if (old.value.revision !== expectedRevision) return conflict(expectedRevision,old.value.revision);
        await request(works.delete(id)); await request(tx.objectStore('drafts').delete(id)); await request(tx.objectStore('thumbnails').delete(id));
        return {ok:true,value:{id}};
      });
    },
    saveDraft(input) { const w = checked(input.work); if (!w.ok) return Promise.resolve(w);
      if (!['template','color','cut','preview','save'].includes(input.step) || !revValid(input.expectedDraftRevision) || !revValid(input.baseRevision)) return Promise.resolve(fail('INVALID_INPUT','草稿修订或步骤非法'));
      return run(['works','drafts','draftRevisions'], 'readwrite', async tx => {
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts'),revisions=tx.objectStore('draftRevisions');
        const completedRaw: unknown = await request(works.get(w.value.id)); const completed = completedRaw === undefined ? null : checked(completedRaw); if (completed && !completed.ok) return completed;
        const currentRaw: unknown = await request(drafts.get(w.value.id)); const current = currentRaw === undefined ? null : draftChecked(currentRaw); if (current && !current.ok) return current;
        const ledgerRaw:unknown=await request(revisions.get(w.value.id));
        const ledger=ledgerRaw as {workId?:unknown;revision?:unknown}|undefined;
        if(ledgerRaw!==undefined && (!ledger||ledger.workId!==w.value.id||typeof ledger.revision!=='number'||!Number.isSafeInteger(ledger.revision)||ledger.revision<1))return fail('INVALID_INPUT','草稿修订记录损坏',[{path:'draftRevisions',message:'修订记录损坏'}]);
        if ((current?.value.revision ?? null) !== input.expectedDraftRevision) return conflict(input.expectedDraftRevision,current?.value.revision ?? null);
        if (current && current.value.baseRevision !== input.baseRevision || (completed?.value.revision ?? null) !== input.baseRevision) return conflict(input.baseRevision,completed?.value.revision ?? null);
        if (!completed && !current && await keysCount(works,drafts) >= 100) return fail('QUOTA_EXCEEDED','已达到100件作品上限');
        const createdAt = current?.value.work.createdAt ?? completed?.value.createdAt ?? w.value.createdAt;
        const updatedAt=nextTime(now,createdAt,current?.value.updatedAt ?? completed?.value.updatedAt); if (!updatedAt) return fail('INVALID_INPUT','草稿时间非法');
        const work = checked({...w.value,createdAt,updatedAt,revision:input.baseRevision ?? 0,status:'draft'}); if (!work.ok) return work;
        // Seed above pre-v3 small counters even when an old deleted draft has no
        // surviving record to migrate. The ledger then guarantees monotonicity.
        const revision=Math.max(current?.value.revision??0,typeof ledger?.revision==='number'?ledger.revision:0,Date.now())+1;
        if(!Number.isSafeInteger(revision))return fail('QUOTA_EXCEEDED','草稿修订号已达上限');
        const draft: EditorDraft = {workId:w.value.id,work:work.value,step:input.step,revision,baseRevision:input.baseRevision,updatedAt};
        await request(drafts.put(draft));await request(revisions.put({workId:w.value.id,revision}));return {ok:true,value:draft};
      });
    },
    readDraft(workId) { if (!idValid(workId)) return Promise.resolve(fail('INVALID_INPUT','ID非法')); return run(['drafts'],'readonly',async tx => { const raw:unknown=await request(tx.objectStore('drafts').get(workId)); return raw===undefined?fail('NOT_FOUND','草稿不存在'):draftChecked(raw); }); },
    listDrafts() { return run(['drafts'],'readonly',async tx => { const raw=await request(tx.objectStore('drafts').getAll()); const items:EditorDraft[]=[]; for(const x of raw){const d=draftChecked(x);if(d.ok)items.push(d.value);} items.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));return {ok:true,value:items}; }); },
    discardDraft(workId,expectedDraftRevision) { if(!idValid(workId)||!Number.isInteger(expectedDraftRevision)||expectedDraftRevision<1)return Promise.resolve(fail('INVALID_INPUT','ID或修订非法'));return run(['drafts'],'readwrite',async tx=>{const store=tx.objectStore('drafts'),raw:unknown=await request(store.get(workId));if(raw===undefined)return fail('NOT_FOUND','草稿不存在');const d=draftChecked(raw);if(!d.ok)return d;if(d.value.revision!==expectedDraftRevision)return conflict(expectedDraftRevision,d.value.revision);await request(store.delete(workId));return {ok:true,value:{workId}};}); },
    commitDraft(input) { if(!idValid(input.workId)||!Number.isInteger(input.expectedDraftRevision)||input.expectedDraftRevision<1||!revValid(input.expectedWorkRevision)||input.thumbnail!==undefined&&!(input.thumbnail instanceof Blob))return Promise.resolve(fail('INVALID_INPUT','提交参数非法'));
      return run(['works','drafts','thumbnails'],'readwrite',async tx=>{const works=tx.objectStore('works'),drafts=tx.objectStore('drafts');const raw:unknown=await request(drafts.get(input.workId));if(raw===undefined)return fail('NOT_FOUND','草稿不存在');const d=draftChecked(raw);if(!d.ok)return d;if(d.value.revision!==input.expectedDraftRevision)return conflict(input.expectedDraftRevision,d.value.revision);
        const completedRaw:unknown=await request(works.get(input.workId));const old=completedRaw===undefined?null:checked(completedRaw);if(old&&!old.ok)return old;const actual=old?.value.revision??null;if(actual!==input.expectedWorkRevision||d.value.baseRevision!==input.expectedWorkRevision)return conflict(input.expectedWorkRevision,actual);
        const createdAt=old?.value.createdAt??d.value.work.createdAt,updatedAt=nextTime(now,createdAt,old?.value.updatedAt??d.value.updatedAt);if(!updatedAt)return fail('INVALID_INPUT','时间非法');const saved=checked({...d.value.work,status:'completed',revision:(actual??0)+1,createdAt,updatedAt});if(!saved.ok)return saved;
        await request(works.put(saved.value));await request(tx.objectStore('thumbnails').put({workId:input.workId,workRevision:saved.value.revision,state:input.thumbnail?'ready':'pending',...(input.thumbnail?{blob:input.thumbnail}:{})} satisfies Thumbnail));await request(drafts.delete(input.workId));return saved;
      });
    },
    renameWork(input) {
      const name = input.name.trim();
      if (!idValid(input.workId) || !revValid(input.expectedWorkRevision) || !revValid(input.expectedDraftRevision) || input.expectedWorkRevision === 0 || input.expectedDraftRevision === 0 || name.length < 1 || name.length > 30) return Promise.resolve(fail('INVALID_INPUT', '管理参数或作品名称非法'));
      return run(['works','drafts','draftRevisions','thumbnails'], 'readwrite', async tx => {
        const works = tx.objectStore('works'), drafts = tx.objectStore('drafts'), revisions = tx.objectStore('draftRevisions');
        const [workRaw,draftRaw] = await Promise.all([request(works.get(input.workId)),request(drafts.get(input.workId))]);
        const work = workRaw === undefined ? null : checked(workRaw);
        const draft = draftRaw === undefined ? null : draftChecked(draftRaw);
        if (work && !work.ok) return work;
        if (draft && !draft.ok) return draft;
        const oldWork = work?.value ?? null, oldDraft = draft?.value ?? null;
        if ((oldWork?.revision ?? null) !== input.expectedWorkRevision) return conflict(input.expectedWorkRevision, oldWork?.revision ?? null);
        if ((oldDraft?.revision ?? null) !== input.expectedDraftRevision) return conflict(input.expectedDraftRevision, oldDraft?.revision ?? null);
        if (!oldWork && !oldDraft) return fail('NOT_FOUND','作品不存在');
        if (oldDraft && oldDraft.baseRevision !== (oldWork?.revision ?? null)) return conflict(oldDraft.baseRevision, oldWork?.revision ?? null);
        const ledgerRaw: unknown = oldDraft ? await request(revisions.get(input.workId)) : undefined;
        const ledger = ledgerRaw as {workId?: unknown; revision?: unknown} | undefined;
        if (oldDraft && ledgerRaw !== undefined && (!ledger || ledger.workId !== input.workId || typeof ledger.revision !== 'number' || !Number.isSafeInteger(ledger.revision) || ledger.revision < oldDraft.revision)) return fail('INVALID_INPUT','草稿修订记录损坏');
        const workTime = oldWork ? nextTime(now,oldWork.createdAt,oldWork.updatedAt) : null;
        const draftTime = oldDraft ? nextTime(now,oldDraft.work.createdAt,oldDraft.updatedAt) : null;
        if (oldWork && !workTime || oldDraft && !draftTime || oldWork?.revision === Number.MAX_SAFE_INTEGER || oldDraft?.revision === Number.MAX_SAFE_INTEGER) return fail('QUOTA_EXCEEDED','修订或时间无法继续递增');
        const nextWork = oldWork ? checked({...oldWork,name,revision:oldWork.revision+1,updatedAt:workTime}) : null;
        if (nextWork && !nextWork.ok) return nextWork;
        const nextDraft = oldDraft ? draftChecked({...oldDraft,work:{...oldDraft.work,name,revision:nextWork?.value.revision ?? 0,updatedAt:draftTime},revision:Math.max(oldDraft.revision,typeof ledger?.revision === 'number' ? ledger.revision : 0)+1,baseRevision:nextWork?.value.revision ?? null,updatedAt:draftTime}) : null;
        if (nextDraft && !nextDraft.ok) return nextDraft;
        if (nextWork) {
          await request(works.put(nextWork.value));
          await request(tx.objectStore('thumbnails').put({workId:input.workId,workRevision:nextWork.value.revision,state:'pending'} satisfies Thumbnail));
        }
        if (nextDraft) {
          await request(drafts.put(nextDraft.value));
          await request(revisions.put({workId:input.workId,revision:nextDraft.value.revision}));
        }
        return {ok:true,value:{work:nextWork?.value ?? null,draft:nextDraft?.value ?? null}};
      });
    },
    deleteWork(input) {
      if (!idValid(input.workId) || !revValid(input.expectedWorkRevision) || !revValid(input.expectedDraftRevision) || input.expectedWorkRevision === 0 || input.expectedDraftRevision === 0) return Promise.resolve(fail('INVALID_INPUT','管理参数非法'));
      return run(['works','drafts','thumbnails'], 'readwrite', async tx => {
        const works = tx.objectStore('works'), drafts = tx.objectStore('drafts');
        const [workRaw,draftRaw] = await Promise.all([request(works.get(input.workId)),request(drafts.get(input.workId))]);
        const work = workRaw === undefined ? null : checked(workRaw);
        const draft = draftRaw === undefined ? null : draftChecked(draftRaw);
        if (work && !work.ok) return work;
        if (draft && !draft.ok) return draft;
        const actualWork = work?.value.revision ?? null, actualDraft = draft?.value.revision ?? null;
        if (actualWork !== input.expectedWorkRevision) return conflict(input.expectedWorkRevision,actualWork);
        if (actualDraft !== input.expectedDraftRevision) return conflict(input.expectedDraftRevision,actualDraft);
        if (!work && !draft) return fail('NOT_FOUND','作品不存在');
        await request(works.delete(input.workId)); await request(drafts.delete(input.workId)); await request(tx.objectStore('thumbnails').delete(input.workId));
        return {ok:true,value:{workId:input.workId}};
      });
    },
    async renameAnyWork(input) {
      const name = input.name.trim();
      if (!idValid(input.workId) || !revValid(input.expectedWorkRevision) || !revValid(input.expectedDraftRevision) || input.expectedWorkRevision === 0 || input.expectedDraftRevision === 0 || name.length < 1 || name.length > 30) return fail('INVALID_INPUT', '管理参数或作品名称非法');
      if (options.v2ProfileRegistry === undefined) return v2RegistryRequired();
      const [workSnapshot,draftSnapshot,ledgerSnapshot] = await Promise.all([readRawRecord('works',input.workId),readRawRecord('drafts',input.workId),readRawRecord('draftRevisions',input.workId)]);
      if (!workSnapshot.ok) return workSnapshot;
      if (!draftSnapshot.ok) return draftSnapshot;
      if (!ledgerSnapshot.ok) return ledgerSnapshot;
      if (workSnapshot.value === undefined && draftSnapshot.value === undefined) return fail('NOT_FOUND','作品不存在');
      const work = workSnapshot.value === undefined ? null : await validateAny(workSnapshot.value);
      if (work && !work.ok) return work;
      const draft = draftSnapshot.value === undefined ? null : await validateAnyDraft(draftSnapshot.value);
      if (draft && !draft.ok) return draft;
      if (work && draft && work.value.schemaVersion !== draft.value.schemaVersion) return fail('INVALID_INPUT','同一作品的主记录与草稿 schemaVersion 不一致');
      for (const value of [work?.value,draft?.value]) {
        if (value && value.schemaVersion === 2) { const denied = requireEditable(value.historicalMode); if (denied) return denied; }
      }
      const actualWork = work?.value.work.revision ?? null, actualDraft = draft?.value.revision ?? null;
      if (actualWork !== input.expectedWorkRevision) return conflict(input.expectedWorkRevision,actualWork);
      if (actualDraft !== input.expectedDraftRevision) return conflict(input.expectedDraftRevision,actualDraft);
      if (draft && draft.value.baseRevision !== actualWork) return conflict(draft.value.baseRevision,actualWork);
      const ledger = checkedLedger(ledgerSnapshot.value,input.workId);
      if (!ledger.ok) return ledger;
      if (draft && ledgerSnapshot.value !== undefined && ledger.value < draft.value.revision) return fail('INVALID_INPUT','草稿修订记录损坏',[{path:'draftRevisions',message:'修订记录低于草稿修订'}]);
      const workTime = work ? nextTime(now,work.value.work.createdAt,work.value.work.updatedAt) : null;
      const draftTime = draft ? nextTime(now,draft.value.work.createdAt,draft.value.updatedAt) : null;
      if (work && !workTime || draft && !draftTime) return fail('INVALID_INPUT','时间非法');
      if (work && work.value.work.revision === Number.MAX_SAFE_INTEGER) return fail('QUOTA_EXCEEDED','修订无法继续递增');
      const nextWorkRaw = work ? {...work.value.work,name,revision:work.value.work.revision+1,updatedAt:workTime!} : null;
      const nextWork = nextWorkRaw === null ? null : await validateAny(nextWorkRaw);
      if (nextWork && !nextWork.ok) return nextWork;
      const nextDraftRevision = draft ? Math.max(draft.value.revision,ledger.value)+1 : null;
      if (nextDraftRevision !== null && (!Number.isSafeInteger(nextDraftRevision) || nextDraftRevision > Number.MAX_SAFE_INTEGER)) return fail('QUOTA_EXCEEDED','草稿修订号已达上限');
      const nextDraftRaw = draft ? {
        workId:draft.value.workId,
        work:{...draft.value.work,name,revision:nextWork?.value.work.revision ?? 0,updatedAt:draftTime!},
        step:draft.value.step,
        revision:nextDraftRevision!,
        baseRevision:nextWork?.value.work.revision ?? null,
        updatedAt:draftTime!,
      } : null;
      const nextDraft = nextDraftRaw === null ? null : await validateAnyDraft(nextDraftRaw);
      if (nextDraft && !nextDraft.ok) return nextDraft;
      if (nextWork && nextDraft && nextWork.value.schemaVersion !== nextDraft.value.schemaVersion) return fail('INVALID_INPUT','同一作品的主记录与草稿 schemaVersion 不一致');
      const workSignature = workSnapshot.value === undefined ? null : snapshotSignature(workSnapshot.value); if (workSignature && !workSignature.ok) return workSignature;
      const draftSignature = draftSnapshot.value === undefined ? null : snapshotSignature(draftSnapshot.value); if (draftSignature && !draftSignature.ok) return draftSignature;
      const ledgerSignature = ledgerSnapshot.value === undefined ? null : snapshotSignature(ledgerSnapshot.value); if (ledgerSignature && !ledgerSignature.ok) return ledgerSignature;
      return run(['works','drafts','draftRevisions','thumbnails'],'readwrite',async tx=>{
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts'),revisions=tx.objectStore('draftRevisions');
        const [workRaw,draftRaw,ledgerRaw]=await Promise.all([request(works.get(input.workId)),request(drafts.get(input.workId)),request(revisions.get(input.workId))]);
        if (workSignature === null ? workRaw !== undefined : workRaw === undefined) return conflict(input.expectedWorkRevision,recordRevision(workRaw));
        if (workSignature) { const same=snapshotMatches(workRaw,workSignature.value); if (!same.ok) return same; if (!same.value) return conflict(input.expectedWorkRevision,recordRevision(workRaw)); }
        if (draftSignature === null ? draftRaw !== undefined : draftRaw === undefined) return conflict(input.expectedDraftRevision,recordRevision(draftRaw));
        if (draftSignature) { const same=snapshotMatches(draftRaw,draftSignature.value); if (!same.ok) return same; if (!same.value) return conflict(input.expectedDraftRevision,recordRevision(draftRaw)); }
        if (ledgerSignature === null ? ledgerRaw !== undefined : ledgerRaw === undefined) return fail('INVALID_INPUT','草稿修订记录已变化',[{path:'draftRevisions',message:'修订记录在事务中发生变化'}]);
        if (ledgerSignature) { const same=snapshotMatches(ledgerRaw,ledgerSignature.value); if (!same.ok) return same; if (!same.value) return fail('INVALID_INPUT','草稿修订记录已变化',[{path:'draftRevisions',message:'修订记录在事务中发生变化'}]); }
        if (nextWork) {
          await request(works.put(nextWork.value.work));
          await request(tx.objectStore('thumbnails').put({workId:input.workId,workRevision:nextWork.value.work.revision,state:'pending'} satisfies Thumbnail));
        }
        if (nextDraft) {
          const {work,workId,step,revision,baseRevision,updatedAt}=nextDraft.value;
          await request(drafts.put({workId,work,step,revision,baseRevision,updatedAt}));
          await request(revisions.put({workId:input.workId,revision:nextDraft.value.revision}));
        }
        return {ok:true,value:{work:nextWork?.value ?? null,draft:nextDraft?.value ?? null}};
      });
    },
    async deleteAnyWork(input) {
      if (!idValid(input.workId) || !revValid(input.expectedWorkRevision) || !revValid(input.expectedDraftRevision) || input.expectedWorkRevision === 0 || input.expectedDraftRevision === 0) return fail('INVALID_INPUT','管理参数非法');
      if (options.v2ProfileRegistry === undefined) return v2RegistryRequired();
      const [workSnapshot,draftSnapshot] = await Promise.all([readRawRecord('works',input.workId),readRawRecord('drafts',input.workId)]);
      if (!workSnapshot.ok) return workSnapshot;
      if (!draftSnapshot.ok) return draftSnapshot;
      if (workSnapshot.value === undefined && draftSnapshot.value === undefined) return fail('NOT_FOUND','作品不存在');
      const work = workSnapshot.value === undefined ? null : await validateAny(workSnapshot.value);
      if (work && !work.ok) return work;
      const draft = draftSnapshot.value === undefined ? null : await validateAnyDraft(draftSnapshot.value);
      if (draft && !draft.ok) return draft;
      if (work && draft && work.value.schemaVersion !== draft.value.schemaVersion) return fail('INVALID_INPUT','同一作品的主记录与草稿 schemaVersion 不一致');
      const actualWork = work?.value.work.revision ?? null, actualDraft = draft?.value.revision ?? null;
      if (actualWork !== input.expectedWorkRevision) return conflict(input.expectedWorkRevision,actualWork);
      if (actualDraft !== input.expectedDraftRevision) return conflict(input.expectedDraftRevision,actualDraft);
      const workSignature = workSnapshot.value === undefined ? null : snapshotSignature(workSnapshot.value); if (workSignature && !workSignature.ok) return workSignature;
      const draftSignature = draftSnapshot.value === undefined ? null : snapshotSignature(draftSnapshot.value); if (draftSignature && !draftSignature.ok) return draftSignature;
      return run(['works','drafts','thumbnails'],'readwrite',async tx=>{
        const works=tx.objectStore('works'),drafts=tx.objectStore('drafts');
        const [workRaw,draftRaw]=await Promise.all([request(works.get(input.workId)),request(drafts.get(input.workId))]);
        if (workSignature === null ? workRaw !== undefined : workRaw === undefined) return conflict(input.expectedWorkRevision,recordRevision(workRaw));
        if (workSignature) { const same=snapshotMatches(workRaw,workSignature.value); if (!same.ok) return same; if (!same.value) return conflict(input.expectedWorkRevision,recordRevision(workRaw)); }
        if (draftSignature === null ? draftRaw !== undefined : draftRaw === undefined) return conflict(input.expectedDraftRevision,recordRevision(draftRaw));
        if (draftSignature) { const same=snapshotMatches(draftRaw,draftSignature.value); if (!same.ok) return same; if (!same.value) return conflict(input.expectedDraftRevision,recordRevision(draftRaw)); }
        await request(works.delete(input.workId)); await request(drafts.delete(input.workId)); await request(tx.objectStore('thumbnails').delete(input.workId));
        return {ok:true,value:{workId:input.workId}};
      });
    },
    readThumbnail(workId) { if(!idValid(workId))return Promise.resolve(fail('INVALID_INPUT','ID非法'));return run(['works','thumbnails'],'readonly',async tx=>{const raw:unknown=await request(tx.objectStore('thumbnails').get(workId));if(raw===undefined)return fail('NOT_FOUND','缩略图不存在');const t=raw as Thumbnail;const workRaw:unknown=await request(tx.objectStore('works').get(workId));const w=checked(workRaw);if(!w.ok)return w;if(t.workRevision!==w.value.revision||t.workId!==workId||!['ready','pending'].includes(t.state)||t.state==='ready'&&!(t.blob instanceof Blob))return fail('INVALID_INPUT','缩略图记录损坏');return {ok:true,value:t};}); },
    rebuildThumbnail(workId,expectedWorkRevision,blob) { if(!idValid(workId)||!Number.isInteger(expectedWorkRevision)||expectedWorkRevision<1||!(blob instanceof Blob))return Promise.resolve(fail('INVALID_INPUT','缩略图参数非法'));return run(['works','thumbnails'],'readwrite',async tx=>{const raw:unknown=await request(tx.objectStore('works').get(workId));if(raw===undefined)return conflict(expectedWorkRevision,null);const w=checked(raw);if(!w.ok)return w;if(w.value.revision!==expectedWorkRevision)return conflict(expectedWorkRevision,w.value.revision);const t:Thumbnail={workId,workRevision:expectedWorkRevision,state:'ready',blob};await request(tx.objectStore('thumbnails').put(t));return {ok:true,value:t};}); },
    async inspectRecords() {
      const storeNames = ['works','drafts','draftRevisions','thumbnails','favorites'] as const;
      const snapshot = await run([...storeNames], 'readonly', async tx => {
        const records: Record<string, { key: string; value: unknown }[]> = {};
        for (const storeName of storeNames) {
          const store = tx.objectStore(storeName);
          const [keys,values] = await Promise.all([request(store.getAllKeys()),request(store.getAll())]);
          records[storeName] = keys.map((key,index) => ({ key: String(key), value: values[index] }));
        }
        return { ok: true, value: records };
      });
      if (!snapshot.ok) return snapshot;
      const issues: RecordIssue[] = [];
      const works = new Map((snapshot.value.works ?? []).map(record => [record.key, record.value]));
      for (const storeName of storeNames) {
        for (const { key, value: item } of snapshot.value[storeName] ?? []) {
          let issue: Failure | undefined;
          if (storeName === 'works') {
            const result = await validateAny(item);
            if (!result.ok) {
              if (result.error.code === 'STORAGE_UNAVAILABLE' || schemaVersionOf(item) === 2 && options.v2ProfileRegistry === undefined) return result;
              issue = { ok: false, error: result.error };
            }
          } else if (storeName === 'drafts') {
            const result = await validateAnyDraft(item);
            if (!result.ok) {
              const rawWork = (item as { work?: unknown } | null)?.work;
              if (result.error.code === 'STORAGE_UNAVAILABLE' || schemaVersionOf(rawWork) === 2 && options.v2ProfileRegistry === undefined) return result;
              issue = { ok: false, error: result.error };
            }
          } else if (storeName === 'draftRevisions') {
            const ledger=item as {workId?:unknown;revision?:unknown}|undefined;
            if(!ledger||ledger.workId!==key||typeof ledger.revision!=='number'||!Number.isSafeInteger(ledger.revision)||ledger.revision<1)issue=fail('INVALID_INPUT','草稿修订记录损坏');
          } else if (storeName === 'favorites' && !FavoriteSchema.safeParse(item).success) {
            issue=fail('INVALID_INPUT','收藏记录损坏');
          } else if (storeName === 'thumbnails') {
            const t=item as Partial<Thumbnail>|undefined;
            const rawWork = works.get(key);
            const work = rawWork === undefined ? null : await validateAny(rawWork);
            if (work && !work.ok && (work.error.code === 'STORAGE_UNAVAILABLE' || schemaVersionOf(rawWork) === 2 && options.v2ProfileRegistry === undefined)) return work;
            if(!t||t.workId!==key||!Number.isInteger(t.workRevision)||t.state!=='ready'&&t.state!=='pending'||t.state==='ready'&&!(t.blob instanceof Blob)||!work||!work.ok||t.workRevision!==work.value.work.revision)issue=fail('INVALID_INPUT','缩略图记录损坏或与作品修订不一致');
          }
          if(issue)issues.push({store:storeName,key,code:issue.error.code==='UNSUPPORTED_VERSION'?'UNSUPPORTED_VERSION':'INVALID_INPUT',fieldErrors:issue.error.fieldErrors});
        }
      }
      return { ok: true, value: clone(issues) };
    },
    exportRawBackup() { return run(Array.from(db.objectStoreNames),'readonly',async tx=>{const records:RawBackup['records']={};for(const storeName of db.objectStoreNames){const store=tx.objectStore(storeName),[keys,values]=await Promise.all([request(store.getAllKeys()),request(store.getAll())]);records[storeName]=keys.map((key,i)=>({key:String(key),value:values[i]}));}return {ok:true,value:{databaseName:name,exportedAt:now(),records}};}); },
    favorites: {
      list(){return run(['favorites'],'readonly',async tx=>{const raw=await request(tx.objectStore('favorites').getAll());const items:Favorite[]=[];for(const item of raw){const p=FavoriteSchema.safeParse(item);if(p.success)items.push(p.data);}return {ok:true,value:items};});},
      put(favorite){const p=FavoriteSchema.safeParse(favorite);if(!p.success)return Promise.resolve(fail('INVALID_INPUT','收藏参数非法',p.error.issues.map(i=>({path:i.path.join('.')||'favorite',message:i.message}))));return run(['favorites'],'readwrite',async tx=>{const store=tx.objectStore('favorites'),old:unknown=await request(store.get(p.data.exhibitId));if(old!==undefined){const v=FavoriteSchema.safeParse(old);if(!v.success)return fail('INVALID_INPUT','收藏记录损坏');return {ok:true,value:v.data};}await request(store.put(p.data));return {ok:true,value:p.data};});},
      remove(exhibitId){if(!idValid(exhibitId))return Promise.resolve(fail('INVALID_INPUT','展品ID非法'));return run(['favorites'],'readwrite',async tx=>{await request(tx.objectStore('favorites').delete(exhibitId));return {ok:true,value:{exhibitId}};});}
    }
  };
  return {ok:true,value:repository};
}
