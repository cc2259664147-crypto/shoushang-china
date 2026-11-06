import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';

const evidence = process.env.M14_EVIDENCE!;
type Sample = { round: number; iteration: number; direction: 'left' | 'right'; milliseconds: number };
const nearestRank = (values: number[], percentile: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1]!;

test('50-operation work records 5 x 100 input-to-visual-update samples', async ({ browser }) => {
  const all: Sample[] = [];
  const rounds: { round: number; samples: number; p95Milliseconds: number; operationCountBefore: number; operationCountAfter: number }[] = [];
  for (let round = 1; round <= 5; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 2_000_000 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const database = `m14-nfr02-${Date.now()}-${round}`;
    await page.goto(`/workshop/papercut?m07db=${database}`);
    await page.getByRole('button', { name: '使用模板', exact: true }).click();
    for (let count = 1; count <= 50; count++) {
      await page.getByRole('button', { name: '圆形', exact: true }).click();
      await page.getByRole('button', { name: '确认剪切', exact: true }).click();
      await expect(page.getByText(`切口 ${count} / 100`)).toBeVisible();
    }
    const operationCountBefore = await page.evaluate(() => Number(/切口\s+(\d+)\s+\/\s+100/u.exec(document.body.textContent ?? '')?.[1] ?? -1));
    await page.getByRole('button', { name: '圆形', exact: true }).click();
    const values = await page.evaluate(async () => {
      const rows: { iteration: number; direction: 'left' | 'right'; milliseconds: number }[] = [];
      const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label) as HTMLButtonElement | undefined;
      const art = document.querySelector('.ws-art');
      if (!art) throw new Error('Rendered artwork missing');
      for (let iteration = 1; iteration <= 100; iteration++) {
        const direction = iteration % 2 === 1 ? 'right' : 'left';
        const target = button(direction === 'right' ? '右移' : '左移');
        if (!target) throw new Error(`${direction} input missing`);
        const milliseconds = await new Promise<number>((resolve, reject) => {
          const timeout = window.setTimeout(() => { observer.disconnect(); reject(new Error(`visual update timeout at ${iteration}`)); }, 2000);
          const observer = new MutationObserver(() => {
            observer.disconnect(); window.clearTimeout(timeout);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
          });
          observer.observe(art, { subtree: true, childList: true, attributes: true, characterData: true });
          const started = performance.now();
          target.click();
        });
        rows.push({ iteration, direction, milliseconds });
      }
      return rows;
    });
    const operationCountAfter = await page.evaluate(() => Number(/切口\s+(\d+)\s+\/\s+100/u.exec(document.body.textContent ?? '')?.[1] ?? -1));
    expect(operationCountBefore).toBe(50); expect(operationCountAfter).toBe(50); expect(values).toHaveLength(100);
    const samples = values.map(value => ({ round, ...value })); all.push(...samples);
    const p95Milliseconds = nearestRank(samples.map(sample => sample.milliseconds), .95);
    rounds.push({ round, samples: samples.length, p95Milliseconds, operationCountBefore, operationCountAfter });
    expect(p95Milliseconds).toBeLessThanOrEqual(100);
    await context.close();
  }
  const overallP95 = nearestRank(all.map(sample => sample.milliseconds), .95);
  const report = { node: process.version, browser: browser.version(), os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), viewport: '1440x900', conditions: { network: '10Mbps down / 2Mbps up / 100ms latency', cpu: '4x slowdown', cache: 'disabled; new browser context each round' }, template: 'normal development template, 100-operation limit', method: 'Each round creates 50 cuts through the normal UI, then measures 100 alternating left/right button inputs from immediately before click until the SVG subtree mutation and two requestAnimationFrame callbacks. Operation count is asserted unchanged at 50. Nearest-rank P95; every sample retained.', thresholdMilliseconds: 100, requestedRounds: 5, requestedSamplesPerRound: 100, rounds, overall: { samples: all.length, p95Milliseconds: overallP95, pass: rounds.every(round => round.p95Milliseconds <= 100) && overallP95 <= 100 }, samples: all };
  await writeFile(join(evidence, 'edit-response.json'), JSON.stringify(report, null, 2));
  expect(all).toHaveLength(500); expect(overallP95).toBeLessThanOrEqual(100);
});
