import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const evidence = process.env.M14_3B_EVIDENCE!;
const dataRoot = process.env.M14_3B_DATA_ROOT!;
const cases = [
  { id: 'template-dev-c01', key: 'c01', max: 30, shapes: ['圆形', '水滴形'], first: '圆形', second: '水滴形', center: { x: .25, y: .5 }, palette: '#276B62' },
  { id: 'template-dev-c02', key: 'c02', max: 50, shapes: ['三角形', '水滴形'], first: '三角形', second: '水滴形', center: { x: .25, y: .5 }, palette: '#445566' },
  { id: 'template-dev-c03', key: 'c03', max: 80, shapes: ['圆形', '三角形', '水滴形'], first: '圆形', second: '三角形', center: { x: .73, y: .73 }, palette: '#276B62' },
] as const;
const dbName = () => `m07-test-m14-3b-${crypto.randomUUID()}`;
async function select(page: Page, key: string) {
  await expect(page.locator('.ws-template')).toHaveCount(key === 'after-disable' ? 2 : 3);
  const card = page.locator('.ws-template').filter({ hasText: `T-C${key.slice(1)}` });
  await card.getByRole('button', { name: '使用模板' }).click();
}
async function storedWork(page: Page, name: string): Promise<unknown> {
  return page.evaluate(async databaseName => new Promise((resolve, reject) => {
    const req = indexedDB.open(databaseName);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; const tx = db.transaction('works', 'readonly'); const all = tx.objectStore('works').getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result[0] ?? null); }; tx.onerror = () => reject(tx.error); };
  }), name);
}
async function pngPixels(page: Page, unfoldedSvg?: string) {
  return page.locator('.ws-export-result img').evaluate(async (node, svg) => {
    if (!(node instanceof HTMLImageElement)) throw new Error('Generated PNG preview missing');
    await node.decode();
    const bytes = Array.from(new Uint8Array(await (await fetch(node.src)).arrayBuffer()));
    const canvas = document.createElement('canvas'); canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas missing'); ctx.drawImage(node, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let paper = 0, holes = 0, transparent = 0, titleInk = 0;
    for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] !== 255) transparent++;
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 238 && y < 1500) holes++;
      if (y < 1500 && data[i] !== 248 && data[i + 1] !== 243 && data[i + 2] !== 233 && data[i] !== 255) paper++;
      if (y > 1580 && data[i]! < 120 && data[i + 1]! < 120 && data[i + 2]! < 120) titleInk++;
    }
    let svgMatch: { compared: number; matching: number } | null = null;
    if (svg) {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const art = document.createElement('canvas'); art.width = 1200; art.height = 1200;
        const artContext = art.getContext('2d'); if (!artContext) throw new Error('SVG comparison canvas missing');
        artContext.drawImage(image, 0, 0, 1200, 1200);
        const expected = artContext.getImageData(0, 0, 1200, 1200).data;
        let compared = 0, matching = 0;
        for (let y = 10; y < 1190; y += 20) for (let x = 10; x < 1190; x += 20) {
          const a = (y * 1200 + x) * 4, b = ((y + 130) * 1600 + x + 200) * 4;
          compared++;
          if (Math.abs(expected[a]! - data[b]!) <= 3 && Math.abs(expected[a + 1]! - data[b + 1]!) <= 3 && Math.abs(expected[a + 2]! - data[b + 2]!) <= 3) matching++;
        }
        svgMatch = { compared, matching };
      } finally { URL.revokeObjectURL(url); }
    }
    return { width: canvas.width, height: canvas.height, paper, holes, transparent, titleInk, svgMatch, bytes };
  }, unfoldedSvg);
}

test('normal built API exposes exactly three isolated candidate templates over HTTP', async ({ request }) => {
  const response = await request.get('/api/v1/templates?page=1&pageSize=50&craftId=craft-papercut');
  expect(response.ok()).toBe(true);
  const json: unknown = await response.json();
  expect(json).toMatchObject({ ok: true, value: { total: 3 } });
  const items = (json as { value: { items: { id: string }[] } }).value.items;
  expect(items.map(item => item.id).sort()).toEqual(cases.map(item => item.id).sort());
});

for (const item of cases) {
  test(`${item.key}: normal build create, edit, autosave, restore, complete, reopen, PNG pixels`, async ({ page }) => {
    const name = dbName();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?m07db=${name}`);
    await page.getByRole('link', { name: /^开始剪纸/ }).click();
    await select(page, item.key);
    for (const shape of item.shapes) await expect(page.getByRole('button', { name: shape, exact: true })).toBeVisible();
    for (const disallowed of ['圆形', '三角形', '水滴形'].filter(shape => !(item.shapes as readonly string[]).includes(shape))) await expect(page.getByRole('button', { name: disallowed, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: item.first }).click();
    await expect(page.getByText('候选切口可确认。')).toBeVisible();
    await expect(page.getByLabel('中心 X')).toHaveValue(String(item.center.x));
    await expect(page.getByLabel('中心 Y')).toHaveValue(String(item.center.y));
    await page.getByRole('button', { name: '右移' }).click();
    await page.getByLabel('宽度').fill('0.06');
    await page.getByLabel('高度').fill('0.07');
    await page.getByLabel('角度').fill('17');
    await expect(page.getByText('候选切口可确认。')).toBeVisible();
    await page.getByRole('button', { name: '确认剪切' }).click();
    await page.getByRole('button', { name: item.second }).click();
    await page.getByLabel('中心 Y').fill(String(item.center.y + .1));
    await page.getByRole('button', { name: '确认剪切' }).click();
    await expect(page.getByText(`切口 2 / ${item.max}`)).toBeVisible();
    await page.getByRole('button', { name: `纸色 ${item.palette}` }).click();
    await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
    await expect(page.locator('.ws-canvas svg')).toBeVisible();
    const expandedSvg = await page.locator('.ws-art svg').evaluate(node => node.outerHTML);
    await page.getByRole('button', { name: '折叠视图', exact: true }).click();
    const foldedSvg = await page.locator('.ws-art svg').evaluate(node => node.outerHTML);
    expect(expandedSvg).not.toBe(foldedSvg);
    await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
    await expect(page.getByText('草稿已保存')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /未命名作品/ }).click();
    await expect(page.getByText(`切口 2 / ${item.max}`)).toBeVisible();
    await expect(page.getByRole('button', { name: `纸色 ${item.palette}` })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '完成并保存作品' }).click();
    await expect(page.getByText('作品已保存')).toBeVisible();
    await page.getByRole('button', { name: '我的作品', exact: true }).click();
    await expect(page.getByText('共 1 件作品')).toBeVisible();
    await page.getByRole('button', { name: '编辑完成版' }).click();
    await expect(page.getByText(`切口 2 / ${item.max}`)).toBeVisible();
    await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
    await expect(page.getByText('作品卡已生成')).toBeVisible();
    const pixels = await pngPixels(page, expandedSvg);
    expect([pixels.width, pixels.height, pixels.transparent]).toEqual([1600, 2000, 0]);
    expect(pixels.paper).toBeGreaterThan(5000); expect(pixels.holes).toBeGreaterThan(100); expect(pixels.titleInk).toBeGreaterThan(100);
    expect((pixels.svgMatch?.matching ?? 0) / (pixels.svgMatch?.compared ?? 1)).toBeGreaterThan(.95);
    const pending = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PNG' }).click();
    const download = await pending; const path = join(evidence, `${item.key}-card.png`); await download.saveAs(path);
    const bytes = await readFile(path); expect([...bytes]).toEqual(pixels.bytes);
    const work = await storedWork(page, name); expect(work).toMatchObject({ templateSnapshot: { id: item.id, version: 1 }, operations: [{}, {}], palette: { paper: item.palette }, status: 'completed' });
    await writeFile(join(evidence, `${item.key}-work.json`), JSON.stringify(work, null, 2));
    await writeFile(join(evidence, `${item.key}-expanded.svg`), expandedSvg);
    await writeFile(join(evidence, `${item.key}-folded.svg`), foldedSvg);
    await writeFile(join(evidence, `${item.key}-pixels.json`), JSON.stringify({ ...pixels, bytes: bytes.length }, null, 2));
    await page.screenshot({ path: join(evidence, `${item.key}-desktop.png`), fullPage: true });
  });

  for (const width of item.key === 'c03' ? [390, 360] : [390]) {
    test(`${item.key}: ${width}px controls, legal initial placement, scroll reachability and keyboard values`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/workshop/papercut?m07db=${dbName()}`);
      await select(page, item.key);
      await page.getByRole('button', { name: item.first }).focus(); await page.keyboard.press('Enter');
      await expect(page.getByText('候选切口可确认。')).toBeVisible();
      const measures = await page.evaluate(() => {
        const targets = [...document.querySelectorAll('.ws-shapes button,.ws-nudge button,.ws-history button,.ws-swatches button')];
        const small = targets.filter(node => { const r = node.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(node => ({ text: node.getAttribute('aria-label') ?? node.textContent, rect: node.getBoundingClientRect().toJSON() }));
        const canvas = document.querySelector('.ws-canvas')?.getBoundingClientRect();
        return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, small, canvas: canvas?.toJSON() };
      });
      expect(measures.documentWidth).toBeLessThanOrEqual(measures.viewportWidth + 1);
      expect(measures.small).toEqual([]);
      expect(Math.abs((measures.canvas?.width ?? 0) - (measures.canvas?.height ?? 0))).toBeLessThan(2);
      await page.getByLabel('角度').fill('23'); await page.getByLabel('中心 X').fill(String(item.center.x));
      await expect(page.getByText('候选切口可确认。')).toBeVisible();
      await page.getByRole('button', { name: '确认剪切' }).focus(); await page.keyboard.press('Enter');
      await expect(page.getByText(`切口 1 / ${item.max}`)).toBeVisible();
      await writeFile(join(evidence, `${item.key}-${width}-layout.json`), JSON.stringify(measures, null, 2));
      await page.screenshot({ path: join(evidence, `${item.key}-${width}.png`), fullPage: true });
    });
  }
}

test('new version and disable affect new reads; old completed snapshot remains editable and exportable', async ({ page, request }) => {
  const name = dbName(); await page.goto(`/workshop/papercut?m07db=${name}`); await select(page, 'c01');
  await page.getByRole('button', { name: '圆形' }).click(); await page.getByRole('button', { name: '确认剪切' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '完成并保存作品' }).click(); await expect(page.getByText('作品已保存')).toBeVisible();
  const original = await storedWork(page, name);
  const mutate = (action: 'upgrade' | 'disable') => execFileSync(process.execPath, ['--import', 'tsx', resolve('tests/m14/manage-template.ts'), join(dataRoot, 'content.sqlite'), 'template-dev-c01', action], { stdio: 'pipe' });
  mutate('upgrade');
  const upgraded = await request.get('/api/v1/templates/template-dev-c01'); expect(upgraded.ok()).toBe(true);
  expect((await upgraded.json()) as unknown).toMatchObject({ ok: true, value: { version: 2, enabled: true } });
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.locator('.ws-template').filter({ hasText: 'T-C01' }).getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('切口 0 / 30')).toBeVisible();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  mutate('disable');
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await expect(page.locator('.ws-template').filter({ hasText: 'T-C01' })).toHaveCount(0);
  await page.goto(`/my/works?m07db=${name}`);
  await page.getByRole('button', { name: '编辑完成版' }).click();
  await expect(page.getByText('切口 1 / 30')).toBeVisible();
  const after = await storedWork(page, name); expect(after).toEqual(original);
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click(); await expect(page.getByText('作品卡已生成')).toBeVisible();
  const pixels = await pngPixels(page); expect(pixels.holes).toBeGreaterThan(100);
  await writeFile(join(evidence, 'snapshot-version-disable.json'), JSON.stringify({ original, after, pixels: { ...pixels, bytes: pixels.bytes.length } }, null, 2));
});
