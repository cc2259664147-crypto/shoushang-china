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

async function drawBrushLine(page: import('@playwright/test').Page, from: [number, number], to: [number, number]): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, from[0], from[1]);
  const end = await paperPosition(canvas, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

async function clickPaper(page: import('@playwright/test').Page, at: [number, number]): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const point = await paperPosition(canvas, at[0], at[1]);
  await page.mouse.click(point.x, point.y);
}

test('B key selects the brush tool and the two draw tools report distinct status text', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.focus();
  await page.keyboard.press('b');
  await expect(canvas).toHaveAttribute('data-tool', 'brush');
  await expect(canvas).toHaveAttribute('aria-label', /当前工具：剪除笔刷/);

  const start = await paperPosition(canvas, 0.15, 0.25);
  const end = await paperPosition(canvas, 0.3, 0.35);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await expect(canvas).toHaveAttribute('data-phase', 'drawing');
  await expect(page.getByText('正在剪除，松开完成')).toBeVisible();
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-phase', 'idle');

  await page.keyboard.press('f');
  await expect(canvas).toHaveAttribute('data-tool', 'freehand');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await expect(page.getByText('正在绘制，松开以闭合')).toBeVisible();
  await expect(canvas.locator('.m15b-closing')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('a drag submits exactly one brush operation with the default width', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await drawBrushLine(page, [0.2, 0.3], [0.32, 0.42]);
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const work = await page.evaluate(() => window.m15b.getWork());
  const operation = work.operations[0];
  expect(operation).toMatchObject({ kind: 'brush', width: 0.02, order: 0, parameterVersion: 2 });
  expect(operation!.id.startsWith('brush-')).toBe(true);
  expect(operation!.kind === 'brush' ? operation!.points.length : 0).toBeGreaterThanOrEqual(2);
});

test('a single click submits a one-point round dot brush', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await clickPaper(page, [0.25, 0.5]);
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  const work = await page.evaluate(() => window.m15b.getWork());
  const operation = work.operations[0];
  expect(operation).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(operation!.kind === 'brush' ? operation!.points : []).toHaveLength(1);
});

test('width slider exposes min, max and default values and applies them to new dots', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.m15b-editor');
  const slider = page.getByLabel('笔刷粗细');
  await expect(slider).toHaveAttribute('min', '0.005');
  await expect(slider).toHaveAttribute('max', '0.12');
  await expect(slider).toHaveAttribute('step', '0.005');
  await expect(slider).toHaveValue('0.02');
  await expect(page.locator('output')).toHaveText('0.02（2%）');

  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0.005');
  await expect(page.locator('output')).toHaveText('0.005（0.5%）');
  await clickPaper(page, [0.25, 0.5]);
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveValue('0.12');
  await expect(page.locator('output')).toHaveText('0.12（12%）');
  await clickPaper(page, [0.3, 0.62]);
  await expect(editor).toHaveAttribute('data-operation-count', '2');
  const work = await page.evaluate(() => window.m15b.getWork());
  expect(work.operations[0]).toMatchObject({ kind: 'brush', width: 0.005 });
  expect(work.operations[1]).toMatchObject({ kind: 'brush', width: 0.12 });
});

test('live brush preview is open, round, disables the width slider and follows zoom', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const slider = page.getByLabel('笔刷粗细');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();

  const single = await paperPosition(canvas, 0.2, 0.3);
  const base = await canvas.evaluate(element => Math.min(element.clientWidth, element.clientHeight));
  await page.mouse.move(single.x, single.y);
  await page.mouse.down();
  await expect(canvas.locator('.m15b-brush-dot')).toHaveCount(1);
  const dotRadius = Number(await canvas.locator('.m15b-brush-dot').getAttribute('r'));
  expect(dotRadius).toBeCloseTo(0.02 * base / 2, 0);
  await expect(slider).toBeDisabled();

  const end = await paperPosition(canvas, 0.32, 0.38);
  await page.mouse.move(end.x, end.y);
  await expect(canvas.locator('.m15b-brush-trail')).toHaveCount(1);
  await expect(canvas.locator('.m15b-closing')).toHaveCount(0);
  const zoomBefore = Number(await canvas.getAttribute('data-zoom'));
  const widthBefore = Number(await canvas.locator('.m15b-brush-trail').getAttribute('stroke-width'));
  expect(widthBefore).toBeCloseTo(0.02 * zoomBefore * base, 0);

  await page.mouse.wheel(0, -400);
  await expect(canvas).not.toHaveAttribute('data-zoom', String(zoomBefore.toFixed(3)));
  const zoomAfter = Number(await canvas.getAttribute('data-zoom'));
  const widthAfter = Number(await canvas.locator('.m15b-brush-trail').getAttribute('stroke-width'));
  expect(zoomAfter).toBeGreaterThan(zoomBefore);
  expect(widthAfter / widthBefore).toBeCloseTo(zoomAfter / zoomBefore, 3);
  expect(widthAfter).toBeCloseTo(0.02 * zoomAfter * base, 0);

  await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await expect(slider).toBeEnabled();
});

test('pen tip and a single touch each draw a brush stroke', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  const penPoints = await Promise.all([
    paperPosition(canvas, 0.14, 0.2), paperPosition(canvas, 0.26, 0.28), paperPosition(canvas, 0.3, 0.36),
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
    paperPosition(canvas, 0.16, 0.5), paperPosition(canvas, 0.24, 0.58), paperPosition(canvas, 0.3, 0.62),
  ]);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchPoints[0]!, id: 1 }] });
  for (const point of touchPoints.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
  const work = await page.evaluate(() => window.m15b.getWork());
  expect(work.operations.map(operation => operation.kind)).toEqual(['brush', 'brush']);
});

test('right button, pen eraser and a second touch never draw', async ({ page, context }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  const start = await paperPosition(canvas, 0.2, 0.3);
  const end = await paperPosition(canvas, 0.3, 0.4);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(end.x, end.y);
  await page.mouse.up({ button: 'right' });
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');

  // CDP 把 button:'left' 规范成笔尖按压，笔擦形状（button 5 / buttons 32）只能以真实事件形状派发。
  await canvas.evaluate((element, range: { from: { x: number; y: number }; to: { x: number; y: number } }) => {
    const fire = (type: string, at: { x: number; y: number }, button: number, buttons: number) =>
      element.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'pen', isPrimary: true, button, buttons, bubbles: true, clientX: at.x, clientY: at.y,
      }));
    fire('pointerdown', range.from, 5, 32);
    fire('pointermove', range.to, 5, 32);
    fire('pointerup', range.to, 5, 0);
  }, { from: start, to: end });
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
  await expect(canvas).toHaveAttribute('data-phase', 'drawing');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...end, id: 1 }, { x: end.x + 60, y: end.y, id: 2 }] });
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });

  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('Escape, pointercancel, lost capture, tool switch and view switch cancel without submitting', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  const start = await paperPosition(canvas, 0.18, 0.28);
  const end = await paperPosition(canvas, 0.3, 0.38);

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.keyboard.press('v'); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-tool', 'select');

  await page.getByRole('button', { name: /剪除笔刷/ }).click();
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

test('a 4097-point stroke cancels instead of truncating the submission', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  const start = await paperPosition(canvas, 0.15, 0.25);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await canvas.evaluate((element, origin) => {
    for (let index = 1; index <= 4096; index += 1) {
      element.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, pointerType: 'mouse', bubbles: true,
        clientX: origin.x + (index % 8), clientY: origin.y + ((index >> 3) % 8),
      }));
    }
  }, start);
  await expect(canvas).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toContainText('轨迹过长');
  await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

test('Worker validation blocks duplicate strokes and locks the width slider', async ({ page }) => {
  await openEditor(page, `${pageUrl}?delayDispatch=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const slider = page.getByLabel('笔刷粗细');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await drawBrushLine(page, [0.2, 0.3], [0.3, 0.4]);
  await expect(canvas).toHaveAttribute('data-phase', 'validating');
  await expect(slider).toBeDisabled();

  await clickPaper(page, [0.25, 0.5]);
  await drawBrushLine(page, [0.22, 0.32], [0.3, 0.42]);
  await expect(canvas).toHaveAttribute('data-phase', 'validating');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');

  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  await expect(slider).toBeEnabled();
});

test('an out-of-bounds brush stroke reports the geometry error and keeps Work unchanged', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await drawBrushLine(page, [0.25, 0.5], [0.75, 0.5]);
  await expect(canvas).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toContainText('GEOMETRY_INVALID');
  await expect(page.getByRole('alert')).toContainText('笔刷扫掠区域超出允许区域');
  await expect(editor).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);

  await drawBrushLine(page, [0.2, 0.3], [0.3, 0.42]);
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
});

test('brush operations support undo and redo', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.m15b-editor');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await drawBrushLine(page, [0.2, 0.3], [0.3, 0.4]);
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '0');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
});

test('unfolded view blocks brush drawing entirely', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await page.getByRole('button', { name: '展开视图' }).click();
  await drawBrushLine(page, [0.2, 0.3], [0.3, 0.4]);
  await clickPaper(page, [0.25, 0.5]);
  await expect(canvas).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  expect(await page.evaluate(() => window.m15b.confirmedCount)).toBe(0);
});

for (const width of [720, 1440]) {
  test(`${width}px viewport keeps 44px controls without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    await page.getByRole('button', { name: /剪除笔刷/ }).click();
    const buttons = page.locator('.m15b-toolbar button');
    for (let index = 0; index < await buttons.count(); index++) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    const slider = await page.getByLabel('笔刷粗细').boundingBox();
    expect(slider?.height).toBeGreaterThanOrEqual(44);
    expect(slider?.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('after a real drag the trail pixels show background color while surroundings stay paper', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await drawBrushLine(page, [0.2, 0.3], [0.3, 0.3]);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await expect(canvas.locator('.m15b-artwork')).toBeVisible();
  expect(await canvas.locator('.m15b-artwork').innerHTML()).toContain('%3Cpath');

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
        besideTrail: pixel(0.25, 0.36),
        beyondTrail: pixel(0.35, 0.3),
      };
    } finally { URL.revokeObjectURL(url); }
  });
  expect(result.dimension).toBeGreaterThan(100);
  expect(result.onTrail).toEqual([242, 217, 166]);
  expect(result.besideTrail).toEqual([184, 32, 37]);
  expect(result.beyondTrail).toEqual([184, 32, 37]);
});

test('freehand keeps its closing-line preview while brush shows none', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const start = await paperPosition(canvas, 0.15, 0.25);
  const end = await paperPosition(canvas, 0.3, 0.35);

  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await expect(canvas.locator('.m15b-trail')).toBeVisible();
  await expect(canvas.locator('.m15b-closing')).toBeVisible();
  await expect(canvas.getByText('松开以闭合')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await expect(canvas.locator('.m15b-brush-trail')).toBeVisible();
  await expect(canvas.locator('.m15b-brush-outline')).toBeVisible();
  await expect(canvas.locator('.m15b-closing')).toHaveCount(0);
  await expect(canvas.locator('.m15b-trail')).toHaveCount(0);
  await page.mouse.up();
});

test('touch-action blocks browser gestures only for folded drawing tools', async ({ page }) => {
  await openEditor(page);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await expect(canvas).toHaveCSS('touch-action', 'pan-y');
  await page.getByRole('button', { name: /自由剪刀/ }).click();
  await expect(canvas).toHaveCSS('touch-action', 'none');
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  await expect(canvas).toHaveCSS('touch-action', 'none');
  await page.getByRole('button', { name: '展开视图' }).click();
  await expect(canvas).toHaveCSS('touch-action', 'pan-y');
  await page.getByRole('button', { name: '折叠视图' }).click();
  await page.getByRole('button', { name: /平移/ }).click();
  await expect(canvas).toHaveCSS('touch-action', 'pan-y');
});
