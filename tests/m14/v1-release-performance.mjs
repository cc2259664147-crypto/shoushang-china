import assert from 'node:assert/strict';
import { cpus, release, totalmem } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const packageRoot = resolve(process.argv[2] ?? '');
const runtimeRoot = resolve(process.argv[3] ?? '');
const evidenceRoot = resolve(process.argv[4] ?? '');
const apiPort = Number(process.argv[5] ?? 32301);
const webPort = Number(process.argv[6] ?? 4281);
if (!existsSync(join(packageRoot, 'apps/web/dist/index.html'))) throw new Error('需要已独立安装并构建的候选包');
if (!existsSync(join(runtimeRoot, 'content.sqlite')) || !existsSync(join(runtimeRoot, 'v1-initialization.json'))) throw new Error('需要已完成正式V1初始化的包外目录');
if (!process.argv[4] || existsSync(evidenceRoot)) throw new Error('性能证据目录必须是新的不存在目录');
mkdirSync(evidenceRoot, { recursive: false });
const requireFromPackage = createRequire(join(packageRoot, 'package.json'));
const { chromium } = requireFromPackage('@playwright/test');
const database = join(runtimeRoot, 'content.sqlite');
const mediaRoot = join(runtimeRoot, 'media');
const apiBase = `http://127.0.0.1:${apiPort}`;
const base = `http://127.0.0.1:${webPort}`;
const children = [];

function launch(args, env, graceful = false) {
  const clean = { ...process.env };
  for (const key of ['ADMIN_ENABLED', 'ADMIN_ORIGIN', 'ADMIN_SECURITY_MODE', 'ADMIN_MEDIA_ROOT', 'ADMIN_BACKUP_ROOT', 'CONTENT_DATABASE_PATH', 'API_PROXY_TARGET', 'HOST', 'PORT']) delete clean[key];
  const child = spawn(process.execPath, args, { cwd: packageRoot, env: { ...clean, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.output = ''; child.graceful = graceful;
  child.stdout.on('data', chunk => { child.output += chunk; }); child.stderr.on('data', chunk => { child.output += chunk; });
  children.push(child); return child;
}
async function ready(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${child.output}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`服务未就绪：${url}`);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(done => { const timer = setTimeout(done, 10000); child.once('exit', () => { clearTimeout(timer); done(); }); });
  if (child.graceful) child.stdin.end(); else child.kill('SIGTERM');
  await exited;
  if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise(done => setTimeout(done, 1000)); }
  assert.ok(child.exitCode !== null || child.signalCode !== null, '性能验证服务未停止');
}
function accountState() {
  const db = new DatabaseSync(database, { readOnly: true });
  try { return {
    enabledAccounts: Number(db.prepare('SELECT COUNT(*) AS n FROM admin_accounts WHERE disabled=0').get().n),
    activeSessions: Number(db.prepare('SELECT COUNT(*) AS n FROM admin_sessions WHERE revoked=0 AND expires_at > ?').get(Date.now()).n),
  }; } finally { db.close(); }
}
function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }

let browser, failure;
const samples = [];
try {
  const wrapper = `import { startServer } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'apps/api/dist/server.js')).href)}; const app = await startServer(); process.stdin.resume(); process.stdin.once('end', () => { void app.close().then(() => process.exit(0)); });`;
  const api = launch(['--input-type=module', '-e', wrapper], { CONTENT_DATABASE_PATH: database, ADMIN_MEDIA_ROOT: mediaRoot, ADMIN_ENABLED: '0', HOST: '127.0.0.1', PORT: String(apiPort) }, true);
  await ready(`${apiBase}/ready`, api);
  const web = launch(['apps/web/node_modules/vite/bin/vite.js', 'preview', 'apps/web', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { API_PROXY_TARGET: apiBase });
  await ready(base, web);
  browser = await chromium.launch({ channel: process.env.DELIVERY_BROWSER_CHANNEL ?? 'msedge', headless: true });
  for (let round = 1; round <= 5; round++) {
    const row = { round, lcp: null, cls: null, observedUntil: null, images: null, decoded: null, png: null, failure: null };
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 2_000_000 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        const values = { lcp: 0, shifts: [] };
        Object.defineProperty(window, '__v1perf', { value: values });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) values.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) values.shifts.push({ time: entry.startTime, value: entry.value }); }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(base, { waitUntil: 'networkidle' }); await page.waitForTimeout(5000);
      Object.assign(row, await page.evaluate(async () => {
        const images = [...document.querySelectorAll('main img')]; await Promise.all(images.map(image => image.decode()));
        const values = window.__v1perf; let cls = 0, sum = 0, first = 0, last = -Infinity;
        for (const shift of values.shifts) { if (shift.time - last > 1000 || shift.time - first > 5000) { sum = 0; first = shift.time; } sum += shift.value; cls = Math.max(cls, sum); last = shift.time; }
        return { lcp: values.lcp, cls, observedUntil: performance.now(), images: images.length, decoded: images.filter(image => image.complete && image.naturalWidth > 0).length };
      }));
      await page.getByRole('link', { name: /^开始剪纸/u }).click();
      await page.locator('.ws-template').filter({ hasText: '方纸镜影：成对留白' }).getByRole('button', { name: '使用模板', exact: true }).click();
      await page.getByRole('button', { name: '圆形', exact: true }).click(); await page.getByRole('button', { name: '确认剪切', exact: true }).click();
      const started = await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '生成 PNG 作品卡'); if (!button) throw new Error('找不到PNG按钮'); const value = performance.now(); button.click(); return value; });
      await page.locator('.ws-export-result img').waitFor({ state: 'visible', timeout: 30000 });
      row.png = await page.locator('.ws-export-result img').evaluate(async (image, start) => { await image.decode(); const blob = await (await fetch(image.src)).blob(); return { milliseconds: performance.now() - start, width: image.naturalWidth, height: image.naturalHeight, bytes: blob.size }; }, started);
    } catch (error) { row.failure = error instanceof Error ? error.stack : String(error); }
    samples.push(row); writeFileSync(join(evidenceRoot, 'samples.json'), `${JSON.stringify(samples, null, 2)}\n`); await context.close();
  }
  const lcpValues = samples.flatMap(item => item.lcp === null ? [] : [item.lcp]);
  const pngValues = samples.flatMap(item => item.png ? [item.png.milliseconds] : []);
  const summary = {
    browser: browser.version(), node: process.version, os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(),
    conditions: { network: '10Mbps down / 2Mbps up / 100ms latency', cpu: 'CDP 4x slowdown', cache: 'disabled; new context each round', viewport: '1440x900', observation: 'networkidle plus 5 seconds', pngTiming: 'button event immediately before click through image decode and complete Blob read' },
    samples, lcpMedian: median(lcpValues), pngMedian: median(pngValues), thresholds: { lcpMs: 2500, cls: 0.1, pngMedianMs: 5000 }, cleanup: null,
  };
  assert.equal(samples.length, 5); assert.equal(samples.some(item => item.failure), false);
  for (const item of samples) { assert.ok(item.lcp > 0 && item.lcp <= 2500); assert.ok(item.cls <= 0.1); assert.equal(item.images, 9); assert.equal(item.decoded, 9); assert.deepEqual([item.png.width, item.png.height], [1600, 2000]); assert.ok(item.png.bytes > 1000); }
  assert.ok(summary.pngMedian <= 5000);
  writeFileSync(join(evidenceRoot, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
} catch (error) { failure = error; }
finally {
  if (browser) await browser.close().catch(error => { failure ??= error; });
  for (const child of children.reverse()) await stop(child).catch(error => { failure ??= error; });
  const cleanup = { ...accountState(), servicesStopped: children.every(child => child.exitCode !== null || child.signalCode !== null) };
  try { assert.deepEqual(cleanup, { enabledAccounts: 0, activeSessions: 0, servicesStopped: true }); } catch (error) { failure ??= error; }
  const reportPath = join(evidenceRoot, 'report.json'); const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { samples };
  report.cleanup = cleanup; report.ok = !failure; if (failure) report.error = failure instanceof Error ? failure.stack : String(failure);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
