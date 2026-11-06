import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { assertFileHashes, buildPreparation, validatePreparation, type Preparation } from './content-intake-core';

type JsonObject = Record<string, unknown>;
type Session = { cookie:string; csrf:string; account:string };
type RunningServer = { child:ChildProcessWithoutNullStreams; url:string; output:string[]; logPath:string };
type MediaResult = {
  candidate:string; suggestedContentId:string; actualMediaId:string; revision:number; state:string;
  inputFile:string; inputSha256:string; inputBytes:number; inputFormat:string; inputWidth:number; inputHeight:number;
  storedObject:string; storedOriginalSha256:string; storedThumbnailSha256:string; storedOriginalBytes:number;
  storedThumbnailBytes:number; storedOriginalFormat:string; storedOriginalWidth:number; storedOriginalHeight:number;
  storedThumbnailFormat:string; storedThumbnailWidth:number; storedThumbnailHeight:number;
  licenseRegistration:'recorded-site-scope'|'skipped-rights-pending'; expectedAlt:string|null; expectedAttribution:string;
};
type ContentResult = {
  candidate:string; kind:'exhibit'|'story'; suggestedId:string; actualId:string; mediaId:string; revision:number;
  state:string; publicRevision:null; mediaBinding:'verified'|'verified-with-pending-license-placeholders';
};

const projectRoot=resolve('.');
const evidenceDirectory=resolve(process.argv[2]??'docs/qa/evidence/m14-3g-20261021-automation');
if(existsSync(evidenceDirectory)) throw new Error(`Evidence directory already exists: ${evidenceDirectory}`);
mkdirSync(evidenceDirectory,{recursive:true});

const batch=`m14-3g-${new Date().toISOString().replace(/[-:.TZ]/gu,'').slice(0,14)}-${randomUUID().slice(0,8)}`;
const isolatedRoot=join(tmpdir(),batch);
const databasePath=join(isolatedRoot,'content.sqlite');
const mediaRoot=join(isolatedRoot,'media');
const backupRoot=join(isolatedRoot,'backups');
const logsRoot=join(isolatedRoot,'logs');
const mappingRoot=join(isolatedRoot,'mapping');
for(const path of [isolatedRoot,mediaRoot,backupRoot,logsRoot,mappingRoot]) mkdirSync(path,{recursive:true});

const preparationPath=resolve('docs/content/intake/m14-3f-preparation.json');
const preparation=JSON.parse(readFileSync(preparationPath,'utf8')) as Preparation;
assert.deepEqual(preparation,buildPreparation(projectRoot),'M14-3F准备包必须与受托输入一致');
validatePreparation(preparation);
assertFileHashes(projectRoot,preparation);

const manifest=JSON.parse(readFileSync(resolve('docs/content/assets/m14-3c/manifest.json'),'utf8')) as {files:{candidate:string;imageAuthorClaim:string}[]};
const imageAuthors=new Map(manifest.files.map(file=>[file.candidate,file.imageAuthorClaim]));
const entry=resolve('apps/api/dist/server.js');
const cli=resolve('apps/api/dist/admin/maintenance.js');
if(!existsSync(entry)||!existsSync(cli)) throw new Error('Run pnpm build before the M14-3G intake runner');

const accounts=[`m14-3g-automation-a-${batch.slice(-8)}`,`m14-3g-automation-b-${batch.slice(-8)}`];
const passwords=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
const origin='http://127.0.0.1:5197';
const env={...process.env,CONTENT_DATABASE_PATH:databasePath,ADMIN_MEDIA_ROOT:mediaRoot,ADMIN_BACKUP_ROOT:backupRoot,
  ADMIN_ENABLED:'1',ADMIN_ORIGIN:origin,ADMIN_SECURITY_MODE:'loopback-http',HOST:'127.0.0.1',PORT:'0'};
const sha256=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
const requireFromApi=createRequire(resolve('apps/api/package.json'));
const sharp=requireFromApi('sharp') as (bytes:Buffer)=>{metadata():Promise<{format?:string;width?:number;height?:number}>};

function runMaintenance(command:'create-account'|'disable-account',account:string,password?:string):void{
  const result=spawnSync(process.execPath,[cli,command,databasePath,account,...(command==='create-account'?['editor']:[])],{
    input:password===undefined?undefined:`${password}\n${password}\n`,encoding:'utf8',windowsHide:true,timeout:30000,
  });
  if(result.status!==0) throw new Error(`Maintenance ${command} failed for isolated automation account`);
}

for(let i=0;i<accounts.length;i++) runMaintenance('create-account',accounts[i]!,passwords[i]);

const wrapper=join(isolatedRoot,'server-entry.mjs');
writeFileSync(wrapper,`import { startServer } from ${JSON.stringify(pathToFileURL(entry).href)};\nconst app=await startServer();\nprocess.stdin.resume();\nprocess.stdin.once('end',()=>void app.close().then(()=>process.exit(0)));\n`);

async function startServer(run:number):Promise<RunningServer>{
  const output:string[]=[];
  const logPath=join(logsRoot,`api-run-${run}.log`);
  const child=spawn(process.execPath,[wrapper],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const url=await new Promise<string>((accept,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Normal built API startup timeout'));},20000);
    const consume=(prefix:string)=>(chunk:Buffer)=>{const text=chunk.toString();output.push(`${prefix}${text}`);const match=/API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output.join(''));if(match){clearTimeout(timer);accept(match[1]!);}};
    child.stdout.on('data',consume('stdout: ')); child.stderr.on('data',consume('stderr: '));
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Normal built API exited during startup (${String(code)})`));});
  });
  return {child,url,output,logPath};
}

async function closeServer(server:RunningServer):Promise<void>{
  const closed=new Promise<void>((accept,reject)=>{const timer=setTimeout(()=>{server.child.kill();reject(new Error('Normal built API graceful close timeout'));},20000);server.child.once('exit',code=>{clearTimeout(timer);code===0?accept():reject(new Error(`Normal built API close failed (${String(code)})`));});});
  server.child.stdin.end(); await closed; writeFileSync(server.logPath,server.output.join(''));
}

async function json(response:Response):Promise<JsonObject>{
  const value:unknown=await response.json();
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Expected JSON object response');
  return value as JsonObject;
}
function envelopeValue(body:JsonObject):JsonObject{
  assert.equal(body.ok,true); assert(body.value&&typeof body.value==='object'&&!Array.isArray(body.value)); return body.value as JsonObject;
}
async function login(url:string,index:number):Promise<Session>{
  const challenge=await fetch(`${url}/api/v1/admin/csrf`,{headers:{origin}}); assert.equal(challenge.status,200);
  const challengeValue=envelopeValue(await json(challenge));
  const cookie=challenge.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const response=await fetch(`${url}/api/v1/admin/session`,{method:'POST',headers:{origin,cookie,'x-csrf-token':String(challengeValue.csrfToken),'content-type':'application/json'},body:JSON.stringify({username:accounts[index],password:passwords[index]})});
  assert.equal(response.status,200); const value=envelopeValue(await json(response));
  return {cookie:response.headers.getSetCookie().map(item=>item.split(';')[0]).join('; '),csrf:String(value.csrfToken),account:accounts[index]!};
}
async function api(url:string,path:string,method:string,session?:Session,body?:unknown,headers:Record<string,string>={}):Promise<Response>{
  const requestHeaders:Record<string,string>={};
  if(session){requestHeaders.cookie=session.cookie;if(method!=='GET'&&method!=='HEAD'){requestHeaders.origin=origin;requestHeaders['x-csrf-token']=session.csrf;}}
  Object.assign(requestHeaders,headers);
  if(body!==undefined&&!Buffer.isBuffer(body)) requestHeaders['content-type']='application/json';
  return fetch(url+path,{method,headers:requestHeaders,...(body===undefined?{}:{body:Buffer.isBuffer(body)?new Uint8Array(body):JSON.stringify(body)})});
}
function newObjectDirectory(before:Set<string>):string{
  const after=readdirSync(mediaRoot).filter(name=>!name.startsWith('.'));
  const additions=after.filter(name=>!before.has(name)); assert.equal(additions.length,1,'Each upload must create exactly one private object'); return additions[0]!;
}
function publicSummary(value:unknown):JsonObject{
  assert(value&&typeof value==='object'&&!Array.isArray(value)); return value as JsonObject;
}

async function main():Promise<void>{
 const mediaResults:MediaResult[]=[];
 const contentResults:ContentResult[]=[];
 const publicChecks:{path:string;status:number}[]=[];
 const authenticationChecks:{case:string;status:number}[]=[];
 const restartChecks:{contents:number;media:number;drafts:number;stagedMedia:number}[]=[];
 const serverUrls:string[]=[];
 let activeServer:RunningServer|undefined;
 let gracefulStops=0;
 let logoutStatus=0;
 let disabledSessionStatus=0;
 let accountsDisabled=false;
 let revisionEvidence:JsonObject={};

 try{
  activeServer=await startServer(1);
  serverUrls.push(activeServer.url);
  assert.equal((await fetch(`${activeServer.url}/health`)).status,200);
  assert.equal((await fetch(`${activeServer.url}/ready`)).status,200);
  const unauthenticatedWrite=await api(activeServer.url,'/api/v1/admin/contents','POST',undefined,{kind:'exhibit',draft:{title:'不得保存'},expectedLatest:null},{origin,'x-csrf-token':'invalid'});
  authenticationChecks.push({case:'unauthenticated-write',status:unauthenticatedWrite.status}); assert.equal(unauthenticatedWrite.status,401);
  const sessions=[await login(activeServer.url,0),await login(activeServer.url,1)];
  const wrongCsrf=await api(activeServer.url,'/api/v1/admin/contents','POST',sessions[0],{kind:'exhibit',draft:{title:'不得保存'},expectedLatest:null},{'x-csrf-token':'invalid'});
  authenticationChecks.push({case:'wrong-csrf',status:wrongCsrf.status}); assert.equal(wrongCsrf.status,403);

  for(let index=0;index<preparation.media.length;index++){
    const media=preparation.media[index]!; const session=sessions[index%2]!; const bytes=readFileSync(resolve(media.uploadFile));
    assert.equal(sha256(bytes),media.uploadSha256,`${media.candidate}: upload input hash changed`);
    const inputMetadata=await sharp(bytes).metadata(); const before=new Set(readdirSync(mediaRoot).filter(name=>!name.startsWith('.')));
    const uploaded=await api(activeServer.url,'/api/v1/admin/media','POST',session,bytes,{'content-type':'application/octet-stream'});
    assert.equal(uploaded.status,201,`${media.candidate}: upload failed`); const uploadedValue=envelopeValue(await json(uploaded));
    const objectKey=newObjectDirectory(before); const originalBytes=readFileSync(join(mediaRoot,objectKey,'original.png')); const thumbnailBytes=readFileSync(join(mediaRoot,objectKey,'thumbnail.png'));
    const originalMetadata=await sharp(originalBytes).metadata(), thumbnailMetadata=await sharp(thumbnailBytes).metadata();
    const exhibit=preparation.exhibits.find(item=>item.candidate===media.candidate);
    const mayRegister=media.role==='exhibit-primary'&&!['E-R09','E-R10'].includes(media.candidate);
    let revision=Number(uploadedValue.revision);
    if(mayRegister){
      assert(exhibit); const author=imageAuthors.get(media.candidate); assert(author);
      const licensed=await api(activeServer.url,`/api/v1/admin/media/${String(uploadedValue.id)}/license`,'PATCH',session,{
        expectedRevision:revision,alt:exhibit.alt,author,source:media.sourceUrl??media.source,licenseType:media.license,
        usageScope:'site-display-and-thumbnail',attribution:media.attribution,kind:['E-R13','E-R14'].includes(media.candidate)?'photograph':'illustration',
      });
      assert.equal(licensed.status,200,`${media.candidate}: license record failed`); revision=Number(envelopeValue(await json(licensed)).revision);
    }
    mediaResults.push({candidate:media.candidate,suggestedContentId:preparation.mappings.find(item=>item.candidate===media.candidate)?.proposedId??'',actualMediaId:String(uploadedValue.id),revision,state:String(uploadedValue.state),
      inputFile:media.uploadFile,inputSha256:media.uploadSha256,inputBytes:bytes.length,inputFormat:String(inputMetadata.format),inputWidth:Number(inputMetadata.width),inputHeight:Number(inputMetadata.height),
      storedObject:objectKey,storedOriginalSha256:sha256(originalBytes),storedThumbnailSha256:sha256(thumbnailBytes),storedOriginalBytes:originalBytes.length,storedThumbnailBytes:thumbnailBytes.length,
      storedOriginalFormat:String(originalMetadata.format),storedOriginalWidth:Number(originalMetadata.width),storedOriginalHeight:Number(originalMetadata.height),storedThumbnailFormat:String(thumbnailMetadata.format),storedThumbnailWidth:Number(thumbnailMetadata.width),storedThumbnailHeight:Number(thumbnailMetadata.height),
      licenseRegistration:mayRegister?'recorded-site-scope':'skipped-rights-pending',expectedAlt:exhibit?.alt??null,expectedAttribution:media.attribution});
  }

  const createInputs:{candidate:string;kind:'exhibit'|'story';suggestedId:string;mediaId:string;draft:JsonObject;pendingLicense:boolean}[]=[];
  for(const exhibit of preparation.exhibits){
    const media=mediaResults.find(item=>item.candidate===exhibit.candidate)!;
    createInputs.push({candidate:exhibit.candidate,kind:'exhibit',suggestedId:exhibit.proposedId,mediaId:media.actualMediaId,pendingLicense:media.licenseRegistration==='skipped-rights-pending',draft:{title:exhibit.title,category:exhibit.category,tags:exhibit.tags,summary:exhibit.summary,description:exhibit.description,sources:exhibit.sources,storyIds:[],templateIds:[],dateLabel:exhibit.dateLabel,region:exhibit.region,creator:exhibit.creator,meaning:exhibit.meaning,sortOrder:exhibit.sortOrder,developmentOnly:true,mediaIds:[media.actualMediaId]}});
  }
  for(const story of preparation.stories){
    const media=mediaResults.find(item=>item.candidate===story.candidate)!;
    createInputs.push({candidate:story.candidate,kind:'story',suggestedId:story.proposedId,mediaId:media.actualMediaId,pendingLicense:true,draft:{title:story.title,personName:story.personName,personBio:story.personBio,region:story.region,summary:story.summary,body:story.body,timeline:story.timeline,sources:story.sources,exhibitIds:[],sortOrder:story.sortOrder,developmentOnly:true,mediaIds:[media.actualMediaId]}});
  }
  for(let index=0;index<createInputs.length;index++){
    const input=createInputs[index]!,session=sessions[index%2]!;
    const created=await api(activeServer.url,'/api/v1/admin/contents','POST',session,{kind:input.kind,draft:input.draft,expectedLatest:null});
    assert.equal(created.status,201,`${input.candidate}: draft create failed`); const value=envelopeValue(await json(created));
    assert.notEqual(String(value.id),input.suggestedId,`${input.candidate}: server ID must not be forced to suggested ID`);
    const actualId=String(value.id); const read=await api(activeServer.url,`/api/v1/admin/contents/${input.kind}/${actualId}`,'GET',session); assert.equal(read.status,200);
    const readValue=envelopeValue(await json(read)); const storedDraft=publicSummary(readValue.draft);
    assert.equal(storedDraft.title,input.draft.title); assert.equal(JSON.stringify(storedDraft.sources),JSON.stringify(input.draft.sources));
    if(input.kind==='story') assert.deepEqual(storedDraft.exhibitIds,[]);
    const attached=input.kind==='exhibit'?(storedDraft.media as unknown[]):[storedDraft.cover]; assert.equal(attached.length,1); const attachedMedia=publicSummary(attached[0]); assert.equal(attachedMedia.id,input.mediaId);
    if(!input.pendingLicense){const expectedMedia=mediaResults.find(item=>item.candidate===input.candidate)!;assert.equal(attachedMedia.alt,expectedMedia.expectedAlt);assert.equal(publicSummary(attachedMedia.license).attribution,expectedMedia.expectedAttribution);}
    const preview=await api(activeServer.url,`/api/v1/admin/contents/${input.kind}/${actualId}/preview?revision=1`,'GET',session); assert.equal(preview.status,200);
    contentResults.push({candidate:input.candidate,kind:input.kind,suggestedId:input.suggestedId,actualId,mediaId:input.mediaId,revision:Number(value.revision),state:String(value.state),publicRevision:null,mediaBinding:input.pendingLicense?'verified-with-pending-license-placeholders':'verified'});
  }

  const revisedInput=createInputs[0]!,revisedContent=contentResults[0]!;
  const revisedDraft={...revisedInput.draft,summary:`${String(revisedInput.draft.summary)}【自动化隔离修订验证】`};
  const revised=await api(activeServer.url,`/api/v1/admin/contents/exhibit/${revisedContent.actualId}/revisions`,'POST',sessions[0],{draft:revisedDraft,expectedLatest:1});
  assert.equal(revised.status,201); const revisedValue=envelopeValue(await json(revised)); assert.equal(revisedValue.revision,2);
  const oldRevision=envelopeValue(await json(await api(activeServer.url,`/api/v1/admin/contents/exhibit/${revisedContent.actualId}?revision=1`,'GET',sessions[0])));
  const latestRevision=envelopeValue(await json(await api(activeServer.url,`/api/v1/admin/contents/exhibit/${revisedContent.actualId}?revision=2`,'GET',sessions[0])));
  assert.equal(publicSummary(oldRevision.draft).summary,revisedInput.draft.summary); assert.equal(publicSummary(latestRevision.draft).summary,revisedDraft.summary);
  const stale=await api(activeServer.url,`/api/v1/admin/contents/exhibit/${revisedContent.actualId}/revisions`,'POST',sessions[0],{draft:revisedInput.draft,expectedLatest:1}); assert.equal(stale.status,409);
  const history=envelopeValue(await json(await api(activeServer.url,`/api/v1/admin/contents/exhibit/${revisedContent.actualId}/history?pageSize=50`,'GET',sessions[0])));
  assert.equal(history.total,2); revisionEvidence={candidate:revisedInput.candidate,actualId:revisedContent.actualId,oldRevision:1,newRevision:2,oldSummaryPreserved:true,staleExpectedLatestStatus:stale.status,historyTotal:history.total};

  await closeServer(activeServer); activeServer=undefined; gracefulStops++;
  activeServer=await startServer(2);
  serverUrls.push(activeServer.url);
  const readSession=await login(activeServer.url,0),disableProbeSession=await login(activeServer.url,1);
  const contentsValue=envelopeValue(await json(await api(activeServer.url,'/api/v1/admin/contents?pageSize=50','GET',readSession)));
  const mediaValue=envelopeValue(await json(await api(activeServer.url,'/api/v1/admin/media?pageSize=50','GET',readSession)));
  const contentItems=contentsValue.items as unknown[],mediaItems=mediaValue.items as unknown[];
  assert.equal(contentsValue.total,15); assert.equal(mediaValue.total,15);
  assert.equal(contentItems.every(item=>publicSummary(item).state==='draft'),true); assert.equal(mediaItems.every(item=>publicSummary(item).state==='staged'),true);
  for(const content of contentResults){const read=await api(activeServer.url,`/api/v1/admin/contents/${content.kind}/${content.actualId}`,'GET',readSession);assert.equal(read.status,200);}
  restartChecks.push({contents:Number(contentsValue.total),media:Number(mediaValue.total),drafts:contentItems.filter(item=>publicSummary(item).state==='draft').length,stagedMedia:mediaItems.filter(item=>publicSummary(item).state==='staged').length});

  for(const content of contentResults){const path=`/api/v1/${content.kind==='exhibit'?'exhibits':'stories'}/${content.actualId}`;const response:Response=await fetch(activeServer.url+path);publicChecks.push({path,status:response.status});assert.equal(response.status,404);}
  for(const media of mediaResults){const path=`/api/v1/media/${media.actualMediaId}/original`;const response:Response=await fetch(activeServer.url+path);publicChecks.push({path,status:response.status});assert.equal(response.status,404);}
  for(const path of ['/api/v1/exhibits?pageSize=50','/api/v1/stories?pageSize=50']){const response:Response=await fetch(activeServer.url+path);assert.equal(response.status,200);const value=envelopeValue(await json(response));assert.equal(value.total,0);publicChecks.push({path,status:response.status});}
  for(const path of ['/content.sqlite','/media/','/logs/']){const response:Response=await fetch(activeServer.url+path);publicChecks.push({path,status:response.status});assert.equal(response.status,404);}

  const logout=await api(activeServer.url,'/api/v1/admin/session','DELETE',readSession); logoutStatus=logout.status; assert.equal(logoutStatus,204);
  assert.equal((await api(activeServer.url,'/api/v1/admin/contents','GET',readSession)).status,401);
  await closeServer(activeServer); activeServer=undefined; gracefulStops++;
  for(const account of accounts) runMaintenance('disable-account',account);
  accountsDisabled=true;
  activeServer=await startServer(3);
  serverUrls.push(activeServer.url);
  disabledSessionStatus=(await api(activeServer.url,'/api/v1/admin/contents','GET',disableProbeSession)).status; assert.equal(disabledSessionStatus,401);
  assert.equal((await fetch(`${activeServer.url}/api/v1/exhibits?pageSize=50`)).status,200);
  await closeServer(activeServer); activeServer=undefined; gracefulStops++;

  const mapping={batch,notice:'自动化隔离技术验证，非人工内容批准',isolatedRoot,databasePath,mediaRoot,backupRoot,logsRoot,mappingRoot,
    suggestedIdsAreNotDatabaseIds:true,serverGeneratedIds:true,media:mediaResults,contents:contentResults,revisionEvidence};
  const report={batch,notice:'自动化隔离技术验证，非人工内容批准',createdAt:new Date().toISOString(),isolatedRoot,
    environment:{databasePath,mediaRoot,backupRoot,logsRoot,mappingRoot,host:'127.0.0.1',portMode:'ephemeral',serverUrls,securityMode:'loopback-http',normalBuiltServer:true,automationAccounts:2,passwordsOrTokensPersisted:false},
    preflight:{m14PreparationValidated:true,inputHashesValidated:true,currentExhibits:preparation.exhibits.map(item=>item.candidate),stories:preparation.stories.map(item=>item.candidate),archivedExcluded:['E-R11','E-R12']},
    results:{uploadsSucceeded:mediaResults.length,stagedMedia:mediaResults.filter(item=>item.state==='staged').length,licenseRecordsCreated:mediaResults.filter(item=>item.licenseRegistration==='recorded-site-scope').length,
      licenseRecordsSkippedPendingRights:mediaResults.filter(item=>item.licenseRegistration==='skipped-rights-pending').length,draftsCreated:contentResults.length,mediaBindingsVerified:contentResults.length,
      serverGeneratedIdsDifferentFromSuggestions:contentResults.every(item=>item.actualId!==item.suggestedId),restartChecks,publicChecks,authenticationChecks,revisionEvidence,logoutStatus,accountsDisabled,disabledSessionStatus,gracefulStops},
    gates:{mediaApproval:'not-called',contentSubmit:'not-called',contentReview:'not-called',contentPublish:'not-called',formalPublication:0,gContent:'open',humanTeaching:'pending',roleOwners:'automation-only; real owners pending',competitionDistribution:'pending',rightsPending:['E-R09','E-R10','S-C01 cover','S-C02 cover','S-C03 cover']}};
  writeFileSync(join(mappingRoot,'content-media-mapping.json'),JSON.stringify(mapping,null,2));
  writeFileSync(join(evidenceDirectory,'content-media-mapping.json'),JSON.stringify(mapping,null,2));
  writeFileSync(join(evidenceDirectory,'run-report.json'),JSON.stringify(report,null,2));
  writeFileSync(join(evidenceDirectory,'README.md'),`# M14-3G 隔离后台草稿录入证据\n\n自动化隔离技术验证，非人工内容批准。\n\n- 批次：${batch}\n- 隔离目录：\`${isolatedRoot}\`\n- 上传：${mediaResults.length}/15，全部 staged\n- 草稿：${contentResults.length}/15，全部 draft\n- 绑定：${contentResults.length}/15\n- 正式发布：0\n- 服务：已三次正常关闭；测试账号已通过维护CLI停用；停用前旧会话重启后返回401。\n- 详细映射和哈希见 \`content-media-mapping.json\`；机器结果见 \`run-report.json\`。\n`);
  console.log(JSON.stringify({evidenceDirectory,isolatedRoot,uploads:mediaResults.length,drafts:contentResults.length,bindings:contentResults.length,gracefulStops,disabledSessionStatus}));
 }finally{
   if(activeServer){await closeServer(activeServer).catch(()=>{activeServer?.child.kill();});}
   if(!accountsDisabled){for(const account of accounts){try{runMaintenance('disable-account',account);}catch{console.error(`Failed to disable isolated automation account ${account}`);}}}
 }
}

void main().catch(error=>{console.error(error);process.exitCode=1;});
