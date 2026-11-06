import { expect, test } from '@playwright/test';

const pageUrl = '/src/features/workshop/editor/testing.html?allShapes=1';

async function openEditor(page: import('@playwright/test').Page, url = pageUrl): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
}

async function paperPosition(canvas: import('@playwright/test').Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

async function drawBox(page: import('@playwright/test').Page, from: [number, number], to: [number, number], shift = false): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, ...from);
  const end = await paperPosition(canvas, ...to);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test('circle, triangle and teardrop drag previews commit one Worker-validated operation each', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const cases: ReadonlyArray<readonly [string, 'circle' | 'triangle' | 'teardrop', readonly [number, number], readonly [number, number]]> = [
    ['圆形', 'circle', [0.58, 0.58], [0.64, 0.64]],
    ['三角形', 'triangle', [0.68, 0.58], [0.75, 0.66]],
    ['水滴形', 'teardrop', [0.79, 0.58], [0.86, 0.67]],
  ];
  for (const [button, shape, from, to] of cases) {
    await page.getByRole('button', { name: new RegExp(`^${button}`) }).click();
    const start = await paperPosition(canvas, ...from);
    const end = await paperPosition(canvas, ...to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await expect(canvas.locator('.m16f-parametric-preview')).toBeVisible();
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-phase', 'idle');
    const work = await page.evaluate(() => window.m15b.getWork());
    expect(work.operations.at(-1)).toMatchObject({ kind: 'parametric', shape, parameterVersion: 2 });
  }
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
});

test('ellipse, rectangle, star and petal reuse the drag state machine and exact previews', async ({ page }) => {
  await openEditor(page, '/src/features/workshop/editor/testing.html?newShapes=1');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const cases: ReadonlyArray<readonly [string, 'ellipse' | 'rectangle' | 'star' | 'petal', readonly [number, number], readonly [number, number], 'ellipse' | 'path' | 'polygon']> = [
    ['椭圆', 'ellipse', [0.09, 0.14], [0.16, 0.22], 'ellipse'],
    ['矩形', 'rectangle', [0.19, 0.14], [0.26, 0.22], 'path'],
    ['五角星', 'star', [0.29, 0.14], [0.36, 0.22], 'polygon'],
    ['花瓣', 'petal', [0.09, 0.28], [0.16, 0.37], 'path'],
  ] as const;
  for (const [label, shape, from, to, previewElement] of cases) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const start = await paperPosition(canvas, ...from), end = await paperPosition(canvas, ...to);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
    await expect(canvas.locator(`.m16f-parametric-preview ${previewElement}`)).toBeVisible();
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-phase', 'idle');
    expect((await page.evaluate(() => window.m15b.getWork())).operations.at(-1)).toMatchObject({ kind: 'parametric', shape, angleDeg: 0 });
  }
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(4);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '4');
});

test('Shift locks the box and undo/redo retain the parametric cut', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: /^圆形/ }).click();
  await drawBox(page, [0.58, 0.72], [0.64, 0.82], true);
  let work = await page.evaluate(() => window.m15b.getWork());
  const operation = work.operations[0];
  expect(operation?.kind).toBe('parametric');
  if (operation?.kind !== 'parametric') throw new Error('missing parametric operation');
  expect(operation.width).toBeCloseTo(operation.height, 6);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  work = await page.evaluate(() => window.m15b.getWork());
  expect(work.operations[0]).toMatchObject({ kind: 'parametric', shape: 'circle' });
});

test('permissions, minimum size, geometry rejection and cancellation preserve Work', async ({ page }) => {
  await page.goto('/src/features/workshop/editor/testing.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: /^圆形/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^水滴形/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^三角形/ })).toHaveCount(0);

  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /^圆形/ }).click();
  await drawBox(page, [0.2, 0.3], [0.21, 0.31]);
  await expect(page.getByText('图形太小，请拖大后再试')).toBeVisible();
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(0);

  const start = await paperPosition(canvas, 0.2, 0.3);
  const end = await paperPosition(canvas, 0.3, 0.4);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(0);

  await drawBox(page, [0.42, 0.3], [0.54, 0.42]);
  await expect(page.locator('#m15b-status')).toContainText(/超出允许区域|基础折叠域|纸边/);
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(0);
});

test('pen tip and one touch draw; eraser, right click and second touch do not', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /^圆形/ }).click();
  const start = await paperPosition(canvas, 0.58, 0.75);
  const end = await paperPosition(canvas, 0.64, 0.82);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

  const touchStart = await paperPosition(canvas, 0.7, 0.75);
  const touchEnd = await paperPosition(canvas, 0.77, 0.83);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchEnd, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  await canvas.dispatchEvent('pointerdown', { pointerId: 23, pointerType: 'pen', isPrimary: true, button: 5, buttons: 32, clientX: start.x, clientY: start.y });
  await canvas.dispatchEvent('pointerdown', { pointerId: 24, pointerType: 'mouse', isPrimary: true, button: 2, buttons: 2, clientX: start.x, clientY: start.y });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 3 }, { ...end, id: 4 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(2);
});

test('unfolded view and tool/view switches cancel preview without committing', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /^圆形/ }).click();
  const start = await paperPosition(canvas, 0.58, 0.72);
  const end = await paperPosition(canvas, 0.65, 0.8);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.getByRole('button', { name: '平移H' }).evaluate(button => (button as HTMLButtonElement).click()); await page.mouse.up();
  await expect(canvas.locator('.m16f-parametric-preview')).toHaveCount(0);
  await page.getByRole('button', { name: /^圆形/ }).click();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 }); await page.mouse.up();
  await expect(canvas.locator('.m16f-parametric-preview')).toHaveCount(0);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await canvas.evaluate(element => { if (element.hasPointerCapture(1)) element.releasePointerCapture(1); }); await page.mouse.up();
  await expect(canvas.locator('.m16f-parametric-preview')).toHaveCount(0);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.getByRole('button', { name: '展开视图' }).evaluate(button => (button as HTMLButtonElement).click()); await page.mouse.up();
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(0);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(0);
});

test('shape controls remain keyboard-operable, 44px and overflow-free at 720px and 1440px', async ({ page }) => {
  for (const width of [720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page, '/src/features/workshop/editor/testing.html?newShapes=1');
    const circle = page.getByRole('button', { name: /^圆形/ });
    await circle.focus();
    await page.keyboard.press('Enter');
    await expect(circle).toHaveAttribute('aria-pressed', 'true');
    const box = await circle.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    for (const label of ['椭圆', '矩形', '五角星', '花瓣']) {
      const target = await page.getByRole('button', { name: new RegExp(`^${label}`) }).boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
