import { expect, test, type Page } from '@playwright/test';

async function dragPaper(page: Page, from: [number, number], to: [number, number]) {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const box = (await canvas.boundingBox())!;
  const base = Math.min(box.width, box.height), x = box.x + (box.width - base) / 2, y = box.y + (box.height - base) / 2;
  await page.mouse.move(x + from[0] * base, y + from[1] * base); await page.mouse.down();
  await page.mouse.move(x + to[0] * base, y + to[1] * base, { steps: 8 }); await page.mouse.up();
}
async function clickPaper(page: Page, x: number, y: number) {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const box = (await canvas.boundingBox())!, base = Math.min(box.width, box.height);
  await page.mouse.click(box.x + (box.width - base) / 2 + x * base, box.y + (box.height - base) / 2 + y * base);
}
async function draft(page: Page, name: string) {
  return page.evaluate(async dbName => new Promise<{ work: { operations: unknown[] } } | undefined>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('drafts', 'readonly'), rows = tx.objectStore('drafts').getAll();
      tx.oncomplete = () => { resolve(rows.result[0]); db.close(); }; tx.onerror = () => reject(tx.error);
    };
  }), name);
}

test('M16-N real site first creation through PNG', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name === 'mobile' ? { name: 'mobile', width: 390, height: 844 } : { name: 'desktop', width: 1440, height: 1000 };
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const name = `m07-test-m16n-${viewport.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await page.goto(`/workshop/papercut?m07db=${name}`);
    const template = page.locator('article').filter({ hasText: '自由造型：花形与几何' });
    await template.getByRole('button', { name: '使用模板' }).click();
    const guide = page.getByRole('complementary', { name: '开始剪纸' });
    await expect(guide).toContainText('展开视图'); await guide.getByRole('button', { name: '关闭使用帮助' }).click();
    const editor = page.locator('.m15b-editor'), canvas = page.getByRole('application', { name: /剪纸画布/ });
    await page.getByRole('button', { name: /^剪除笔刷B/ }).click(); await dragPaper(page, [.12, .15], [.22, .15]);
    await expect(editor).toHaveAttribute('data-operation-count', '1');
    await page.getByRole('button', { name: /^直线L/ }).click(); await dragPaper(page, [.12, .45], [.22, .45]);
    await expect(editor).toHaveAttribute('data-operation-count', '2');
    await page.getByRole('button', { name: /^圆形C/ }).click(); await dragPaper(page, [.14, .22], [.24, .32]);
    await expect(editor).toHaveAttribute('data-operation-count', '3');
    await page.getByRole('button', { name: /^矩形R/ }).click(); await dragPaper(page, [.25, .55], [.35, .65]);
    await expect(editor).toHaveAttribute('data-operation-count', '4');
    await page.getByRole('button', { name: /^选择V/ }).click(); await clickPaper(page, .19, .27);
    await expect(editor).toHaveAttribute('data-selected-id', /.+/);
    await page.getByLabel('中心 X', { exact: true }).fill('23'); await page.getByLabel('中心 Y', { exact: true }).fill('32');
    await page.getByLabel('旋转角度', { exact: true }).fill('30'); await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.getByLabel('中心 X', { exact: true })).toHaveValue('23');
    const originalId = await editor.getAttribute('data-selected-id');
    await page.getByRole('button', { name: '复制', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '5');
    await expect(editor).not.toHaveAttribute('data-selected-id', originalId!);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '4');
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(editor).toHaveAttribute('data-operation-count', '5');
    await page.getByRole('button', { name: '展开视图' }).click(); await expect(canvas).toHaveAttribute('data-view', 'unfolded');
    await expect.poll(async () => (await draft(page, name))?.work.operations.length).toBe(5);
    const saved = (await draft(page, name))!.work.operations;
    await page.reload(); await expect(editor).toHaveAttribute('data-operation-count', '5');
    expect((await draft(page, name))!.work.operations).toEqual(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '完成并保存作品' }).click(); await expect(page.getByText('作品已保存')).toBeVisible();
    await page.goto(`/my/works?m07db=${name}`);
    await expect(page.locator('.mw-version-actions').filter({ hasText: '完成版 · v2' })).toBeVisible();
    await page.locator('.mw-version-actions').filter({ hasText: '完成版 · v2' }).getByRole('button', { name: '导出 PNG' }).click();
    await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
    await expect(page.getByText('作品卡已生成', { exact: true }).last()).toBeVisible({ timeout: 20_000 });
    const pixels = await page.locator('.mw-export-preview').evaluate(async element => {
      const img = element as HTMLImageElement; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(img, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.round(200 + x * 1200), Math.round(130 + y * 1200), 1, 1).data);
      return { dimensions: [canvas.width, canvas.height], brush: pixel(.17, .15), line: pixel(.17, .45), circle: pixel(.23, .32), rectangle: pixel(.3, .6), paper: pixel(.1, .75) };
    });
    expect(pixels.dimensions).toEqual([1600, 2000]);
    expect(pixels.brush).toEqual(pixels.line); expect(pixels.circle).toEqual(pixels.line); expect(pixels.rectangle).toEqual(pixels.line);
    expect(pixels.paper).not.toEqual(pixels.line);
    const download = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PNG' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/i);
  });
