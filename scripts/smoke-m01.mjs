// Optional M01 smoke check against an already running `pnpm dev`.
// Uses installed Edge; never downloads a browser. Not the later product E2E suite.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const evidence = resolve('docs/handoffs/assets');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByRole('heading', { name: '手上中国 · M01 项目检查页' })).toBeVisible();
  await expect(page.getByText('项目已启动。', { exact: false })).toBeVisible();
  await expect(page.getByRole('strong')).toHaveText('mock');
  await expect(page.getByRole('heading', { name: '开发占位：几何纸样' })).toBeVisible();
  const image = page.getByRole('img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const healthResponse = await page.request.get('http://127.0.0.1:3001/health');
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toMatchObject({ status: 'ok', database: 'not-initialized', contentMode: 'mock' });
  expect(errors).toEqual([]);
  await page.screenshot({ path: resolve(evidence, 'M01-check-page.png'), fullPage: true });
  console.log(JSON.stringify({ browser: browser.version(), web: 'passed', mockExhibit: 'visible', image: 'loaded', health: 'passed', pageErrors: errors, scope: 'M01 check page only' }));
} finally { await browser.close(); }
