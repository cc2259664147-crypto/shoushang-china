import { test, expect, type Page } from '@playwright/test';
import type { M11Controls } from '../stories/testing';
const entry = '/src/features/stories/testing.html';
const evidence = 'apps/web/src/features/home/evidence';
async function open(page: Page, route = '/') { await page.goto(`${entry}?${new URLSearchParams({ route, db: `m07-test-m11-${crypto.randomUUID()}` })}`); }
async function control(page: Page, patch: Partial<M11Controls>) { await page.evaluate(value => Object.assign(window.m11, value), patch); }
async function route(page: Page, target: string) { await page.evaluate(value => window.m11Route(value), target); }
async function recheck(page: Page) { await page.getByRole('button', { name: '重新核验故事' }).click(); }
const title = (n: string) => `测试故事 ${n}（非真实人物）`;

test('production hero, both primary entries, engineering and unknown routes', async ({ page }) => {
  await page.goto(`/?m07db=m07-test-m11-${crypto.randomUUID()}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('手上中国');
  await expect(page.getByText(/完成创作、在本浏览器保存/)).toBeVisible();
  await page.screenshot({ path: `${evidence}/home.png`, fullPage: true });
  await page.getByRole('link', { name: /^开始剪纸/ }).click(); await expect(page).toHaveURL(/\/workshop\/papercut\?m07db=m07-test-m11-/); await expect(page.getByRole('heading', { name: '剪纸工坊' })).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click(); await page.getByRole('link', { name: '逛数字展馆' }).click(); await expect(page).toHaveURL(/\/gallery$/);
  await page.goto('/engineering'); await expect(page.getByRole('heading', { name: '手上中国 · 工程检查页' })).toBeVisible(); await expect(page.getByRole('link', { name: /后端健康检查/ })).toHaveAttribute('href', '/health');
  await page.goto('/missing-m11-page'); await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible();
});
test('home real quantities, empty, failure and retry never block main flow', async ({ page }) => {
  await open(page); await expect(page.locator('.hm-card')).toHaveCount(1); await expect(page.locator('.hm-story')).toHaveCount(2);
  await control(page, { home: 'failure' }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.getByText(/精选内容加载失败（NETWORK_ERROR）/)).toBeVisible(); await expect(page.getByRole('link', { name: /^开始剪纸/ })).toBeVisible(); await expect(page.getByRole('heading', { name: '暂无精选展品' })).toHaveCount(0);
  await control(page, { home: 'empty' }); await page.getByRole('button', { name: '重试', exact: true }).click(); await expect(page.getByRole('heading', { name: '暂无精选展品' })).toBeVisible(); await expect(page.getByRole('heading', { name: '暂无精选故事' })).toBeVisible();
  await control(page, { home: 'normal' }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.locator('.hm-card')).toHaveCount(1); await expect(page.locator('.hm-story')).toHaveCount(2);
  await expect(page.locator('.hm-card a')).toHaveAttribute('href', '/gallery/exhibit-dev-paper'); await expect(page.locator('.hm-story a').first()).toHaveAttribute('href', '/stories/story-test-00');
});
test('pending home request leaves start and navigation available', async ({ page }) => {
  await open(page); await expect(page.locator('.hm-card')).toHaveCount(1); await control(page, { delay: { home: 1500 } }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.getByRole('status', { name: '' }).filter({ hasText: '读取精选展品' })).toBeVisible(); await page.getByRole('link', { name: '逛数字展馆' }).click(); await expect(page.getByRole('heading', { name: '数字展馆', exact: true })).toBeVisible();
});

test('home caps unique selections at six exhibits and three stories with exact detail links', async ({ page }) => {
  await open(page); await expect(page.locator('.hm-card')).toHaveCount(1);
  await control(page, { home: 'full' }); await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(page.locator('.hm-card')).toHaveCount(6); await expect(page.locator('.hm-story')).toHaveCount(3);
  expect(await page.locator('.hm-card h3 a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(Array.from({ length: 6 }, (_, i) => `/gallery/exhibit-test-${i}`));
  expect(await page.locator('.hm-story h3 a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(Array.from({ length: 3 }, (_, i) => `/stories/story-test-0${i}`));
  for (const width of [1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: `${evidence}/narrow-full-selections.png`, fullPage: true });
  await page.locator('.hm-card h3 a').nth(4).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试展品 4（非正式文化内容）');
});
test('story sort order, 12 per page, filtering, clearing, URL refresh and boundaries', async ({ page }) => {
  await open(page, '/stories'); await expect(page.locator('.st-card')).toHaveCount(12); await expect(page.locator('.st-card h2').first()).toHaveText(title('00')); await expect(page.locator('.st-card h2').last()).toHaveText(title('11'));
  await page.getByRole('link', { name: '下一页', exact: true }).click(); await expect(page.getByText('第 2 / 3 页 · 共 31 篇')).toBeVisible(); await page.reload(); await expect(page.locator('.st-card h2').first()).toHaveText(title('12'));
  await page.getByLabel('工艺', { exact: true }).selectOption('craft-test-other'); await expect(page.getByText('第 1 / 1 页 · 共 5 篇')).toBeVisible(); await expect(page).toHaveURL(/route=%2Fstories%3FcraftId%3Dcraft-test-other/); await expect(page.locator('.st-card')).toHaveCount(5); await expect(page.getByRole('link', { name: '下一页', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '清空筛选', exact: true }).click(); await expect(page.locator('.st-card')).toHaveCount(12); await route(page, '/stories?page=99'); await expect(page.getByRole('heading', { name: '页码超出范围' })).toBeVisible(); await page.getByRole('link', { name: '前往有效末页' }).click(); await expect(page.locator('.st-card')).toHaveCount(7);
});
test('invalid query and ID stay explicit without default replacement', async ({ page }) => {
  for (const target of ['/stories?page=0', '/stories?craftId=bad.id', '/stories?page=1&page=2']) { await open(page, target); await expect(page.getByText(/查询参数错误/)).toBeVisible(); await expect(page.locator('.st-card')).toHaveCount(0); }
  await route(page, '/stories/bad.id'); await expect(page.getByRole('heading', { name: '故事 ID 无效' })).toBeVisible();
  await route(page, '/stories?craftId=unknown'); await expect(page.getByText(/工艺 ID 未匹配公开目录/)).toBeVisible(); await expect(page.getByRole('heading', { name: '没有匹配故事' })).toBeVisible();
});
test('list and crafts failures have independent retry and never masquerade as empty', async ({ page }) => {
  await open(page); await expect(page.locator('.hm-card')).toHaveCount(1); await control(page, { listFailure: true, craftsFailure: true }); await route(page, '/stories'); await expect(page.getByText(/故事列表加载失败（NETWORK_ERROR）/)).toBeVisible(); await expect(page.getByText(/工艺读取失败：NETWORK_ERROR/)).toBeVisible(); await expect(page.getByRole('heading', { name: '没有匹配故事' })).toHaveCount(0);
  await control(page, { listFailure: false, craftsFailure: false }); await page.locator('.st-filters').getByRole('button', { name: '重试', exact: true }).click(); await page.locator('.st-list-slot').getByRole('button', { name: '重试', exact: true }).click(); await expect(page.locator('.st-card')).toHaveCount(12); await expect(page.getByLabel('工艺', { exact: true })).toBeVisible();
});
test('detail back restores filter, page, scroll and focused card through history', async ({ page }) => {
  const list = '/stories?craftId=craft-papercut&page=2'; await open(page, list); await expect(page.locator('.st-card')).toHaveCount(12);
  const card = page.getByRole('link', { name: title('21'), exact: true }); await card.scrollIntoViewIfNeeded(); const offset = await card.evaluate(e => e.getBoundingClientRect().top); await card.click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('21'));
  await page.getByRole('link', { name: '返回故事列表' }).click(); await expect(page.getByText('第 2 / 3 页 · 共 26 篇')).toBeVisible(); await expect(card).toBeFocused(); expect(Math.abs(await card.evaluate(e => e.getBoundingClientRect().top) - offset)).toBeLessThan(8);
  await card.click(); await page.goBack(); await expect(card).toBeFocused(); await page.goForward(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('21')); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('21'));
});
for (const count of [0, 1, 2, 3]) test(`${count} source-backed experience nodes use correct layout and original date labels`, async ({ page }) => {
  await open(page, `/stories/story-test-0${count}`); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title(`0${count}`));
  await expect(page.locator('.st-timeline')).toHaveCount(count >= 3 ? 1 : 0); await expect(page.locator('.st-experience li')).toHaveCount(count);
  if (count) { await expect(page.getByRole('heading', { name: '早年（测试原文）' })).toBeVisible(); await page.locator('.st-experience summary').first().click(); await expect(page.locator('.st-experience details').first().getByRole('link', { name: /来源：测试来源/ })).toBeVisible(); }
  else await expect(page.getByText('尚未配置有来源的经历记录。')).toBeVisible();
  if (count === 3 || count === 2) await page.screenshot({ path: `${evidence}/experience-${count}.png`, fullPage: true });
});
test('development identity, controlled text, fact sources and media licensing remain distinct', async ({ page }) => {
  await page.goto('/stories/story-dev-process'); await expect(page.getByRole('heading', { name: '未配置真实人物' })).toBeVisible(); await expect(page.getByText(/开发示例 · 仅用于工程验证/)).toBeVisible();
  await open(page, '/stories/story-test-03'); await expect(page.locator('.st-prose').first()).toContainText('<script>不执行任意 HTML</script>'); await expect(page.locator('.st-prose script')).toHaveCount(0); await expect(page.getByRole('heading', { name: '事实来源', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '图像来源与媒体许可' })).toBeVisible();
  for (const link of await page.locator('a[target="_blank"]').all()) { await expect(link).toHaveAttribute('rel', 'noopener noreferrer'); await expect(link).toContainText('新标签页'); }
});
test('related exhibit remains visible when the template has no editor profile', async ({ page }) => {
  await open(page, '/stories/story-test-03');
  await expect(page.getByRole('link', { name: /^关联展品：/ })).toHaveAttribute('href', '/gallery/exhibit-dev-paper');
  await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^体验关联模板：/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.m11.calls)).toEqual(expect.arrayContaining(['story-test-03', 'exhibit-dev-paper', 'template-m11-second']));
});
for (const template of ['missing', 'disabled', 'other', 'unsupported', 'wrong-id'] as const) test(`template ${template} hides experience without hiding story`, async ({ page }) => {
  await open(page, '/stories'); await control(page, { template }); await route(page, '/stories/story-test-03'); await expect(page.getByText(/没有经核验可体验/)).toBeVisible(); await expect(page.getByRole('link', { name: /^体验关联模板：/ })).toHaveCount(0); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('03'));
});
test('other craft never enters papercut, relation failures preserve story', async ({ page }) => {
  await open(page, '/stories/story-test-27'); await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
  for (const related of ['missing', 'failure', 'wrong-id'] as const) { await control(page, { related }); await recheck(page); await expect(page.getByText(related === 'missing' ? /关联展品 exhibit-dev-paper：不存在或不可公开访问/ : /关联展品 exhibit-dev-paper：核验失败/)).toBeVisible(); await expect(page.getByRole('link', { name: /^关联展品：/ })).toHaveCount(0); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('27')); }
});
test('404, forbidden, network failure, invalid return and retry are distinct', async ({ page }) => {
  await open(page, '/stories/missing?returnTo=https://evil.invalid'); await expect(page.getByRole('heading', { name: '故事不可用' })).toBeVisible(); await expect(page.getByRole('link', { name: '返回故事列表' })).toHaveAttribute('href', '/stories');
  await control(page, { network: ['story-test-01'] }); await route(page, '/stories/story-test-01'); await expect(page.getByRole('heading', { name: '故事加载失败' })).toBeVisible(); await control(page, { network: [] }); await page.getByRole('button', { name: '重试', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('01'));
  await control(page, { forbidden: ['story-test-01'] }); await recheck(page); await expect(page.getByRole('heading', { name: '故事不可用' })).toBeVisible(); await expect(page.locator('.st-detail-intro img')).toHaveCount(0);
});
test('visible story unavailable on recheck clears cover, body and associations; late response cannot revive', async ({ page }) => {
  await open(page, '/stories/story-test-03'); await expect(page.locator('.st-detail-intro img')).toHaveCount(1); await control(page, { delay: { 'story-test-03': 800 } }); await recheck(page); await expect(page.locator('.st-detail-intro')).toHaveCount(0); await page.waitForTimeout(80); await control(page, { missing: ['story-test-03'], delay: {} }); await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.getByRole('heading', { name: '故事不可用' })).toBeVisible(); await page.waitForTimeout(1000); await expect(page.locator('.st-prose,.st-detail-intro,.st-relations')).toHaveCount(0);
});
test('late queries and same-path ID changes cannot overwrite newer content', async ({ page }) => {
  await open(page, '/stories'); await expect(page.locator('.st-card')).toHaveCount(12); await control(page, { delay: { 'craft:craft-test-other': 700, 'story-test-00': 700 } });
  await route(page, '/stories?craftId=craft-test-other'); await page.waitForTimeout(80); await route(page, '/stories?craftId=craft-papercut'); await expect(page.locator('.st-card h2').first()).toHaveText(title('00')); await page.waitForTimeout(800); await expect(page.getByText('第 1 / 3 页 · 共 26 篇')).toBeVisible();
  await route(page, '/stories/story-test-00'); await page.waitForTimeout(80); await route(page, '/stories/story-test-01'); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('01')); await page.waitForTimeout(800); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('01'));
});
test('narrow menu keyboard Escape and close restore focus; long text and failed pictures fit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, '/stories'); const toggle = page.getByRole('button', { name: '打开导航' }); await toggle.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: '关闭导航' })).toHaveAttribute('aria-expanded', 'true'); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: '展馆', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(toggle).toBeFocused();
  await toggle.click(); await page.getByRole('button', { name: '关闭导航' }).click(); await expect(toggle).toBeFocused(); await toggle.click(); await page.getByRole('link', { name: '匠人故事', exact: true }).click(); await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await page.screenshot({ path: `${evidence}/narrow-list.png`, fullPage: true });
  await control(page, { imageFailure: true }); await route(page, '/stories/story-test-30'); await expect(page.getByRole('img', { name: /^图片加载失败/ })).toBeVisible(); await expect(page.locator('.st-prose').first()).toContainText('LongUnbrokenTextForLayout'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `${evidence}/narrow-long.png`, fullPage: true }); await page.screenshot({ path: `${evidence}/narrow-detail-viewport.png` }); await page.locator('.st-prose').first().evaluate(e => e.scrollIntoView({ block: 'start' })); await page.screenshot({ path: `${evidence}/narrow-body-viewport.png` });
});
test('reduced motion retains all entries and no audio plays on first or cross-page visits', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.addInitScript(() => { const state = window as Window & { audioPlays?: number }; state.audioPlays = 0; HTMLMediaElement.prototype.play = function () { state.audioPlays = (state.audioPlays ?? 0) + 1; return Promise.resolve(); }; });
  await page.goto('/'); await expect(page.getByRole('link', { name: /^开始剪纸/ })).toBeVisible(); await expect(page.getByRole('link', { name: '逛数字展馆' })).toBeVisible(); await page.getByRole('link', { name: '浏览故事列表 →' }).click(); await page.getByRole('link', { name: '开发占位：数字体验说明', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发占位：数字体验说明'); expect(await page.evaluate(() => (window as Window & { audioPlays?: number }).audioPlays)).toBe(0); await expect(page.locator('audio,video')).toHaveCount(0);
});
test('production home to story, gallery and supported workshop, with native new-tab', async ({ page, context }) => {
  await page.addInitScript(prefix => {
    const nativeOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) { return version === undefined ? nativeOpen.call(this, `${prefix}-${name}`) : nativeOpen.call(this, `${prefix}-${name}`, version); };
  }, `m07-test-m11-routing-${crypto.randomUUID()}`);
  await page.goto(`/?m07db=m07-test-m11-${crypto.randomUUID()}`); await page.getByRole('link', { name: '开发占位：数字体验说明', exact: true }).click(); await expect(page).toHaveURL(/\/stories\/story-dev-process$/); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('开发占位：数字体验说明');
  const popup = context.waitForEvent('page'); await page.getByRole('link', { name: /^关联展品：/ }).click({ modifiers: ['Control'] }); const tab = await popup; await expect(tab.getByRole('heading', { level: 1 })).toHaveText('开发占位：几何纸样'); await expect(page).toHaveURL(/\/stories\/story-dev-process$/); await tab.close();
  await page.getByRole('link', { name: /^关联展品：/ }).click(); await expect(page.getByRole('link', { name: '关联故事：开发占位：数字体验说明' })).toBeVisible();
  await expect(page.getByText(/没有经核验可体验/)).toBeVisible();
  await page.getByRole('link', { name: '手上中国 · 首页' }).click();
  await page.getByRole('link', { name: /^开始剪纸/ }).click();
  await page.locator('article').filter({ hasText: '自由造型：花形与几何' }).getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
});
test('gallery verifies related stories and withdraws unavailable link without stale photos', async ({ page }) => {
  await open(page, '/gallery/exhibit-dev-paper'); await expect(page.getByRole('link', { name: '关联故事：开发占位：数字体验说明' })).toBeVisible(); await control(page, { missing: ['story-dev-process'] }); await page.getByRole('button', { name: '重新核验展品' }).click(); await expect(page.getByText('关联故事 story-dev-process：不存在或不可公开访问')).toBeVisible(); await expect(page.locator('a[href^="/stories/"]')).toHaveCount(0); await expect(page.locator('.ga-detail-media img')).toHaveCount(1);
});
test('desktop list and narrow hero visual evidence with overflow assertions', async ({ page }) => {
  await open(page, '/stories'); await expect(page.locator('.st-card')).toHaveCount(12); await page.screenshot({ path: `${evidence}/stories.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await expect(page.locator('.hm-card')).toHaveCount(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `${evidence}/narrow-home.png`, fullPage: true });
});
test('return position works without session storage and later focus rechecks do not steal focus', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('M11 test denied', 'SecurityError'); } }));
  await open(page, '/stories?page=2');
  const card = page.getByRole('link', { name: title('21'), exact: true });
  await card.scrollIntoViewIfNeeded(); await card.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title('21'));
  await page.getByRole('link', { name: '返回故事列表' }).click(); await expect(card).toBeFocused();
  await page.evaluate(() => scrollBy(0, 180));
  await page.getByLabel('工艺', { exact: true }).evaluate(e => (e as HTMLElement).focus({ preventScroll: true }));
  const y = await page.evaluate(() => scrollY);
  await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.locator('.st-card')).toHaveCount(12);
  await expect(page.getByLabel('工艺', { exact: true })).toBeFocused();
  expect(Math.abs(await page.evaluate(() => scrollY) - y)).toBeLessThan(8);
});
