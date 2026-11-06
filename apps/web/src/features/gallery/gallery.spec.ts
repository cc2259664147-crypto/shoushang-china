import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureWork } from '@shoushang/fixtures';
import type { Favorite } from '@shoushang/contracts';
import type { Controls } from './testing';

const entry = '/src/features/gallery/testing.html';
const db = () => `m10-test-${crypto.randomUUID()}`;
async function open(page: Page, route = '/gallery', name = db()) { await page.goto(`${entry}?${new URLSearchParams({ db: name, route })}`); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); return name; }
async function control(page: Page, patch: Partial<Controls>) { await page.evaluate(p => Object.assign(window.m10, p), patch); }
async function route(page: Page, url: string) { await page.evaluate(url => window.m10Route(url), url); }
async function ready(page: Page) { await expect(page.locator('.ga-grid .ga-card')).toHaveCount(12); await expect(page.getByLabel('工艺')).toBeEnabled(); }
async function favorites(page: Page, name: string): Promise<Favorite[]> {
  return page.evaluate(async ({ name, module }) => { const { openIndexedDbRepository } = await import(/* @vite-ignore */ module) as typeof import('@shoushang/local-repository'); const r = await openIndexedDbRepository({ name }); if (!r.ok) throw new Error(r.error.code); try { const f = await r.value.favorites.list(); if (!f.ok) throw new Error(f.error.code); return f.value; } finally { r.value.close(); } }, { name, module: '/@fs/' + join(process.cwd(), 'packages/local-repository/src/index.ts').replaceAll('\\', '/') });
}

test('search normalization, 100 boundary, overlength and unsubmitted draft', async ({ page }) => {
  await open(page); await ready(page);
  await page.getByLabel('搜索展品').fill('  ABC  '); await expect(page.getByText('当前条件：全部展品')).toBeVisible();
  await page.getByRole('button', { name: '搜索', exact: true }).click(); await expect(page.getByText('当前条件：q=abc')).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).search).get('route')).toBe('/gallery?q=abc');
  await page.getByLabel('搜索展品').fill('字'.repeat(100)); await page.getByRole('button', { name: '搜索', exact: true }).click(); await expect(page.getByRole('heading', { name: '没有匹配展品' })).toBeVisible();
  await page.getByLabel('搜索展品').fill('字'.repeat(101)); await page.getByRole('button', { name: '搜索', exact: true }).click(); await expect(page.getByText('错误：关键词去除首尾空格后最多 100 个字符')).toBeVisible();
});
test('intersection filters reset page and vocabulary spans entire catalog', async ({ page }) => {
  await open(page, '/gallery?page=2'); await ready(page);
  await expect(page.getByLabel('分类').locator('option')).toHaveText(['全部', '测试分类乙', '测试分类甲']);
  await page.getByLabel('工艺').selectOption('craft-papercut'); await page.getByLabel('分类').selectOption('测试分类乙'); await page.getByLabel('标签', { exact: true }).selectOption('测试偶数');
  await page.getByLabel('搜索展品').fill('ABC'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.ga-card')).toHaveCount(5); await expect(page.getByText('第 1 / 1 页 · 共 5 件')).toBeVisible();
  await expect(page.locator('.ga-card h2').first()).toHaveText('测试展品 16 ABC');
});
test('31 items keep port sorting across explicit 12-item pages', async ({ page }) => {
  await open(page); await ready(page); await expect(page.locator('.ga-card h2').first()).toHaveText('测试展品 00 ABC');
  await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/list.png', fullPage: true });
  await page.getByRole('link', { name: '下一页', exact: true }).click(); await expect(page.locator('.ga-card h2').first()).toHaveText('测试展品 12 ABC');
  await page.getByRole('link', { name: '下一页', exact: true }).click(); await expect(page.locator('.ga-card')).toHaveCount(7); await expect(page.locator('.ga-card h2').last()).toHaveText('测试展品 30 ABC');
  await page.getByRole('link', { name: '上一页', exact: true }).click(); await expect(page.locator('.ga-card h2').first()).toHaveText('测试展品 12 ABC');
});
test('direct URL, reload, back and forward preserve submitted query', async ({ page }) => {
  await open(page, '/gallery?q=abc&page=2'); await ready(page); await page.reload(); await ready(page); await expect(page.getByLabel('搜索展品')).toHaveValue('abc');
  await page.getByRole('link', { name: '下一页', exact: true }).click(); await expect(page.locator('.ga-card')).toHaveCount(7);
  await page.goBack(); await ready(page); await expect(page.getByText('第 2 / 3 页 · 共 31 件')).toBeVisible();
  await page.goForward(); await expect(page.getByText('第 3 / 3 页 · 共 31 件')).toBeVisible();
});
test('detail back restores query, page, anchor offset and focus after async load', async ({ page }) => {
  await open(page, '/gallery?q=abc&page=2'); await ready(page);
  const anchor = page.getByRole('link', { name: '测试展品 21 ABC', exact: true }); await anchor.scrollIntoViewIfNeeded(); const before = await anchor.evaluate(e => e.getBoundingClientRect().top);
  await anchor.click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试展品 21 ABC');
  await page.getByRole('link', { name: '返回展馆列表' }).click(); await ready(page); await expect(page.getByLabel('搜索展品')).toHaveValue('abc'); await expect(anchor).toBeFocused();
  expect(Math.abs((await anchor.evaluate(e => e.getBoundingClientRect().top)) - before)).toBeLessThan(50);
});
test('invalid page, empty query, invalid and unknown craft IDs remain explicit', async ({ page }) => {
  await open(page, '/gallery?page=0'); await expect(page.getByText(/page 必须是/)).toBeVisible();
  await route(page, '/gallery?q='); await expect(page.getByText(/q 不能为空/)).toBeVisible();
  await route(page, '/gallery?craftId=bad!'); await expect(page.getByText(/查询参数错误/)).toBeVisible();
  await route(page, '/gallery?craftId=unknown'); await expect(page.getByText('工艺 ID 未匹配公开目录：unknown')).toBeVisible(); await expect(page.getByRole('heading', { name: '没有匹配展品' })).toBeVisible();
  await route(page, '/gallery?page=100'); await expect(page.getByRole('heading', { name: '页码超出范围' })).toBeVisible(); await page.getByRole('link', { name: '前往有效末页' }).click(); await expect(page.locator('.ga-card')).toHaveCount(7);
});
test('empty results expose conditions and clearing; network failure retries instead of empty', async ({ page }) => {
  await open(page, '/gallery?q=unmatched'); await expect(page.getByRole('heading', { name: '没有匹配展品' })).toBeVisible(); await expect(page.getByText('当前条件：q=unmatched').first()).toBeVisible();
  await page.getByRole('link', { name: '清空筛选', exact: true }).click(); await ready(page);
  await control(page, { listFailure: true }); await route(page, '/gallery?q=abc'); await expect(page.getByText(/NETWORK_ERROR：M10/)).toBeVisible(); await expect(page.getByRole('heading', { name: '没有匹配展品' })).toHaveCount(0);
  await control(page, { listFailure: false }); await page.getByRole('button', { name: '重试', exact: true }).click(); await ready(page);
});
test('detail 404 versus retryable failure, fallback return and external return rejection', async ({ page }) => {
  await open(page, '/gallery/missing?returnTo=https://example.org'); await expect(page.getByRole('heading', { name: '展品不可用' })).toBeVisible(); await expect(page.getByRole('link', { name: '返回展馆列表' })).toHaveAttribute('href', '/gallery');
  await control(page, { network: ['test-01'] }); await route(page, '/gallery/test-01'); await expect(page.getByRole('heading', { name: '展品加载失败' })).toBeVisible();
  await control(page, { network: [] }); await page.getByRole('button', { name: '重试', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试展品 01 ABC');
});
test('image failure has alt explanation; dialog Escape, Tab and focus restoration', async ({ page }) => {
  await open(page, '/gallery/test-00'); const trigger = page.getByRole('button', { name: /^放大图片/ }); await trigger.click();
  await expect(page.getByRole('dialog', { name: '展品大图' })).toBeVisible(); await expect(page.getByRole('dialog').getByRole('img')).toBeVisible(); await page.keyboard.press('Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: '关闭展品大图', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole('dialog').getByRole('button', { name: '关闭展品大图', exact: true }).click(); await expect(trigger).toBeFocused();
  await control(page, { brokenImage: true }); await page.getByRole('button', { name: '重新核验展品' }).click(); await expect(page.getByRole('img', { name: /^图片加载失败/ })).toBeVisible();
});
test('detail metadata, sources, licensing and safe new-tab links', async ({ page }) => {
  await open(page, '/gallery/test-00'); await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible(); await expect(page.getByRole('heading', { name: '图像来源与媒体许可' })).toBeVisible(); await expect(page.getByText('未注明', { exact: true })).toBeVisible();
  const links = page.locator('a[target="_blank"]'); await expect(links).toHaveCount(2); for (const link of await links.all()) await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('link', { name: '关联故事：开发占位：数字体验说明' })).toHaveAttribute('href', '/stories/story-dev-process'); await expect(page.locator('a[href^="/stories/"]')).toHaveCount(1);
  await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/detail.png', fullPage: true });
});
test('unsupported linked templates do not advertise an unusable workshop entry', async ({ page }) => {
  await open(page, '/gallery/test-00'); await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^体验关联模板/ })).toHaveCount(0);
  await open(page, '/gallery/test-30'); await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
  await control(page, { badTemplate: true }); await route(page, '/gallery/test-01'); await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
});
test('favorite duplicate clicks, first createdAt, refresh and cancellation across pages', async ({ page }) => {
  const name = await open(page, '/gallery/test-00'); await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '收藏', exact: true }).evaluate((e: HTMLButtonElement) => { e.click(); e.click(); }); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  const first = await favorites(page, name); expect(first).toHaveLength(1); await page.reload(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible(); expect(await favorites(page, name)).toEqual(first);
  await page.getByRole('link', { name: '我的收藏', exact: true }).click(); await expect(page.locator('.ga-card h2')).toHaveText('测试展品 00 ABC');
  await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/favorites.png', fullPage: true });
  await page.getByRole('button', { name: '取消收藏', exact: true }).click(); await expect(page.getByRole('heading', { name: '还没有收藏' })).toBeVisible(); expect(await favorites(page, name)).toEqual([]);
  await page.getByRole('link', { name: '数字展馆', exact: true }).click(); await ready(page); await expect(page.getByRole('button', { name: '收藏', exact: true })).toHaveCount(12);
});
test('favorite writes and removal failures retain confirmed state, allow retry', async ({ page }) => {
  const name = await open(page, '/gallery/test-00'); await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeEnabled(); await control(page, { writeFailure: true });
  await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByText(/收藏操作未完成/)).toBeVisible(); expect(await favorites(page, name)).toEqual([]); await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeEnabled();
  await control(page, { writeFailure: false }); await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await control(page, { writeFailure: true }); await page.getByRole('button', { name: '取消收藏', exact: true }).click(); await expect(page.getByText(/收藏操作未完成/)).toBeVisible(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeEnabled(); expect(await favorites(page, name)).toHaveLength(1);
});
test('favorite survives independent persistent Edge profile restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm10-profile-')), name = db();
  try { let context = await chromium.launchPersistentContext(directory, { channel: 'msedge', headless: true }); let page = context.pages()[0]!;
    await page.goto(`http://127.0.0.1:5173${entry}?${new URLSearchParams({ db: name, route: '/gallery/test-00' })}`); await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible(); const first = await favorites(page, name); await context.close();
    context = await chromium.launchPersistentContext(directory, { channel: 'msedge', headless: true }); page = context.pages()[0]!; await page.goto(`http://127.0.0.1:5173${entry}?${new URLSearchParams({ db: name, route: '/my/favorites' })}`); await expect(page.locator('.ga-card h2')).toHaveText('测试展品 00 ABC'); expect(await favorites(page, name)).toEqual(first); await context.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('unavailable favorites purge title and media, preserve ID until removal', async ({ page }) => {
  const name = await open(page, '/gallery/test-00'); await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await control(page, { missing: ['test-00'] }); await page.getByRole('link', { name: '我的收藏', exact: true }).click(); await expect(page.getByRole('heading', { name: '不可用收藏记录' })).toBeVisible(); await expect(page.locator('.ga-card img')).toHaveCount(0); await expect(page.locator('.ga-card a')).toHaveCount(0); await expect(page.getByText('测试展品 00 ABC')).toHaveCount(0);
  expect(await favorites(page, name)).toHaveLength(1); await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/unavailable.png', fullPage: true }); await page.getByRole('button', { name: '取消收藏', exact: true }).click(); await expect(page.getByRole('heading', { name: '还没有收藏' })).toBeVisible();
});
test('network failure is not withdrawal and never deletes favorite reference', async ({ page }) => {
  const name = await open(page, '/gallery/test-00'); await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible(); await control(page, { network: ['test-00'] }); await route(page, '/my/favorites'); await expect(page.getByRole('heading', { name: '收藏核验失败' })).toBeVisible(); await expect(page.getByRole('heading', { name: '不可用收藏记录' })).toHaveCount(0); expect(await favorites(page, name)).toHaveLength(1);
  await control(page, { network: [], timeout: ['test-00'] }); await page.getByRole('button', { name: '重试核验' }).click(); await expect(page.getByText(/TIMEOUT：暂不能确认/)).toBeVisible(); expect(await favorites(page, name)).toHaveLength(1);
  await control(page, { timeout: [] }); await page.getByRole('button', { name: '重试核验' }).click(); await expect(page.locator('.ga-card h2')).toHaveText('测试展品 00 ABC');
});

test('second linked template without an editor profile does not fall back to another template', async ({ page }) => {
  await open(page, '/gallery/test-02');
  await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^体验关联模板/ })).toHaveCount(0);
});
test('previously visible detail and open large image disappear after unavailability; late data cannot revive', async ({ page }) => {
  await open(page, '/gallery/test-00'); await page.getByRole('button', { name: /^放大图片/ }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await control(page, { missing: ['test-00'], delay: { 'test-00': 100 } }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(page.locator('.ga-detail-media img')).toHaveCount(0); await expect(page.getByRole('heading', { name: '展品不可用' })).toBeVisible();
  await control(page, { missing: [], delay: { 'test-00': 600 } }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await control(page, { missing: ['test-00'], delay: {} }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.getByRole('heading', { name: '展品不可用' })).toBeVisible(); await page.waitForTimeout(750); await expect(page.locator('.ga-detail-media img')).toHaveCount(0);
});
test('late query and route responses never overwrite newer view in StrictMode', async ({ page }) => {
  await open(page); await ready(page); await control(page, { delay: { 'q:00': 700, 'test-00': 700 } }); await route(page, '/gallery?q=00'); await page.waitForTimeout(80); await route(page, '/gallery?q=01'); await expect(page.locator('.ga-card h2')).toHaveText('测试展品 01 ABC'); await page.waitForTimeout(750); await expect(page.locator('.ga-card h2')).toHaveText('测试展品 01 ABC');
  await route(page, '/gallery/test-00'); await page.waitForTimeout(80); await route(page, '/gallery/test-01'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试展品 01 ABC'); await page.waitForTimeout(750); await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试展品 01 ABC');
});
test('two tabs recheck favorite state on focus and explicit refresh', async ({ page, context }) => {
  const name = await open(page, '/gallery/test-00'); const second = await context.newPage(); await open(second, '/gallery/test-00', name);
  await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible(); await second.evaluate(() => dispatchEvent(new Event('focus'))); await expect(second.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await second.getByRole('button', { name: '取消收藏', exact: true }).click(); await expect(second.getByRole('button', { name: '收藏', exact: true })).toBeVisible(); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeVisible();
});
test('IndexedDB unavailable and favorite read failure still allow public browsing', async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('test denied', 'SecurityError'); } })); await open(page); await ready(page); await expect(page.getByText(/收藏不可用或操作失败/)).toBeVisible(); await expect(page.getByRole('button', { name: '收藏状态未知' })).toHaveCount(12);
  const second = await context.newPage(); await open(second); await control(second, { readFailure: true }); await second.evaluate(() => dispatchEvent(new Event('focus'))); await expect(second.getByText(/测试读取失败/)).toBeVisible(); await expect(second.getByRole('button', { name: '收藏状态未知' })).toHaveCount(12);
});
test('100 personal works do not block favorites', async ({ page }) => {
  const name = await open(page, '/gallery/test-00');
  const count = await page.evaluate(async ({ name, seed, module }) => { const { openIndexedDbRepository } = await import(/* @vite-ignore */ module) as typeof import('@shoushang/local-repository'); const r = await openIndexedDbRepository({ name }); if (!r.ok) throw new Error(r.error.code); try { for (let i = 0; i < 100; i++) { const result = await r.value.save({ work: { ...seed, id: `full-${i}` }, expectedRevision: null }); if (!result.ok) throw new Error(result.error.code); } const listed = await r.value.list(); return listed.ok ? listed.value.total : -1; } finally { r.value.close(); } }, { name, seed: createFixtureWork(), module: '/@fs/' + join(process.cwd(), 'packages/local-repository/src/index.ts').replaceAll('\\', '/') });
  expect(count).toBe(100); await page.getByRole('button', { name: '收藏', exact: true }).click(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible(); expect(await favorites(page, name)).toHaveLength(1);
});
test('favorite validation uses at most three workers and preserves repository order', async ({ page }) => {
  const name = await open(page); await ready(page);
  await page.evaluate(async ({ name, module }) => { const { openIndexedDbRepository } = await import(/* @vite-ignore */ module) as typeof import('@shoushang/local-repository'); const r = await openIndexedDbRepository({ name }); if (!r.ok) throw new Error(r.error.code); try { for (let i = 0; i < 9; i++) await r.value.favorites.put({ exhibitId: `test-0${i}`, createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }); } finally { r.value.close(); } }, { name, module: '/@fs/' + join(process.cwd(), 'packages/local-repository/src/index.ts').replaceAll('\\', '/') });
  const expected = await favorites(page, name); await control(page, { delay: Object.fromEntries(expected.map(f => [f.exhibitId, 50])), calls: [], maxActive: 0 }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await route(page, '/my/favorites'); await expect(page.locator('.ga-card')).toHaveCount(9);
  expect(await page.evaluate(() => window.m10.maxActive)).toBeLessThanOrEqual(3); expect(await page.locator('.ga-card h2').allTextContents()).toEqual(expected.map(f => `测试展品 ${f.exhibitId.slice(-2)} ABC`));
});
test('narrow screen, long submitted text and keyboard controls stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page); await ready(page); await page.getByLabel('搜索展品').focus(); await page.keyboard.type('ABC'); await page.keyboard.press('Enter'); await ready(page); await page.getByLabel('分类').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByText(/共 16 件/)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/narrow.png', fullPage: true }); await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/narrow-viewport.png' });
  await page.getByLabel('搜索展品').fill('长文本'.repeat(33)); await page.getByRole('button', { name: '搜索', exact: true }).click(); await expect(page.getByRole('heading', { name: '没有匹配展品' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await route(page, '/gallery/test-30'); await expect(page.locator('.ga-prose')).toContainText('测试长正文'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'apps/web/src/features/gallery/evidence/narrow-detail.png' });
});
test('production App integrates routes, native link new-tab semantics and browser history', async ({ page, context }) => {
  await page.goto('/'); await page.getByRole('link', { name: '逛数字展馆', exact: true }).click(); await expect(page).toHaveURL(/\/gallery$/); await expect(page.locator('.ga-card')).toHaveCount(1); await page.getByRole('link', { name: '开发占位：几何纸样', exact: true }).click(); await expect(page).toHaveURL(/\/gallery\/exhibit-dev-paper/); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发占位：几何纸样'); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发占位：几何纸样');
  await page.goBack(); await expect(page).toHaveURL(/\/gallery$/); await page.goForward(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发占位：几何纸样');
  const newPage = context.waitForEvent('page'); await page.getByRole('link', { name: '我的收藏', exact: true }).click({ modifiers: ['Control'] }); const other = await newPage; await expect(other.getByRole('heading', { name: '我的收藏', exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/gallery\/exhibit-dev-paper/);
});
