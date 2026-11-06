import { expect, test, type Locator, type Page } from '@playwright/test';

const pageUrl = '/src/features/workshop/editor/testing.html?transformShapes=1';

async function openEditor(page: Page, url = pageUrl) {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
}

async function paperPosition(canvas: Locator, x: number, y: number) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

async function selectAt(page: Page, x: number, y: number) {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const blank = await paperPosition(canvas, 0.48, 0.9);
  await page.mouse.click(blank.x, blank.y);
  const point = await paperPosition(canvas, x, y);
  await page.mouse.click(point.x, point.y);
  await expect(canvas.locator('[data-transform-handle="rotate"]')).toBeVisible();
}

async function dragHandle(page: Page, handle: 'nw' | 'ne' | 'se' | 'sw' | 'rotate', dx: number, dy: number) {
  const target = page.locator(`[data-transform-handle="${handle}"]`);
  const box = await target.boundingBox();
  if (!box) throw new Error(`missing ${handle} handle`);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
  await page.mouse.up();
}

async function parametrics(page: Page) {
  return page.evaluate(() => window.m15b.getWork().operations.filter(operation => operation.kind === 'parametric'));
}

test('five parametric shapes resize and rotate through real handles with one history entry per completion', async ({ page }) => {
  await openEditor(page);
  const cases = [
    ['circle', 0.13, 0.22], ['ellipse', 0.25, 0.22], ['rectangle', 0.35, 0.22],
    ['star', 0.16, 0.48], ['petal', 0.34, 0.48],
  ] as const;
  let confirmations = 0;
  for (const [shape, x, y] of cases) {
    await selectAt(page, x, y);
    const before = (await parametrics(page)).find(operation => operation.shape === shape)!;
    await dragHandle(page, 'se', 12, 7);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(++confirmations);
    const scaled = (await parametrics(page)).find(operation => operation.shape === shape)!;
    expect(scaled.width).toBeGreaterThan(before.width);
    expect(scaled.height).toBeGreaterThan(before.height);
    await dragHandle(page, 'rotate', 20, 18);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(++confirmations);
    const rotated = (await parametrics(page)).find(operation => operation.shape === shape)!;
    expect(rotated.angleDeg).not.toBe(0);
  }
  await page.getByRole('button', { name: '撤销' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(11);
  expect((await parametrics(page)).find(operation => operation.shape === 'petal')!.angleDeg).toBe(0);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(12);
  expect((await parametrics(page)).find(operation => operation.shape === 'petal')!.angleDeg).not.toBe(0);
});

test('Shift toggles aspect lock immediately during resize without another pointer move', async ({ page }) => {
  await openEditor(page);
  await selectAt(page, 0.25, 0.22);
  const handle = page.locator('[data-transform-handle="se"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('missing scale handle');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 25, start.y + 6);
  const raw = await page.locator('[data-transform-handle="se"]').boundingBox();
  await page.keyboard.down('Shift');
  const locked = await page.locator('[data-transform-handle="se"]').boundingBox();
  expect(locked?.y).not.toBeCloseTo(raw!.y, 2);
  await page.keyboard.up('Shift');
  const restored = await page.locator('[data-transform-handle="se"]').boundingBox();
  expect(restored?.x).toBeCloseTo(raw!.x, 2);
  expect(restored?.y).toBeCloseTo(raw!.y, 2);
  await page.keyboard.down('Shift');
  await page.mouse.up(); await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const ellipse = (await parametrics(page)).find(operation => operation.shape === 'ellipse')!;
  expect(ellipse.width / ellipse.height).toBeCloseTo(0.06 / 0.08, 5);
});

test('rotation crosses zero and Shift toggles a 15 degree preview immediately', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await selectAt(page, 0.13, 0.22);
  const center = await paperPosition(canvas, 0.13, 0.22);
  const rotate = page.locator('[data-transform-handle="rotate"]');
  let box = await rotate.boundingBox();
  if (!box) throw new Error('missing rotate handle');
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down();
  await page.mouse.move(center.x + Math.cos(-100 * Math.PI / 180) * 80, center.y + Math.sin(-100 * Math.PI / 180) * 80);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  expect((await parametrics(page))[0]!.angleDeg).toBeGreaterThan(340);

  box = await rotate.boundingBox();
  if (!box) throw new Error('missing rotated handle');
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down();
  await page.mouse.move(center.x + Math.cos(-80 * Math.PI / 180) * 80, center.y + Math.sin(-80 * Math.PI / 180) * 80);
  const beforeShift = await rotate.boundingBox();
  await page.keyboard.down('Shift');
  const snapped = await rotate.boundingBox();
  expect(snapped?.x).not.toBeCloseTo(beforeShift!.x, 2);
  await page.mouse.up(); await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  expect((await parametrics(page))[0]!.angleDeg % 15).toBe(0);
  expect((await parametrics(page))[0]!.angleDeg).toBeLessThan(30);
});

test('invalid resize and cancellation restore confirmed geometry without history', async ({ page }) => {
  await openEditor(page);
  await selectAt(page, 0.13, 0.22);
  const original = (await parametrics(page))[0]!;
  const handle = page.locator('[data-transform-handle="se"]');
  const opposite = await page.locator('[data-transform-handle="nw"]').boundingBox();
  let box = await handle.boundingBox();
  if (!box || !opposite) throw new Error('missing scale handle');
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.mouse.move(opposite.x + 24, opposite.y + 24); await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText(/宽度超出模板限制|高度超出模板限制/);
  expect((await parametrics(page))[0]).toEqual(original);
  box = await handle.boundingBox();
  if (!box) throw new Error('missing restored scale handle');
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 180); await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText(/超出模板限制|超出允许区域|纸边/);
  expect((await parametrics(page))[0]).toEqual(original);
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);

  box = await handle.boundingBox();
  if (!box) throw new Error('missing restored handle');
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.mouse.move(box.x + 55, box.y + 45);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await parametrics(page))[0]).toEqual(original);
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('pointercancel, lost capture, tool switch and view switch cancel transforms without history', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const begin = async () => {
    const box = await page.locator('[data-transform-handle="se"]').boundingBox();
    if (!box) throw new Error('missing scale handle');
    await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.mouse.move(box.x + 45, box.y + 38);
  };
  await selectAt(page, 0.13, 0.22);
  await begin(); await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 }); await page.mouse.up();
  await begin(); await canvas.evaluate(element => { if (element.hasPointerCapture(1)) element.releasePointerCapture(1); }); await page.mouse.up();
  await begin(); await page.getByRole('button', { name: /剪除笔刷/ }).evaluate(button => (button as HTMLButtonElement).click()); await page.mouse.up();
  await page.getByRole('button', { name: /^选择V/ }).click(); await selectAt(page, 0.13, 0.22);
  await begin(); await page.getByRole('button', { name: '展开视图' }).evaluate(button => (button as HTMLButtonElement).click()); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('brush selection keeps move/delete behavior and never shows transform handles', async ({ page }) => {
  await openEditor(page, '/src/features/workshop/editor/testing.html');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  const start = await paperPosition(canvas, 0.15, 0.3), end = await paperPosition(canvas, 0.3, 0.3);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  await page.getByRole('button', { name: /^选择V/ }).click();
  const middle = await paperPosition(canvas, 0.22, 0.3);
  await page.mouse.click(middle.x, middle.y);
  await expect(canvas.locator('[data-transform-handle]')).toHaveCount(0);
  await page.mouse.move(middle.x, middle.y); await page.mouse.down(); await page.mouse.move(middle.x + 20, middle.y + 10); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
});

test('44px handles accept pen and touch while eraser, right click and second touch do not transform', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const cdp = await context.newCDPSession(page);
  await selectAt(page, 0.13, 0.22);
  let handle = page.locator('[data-transform-handle="se"]');
  let box = await handle.boundingBox();
  if (!box) throw new Error('missing pen handle');
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  const penStart = { x: box.x + 22, y: box.y + 22 }, penEnd = { x: penStart.x + 14, y: penStart.y + 8 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penStart, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...penStart, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penEnd, button: 'left', buttons: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...penEnd, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

  await selectAt(page, 0.25, 0.22);
  handle = page.locator('[data-transform-handle="se"]'); box = await handle.boundingBox();
  if (!box) throw new Error('missing touch handle');
  const touchStart = { x: box.x + 22, y: box.y + 22 }, touchEnd = { x: touchStart.x + 12, y: touchStart.y + 8 };
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchEnd, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);

  await handle.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, button: 5, buttons: 32, clientX: touchStart.x, clientY: touchStart.y });
  await handle.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'mouse', isPrimary: true, button: 2, buttons: 2, clientX: touchStart.x, clientY: touchStart.y });
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(2);

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchEnd, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchEnd, id: 3 }, { x: touchEnd.x + 50, y: touchEnd.y, id: 4 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
});

test('transform handles remain visible without horizontal overflow at 720px and 1440px', async ({ page }) => {
  for (const width of [720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    await selectAt(page, 0.13, 0.22);
    const rotate = await page.locator('[data-transform-handle="rotate"]').boundingBox();
    expect(rotate).not.toBeNull();
    expect(rotate!.x).toBeGreaterThanOrEqual(0); expect(rotate!.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
