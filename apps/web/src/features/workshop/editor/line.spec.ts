import { expect, test } from '@playwright/test';

const pageUrl = '/src/features/workshop/editor/testing.html';

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

async function drawLine(page: import('@playwright/test').Page, from: [number, number], to: [number, number], shift = false): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, from[0], from[1]);
  const end = await paperPosition(canvas, to[0], to[1]);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function workOperations(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const work = window.m15b.getWork();
    return work.operations.map(operation => {
      if (operation.kind !== 'brush') return { kind: operation.kind };
      return {
        kind: operation.kind,
        id: operation.id,
        width: operation.width,
        points: operation.points.map(point => ({ x: point.x, y: point.y })),
      };
    });
  });
}

async function previewPaperEnd(canvas: import('@playwright/test').Locator): Promise<{ x: number; y: number }> {
  return canvas.evaluate(element => {
    const pairs = (element.querySelector('.m15b-brush-trail')?.getAttribute('points') ?? '').trim().split(/\s+/u);
    const [x, y] = pairs.at(-1)?.split(',').map(Number) ?? [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('missing line preview endpoint');
    const base = Math.min(element.clientWidth, element.clientHeight);
    return { x: (x! - (element.clientWidth - base) / 2) / base, y: (y! - (element.clientHeight - base) / 2) / base };
  });
}

test('L key selects the line tool and one drag submits a two-point brush stroke', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const editor = page.locator('.m15b-editor');
  await canvas.focus();
  await page.keyboard.press('l');
  await expect(canvas).toHaveAttribute('data-tool', 'line');
  await expect(canvas).toHaveAttribute('aria-label', /当前工具：直线/);

  const start = await paperPosition(canvas, 0.2, 0.3);
  const end = await paperPosition(canvas, 0.32, 0.42);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(canvas.locator('.m15b-brush-dot')).toHaveCount(1);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect(canvas).toHaveAttribute('data-phase', 'drawing');
  await expect(page.getByText('正在绘制直线，松开完成')).toBeVisible();
  await expect(canvas.locator('.m15b-brush-trail')).toHaveCount(1);
  await expect(canvas.locator('.m15b-closing')).toHaveCount(0);
  await page.mouse.up();

  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const operations = await workOperations(page);
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  const saved = operations[0] as { id: string; points: Array<{ x: number; y: number }> };
  expect(saved.id.startsWith('line-')).toBe(true);
  expect(saved.points).toHaveLength(2);
  expect(saved.points[0]!.x).toBeCloseTo(0.2, 4);
  expect(saved.points[0]!.y).toBeCloseTo(0.3, 4);
  expect(saved.points[1]!.x).toBeCloseTo(0.32, 4);
  expect(saved.points[1]!.y).toBeCloseTo(0.42, 4);
});

test('Shift snaps to horizontal, vertical, +45° and -45° directions', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: /直线/ }).click();
  const canvas = page.getByRole('application', { name: /剪纸画布/ });

  await drawLine(page, [0.15, 0.25], [0.3, 0.27], true);
  await drawLine(page, [0.15, 0.38], [0.17, 0.52], true);
  await drawLine(page, [0.15, 0.6], [0.28, 0.74], true);
  await drawLine(page, [0.15, 0.85], [0.28, 0.71], true);
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(4);

  const [horizontal, vertical, up, down] = await workOperations(page);
  const ends = [horizontal, vertical, up, down].map(operation => {
    const points = (operation as { points: Array<{ x: number; y: number }> }).points;
    return { dx: points[1]!.x - points[0]!.x, dy: points[1]!.y - points[0]!.y };
  });
  expect(ends[0]!.dy).toBe(0);
  expect(ends[0]!.dx).toBeGreaterThan(0.1);
  expect(ends[1]!.dx).toBe(0);
  expect(ends[1]!.dy).toBeGreaterThan(0.1);
  expect(ends[2]!.dx).toBeGreaterThan(0);
  expect(ends[2]!.dy).toBeGreaterThan(0);
  expect(Math.abs(ends[2]!.dx)).toBeCloseTo(Math.abs(ends[2]!.dy), 5);
  expect(ends[3]!.dx).toBeGreaterThan(0);
  expect(ends[3]!.dy).toBeLessThan(0);
  expect(Math.abs(ends[3]!.dx)).toBeCloseTo(Math.abs(ends[3]!.dy), 5);

  const start = await paperPosition(canvas, 0.15, 0.25);
  const end = await paperPosition(canvas, 0.3, 0.27);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(end.x, end.y);
  const points = (await canvas.locator('.m15b-brush-trail').getAttribute('points'))!.trim().split(/\s+/).map(pair => pair.split(',').map(Number));
  expect(points).toHaveLength(2);
  expect(points[0]![1]!).toBeCloseTo(points[1]![1]!, 3);
  await page.mouse.up();
  await page.keyboard.up('Shift');
});

test('Shift keydown immediately snaps an active line and submits the displayed endpoint without another pointer move', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  const start = await paperPosition(canvas, 0.15, 0.25);
  const rawEnd = await paperPosition(canvas, 0.3, 0.29);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(rawEnd.x, rawEnd.y);
  const before = await previewPaperEnd(canvas);
  expect(before.x).toBeCloseTo(0.3, 4); expect(before.y).toBeCloseTo(0.29, 4);

  await page.keyboard.down('Shift');
  const snapped = await previewPaperEnd(canvas);
  expect(snapped.y).toBeCloseTo(0.25, 5);
  expect(snapped.x).not.toBeCloseTo(before.x, 4);
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const operation = (await workOperations(page))[0] as { points: Array<{ x: number; y: number }> };
  expect(operation.points[1]!.x).toBeCloseTo(snapped.x, 5);
  expect(operation.points[1]!.y).toBeCloseTo(snapped.y, 5);
});

test('Shift keyup immediately restores an active line and submits the restored endpoint without another pointer move', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  const start = await paperPosition(canvas, 0.15, 0.45);
  const rawEnd = await paperPosition(canvas, 0.3, 0.49);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(rawEnd.x, rawEnd.y);
  const snapped = await previewPaperEnd(canvas);
  expect(snapped.y).toBeCloseTo(0.45, 5);

  await page.keyboard.up('Shift');
  const restored = await previewPaperEnd(canvas);
  expect(restored.x).toBeCloseTo(0.3, 4); expect(restored.y).toBeCloseTo(0.49, 4);
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const operation = (await workOperations(page))[0] as { points: Array<{ x: number; y: number }> };
  expect(operation.points[1]!.x).toBeCloseTo(restored.x, 5);
  expect(operation.points[1]!.y).toBeCloseTo(restored.y, 5);
});

test('minimum and maximum brush widths apply to new lines', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.m15b-editor');
  const slider = page.getByLabel('笔刷粗细');
  await page.getByRole('button', { name: /直线/ }).click();
  await expect(slider).toHaveAttribute('min', '0.005');
  await expect(slider).toHaveAttribute('max', '0.12');
  await expect(slider).toHaveAttribute('step', '0.005');

  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0.005');
  await drawLine(page, [0.18, 0.3], [0.3, 0.3]);
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveValue('0.12');
  await drawLine(page, [0.18, 0.5], [0.3, 0.5]);
  await expect(editor).toHaveAttribute('data-operation-count', '2');
  const operations = await workOperations(page);
  expect(operations[0]).toMatchObject({ kind: 'brush', width: 0.005 });
  expect(operations[1]).toMatchObject({ kind: 'brush', width: 0.12 });
});

test('a click or too-short drag shows the Chinese hint and creates nothing', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /直线/ }).click();

  const at = await paperPosition(canvas, 0.25, 0.35);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toHaveText('直线太短，请拖动更长距离');
  await expect(editor).toHaveAttribute('data-operation-count', '0');

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 2, at.y + 1);
  await page.mouse.up();
  await expect(page.getByRole('alert')).toHaveText('直线太短，请拖动更长距离');
  await expect(editor).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);

  await drawLine(page, [0.2, 0.3], [0.32, 0.42]);
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
});

test('an out-of-bounds line reports the brush geometry error and keeps Work unchanged', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /直线/ }).click();
  await drawLine(page, [0.25, 0.5], [0.75, 0.5]);
  await expect(canvas).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toContainText('GEOMETRY_INVALID');
  await expect(page.getByRole('alert')).toContainText('笔刷扫掠区域超出允许区域');
  await expect(editor).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);

  await drawLine(page, [0.2, 0.3], [0.32, 0.42]);
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
});

test('Escape, pointercancel, lost capture, tool switch and view switch cancel without submitting', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  const start = await paperPosition(canvas, 0.18, 0.28);
  const end = await paperPosition(canvas, 0.3, 0.38);

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.keyboard.press('v'); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-tool', 'select');

  await page.getByRole('button', { name: /直线/ }).click();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.keyboard.press('Escape'); await page.mouse.up();

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 }); await page.mouse.up();

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await canvas.evaluate(element => { if (element.hasPointerCapture(1)) element.releasePointerCapture(1); }); await page.mouse.up();

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.getByRole('button', { name: '展开视图' }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(canvas).toHaveAttribute('data-view', 'unfolded');
  await page.mouse.up();

  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(canvas.locator('.m15b-brush-trail')).toHaveCount(0);
  await expect(canvas.locator('.m15b-brush-dot')).toHaveCount(0);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
  expect(await canvas.evaluate(element => element.hasPointerCapture(1))).toBe(false);
});

test('pen tip and a single touch draw lines; eraser, right button and a second touch do not', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  const cdp = await context.newCDPSession(page);

  const penStart = await paperPosition(canvas, 0.14, 0.2);
  const penEnd = await paperPosition(canvas, 0.3, 0.36);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penStart, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...penStart, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penEnd, button: 'left', buttons: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...penEnd, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

  const touchStart = await paperPosition(canvas, 0.16, 0.5);
  const touchEnd = await paperPosition(canvas, 0.3, 0.62);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchEnd, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);

  const operations = await workOperations(page);
  expect(operations.map(operation => operation.kind)).toEqual(['brush', 'brush']);
  for (const operation of operations) expect((operation as { points: unknown[] }).points).toHaveLength(2);

  const start = await paperPosition(canvas, 0.2, 0.3);
  const end = await paperPosition(canvas, 0.3, 0.4);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(end.x, end.y);
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');

  await canvas.evaluate((element, range: { from: { x: number; y: number }; to: { x: number; y: number } }) => {
    const fire = (type: string, at: { x: number; y: number }, button: number, buttons: number) =>
      element.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'pen', isPrimary: true, button, buttons, bubbles: true, clientX: at.x, clientY: at.y,
      }));
    fire('pointerdown', range.from, 5, 32);
    fire('pointermove', range.to, 5, 32);
    fire('pointerup', range.to, 5, 0);
  }, { from: start, to: end });
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');

  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
  await expect(canvas).toHaveAttribute('data-phase', 'drawing');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...end, id: 1 }, { x: end.x + 60, y: end.y, id: 2 }] });
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });

  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
});

test('a profile without free paths disables the line tool', async ({ page }) => {
  await openEditor(page, `${pageUrl}?noFreehand=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const lineButton = page.getByRole('button', { name: /直线/ });
  await expect(lineButton).toBeVisible();
  await expect(lineButton).toBeDisabled();
  await canvas.focus();
  await page.keyboard.press('l');
  await expect(canvas).toHaveAttribute('data-tool', 'select');
  await drawLine(page, [0.2, 0.3], [0.32, 0.42]);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('line strokes support undo and redo through Worker history', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /直线/ }).click();
  await drawLine(page, [0.2, 0.3], [0.32, 0.42]);
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '0');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  const operations = await workOperations(page);
  expect(operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect((operations[0] as { points: unknown[] }).points).toHaveLength(2);
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
});

test('line preview is round-capped, tracks the endpoints and scales with zoom', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  const base = await canvas.evaluate(element => Math.min(element.clientWidth, element.clientHeight));

  const start = await paperPosition(canvas, 0.15, 0.3);
  const end = await paperPosition(canvas, 0.3, 0.38);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  const trail = canvas.locator('.m15b-brush-trail');
  await expect(trail).toHaveCount(1);
  await expect(trail).toHaveCSS('stroke-linecap', 'round');
  await expect(canvas.locator('.m15b-brush-outline')).toHaveCSS('stroke-linecap', 'round');
  const widthBefore = Number(await trail.getAttribute('stroke-width'));
  const zoomBefore = Number(await canvas.getAttribute('data-zoom'));
  expect(widthBefore).toBeCloseTo(0.02 * zoomBefore * base, 0);

  await page.mouse.wheel(0, -400);
  await expect(canvas).not.toHaveAttribute('data-zoom', String(zoomBefore.toFixed(3)));
  const zoomAfter = Number(await canvas.getAttribute('data-zoom'));
  const widthAfter = Number(await canvas.locator('.m15b-brush-trail').getAttribute('stroke-width'));
  expect(widthAfter / widthBefore).toBeCloseTo(zoomAfter / zoomBefore, 3);
  expect(widthAfter).toBeCloseTo(0.02 * zoomAfter * base, 0);
  await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
});

test('Worker validation keeps a line pending exactly once and locks the width slider', async ({ page }) => {
  await openEditor(page, `${pageUrl}?delayDispatch=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const slider = page.getByLabel('笔刷粗细');
  await page.getByRole('button', { name: /直线/ }).click();
  await drawLine(page, [0.2, 0.3], [0.32, 0.42]);
  await expect(canvas).toHaveAttribute('data-phase', 'validating');
  await expect(page.getByText('正在校验直线')).toBeVisible();
  await expect(slider).toBeDisabled();

  await drawLine(page, [0.22, 0.32], [0.3, 0.42]);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');

  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  await expect(slider).toBeEnabled();
});

test('line drawing does not break brush, freehand and parametric tools', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });

  await page.getByRole('button', { name: /直线/ }).click();
  await drawLine(page, [0.12, 0.14], [0.24, 0.14]);

  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await drawLine(page, [0.12, 0.22], [0.24, 0.26]);

  await page.getByRole('button', { name: /自由剪刀/ }).click();
  const freehandPoints = await Promise.all([
    paperPosition(canvas, 0.12, 0.32), paperPosition(canvas, 0.24, 0.32), paperPosition(canvas, 0.18, 0.46),
  ]);
  await page.mouse.move(freehandPoints[0]!.x, freehandPoints[0]!.y);
  await page.mouse.down();
  await page.mouse.move(freehandPoints[1]!.x, freehandPoints[1]!.y, { steps: 4 });
  await page.mouse.move(freehandPoints[2]!.x, freehandPoints[2]!.y, { steps: 4 });
  await page.mouse.up();

  await page.getByRole('button', { name: /^圆形/ }).click();
  const circleStart = await paperPosition(canvas, 0.3, 0.14);
  const circleEnd = await paperPosition(canvas, 0.38, 0.22);
  await page.mouse.move(circleStart.x, circleStart.y);
  await page.mouse.down();
  await page.mouse.move(circleEnd.x, circleEnd.y, { steps: 3 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(4);
  const operations = await workOperations(page);
  expect(operations.map(operation => operation.kind)).toEqual(['brush', 'brush', 'freehand', 'parametric']);
  expect((operations[0] as { points: unknown[] }).points).toHaveLength(2);
});

test('touch-action blocks browser gestures for the folded line tool only', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  await expect(canvas).toHaveCSS('touch-action', 'none');
  await page.getByRole('button', { name: '展开视图' }).click();
  await expect(canvas).toHaveCSS('touch-action', 'pan-y');
});

test('after a real line drag the SVG pixels show removed paper along the stroke', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /直线/ }).click();
  await drawLine(page, [0.15, 0.3], [0.35, 0.3]);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await expect(canvas.locator('.m15b-artwork')).toBeVisible();

  const result = await canvas.evaluate(async element => {
    const svg = (element.querySelector('.m15b-artwork') as HTMLElement).innerHTML;
    const dimension = Number(/width="([0-9.]+)"/.exec(svg)?.[1] ?? '0');
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      image.src = url;
      await image.decode();
      const raster = document.createElement('canvas');
      raster.width = dimension; raster.height = dimension;
      const context = raster.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x * dimension, y * dimension, 1, 1).data.slice(0, 3));
      return {
        dimension,
        onTrail: pixel(0.25, 0.3),
        besideTrail: pixel(0.25, 0.38),
        beyondTrail: pixel(0.4, 0.3),
      };
    } finally { URL.revokeObjectURL(url); }
  });
  expect(result.dimension).toBeGreaterThan(100);
  expect(result.onTrail).toEqual([242, 217, 166]);
  expect(result.besideTrail).toEqual([184, 32, 37]);
  expect(result.beyondTrail).toEqual([184, 32, 37]);
});
