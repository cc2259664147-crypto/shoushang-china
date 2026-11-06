import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ExhibitSchema, IdSchema, SourceSchema, StorySchema } from '@shoushang/contracts';

export const CONTENT_SNAPSHOT = 'content/v1-initial-2026-10-22/records.json';
export const CURRENT_EXHIBITS = ['E-R01','E-R02','E-R03','E-R04','E-R05','E-R07','E-R08','E-R13','E-R14','E-R17','E-R18','E-R19'] as const;
export const ARCHIVED_EXHIBITS = ['E-R06','E-R09','E-R10','E-R11','E-R12','E-R15','E-R16'] as const;
export const CURRENT_STORIES = ['S-C01','S-C02','S-C03'] as const;
export const STABLE_IDS: Readonly<Record<string,string>> = {
  'E-R01':'exhibit-spring-ring','E-R02':'exhibit-pig-papercut','E-R03':'exhibit-dog-papercut',
  'E-R04':'exhibit-rooster-dawn','E-R05':'exhibit-daolingzhi','E-R07':'exhibit-double-happiness',
  'E-R08':'exhibit-zamenhof-disc','E-R13':'exhibit-beijing-five-part-arch','E-R14':'exhibit-beijing-three-part-arch',
  'E-R17':'exhibit-v1-hundred-fu','E-R18':'exhibit-v1-goldfish-paper-cut','E-R19':'exhibit-v1-border-paper-cut',
  'S-C01':'story-zhou-shuying','S-C02':'story-zhang-xiufang','S-C03':'story-chen-qiuri',
  'T-C01':'template-papercut-mirror-pairs','T-C02':'template-papercut-linear-rhythm','T-C03':'template-papercut-fourfold',
};

type SourceValue = ReturnType<typeof SourceSchema.parse>;
type ManifestAsset = {
  candidate:string; workKey:string; file:string; uploadFile:string; sourcePage:string; filePage:string;
  license:string; licenseUrl:string; credit:string; width:number; height:number; format:string; sha256:string;
};
type Derivative = { candidate:string; file:string; derivedFrom:string; sourceSha256?:string; format:string; width:number; height:number; sha256:string };
type Manifest = { files:ManifestAsset[]; archivedFiles?:ManifestAsset[]; derivation:{files:Derivative[]} };
export type ExhibitPreparation = {
  candidate:string; proposedId:string; title:string; category:string; tags:string[]; summary:string; description:string;
  dateLabel:string; region:string; creator:string; meaning:string; alt:string; caption:string; sourceNote:string;
  sources:SourceValue[]; storyIds:string[]; templateIds:string[];
  bindings:{ craftId:{status:'pending-total-controller-confirmation'}; mediaId:{status:'pending-admin-upload'; candidate:string} };
  sortOrder:number; decisionStatus:string; publishGate:'blocked'|'not-approved';
};
export type StoryPreparation = {
  candidate:string; proposedId:string; title:string; personName:string; personBio:string; region:string; summary:string;
  body:{type:'paragraph';text:string}[]; timeline:unknown[]; sources:SourceValue[]; exhibitIds:string[];
  bindings:{craftIds:{status:'pending-total-controller-confirmation'};coverMediaId:{status:'pending-admin-upload';candidate:string};templateId:{status:'pending-controlled-template-intake';candidate:string}};
  sortOrder:number; decisionStatus:string; publishGate:'not-approved';
};
export type MediaPreparation = {
  candidate:string; role:'exhibit-primary'|'story-cover'; originalFile:string; uploadFile:string; originalSha256:string;
  uploadSha256:string; format:string; width:number; height:number; source:string; sourceUrl?:string; license:string;
  attribution:string; modification:string; mediaId:{status:'pending-admin-upload'}; rightsStatus:string; distributionGate:string;
};
export type Preparation = {
  schemaVersion:1; status:string; generatedFrom:string[]; inputFingerprint:Record<string,string>;
  mappings:{candidate:string;kind:'exhibit'|'story'|'template';proposedId:string;databaseConflictStatus:'not-checked'}[];
  exhibits:ExhibitPreparation[]; stories:StoryPreparation[]; media:MediaPreparation[];
  gates:{websiteNonCommercialConfirmed:true; competitionDistribution:'open-license-basis-recorded; submission-conditions-pending'; humanTeaching:'pending'; roleOwners:'pending'; formalPublication:'none'; gContent:'open'};
};
const storyMetadata: Record<string,{template:string;sourceUrls:string[]}> = {
  'S-C01':{template:'T-C01',sourceUrls:['https://www.ihchina.cn/ccr_detail/2757.html']},
  'S-C02':{template:'T-C02',sourceUrls:['https://www.ihchina.cn/ccr_detail/2619.html','https://www.ihchina.cn/Article/Index/detail?id=20180']},
  'S-C03':{template:'T-C03',sourceUrls:['https://www.ihchina.cn/art/detail/id/2676.html','https://www.ihchina.cn/project_details/20157.html']},
};
const hash = (value:Buffer|string):string => createHash('sha256').update(value).digest('hex');
const same = (actual:unknown,expected:unknown,message:string):void => { if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(message); };
const requireText = (value:string,label:string):void => { if(typeof value!=='string'||!value.trim()) throw new Error(`${label}不得为空`); };

/** The released snapshot is canonical. Historical draft HTML and old intake evidence are not regeneration inputs. */
export function buildPreparation(root:string):Preparation {
  return JSON.parse(readFileSync(join(root,CONTENT_SNAPSHOT),'utf8')) as Preparation;
}

export function validatePreparation(p:Preparation):void {
  if(p.schemaVersion!==1) throw new Error('内容快照schema版本不符');
  requireText(p.status,'内容状态');
  same(p.generatedFrom,[CONTENT_SNAPSHOT],'版本化内容来源路径不符');
  const mapped=new Set<string>(), ids=new Set<string>();
  for(const m of p.mappings){
    IdSchema.parse(m.proposedId);
    if(mapped.has(m.candidate)) throw new Error(`重复候选映射 ${m.candidate}`);
    if(ids.has(m.proposedId)) throw new Error(`重复拟定ID ${m.proposedId}`);
    mapped.add(m.candidate); ids.add(m.proposedId);
    const expectedKind=m.candidate.startsWith('E-')?'exhibit':m.candidate.startsWith('S-')?'story':'template';
    if(m.kind!==expectedKind||m.databaseConflictStatus!=='not-checked') throw new Error(`${m.candidate}: 拟定映射状态不符`);
  }
  same(p.mappings.map(m=>`${m.candidate}:${m.proposedId}`).sort(),Object.entries(STABLE_IDS).map(([candidate,id])=>`${candidate}:${id}`).sort(),'18项候选映射不完整或与版本化快照不符');
  if(p.exhibits.some(v=>ARCHIVED_EXHIBITS.includes(v.candidate as typeof ARCHIVED_EXHIBITS[number]))||p.media.some(v=>ARCHIVED_EXHIBITS.includes(v.candidate as typeof ARCHIVED_EXHIBITS[number]))) throw new Error('归档展品混入当前集合');
  same(p.exhibits.map(v=>v.candidate),CURRENT_EXHIBITS,'当前展品集合不符');
  same(p.stories.map(v=>v.candidate),CURRENT_STORIES,'当前故事集合不符');
  for(const e of p.exhibits){
    ExhibitSchema.shape.id.parse(e.proposedId); ExhibitSchema.shape.title.parse(e.title); ExhibitSchema.shape.category.parse(e.category); ExhibitSchema.shape.tags.parse(e.tags); ExhibitSchema.shape.summary.parse(e.summary); ExhibitSchema.shape.description.parse(e.description); ExhibitSchema.shape.sources.parse(e.sources); ExhibitSchema.shape.storyIds.parse(e.storyIds); ExhibitSchema.shape.templateIds.parse(e.templateIds); ExhibitSchema.shape.dateLabel.parse(e.dateLabel); ExhibitSchema.shape.region.parse(e.region); ExhibitSchema.shape.creator.parse(e.creator); ExhibitSchema.shape.meaning.parse(e.meaning);
    requireText(e.alt,`${e.candidate}: alt`); requireText(e.caption,`${e.candidate}: 图注`); requireText(e.sourceNote,`${e.candidate}: 来源说明`); requireText(e.decisionStatus,`${e.candidate}: 审阅边界`);
    if(e.proposedId!==STABLE_IDS[e.candidate]) throw new Error(`${e.candidate}: 拟定ID不符`);
    if(e.bindings.mediaId.candidate!==e.candidate||e.bindings.mediaId.status!=='pending-admin-upload') throw new Error(`${e.candidate}: 展品媒体绑定不符`);
    if(e.bindings.craftId.status!=='pending-total-controller-confirmation') throw new Error(`${e.candidate}: 工艺绑定门禁不符`);
    if(e.storyIds.length||e.templateIds.length) throw new Error(`${e.candidate}: 未批准关联不得存在`);
    if(e.publishGate!=='not-approved') throw new Error(`${e.candidate}: 展品发布门禁不符`);
  }
  for(const s of p.stories){
    StorySchema.shape.id.parse(s.proposedId); StorySchema.shape.title.parse(s.title); StorySchema.shape.personName.parse(s.personName); StorySchema.shape.personBio.parse(s.personBio); StorySchema.shape.region.parse(s.region); StorySchema.shape.summary.parse(s.summary); StorySchema.shape.body.parse(s.body); StorySchema.shape.sources.parse(s.sources); StorySchema.shape.exhibitIds.parse(s.exhibitIds);
    if(s.proposedId!==STABLE_IDS[s.candidate]) throw new Error(`${s.candidate}: 拟定ID不符`);
    if(s.exhibitIds.length) throw new Error(`${s.candidate}: exhibitIds必须为空`);
    if(s.body.length<3) throw new Error(`${s.candidate}: 完整故事段落不足`);
    if(s.bindings.coverMediaId.candidate!==s.candidate||s.bindings.coverMediaId.status!=='pending-admin-upload') throw new Error(`${s.candidate}: 故事封面绑定不符`);
    if(s.bindings.craftIds.status!=='pending-total-controller-confirmation'||s.bindings.templateId.status!=='pending-controlled-template-intake'||s.bindings.templateId.candidate!==storyMetadata[s.candidate]?.template) throw new Error(`${s.candidate}: 故事工艺或模板绑定门禁不符`);
    if(s.publishGate!=='not-approved') throw new Error(`${s.candidate}: 故事发布门禁不符`);
    same(s.sources.map(source=>source.url).sort(),storyMetadata[s.candidate]!.sourceUrls.slice().sort(),`${s.candidate}: 故事来源集合不完整`);
  }
  same(p.media.map(({candidate,role})=>`${candidate}:${role}`),[...CURRENT_EXHIBITS.map(candidate=>`${candidate}:exhibit-primary`),...CURRENT_STORIES.map(candidate=>`${candidate}:story-cover`)],'媒体精确集合不符');
  const mediaCandidates=new Set<string>();
  for(const m of p.media){
    if(mediaCandidates.has(m.candidate)) throw new Error(`重复媒体候选 ${m.candidate}`); mediaCandidates.add(m.candidate);
    for(const [value,label] of [[m.originalFile,'原件路径'],[m.uploadFile,'上传件路径'],[m.source,'来源'],[m.license,'许可说明'],[m.attribution,'署名'],[m.modification,'修改说明'],[m.rightsStatus,'权利状态'],[m.distributionGate,'分发门禁']]) requireText(value!,`${m.candidate}: ${label}`);
    if(!/^[a-f0-9]{64}$/u.test(m.originalSha256)||!/^[a-f0-9]{64}$/u.test(m.uploadSha256)) throw new Error(`${m.candidate}: hash格式错误`);
    if(!['png','jpeg','webp'].includes(m.format)||!Number.isSafeInteger(m.width)||!Number.isSafeInteger(m.height)||m.width<1||m.height<1||m.width>6000||m.height>6000) throw new Error(`${m.candidate}: 媒体格式或尺寸不符`);
    if(m.mediaId.status!=='pending-admin-upload') throw new Error(`${m.candidate}: mediaId门禁不符`);
    const replacement=['E-R17','E-R18','E-R19'].includes(m.candidate);
    const expectedRights=m.role==='story-cover'?'project-generated; user-delegated-project-and-competition-use; no-exclusive-ownership-claim':replacement?'open-license-documented; AI-delegated-review; human-signature-pending':'documented-candidate; human-approval-pending';
    const expectedDistribution=m.role==='story-cover'?'project-and-competition-package-use-disclosed':replacement?'website-thumbnail-and-competition-copy-distribution-under-stated-license':'attribution-and-license-display-pending';
    if(m.rightsStatus!==expectedRights||m.distributionGate!==expectedDistribution) throw new Error(`${m.candidate}: 媒体权利或分发门禁不符`);
  }
  if(p.gates.websiteNonCommercialConfirmed!==true||p.gates.competitionDistribution!=='open-license-basis-recorded; submission-conditions-pending'||p.gates.humanTeaching!=='pending'||p.gates.roleOwners!=='pending'||p.gates.formalPublication!=='none'||p.gates.gContent!=='open') throw new Error('阶段门禁被错误改变');
}

/** Cross-check the snapshot against a separately maintained manifest and actual source bytes. */
export function assertFileHashes(root:string,p:Preparation):void {
  const manifest=JSON.parse(readFileSync(join(root,'docs/content/assets/m14-3c/manifest.json'),'utf8')) as Manifest;
  same(manifest.files.map(item=>item.candidate),CURRENT_EXHIBITS,'manifest当前展品精确集合不符');
  const workKeys=manifest.files.map(item=>item.workKey);
  assert(workKeys.every(Boolean)&&new Set(workKeys).size===12,'12件独立作品workKey不完整或重复');
  const versionManifest=JSON.parse(readFileSync(join(root,'content/v1-initial-2026-10-22/manifest.json'),'utf8')) as {schemaVersion:number;contentSet:string;contentInput:string;counts:Record<string,number>;normalStartupSeedsContent:boolean;overwriteNonEmptyDatabase:boolean};
  assert.equal(versionManifest.schemaVersion,1); assert.equal(versionManifest.contentSet,'v1-initial-2026-10-22'); assert.equal(versionManifest.contentInput,CONTENT_SNAPSHOT);
  assert.deepEqual(versionManifest.counts,{crafts:1,templates:3,exhibits:12,stories:3,media:15}); assert.equal(versionManifest.normalStartupSeedsContent,false); assert.equal(versionManifest.overwriteNonEmptyDatabase,false);
  const assets=new Map(manifest.files.map(item=>[item.candidate,item]));
  const derivatives=new Map(manifest.derivation.files.map(item=>[item.candidate,item]));
  for(const m of p.media){
    for(const [file,expected,label] of [[m.originalFile,m.originalSha256,'原件'],[m.uploadFile,m.uploadSha256,'上传件']]){
      const physical=realpathSync(resolve(root,file!)); const pathFromRoot=relative(realpathSync(root),physical);
      if(pathFromRoot==='..'||pathFromRoot.startsWith(`..${sep}`)||isAbsolute(pathFromRoot)) throw new Error(`${m.candidate}: 媒体路径越出项目`);
      if(hash(readFileSync(physical))!==expected) throw new Error(`${m.candidate}: ${label}hash错误`);
    }
    const derivative=derivatives.get(m.candidate);
    if(m.role==='exhibit-primary'){
      const asset=assets.get(m.candidate); assert(asset,`${m.candidate}: 缺少独立manifest记录`);
      assert.equal(m.originalFile,`docs/content/assets/m14-3c/${asset.file}`); assert.equal(m.uploadFile,`docs/content/assets/m14-3c/${asset.uploadFile}`);
      assert.equal(m.originalSha256,asset.sha256); assert.equal(m.uploadSha256,derivative?.sha256??asset.sha256);
      assert.equal(m.source,asset.filePage); assert.equal(m.sourceUrl,asset.sourcePage); assert.equal(m.license,asset.license); assert.equal(m.attribution,asset.credit);
      const exhibit=p.exhibits.find(item=>item.candidate===m.candidate)!;
      assert(exhibit.sources.some(source=>source.url===asset.sourcePage),`${m.candidate}: 展品来源与具体原件页不符`);
    }else{
      assert(derivative,`${m.candidate}: 缺少项目封面派生记录`);
      assert.equal(m.originalFile,`docs/content/assets/m14-3c/${derivative.derivedFrom}`); assert.equal(m.uploadFile,`docs/content/assets/m14-3c/${derivative.file}`);
      assert.equal(m.originalSha256,derivative.sourceSha256); assert.equal(m.uploadSha256,derivative.sha256); assert.equal(m.source,'docs/content/template-teaching.md');
    }
    if(derivative){ assert.equal(m.width,derivative.width); assert.equal(m.height,derivative.height); assert.equal(m.format,derivative.format.toLowerCase()); }
    else { const asset=assets.get(m.candidate)!; assert.equal(m.width,asset.width); assert.equal(m.height,asset.height); assert.equal(m.format,asset.format.toLowerCase()); }
  }
}
