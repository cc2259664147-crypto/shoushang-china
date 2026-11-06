import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..', '..');
const batch = process.argv[2] ?? `v1-initial-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex')}`;
const batchFamily = /^(v1-initial|v1-editor)-[a-z0-9-]+$/u.exec(batch)?.[1];
if (!batchFamily) throw new Error('批次名只能包含小写字母、数字和短横线，并以 v1-initial- 或 v1-editor- 开头');
const editorBatch = batchFamily === 'v1-editor';
// 每个编辑器候选批次必须单独登记发布版本与状态，禁止把某一个候选的版本号套用到所有批次。
const releaseByBatch = new Map([
  ['v1-editor-20261027-rc2', { releaseVersion: '1.1.0-editor-rc2', status: 'candidate' }],
  ['v1-editor-20261027-rc3', { releaseVersion: '1.1.0-editor-rc3', status: 'candidate' }],
  ['v1-editor-20261102-rc4', { releaseVersion: '1.1.0-editor-rc4', status: 'candidate' }],
  ['v1-editor-20261102-rc5', { releaseVersion: '1.1.0-editor-rc5', status: 'candidate' }],
  ['v1-editor-20261102-rc6', { releaseVersion: '1.1.0-editor-rc6', status: 'candidate' }],
  ['v1-editor-20261102-rc7', { releaseVersion: '1.1.0-editor-rc7', status: 'candidate' }],
  ['v1-editor-20261103-rc8', { releaseVersion: '1.1.0-editor-rc8', status: 'candidate' }],
  ['v1-editor-20261103-rc9', { releaseVersion: '1.1.0-editor-rc9', status: 'candidate' }],
  ['v1-editor-20261103-rc10', { releaseVersion: '1.1.0-editor-rc10', status: 'candidate' }],
  ['v1-editor-20261103-rc11', { releaseVersion: '1.1.0-editor-rc11', status: 'candidate' }],
]);
function releaseMetadata() {
  if (!editorBatch) {
    return {
      releaseVersion: '1.0.0-initial', contentSet: 'v1-initial-2026-10-22',
      status: 'v1-initial-candidate', competitionDistributionReady: false, productionReady: false,
    };
  }
  const release = releaseByBatch.get(batch);
  if (!release) throw new Error(`未登记的编辑器候选批次：${batch}；请先在 releaseByBatch 登记它的 releaseVersion 与状态`);
  const tag = batch.slice(batch.lastIndexOf('-') + 1);
  if (!release.releaseVersion.endsWith(`-${tag}`)) {
    throw new Error(`批次 ${batch} 与登记的 releaseVersion ${release.releaseVersion} 标签不一致`);
  }
  return {
    releaseVersion: release.releaseVersion, contentSet: 'v1-initial-2026-10-22',
    status: release.status, released: false, formalRelease: false,
    competitionDistributionReady: false, productionReady: false,
  };
}
const release = releaseMetadata();
const out = resolve(root, 'delivery', batch);
if (existsSync(out)) throw new Error(`拒绝覆盖已有输出：${out}`);
mkdirSync(resolve(root, 'delivery'), { recursive: true });
mkdirSync(out, { recursive: false });

const rootFiles = [
  '.env.example', '.gitattributes', '.gitignore', '.npmrc', 'package.json', 'pnpm-lock.yaml',
  'pnpm-workspace.yaml', 'README.md', 'tsconfig.json', 'vitest.config.ts',
  // v1-initial 保留历史行为；编辑器候选明确不打包 Playwright 配置。
  ...(editorBatch ? [] : ['playwright.config.ts']),
];
const roots = [
  'apps', 'packages', 'fixtures', 'prototypes', 'scripts/check-runtime.mjs',
  'scripts/delivery/verify-package.mjs', 'scripts/delivery/verify-runtime.mjs',
  'scripts/content', 'content/v1-initial-2026-10-22', 'content/v2-additions-2026-10-27',
];
const sharedDocs = [
  'docs/delivery/README.md', 'docs/api/integration.md', 'docs/contracts/data-model.md',
  'docs/contracts/module-api.md', 'docs/architecture/module-boundaries.md',
  'docs/algorithms/papercut-v1.md', 'docs/storage/indexeddb-v1.md',
  'docs/third-party-dependencies.md', 'docs/content/ATTRIBUTION.md',
  'docs/content/content-finalization.md', 'docs/content/media-rights.md',
  'docs/content/fact-sources.md', 'docs/content/template-teaching.md',
  'docs/content/template-validation.md', 'docs/content/assets/m14-3c/manifest.json',
  'docs/content/story-update-20261102.json',
  'docs/content/intake/m14-3f-preparation.json', 'docs/contracts/change-requests.md',
  // M15 正式编辑器运行时按相对路径读取的 profile 注册表。
  ...(editorBatch ? ['docs/qa/m15/editor-profiles-v2.json'] : []),
];
const completeOnly = ['docs/content/exhibits-drafts.md', 'docs/content/stories-drafts.md', 'docs/content/content-acquisition.md'];

const forbiddenParts = new Set(['.git', 'node_modules', '.pnpm-store', '.pnpm-cache', 'dist', 'evidence', 'testing', 'test-results', 'playwright-report']);
const forbiddenExtensions = new Set(['.sqlite', '.sqlite3', '.db', '.wal', '.shm', '.log', '.map']);
const forbiddenNames = [/^\.env$/u, /^\.review-/u, /(?:^|[-_.])(?:credentials?|cookies?|sessions?|tokens?|passwords?|proofs?)(?:[-_.]|$).*\.(?:json|txt|csv|log)$/iu];
const testName = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/u;
// 测试入口/驱动即使被改成普通 .ts 也不得进入交付包。
const testDriverName = /^m15-7[a-z]?\./u;
const testEntryName = /(?:^|[-_.])testing(?:$|[-_.])/u;
const playwrightConfigName = /playwright\.config\./u;
const testOnlyPaths = new Set([
  'apps/web/src/features/workshop/editor/performance.html',
  'apps/web/src/features/workshop/editor/zoom-extension',
  'packages/artwork-renderer/src/browser/verify.ts',
  'scripts/content/local-story-update.ts',
  'prototypes/papercut-verification/verify-browser.mjs',
  'prototypes/ui-preview/verify-browser.mjs',
]);
const requiredEditorFiles = [
  'docs/qa/m15/editor-profiles-v2.json',
  'packages/contracts/src/index.ts', 'packages/papercut-core/src/index.ts',
  'packages/artwork-renderer/src/index.ts', 'packages/artwork-exporter/src/index.ts',
  'packages/local-repository/src/index.ts',
  'apps/web/src/features/workshop/VersionedWorkshopPage.tsx',
  'apps/web/src/features/workshop/editor/FreehandEditor.tsx',
  'apps/web/src/features/workshop/editor/freehand-editor.css',
  'apps/web/src/features/workshop/editor/worker/papercut.worker.ts',
  'apps/web/src/features/workshop/editor/worker/controller.ts',
  'apps/web/vite.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json',
];
const contentRecords = JSON.parse(readFileSync(join(root, 'content/v1-initial-2026-10-22/records.json'), 'utf8'));
const assetManifest = JSON.parse(readFileSync(join(root, 'docs/content/assets/m14-3c/manifest.json'), 'utf8'));
const assetFiles = [...new Set(contentRecords.media.flatMap(item => [item.originalFile, item.uploadFile]))];
const currentCandidates = new Set(assetManifest.files.map(item => item.candidate));
if (assetManifest.files.length !== 12 || contentRecords.exhibits.length !== 12 || contentRecords.stories.length !== 3 || contentRecords.media.length !== 15)
  throw new Error('V1内容集合数量错误');
if (assetManifest.archivedFiles.some(item => currentCandidates.has(item.candidate))) throw new Error('归档素材混入当前集合');
for (const item of contentRecords.media) {
  if (assetManifest.archivedFiles.some(archived => [item.originalFile, item.uploadFile].some(path => basename(path) === archived.file))) throw new Error('禁止打包归档原图');
  for (const [path, expected] of [[item.originalFile, item.originalSha256], [item.uploadFile, item.uploadSha256]]) {
    if (!path.startsWith('docs/content/assets/m14-3c/') || sha(join(root, path)) !== expected) throw new Error(`媒体清单/哈希不符：${path}`);
  }
}

function normalize(path) { return path.split(sep).join('/'); }
function rejectPath(rel) {
  const normalized = normalize(rel);
  if (normalized.startsWith('apps/web/public/story-local-preview/') || normalized.includes('/local-preview')) return true;
  const parts = normalized.split('/');
  const name = basename(normalized);
  if (parts[0] === 'delivery') return true;
  if (parts.some((part) => forbiddenParts.has(part) || part.startsWith('.review-'))) return true;
  if (forbiddenExtensions.has(extname(name).toLowerCase())) return true;
  if (forbiddenNames.some((pattern) => pattern.test(name))) return true;
  if (testName.test(name)) return true;
  if (name.endsWith('.case.ts')) return true;
  if (testDriverName.test(name)) return true;
  if (testEntryName.test(name)) return true;
  if (testOnlyPaths.has(normalized)) return true;
  if (editorBatch && playwrightConfigName.test(name)) return true;
  return false;
}
function assertInside(base, target) {
  const rel = relative(base, target);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !resolve(target).startsWith(`${resolve(base)}${sep}delivery${sep}`))) return;
  throw new Error(`路径逃逸或递归打包：${target}`);
}
function copyEntry(rel, stage) {
  const source = resolve(root, rel);
  if (!existsSync(source)) throw new Error(`允许清单项不存在：${rel}`);
  assertInside(root, source);
  const info = statSync(source);
  if (info.isFile()) {
    if (rejectPath(rel)) throw new Error(`允许清单包含被禁止文件：${rel}`);
    const destination = resolve(stage, rel);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { dereference: false, errorOnExist: true });
    return;
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const child = join(rel, entry.name);
    if (rejectPath(child)) continue;
    if (entry.isSymbolicLink()) throw new Error(`交付输入不得含符号链接：${child}`);
    copyEntry(child, stage);
  }
}
function filesUnder(dir, prefix = '') {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...filesUnder(join(dir, entry.name), rel));
    else if (entry.isFile()) result.push(rel);
    else throw new Error(`暂存区包含非普通文件：${rel}`);
  }
  return result.sort((a, b) => a.localeCompare(b, 'en'));
}
function sha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function isText(path) { return ['.md', '.json', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.txt', '.yml', '.yaml', '.toml', '.xml', '.svg', '.example', ''].includes(extname(path).toLowerCase()); }
function anonymize(stage) {
  const replacements = [
    [/C:\\Users\\mmcn/giu, '<本机用户目录>'],
    [/C:\/Users\/mmcn/giu, '<本机用户目录>'],
    [/\bmmcn\b/giu, '<本机用户>'],
    [/https:\/\/github\.com\/cc2259664147-crypto\/shoushang-china(?:\.git)?/giu, '<私有仓库地址已移除>'],
    [/\bcc2259664147-crypto\b/giu, '<仓库所有者已移除>'],
  ];
  for (const rel of filesUnder(stage)) {
    const path = join(stage, rel);
    if (!isText(path)) continue;
    let text = readFileSync(path, 'utf8');
    for (const [pattern, value] of replacements) text = text.replace(pattern, value);
    writeFileSync(path, text, 'utf8');
  }
}
function scan(stage) {
  const findings = [];
  const patterns = [
    ['windows-user-path', /C:\\Users\\/iu], ['local-user', /\bmmcn\b/iu],
    ['private-repository', /cc2259664147-crypto|github\.com\/[^/\s]+\/shoushang-china/iu],
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['labelled-phone', /(?:电话|手机|phone|mobile)\s*[:：=]\s*1[3-9]\d{9}/iu],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['common-secret', /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})/u],
  ];
  const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const testFrameworkImport = /\bfrom\s+['"](?:vitest|@playwright\/test)['"]|require\(['"](?:vitest|@playwright\/test)['"]\)|requireFromPackage\(['"](?:vitest|@playwright\/test)['"]\)/u;
  for (const rel of filesUnder(stage)) {
    if (rejectPath(rel)) findings.push({ path: rel, rule: 'forbidden-path' });
    const path = join(stage, rel);
    if (!isText(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const [rule, pattern] of patterns) if (pattern.test(text)) findings.push({ path: rel, rule });
    // 编辑器候选还禁止测试框架引用；verify-runtime.mjs 是交付自带的独立运行校验器，允许驱动浏览器。
    if (editorBatch && codeExtensions.has(extname(rel).toLowerCase()) && testFrameworkImport.test(text)
      && normalize(rel) !== 'scripts/delivery/verify-runtime.mjs') findings.push({ path: rel, rule: 'test-framework-import' });
  }
  return findings;
}
// 交付文档的版本说明必须与本批次 release 元数据一致，禁止继续宣称其它批次的版本。
function applyReleaseStatement(stage) {
  if (!editorBatch) return;
  const readmePath = join(stage, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const anchor = '本包是 V1.0 初版候选。';
  if (!readme.includes(anchor)) throw new Error('README.md 缺少候选包版本说明锚点，拒绝生成自相矛盾的版本说明');
  const statement = `本包是 ${release.releaseVersion} 专业剪纸编辑器候选（批次 ${batch}，状态 ${release.status}；非正式发布、非生产就绪）。`;
  writeFileSync(readmePath, readme.replace(anchor, statement), 'utf8');
  const staleLabel = 'V1.0 初版候选';
  const label = `${release.releaseVersion} 专业剪纸编辑器候选`;
  for (const rel of filesUnder(stage)) {
    if (!isText(rel)) continue;
    const path = join(stage, rel);
    const text = readFileSync(path, 'utf8');
    if (text.includes(staleLabel)) writeFileSync(path, text.replaceAll(staleLabel, label), 'utf8');
  }
  const stale = filesUnder(stage).filter((rel) => isText(rel) && readFileSync(join(stage, rel), 'utf8').includes(staleLabel));
  if (stale.length) throw new Error(`候选包版本说明未更新：${JSON.stringify(stale)}`);
}
function tarExecutable() {
  // 本机 PATH 中 Git 的 GNU tar 会把 C:\ 视为主机名；交付压缩固定使用 Windows 自带 bsdtar。
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(systemTar) ? systemTar : 'tar.exe';
}
function writePackage(kind) {
  const stage = join(out, `.stage-${kind}`);
  mkdirSync(stage);
  for (const rel of [...rootFiles, ...roots, ...sharedDocs, ...assetFiles, ...(kind === 'complete' ? completeOnly : [])]) copyEntry(rel, stage);
  // Fresh installations must receive the same reviewed story texts as the website.
  const stagedRecords = join(stage, 'content/v1-initial-2026-10-22/records.json');
  const stagedContent = JSON.parse(readFileSync(stagedRecords, 'utf8'));
  const updatedStories = JSON.parse(readFileSync(join(stage, 'docs/content/story-update-20261102.json'), 'utf8'));
  if (updatedStories.length !== 3) throw new Error('故事更新数量错误');
  for (const update of updatedStories) {
    const matches = stagedContent.stories.filter(item => item.personName === update.personName);
    if (matches.length !== 1) throw new Error(`故事匹配失败：${update.personName}`);
    Object.assign(matches[0], update);
  }
  writeFileSync(stagedRecords, `${JSON.stringify(stagedContent, null, 2)}\n`);
  if (kind === 'complete') {
    const readme = join(stage, 'README.md');
    writeFileSync(readme, `${readFileSync(readme, 'utf8')}\n## 队伍信息\n\n队名：一一\n\n队长姓名、学号及其他成员信息：待填写。\n`, 'utf8');
  }
  // Local-only picture middleware points at a private Windows path and must not ship.
  writeFileSync(join(stage, 'apps/web/vite.config.ts'), `import { defineConfig } from 'vite';\nexport default defineConfig(() => {\n  const target = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001';\n  const proxy = { '/api': target, '/health': target, '/ready': target };\n  return { server: { proxy }, preview: { proxy } };\n});\n`);
  // Both distributable artifacts remove workstation identity. The complete package
  // differs by its internal editorial documents, never by retaining local secrets.
  anonymize(stage);
  applyReleaseStatement(stage);
  const staged = filesUnder(stage);
  if (editorBatch) {
    const missing = requiredEditorFiles.filter((rel) => !staged.includes(rel));
    if (missing.length) throw new Error(`编辑器候选缺少正式运行文件：${JSON.stringify(missing)}`);
  }
  const version = {
    schemaVersion: 1, batch, kind, projectVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    createdAt: new Date().toISOString(), source: 'current working tree allowlist',
    ...release,
  };
  writeFileSync(join(stage, 'DELIVERY-VERSION.json'), `${JSON.stringify(version, null, 2)}\n`);
  const payload = filesUnder(stage).map((path) => ({ path, bytes: statSync(join(stage, path)).size, sha256: sha(join(stage, path)) }));
  const manifest = { schemaVersion: 1, batch, kind, fileCount: payload.length, files: payload };
  writeFileSync(join(stage, 'DELIVERY-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const findings = scan(stage);
  if (findings.length) throw new Error(`${kind} 暂存区匿名/秘密/测试扫描未通过：${JSON.stringify(findings.slice(0, 20))}`);
  writeFileSync(join(out, `${kind}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  const zip = join(out, `shoushang-china-${kind}-candidate.zip`);
  const tar = spawnSync(tarExecutable(), ['-a', '-c', '-f', zip, '-C', stage, '.'], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`压缩失败：${tar.stderr || tar.stdout}`);
  return { kind, zip: basename(zip), bytes: statSync(zip).size, sha256: sha(zip), fileCount: payload.length, scanFindings: findings.length };
}

try {
  const packages = [writePackage('complete'), writePackage('anonymous')];
  const outer = join(out, 'shoushang-china-yizu-TEAM-DETAILS-REQUIRED-candidate.zip');
  const outerResult = spawnSync(tarExecutable(), ['-a', '-c', '-f', outer, '-C', out, ...packages.map(item => item.zip)], { encoding: 'utf8' });
  if (outerResult.status !== 0) throw new Error(`外层压缩失败：${outerResult.stderr || outerResult.stdout}`);
  packages.push({ kind: 'outer', zip: basename(outer), bytes: statSync(outer).size, sha256: sha(outer), contains: packages.map(item => item.zip), formalFilenameReady: false });
  const version = {
    schemaVersion: 1, batch, createdAt: new Date().toISOString(), inputMode: 'working-tree-allowlist',
    ...(editorBatch ? { releaseVersion: release.releaseVersion, status: release.status } : {}),
    packages,
  };
  writeFileSync(join(out, 'version.json'), `${JSON.stringify(version, null, 2)}\n`);
  writeFileSync(join(out, 'package-hashes.json'), `${JSON.stringify(Object.fromEntries(packages.map((item) => [item.zip, { bytes: item.bytes, sha256: item.sha256 }])), null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, output: out, packages }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
