import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { WorkSchema, type CutOperation } from '@shoushang/contracts';
import { createPapercutCore } from '@shoushang/papercut-core';
import { createArtworkRenderer } from '@shoushang/artwork-renderer';

const evidence = process.env.M14_3C_EVIDENCE!;
type Step = { shape: CutOperation['shape']; x: number; y: number; width: number; height: number; angle: number };
const plans: { key: string; id: string; color: string; max: number; steps: Step[] }[] = [
  { key: 'c01', id: 'template-dev-c01', color: '#276B62', max: 30, steps: [
    { shape: 'circle', x: .16, y: .25, width: .08, height: .08, angle: 0 },
    { shape: 'teardrop', x: .27, y: .22, width: .06, height: .09, angle: 18 },
    { shape: 'circle', x: .37, y: .28, width: .05, height: .05, angle: 0 },
    { shape: 'teardrop', x: .19, y: .43, width: .07, height: .10, angle: 32 },
    { shape: 'circle', x: .32, y: .47, width: .09, height: .07, angle: 0 },
    { shape: 'teardrop', x: .16, y: .66, width: .06, height: .09, angle: 338 },
    { shape: 'circle', x: .28, y: .70, width: .06, height: .06, angle: 0 },
    { shape: 'teardrop', x: .38, y: .76, width: .05, height: .08, angle: 18 },
  ] },
  { key: 'c02', id: 'template-dev-c02', color: '#445566', max: 50, steps: [
    { shape: 'triangle', x: .15, y: .23, width: .07, height: .08, angle: 18 },
    { shape: 'teardrop', x: .26, y: .19, width: .05, height: .09, angle: 38 },
    { shape: 'triangle', x: .36, y: .29, width: .08, height: .06, angle: 55 },
    { shape: 'teardrop', x: .17, y: .42, width: .06, height: .10, angle: 330 },
    { shape: 'triangle', x: .32, y: .45, width: .09, height: .07, angle: 28 },
    { shape: 'teardrop', x: .16, y: .67, width: .05, height: .08, angle: 18 },
    { shape: 'triangle', x: .27, y: .74, width: .07, height: .09, angle: 70 },
    { shape: 'teardrop', x: .37, y: .76, width: .05, height: .07, angle: 320 },
  ] },
  { key: 'c03', id: 'template-dev-c03', color: '#276B62', max: 80, steps: [
    { shape: 'circle', x: .61, y: .61, width: .07, height: .07, angle: 0 },
    { shape: 'triangle', x: .73, y: .60, width: .07, height: .08, angle: 22 },
    { shape: 'teardrop', x: .85, y: .63, width: .06, height: .09, angle: 47 },
    { shape: 'triangle', x: .63, y: .73, width: .07, height: .07, angle: 54 },
    { shape: 'circle', x: .75, y: .74, width: .09, height: .07, angle: 0 },
    { shape: 'teardrop', x: .86, y: .76, width: .05, height: .08, angle: 310 },
    { shape: 'circle', x: .64, y: .86, width: .05, height: .05, angle: 0 },
    { shape: 'triangle', x: .79, y: .86, width: .07, height: .07, angle: 18 },
  ] },
];
const shapeLabel = { circle: '圆形', triangle: '三角形', teardrop: '水滴形' } as const;

async function storedWork(page: import('@playwright/test').Page, name: string): Promise<unknown> {
  return page.evaluate(databaseName => new Promise((resolve, reject) => {
    const req = indexedDB.open(databaseName);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('works', 'readonly'), all = tx.objectStore('works').getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result[0] ?? null); };
      tx.onerror = () => reject(tx.error);
    };
  }), name);
}

for (const plan of plans) test(`${plan.key}: eight distinct UI cuts, persistence and PNG`, async ({ page }) => {
  const dbName = `m07-test-m14-3c-teaching-${crypto.randomUUID()}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workshop/papercut?m07db=${dbName}`);
  await page.locator('.ws-template').filter({ hasText: `T-C${plan.key.slice(1)}` }).getByRole('button', { name: '使用模板' }).click();
  for (const [index, step] of plan.steps.entries()) {
    await page.getByRole('button', { name: shapeLabel[step.shape], exact: true }).click();
    await page.getByLabel('中心 X').fill(String(step.x));
    await page.getByLabel('中心 Y').fill(String(step.y));
    await page.getByLabel('宽度').fill(String(step.width));
    await page.getByLabel('高度').fill(String(step.height));
    await page.getByLabel('角度').fill(String(step.angle));
    await expect(page.getByText('候选切口可确认。')).toBeVisible();
    await page.getByRole('button', { name: '确认剪切' }).click();
    await expect(page.getByText(`切口 ${index + 1} / ${plan.max}`)).toBeVisible();
  }
  console.log(`${plan.key}: eight cuts complete`);
  await page.getByRole('button', { name: `纸色 ${plan.color}` }).click();
  await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
  const expanded = await page.locator('.ws-art svg').evaluate(node => node.outerHTML);
  await page.getByRole('button', { name: '折叠视图', exact: true }).click();
  const folded = await page.locator('.ws-art svg').evaluate(node => node.outerHTML);
  expect(expanded).not.toEqual(folded);
  await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  console.log(`${plan.key}: draft saved`);
  await page.reload();
  await page.getByRole('button', { name: /未命名作品/ }).click();
  await expect(page.getByText(`切口 8 / ${plan.max}`)).toBeVisible();
  console.log(`${plan.key}: restored`);
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  console.log(`${plan.key}: completed`);
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  await page.getByRole('button', { name: '编辑完成版' }).click();
  await expect(page.getByText(`切口 8 / ${plan.max}`)).toBeVisible();
  console.log(`${plan.key}: reopened`);
  const work = WorkSchema.parse(await storedWork(page, dbName));
  expect(work.templateSnapshot.id).toBe(plan.id);
  expect(work.operations).toHaveLength(8);
  expect(work.operations.map(({ shape, center, width, height, angleDeg }) => ({ shape, x: center.x, y: center.y, width, height, angle: angleDeg }))).toEqual(plan.steps);
  const core = createPapercutCore();
  expect(core.validate(work).ok).toBe(true);
  const render = createArtworkRenderer().render({ work, width: 1200, height: 1200, view: 'unfolded' });
  expect(render.ok).toBe(true);
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible();
  console.log(`${plan.key}: card generated`);
  const pixels = await page.locator('.ws-export-result img').evaluate(async node => {
    if (!(node instanceof HTMLImageElement)) throw new Error('PNG preview missing');
    await node.decode();
    const image = document.createElement('canvas'); image.width = node.naturalWidth; image.height = node.naturalHeight;
    const context = image.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    context.drawImage(node, 0, 0); const data = context.getImageData(0, 0, image.width, image.height).data;
    let holes = 0, colored = 0, alpha = 0;
    for (let y = 150; y < 1300; y += 3) for (let x = 200; x < 1400; x += 3) {
      const i = (y * image.width + x) * 4;
      if (data[i + 3] !== 255) alpha++;
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 238) holes++;
      if (data[i] !== 248 && data[i + 1] !== 243 && data[i + 2] !== 233 && data[i] !== 255) colored++;
    }
    return { width: image.width, height: image.height, holes, colored, alpha, bytes: Array.from(new Uint8Array(await (await fetch(node.src)).arrayBuffer())) };
  });
  expect([pixels.width, pixels.height, pixels.alpha]).toEqual([1600, 2000, 0]);
  expect(pixels.holes).toBeGreaterThan(100);
  expect(pixels.colored).toBeGreaterThan(1000);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 PNG' }).click();
  await (await download).saveAs(join(evidence, `${plan.key}-teaching.png`));
  const bytes = await readFile(join(evidence, `${plan.key}-teaching.png`));
  expect([...bytes]).toEqual(pixels.bytes);
  await writeFile(join(evidence, `${plan.key}-work.json`), JSON.stringify(work, null, 2));
  await writeFile(join(evidence, `${plan.key}-expanded.svg`), render.ok ? render.value.svg : expanded);
  await writeFile(join(evidence, `${plan.key}-page-expanded.svg`), expanded);
  await writeFile(join(evidence, `${plan.key}-folded.svg`), folded);
  await writeFile(join(evidence, `${plan.key}-pixels.json`), JSON.stringify({ ...pixels, bytes: bytes.length }, (_key, value) => _key === 'bytes' && Array.isArray(value) ? value.length : value, 2));
  await page.screenshot({ path: join(evidence, `${plan.key}-teaching.png`.replace('.png', '-page.png')), fullPage: true });
});
