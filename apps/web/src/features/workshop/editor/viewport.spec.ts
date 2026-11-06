import { expect, test } from '@playwright/test';

const database = () => `m07-test-m15-4-${crypto.randomUUID()}`;

async function savedWorkJson(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate(async databaseName => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('drafts', 'readonly');
      const records = transaction.objectStore('drafts').getAll();
      transaction.oncomplete = () => { resolve(JSON.stringify(records.result[0]?.work)); db.close(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }), name);
}

test('viewport gestures cancel cleanly and never change persisted Work', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  const before = await savedWorkJson(page, name);
  const canvas = page.getByRole('group', { name: '剪纸画布' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.evaluate(() => scrollTo(0, 160));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await canvas.scrollIntoViewIfNeeded();
  const zoomBox = await canvas.boundingBox();
  if (!zoomBox) throw new Error('missing canvas before wheel zoom');
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
  const initialScroll = await page.evaluate(() => scrollY);
  expect(initialScroll).toBeGreaterThan(0);
  const initialZoom = await canvas.getAttribute('data-zoom');
  await page.mouse.wheel(0, -300);
  await expect(canvas).not.toHaveAttribute('data-zoom', initialZoom ?? '');
  const zoomedIn = await canvas.getAttribute('data-zoom');
  expect(await page.evaluate(() => scrollY)).toBe(initialScroll);
  await page.mouse.wheel(0, 180);
  await expect(canvas).not.toHaveAttribute('data-zoom', zoomedIn ?? '');
  const zoomedOut = await canvas.getAttribute('data-zoom');
  expect(await page.evaluate(() => scrollY)).toBe(initialScroll);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect(canvas).toHaveAttribute('data-zoom', zoomedOut ?? '');
  await canvas.dispatchEvent('wheel', { deltaY: -300, metaKey: true });
  await expect(canvas).toHaveAttribute('data-zoom', zoomedOut ?? '');
  await page.getByRole('button', { name: '适配画布' }).click();
  await expect(canvas).toHaveAttribute('data-zoom', '1.000');
  await page.getByRole('button', { name: '放大画布' }).click();
  await expect(canvas).toHaveAttribute('data-zoom', '1.250');
  await page.getByRole('button', { name: '缩小画布' }).click();
  await expect(canvas).toHaveAttribute('data-zoom', '1.000');

  await page.keyboard.down('Space');
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(center.x + 40, center.y + 25);
  await page.mouse.up({ button: 'left' });
  await page.keyboard.up('Space');

  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center.x - 30, center.y + 10);
  await page.keyboard.press('Escape');
  const escapedTransform = await canvas.locator('.ws-viewport-layer').getAttribute('style');
  await page.mouse.move(center.x + 90, center.y + 90);
  expect(await canvas.locator('.ws-viewport-layer').getAttribute('style')).toBe(escapedTransform);
  await page.mouse.up({ button: 'middle' });

  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await canvas.scrollIntoViewIfNeeded();
  const pinchBox = await canvas.boundingBox();
  if (!pinchBox) throw new Error('missing canvas before pinch');
  const pinchCenter = { x: pinchBox.x + pinchBox.width / 2, y: pinchBox.y + pinchBox.height / 2 };
  const beforePinch = await canvas.getAttribute('data-zoom');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
    { x: pinchCenter.x - 40, y: pinchCenter.y, id: 1 },
    { x: pinchCenter.x + 40, y: pinchCenter.y, id: 2 },
  ] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
    { x: pinchCenter.x - 70, y: pinchCenter.y + 20, id: 1 },
    { x: pinchCenter.x + 70, y: pinchCenter.y + 20, id: 2 },
  ] });
  await expect(canvas).not.toHaveAttribute('data-zoom', beforePinch ?? '');
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));

  expect(await savedWorkJson(page, name)).toBe(before);
  await expect(page.getByText('切口 0 / 100')).toBeVisible();
});

test('a one-finger vertical gesture over the canvas scrolls the narrow page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  const canvas = page.getByRole('group', { name: '剪纸画布' });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  const before = await page.evaluate(() => scrollY);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.75;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 160, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
});
