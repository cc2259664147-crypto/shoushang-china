import { expect, test, type Page } from '@playwright/test';

async function navigate(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: '打开导航' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: '全站导航' }).getByRole('link', { name, exact: true }).click();
}
async function layout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const broken = await page.locator('main img').evaluateAll(images => images.filter(image => {
    const img = image as HTMLImageElement;
    return img.complete && img.naturalWidth === 0;
  }).map(image => (image as HTMLImageElement).src));
  expect(broken).toEqual([]);
  const distorted = await page.locator('main img').evaluateAll(images => images.filter(image => {
    const img = image as HTMLImageElement, box = img.getBoundingClientRect();
    if (!img.complete || !img.naturalWidth || !box.width || !box.height) return false;
    const fit = getComputedStyle(img).objectFit;
    return !['contain', 'cover', 'scale-down'].includes(fit) && Math.abs(box.width / box.height - img.naturalWidth / img.naturalHeight) > .03;
  }).map(image => (image as HTMLImageElement).src));
  expect(distorted).toEqual([]);
}

test('first visit: homepage, workshop and content navigation', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile'; await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('手上中国');
  const start = page.getByRole('link', { name: '开始剪纸' }); await expect(start).toBeVisible();
  expect((await start.boundingBox())!.y).toBeLessThan(mobile ? 844 : 1000);
  await page.screenshot({ path: info.outputPath('homepage.png') });
  await expect(page.getByText('开发联调：自制几何纸样')).toBeVisible();
  await expect(page.getByText('开发联调：软件体验说明')).toBeVisible();
  const homeImages = page.locator('.hm-content img');
  for (const image of await homeImages.all()) { await image.scrollIntoViewIfNeeded(); await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0); }
  await layout(page);
  await navigate(page, '我的作品库'); await expect(page.getByRole('heading', { name: '还没有作品' })).toBeVisible(); await layout(page);
  await page.getByRole('link', { name: '手上中国 · 首页' }).click(); await start.click(); await expect(page).toHaveURL(/workshop\/papercut/);
  await expect(page.locator('article').filter({ hasText: '开发示意方纸' })).toHaveCount(0);
  await page.locator('article').filter({ hasText: '自由造型：花形与几何' }).getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '关闭使用帮助' }).click();
  for (const tool of [/^剪除笔刷B/, /^直线L/, /^圆形C/, /^矩形R/]) await expect(page.getByRole('button', { name: tool })).toBeVisible();
  await page.getByRole('button', { name: /^剪除笔刷B/ }).click();
  const canvas = page.getByRole('application', { name: /剪纸画布/ }); await canvas.evaluate(e => e.scrollIntoView({ block: 'center' }));
  const box = (await canvas.boundingBox())!, base = Math.min(box.width, box.height), x = box.x + (box.width - base) / 2, y = box.y + (box.height - base) / 2;
  await page.mouse.move(x + .13 * base, y + .2 * base); await page.mouse.down(); await page.mouse.move(x + .22 * base, y + .2 * base, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1'); await layout(page);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('region', { name: '作品保存状态' }).getByRole('status')).toHaveText('草稿已保存');
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/\/$/); await navigate(page, '展馆');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('展馆'); await layout(page);
  await page.getByRole('link', { name: '开发联调：自制几何纸样' }).click();
  await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible();
  await expect(page.getByText('项目自制开发几何示意')).toBeVisible();
  await expect(page.getByText('M01 开发占位说明')).toBeVisible();
  await expect(page.getByRole('link', { name: '体验关联模板：自由造型：花形与几何' })).toBeVisible();
  await expect(page.getByRole('link', { name: '体验关联模板：开发示意方纸' })).toHaveCount(0); await layout(page);
  await page.screenshot({ path: info.outputPath('gallery-detail.png'), fullPage: true });
  await page.getByRole('link', { name: '体验关联模板：自由造型：花形与几何' }).click();
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click(); await expect(page).toHaveURL(/\/$/);
  await navigate(page, '匠人故事'); await layout(page); await page.getByRole('link', { name: '开发联调：软件体验说明' }).click();
  await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible();
  await expect(page.getByText('署名：项目自制开发几何示意')).toBeVisible();
  await expect(page.getByText('没有经核验可体验的关联剪纸模板')).toBeVisible(); await layout(page);
  await navigate(page, '我的作品库'); await expect(page.getByRole('heading', { level: 1 })).toContainText('我的作品');
  await expect(page.getByRole('heading', { name: '还没有作品' })).not.toBeVisible();
  await layout(page);
});

test('content request failures show recovery messages and keep navigation usable', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.route('**/api/**', route => route.abort('failed'));
  await page.goto('/'); await expect(page.getByText(/精选内容加载失败/)).toBeVisible();
  await expect(page.getByRole('link', { name: '开始剪纸' })).toBeVisible(); await layout(page);
  await navigate(page, '展馆'); await expect(page.getByText(/无法连接内容服务|读取失败|加载失败/).first()).toBeVisible(); await layout(page);
  await navigate(page, '匠人故事'); await expect(page.getByText(/无法连接内容服务|读取失败|加载失败/).first()).toBeVisible(); await layout(page);
  await page.goto('/workshop/papercut'); await expect(page.getByText(/模板加载失败/)).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible(); await layout(page);
});
