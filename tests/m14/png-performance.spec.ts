import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cpus, totalmem, release } from 'node:os';
import { createHash } from 'node:crypto';
const root = process.env.M14_DATA_ROOT!, evidence = process.env.M14_EVIDENCE!;
test.beforeAll(() => execFileSync(process.execPath, ['--import', 'tsx', resolve('apps/api/testing/prepare-content.ts'), '--initialize', join(root, 'content.sqlite')], { stdio: 'pipe' }));
test('normal built app cold PNG with actual phase and font network evidence, preserving original timing', async ({ browser }) => {
  const rounds = Number(process.env.M14_PNG_ROUNDS ?? 5), samples = [];
  const buildFile = (await readdir(resolve('apps/web/dist/assets'))).find(f => /^index-.*\.js$/u.test(f));
  if (!buildFile) throw new Error('Build entry missing');
  const buildSha256 = createHash('sha256').update(await readFile(resolve('apps/web/dist/assets', buildFile))).digest('hex');
  for (let round = 0; round < rounds; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 2_000_000 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const records: { family: string; started: number; ended: number; ok: boolean }[] = [];
      Object.defineProperty(window, '__m14FontLoads', { value: records });
      const original = FontFace.prototype.load;
      FontFace.prototype.load = function () {
        const row = { family: this.family, started: performance.now(), ended: 0, ok: false }; records.push(row);
        return original.call(this).then(face => { row.ended = performance.now(); row.ok = true; return face; }, error => { row.ended = performance.now(); throw error; });
      };
    });
    let result: { milliseconds: number; width: number; height: number; bytes: number } | null = null, failure: string | null = null;
    let start = 0, fontsBeforeClick = -1;
    try {
      await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle' }); await page.waitForTimeout(5000);
      await page.getByRole('link', { name: /^开始剪纸/ }).click();
      await page.getByRole('button', { name: '使用模板', exact: true }).click();
      await page.getByRole('button', { name: '圆形', exact: true }).click(); await page.getByRole('button', { name: '确认剪切', exact: true }).click();
      fontsBeforeClick = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /\.(otf|woff2?|ttf)(?:$|\?)/u.test(e.name)).length);
      start = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(e => e.textContent?.trim() === '生成 PNG 作品卡');
        if (!button) throw new Error('Export button missing'); const time = performance.now(); button.click(); return time;
      });
      await expect(page.getByText('作品卡已生成')).toBeVisible({ timeout: 30000 });
      result = await page.locator('.ws-export-result img').evaluate(async (el, started) => {
        if (!(el instanceof HTMLImageElement)) throw new Error('PNG image missing'); await el.decode();
        const blob = await (await fetch(el.src)).blob();
        return { milliseconds: performance.now() - started, width: el.naturalWidth, height: el.naturalHeight, bytes: blob.size };
      }, start);
      if (round === 0) { const pending = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PNG' }).click(); await (await pending).saveAs(join(evidence, 'normal-card.png')); }
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    const timings = await page.evaluate(() => ({
      phases: performance.getEntriesByType('measure').filter(e => e.name.startsWith('shoushang-png/')).map(e => ({ phase: e.name, start: e.startTime, duration: e.duration })),
      fonts: performance.getEntriesByType('resource').filter(e => /\.(otf|woff2?|ttf)(?:$|\?)/u.test(e.name)).map(e => { const r = e as PerformanceResourceTiming; return { url: r.name, start: r.startTime, requestStart: r.requestStart, responseStart: r.responseStart, responseEnd: r.responseEnd, duration: r.duration, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize }; }),
      loads: (window as unknown as { __m14FontLoads: { family: string; started: number; ended: number; ok: boolean }[] }).__m14FontLoads,
    }));
    samples.push({ round: round + 1, start, fontsBeforeClick, result, failure, ...timings });
    await writeFile(join(evidence, 'samples.json'), JSON.stringify({ browser: browser.version(), node: process.version, os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), buildSha256, conditions: { network: '10Mbps down / 2Mbps up / 100ms latency', cpu: '4x', cache: 'disabled; new context per round', viewport: '1440x900', entry: 'normal built API and normal Vite build preview', timing: 'unchanged: before button event through PNG decode and complete Blob read; all failed rounds retained' }, samples }, null, 2));
    await context.close();
  }
  const values = samples.flatMap(sample => sample.result ? [sample.result.milliseconds] : []).sort((a, b) => a - b);
  const median = values.length === rounds && !samples.some(sample => sample.failure) ? values[Math.floor(values.length / 2)] : null;
  await writeFile(join(evidence, 'summary.json'), JSON.stringify({ requestedRounds: rounds, recordedRounds: samples.length, failedRounds: samples.filter(sample => sample.failure).length, sortedMilliseconds: values, medianMilliseconds: median, targetMilliseconds: 5000, pass: rounds === 5 && median !== null && median! <= 5000 }, null, 2));
  expect(samples).toHaveLength(rounds);
  for (const sample of samples) { expect(sample.failure).toBeNull(); expect(sample.fontsBeforeClick).toBe(0); expect(sample.result?.width).toBe(1600); expect(sample.result?.height).toBe(2000); expect(sample.result?.bytes).toBeGreaterThan(1000); }
  if (rounds === 5) expect(median).toBeLessThanOrEqual(5000);
});
