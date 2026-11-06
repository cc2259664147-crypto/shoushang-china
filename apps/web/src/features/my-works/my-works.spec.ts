import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureWork } from '@shoushang/fixtures';
import { EditorProfileV2Schema, TemplateVersionV1Schema, WorkV1Schema, WorkV2Schema, type Work, type WorkV2 } from '@shoushang/contracts';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json' with { type: 'json' };

const m15Entry=profilesDocument.profiles[0]!;
const m15Profile=EditorProfileV2Schema.parse(m15Entry.profile);
const m15Template=TemplateVersionV1Schema.parse(JSON.parse(m15Entry.evidence.sourceTemplateCanonicalJcs));
function v2Work(id:string,name:string,status:WorkV2['status']='completed',revision=0,palette='#B82025'):WorkV2{return WorkV2Schema.parse({id,name,craftId:m15Template.craftId,templateSnapshot:m15Template,editorProfileSnapshot:m15Profile,palette:{paper:palette,background:'#F2D9A6'},operations:[],status,schemaVersion:2,revision,createdAt:'2026-10-26T00:00:00.000Z',updatedAt:'2026-10-26T00:00:00.000Z'});}
function v1Work(id:string,name:string,status:Work['status']='completed',revision=1):Work{return WorkV1Schema.parse({id,name,craftId:m15Template.craftId,templateSnapshot:m15Template,palette:{paper:'#B82025',background:'#F2D9A6'},operations:[],status,schemaVersion:1,revision,createdAt:'2026-10-26T00:00:00.000Z',updatedAt:'2026-10-26T00:00:00.000Z'});}

const database=()=>`m07-test-${crypto.randomUUID()}`;
async function open(page:Page,name:string){await page.goto(`/my/works?m07db=${name}`);await expect(page.getByRole('heading',{name:'我的作品'})).toBeVisible();}
type AnyWork=Work|WorkV2;
async function seed(page:Page,name:string,works:AnyWork[],drafts:{workId:string;work:AnyWork;step:string;revision:number;baseRevision:number|null;updatedAt:string}[]=[]){await page.evaluate(async({name,works,drafts})=>{await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(name,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['works','drafts','draftRevisions','thumbnails'],'readwrite');for(const work of works)tx.objectStore('works').put(work);for(const draft of drafts){tx.objectStore('drafts').put(draft);tx.objectStore('draftRevisions').put({workId:draft.workId,revision:draft.revision});}tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});},{name,works,drafts});await page.getByRole('button',{name:'刷新列表'}).click();}
async function seedAny(page:Page,name:string,works:unknown[],drafts:unknown[],ledgers:{workId:string;revision:number}[]=[]){await page.evaluate(async({name,works,drafts,ledgers})=>{await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(name,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['works','drafts','draftRevisions','thumbnails'],'readwrite');for(const work of works)tx.objectStore('works').put(work as object);for(const draft of drafts)tx.objectStore('drafts').put(draft as object);for(const ledger of ledgers)tx.objectStore('draftRevisions').put(ledger);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});},{name,works,drafts,ledgers});await page.getByRole('button',{name:'刷新列表'}).click();}
async function readRows(page:Page,name:string){return page.evaluate(async dbName=>new Promise<{works:Record<string,unknown>[];drafts:Record<string,unknown>[];thumbnails:{state:string;blobType:string}[]}>((resolve,reject)=>{const req=indexedDB.open(dbName,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['works','drafts','thumbnails'],'readonly');const works=tx.objectStore('works').getAll(),drafts=tx.objectStore('drafts').getAll(),thumbnails=tx.objectStore('thumbnails').getAll();tx.oncomplete=()=>{resolve({works:works.result,drafts:drafts.result,thumbnails:thumbnails.result.map((row:{state:string;blob?:Blob})=>({state:row.state,blobType:row.blob?.type??''}))});db.close();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);}),name);}
function work(id:string,name:string,time='2026-10-18T00:00:00Z'):WorkV2{return {...v2Work(id,name,'completed',1),createdAt:'2026-10-17T00:00:00Z',updatedAt:time};}
function draft(seed:AnyWork,revision=10,step='preview'){return {workId:seed.id,work:{...seed,status:'draft' as const,palette:{...seed.palette,paper:'#276B62'}},step,revision,baseRevision:seed.revision,updatedAt:'2026-10-18T01:00:00Z'};}

test('merged list, more than 50 records, filters, stable sorting and pagination',async({page})=>{const name=database();await open(page,name);const works=Array.from({length:55},(_,i)=>work(`entry-${String(i).padStart(2,'0')}`,`作品${i}`));const d=draft(works[0]!);await seed(page,name,works,[d]);await expect(page.getByText('共 55 件作品')).toBeVisible();await expect(page.locator('.mw-thumb img')).toHaveCount(12);await page.screenshot({path:'apps/web/src/features/my-works/evidence/list.png',fullPage:true});await expect(page.getByText('已完成 · 有编辑草稿')).toBeVisible();await page.getByRole('button',{name:'下一页'}).click();await expect(page.getByText('第 2 / 5 页')).toBeVisible();await page.getByRole('button',{name:'草稿',exact:true}).click();await expect(page.getByText('共 1 件作品')).toBeVisible();await page.getByRole('button',{name:'已完成',exact:true}).click();await expect(page.getByText('共 55 件作品')).toBeVisible();});

test('rename, copy and delete through visible dialogs preserve both versions',async({page})=>{const name=database();await open(page,name);const original=work('combined','一件作品');await seed(page,name,[original],[draft(original)]);await page.getByRole('button',{name:'改名'}).click();await page.getByLabel('作品名称').fill('  新名字😀  ');await page.getByRole('button',{name:'保存名称'}).click();await expect(page.getByRole('heading',{name:'新名字😀'})).toBeVisible();await page.getByRole('button',{name:'复制'}).first().dblclick();await expect(page.getByText('共 2 件作品')).toBeVisible();await page.getByRole('button',{name:'删除'}).first().click();await page.getByRole('button',{name:'取消'}).click();await expect(page.getByText('共 2 件作品')).toBeVisible();await page.getByRole('button',{name:'删除'}).first().click();await expect(page.getByText(/关联编辑草稿/)).toBeVisible();await page.getByRole('button',{name:'确认永久删除'}).click();await expect(page.getByText('共 1 件作品')).toBeVisible();});

test('v1 draft from my works opens read-only and saves an editable v2 copy',async({page})=>{const name=database();await open(page,name);const original=v1Work('open-draft','历史作品');const sourceDraft={workId:original.id,work:{...original,status:'draft' as const,palette:{paper:'#276B62',background:'#F2D9A6'}},step:'preview',revision:10,baseRevision:original.revision,updatedAt:'2026-10-26T01:00:00.000Z'};await seed(page,name,[original],[sourceDraft]);const card=page.locator('.mw-card').filter({has:page.getByRole('heading',{name:'历史作品',exact:true})});await expect(card.getByText('只读历史作品',{exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'改名'})).toHaveCount(0);await card.getByRole('button',{name:'查看作品'}).click();await expect(page.getByText('旧版作品为只读')).toBeVisible();await expect(page.getByText('已恢复同 ID 的较新旧版草稿')).toBeVisible();await page.getByRole('button',{name:'另存为可编辑副本'}).click();await expect(page.getByRole('application',{name:/剪纸画布/})).toBeVisible();await page.goto(`/my/works?m07db=${name}`);await expect(page.getByText('共 2 件作品')).toBeVisible();await expect(page.getByRole('heading',{name:'历史作品'})).toHaveCount(2);});


test('visible rename conflict keeps entered text and deletion catches a newly created draft',async({page,context})=>{const name=database();await open(page,name);const original=work('conflict-work','原名');await seed(page,name,[original]);const second=await context.newPage();await open(second,name);await page.getByRole('button',{name:'改名'}).click();await page.getByLabel('作品名称').fill('用户输入');await second.getByRole('button',{name:'改名'}).click();await second.getByLabel('作品名称').fill('另一标签');await second.getByRole('button',{name:'保存名称'}).click();await page.getByRole('button',{name:'保存名称'}).click();await expect(page.getByText(/REVISION_CONFLICT/).first()).toBeVisible();await expect(page.getByLabel('作品名称')).toHaveValue('用户输入');await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'刷新列表'}).click();await page.getByRole('button',{name:'删除'}).click();const current=work('conflict-work','另一标签');current.revision=2;await second.evaluate(async({name,current})=>{await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(name,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['drafts','draftRevisions'],'readwrite');const d={workId:current.id,work:{...current,status:'draft'},step:'cut',revision:22,baseRevision:2,updatedAt:current.updatedAt};tx.objectStore('drafts').put(d);tx.objectStore('draftRevisions').put({workId:current.id,revision:22});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});},{name,current});await page.getByRole('button',{name:'确认永久删除'}).click();await expect(page.getByText(/REVISION_CONFLICT/).first()).toBeVisible();await expect(page.getByRole('heading',{name:'另一标签'})).toBeVisible();});

test('100 works block new creation while existing actions remain available on narrow screen',async({page})=>{await page.setViewportSize({width:390,height:844});const name=database();await open(page,name);const works=Array.from({length:100},(_,i)=>work(`full-${i}`,`满额作品${i}`));await seed(page,name,works);await expect(page.getByRole('button',{name:'开始剪纸'})).toBeDisabled();await expect(page.locator('.mw-thumb img')).toHaveCount(12);await page.screenshot({path:'apps/web/src/features/my-works/evidence/narrow-capacity.png',fullPage:true});await expect(page.getByText(/已达到 100 件作品上限/)).toBeVisible();await expect(page.getByRole('button',{name:'改名'}).first()).toBeEnabled();await page.getByRole('button',{name:'改名'}).first().click();await page.getByLabel('作品名称').fill('满额仍可改名');await page.getByRole('button',{name:'保存名称'}).click();await expect(page.getByRole('heading',{name:'满额仍可改名'})).toBeVisible();});

test('failed copy retry reuses one target after capacity is released',async({page})=>{const name=database();await open(page,name);await seed(page,name,Array.from({length:100},(_,i)=>work(`retry-${String(i).padStart(3,'0')}`,`副本源${i}`)));await page.getByRole('button',{name:'复制'}).first().click();await expect(page.getByText(/复制未完成/).first()).toBeVisible();await page.getByRole('button',{name:'删除'}).nth(1).click();await page.getByRole('button',{name:'确认永久删除'}).click();await expect(page.getByText('共 99 件作品')).toBeVisible();await page.getByRole('button',{name:'复制'}).first().dblclick();await expect(page.getByText('共 100 件作品')).toBeVisible();await expect(page.getByRole('heading',{name:'副本源0副本'})).toBeVisible();});

test('direct work URL, same-path ID switch and history restore the selected work',async({page})=>{const name=database();await open(page,name);const withCut=WorkV2Schema.parse({...v2Work('route-a','路由甲','draft',0),operations:[{kind:'parametric',id:'route-cut',order:0,parameterVersion:2,shape:'circle',center:{x:0.2,y:0.5},width:0.06,height:0.06,angleDeg:0}]});await seedAny(page,name,[],[{workId:'route-a',work:withCut,step:'cut',revision:5,baseRevision:null,updatedAt:'2026-10-26T00:00:00.000Z'},{workId:'route-b',work:v2Work('route-b','路由乙','draft',0),step:'cut',revision:5,baseRevision:null,updatedAt:'2026-10-26T00:00:00.000Z'}],[{workId:'route-a',revision:5},{workId:'route-b',revision:5}]);await page.goto(`/workshop/papercut?m07db=${name}&workId=route-a&version=stored-draft`);await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count','1');await page.evaluate(({name})=>{history.pushState({wsIndex:5},'',`/workshop/papercut?m07db=${name}&workId=route-b&version=stored-draft`);dispatchEvent(new PopStateEvent('popstate'));},{name});await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count','0');await page.reload();await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count','0');});

test('my works survives an independent Edge profile restart',async()=>{const directory=await mkdtemp(join(tmpdir(),'m09-profile-')),name=database();try{let browser=await chromium.launchPersistentContext(directory,{channel:'msedge',headless:true});let page=browser.pages()[0]??await browser.newPage();await page.goto(`http://127.0.0.1:5173/my/works?m07db=${name}`);await seed(page,name,[work('persistent','重启后仍在')]);await expect(page.getByRole('heading',{name:'重启后仍在'})).toBeVisible();await browser.close();browser=await chromium.launchPersistentContext(directory,{channel:'msedge',headless:true});page=browser.pages()[0]??await browser.newPage();await page.goto(`http://127.0.0.1:5173/my/works?m07db=${name}`);await expect(page.getByRole('heading',{name:'重启后仍在'})).toBeVisible();await browser.close();}finally{await rm(directory,{recursive:true,force:true});}});

test('ready thumbnail is reused while pending and missing thumbnails are rebuilt',async({page})=>{const name=database();await open(page,name);const items=[work('thumb-ready','已有缩略图'),work('thumb-pending','待重建缩略图'),work('thumb-missing','缺失缩略图')];await page.evaluate(async ({name,items})=>{await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(name,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['works','thumbnails'],'readwrite');for(const item of items)tx.objectStore('works').put(item);const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='),x=>x.charCodeAt(0));tx.objectStore('thumbnails').put({workId:'thumb-ready',workRevision:1,state:'ready',blob:new Blob([bytes],{type:'image/png'})});tx.objectStore('thumbnails').put({workId:'thumb-pending',workRevision:1,state:'pending'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});},{name,items});await page.getByRole('button',{name:'刷新列表'}).click();await expect(page.getByText('完成版缩略图',{exact:true})).toHaveCount(1);await expect(page.getByText('完成版缩略图已重建',{exact:true})).toHaveCount(2);const states=await page.evaluate(async n=>{return await new Promise<string[]>((resolve,reject)=>{const req=indexedDB.open(n,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction('thumbnails','readonly'),get=tx.objectStore('thumbnails').getAll();tx.oncomplete=()=>{db.close();resolve(get.result.map(x=>x.state));};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});},name);expect(states).toEqual(['ready','ready','ready']);});

test('primary-store draft from public save stays a draft in list, filter, copy, export and workshop',async({page})=>{
  const name=database(),repositoryUrl=`/@fs/${join(process.cwd(),'packages/local-repository/src/index.ts').replaceAll('\\','/')}`;
  await open(page,name);
  const saved=await page.evaluate(async({name,repositoryUrl,seed})=>{
    const {openIndexedDbRepository}=await import(/* @vite-ignore */ repositoryUrl) as typeof import('@shoushang/local-repository');
    const opened=await openIndexedDbRepository({name});if(!opened.ok)throw new Error(opened.error.code);
    try{return await opened.value.save({work:seed,expectedRevision:null});}finally{opened.value.close();}
  },{name,repositoryUrl,seed:{...createFixtureWork(),id:'main-store-draft',name:'主记录合法草稿'}});
  expect(saved.ok).toBe(true);
  await page.getByRole('button',{name:'刷新列表'}).click();
  await expect(page.getByText('状态：草稿')).toBeVisible();
  await expect(page.getByText('卡片展示：主记录草稿')).toBeVisible();
  await expect(page.getByRole('button',{name:'编辑完成版'})).toHaveCount(0);
  await page.getByRole('button',{name:'草稿',exact:true}).click();
  await expect(page.getByRole('heading',{name:'主记录合法草稿'})).toBeVisible();
  await page.getByRole('button',{name:'复制'}).click();
  await expect(page.getByRole('heading',{name:'主记录合法草稿副本'})).toBeVisible();
  const statuses=await page.evaluate(async({name,repositoryUrl})=>{const {openIndexedDbRepository}=await import(/* @vite-ignore */ repositoryUrl) as typeof import('@shoushang/local-repository');const opened=await openIndexedDbRepository({name});if(!opened.ok)throw new Error(opened.error.code);try{const listed=await opened.value.list();if(!listed.ok)throw new Error(listed.error.code);return listed.value.items.map(item=>({name:item.name,status:item.status}));}finally{opened.value.close();}},{name,repositoryUrl});
  expect(statuses).toEqual(expect.arrayContaining([{name:'主记录合法草稿',status:'draft'},{name:'主记录合法草稿副本',status:'draft'}]));
  await page.getByRole('button',{name:'导出 PNG'}).first().click();
  await expect(page.getByRole('heading',{name:'导出主记录草稿 PNG 作品卡'})).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'查看作品'}).first().click();
  await expect(page.getByText('旧版作品为只读')).toBeVisible();
  await expect(page.getByRole('button',{name:'另存为可编辑副本'})).toBeVisible();
});



test('lists v1 and v2 records with lifecycle labels and rebuilds v2 thumbnails',async({page})=>{
  const name=database();await open(page,name);
  const v1=v1Work('list-v1','v1 作品');
  const v2Done=v2Work('list-v2','v2 作品','completed',1,'#276B62');
  const v2Draft={workId:'list-v2',work:v2Work('list-v2','v2 草稿','draft',0,'#276B62'),step:'cut',revision:5,baseRevision:1,updatedAt:'2026-10-26T01:00:00.000Z'};
  const v2Thumb=v2Work('list-v2-thumb','v2 缩略图','completed',1,'#E59C38');
  await seedAny(page,name,[v1,v2Done,v2Thumb],[draft(v1),v2Draft],[{workId:'list-v2',revision:5}]);
  await expect(page.getByText('共 3 件作品')).toBeVisible();
  await expect(page.getByText('版本：v1')).toHaveCount(1);
  await expect(page.getByText('版本：v2 · editable')).toHaveCount(2);
  await expect(page.getByText('状态：已完成 · 有编辑草稿')).toHaveCount(2);
  await expect(page.getByText('状态：已完成',{exact:true})).toHaveCount(1);
  await expect(page.getByText('卡片展示：编辑草稿')).toHaveCount(2);
  await expect(page.getByText('编辑草稿预览',{exact:true})).toHaveCount(2);
  await expect(page.getByText('完成版缩略图已重建',{exact:true})).toHaveCount(1);
  await expect.poll(async()=>{const rows=await readRows(page,name);return rows.thumbnails.find(row=>row.state==='ready')?.blobType;}).toBe('image/png');
});

test('exports v2 PNG with the v2 exporter and keeps a real download link',async({page})=>{
  const name=database();await open(page,name);
  await seedAny(page,name,[v2Work('v2-export','v2 导出','completed',1,'#B82025')],[]);
  await page.locator('.mw-version-actions').filter({hasText:'完成版 · v2'}).getByRole('button',{name:'导出 PNG'}).click();
  await expect(page.getByRole('heading',{name:'导出完成版 PNG 作品卡'})).toBeVisible();
  await page.getByRole('button',{name:'生成 PNG 作品卡'}).click();
  await expect(page.getByText('作品卡已生成',{exact:true}).last()).toBeVisible();
  await expect(page.getByRole('link',{name:'下载 PNG'})).toHaveAttribute('download',/\.png$/);
});

test('exports a brush v2 PNG from my works',async({page})=>{
  const name=database();await open(page,name);
  const brushed=WorkV2Schema.parse({...v2Work('v2-brush-export','笔刷导出','completed',1,'#B82025'),operations:[{kind:'brush',id:'brush',order:0,parameterVersion:2,points:[{x:0.12,y:0.2},{x:0.3,y:0.2}],width:0.02}]});
  await seedAny(page,name,[brushed],[]);
  await page.locator('.mw-version-actions').filter({hasText:'完成版 · v2'}).getByRole('button',{name:'导出 PNG'}).click();
  await page.getByRole('button',{name:'生成 PNG 作品卡'}).click();
  await expect(page.getByText('作品卡已生成',{exact:true}).last()).toBeVisible();
  await expect(page.getByRole('link',{name:'下载 PNG'})).toHaveAttribute('download',/\.png$/);
});

test('copies v2 drafts with saveV2Draft and completed works with saveV2WithThumbnail',async({page})=>{
  const name=database();await open(page,name);
  const cut={kind:'parametric' as const,id:'copy-cut',order:0,parameterVersion:2 as const,shape:'circle' as const,center:{x:0.25,y:0.5},width:0.08,height:0.08,angleDeg:0};
  const completed=WorkV2Schema.parse({...v2Work('v2-copy','v2 复制','completed',1,'#276B62'),operations:[cut]});
  const sourceDraft={workId:'v2-copy',work:WorkV2Schema.parse({...v2Work('v2-copy','v2 复制草稿','draft',0,'#E59C38'),operations:[cut]}),step:'cut',revision:5,baseRevision:1,updatedAt:'2026-10-26T01:00:00.000Z'};
  await seedAny(page,name,[completed],[sourceDraft],[{workId:'v2-copy',revision:5}]);
  await page.locator('.mw-version-actions').filter({hasText:'编辑草稿 · v2'}).getByRole('button',{name:'复制'}).click();
  await expect(page.getByText('共 2 件作品')).toBeVisible();
  await page.locator('.mw-version-actions').filter({hasText:'完成版 · v2'}).getByRole('button',{name:'复制'}).click();
  await expect(page.getByText('共 3 件作品')).toBeVisible();
  const rows=await readRows(page,name);
  const draftCopy=rows.drafts.find(row=>row.workId!=='v2-copy');
  const completedCopy=rows.works.find(row=>row.id!=='v2-copy');
  expect(draftCopy?.work).toMatchObject({schemaVersion:2,status:'draft',name:'v2 复制草稿副本',palette:{paper:'#E59C38'}});
  expect((draftCopy?.work as {operations:unknown[]}).operations).toHaveLength(1);
  expect(completedCopy).toMatchObject({schemaVersion:2,status:'completed',name:'v2 复制副本',palette:{paper:'#276B62'},templateSnapshot:{id:m15Template.id},editorProfileSnapshot:{profileId:m15Profile.profileId}});
  expect((completedCopy?.operations as unknown[])).toHaveLength(1);
});

test('renames editable v2 works and drafts together without changing immutable snapshots',async({page})=>{
  const name=database();await open(page,name);
  const completed=v2Work('v2-rename','v2 原名','completed',1,'#276B62');
  const sourceDraft={workId:'v2-rename',work:v2Work('v2-rename','v2 原名','draft',0,'#E59C38'),step:'cut',revision:5,baseRevision:1,updatedAt:'2026-10-26T01:00:00.000Z'};
  await seedAny(page,name,[completed],[sourceDraft],[{workId:'v2-rename',revision:5}]);
  await page.getByRole('button',{name:'改名'}).click();
  await page.getByLabel('作品名称').fill('v2 新名字');
  await page.getByRole('button',{name:'保存名称'}).click();
  await expect(page.getByRole('heading',{name:'v2 新名字'})).toBeVisible();
  const rows=await readRows(page,name);
  const work=rows.works.find(row=>row.id==='v2-rename')!;
  const draft=rows.drafts.find(row=>row.workId==='v2-rename')!;
  expect(work).toMatchObject({schemaVersion:2,name:'v2 新名字',palette:{paper:'#276B62'},templateSnapshot:{id:m15Template.id},editorProfileSnapshot:{profileId:m15Profile.profileId}});
  expect(draft.work).toMatchObject({schemaVersion:2,name:'v2 新名字',palette:{paper:'#E59C38'}});
  expect((draft.revision as number)).toBeGreaterThan(5);
});

test('two tabs v2 rename keeps the first snapshot and reports the stale one',async({page,context})=>{
  const name=database();await open(page,name);
  await seedAny(page,name,[v2Work('v2-tabs','v2 双标签','completed',1)],[]);
  const other=await context.newPage();await open(other,name);
  await page.getByRole('button',{name:'改名'}).click();
  await page.getByLabel('作品名称').fill('标签一');
  await page.getByRole('button',{name:'保存名称'}).click();
  await expect(page.getByRole('heading',{name:'标签一'})).toBeVisible();
  await other.getByRole('button',{name:'改名'}).click();
  await other.getByLabel('作品名称').fill('标签二');
  await other.getByRole('button',{name:'保存名称'}).click();
  await expect(other.getByText(/REVISION_CONFLICT/).first()).toBeVisible();
  await other.getByRole('button',{name:'取消',exact:true}).click();
  await other.getByRole('button',{name:'刷新列表'}).click();
  await expect(other.getByRole('heading',{name:'标签一'})).toBeVisible();
});

test('PNG export uses chosen version and corrupt records offer raw backup',async({page})=>{const name=database();await open(page,name);const original=work('export-test','导出作品');await seed(page,name,[original],[draft(original)]);await page.getByRole('button',{name:'导出 PNG'}).first().click();await expect(page.getByRole('heading',{name:'导出编辑草稿 PNG 作品卡'})).toBeVisible();await page.getByRole('button',{name:'生成 PNG 作品卡'}).click();await expect(page.getByText('作品卡已生成',{exact:true}).last()).toBeVisible();await expect(page.getByRole('link',{name:'下载 PNG'})).toHaveAttribute('download',/\.png$/);await page.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(async n=>{await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(n,3);req.onsuccess=()=>{const db=req.result,tx=db.transaction('works','readwrite');tx.objectStore('works').put({id:'corrupt',schemaVersion:99});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});},name);await page.getByRole('button',{name:'刷新列表'}).click();await expect(page.getByText(/发现 1 条损坏或不兼容记录/)).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载原始备份'}).click();expect((await download).suggestedFilename()).toMatch(/\.json$/);});
