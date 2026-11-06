import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// This verifier owns only a new package-external root and its own processes.
const packageRoot = resolve(process.argv[2] ?? process.cwd());
const runtimeRoot = resolve(process.argv[3] ?? '');
const apiPort = Number(process.argv[4] ?? 32101), webPort = Number(process.argv[5] ?? 4173);
const relation = relative(packageRoot, runtimeRoot);
if (!process.argv[3] || relation === '' || (!relation.startsWith('..\\') && !relation.startsWith('../') && !isAbsolute(relation))) throw new Error('运行数据目录必须是包外的新目录');
if (existsSync(runtimeRoot)) throw new Error(`拒绝复用运行目录：${runtimeRoot}`);
for (const port of [apiPort, webPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须为1024–65535的整数');
assert.notEqual(apiPort, webPort, 'API和网页端口必须不同');
const requireFromPackage = createRequire(join(packageRoot, 'package.json'));
const requireFromApi = createRequire(join(packageRoot, 'apps/api/package.json'));
const { chromium, expect } = requireFromPackage('@playwright/test'), sharp = requireFromApi('sharp');
const contentRoot = join(runtimeRoot, 'content'), evidenceRoot = join(runtimeRoot, 'evidence');
const database = join(contentRoot, 'content.sqlite'), mediaRoot = join(contentRoot, 'media');
mkdirSync(runtimeRoot, { recursive: false }); mkdirSync(evidenceRoot);
const initArgs = ['--import', 'tsx', 'scripts/content/initialize-v1.ts', '--root', contentRoot];
function initialize(timeout) { return spawnSync(process.execPath, initArgs, { cwd: packageRoot, encoding: 'utf8', windowsHide: true, timeout }); }
const initialized = initialize(240000);
if (initialized.status !== 0) throw new Error(`正式V1内容初始化失败：${initialized.stderr || initialized.stdout}`);
const receipt = JSON.parse(readFileSync(join(contentRoot, 'v1-initialization.json'), 'utf8'));
assert.equal(receipt.status, 'complete'); assert.deepEqual(receipt.counts, { templates: 3, exhibits: 12, stories: 3, media: 15 });
const repeated = initialize(60000);
assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout); assert.equal(JSON.parse(repeated.stdout).unchanged, true);

const children = [], base = `http://127.0.0.1:${webPort}`, apiBase = `http://127.0.0.1:${apiPort}`;
const pageErrors = [], failedRequests = [];
const results = { contentSet: receipt.contentSet, initialization: { counts: receipt.counts, repeated: 'unchanged' }, pages: {}, media: [], templates: [], privatePaths: [] };
function launch(args, env, graceful = false) {
  const clean = { ...process.env };
  for (const key of ['ADMIN_ENABLED', 'ADMIN_ORIGIN', 'ADMIN_SECURITY_MODE', 'ADMIN_MEDIA_ROOT', 'ADMIN_BACKUP_ROOT', 'CONTENT_DATABASE_PATH', 'API_PROXY_TARGET', 'HOST', 'PORT']) delete clean[key];
  const child = spawn(process.execPath, args, { cwd: packageRoot, env: { ...clean, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.captured = ''; child.graceful = graceful;
  child.stdout.on('data', chunk => { child.captured += chunk.toString(); }); child.stderr.on('data', chunk => { child.captured += chunk.toString(); });
  children.push(child); return child;
}
async function waitFor(url, child) {
  let last;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`服务提前退出 ${url}: ${child.captured}`);
    try { const response = await fetch(url); if (response.ok) return response; last = String(response.status); }
    catch (error) { last = error instanceof Error ? error.message : String(error); }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`服务未就绪 ${url}: ${last}`);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const waitForExit = milliseconds => new Promise(done => {
    const finish = () => { clearTimeout(timer); child.removeListener('exit', finish); done(); };
    const timer = setTimeout(finish, milliseconds); child.once('exit', finish);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
  const exited = waitForExit(10000);
  if (child.graceful) child.stdin.end(); else child.kill('SIGTERM');
  await exited;
  if (child.exitCode === null && child.signalCode === null) { child.kill(); await waitForExit(5000); }
  assert.ok(child.exitCode !== null || child.signalCode !== null, '验证启动的服务未能停止');
}
async function value(path) {
  const response = await fetch(base + path); assert.equal(response.ok, true, `${path}: ${response.status}`);
  const body = await response.json(); assert.equal(body.ok, true, `${path}: ${JSON.stringify(body)}`);
  assert.equal(/passwordHash|proofRef|objectKey|tokenDigest|csrfDigest/u.test(JSON.stringify(body)), false, `${path}: 公开DTO含私有字段`);
  return body.value;
}
async function ensureImages(page) {
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) {
    const image = images.nth(index); await image.scrollIntoViewIfNeeded();
    await image.evaluate(async node => { await node.decode(); if (node.naturalWidth < 1 || node.naturalHeight < 1) throw new Error('图片尺寸无效'); });
  }
  return images.count();
}
async function pageLayout(page) {
  const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, imagesWithoutAlt: document.querySelectorAll('img:not([alt])').length }));
  assert.ok(measured.scrollWidth <= measured.width + 1, `页面横向溢出：${page.url()}`); assert.equal(measured.imagesWithoutAlt, 0); return measured;
}
function accountsAndSessions() {
  const raw = new DatabaseSync(database, { readOnly: true });
  try { return {
    enabledAccounts: Number(raw.prepare('SELECT COUNT(*) AS n FROM admin_accounts WHERE disabled=0').get().n),
    // Expiries are Unix milliseconds, never SQL datetime strings.
    activeSessions: Number(raw.prepare('SELECT COUNT(*) AS n FROM admin_sessions WHERE revoked=0 AND expires_at > ?').get(Date.now()).n),
  }; } finally { raw.close(); }
}
async function decodePng(path) {
  const bytes = readFileSync(path); assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const { data, info } = await sharp(bytes, { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [1600, 2000, 4]); assert.equal(data.length, 1600 * 2000 * 4);
  let transparent = 0, colored = 0, holes = 0, titleInk = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] !== 255) transparent++;
    if (Math.abs(data[i] - data[i + 1]) > 20) colored++;
    if (y < 1500 && data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 238) holes++;
    if (y > 1580 && data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) titleInk++;
  }
  assert.equal(transparent, 0); assert.ok(colored > 10000); assert.ok(holes > 100); assert.ok(titleInk > 100);
  return { width: info.width, height: info.height, rawDecodedBytes: data.length, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), transparent, colored, holes, titleInk };
}

let browser, context, page, failure;
try {
  const wrapper = `import { startServer } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'apps/api/dist/server.js')).href)}; const app = await startServer(); process.stdin.resume(); process.stdin.once('end', () => { void app.close().then(() => process.exit(0)); });`;
  const api = launch(['--input-type=module', '-e', wrapper], { CONTENT_DATABASE_PATH: database, ADMIN_MEDIA_ROOT: mediaRoot, HOST: '127.0.0.1', PORT: String(apiPort), ADMIN_ENABLED: '0' }, true);
  await waitFor(`${apiBase}/ready`, api);
  const web = launch(['apps/web/node_modules/vite/bin/vite.js', 'preview', 'apps/web', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { API_PROXY_TARGET: apiBase });
  await waitFor(`${base}/`, web);
  results.health = await (await fetch(`${apiBase}/health`)).json(); results.ready = await (await fetch(`${base}/ready`)).json();
  assert.equal(results.health.status, 'ok'); assert.equal(results.ready.status, 'ready');
  results.adminStatus = (await fetch(`${apiBase}/api/v1/admin/session`)).status; assert.equal(results.adminStatus, 404, '后台必须默认关闭');
  assert.deepEqual(accountsAndSessions(), { enabledAccounts: 0, activeSessions: 0 });
  const templates = await value('/api/v1/templates?pageSize=50&craftId=craft-papercut');
  const exhibits = await value('/api/v1/exhibits?pageSize=50'), stories = await value('/api/v1/stories?pageSize=50');
  assert.deepEqual([templates.total, exhibits.total, stories.total], [3, 12, 3]);
  assert.deepEqual(templates.items.map(item => item.id).sort(), ['template-v1-c01', 'template-v1-c02', 'template-v1-c03']);
  for (const media of [...exhibits.items.flatMap(item => item.media), ...stories.items.map(item => item.cover)]) {
    assert.ok(media.author && media.source && media.modification && media.license.name && media.license.attribution, `${media.id}: 来源许可修改说明不完整`);
    const response = await fetch(new URL(media.url, base)); assert.equal(response.status, 200, `${media.id}: 图片不可读`); assert.match(response.headers.get('content-type') ?? '', /^image\//u);
    const bytes = Buffer.from(await response.arrayBuffer());
    const { info, data } = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, media.width); assert.equal(info.height, media.height); assert.ok(data.length > 0);
    results.media.push({ id: media.id, width: info.width, height: info.height, decodedBytes: data.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  assert.equal(new Set(results.media.map(item => item.id)).size, 15);
  for (const path of ['/content.sqlite', '/media/', '/backups/', '/v1-initialization.json', `/api/v1/admin/media/${results.media[0].id}/proof`, `/api/v1/media/${results.media[0].id}/proof`]) {
    const response = await fetch(apiBase + path); assert.equal(response.status, 404, `${path}: 私有路径可访问`);
    const proxied = await fetch(base + path); assert.ok(!/image\/|application\/(?:octet-stream|x-sqlite3)/u.test(proxied.headers.get('content-type') ?? ''), `${path}: 前端静态泄漏私有数据`);
    assert.ok(!Buffer.from(await proxied.arrayBuffer()).subarray(0, 16).toString().startsWith('SQLite format 3'), `${path}: 前端泄漏数据库`);
    results.privatePaths.push({ path, apiStatus: response.status, webStatus: proxied.status });
  }
  browser = await chromium.launch({ channel: process.env.DELIVERY_BROWSER_CHANNEL ?? 'msedge', headless: true }); results.browser = browser.version();
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } }); page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') failedRequests.push({ url: request.url(), error: request.failure()?.errorText }); });
  await page.goto(base); await expect(page.getByRole('heading', { name: '精选展品' })).toBeVisible();
  await expect(page.locator('.hm-card')).toHaveCount(6); await expect(page.locator('.hm-story')).toHaveCount(3);
  results.pages.home = { images: await ensureImages(page), layout: await pageLayout(page) }; await page.screenshot({ path: join(evidenceRoot, 'home.png'), fullPage: true });
  await page.goto(`${base}/gallery`); await expect(page.getByText('共 12 件')).toBeVisible(); await expect(page.locator('.ga-card')).toHaveCount(12);
  results.pages.gallery = { images: await ensureImages(page), layout: await pageLayout(page) };
  const searchTerm = exhibits.items[0].title;
  await page.getByLabel('搜索展品').fill(searchTerm); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: searchTerm, exact: true })).toBeVisible(); results.pages.search = { query: searchTerm, found: true };
  for (const exhibit of exhibits.items) {
    await page.goto(`${base}/gallery/${encodeURIComponent(exhibit.id)}`); await expect(page.getByRole('heading', { name: exhibit.title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '事实来源', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '图像来源与媒体许可', exact: true })).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const media of exhibit.media) for (const fragment of [media.license.name, media.license.attribution, media.modification]) assert.ok(text.includes(fragment));
    assert.equal(await ensureImages(page), exhibit.media.length); assert.ok(exhibit.sources.length > 0);
  }
  results.pages.exhibitDetails = exhibits.items.length; await page.screenshot({ path: join(evidenceRoot, 'exhibit-detail.png'), fullPage: true });
  await page.goto(`${base}/stories`); await expect(page.getByText('共 3 篇')).toBeVisible(); await expect(page.locator('.st-card')).toHaveCount(3); assert.equal(await ensureImages(page), 3);
  for (const story of stories.items) {
    await page.goto(`${base}/stories/${encodeURIComponent(story.id)}`); await expect(page.getByRole('heading', { name: story.title, exact: true })).toBeVisible();
    for (const name of ['故事正文', '事实来源', '图像来源与媒体许可']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^体验关联模板/ })).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const fragment of [story.cover.license.name, story.cover.license.attribution, story.cover.modification]) assert.ok(text.includes(fragment));
    assert.ok(story.body.filter(block => block.type === 'paragraph').length >= 3); assert.ok(story.sources.length > 0); assert.equal(await ensureImages(page), 1);
  }
  results.pages.storyDetails = stories.items.length; await page.screenshot({ path: join(evidenceRoot, 'story-detail.png'), fullPage: true });
  for (const width of [360, 390, 720, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of [['home', '/'], ['gallery', '/gallery'], ['story', `/stories/${stories.items[0].id}`]]) {
      await page.goto(base + path); await expect(page.locator('h1')).toBeVisible(); await ensureImages(page); results.pages[`${name}-${width}`] = await pageLayout(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const cases = [{ id: 'template-v1-c01', shape: '圆形', max: 30 }, { id: 'template-v1-c02', shape: '三角形', max: 50 }, { id: 'template-v1-c03', shape: '圆形', max: 80 }];
  for (const [index, item] of cases.entries()) {
    const template = templates.items.find(candidate => candidate.id === item.id), name = `交付验证作品${index + 1}`;
    // The route without workId is the frozen v1 authoring path. Use it only to
    // create a migration source, then verify that v1 is read-only and continue
    // the editable lifecycle on the explicit v2 copy.
    await page.goto(`${base}/workshop/papercut`); await expect(page.locator('.ws-template')).toHaveCount(3);
    await page.locator('.ws-template').filter({ hasText: template.name }).getByRole('button', { name: '使用模板', exact: true }).click();
    await page.getByRole('button', { name: item.shape, exact: true }).click(); await page.getByRole('button', { name: '确认剪切', exact: true }).click();
    await expect(page.getByText(`切口 1 / ${item.max}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.getByText(`切口 0 / ${item.max}`, { exact: true })).toBeVisible(); await page.getByRole('button', { name: '重做', exact: true }).click();
    await page.getByLabel('作品名称').fill(name); await page.keyboard.press('Tab');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: /草稿已保存/u })).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: new RegExp(`^${name} ·`) }).click();
    await expect(page.getByText(`切口 1 / ${item.max}`, { exact: true })).toBeVisible(); await expect(page.getByLabel('作品名称')).toHaveValue(name);
    await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
    await page.getByRole('button', { name: '完成并保存作品', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: /作品已保存/u })).toBeVisible();
    await page.getByRole('button', { name: '我的作品', exact: true }).click();
    let v1Card = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name, exact: true }), hasText: '版本：v1' });
    await expect(v1Card).toHaveCount(1); await expect(v1Card.getByText('只读历史作品', { exact: true })).toBeVisible();
    await expect(v1Card.getByRole('button', { name: '编辑完成版', exact: true })).toHaveCount(0);
    await expect(v1Card.getByRole('button', { name: '改名', exact: true })).toHaveCount(0);
    await v1Card.getByRole('button', { name: '查看作品', exact: true }).click(); await expect(page.getByText('旧版作品为只读', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '另存为可编辑副本', exact: true }).click();
    const editor = page.locator('.m15b-editor'); await expect(editor).toHaveAttribute('data-operation-count', '1');
    await page.getByRole('button', { name: '清空', exact: true }).click(); await page.getByRole('button', { name: '确认清空', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '0');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '1');
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '0');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '1');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
    await page.getByRole('button', { name: '完成并保存作品', exact: true }).click(); await expect(page.getByText('作品已保存', { exact: true })).toBeVisible();
    await page.goto(`${base}/my/works`);
    let v2Card = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name, exact: true }), hasText: '版本：v2 · editable' });
    v1Card = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name, exact: true }), hasText: '版本：v1' });
    await expect(v2Card).toHaveCount(1); await expect(v1Card).toHaveCount(1);
    await v1Card.getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('button', { name: '确认永久删除', exact: true }).click(); await expect(v1Card).toHaveCount(0);
    v2Card = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name, exact: true }), hasText: '版本：v2 · editable' });
    await v2Card.getByRole('button', { name: '编辑完成版', exact: true }).click(); await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
    await page.screenshot({ path: join(evidenceRoot, `${item.id}-workshop.png`), fullPage: true });
    await page.goto(`${base}/my/works`);
    v2Card = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name, exact: true }), hasText: '版本：v2 · editable' });
    await v2Card.getByRole('button', { name: '导出 PNG', exact: true }).click();
    await page.getByRole('button', { name: '生成 PNG 作品卡', exact: true }).click(); await expect(page.getByText('作品卡已生成。下载触发不代表已保存到设备。', { exact: true })).toBeVisible({ timeout: 30000 });
    assert.deepEqual(await page.locator('.mw-export-preview').evaluate(async image => { await image.decode(); return [image.naturalWidth, image.naturalHeight]; }), [1600, 2000]);
    const downloading = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PNG', exact: true }).click();
    const download = await downloading, pngPath = join(evidenceRoot, `${item.id}.png`); await download.saveAs(pngPath);
    results.templates.push({ id: item.id, v1ReadOnly: true, migratedToV2: true, saved: true, draftRecovered: true, completedReopened: true, png: await decodePng(pngPath) });
  }
  await page.goto(`${base}/my/works`); await expect(page.getByText('共 3 件作品')).toBeVisible();
  await page.getByRole('button', { name: '改名', exact: true }).first().click(); await page.getByLabel('作品名称').fill('交付验证已改名'); await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: '交付验证已改名', exact: true })).toBeVisible(); await page.reload(); await expect(page.getByRole('heading', { name: '交付验证已改名', exact: true })).toBeVisible();
  const renamed = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name: '交付验证已改名', exact: true }) });
  await renamed.getByRole('button', { name: '复制', exact: true }).click(); await expect(page.getByText('共 4 件作品')).toBeVisible();
  const copied = page.locator('.mw-card').filter({ has: page.getByRole('heading', { name: '交付验证已改名副本', exact: true }) });
  await copied.getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('button', { name: '确认永久删除', exact: true }).click();
  await expect(page.getByText('共 3 件作品')).toBeVisible(); await page.reload(); await expect(page.getByText('共 3 件作品')).toBeVisible();
  await page.getByRole('button', { name: '已完成', exact: true }).click(); await expect(page.getByText('共 3 件作品')).toBeVisible();
  await page.screenshot({ path: join(evidenceRoot, 'my-works.png'), fullPage: true });
  results.workManagement = { completed: 3, renameSurvivedReload: true, copy: true, deleteSurvivedReload: true, completedFilter: true };
  assert.deepEqual(pageErrors, [], '浏览器脚本错误'); assert.deepEqual(failedRequests, [], '浏览器请求失败');
} catch (error) {
  failure = error; if (page && !page.isClosed()) await page.screenshot({ path: join(evidenceRoot, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  try { if (context) await context.close(); if (browser) await browser.close(); } catch (error) { failure ??= error; }
  for (const child of children.reverse()) { try { await stop(child); } catch (error) { failure ??= error; } }
  results.cleanup = { ...accountsAndSessions(), servicesStopped: children.every(child => child.exitCode !== null || child.signalCode !== null) };
  try { assert.deepEqual(results.cleanup, { enabledAccounts: 0, activeSessions: 0, servicesStopped: true }); } catch (error) { failure ??= error; }
  const report = { ok: !failure, packageRoot, runtimeRoot, ...results, pageErrors, failedRequests, ...(failure ? { error: failure instanceof Error ? failure.stack : String(failure) } : {}) };
  writeFileSync(join(evidenceRoot, 'runtime-verification.json'), `${JSON.stringify(report, null, 2)}\n`); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
