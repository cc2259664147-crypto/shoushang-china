import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const directory = process.env.M12_INTEGRATION_ROOT;
if (!directory) throw new Error('Isolated integration directory required');
function prepare(action: string) { execFileSync(process.execPath, ['--import', 'tsx', resolve('apps/api/testing/prepare-content.ts'), action, resolve(directory!, 'content.sqlite')], { stdio: 'pipe' }); }
test.beforeAll(() => prepare('--initialize'));
test('actual developmentData via real app, proxy and HTTP supports cut, draft recovery, completed work and PNG', async ({ page }) => {
  const templates: string[] = [];
  page.on('response', response => { if (response.url().includes('/api/v1/templates')) templates.push(response.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '暂无精选展品' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '暂无精选故事' })).toBeVisible();
  await page.getByRole('link', { name: /^开始剪纸/ }).click();
  await expect(page.getByText('开发示意方纸', { exact: true })).toBeVisible();
  expect(templates.some(url => new URL(url).searchParams.get('craftId') === 'craft-papercut')).toBe(true);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '圆形' }).click(); await page.getByRole('button', { name: '确认剪切' }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
  await expect(page.locator('.ws-canvas svg')).toBeVisible();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: /未命名作品/ }).click(); await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.getByRole('button', { name: '完成并保存作品' }).click(); await expect(page.getByText('作品已保存')).toBeVisible();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click(); await expect(page.getByText('作品卡已生成')).toBeVisible({ timeout: 20000 });
  const image = page.locator('.ws-export-result img');
  expect(await image.evaluate(async e => {
    if (!(e instanceof HTMLImageElement)) throw new Error('Export preview is not an image');
    await e.decode(); return e.naturalWidth === 1600 && e.naturalHeight === 2000;
  })).toBe(true);
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PNG' }).click();
  const downloaded = await download; const file = await downloaded.path(); if (!file) throw new Error('PNG download missing');
  const bytes = await readFile(file); expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.screenshot({ path: resolve(directory!, 'actual-workshop.png'), fullPage: true });
  await page.goto('/gallery'); await expect(page.getByRole('heading', { name: '没有匹配展品' })).toBeVisible();
  await page.goto('/stories'); await expect(page.getByRole('heading', { name: '没有匹配故事' })).toBeVisible();
  await page.goto('/engineering'); await expect(page.getByText('http', { exact: true })).toBeVisible();
  const ready = await page.request.get('/ready'); expect(ready.status()).toBe(200); expect(await ready.json()).toMatchObject({ status: 'ready', database: 'ready', contentMode: 'http' });
});
test('isolated content reaches home, gallery, stories, exact template and favorites', async ({ page }) => {
  prepare('--content'); await page.goto('/');
  await expect(page.locator('.hm-card')).toHaveCount(1); await expect(page.locator('.hm-story')).toHaveCount(1);
  await page.locator('.hm-card h3 a').click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发联调：自制几何纸样');
  const favorite = page.getByRole('button', { name: '收藏', exact: true }); await favorite.click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.goto('/my/favorites'); await expect(page.getByRole('link', { name: '开发联调：自制几何纸样', exact: true })).toBeVisible();
  await page.goto('/stories/story-dev-process'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发联调：软件体验说明');
  await expect(page.getByRole('link', { name: /^关联展品：/ })).toHaveAttribute('href', '/gallery/exhibit-dev-paper');
  const template = page.getByRole('link', { name: /^体验关联模板：/ }); await expect(template).toHaveAttribute('href', '/workshop/papercut?templateId=template-dev-paper');
  await template.click(); await expect(page.getByLabel('作品名称')).toHaveValue('未命名作品');
  await page.screenshot({ path: resolve(directory!, 'exact-linked-template.png'), fullPage: true });
});
test('withdrawal removes old body/media on recheck and HTTP failure is never empty or mock success', async ({ page }) => {
  await page.goto('/stories/story-dev-process'); await expect(page.locator('.st-detail-intro img')).toHaveCount(1);
  prepare('--withdraw'); await page.getByRole('button', { name: '重新核验故事' }).click();
  await expect(page.getByRole('heading', { name: '故事不可用' })).toBeVisible(); await expect(page.locator('.st-prose,.st-detail-intro,.st-relations')).toHaveCount(0);
  await page.goto('/gallery/exhibit-dev-paper'); await expect(page.getByRole('heading', { name: '展品不可用' })).toBeVisible();
  // Explicit network fault at the browser boundary; previous steps use genuine backend responses.
  await page.route('**/api/v1/home', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: '隔离联调故障', requestId: 'integration-fault', fieldErrors: [] } }) }));
  await page.goto('/'); await expect(page.getByText(/精选内容加载失败（INTERNAL_ERROR）/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '暂无精选展品' })).toHaveCount(0); await expect(page.locator('.hm-card')).toHaveCount(0);
  await page.screenshot({ path: resolve(directory!, 'http-failure.png'), fullPage: true });
});
