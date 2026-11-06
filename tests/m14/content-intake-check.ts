import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONTENT_SNAPSHOT, buildPreparation, validatePreparation, assertFileHashes, type Preparation } from './content-intake-core';

async function main():Promise<void>{
const root=resolve('.');
const sharp=createRequire(join(root,'apps/api/package.json'))('sharp') as (bytes:Buffer)=>{
  metadata():Promise<{format?:string;width?:number;height?:number}>;
  raw():{toBuffer(options:{resolveWithObject:true}):Promise<{data:Buffer}>};
};
const generated=buildPreparation(root);
const saved=JSON.parse(readFileSync(join(root,CONTENT_SNAPSHOT),'utf8')) as Preparation;
assert.deepEqual(saved,generated,'现行工具必须无改写地读取正式版本化快照');
validatePreparation(saved);
assertFileHashes(root,saved);

const expectFailure=(name:string,mutate:(p:Preparation)=>void,pattern:RegExp):void=>{
  const p=structuredClone(saved); mutate(p); assert.throws(()=>validatePreparation(p),pattern,name); console.log(`ok ${name}`);
};
expectFailure('重复稳定ID被拒绝',p=>{p.mappings[1]!.proposedId=p.mappings[0]!.proposedId;},/重复拟定ID/u);
expectFailure('错误快照schema被拒绝',p=>{p.schemaVersion=2 as never;},/schema版本不符/u);
expectFailure('18项映射缺一项被拒绝',p=>{p.mappings.pop();},/18项候选映射/u);
expectFailure('拟定映射种类错配被拒绝',p=>{p.mappings[0]!.kind='story';},/拟定映射状态不符/u);
expectFailure('当前集合缺一件被拒绝',p=>{p.exhibits.pop();},/当前展品集合不符/u);
expectFailure('已归档E-R06不得混入',p=>{p.exhibits[0]!.candidate='E-R06';},/归档展品混入/u);
expectFailure('已归档E-R15媒体不得混入',p=>{p.media[0]!.candidate='E-R15';},/归档展品混入/u);
expectFailure('故事集合缺一篇被拒绝',p=>{p.stories.pop();},/当前故事集合不符/u);
expectFailure('故事项目来源缺失被拒绝',p=>{p.stories.find(v=>v.candidate==='S-C02')!.sources.pop();},/故事来源集合不完整/u);
expectFailure('未知媒体候选号被拒绝',p=>{p.media[14]!.candidate='S-C99';},/媒体精确集合不符/u);
expectFailure('展品绑定到其他媒体被拒绝',p=>{p.exhibits[0]!.bindings.mediaId.candidate='E-R02';},/展品媒体绑定不符/u);
expectFailure('错误人物关联被拒绝',p=>{p.stories[0]!.exhibitIds=['exhibit-spring-ring'];},/exhibitIds必须为空/u);
expectFailure('错误模板关联被拒绝',p=>{p.exhibits[0]!.templateIds=['template-papercut-mirror-pairs'];},/未批准关联/u);
expectFailure('空摘要被公共schema拒绝',p=>{p.exhibits[0]!.summary=' ';},/too_small|Too small|至少|expected string/iu);
expectFailure('空正文被公共schema拒绝',p=>{p.exhibits[0]!.description=' ';},/too_small|Too small|至少|expected string/iu);
expectFailure('空alt被准备门禁拒绝',p=>{p.exhibits[0]!.alt=' ';},/alt不得为空/u);
expectFailure('空媒体署名被准备门禁拒绝',p=>{p.media[0]!.attribution=' ';},/署名不得为空/u);
expectFailure('候选展品发布门禁不得伪造',p=>{p.exhibits.find(v=>v.candidate==='E-R18')!.publishGate='blocked';},/展品发布门禁不符/u);
expectFailure('真人教学状态不得伪造',p=>{p.gates.humanTeaching='passed' as never;},/阶段门禁/u);
expectFailure('E-R18媒体技术审阅不得冒充人工批准',p=>{p.media.find(v=>v.candidate==='E-R18')!.rightsStatus='approved';},/媒体权利或分发门禁/u);
expectFailure('E-R18比赛分发许可边界不得伪造',p=>{p.media.find(v=>v.candidate==='E-R18')!.distributionGate='ready';},/媒体权利或分发门禁/u);
expectFailure('故事封面不得冒充独占授权',p=>{p.media.find(v=>v.candidate==='S-C01')!.rightsStatus='exclusive-copyright-approved';},/媒体权利或分发门禁/u);
expectFailure('开放许可依据不得冒充赛事已批准',p=>{p.gates.competitionDistribution='competition-approved' as never;},/阶段门禁/u);
expectFailure('发布状态不得伪造',p=>{p.gates.formalPublication='published' as never;},/阶段门禁/u);

const wrongHash=structuredClone(saved); wrongHash.media[0]!.uploadSha256='0'.repeat(64);
assert.throws(()=>assertFileHashes(root,wrongHash),/上传件hash错误/u);
console.log('ok 错误hash被拒绝');
const wrongLicense=structuredClone(saved); wrongLicense.media.find(item=>item.candidate==='E-R18')!.license='CC0';
assert.throws(()=>assertFileHashes(root,wrongLicense),/CC0|CC BY/u);
console.log('ok 原件许可与快照不一致被拒绝');

for(const media of saved.media){
  const bytes=readFileSync(join(root,media.uploadFile));
  assert(bytes.length<=5*1024*1024,`${media.candidate}: 上传件超过5 MiB`);
  const decoded=sharp(bytes), meta=await decoded.metadata(), raw=await decoded.raw().toBuffer({resolveWithObject:true});
  assert.equal(meta.width,media.width,`${media.candidate}: 解码宽度不符`);
  assert.equal(meta.height,media.height,`${media.candidate}: 解码高度不符`);
  assert(['png','jpeg','webp'].includes(meta.format??''),`${media.candidate}: 后台不接受的格式`);
  assert(raw.data.length>0,`${media.candidate}: 完整解码为空`);
}
console.log('ok 15项上传候选均完成真实解码、格式/尺寸和5 MiB检查');

assert.equal(saved.exhibits.every(e=>e.bindings.mediaId.status==='pending-admin-upload'),true);
assert.equal(saved.stories.every(s=>s.exhibitIds.length===0),true);
assert.deepEqual(saved.stories.find(s=>s.candidate==='S-C02')!.sources.map(source=>source.url),['https://www.ihchina.cn/ccr_detail/2619.html','https://www.ihchina.cn/Article/Index/detail?id=20180']);
assert.deepEqual(saved.stories.find(s=>s.candidate==='S-C03')!.sources.map(source=>source.url),['https://www.ihchina.cn/art/detail/id/2676.html','https://www.ihchina.cn/project_details/20157.html']);
assert.equal(saved.media.filter(m=>m.rightsStatus.includes('pending')||m.rightsStatus.includes('unverified')).length>=5,true);
console.log(`V1 canonical content passed: mappings=${saved.mappings.length}, exhibits=${saved.exhibits.length}, stories=${saved.stories.length}, media=${saved.media.length}; human-approval=pending; official-submission-conditions=pending`);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
