/** Explicit V1 delivery initializer. It never runs during normal service startup. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ContentDatabase } from '../../apps/api/src/database';
import { OFFICIAL_ADDITIVE_TEMPLATES } from '../../apps/api/src/content/official-templates';
import { V1_CONTENT_SET_NAME, storyTemplateIds, v1Craft, v1Templates } from './v1-content-set';
import { inspectInitializedState, type InitializationMapping } from './initialization-state';

type RecordValue = Record<string, unknown>;
type Session = { cookie: string; csrf: string };
type Preparation = {
  exhibits: Array<RecordValue & { candidate: string; proposedId: string; category: string; tags: string[]; sources: unknown[] }>;
  stories: Array<RecordValue & { candidate: string; proposedId: string; sources: unknown[] }>;
  media: Array<RecordValue & { candidate: string; originalFile: string; originalSha256: string; uploadFile: string; uploadSha256: string; source: string; sourceUrl?: string; license: string; attribution: string; modification: string }>;
};
type RunningServer = { child: ChildProcessWithoutNullStreams; url: string; output: string[] };

const projectRoot = resolve('.');
const rootIndex = process.argv.indexOf('--root');
const rootArgument = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
if (!rootArgument || !isAbsolute(rootArgument)) throw new Error('Usage: pnpm content:initialize -- --root <project-external-absolute-directory>');
const targetRoot = resolve(rootArgument);
const fromProject = relative(projectRoot, targetRoot);
if (fromProject === '' || (!fromProject.startsWith(`..${sep}`) && fromProject !== '..')) throw new Error('The content root must be outside the project directory');
let existingParent = targetRoot;
while (!existsSync(existingParent)) existingParent = dirname(existingParent);
const physicalTarget = resolve(realpathSync(existingParent), relative(existingParent, targetRoot));
const fromPhysicalProject = relative(realpathSync(projectRoot), physicalTarget);
if (fromPhysicalProject === '' || (!fromPhysicalProject.startsWith(`..${sep}`) && fromPhysicalProject !== '..')) throw new Error('The content root must physically be outside the project directory');
if (existsSync(targetRoot) && lstatSync(targetRoot).isSymbolicLink()) throw new Error('The content root must not be a symbolic link');

const databasePath = resolve(targetRoot, 'content.sqlite');
const mediaRoot = resolve(targetRoot, 'media');
const backupRoot = resolve(targetRoot, 'backups');
const receiptPath = resolve(targetRoot, 'v1-initialization.json');
const failurePath = resolve(targetRoot, 'v1-initialization.failed.json');
const lockPath = resolve(targetRoot, '.v1-initializer.lock');
const serverEntry = resolve(projectRoot, 'apps/api/dist/server.js');
const maintenanceEntry = resolve(projectRoot, 'apps/api/dist/admin/maintenance.js');
const inputPath = resolve(projectRoot, `content/${V1_CONTENT_SET_NAME}/records.json`);
const mediaManifestPath = resolve(projectRoot, 'docs/content/assets/m14-3c/manifest.json');

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function json(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')) as unknown; }
function asRecord(value: unknown): RecordValue { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as RecordValue; }
function envelopeValue(value: unknown): RecordValue { const record = asRecord(value); assert.equal(record.ok, true); return asRecord(record.value); }

function verifyCompletedReceipt(): void {
  const receipt = asRecord(json(receiptPath));
  if (receipt.schemaVersion !== 2 || receipt.status !== 'complete' || receipt.contentSet !== V1_CONTENT_SET_NAME) throw new Error('Existing initialization receipt is not a completed matching V1 set');
  assert.equal(receipt.inputFingerprint, inputFingerprint(), 'Versioned content input has changed; existing data was preserved');
  assert(Array.isArray(receipt.mappings), 'Missing completed ID mappings');
  const state = inspectInitializedState(databasePath, mediaRoot, receipt.mappings as InitializationMapping[]);
  assert.equal(state.fingerprint, receipt.stateFingerprint, 'Initialized data has changed; existing revisions were preserved');
  process.stdout.write(`${JSON.stringify({ ok: true, unchanged: true, contentSet: V1_CONTENT_SET_NAME, root: targetRoot }, null, 2)}\n`);
}
function inputFingerprint(): string {
  const inputs = asRecord(json(inputPath)) as unknown as Preparation;
  const mediaHashes = inputs.media.map(item => ({ candidate: item.candidate, hash: sha256(readFileSync(resolve(projectRoot, item.uploadFile))), originalHash: sha256(readFileSync(resolve(projectRoot, item.originalFile))) }));
  return sha256(Buffer.from(JSON.stringify({ records: sha256(readFileSync(inputPath)), mediaManifest: sha256(readFileSync(mediaManifestPath)), mediaHashes, craft: v1Craft, templates: v1Templates })));
}

if (existsSync(receiptPath)) { verifyCompletedReceipt(); process.exit(0); }
if (existsSync(databasePath) || existsSync(failurePath)) throw new Error(`Refusing an existing or incomplete content root: ${targetRoot}. Preserve it for diagnosis and choose a new empty root.`);
if (existsSync(targetRoot) && readdirSync(targetRoot).length) throw new Error(`Content root must be empty: ${targetRoot}`);
if (!existsSync(serverEntry) || !existsSync(maintenanceEntry)) throw new Error('Run pnpm build before content initialization');

// Finish read-only preflight before claiming a new private directory. A bad source cannot leave a partial database.
const preparation = asRecord(json(inputPath)) as unknown as Preparation;
assert.equal(preparation.exhibits.length, 12); assert.equal(preparation.stories.length, 3); assert.equal(preparation.media.length, 15);
const mediaManifest = asRecord(json(mediaManifestPath));
const manifestFiles = mediaManifest.files as Array<RecordValue & { candidate: string }>;
const derivationFiles = asRecord(mediaManifest.derivation).files as Array<RecordValue & { candidate: string }>;
const manifestByCandidate = new Map([...derivationFiles, ...manifestFiles].map(item => [item.candidate, item]));
const contentCandidates = [...preparation.exhibits, ...preparation.stories].map(item => item.candidate).sort();
assert.equal(new Set(contentCandidates).size, 15, 'Content candidates must be unique');
assert.deepEqual(preparation.media.map(item => item.candidate).sort(), contentCandidates, 'Every content candidate must have exactly one media mapping');
for (const item of preparation.media) {
  assert(manifestByCandidate.has(item.candidate), `Missing media manifest candidate: ${item.candidate}`);
  for (const [file, expectedHash] of [[item.uploadFile, item.uploadSha256], [item.originalFile, item.originalSha256]]) {
    assert(file && expectedHash, `${item.candidate} missing media path/hash`);
    const uploadPath = resolve(projectRoot, file);
    const relativeUpload = relative(projectRoot, realpathSync(uploadPath));
    assert(relativeUpload !== '..' && !relativeUpload.startsWith(`..${sep}`) && !isAbsolute(relativeUpload), 'Media source must remain inside the delivered project');
    assert.equal(sha256(readFileSync(uploadPath)), expectedHash, `${item.candidate} media hash`);
  }
}
for (const story of preparation.stories) assert(storyTemplateIds[story.candidate], `Missing template mapping: ${story.candidate}`);
const expectedInputFingerprint = inputFingerprint();

const accounts = ['editor-a', 'editor-b', 'editor-c', 'admin-a', 'admin-b'].map(label => `v1-init-${label}-${randomUUID().slice(0, 8)}`);
const passwords = accounts.map(() => randomBytes(32).toString('base64url'));
const origin = 'http://127.0.0.1:5198';
const env = { ...process.env, CONTENT_DATABASE_PATH: databasePath, ADMIN_MEDIA_ROOT: mediaRoot, ADMIN_BACKUP_ROOT: backupRoot,
  ADMIN_ENABLED: '1', ADMIN_ORIGIN: origin, ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '0' };
const requireFromApi = createRequire(resolve(projectRoot, 'apps/api/package.json'));
const sharp = requireFromApi('sharp') as ((input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } });
const wrapperPath = resolve(targetRoot, '.v1-initializer-server.mjs');
let active: RunningServer | undefined;
const sessions: Session[] = [];
const mappings: InitializationMapping[] = [];
let claimedRoot = false;

function maintenance(args: string[], input?: string): void {
  const result = spawnSync(process.execPath, [maintenanceEntry, ...args], { cwd: projectRoot, input, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (result.status !== 0) throw new Error(`Maintenance ${args[0]} failed: ${result.stderr || result.stdout}`);
}
function createAccount(index: number, role: 'editor' | 'admin'): void {
  maintenance(['create-account', databasePath, accounts[index]!, role], `${passwords[index]}\n${passwords[index]}\n`);
}
async function startServer(): Promise<RunningServer> {
  writeFileSync(wrapperPath, `import { startServer } from ${JSON.stringify(pathToFileURL(serverEntry).href)};\nconst app=await startServer();\nprocess.stdin.resume();\nprocess.stdin.once('end',()=>void app.close().then(()=>process.exit(0)));\n`);
  const child = spawn(process.execPath, [wrapperPath], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const output: string[] = [];
  let url: string;
  try { url = await new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('API startup timeout')); }, 30000);
    const consume = (chunk: Buffer) => { output.push(chunk.toString()); const match = /API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output.join('')); if (match) { clearTimeout(timer); accept(match[1]!); } };
    child.stdout.on('data', consume); child.stderr.on('data', consume); child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited during startup (${String(code)})`)); });
  }); } catch (error) {
    if (child.exitCode === null && child.signalCode === null) { const stopped = new Promise<void>(accept => child.once('exit', () => accept())); child.kill(); await stopped; }
    throw error;
  }
  return { child, url, output };
}
async function closeServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null || server.child.signalCode !== null) { assert.equal(server.child.exitCode, 0, 'API exited unexpectedly'); return; }
  const done = new Promise<void>((accept, reject) => { let timedOut = false; const timer = setTimeout(() => { timedOut = true; server.child.kill(); }, 30000); server.child.once('exit', code => { clearTimeout(timer); if (timedOut) reject(new Error('API graceful close timeout; child terminated')); else code === 0 ? accept() : reject(new Error(`API close failed (${String(code)})`)); }); });
  server.child.stdin.end(); await done;
}
async function request(path: string, method = 'GET', session?: Session, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 30000): Promise<Response> {
  assert(active); const requestHeaders: Record<string, string> = { ...headers };
  if (session) { requestHeaders.cookie = session.cookie; if (!['GET', 'HEAD'].includes(method)) { requestHeaders.origin = origin; requestHeaders['x-csrf-token'] = session.csrf; } }
  if (body !== undefined && !Buffer.isBuffer(body)) requestHeaders['content-type'] = 'application/json';
  return fetch(active.url + path, { method, headers: requestHeaders, signal: AbortSignal.timeout(timeoutMs), ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) }) });
}
async function value(response: Response, label: string): Promise<RecordValue> {
  const parsed: unknown = await response.json(); if (!response.ok) throw new Error(`${label} failed (${response.status}): ${JSON.stringify(parsed)}`); return envelopeValue(parsed);
}
async function login(index: number): Promise<Session> {
  const challenge = await request('/api/v1/admin/csrf'); const challengeValue = await value(challenge, 'csrf');
  const challengeCookie = challenge.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  const response = await fetch(`${active!.url}/api/v1/admin/session`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { origin, cookie: challengeCookie, 'x-csrf-token': String(challengeValue.csrfToken), 'content-type': 'application/json' }, body: JSON.stringify({ username: accounts[index], password: passwords[index] }) });
  const sessionValue = await value(response, 'login');
  const session = { cookie: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; '), csrf: String(sessionValue.csrfToken) }; sessions.push(session); return session;
}
async function evidenceCard(candidate: string, source: string, license: string): Promise<Buffer> {
  const escape = (text: string) => text.replace(/[&<>]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="100%" height="100%" fill="#fffaf0"/><text x="60" y="90" font-size="38" font-family="sans-serif">V1公开依据技术记录</text><text x="60" y="160" font-size="30" font-family="sans-serif">${escape(candidate)}</text><text x="60" y="225" font-size="20" font-family="sans-serif">来源：${escape(source).slice(0, 110)}</text><text x="60" y="285" font-size="20" font-family="sans-serif">依据：${escape(license).slice(0, 110)}</text><text x="60" y="360" font-size="22" font-family="sans-serif">公开页面或项目来源的技术记录，不是私人授权书、真人签字或法务批准。</text><text x="60" y="420" font-size="22" font-family="sans-serif">自动化核对不替代比赛再分发许可或人工内容批准。</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
  // Exclusive claim also protects the race where two invocations passed the empty-root preflight together.
  writeFileSync(lockPath, JSON.stringify({ contentSet: V1_CONTENT_SET_NAME, processId: process.pid }), { flag: 'wx', mode: 0o600 }); claimedRoot = true;
  mkdirSync(mediaRoot, { mode: 0o700 }); mkdirSync(backupRoot, { mode: 0o700 });
  const database = new ContentDatabase({ path: databasePath });
  try { assert.equal(database.initializeBaseContent(V1_CONTENT_SET_NAME, { crafts: [v1Craft], templates: v1Templates }), true); }
  finally { database.close(); }
  for (const category of new Set(preparation.exhibits.map(item => item.category))) maintenance(['add-category', databasePath, category]);
  for (const tag of new Set(preparation.exhibits.flatMap(item => item.tags))) maintenance(['add-tag', databasePath, tag]);
  createAccount(0, 'editor'); createAccount(1, 'editor'); createAccount(2, 'editor'); createAccount(3, 'admin'); createAccount(4, 'admin');
  active = await startServer();
  const editors = [await login(0), await login(1), await login(2)]; const admins = [await login(3), await login(4)];
  const mediaIds = new Map<string, string>();
  for (let index = 0; index < preparation.media.length; index++) {
    const item = preparation.media[index]!; const editor = editors[index % editors.length]!; const admin = admins[index % admins.length]!;
    const bytes = readFileSync(resolve(projectRoot, item.uploadFile));
    const uploaded = await value(await request('/api/v1/admin/media', 'POST', editor, bytes, { 'content-type': 'application/octet-stream' }), `${item.candidate} upload`);
    const id = String(uploaded.id); let revision = Number(uploaded.revision); const manifest = manifestByCandidate.get(item.candidate)!;
    const exhibit = preparation.exhibits.find(entry => entry.candidate === item.candidate); const story = preparation.stories.find(entry => entry.candidate === item.candidate);
    const license: RecordValue = { expectedRevision: revision, alt: String(exhibit?.alt ?? `${String(story?.personName ?? item.candidate)}故事的项目编辑封面；非人物肖像或人物作品`),
      author: String(manifest.imageAuthorClaim ?? '《手上中国》项目编辑封面（AI辅助设计与整理）'), source: item.sourceUrl ?? item.source,
      licenseType: item.license, usageScope: 'site-display-and-thumbnail', attribution: item.attribution, modification: item.modification,
      kind: ['E-R13', 'E-R14', 'E-R17', 'E-R18', 'E-R19'].includes(item.candidate) ? 'photograph' : 'illustration' };
    if (typeof manifest.licenseUrl === 'string' && manifest.licenseUrl.startsWith('http')) license.licenseUrl = manifest.licenseUrl;
    revision = Number((await value(await request(`/api/v1/admin/media/${id}/license`, 'PATCH', editor, license), `${item.candidate} license`)).revision);
    const proof = await evidenceCard(item.candidate, String(item.sourceUrl ?? item.source), item.license);
    revision = Number((await value(await request(`/api/v1/admin/media/${id}/proof`, 'PUT', editor, proof, { 'content-type': 'application/octet-stream' }), `${item.candidate} evidence record`)).revision);
    revision = Number((await value(await request(`/api/v1/admin/media/${id}/review`, 'POST', admin, { expectedRevision: revision, decision: 'approved', reason: 'V1初始化自动化技术核对：记录公开页面或项目生成来源，不代表真人编辑、法务批准或比赛再分发许可', verifiedScope: 'site-display-and-thumbnail' }), `${item.candidate} technical review`)).revision);
    mediaIds.set(item.candidate, id); mappings.push({ candidate: item.candidate, mediaId: id, mediaRevision: revision });
  }
  const contentInputs: Array<{ candidate: string; kind: 'exhibit' | 'story'; draft: RecordValue }> = [];
  for (const item of preparation.exhibits) contentInputs.push({ candidate: item.candidate, kind: 'exhibit', draft: { title: item.title, craftId: 'craft-papercut', category: item.category, tags: item.tags, summary: item.summary, description: item.description, sources: item.sources, storyIds: [], templateIds: [], dateLabel: item.dateLabel, region: item.region, creator: item.creator, meaning: item.meaning, sortOrder: item.sortOrder, developmentOnly: false, mediaIds: [mediaIds.get(item.candidate)] } });
  for (const item of preparation.stories) contentInputs.push({ candidate: item.candidate, kind: 'story', draft: { title: item.title, personName: item.personName, personBio: item.personBio, region: item.region, summary: item.summary, body: item.body, timeline: item.timeline, sources: item.sources, craftIds: ['craft-papercut'], templateId: storyTemplateIds[item.candidate], exhibitIds: [], sortOrder: item.sortOrder, developmentOnly: false, mediaIds: [mediaIds.get(item.candidate)] } });
  for (let index = 0; index < contentInputs.length; index++) {
    const item = contentInputs[index]!; const editor = editors[index % editors.length]!; const admin = admins[index % admins.length]!;
    const created = await value(await request('/api/v1/admin/contents', 'POST', editor, { kind: item.kind, draft: item.draft, expectedLatest: null }), `${item.candidate} create`); const id = String(created.id);
    await value(await request(`/api/v1/admin/contents/${item.kind}/${id}/submit`, 'POST', editor, { revision: 1, expectedLatest: 1 }), `${item.candidate} submit`);
    const review = await value(await request(`/api/v1/admin/contents/${item.kind}/${id}/review`, 'POST', admin, { revision: 1, expectedLatest: 1, decision: 'approved', evidence: { sources: 'V1初始化自动化技术核对：来源字段与版本化内容集一致；真人编辑、法务和正式发布批准仍独立进行', ...(item.kind === 'story' ? { identity: '人物身份按公开来源带入，未冒充真人签字', quotations: '未写无来源第一人称采访' } : {}) } }), `${item.candidate} technical review`);
    await value(await request(`/api/v1/admin/contents/${item.kind}/${id}/publish`, 'POST', admin, { revision: 1, expectedLatest: 1, expectedPublic: null, reviewId: review.reviewId }, { 'idempotency-key': randomUUID() }), `${item.candidate} publish`);
    mappings.push({ candidate: item.candidate, kind: item.kind, contentId: id, revision: 1 });
  }
  const exhibitTotal = Number((await value(await request('/api/v1/exhibits?pageSize=50'), 'exhibit count')).total);
  const storyTotal = Number((await value(await request('/api/v1/stories?pageSize=50'), 'story count')).total);
  const templatePage = await value(await request('/api/v1/templates?pageSize=50&craftId=craft-papercut'), 'template count');
  assert(Array.isArray(templatePage.items), 'Public template list must include items');
  const expectedTemplates = [...v1Templates, ...OFFICIAL_ADDITIVE_TEMPLATES.filter(template => template.enabled && template.craftId === 'craft-papercut')];
  assert.equal(Number(templatePage.total), expectedTemplates.length, 'Public template count must include the V1 set and additive templates');
  assert.deepEqual(templatePage.items.map(item => String(asRecord(item).id)).sort(), expectedTemplates.map(template => template.id).sort(), 'Public template identities do not match the V1 set and additive templates');
  assert.deepEqual([exhibitTotal, storyTotal], [12, 3]);
  for (const session of sessions) { const response = await request('/api/v1/admin/session', 'DELETE', session); assert.equal(response.status, 204); }
  await closeServer(active); active = undefined;
  const quarantine = new ContentDatabase({ path: databasePath }); try { quarantine.admin.prepareRestoredDatabase(true); } finally { quarantine.close(); }
  const state = inspectInitializedState(databasePath, mediaRoot, mappings);
  assert.equal(state.enabledAccounts, 0); assert.equal(state.activeSessions, 0);
  assert.equal(inputFingerprint(), expectedInputFingerprint, 'Content inputs changed during initialization');
  writeFileSync(receiptPath, `${JSON.stringify({ schemaVersion: 2, status: 'complete', contentSet: V1_CONTENT_SET_NAME, completedAt: new Date().toISOString(), counts: { templates: 3, exhibits: 12, stories: 3, media: 15 }, reviewBoundary: 'automated-technical-intake-only', inputFingerprint: expectedInputFingerprint, stateFingerprint: state.fingerprint, mappings }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, unchanged: false, root: targetRoot, databasePath, mediaRoot, counts: { templates: 3, exhibits: 12, stories: 3, media: 15 }, accountsEnabled: 0, activeSessions: 0 }, null, 2)}\n`);
}

async function run(): Promise<void> {
  try { await main(); }
  catch (error) {
    const cleanupErrors: string[] = [];
    if (active) {
      for (const session of sessions) { try { assert.equal((await request('/api/v1/admin/session', 'DELETE', session, undefined, {}, 5000)).status, 204); } catch (logoutError) { cleanupErrors.push(`Logout: ${String(logoutError)}`); } }
      try { await closeServer(active); } catch (closeError) { cleanupErrors.push(`Server close: ${String(closeError)}`); }
      active = undefined;
    }
    if (claimedRoot && existsSync(databasePath)) { try { const db = new ContentDatabase({ path: databasePath }); try { db.admin.prepareRestoredDatabase(true); } finally { db.close(); } } catch (quarantineError) { cleanupErrors.push(`Account quarantine: ${String(quarantineError)}`); } }
    if (claimedRoot) writeFileSync(failurePath, `${JSON.stringify({ schemaVersion: 1, status: 'failed', contentSet: V1_CONTENT_SET_NAME, failedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error), cleanupErrors, recovery: 'Preserve this root for diagnosis and retry with a new empty project-external root.' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    throw error;
  } finally {
    if (claimedRoot && existsSync(wrapperPath)) unlinkSync(wrapperPath);
    if (claimedRoot && existsSync(lockPath)) unlinkSync(lockPath);
  }
}
void run().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
