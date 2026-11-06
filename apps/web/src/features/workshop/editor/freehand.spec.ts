import { expect, test } from '@playwright/test';

const pageUrl = '/src/features/workshop/editor/testing.html';

async function openEditor(page: import('@playwright/test').Page, url = pageUrl): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
}

async function drawValidCut(page: import('@playwright/test').Page): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  const originX = box.x + (box.width - base) / 2;
  const originY = box.y + (box.height - base) / 2;
  const points = [[0.14, 0.2], [0.31, 0.2], [0.31, 0.42], [0.14, 0.42]] as const;
  await page.mouse.move(originX + points[0][0] * base, originY + points[0][1] * base);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(originX + x * base, originY + y * base, { steps: 4 });
  await page.mouse.up();
}

async function paperPosition(canvas: import('@playwright/test').Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

test('select chooses the visually topmost cut and blank paper clears selection', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  const editor = page.locator('.m15b-editor');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const overlap = await paperPosition(canvas, 0.2, 0.3);
  await page.mouse.click(overlap.x, overlap.y);
  await expect(editor).toHaveAttribute('data-selected-id', 'seed-upper');
  await expect(page.getByText('已选择：切口 2')).toBeVisible();
  await expect(canvas.locator('.m15b-selection-outline')).toBeVisible();
  const blank = await paperPosition(canvas, 0.4, 0.8);
  await page.mouse.click(blank.x, blank.y);
  await expect(editor).toHaveAttribute('data-selected-id', '');
  await expect(page.getByText('未选择切口')).toBeVisible();
});

test('drag previews then confirms exactly one paper-coordinate move', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  const editor = page.locator('.m15b-editor');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, 0.2, 0.3), end = await paperPosition(canvas, 0.25, 0.35);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 5 });
  expect((await page.evaluate(() => window.m15b.getWork())).operations[1]).toMatchObject({ center: { x: 0.2, y: 0.3 } });
  await page.mouse.up();
  await expect(editor).toHaveAttribute('data-operation-count', '2');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const moved = await page.evaluate(() => window.m15b.getWork());
  expect(moved.operations[1]).toMatchObject({ id: 'seed-upper' });
  const center = moved.operations[1]?.kind === 'parametric' ? moved.operations[1].center : null;
  expect(center?.x).toBeCloseTo(0.25, 6);
  expect(center?.y).toBeCloseTo(0.35, 6);
  await expect(editor).toHaveAttribute('data-selected-id', 'seed-upper');
});

test('touch drag on a cut is not cancelled by page scrolling', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openEditor(page, `${pageUrl}?seed=1`);
  const editor = page.locator('.m15b-editor');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, 0.2, 0.3), end = await paperPosition(canvas, 0.24, 0.34);
  const scrollBefore = await page.evaluate(() => scrollY);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x, y: end.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  await expect(editor).toHaveAttribute('data-selected-id', 'seed-upper');
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  const moved = await page.evaluate(() => window.m15b.getWork());
  const center = moved.operations[1]?.kind === 'parametric' ? moved.operations[1].center : null;
  expect(center?.x).toBeCloseTo(0.24, 6);
  expect(center?.y).toBeCloseTo(0.34, 6);
});

test('illegal out-of-bounds drag is rejected and leaves confirmed Work unchanged', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, 0.2, 0.3), outside = await paperPosition(canvas, 0.75, 0.3);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(outside.x, outside.y); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toContainText('GEOMETRY_INVALID');
  expect((await page.evaluate(() => window.m15b.getWork())).operations[1]).toMatchObject({ center: { x: 0.2, y: 0.3 } });
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('Escape, pointercancel, lost capture and a second touch cancel drag without dispatch', async ({ page, context }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, 0.2, 0.3), end = await paperPosition(canvas, 0.25, 0.35);

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.keyboard.press('Escape'); await page.mouse.up();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 }); await page.mouse.up();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await canvas.evaluate(element => { if (element.hasPointerCapture(1)) element.releasePointerCapture(1); }); await page.mouse.up();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x, y: end.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: end.x, y: end.y, id: 1 }, { x: end.x + 50, y: end.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
  expect((await page.evaluate(() => window.m15b.getWork())).operations[1]).toMatchObject({ center: { x: 0.2, y: 0.3 } });
});

test('delete supports undo and redo through Worker history', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  const editor = page.locator('.m15b-editor');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const overlap = await paperPosition(canvas, 0.2, 0.3);
  await page.mouse.click(overlap.x, overlap.y);
  await page.keyboard.press('Delete');
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await expect(editor).toHaveAttribute('data-selected-id', '');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '2');
  await canvas.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
});

test('clear dialog cancels safely, restores focus, confirms once, and undo restores cuts', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  const editor = page.locator('.m15b-editor');
  const clear = page.getByRole('button', { name: '清空' });
  await clear.click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(clear).toBeFocused();
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);

  await clear.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);

  await clear.click();
  await page.getByRole('button', { name: '确认清空' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '2');
});

test('clear dialog traps keyboard focus and makes editor background inert', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1`);
  await page.getByRole('button', { name: '清空' }).click();
  const dialog = page.getByRole('alertdialog');
  const confirm = page.getByRole('button', { name: '确认清空' });
  const cancel = page.getByRole('button', { name: '取消' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.m15b-editor-main')).toHaveAttribute('inert', '');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await cancel.focus();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  const backgroundFocused = await page.locator('.m15b-toolbar button').first().evaluate(element => {
    (element as HTMLElement).focus();
    return document.activeElement === element;
  });
  expect(backgroundFocused).toBe(false);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清空' })).toBeFocused();
});

test('StrictMode with delayed Worker preserves a single drag confirmation', async ({ page }) => {
  await openEditor(page, `${pageUrl}?seed=1&delayDispatch=1`);
  const editor = page.locator('.m15b-editor');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, 0.2, 0.3), end = await paperPosition(canvas, 0.24, 0.34);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'validating');
  const controls = page.locator('.m15b-toolbar button');
  await expect(page.locator('.m15b-toolbar button:disabled')).toHaveCount(await controls.count());
  const zoom = await canvas.getAttribute('data-zoom');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas while validating');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect(canvas).toHaveAttribute('data-zoom', zoom ?? '');
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(editor).toHaveAttribute('data-operation-count', '2');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
});

test('real module Worker confirms one legal freehand cut and ordinary wheel zoom still works', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await drawValidCut(page);
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  await expect(canvas.locator('.m15b-artwork svg')).toHaveCount(1);
  expect(await canvas.locator('.m15b-artwork').innerHTML()).toContain('%3Cpath');

  const before = await canvas.getAttribute('data-zoom');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas before zoom');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect(canvas).not.toHaveAttribute('data-zoom', before ?? '');
});

test('simulated pen and single-touch input each complete a legal freehand cut', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  const penPoints = await Promise.all([
    paperPosition(canvas, 0.12, 0.18), paperPosition(canvas, 0.22, 0.18),
    paperPosition(canvas, 0.22, 0.30), paperPosition(canvas, 0.12, 0.30),
  ]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penPoints[0]!, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...penPoints[0]!, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  for (const point of penPoints.slice(1)) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1, pointerType: 'pen' });
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...penPoints.at(-1)!, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

  const touchPoints = await Promise.all([
    paperPosition(canvas, 0.30, 0.55), paperPosition(canvas, 0.39, 0.55),
    paperPosition(canvas, 0.39, 0.68), paperPosition(canvas, 0.30, 0.68),
  ]);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchPoints[0]!, id: 1 }] });
  for (const point of touchPoints.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
});

test('tool switch, Escape, pointercancel and lost capture cancel without dispatch', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');

  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 160, box.y + 150);
  await expect(canvas.locator('.m15b-trail')).toBeVisible();
  await expect(canvas.locator('.m15b-start')).toBeVisible();
  await expect(canvas.locator('.m15b-closing')).toBeVisible();
  await expect(canvas.getByText('松开以闭合')).toBeVisible();
  await page.keyboard.press('v');
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-tool', 'select');

  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await page.mouse.move(box.x + 110, box.y + 110); await page.mouse.down(); await page.mouse.move(box.x + 170, box.y + 160);
  await page.keyboard.press('Escape'); await page.mouse.up();

  await page.mouse.move(box.x + 120, box.y + 120); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 170);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 }); await page.mouse.up();

  await page.mouse.move(box.x + 130, box.y + 130); await page.mouse.down(); await page.mouse.move(box.x + 190, box.y + 180);
  await canvas.evaluate(element => { if (element.hasPointerCapture(1)) element.releasePointerCapture(1); }); await page.mouse.up();

  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('Worker rejection keeps confirmed Work unchanged and shows the concrete error', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toContainText('自由路径候选结构非法');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('StrictMode remains mounted and validating prevents view changes without losing confirmation', async ({ page }) => {
  await openEditor(page, `${pageUrl}?delayDispatch=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await drawValidCut(page);
  await expect(canvas).toHaveAttribute('data-phase', 'validating');
  const unfolded = page.getByRole('button', { name: '展开视图' });
  await expect(unfolded).toBeDisabled();
  await unfolded.evaluate((button: HTMLButtonElement) => button.click());
  await expect(canvas).toHaveAttribute('data-view', 'folded');
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
});

test('unfolded view blocks drawing and a second touch cancels the active stroke', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await page.getByRole('button', { name: '展开视图' }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 180); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'idle');

  await page.getByRole('button', { name: '折叠视图' }).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const x = box.x + 140, y = box.y + 140;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 40, y: y + 20, id: 1 }] });
  await expect(canvas).toHaveAttribute('data-phase', 'drawing');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 40, y: y + 20, id: 1 }, { x: x + 100, y: y + 20, id: 2 }] });
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('unmount releases pointer capture and pending visual work', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  await canvas.evaluate(element => {
    const original = element.releasePointerCapture.bind(element);
    const target = element as HTMLElement & { releaseCount?: number };
    target.releaseCount = 0;
    element.releasePointerCapture = pointerId => { target.releaseCount = (target.releaseCount ?? 0) + 1; original(pointerId); };
    (window as Window & { m15bCanvas?: HTMLElement }).m15bCanvas = target;
  });
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 170, box.y + 150);
  await page.evaluate(() => window.m15b.unmount());
  expect(await page.evaluate(() => (window as Window & { m15bCanvas?: HTMLElement & { releaseCount?: number } }).m15bCanvas?.releaseCount)).toBeGreaterThan(0);
  await page.mouse.up();
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

for (const width of [360, 390]) {
  test(`${width}px CSS viewport preserves accessible controls without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await openEditor(page);
    const buttons = page.locator('.m15b-toolbar button');
    for (let index = 0; index < await buttons.count(); index++) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('select mode keeps one-finger page scrolling available', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  const before = await page.evaluate(() => scrollY);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const x = box.x + box.width / 2, y = box.y + box.height * 0.8;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 100, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 180, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
});

test('touching blank paper still permits page scrolling with help open', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openEditor(page, `${pageUrl}?seed=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const box = (await canvas.boundingBox())!;
  const before = await page.evaluate(() => scrollY);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const x = box.x + box.width * .8, y = box.y + box.height * .45;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 75, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 140, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before);
});
