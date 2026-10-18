import { FavoriteSchema, IdSchema, PaginationSchema } from '@shoushang/contracts';
import type { Favorite, LocalRepository, LocalWorkQuery, Result, SaveWorkInput, StorageFailure, Work } from '@shoushang/contracts';
import { createPapercutCore } from '@shoushang/papercut-core';

const core = createPapercutCore();
const VERSION = 3;
const DEFAULT_NAME = 'shoushang-local-v1';
type Failure = { ok: false; error: StorageFailure };
type Thumbnail = { workId: string; workRevision: number; state: 'ready' | 'pending'; blob?: Blob };
export type EditorStep = 'template' | 'color' | 'cut' | 'preview' | 'save';
export interface EditorDraft { workId: string; work: Work; step: EditorStep; revision: number; baseRevision: number | null; updatedAt: string }
export interface DraftInput { work: Work; step: EditorStep; expectedDraftRevision: number | null; baseRevision: number | null }
export interface CommitDraftInput { workId: string; expectedDraftRevision: number; expectedWorkRevision: number | null; thumbnail?: Blob }
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
  readThumbnail(workId: string): Promise<Result<Thumbnail, StorageFailure>>;
  rebuildThumbnail(workId: string, expectedWorkRevision: number, blob: Blob): Promise<Result<Thumbnail, StorageFailure>>;
  inspectRecords(): Promise<Result<RecordIssue[], StorageFailure>>;
  exportRawBackup(): Promise<Result<RawBackup, StorageFailure>>;
  close(): void;
}
export interface IndexedDbOptions { name?: string; now?: () => string; openTimeoutMs?: number; onVersionChange?: () => void; /** Tests only: abort after a successful write request. */ testAbortAfterWrite?: boolean; /** Tests only: abort the real transaction at the database boundary and report simulated quota exhaustion. */ testQuotaAfterWrite?: boolean }

function fail(code: Exclude<StorageFailure['code'], 'REVISION_CONFLICT'>, message: string, fieldErrors: StorageFailure['fieldErrors'] = []): Failure {
  return { ok: false, error: { code, message, requestId: 'indexeddb-v1', fieldErrors } };
}
function conflict(expectedRevision: number | null, actualRevision: number | null): Failure {
  return { ok: false, error: { code: 'REVISION_CONFLICT', message: '修订冲突，请重新载入或保留当前内容', requestId: 'indexeddb-v1', fieldErrors: [], expectedRevision, actualRevision } };
}
function idValid(id: string): boolean { return IdSchema.safeParse(id).success; }
function revValid(n: number | null): boolean { return n === null || Number.isSafeInteger(n) && n >= 0; }
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
    readThumbnail(workId) { if(!idValid(workId))return Promise.resolve(fail('INVALID_INPUT','ID非法'));return run(['works','thumbnails'],'readonly',async tx=>{const raw:unknown=await request(tx.objectStore('thumbnails').get(workId));if(raw===undefined)return fail('NOT_FOUND','缩略图不存在');const t=raw as Thumbnail;const workRaw:unknown=await request(tx.objectStore('works').get(workId));const w=checked(workRaw);if(!w.ok)return w;if(t.workRevision!==w.value.revision||t.workId!==workId||!['ready','pending'].includes(t.state)||t.state==='ready'&&!(t.blob instanceof Blob))return fail('INVALID_INPUT','缩略图记录损坏');return {ok:true,value:t};}); },
    rebuildThumbnail(workId,expectedWorkRevision,blob) { if(!idValid(workId)||!Number.isInteger(expectedWorkRevision)||expectedWorkRevision<1||!(blob instanceof Blob))return Promise.resolve(fail('INVALID_INPUT','缩略图参数非法'));return run(['works','thumbnails'],'readwrite',async tx=>{const raw:unknown=await request(tx.objectStore('works').get(workId));if(raw===undefined)return conflict(expectedWorkRevision,null);const w=checked(raw);if(!w.ok)return w;if(w.value.revision!==expectedWorkRevision)return conflict(expectedWorkRevision,w.value.revision);const t:Thumbnail={workId,workRevision:expectedWorkRevision,state:'ready',blob};await request(tx.objectStore('thumbnails').put(t));return {ok:true,value:t};}); },
    inspectRecords() { return run(['works','drafts','draftRevisions','thumbnails','favorites'],'readonly',async tx=>{
      const issues:RecordIssue[]=[];
      for(const storeName of ['works','drafts','draftRevisions','thumbnails','favorites'] as const){
        const store=tx.objectStore(storeName),[keys,values]=await Promise.all([request(store.getAllKeys()),request(store.getAll())]);
        for(let i=0;i<keys.length;i++){
          const item=values[i],key=String(keys[i]);let issue:Failure|undefined;
          if(storeName==='works'){const r=checked(item);if(!r.ok)issue=r;}
          else if(storeName==='drafts'){const r=draftChecked(item);if(!r.ok)issue=r;}
          else if(storeName==='draftRevisions'){
            const ledger=item as {workId?:unknown;revision?:unknown}|undefined;
            if(!ledger||ledger.workId!==key||typeof ledger.revision!=='number'||!Number.isSafeInteger(ledger.revision)||ledger.revision<1)issue=fail('INVALID_INPUT','草稿修订记录损坏');
          }
          else if(storeName==='favorites'&&!FavoriteSchema.safeParse(item).success)issue=fail('INVALID_INPUT','收藏记录损坏');
          else if(storeName==='thumbnails'){
            const t=item as Partial<Thumbnail>|undefined;
            const raw:unknown=await request(tx.objectStore('works').get(key));
            const w=raw===undefined?null:checked(raw);
            if(!t||t.workId!==key||!Number.isInteger(t.workRevision)||t.state!=='ready'&&t.state!=='pending'||t.state==='ready'&&!(t.blob instanceof Blob)||!w||!w.ok||t.workRevision!==w.value.revision)issue=fail('INVALID_INPUT','缩略图记录损坏或与作品修订不一致');
          }
          if(issue)issues.push({store:storeName,key,code:issue.error.code==='UNSUPPORTED_VERSION'?'UNSUPPORTED_VERSION':'INVALID_INPUT',fieldErrors:issue.error.fieldErrors});
        }
      }
      return {ok:true,value:issues};
    }); },
    exportRawBackup() { return run(Array.from(db.objectStoreNames),'readonly',async tx=>{const records:RawBackup['records']={};for(const storeName of db.objectStoreNames){const store=tx.objectStore(storeName),[keys,values]=await Promise.all([request(store.getAllKeys()),request(store.getAll())]);records[storeName]=keys.map((key,i)=>({key:String(key),value:values[i]}));}return {ok:true,value:{databaseName:name,exportedAt:now(),records}};}); },
    favorites: {
      list(){return run(['favorites'],'readonly',async tx=>{const raw=await request(tx.objectStore('favorites').getAll());const items:Favorite[]=[];for(const item of raw){const p=FavoriteSchema.safeParse(item);if(p.success)items.push(p.data);}return {ok:true,value:items};});},
      put(favorite){const p=FavoriteSchema.safeParse(favorite);if(!p.success)return Promise.resolve(fail('INVALID_INPUT','收藏参数非法',p.error.issues.map(i=>({path:i.path.join('.')||'favorite',message:i.message}))));return run(['favorites'],'readwrite',async tx=>{const store=tx.objectStore('favorites'),old:unknown=await request(store.get(p.data.exhibitId));if(old!==undefined){const v=FavoriteSchema.safeParse(old);if(!v.success)return fail('INVALID_INPUT','收藏记录损坏');return {ok:true,value:v.data};}await request(store.put(p.data));return {ok:true,value:p.data};});},
      remove(exhibitId){if(!idValid(exhibitId))return Promise.resolve(fail('INVALID_INPUT','展品ID非法'));return run(['favorites'],'readwrite',async tx=>{await request(tx.objectStore('favorites').delete(exhibitId));return {ok:true,value:{exhibitId}};});}
    }
  };
  return {ok:true,value:repository};
}
