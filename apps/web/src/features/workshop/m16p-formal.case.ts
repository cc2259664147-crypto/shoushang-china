import { expect, test, type Page } from '@playwright/test';

interface Media { url: string; alt: string; author: string; license: { name: string; attribution: string } }
interface Item { id: string; title: string; sources: { title: string }[]; media?: Media[]; cover?: Media; templateId?: string }
async function list(page: Page, type: string): Promise<{ total: number; items: Item[] }> {
  const response = await page.request.get(`/api/v1/${type}?pageSize=50`); expect(response.ok()).toBe(true);
  return (await response.json()).value;
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function nav(page: Page, label: string) {
  const toggle = page.getByRole('button', { name: '打开导航' }); if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: '全站导航' }).getByRole('link', { name: label, exact: true }).click();
}
async function imageWorks(page: Page) {
  const image = page.locator('main img').first(); await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const fit = await image.evaluate((img: HTMLImageElement) => {
    const box = img.getBoundingClientRect(); return { ratio: box.width / box.height, natural: img.naturalWidth / img.naturalHeight, fit: getComputedStyle(img).objectFit };
  });
  expect(['contain', 'cover', 'scale-down'].includes(fit.fit) || Math.abs(fit.ratio - fit.natural) < .03).toBe(true);
}

test('formal content is visible, attributed and usable across the site', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.goto('/');
  const exhibits = await list(page, 'exhibits'), stories = await list(page, 'stories'), templates = await list(page, 'templates');
  expect([templates.total, exhibits.total, stories.total]).toEqual([4, 12, 3]);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('手上中国');
  await expect(page.getByRole('link', { name: '开始剪纸' })).toBeVisible();
  await expect(page.getByText(exhibits.items[0]!.title).first()).toBeVisible(); await noOverflow(page);
  await page.screenshot({ path: info.outputPath('home.png') });
  await nav(page, '展馆'); await expect(page.getByRole('heading', { level: 1 })).toContainText('展馆');
  await page.getByRole('link', { name: exhibits.items[0]!.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible(); await imageWorks(page); await noOverflow(page);
  await page.screenshot({ path: info.outputPath('exhibit.png'), fullPage: true });
  for (const exhibit of exhibits.items) {
    await page.goto(`/gallery/${encodeURIComponent(exhibit.id)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(exhibit.title);
    await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '图像来源与媒体许可' })).toBeVisible();
    expect(exhibit.sources.length).toBeGreaterThan(0); expect(exhibit.media![0]!.license.attribution.length).toBeGreaterThan(0);
    await expect(page.getByText(exhibit.sources[0]!.title).first()).toBeVisible();
    await expect(page.getByText(exhibit.media![0]!.license.attribution, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(exhibit.media![0]!.license.name, { exact: false }).first()).toBeVisible(); await imageWorks(page); await noOverflow(page);
  }
  await nav(page, '匠人故事'); await page.getByRole('link', { name: stories.items[0]!.title, exact: true }).click();
  for (const [index, story] of stories.items.entries()) {
    if (index) await page.goto(`/stories/${encodeURIComponent(story.id)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(story.title);
    await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '图像来源与媒体许可' })).toBeVisible();
    expect(story.sources.length).toBeGreaterThan(0); expect(story.cover!.license.attribution.length).toBeGreaterThan(0);
    await expect(page.getByText(story.sources[0]!.title).first()).toBeVisible();
    await expect(page.getByText(story.cover!.license.attribution, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(story.cover!.license.name, { exact: false }).first()).toBeVisible(); await imageWorks(page); await noOverflow(page);
    await expect(page.getByRole('link', { name: /^体验关联模板：/ })).toHaveAttribute('href', new RegExp(`templateId=${story.templateId}`));
  }
  await page.getByRole('link', { name: /^体验关联模板：/ }).click();
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click(); await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: '开始剪纸' }).click();
  await page.locator('article').filter({ hasText: '自由造型：花形与几何' }).getByRole('button', { name: '使用模板' }).click();
  const guide = page.getByRole('button', { name: '关闭使用帮助' }); if (await guide.isVisible()) await guide.click();
  await page.getByRole('button', { name: /^剪除笔刷B/ }).click();
  const canvas = page.getByRole('application', { name: /剪纸画布/ }); await canvas.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const box = (await canvas.boundingBox())!, base = Math.min(box.width, box.height), x = box.x + (box.width - base) / 2, y = box.y + (box.height - base) / 2;
  await page.mouse.move(x + .13 * base, y + .2 * base); await page.mouse.down(); await page.mouse.move(x + .23 * base, y + .2 * base, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: '完成并保存作品' }).click(); await expect(page.getByText('作品已保存')).toBeVisible(); await noOverflow(page);
});
