import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const evidence = resolve(process.env.M14_4_SITE_EVIDENCE!);
const mapping = JSON.parse(readFileSync(resolve(process.env.M14_4_MAPPING!), 'utf8')) as { contents: { candidate: string; kind: string; actualContentId: string }[] };
mkdirSync(evidence, { recursive: true });
const exhibit = (candidate: string) => mapping.contents.find(item => item.candidate === candidate && item.kind === 'exhibit')!;
const story = (candidate: string) => mapping.contents.find(item => item.candidate === candidate && item.kind === 'story')!;

async function loadedImages(page: import('@playwright/test').Page) {
  return page.locator('img').evaluateAll(nodes => nodes.map(node => ({ alt: node.getAttribute('alt'), complete: (node as HTMLImageElement).complete, width: (node as HTMLImageElement).naturalWidth, height: (node as HTMLImageElement).naturalHeight })));
}
async function ensureImages(page: import('@playwright/test').Page) {
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) await images.nth(index).scrollIntoViewIfNeeded();
  await expect.poll(async () => (await loadedImages(page)).every(image => image.complete && image.width > 0 && image.height > 0)).toBe(true);
  return loadedImages(page);
}
async function layout(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, targets: [...document.querySelectorAll('a,button,input,select')].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(node => ({ name: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 50), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })) }));
}

test('normal app shows candidate home, 12 exhibits, search/filter, detail media and attribution', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: '精选展品' })).toBeVisible(); await expect(page.locator('.hm-card')).toHaveCount(6); await expect(page.locator('.hm-story')).toHaveCount(3);
  let images = await ensureImages(page); expect(images.length).toBeGreaterThanOrEqual(9);
  await page.screenshot({ path: join(evidence, 'home-1440.png'), fullPage: true });
  await page.goto('/gallery'); await expect(page.getByText('共 12 件')).toBeVisible(); await expect(page.locator('.ga-card')).toHaveCount(12);
  images = await ensureImages(page); expect(images).toHaveLength(12);
  await page.getByLabel('搜索展品').fill('白毛女'); await page.getByRole('button', { name: '搜索' }).click(); await expect(page.getByRole('heading', { name: '《白毛女》剪纸组' })).toBeVisible();
  await page.goto(`/gallery/${exhibit('E-R15').actualContentId}`); await expect(page.getByRole('heading', { name: '《红色娘子军》剪纸组' })).toBeVisible(); await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible(); await expect(page.getByRole('heading', { name: '图像来源与媒体许可' })).toBeVisible(); await expect(page.getByText(/National Gallery of Victoria/).first()).toBeVisible(); await expect(page.getByRole('link', { name: /来源外链/ })).toHaveAttribute('href', 'https://www.ngv.vic.gov.au/explore/collection/work/132510/');
  await expect(page.getByText('图像来源：https://www.ngv.vic.gov.au/explore/collection/work/132510/')).toBeVisible(); await expect(page.getByRole('link', { name: /许可外链/ })).toHaveAttribute('href', 'https://www.ngv.vic.gov.au/explore/collection/work/132510/'); await expect(page.getByText(/修改说明：从NGV页面公开的XL图像端点取得；未裁切、未重采样、未调色/)).toBeVisible();
  images = await ensureImages(page); expect(images).toHaveLength(1); await page.screenshot({ path: join(evidence, 'exhibit-er15-detail.png'), fullPage: true });
});

test('three stories retain sources, editorial-cover warning and no exhibit associations', async ({ page }) => {
  await page.goto('/stories'); await expect(page.getByText('共 3 篇')).toBeVisible(); await expect(page.locator('.st-card')).toHaveCount(3);
  for (const candidate of ['S-C01', 'S-C02', 'S-C03']) {
    await page.goto(`/stories/${story(candidate).actualContentId}`); await expect(page.getByRole('heading', { name: '故事正文' })).toBeVisible(); await expect(page.getByRole('heading', { name: '事实来源' })).toBeVisible(); await expect(page.getByText('未配置关联展品。')).toBeVisible(); await expect(page.getByText(/非人物肖像或人物作品/).first()).toBeVisible(); const images = await ensureImages(page); expect(images).toHaveLength(1);
  }
  await page.goto(`/stories/${story('S-C02').actualContentId}`); await expect(page.getByText(/SRC-04/).first()).toBeVisible(); await page.goto(`/stories/${story('S-C03').actualContentId}`); await expect(page.getByText(/SRC-05/).first()).toBeVisible(); await page.screenshot({ path: join(evidence, 'story-sc03-detail.png'), fullPage: true });
});

for (const width of [360, 390, 768, 1440]) test(`${width}px candidate pages have no horizontal overflow and images remain visible`, async ({ page }) => {
  await page.setViewportSize({ width, height: width <= 390 ? 700 : 900 });
  const records: Record<string, unknown> = {};
  for (const [name, path] of [['home', '/'], ['gallery', '/gallery'], ['story', `/stories/${story('S-C01').actualContentId}`]] as const) {
    await page.goto(path); await expect(page.locator('main')).toBeVisible(); const measured = await layout(page); expect(measured.document).toBeLessThanOrEqual(measured.viewport + 1); const images = await ensureImages(page); records[name] = { measured, images };
  }
  await writeFile(join(evidence, `layout-${width}.json`), JSON.stringify(records, null, 2)); await page.screenshot({ path: join(evidence, `story-${width}.png`), fullPage: true });
});
