/** M14-4 automated candidate-site intake. Candidate-environment technical review, never formal approval. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFileHashes, buildPreparation, validatePreparation, type Preparation } from './content-intake-core';

type ObjectValue = Record<string, unknown>;
type Session = { cookie: string; csrf: string };
type Server = { child: ChildProcessWithoutNullStreams; url: string; output: string[]; logPath: string };
const root = resolve('.');
const evidence = resolve(process.argv[2] ?? 'docs/qa/evidence/m14-4-candidate-site-20261021');
if (existsSync(evidence)) throw new Error(`Evidence directory exists: ${evidence}`);
mkdirSync(evidence, { recursive: true });
const batch = `m14-4-${new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const isolatedRoot = join(tmpdir(), batch);
const databasePath = join(isolatedRoot, 'content.sqlite');
const mediaRoot = join(isolatedRoot, 'media');
const backupRoot = join(isolatedRoot, 'backups');
const logsRoot = join(isolatedRoot, 'logs');
const mappingRoot = join(isolatedRoot, 'mapping');
for (const path of [isolatedRoot, mediaRoot, backupRoot, logsRoot, mappingRoot]) mkdirSync(path, { recursive: true });

const preparation = JSON.parse(readFileSync(resolve('docs/content/intake/m14-3f-preparation.json'), 'utf8')) as Preparation;
assert.deepEqual(preparation, buildPreparation(root));
validatePreparation(preparation);
assertFileHashes(root, preparation);
const manifest = JSON.parse(readFileSync(resolve('docs/content/assets/m14-3c/manifest.json'), 'utf8')) as { files: { candidate: string; imageAuthorClaim: string; licenseUrl?: string }[] };
const manifestByCandidate = new Map(manifest.files.map(item => [item.candidate, item]));
const entry = resolve('apps/api/dist/server.js');
const cli = resolve('apps/api/dist/admin/maintenance.js');
if (!existsSync(entry) || !existsSync(cli)) throw new Error('Run pnpm build first');
const origin = 'http://127.0.0.1:5198';
const env = { ...process.env, CONTENT_DATABASE_PATH: databasePath, ADMIN_MEDIA_ROOT: mediaRoot, ADMIN_BACKUP_ROOT: backupRoot,
  ADMIN_ENABLED: '1', ADMIN_ORIGIN: origin, ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '0' };
const accounts = [`m14-4-editor-a-${batch.slice(-8)}`, `m14-4-editor-b-${batch.slice(-8)}`, `m14-4-editor-c-${batch.slice(-8)}`, `m14-4-admin-a-${batch.slice(-8)}`, `m14-4-admin-b-${batch.slice(-8)}`, `m14-4-admin-probe-${batch.slice(-8)}`];
const passwords = accounts.map(() => randomBytes(32).toString('base64url'));
const requireFromApi = createRequire(resolve('apps/api/package.json'));
const sharp = requireFromApi('sharp') as ((input: Buffer | { create: ObjectValue }) => { png(): { toBuffer(): Promise<Buffer> }; metadata(): Promise<{ format?: string; width?: number; height?: number }> });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function maintenance(args: string[], input?: string): void {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.status !== 0) throw new Error(`Maintenance failed: ${args[0]} ${args.at(-1) ?? ''}`);
}
function createAccount(index: number, role: 'editor' | 'admin'): void {
  maintenance(['create-account', databasePath, accounts[index]!, role], `${passwords[index]}\n${passwords[index]}\n`);
}
function disableAccount(account: string): void { maintenance(['disable-account', databasePath, account]); }

const initialized = spawnSync(process.execPath, ['--import', 'tsx', resolve('tests/m14/prepare-candidate-site.ts'), databasePath], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (initialized.status !== 0) throw new Error(`Candidate initialization failed: ${initialized.stderr}`);
for (const category of [...new Set(preparation.exhibits.map(item => item.category))]) maintenance(['add-category', databasePath, category]);
for (const tag of [...new Set(preparation.exhibits.flatMap(item => item.tags))]) maintenance(['add-tag', databasePath, tag]);
createAccount(0, 'editor'); createAccount(1, 'editor'); createAccount(2, 'editor'); createAccount(3, 'admin'); createAccount(4, 'admin'); createAccount(5, 'admin');

const wrapper = join(isolatedRoot, 'server-entry.mjs');
writeFileSync(wrapper, `import { startServer } from ${JSON.stringify(pathToFileURL(entry).href)};\nconst app=await startServer();\nprocess.stdin.resume();\nprocess.stdin.once('end',()=>void app.close().then(()=>process.exit(0)));\n`);
async function start(run: number): Promise<Server> {
  const output: string[] = []; const logPath = join(logsRoot, `api-run-${run}.log`);
  const child = spawn(process.execPath, [wrapper], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const url = await new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('API startup timeout')); }, 20000);
    const consume = (prefix: string) => (chunk: Buffer) => { output.push(prefix + chunk.toString()); const match = /API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output.join('')); if (match) { clearTimeout(timer); accept(match[1]!); } };
    child.stdout.on('data', consume('stdout: ')); child.stderr.on('data', consume('stderr: ')); child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited during startup (${String(code)})`)); });
  });
  return { child, url, output, logPath };
}
async function close(server: Server): Promise<void> {
  const done = new Promise<void>((accept, reject) => { const timer = setTimeout(() => { server.child.kill(); reject(new Error('API graceful close timeout')); }, 20000); server.child.once('exit', code => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`API close ${String(code)}`)); }); });
  server.child.stdin.end(); await done; writeFileSync(server.logPath, server.output.join(''));
}
async function body(response: Response): Promise<ObjectValue> { const value: unknown = await response.json(); assert(value && typeof value === 'object' && !Array.isArray(value)); return value as ObjectValue; }
function value(envelope: ObjectValue): ObjectValue { assert.equal(envelope.ok, true); assert(envelope.value && typeof envelope.value === 'object' && !Array.isArray(envelope.value)); return envelope.value as ObjectValue; }
async function login(url: string, index: number): Promise<Session> {
  const challenge = await fetch(`${url}/api/v1/admin/csrf`, { headers: { origin } }); assert.equal(challenge.status, 200);
  const challengeValue = value(await body(challenge)); const cookie = challenge.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const response = await fetch(`${url}/api/v1/admin/session`, { method: 'POST', headers: { origin, cookie, 'x-csrf-token': String(challengeValue.csrfToken), 'content-type': 'application/json' }, body: JSON.stringify({ username: accounts[index], password: passwords[index] }) });
  assert.equal(response.status, 200); const sessionValue = value(await body(response));
  return { cookie: response.headers.getSetCookie().map(v => v.split(';')[0]).join('; '), csrf: String(sessionValue.csrfToken) };
}
async function api(url: string, path: string, method = 'GET', session?: Session, requestBody?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = {};
  if (session) { h.cookie = session.cookie; if (!['GET', 'HEAD'].includes(method)) { h.origin = origin; h['x-csrf-token'] = session.csrf; } }
  Object.assign(h, headers);
  if (requestBody !== undefined && !Buffer.isBuffer(requestBody)) h['content-type'] = 'application/json';
  return fetch(url + path, { method, headers: h, ...(requestBody === undefined ? {} : { body: Buffer.isBuffer(requestBody) ? new Uint8Array(requestBody) : JSON.stringify(requestBody) }) });
}
async function evidenceCard(candidate: string, source: string, license: string): Promise<Buffer> {
  const esc = (text: string) => text.replace(/[&<>]/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="100%" height="100%" fill="#fffaf0"/><text x="60" y="90" font-size="38" font-family="sans-serif">M14-4 候选环境公开依据记录</text><text x="60" y="160" font-size="30" font-family="sans-serif">${esc(candidate)}</text><text x="60" y="225" font-size="20" font-family="sans-serif">来源：${esc(source).slice(0, 110)}</text><text x="60" y="285" font-size="20" font-family="sans-serif">依据：${esc(license).slice(0, 110)}</text><text x="60" y="360" font-size="22" font-family="sans-serif">仅记录公开页面或项目生成来源；不是私人授权书、法务签字或正式发布批准。</text><text x="60" y="420" font-size="22" font-family="sans-serif">自动化技术审核只验证候选站点流程，比赛再分发另行核对。</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  let active: Server | undefined; let stopped = 0; let cleanupAttempted = false; const disableFailures: string[] = []; const urls: string[] = [];
  const mediaResults: ObjectValue[] = []; const contentResults: ObjectValue[] = []; const negativeChecks: ObjectValue[] = [];
  try {
    active = await start(1); urls.push(active.url);
    const editors = [await login(active.url, 0), await login(active.url, 1), await login(active.url, 2)]; const admins = [await login(active.url, 3), await login(active.url, 4), await login(active.url, 5)];
    const unauth = await api(active.url, '/api/v1/admin/contents', 'POST', undefined, { kind: 'exhibit', draft: {}, expectedLatest: null }, { origin, 'x-csrf-token': 'bad' }); assert.equal(unauth.status, 401); negativeChecks.push({ case: 'unauthenticated-write', status: 401 });
    const wrongCsrf = await api(active.url, '/api/v1/admin/contents', 'POST', editors[0], { kind: 'exhibit', draft: {}, expectedLatest: null }, { 'x-csrf-token': 'bad' }); assert.equal(wrongCsrf.status, 403); negativeChecks.push({ case: 'wrong-csrf', status: 403 });

    for (let index = 0; index < preparation.media.length; index++) {
      const item = preparation.media[index]!; const editor = editors[index % 3]!; const bytes = readFileSync(resolve(item.uploadFile)); assert.equal(sha256(bytes), item.uploadSha256);
      const decoded = await sharp(bytes).metadata(); const uploaded = await api(active.url, '/api/v1/admin/media', 'POST', editor, bytes, { 'content-type': 'application/octet-stream' }); assert.equal(uploaded.status, 201, `${item.candidate} upload`);
      const uploadValue = value(await body(uploaded)); const id = String(uploadValue.id); let revision = Number(uploadValue.revision);
      const exhibit = preparation.exhibits.find(entry => entry.candidate === item.candidate); const story = preparation.stories.find(entry => entry.candidate === item.candidate); const manifestItem = manifestByCandidate.get(item.candidate);
      const alt = exhibit?.alt ?? `${story?.personName ?? item.candidate}故事的项目编辑封面；非人物肖像或人物作品`;
      const author = manifestItem?.imageAuthorClaim ?? '《手上中国》项目编辑封面（AI辅助设计与整理）';
      const licensePayload: ObjectValue = { expectedRevision: revision, alt, author, source: item.sourceUrl ?? item.source, licenseType: item.license, usageScope: 'site-display-and-thumbnail', attribution: item.attribution, modification: item.modification, kind: ['E-R13', 'E-R14'].includes(item.candidate) ? 'photograph' : 'illustration' };
      if (manifestItem?.licenseUrl?.startsWith('http')) licensePayload.licenseUrl = manifestItem.licenseUrl;
      const licensed = await api(active.url, `/api/v1/admin/media/${id}/license`, 'PATCH', editor, licensePayload); assert.equal(licensed.status, 200, `${item.candidate} license`); revision = Number(value(await body(licensed)).revision);
      const proof = await evidenceCard(item.candidate, String(item.sourceUrl ?? item.source), item.license);
      const proved = await api(active.url, `/api/v1/admin/media/${id}/proof`, 'PUT', editor, proof, { 'content-type': 'application/octet-stream' }); assert.equal(proved.status, 200, `${item.candidate} proof record`); revision = Number(value(await body(proved)).revision);
      const reviewed = await api(active.url, `/api/v1/admin/media/${id}/review`, 'POST', admins[index % 2], { expectedRevision: revision, decision: 'approved', reason: '候选环境技术审核：按公开页面或项目生成记录核对网站展示范围；不是私人授权书、法务签字或正式批准，赛事再分发另核', verifiedScope: 'site-display-and-thumbnail' });
      assert.equal(reviewed.status, 200, `${item.candidate} media review`); revision = Number(value(await body(reviewed)).revision);
      mediaResults.push({ candidate: item.candidate, proposedContentId: preparation.mappings.find(m => m.candidate === item.candidate)?.proposedId, actualMediaId: id, revision, state: 'approved', inputFile: item.uploadFile, inputSha256: item.uploadSha256, inputFormat: decoded.format, inputWidth: decoded.width, inputHeight: decoded.height, license: item.license, distributionGate: item.distributionGate, evidenceNature: 'public-record-or-project-origin-card; not private authorization' });
    }

    const templateByStory: Record<string, string> = { 'S-C01': 'template-dev-c01', 'S-C02': 'template-dev-c02', 'S-C03': 'template-dev-c03' };
    const inputs: { candidate: string; kind: 'exhibit' | 'story'; proposedId: string; mediaId: string; draft: ObjectValue }[] = [];
    for (const exhibit of preparation.exhibits) { const mediaId = String(mediaResults.find(m => m.candidate === exhibit.candidate)!.actualMediaId); inputs.push({ candidate: exhibit.candidate, kind: 'exhibit', proposedId: exhibit.proposedId, mediaId, draft: { title: exhibit.title, craftId: 'craft-papercut', category: exhibit.category, tags: exhibit.tags, summary: exhibit.summary, description: exhibit.description, sources: exhibit.sources, storyIds: [], templateIds: [], dateLabel: exhibit.dateLabel, region: exhibit.region, creator: exhibit.creator, meaning: exhibit.meaning, sortOrder: exhibit.sortOrder, developmentOnly: true, mediaIds: [mediaId] } }); }
    for (const story of preparation.stories) { const mediaId = String(mediaResults.find(m => m.candidate === story.candidate)!.actualMediaId); inputs.push({ candidate: story.candidate, kind: 'story', proposedId: story.proposedId, mediaId, draft: { title: story.title, personName: story.personName, personBio: story.personBio, region: story.region, summary: story.summary, body: story.body, timeline: story.timeline, sources: story.sources, craftIds: ['craft-papercut'], templateId: templateByStory[story.candidate], exhibitIds: [], sortOrder: story.sortOrder, developmentOnly: true, mediaIds: [mediaId] } }); }
    for (let index = 0; index < inputs.length; index++) {
      const item = inputs[index]!; const editor = editors[index % 3]!;
      const created = await api(active.url, '/api/v1/admin/contents', 'POST', editor, { kind: item.kind, draft: item.draft, expectedLatest: null }); assert.equal(created.status, 201, `${item.candidate} create`); const createdValue = value(await body(created)); const id = String(createdValue.id); assert.notEqual(id, item.proposedId);
      const submitted = await api(active.url, `/api/v1/admin/contents/${item.kind}/${id}/submit`, 'POST', editor, { revision: 1, expectedLatest: 1 }); assert.equal(submitted.status, 200, `${item.candidate} submit`);
      const reviewEvidence: ObjectValue = { sources: '候选环境自动化技术核对：准备包逐项来源已带入；不等于真人编辑、法务或正式发布批准' };
      if (item.kind === 'story') { reviewEvidence.identity = '人物身份按故事来源表逐项带入；本次只验证数据与页面，不冒充真人身份核验签字'; reviewEvidence.quotations = '正文未写无来源第一人称访谈；逐段引用保留SRC编号，真人编辑仍待审'; }
      const admin = admins[index % 2]!; const reviewed = await api(active.url, `/api/v1/admin/contents/${item.kind}/${id}/review`, 'POST', admin, { revision: 1, expectedLatest: 1, decision: 'approved', evidence: reviewEvidence }); assert.equal(reviewed.status, 200, `${item.candidate} review`); const reviewId = String(value(await body(reviewed)).reviewId);
      const published = await api(active.url, `/api/v1/admin/contents/${item.kind}/${id}/publish`, 'POST', admin, { revision: 1, expectedLatest: 1, expectedPublic: null, reviewId }, { 'idempotency-key': randomUUID() }); assert.equal(published.status, 200, `${item.candidate} publish`);
      const publicPath = `/api/v1/${item.kind === 'exhibit' ? 'exhibits' : 'stories'}/${id}`; const publicRead: Response = await fetch(active.url + publicPath); assert.equal(publicRead.status, 200); const publicText = await publicRead.text(); assert(!/proofRef|content\.sqlite|password|csrf|tokenDigest/iu.test(publicText));
      contentResults.push({ candidate: item.candidate, kind: item.kind, proposedId: item.proposedId, actualContentId: id, actualMediaId: item.mediaId, revision: 1, publicRevision: 1, state: 'published', storyExhibitIds: item.kind === 'story' ? [] : undefined });
    }
    assert.equal(value(await body(await fetch(`${active.url}/api/v1/exhibits?pageSize=50`))).total, 12);
    assert.equal(value(await body(await fetch(`${active.url}/api/v1/stories?pageSize=50`))).total, 3);
    assert.equal(value(await body(await fetch(`${active.url}/api/v1/templates?pageSize=50&craftId=craft-papercut`))).total, 3);

    // Extra isolated records prove immediate unpublish and media-revoke visibility without altering the 12+3 candidate set.
    const probeBytes = readFileSync(resolve(preparation.media.find(m => m.candidate === 'S-C01')!.uploadFile));
    const probeAdmin = admins[2]!; const probeUpload = await api(active.url, '/api/v1/admin/media', 'POST', probeAdmin, probeBytes, { 'content-type': 'application/octet-stream' }); assert.equal(probeUpload.status, 201); const probeMediaId = String(value(await body(probeUpload)).id);
    let probeRevision = 1; const probeLicense = await api(active.url, `/api/v1/admin/media/${probeMediaId}/license`, 'PATCH', probeAdmin, { expectedRevision: probeRevision, alt: '自动化撤权探针图', author: '项目自动化测试', source: 'M14-4隔离探针', licenseType: '仅隔离技术测试', usageScope: 'site-display-and-thumbnail', attribution: '自动化测试，不计候选内容', kind: 'illustration' }); assert.equal(probeLicense.status, 200); probeRevision = Number(value(await body(probeLicense)).revision);
    const probeProof = await evidenceCard('M14-4-PROBE', '隔离自动化测试', '仅隔离技术测试'); const probeProofResponse = await api(active.url, `/api/v1/admin/media/${probeMediaId}/proof`, 'PUT', probeAdmin, probeProof, { 'content-type': 'application/octet-stream' }); assert.equal(probeProofResponse.status, 200); probeRevision = Number(value(await body(probeProofResponse)).revision);
    const probeMediaReview = await api(active.url, `/api/v1/admin/media/${probeMediaId}/review`, 'POST', probeAdmin, { expectedRevision: probeRevision, decision: 'approved', reason: '仅用于候选环境撤权探针', verifiedScope: 'site-display-and-thumbnail' }); assert.equal(probeMediaReview.status, 200); probeRevision = Number(value(await body(probeMediaReview)).revision);
    const probeIds: string[] = [];
    for (const n of [1, 2]) { const draft = { title: `M14-4自动化可见性探针${n}`, craftId: 'craft-papercut', category: preparation.exhibits[0]!.category, tags: preparation.exhibits[0]!.tags, summary: '不计入候选集合', description: '用于验证下架和媒体撤权立即影响公开读取。', sources: preparation.exhibits[0]!.sources, storyIds: [], templateIds: [], dateLabel: '2026-10-21', region: '隔离测试', creator: '自动化技术测试', meaning: '无', sortOrder: 999 + n, developmentOnly: true, mediaIds: [probeMediaId] }; const created = await api(active.url, '/api/v1/admin/contents', 'POST', editors[1], { kind: 'exhibit', draft, expectedLatest: null }); assert.equal(created.status, 201); const id = String(value(await body(created)).id); probeIds.push(id); assert.equal((await api(active.url, `/api/v1/admin/contents/exhibit/${id}/submit`, 'POST', editors[1], { revision: 1, expectedLatest: 1 })).status, 200); const reviewed = await api(active.url, `/api/v1/admin/contents/exhibit/${id}/review`, 'POST', probeAdmin, { revision: 1, expectedLatest: 1, decision: 'approved', evidence: { sources: '隔离自动化探针' } }); const reviewId = String(value(await body(reviewed)).reviewId); assert.equal((await api(active.url, `/api/v1/admin/contents/exhibit/${id}/publish`, 'POST', probeAdmin, { revision: 1, expectedLatest: 1, expectedPublic: null, reviewId }, { 'idempotency-key': randomUUID() })).status, 200); }
    assert.equal((await api(active.url, `/api/v1/admin/contents/exhibit/${probeIds[0]}/unpublish`, 'POST', probeAdmin, { expectedLatest: 1, expectedPublic: 1, reason: 'M14-4隔离下架立即失效验证' }, { 'idempotency-key': randomUUID() })).status, 200); assert.equal((await fetch(`${active.url}/api/v1/exhibits/${probeIds[0]}`)).status, 404);
    const revoked = await api(active.url, `/api/v1/admin/media/${probeMediaId}/revoke`, 'POST', probeAdmin, { expectedRevision: probeRevision, reason: 'M14-4隔离撤权立即失效验证' }, { 'idempotency-key': randomUUID() }); assert.equal(revoked.status, 200); assert.equal((await fetch(`${active.url}/api/v1/exhibits/${probeIds[1]}`)).status, 404); assert.equal((await fetch(`${active.url}/api/v1/media/${probeMediaId}/original`)).status, 404);

    const firstRunSessions = [...editors, ...admins];
    for (const session of firstRunSessions) { assert.equal((await api(active.url, '/api/v1/admin/session', 'DELETE', session)).status, 204); assert.equal((await api(active.url, '/api/v1/admin/session', 'GET', session)).status, 401); }
    await close(active); active = undefined; stopped++;
    active = await start(2); urls.push(active.url);
    for (const session of firstRunSessions) assert.equal((await api(active.url, '/api/v1/admin/session', 'GET', session)).status, 401);
    const afterRestart = await login(active.url, 3);
    const exhibits = value(await body(await fetch(`${active.url}/api/v1/exhibits?pageSize=50`))); const stories = value(await body(await fetch(`${active.url}/api/v1/stories?pageSize=50`))); const templates = value(await body(await fetch(`${active.url}/api/v1/templates?pageSize=50&craftId=craft-papercut`)));
    assert.equal(exhibits.total, 12); assert.equal(stories.total, 3); assert.equal(templates.total, 3);
    for (const item of mediaResults) { const response: Response = await fetch(`${active.url}/api/v1/media/${String(item.actualMediaId)}/original`); assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); const decoded = await sharp(bytes).metadata(); assert.equal(decoded.format, 'png'); }
    for (const path of ['/content.sqlite', '/media/', '/logs/']) assert.equal((await fetch(active.url + path)).status, 404);
    const logout = await api(active.url, '/api/v1/admin/session', 'DELETE', afterRestart); assert.equal(logout.status, 204);
    await close(active); active = undefined; stopped++;
    cleanupAttempted = true;
    for (const account of accounts) { try { disableAccount(account); } catch { disableFailures.push(account); } }
    assert.equal(disableFailures.length, 1, 'The existing last-admin safety rule should leave exactly one isolated admin enabled');
    active = await start(3); urls.push(active.url); assert.equal((await api(active.url, '/api/v1/admin/contents', 'GET', afterRestart)).status, 401); await close(active); active = undefined; stopped++;

    const mapping = { batch, notice: '自动化隔离候选站技术验证，非人工内容批准或正式发布', isolatedRoot, databasePath, mediaRoot, backupRoot, logsRoot, mappingRoot, proposedIdsAreNotDatabaseIds: true, media: mediaResults, contents: contentResults };
    const report = { batch, notice: mapping.notice, createdAt: new Date().toISOString(), isolatedRoot, urls, results: { mainUploads: 15, probeUploads: 1, candidateExhibitsPublished: 12, candidateStoriesPublished: 3, candidateTemplatesPublished: 3, mainMediaApproved: mediaResults.length, restart: { exhibits: 12, stories: 3, templates: 3, mediaDecoded: 15 }, unpublishProbe404: true, revokeProbeContent404: true, revokeProbeMedia404: true, negativeChecks, firstRunSessionsLoggedOut: firstRunSessions.length, firstRunSessionsRejectedAfterRestart: firstRunSessions.length, stopped, accountsDisabled: accounts.length - disableFailures.length, enabledIsolatedAdmins: disableFailures.length, lastAdminSafetyLimitation: disableFailures, oldSessionAfterDisable: 401 }, gates: { formalProductionPublication: 0, candidateEnvironmentOnly: true, humanEditorialApproval: 'pending', humanTeaching: 'pending', competitionDistribution: 'pending', gContent: 'open', m14: 'incomplete' } };
    writeFileSync(join(mappingRoot, 'candidate-site-mapping.json'), JSON.stringify(mapping, null, 2)); writeFileSync(join(evidence, 'candidate-site-mapping.json'), JSON.stringify(mapping, null, 2)); writeFileSync(join(evidence, 'run-report.json'), JSON.stringify(report, null, 2)); writeFileSync(join(evidence, 'README.md'), `# M14-4 候选整站隔离证据\n\n自动化隔离候选站技术验证，非人工内容批准或正式发布。\n\n- 隔离目录：\`${isolatedRoot}\`\n- 主媒体：15；额外撤权探针媒体：1。\n- 候选公开：12展品、3故事、3模板；生产公开：0。\n- 后台返回ID与建议稳定ID分别记录。\n- 三次正常停服；${accounts.length - disableFailures.length}个自动化账号已停用。现有维护入口的最后管理员保护使1个隔离管理员无法停用；其随机密码未落盘，服务已停止。\n`);
    console.log(JSON.stringify({ evidence, isolatedRoot, exhibits: 12, stories: 3, templates: 3, media: 15, stopped, disabledAccounts: accounts.length - disableFailures.length, enabledIsolatedAdmins: disableFailures.length }));
  } finally {
    if (active) await close(active).catch(() => active?.child.kill());
    if (!cleanupAttempted) for (const account of accounts) { try { disableAccount(account); } catch { /* last-admin rule or earlier setup failure */ } }
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
