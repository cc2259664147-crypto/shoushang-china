import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Work } from '@shoushang/contracts';
import type { IndexedDbRepository } from '@shoushang/local-repository';

declare global { interface Window { __m05Test: { open: (options?: {name?:string;openTimeoutMs?:number;onVersionChange?:()=>void;testAbortAfterWrite?:boolean;testQuotaAfterWrite?:boolean}) => Promise<{ok:true;value:IndexedDbRepository}|{ok:false;error:{code:string}}>; fixture: () => Work } } }
const dbName=()=>`m05-browser-${crypto.randomUUID()}`;
async function ready(page:Page){await page.goto('/');await expect(page.locator('#status')).toContainText('已连接');}
async function removeDb(page:Page,name:string){await page.evaluate(async n=>{await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase(n);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('blocked'));});},name);}

test('native IndexedDB create, update, delete, reopen, thumbnail, favorite and clone isolation',async({page,context})=>{
  await ready(page);const name=dbName();
  const first=await page.evaluate(async n=>{const r=await window.__m05Test.open({name:n});if(!r.ok)throw new Error(r.error.code);const db=r.value,w=window.__m05Test.fixture();w.id='test-main';w.status='completed';const blob=new Blob(['test-image'],{type:'image/png'});const saved=await db.saveWithThumbnail({work:w,expectedRevision:null},blob);const fav=await db.favorites.put({exhibitId:'test-exhibit',createdAt:w.createdAt});const again=await db.favorites.put({exhibitId:'test-exhibit',createdAt:new Date().toISOString()});const thumb=await db.readThumbnail(w.id);const read=await db.read(w.id);db.close();return {saved,fav,again,thumb:thumb.ok?{revision:thumb.value.workRevision,state:thumb.value.state}:thumb,read};},name);
  expect(first.saved.ok&&first.saved.value.revision).toBe(1);expect(first.thumb).toEqual({revision:1,state:'ready'});expect(first.fav).toEqual(first.again);
  await page.reload();await expect(page.locator('#status')).toContainText('已连接');
  const refreshed=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const r=await o.value.read('test-main');o.value.close();return r;},name);expect(refreshed.ok&&refreshed.value.revision).toBe(1);
  const second=await context.newPage();await ready(second);
  const result=await second.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const db=o.value;const before=await db.read('test-main');if(!before.ok)throw new Error(before.error.code);before.value.name='changed';const unchanged=await db.read('test-main');const updated=await db.save({work:{...(unchanged.ok?unchanged.value:before.value),name:'新版'},expectedRevision:1});const pending=await db.readThumbnail('test-main');const favorites=await db.favorites.list();const deleted=await db.delete('test-main',2);const missing=await db.read('test-main');db.close();return {unchanged,updated,pending:pending.ok?{revision:pending.value.workRevision,state:pending.value.state}:pending,favorites,deleted,missing};},name);
  expect(result.unchanged.ok&&result.unchanged.value.name).not.toBe('changed');expect(result.updated.ok&&result.updated.value.revision).toBe(2);expect(result.pending).toEqual({revision:2,state:'pending'});expect(result.favorites.ok&&result.favorites.value).toHaveLength(1);expect(result.deleted.ok).toBe(true);expect(!result.missing.ok&&result.missing.error.code).toBe('NOT_FOUND');
  const invalid=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const w=window.__m05Test.fixture();w.id='invalid-geometry';w.operations=[{id:'bad-cut',shape:'circle',center:{x:0.9,y:0.9},width:0.1,height:0.1,angleDeg:0,order:0,parameterVersion:1}];const r=await o.value.save({work:w,expectedRevision:null});o.value.close();return r;},name);
  expect(!invalid.ok&&invalid.error.code).toBe('INVALID_INPUT');expect(!invalid.ok&&invalid.error.fieldErrors.some(x=>x.path.includes('operations.0'))).toBe(true);
  await removeDb(page,name);
});

test('two tabs conflict, deletion does not resurrect, drafts keep completed version and stale thumbnail is rejected',async({page,context})=>{
  await ready(page);const other=await context.newPage();await ready(other);const name=dbName();
  const setup=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const w=window.__m05Test.fixture();w.id='shared';w.status='completed';const r=await o.value.save({work:w,expectedRevision:null});o.value.close();return r;},name);expect(setup.ok).toBe(true);
  const initial=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const w=await o.value.read('shared');o.value.close();if(!w.ok)throw new Error(w.error.code);return w.value;},name);
  const [a,b]=await Promise.all([page,other].map((p,i)=>p.evaluate(async x=>{const o=await window.__m05Test.open({name:x.name});if(!o.ok)throw new Error(o.error.code);const r=await o.value.save({work:{...x.work,name:x.label},expectedRevision:1});o.value.close();return r;},{name,work:initial,label:`tab-${i}`})));
  expect([a,b].filter(x=>x?.ok)).toHaveLength(1);expect([a,b].filter(x=>x&&!x.ok).map(x=>x&&!x.ok?x.error.code:'')).toEqual(['REVISION_CONFLICT']);
  const outcome=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const db=o.value,w=await db.read('shared');if(!w.ok)throw new Error(w.error.code);const draft=await db.saveDraft({work:{...w.value,name:'草稿',status:'draft'},step:'cut',expectedDraftRevision:null,baseRevision:w.value.revision});const original=await db.read('shared');const commit=draft.ok?await db.commitDraft({workId:'shared',expectedDraftRevision:draft.value.revision,expectedWorkRevision:w.value.revision}):draft;const removed=await db.readDraft('shared');const stale=await db.rebuildThumbnail('shared',w.value.revision,new Blob(['old']));const deleted=commit.ok?await db.delete('shared',commit.value.revision):commit;const resurrection=await db.save({work:w.value,expectedRevision:w.value.revision});db.close();return {draft,original,commit,removed,stale,deleted,resurrection};},name);
  expect(outcome.draft.ok).toBe(true);expect(outcome.original.ok&&outcome.original.value.name).not.toBe('草稿');expect(outcome.commit.ok&&outcome.commit.value.name).toBe('草稿');expect(!outcome.removed.ok&&outcome.removed.error.code).toBe('NOT_FOUND');expect(!outcome.stale.ok&&outcome.stale.error.code).toBe('REVISION_CONFLICT');expect(!outcome.resurrection.ok&&outcome.resurrection.error.code).toBe('REVISION_CONFLICT');await removeDb(page,name);
});

test('100 unique ids including draft, transaction abort and malformed record recovery',async({page})=>{
  await ready(page);const name=dbName();
  const result=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const db=o.value;const fixture=window.__m05Test.fixture();let last;for(let i=0;i<99;i++){last=await db.save({work:{...fixture,id:`item-${i}`,status:'completed'},expectedRevision:null});if(!last.ok)break;}const draft=await db.saveDraft({work:{...fixture,id:'draft-100'},step:'cut',expectedDraftRevision:null,baseRevision:null});const extra=await db.save({work:{...fixture,id:'extra',status:'completed'},expectedRevision:null});const read=await db.read('item-0');const update=read.ok?await db.save({work:{...read.value,name:'updated'},expectedRevision:1}):read;const del=await db.delete('item-1',1);db.close();return {last,draft,extra,read,update,del};},name);
  expect(result.last?.ok).toBe(true);expect(result.draft.ok).toBe(true);expect(!result.extra.ok&&result.extra.error.code).toBe('QUOTA_EXCEEDED');expect(result.update.ok).toBe(true);expect(result.del.ok).toBe(true);
  const fault=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n,testAbortAfterWrite:true});if(!o.ok)throw new Error(o.error.code);const w=window.__m05Test.fixture();w.id='abort-test';w.status='completed';const failed=await o.value.save({work:w,expectedRevision:null});o.value.close();const normal=await window.__m05Test.open({name:n});if(!normal.ok)throw new Error(normal.error.code);const read=await normal.value.read('abort-test');normal.value.close();return {failed,read};},name);
  expect(!fault.failed.ok&&fault.failed.error.code).toBe('STORAGE_UNAVAILABLE');expect(!fault.read.ok&&fault.read.error.code).toBe('NOT_FOUND');
  const quotaFault=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n,testQuotaAfterWrite:true});if(!o.ok)throw new Error(o.error.code);const w=window.__m05Test.fixture();w.id='quota-abort';w.status='completed';const failed=await o.value.save({work:w,expectedRevision:null});o.value.close();const normal=await window.__m05Test.open({name:n});if(!normal.ok)throw new Error(normal.error.code);const read=await normal.value.read('quota-abort');normal.value.close();return {failed,read};},name);
  expect(!quotaFault.failed.ok&&quotaFault.failed.error.code).toBe('QUOTA_EXCEEDED');expect(!quotaFault.read.ok&&quotaFault.read.error.code).toBe('NOT_FOUND');
  const corrupt=await page.evaluate(async n=>{await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(n,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction('works','readwrite');tx.objectStore('works').put({id:'corrupt',schemaVersion:99});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const issues=await o.value.inspectRecords(),read=await o.value.read('corrupt'),list=await o.value.list(),backup=await o.value.exportRawBackup();o.value.close();return {issues,read,list,backup:backup.ok?backup.value.records.works?.some(x=>x.key==='corrupt'):false};},name);
  expect(corrupt.issues.ok&&corrupt.issues.value.some(x=>x.key==='corrupt'&&x.code==='UNSUPPORTED_VERSION')).toBe(true);expect(!corrupt.read.ok&&corrupt.read.error.code).toBe('UNSUPPORTED_VERSION');expect(corrupt.list.ok).toBe(true);expect(corrupt.backup).toBe(true);await removeDb(page,name);
});

test('persistent Edge profile survives browser restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'m05-profile-'));const name=dbName();
  try{
    let browser=await chromium.launchPersistentContext(directory,{channel:'msedge',headless:true});let p=browser.pages()[0]??await browser.newPage();await ready(p);
    const saved=await p.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const w=window.__m05Test.fixture();w.id='restart';w.status='completed';const r=await o.value.save({work:w,expectedRevision:null});o.value.close();return r;},name);expect(saved.ok).toBe(true);await browser.close();
    browser=await chromium.launchPersistentContext(directory,{channel:'msedge',headless:true});p=browser.pages()[0]??await browser.newPage();await ready(p);const read=await p.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const r=await o.value.read('restart');o.value.close();return r;},name);expect(read.ok&&read.value.revision).toBe(1);await removeDb(p,name);await browser.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('concurrent final slots, versionchange, blocked upgrade and higher version',async({page})=>{
  await ready(page);const name=dbName();
  const limit=await page.evaluate(async n=>{const o=await window.__m05Test.open({name:n});if(!o.ok)throw new Error(o.error.code);const db=o.value,base=window.__m05Test.fixture();for(let i=0;i<99;i++){const r=await db.save({work:{...base,id:`seed-${i}`},expectedRevision:null});if(!r.ok)throw new Error(r.error.code);}const result=await Promise.all(['a','b'].map(id=>db.save({work:{...base,id:`last-${id}`},expectedRevision:null})));const list=await db.list();db.close();return {result,total:list.ok?list.value.total:-1};},name);
  expect(limit.result.filter(x=>x.ok)).toHaveLength(1);expect(limit.result.filter(x=>!x.ok).map(x=>!x.ok?x.error.code:'')).toEqual(['QUOTA_EXCEEDED']);expect(limit.total).toBe(100);
  const versions=await page.evaluate(async n=>{let changed=false;const o=await window.__m05Test.open({name:n,onVersionChange:()=>{changed=true;}});if(!o.ok)throw new Error(o.error.code);const upgraded=await new Promise<boolean>((resolve,reject)=>{const r=indexedDB.open(n,4);r.onupgradeneeded=()=>{r.result.createObjectStore('test-only-v4');};r.onsuccess=()=>{r.result.close();resolve(true);};r.onerror=()=>reject(r.error);});const closed=await o.value.list();const newer=await window.__m05Test.open({name:n});return {changed,upgraded,closed:closed.ok?'ok':closed.error.code,newer:newer.ok?'ok':newer.error.code};},name);
  expect(versions).toEqual({changed:true,upgraded:true,closed:'STORAGE_UNAVAILABLE',newer:'UNSUPPORTED_VERSION'});await removeDb(page,name);
  const blockedName=dbName();
  const blocked=await page.evaluate(async n=>{const initial=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(n,1);r.onupgradeneeded=()=>r.result.createObjectStore('test-blocker');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const upgrade=indexedDB.open(n,2);upgrade.onupgradeneeded=()=>upgrade.result.createObjectStore('new');const retry=await window.__m05Test.open({name:n,openTimeoutMs:100});initial.close();await new Promise<void>(resolve=>{upgrade.onsuccess=()=>{upgrade.result.close();resolve();};upgrade.onerror=()=>resolve();});return retry.ok?'ok':retry.error.code;},blockedName);
  expect(blocked).toBe('STORAGE_UNAVAILABLE');await removeDb(page,blockedName);
});

test('explicit test-only legacy fixture migrates atomically and malformed migration rolls back',async({page})=>{
  await ready(page);
  for(const malformed of [false,true]){
    const name=dbName();
    const outcome=await page.evaluate(async ({name,malformed})=>{
      const legacy=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('m05-test-legacy-works',{keyPath:'id'});r.result.createObjectStore('m05-test-legacy-favorites',{keyPath:'exhibitId'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const w=window.__m05Test.fixture();w.id='legacy-work';w.status='completed';w.revision=1;
      await new Promise<void>((resolve,reject)=>{const tx=legacy.transaction(['m05-test-legacy-works','m05-test-legacy-favorites'],'readwrite');tx.objectStore('m05-test-legacy-works').put({id:w.id,work:malformed?{id:w.id,schemaVersion:99}:w});tx.objectStore('m05-test-legacy-favorites').put({exhibitId:'legacy-exhibit',favorite:{exhibitId:'legacy-exhibit',createdAt:w.createdAt}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});legacy.close();
      const migrated=await window.__m05Test.open({name});if(migrated.ok){const work=await migrated.value.read('legacy-work'),favorites=await migrated.value.favorites.list();migrated.value.close();return {ok:true,work:work.ok,favorites:favorites.ok?favorites.value.length:-1};}
      const version=await new Promise<number>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>{const v=r.result.version;r.result.close();resolve(v);};r.onerror=()=>reject(r.error);});return {ok:false,code:migrated.error.code,version};
    },{name,malformed});
    if(malformed)expect(outcome).toEqual({ok:false,code:'STORAGE_UNAVAILABLE',version:1});else expect(outcome).toEqual({ok:true,work:true,favorites:1});
    await removeDb(page,name);
  }
});

test('discarded draft revision never repeats; stale save, discard and commit cannot touch replacement',async({page})=>{
  await ready(page);const name=dbName();
  const results=await page.evaluate(async n=>{
    const opened=await window.__m05Test.open({name:n});if(!opened.ok)throw new Error(opened.error.code);const db=opened.value;
    const rows=[];
    for(const action of ['save','discard','commit'] as const){
      const work=window.__m05Test.fixture();work.id=`replacement-${action}`;work.status='completed';
      const saved=await db.save({work,expectedRevision:null});if(!saved.ok)throw new Error(saved.error.code);
      const old=await db.saveDraft({work:{...saved.value,name:'A旧草稿'},step:'cut',expectedDraftRevision:null,baseRevision:saved.value.revision});if(!old.ok)throw new Error(old.error.code);
      const discarded=await db.discardDraft(work.id,old.value.revision);if(!discarded.ok)throw new Error(discarded.error.code);
      const replacement=await db.saveDraft({work:{...saved.value,name:'B新草稿'},step:'preview',expectedDraftRevision:null,baseRevision:saved.value.revision});if(!replacement.ok)throw new Error(replacement.error.code);
      const stale=action==='save'?await db.saveDraft({work:{...saved.value,name:'A过期写入'},step:'cut',expectedDraftRevision:old.value.revision,baseRevision:saved.value.revision}):action==='discard'?await db.discardDraft(work.id,old.value.revision):await db.commitDraft({workId:work.id,expectedDraftRevision:old.value.revision,expectedWorkRevision:saved.value.revision});
      const after=await db.readDraft(work.id),completed=await db.read(work.id);
      rows.push({action,oldRevision:old.value.revision,newRevision:replacement.value.revision,staleCode:stale.ok?'OK':stale.error.code,actualRevision:stale.ok?null:stale.error.code==='REVISION_CONFLICT'?stale.error.actualRevision:null,draftName:after.ok?after.value.work.name:'MISSING',completedName:completed.ok?completed.value.name:'MISSING'});
    }
    db.close();return rows;
  },name);
  for(const row of results){expect(row.newRevision).toBeGreaterThan(row.oldRevision);expect(row.staleCode).toBe('REVISION_CONFLICT');expect(row.actualRevision).toBe(row.newRevision);expect(row.draftName).toBe('B新草稿');expect(row.completedName).toBe('开发测试作品');}
  await removeDb(page,name);
});

test('physical v2 upgrade preserves works and invalidates old draft revisions',async({page})=>{
  await ready(page);const name=dbName();
  const result=await page.evaluate(async n=>{
    const oldDb=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(n,2);r.onupgradeneeded=()=>{r.result.createObjectStore('works',{keyPath:'id'}).createIndex('updatedAt','updatedAt');r.result.createObjectStore('drafts',{keyPath:'workId'});r.result.createObjectStore('thumbnails',{keyPath:'workId'});r.result.createObjectStore('favorites',{keyPath:'exhibitId'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const work=window.__m05Test.fixture();work.id='upgrade-active';work.status='completed';work.revision=1;
    const deleted=window.__m05Test.fixture();deleted.id='upgrade-deleted';deleted.status='completed';deleted.revision=1;
    await new Promise<void>((resolve,reject)=>{const tx=oldDb.transaction(['works','drafts'],'readwrite');tx.objectStore('works').put(work);tx.objectStore('works').put(deleted);tx.objectStore('drafts').put({workId:work.id,work:{...work,status:'draft'},step:'cut',revision:1,baseRevision:1,updatedAt:work.updatedAt});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});oldDb.close();
    const opened=await window.__m05Test.open({name:n});if(!opened.ok)throw new Error(opened.error.code);const db=opened.value;
    const completed=await db.read(work.id),active=await db.readDraft(work.id);
    const staleSave=await db.saveDraft({work:{...work,name:'old'},step:'cut',expectedDraftRevision:1,baseRevision:1});
    const staleDiscard=await db.discardDraft(work.id,1),staleCommit=await db.commitDraft({workId:work.id,expectedDraftRevision:1,expectedWorkRevision:1});
    const newDraft=await db.saveDraft({work:{...deleted,name:'new'},step:'cut',expectedDraftRevision:null,baseRevision:1});
    db.close();return {completed:completed.ok,activeRevision:active.ok?active.value.revision:0,staleCodes:[staleSave,staleDiscard,staleCommit].map(r=>r.ok?'OK':r.error.code),newRevision:newDraft.ok?newDraft.value.revision:0};
  },name);
  expect(result.completed).toBe(true);expect(result.activeRevision).toBeGreaterThan(1);expect(result.staleCodes).toEqual(['REVISION_CONFLICT','REVISION_CONFLICT','REVISION_CONFLICT']);expect(result.newRevision).toBeGreaterThan(1);
  await removeDb(page,name);
});
