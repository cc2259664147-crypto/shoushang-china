import { expect, test, type Locator, type Page } from '@playwright/test';

const pageUrl = '/src/features/workshop/editor/testing.html?seed=1';

async function openEditor(page: Page, url = pageUrl): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
}

async function paperPosition(canvas: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

async function selectSeed(page: Page): Promise<Locator> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const point = await paperPosition(canvas, 0.2, 0.3);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('form', { name: '选中图形属性' })).toBeVisible();
  return canvas;
}

async function savedOperation(page: Page, databaseName: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(name => new Promise<Record<string, unknown> | null>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('drafts', 'readonly');
      const rows = transaction.objectStore('drafts').getAll();
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const work = rows.result[0]?.work as { operations?: Record<string, unknown>[] } | undefined;
        resolve(work?.operations?.[0] ?? null);
        database.close();
      };
    };
  }), databaseName);
}

test('property panel applies once by button or Enter and cancel/Escape restore confirmed values', async ({ page }) => {
  await openEditor(page);
  await selectSeed(page);
  const fields = {
    x: page.getByRole('spinbutton', { name: '中心 X' }),
    y: page.getByRole('spinbutton', { name: '中心 Y' }),
    width: page.getByRole('spinbutton', { name: '宽度' }),
    height: page.getByRole('spinbutton', { name: '高度' }),
    angle: page.getByRole('spinbutton', { name: '旋转角度' }),
  };
  await expect(fields.x).toHaveValue('20');
  await fields.x.fill('22'); await fields.y.fill('32'); await fields.width.fill('7'); await fields.height.fill('8'); await fields.angle.fill('15');
  await fields.angle.press('Enter');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  expect((await page.evaluate(() => window.m15b.getWork())).operations[1]).toMatchObject({ center: { x: 0.22, y: 0.32 }, width: 0.07, height: 0.08, angleDeg: 15 });

  await fields.x.fill('40'); await fields.x.press('Escape');
  await expect(fields.x).toHaveValue('22');
  await fields.width.fill('12'); await page.getByRole('button', { name: '取消' }).click();
  await expect(fields.width).toHaveValue('7');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

  await fields.height.fill('9'); await page.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  expect((await page.evaluate(() => window.m15b.getWork())).operations[1]).toMatchObject({ height: 0.09 });
});

test('invalid input and Worker rejection restore the panel without Work or history changes', async ({ page }) => {
  await openEditor(page);
  await selectSeed(page);
  const before = await page.evaluate(() => window.m15b.getWork());
  const width = page.getByRole('spinbutton', { name: '宽度' });
  await width.fill('0'); await page.getByRole('button', { name: '应用' }).click();
  await expect(page.getByRole('alert')).toContainText('无法应用属性：宽度必须大于 0%');
  await expect(width).toHaveValue('6');
  expect(await page.evaluate(() => window.m15b.getWork())).toEqual(before);

  const x = page.getByRole('spinbutton', { name: '中心 X' });
  await x.fill('49'); await page.getByRole('button', { name: '应用' }).click();
  await expect(page.getByRole('alert')).toContainText('无法应用属性：GEOMETRY_INVALID');
  await expect(x).toHaveValue('20');
  expect(await page.evaluate(() => window.m15b.getWork())).toEqual(before);
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
});

test('real keyboard nudges are exactly 1/10 screen pixels at multiple canvas zoom levels', async ({ page }) => {
  await openEditor(page);
  const canvas = await selectSeed(page);
  const outline = canvas.locator('.m15b-selection-outline');
  await canvas.focus();
  const start = await outline.boundingBox();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const one = await outline.boundingBox();
  expect(one!.x - start!.x).toBeCloseTo(1, 1);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  const ten = await outline.boundingBox();
  expect(ten!.y - one!.y).toBeCloseTo(10, 1);

  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('missing canvas');
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -500);
  await expect(canvas).not.toHaveAttribute('data-zoom', '1.000');
  await canvas.focus();
  const zoomed = await outline.boundingBox();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
  const zoomedMoved = await outline.boundingBox();
  expect(zoomedMoved!.x - zoomed!.x).toBeCloseTo(-1, 1);
});

test('freehand, brush and line selections nudge through the same Worker command without a property panel', async ({ page }) => {
  await openEditor(page, '/src/features/workshop/editor/testing.html');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const draw = async (points: ReadonlyArray<readonly [number, number]>): Promise<void> => {
    const first = await paperPosition(canvas, points[0]![0], points[0]![1]);
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    for (const [x, y] of points.slice(1)) {
      const point = await paperPosition(canvas, x, y);
      await page.mouse.move(point.x, point.y, { steps: 3 });
    }
    await page.mouse.up();
  };
  const selectAndNudge = async (x: number, y: number, key: string, confirmation: number): Promise<void> => {
    await page.getByRole('button', { name: /^选择V/ }).click();
    const point = await paperPosition(canvas, x, y);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole('form', { name: '选中图形属性' })).toHaveCount(0);
    await canvas.focus();
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(confirmation);
  };

  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await draw([[0.14, 0.18], [0.3, 0.18], [0.3, 0.32], [0.14, 0.32]]);
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const freehandBefore = await page.evaluate(() => window.m15b.getWork().operations[0]);
  await selectAndNudge(0.22, 0.24, 'ArrowRight', 2);
  const freehandAfter = await page.evaluate(() => window.m15b.getWork().operations[0]);
  if (freehandBefore?.kind !== 'freehand' || freehandAfter?.kind !== 'freehand') throw new Error('missing freehand');
  expect(freehandAfter.kind).toBe('freehand');
  expect(freehandAfter.points[0]!.x).toBeGreaterThan(freehandBefore.points[0]!.x);

  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await draw([[0.15, 0.48], [0.3, 0.48]]);
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
  await selectAndNudge(0.22, 0.48, 'ArrowDown', 4);
  expect((await page.evaluate(() => window.m15b.getWork().operations[1]?.kind))).toBe('brush');

  await page.getByRole('button', { name: /^直线L/ }).click();
  await draw([[0.15, 0.68], [0.3, 0.68]]);
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(5);
  await selectAndNudge(0.22, 0.68, 'Shift+ArrowLeft', 6);
  expect((await page.evaluate(() => window.m15b.getWork().operations[2]?.kind))).toBe('brush');
});

test('property edit and keyboard nudge undo and redo as separate Worker history entries', async ({ page }) => {
  await openEditor(page);
  const canvas = await selectSeed(page);
  const original = await page.evaluate(() => window.m15b.getWork().operations[1]);
  await page.getByRole('spinbutton', { name: '中心 X' }).fill('22');
  await page.getByRole('spinbutton', { name: '旋转角度' }).fill('15');
  await page.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const transformed = await page.evaluate(() => window.m15b.getWork().operations[1]);
  expect(transformed).toMatchObject({ center: { x: 0.22, y: 0.3 }, angleDeg: 15 });

  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  const nudged = await page.evaluate(() => window.m15b.getWork().operations[1]);
  expect(nudged).not.toEqual(transformed);

  await page.getByRole('button', { name: '撤销' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
  expect(await page.evaluate(() => window.m15b.getWork().operations[1])).toEqual(transformed);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(4);
  expect(await page.evaluate(() => window.m15b.getWork().operations[1])).toEqual(original);

  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(5);
  expect(await page.evaluate(() => window.m15b.getWork().operations[1])).toEqual(transformed);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(6);
  expect(await page.evaluate(() => window.m15b.getWork().operations[1])).toEqual(nudged);
});

test('precise properties auto-save and restore after a real workshop refresh', async ({ page }) => {
  const databaseName = `m07-test-m16k-${crypto.randomUUID()}`;
  await page.goto(`/workshop/papercut?m07db=${databaseName}`);
  await page.getByRole('button', { name: '使用模板' }).first().click();
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: /^圆形C/ }).click();
  const start = await paperPosition(canvas, 0.16, 0.22), end = await paperPosition(canvas, 0.24, 0.3);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');

  await page.getByRole('button', { name: /^选择V/ }).click();
  const center = await paperPosition(canvas, 0.2, 0.26);
  await page.mouse.click(center.x, center.y);
  await page.getByRole('spinbutton', { name: '中心 X' }).fill('21');
  await page.getByRole('spinbutton', { name: '中心 Y' }).fill('27');
  await page.getByRole('spinbutton', { name: '宽度' }).fill('8');
  await page.getByRole('spinbutton', { name: '高度' }).fill('9');
  await page.getByRole('spinbutton', { name: '旋转角度' }).fill('12');
  await page.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => savedOperation(page, databaseName)).toMatchObject({
    kind: 'parametric', center: { x: 0.21, y: 0.27 }, width: 0.08, height: 0.09, angleDeg: 12,
  });

  await page.reload();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  const restoredCenter = await paperPosition(canvas, 0.21, 0.27);
  await page.mouse.click(restoredCenter.x, restoredCenter.y);
  await expect(page.getByRole('spinbutton', { name: '中心 X' })).toHaveValue('21');
  await expect(page.getByRole('spinbutton', { name: '中心 Y' })).toHaveValue('27');
  await expect(page.getByRole('spinbutton', { name: '宽度' })).toHaveValue('8');
  await expect(page.getByRole('spinbutton', { name: '高度' })).toHaveValue('9');
  await expect(page.getByRole('spinbutton', { name: '旋转角度' })).toHaveValue('12');
});

test('validation disables property, delete, undo and editing tools at 720/1440 without overflow', async ({ page }) => {
  for (const width of [720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page, `${pageUrl}&delayDispatch=1`);
    await selectSeed(page);
    await page.getByRole('spinbutton', { name: '中心 X' }).fill('21');
    await page.getByRole('button', { name: '应用' }).click();
    await expect(page.getByRole('spinbutton', { name: '中心 X' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '应用' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '删除' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /自由剪刀/ })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controls = page.locator('.m16k-properties input, .m16k-properties button');
    for (let index = 0; index < await controls.count(); index += 1) expect((await controls.nth(index).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  }
});
