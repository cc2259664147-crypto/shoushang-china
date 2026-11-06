import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cpus, totalmem, release } from 'node:os';
const root = process.env.M14_DATA_ROOT!, evidence = process.env.M14_EVIDENCE!;
test.beforeAll(() => execFileSync(process.execPath, ['--import', 'tsx', resolve('apps/api/testing/prepare-content.ts'), '--initialize', join(root, 'content.sqlite')], { stdio: 'pipe' }));
test('five cold Chrome homepage and complete PNG samples under fixed CDP conditions', async ({ browser }) => {
  const samples = [];
  for (let round = 0; round < 5; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 2_000_000 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const values = { lcp: 0, clsEntries: [] as { time: number; value: number }[] };
      Object.defineProperty(window, '__m14perf', { value: values });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) values.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) { const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }; if (!shift.hadRecentInput) values.clsEntries.push({ time: shift.startTime, value: shift.value }); } }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle' });
    // Finite observation window; retain raw shifts for independent CLS session calculation.
    await page.waitForTimeout(5000);
    const vitals = await page.evaluate(() => {
      const values = (window as unknown as { __m14perf: { lcp: number; clsEntries: { time: number; value: number }[] } }).__m14perf;
      let max = 0, sum = 0, first = 0, last = -Infinity;
      for (const shift of values.clsEntries) { if (shift.time - last > 1000 || shift.time - first > 5000) { sum = 0; first = shift.time; } sum += shift.value; max = Math.max(max, sum); last = shift.time; }
      return { ...values, cls: max, observedUntil: performance.now() };
    });
    await page.getByRole('link', { name: /^开始剪纸/ }).click();
    await page.getByRole('button', { name: '使用模板', exact: true }).click();
    await page.getByRole('button', { name: '圆形', exact: true }).click(); await page.getByRole('button', { name: '确认剪切', exact: true }).click();
    const started = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(e => e.textContent?.trim() === '生成 PNG 作品卡');
      if (!button) throw new Error('Export button missing'); const start = performance.now(); button.click(); return start;
    });
    await expect(page.getByText('作品卡已生成')).toBeVisible({ timeout: 30000 });
    const png = await page.locator('.ws-export-result img').evaluate(async (el, start) => {
      if (!(el instanceof HTMLImageElement)) throw new Error('PNG image missing'); await el.decode();
      const response = await fetch(el.src), blob = await response.blob();
      return { milliseconds: performance.now() - start, width: el.naturalWidth, height: el.naturalHeight, bytes: blob.size };
    }, started);
    expect(png.width).toBe(1600); expect(png.height).toBe(2000); expect(png.bytes).toBeGreaterThan(1000);
    samples.push({ round: round + 1, ...vitals, png });
    await writeFile(join(evidence, 'samples.json'), JSON.stringify({ browser: browser.version(), node: process.version, os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), conditions: { network: '10Mbps down / 2Mbps up / 100ms latency', cpu: 'CDP 4x slowdown', cache: 'disabled, new context each round', viewport: '1440x900', server: 'built API + Vite preview, loopback', content: 'one development template; no formal exhibits/stories' }, samples }, null, 2));
    await context.close();
  }
});
