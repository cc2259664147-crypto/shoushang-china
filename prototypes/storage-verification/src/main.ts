import { createFixtureWork } from '@shoushang/fixtures';
import { openIndexedDbRepository, type IndexedDbRepository } from '@shoushang/local-repository';
import type { Work } from '@shoushang/contracts';
import './style.css';

Object.assign(window, { __m05Test: { open: openIndexedDbRepository, fixture: createFixtureWork } });

const $ = (id: string) => document.getElementById(id)!;
const status = (s: string) => { $('status').textContent = s; };
let repo: IndexedDbRepository;
let selected: Work | null = null;
let draftRevision: number | null = null;
let thumbnailUrl: string | null = null;
async function testImage(): Promise<Blob> {
  const c = document.createElement('canvas'); c.width=160; c.height=120;
  const ctx=c.getContext('2d')!;ctx.fillStyle='#f6e9ce';ctx.fillRect(0,0,160,120);ctx.fillStyle='#b82025';ctx.fillRect(20,15,120,90);
  ctx.fillStyle='#fff';ctx.font='14px sans-serif';ctx.fillText('M05 测试图',34,67);
  return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('测试图片生成失败')),'image/png'));
}
async function show(): Promise<void> {
  const list=await repo.list();
  if(!list.ok){status(`${list.error.code}: ${list.error.message}`);return;}
  const works=list.value.items;
  if(!selected && works.length)selected=works[0]!;
  if(selected){const read=await repo.read(selected.id);if(read.ok)selected=read.value;else if(read.error.code==='NOT_FOUND')selected=null;}
  $('work').textContent=selected?`ID: ${selected.id} · revision: ${selected.revision} · 更新: ${selected.updatedAt} · 名称: ${selected.name}`:`完成作品 ${list.value.total} 件；当前未选择`;
  if(selected){const d=await repo.readDraft(selected.id);draftRevision=d.ok?d.value.revision:null;$('draft-info').textContent=d.ok?`独立草稿 revision ${d.value.revision}，基于完成版 ${d.value.baseRevision}，步骤 ${d.value.step}`:'无关联草稿';
    const t=await repo.readThumbnail(selected.id);if(thumbnailUrl)URL.revokeObjectURL(thumbnailUrl);thumbnailUrl=null;$('thumbnail').replaceChildren();if(t.ok){$('thumbnail').append(`缩略图 ${t.value.state}，对应作品 revision ${t.value.workRevision}。`);if(t.value.blob){thumbnailUrl=URL.createObjectURL(t.value.blob);const img=document.createElement('img');img.src=thumbnailUrl;img.alt='自制测试缩略图，不是正式剪纸渲染';$('thumbnail').append(img);}}}
  const f=await repo.favorites.list();$('favorites').textContent=f.ok?`已收藏：${f.value.map(x=>x.exhibitId).join('、')||'无'}`:`${f.error.code}: ${f.error.message}`;
  const issues=await repo.inspectRecords();$('issues').textContent=issues.ok?`异常记录 ${issues.value.length} 条\n${issues.value.map(x=>`${x.store}/${x.key}: ${x.code}`).join('\n')}`:issues.error.message;
}
function action(id:string,fn:()=>Promise<void>):void {$(id).addEventListener('click',()=>{void fn().catch(()=>status('操作失败，请保留当前编辑内容并重试'));});}
async function report<T>(promise:Promise<{ok:true;value:T}|{ok:false;error:{code:string;message:string}}>,success:string):Promise<T|null>{const r=await promise;status(r.ok?success:`${r.error.code}: ${r.error.message}`);await show();return r.ok?r.value:null;}
const opened=await openIndexedDbRepository({onVersionChange:()=>status('数据库版本已变化；连接已关闭，请刷新重试')});
if(!opened.ok){status(`${opened.error.code}: ${opened.error.message}`);}else{
  repo=opened.value;status('真实 IndexedDB 已连接');await show();
  action('create',async()=>{const w=createFixtureWork();w.id=`test-${crypto.randomUUID()}`;w.name=($('name') as HTMLInputElement).value;w.status='completed';const saved=await report(repo.saveWithThumbnail({work:w,expectedRevision:null},await testImage()),'完成作品已提交');if(saved)selected=saved;await show();});
  action('update',async()=>{if(!selected)return status('请先创建作品');const w={...selected,name:($('name') as HTMLInputElement).value};const saved=await report(repo.saveWithThumbnail({work:w,expectedRevision:selected.revision},await testImage()),'完成版已更新');if(saved)selected=saved;await show();});
  action('draft',async()=>{if(!selected)return status('请先创建作品');await report(repo.saveDraft({work:{...selected,name:($('name') as HTMLInputElement).value,status:'draft'},step:'cut',expectedDraftRevision:draftRevision,baseRevision:selected.revision}),'独立草稿已保存');});
  action('restore',async()=>{if(!selected)return status('请先创建作品');const d=await report(repo.readDraft(selected.id),'草稿已恢复');if(d){($('name') as HTMLInputElement).value=d.work.name;$('draft-info').textContent=`恢复名称 ${d.work.name}，步骤 ${d.step}，草稿 revision ${d.revision}`;}});
  action('commit',async()=>{if(!selected||draftRevision===null)return status('没有可提交的草稿');const saved=await report(repo.commitDraft({workId:selected.id,expectedDraftRevision:draftRevision,expectedWorkRevision:selected.revision,thumbnail:await testImage()}),'草稿已提交为完成版');if(saved)selected=saved;await show();});
  action('delete',async()=>{if(!selected)return;const id=selected.id;const result=await report(repo.delete(id,selected.revision),'作品已删除');if(result)selected=null;await show();});
  action('favorite',async()=>{await report(repo.favorites.put({exhibitId:'exhibit-dev-paper',createdAt:new Date().toISOString()}),'已收藏');});
  action('unfavorite',async()=>{await report(repo.favorites.remove('exhibit-dev-paper'),'已取消收藏');});
  action('inspect',show);
  action('backup',async()=>{const r=await repo.exportRawBackup();if(!r.ok)return status(`${r.error.code}: ${r.error.message}`);const records=r.value.records;for(const entries of Object.values(records)){for(const entry of entries){const v=entry.value;if(v&&typeof v==='object'&&'blob' in v&&v.blob instanceof Blob){const blob=v.blob;const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});entry.value={...v,blob:{type:blob.type,size:blob.size,dataUrl}};}}}const data=JSON.stringify(r.value);const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='m05-raw-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已生成原始备份');});
  window.addEventListener('pagehide',()=>{if(thumbnailUrl)URL.revokeObjectURL(thumbnailUrl);repo.close();});
}
