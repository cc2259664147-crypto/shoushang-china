import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, release, totalmem } from 'node:os';

const evidence = process.env.M14_5_EVIDENCE!;
test('five cold candidate homepage LCP/CLS samples with real candidate images', async ({ browser }) => {
  const samples: { round: number; lcp: number; cls: number; images: number; decoded: number }[] = [];
  for (let round = 1; round <= 5; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await context.newPage(); const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 2_000_000 / 8 }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => { const v = { lcp: 0, shifts: [] as { time: number; value: number }[] }; Object.defineProperty(window, '__m14finalPerf', { value: v }); new PerformanceObserver(list => { for (const e of list.getEntries()) v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); new PerformanceObserver(list => { for (const e of list.getEntries()) { const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean }; if (!s.hadRecentInput) v.shifts.push({ time: s.startTime, value: s.value }); } }).observe({ type: 'layout-shift', buffered: true }); });
    await page.goto('/', { waitUntil: 'networkidle' }); await page.waitForTimeout(5000);
    const result = await page.evaluate(() => { const images = [...document.querySelectorAll('main img')] as HTMLImageElement[]; const decoded = images.filter(image => image.complete && image.naturalWidth > 0).length; const v = (window as unknown as { __m14finalPerf: { lcp: number; shifts: { time: number; value: number }[] } }).__m14finalPerf; let max = 0, sum = 0, first = 0, last = -Infinity; for (const s of v.shifts) { if (s.time - last > 1000 || s.time - first > 5000) { sum = 0; first = s.time; } sum += s.value; max = Math.max(max, sum); last = s.time; } return { lcp: v.lcp, cls: max, images: images.length, decoded }; });
    expect(result.images).toBeGreaterThan(0); expect(result.decoded).toBeGreaterThan(0); expect(result.lcp).toBeLessThanOrEqual(2500); expect(result.cls).toBeLessThanOrEqual(0.1); samples.push({ round, ...result }); await context.close();
  }
  await writeFile(join(evidence, 'candidate-home.json'), JSON.stringify({ browser: browser.version(), node: process.version, os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), conditions: { network: '10Mbps down / 2Mbps up / 100ms latency', cpu: '4x', cache: 'disabled; new context each round', viewport: '1440x900', content: 'M14-5 isolated 12-exhibit/3-story candidate environment' }, samples }, null, 2));
});
