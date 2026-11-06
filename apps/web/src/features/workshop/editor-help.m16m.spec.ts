import { expect, test } from '@playwright/test';

const path = () => `/workshop/papercut?m07db=m16m-${Date.now()}-${Math.random().toString(16).slice(2)}&templateId=template-v2-c04`;

test('first use, close, reopen, keyboard and refresh', async ({ page }) => {
  await page.goto(path());
  const help = page.getByRole('complementary', { name: '开始剪纸' });
  const close = page.getByRole('button', { name: '关闭使用帮助' });
  const open = page.getByRole('button', { name: '使用帮助', exact: true });
  await expect(help).toBeVisible(); await expect(close).toBeFocused();
  await expect(help).toContainText('展开视图');
  await page.reload(); await expect(help).toBeVisible(); await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0); await expect(open).toBeFocused();
  await page.reload(); await expect(help).toHaveCount(0);
  await open.focus(); await page.keyboard.press('Enter');
  await expect(help).toBeVisible(); await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
  await page.keyboard.press('Escape'); await expect(help).toHaveCount(0); await expect(open).toBeFocused();
  await page.reload(); await expect(help).toHaveCount(0);
});

test('storage failure still permits closing and reopening', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key === 'shoushang-editor-help-dismissed-v1') throw new Error('unavailable'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key === 'shoushang-editor-help-dismissed-v1') throw new Error('unavailable'); return set.call(this, key, value); };
  });
  await page.goto(path());
  const help = page.getByRole('complementary', { name: '开始剪纸' });
  await page.getByRole('button', { name: '关闭使用帮助' }).click(); await expect(help).toHaveCount(0);
  await page.getByRole('button', { name: '使用帮助', exact: true }).click(); await expect(help).toBeVisible();
  await page.getByRole('button', { name: '关闭使用帮助' }).click(); await page.reload(); await expect(help).toBeVisible();
});

for (const width of [360, 720]) test(`help fits ${width}px viewport and tools explain their shortcuts`, async ({ page }) => {
  await page.setViewportSize({ width, height: 740 }); await page.goto(path());
  const close = page.getByRole('button', { name: '关闭使用帮助' }); await expect(close).toBeVisible();
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await close.click(); await page.getByRole('button', { name: /^剪除笔刷/ }).click();
  await expect(page.locator('.m16m-tool-hint')).toContainText('沿轨迹剪除');
  await expect(page.locator('.m16m-tool-hint')).toContainText('B');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('open help preserves drawing, selection and touch dragging after scrolling to the canvas', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(path());
  const help = page.getByRole('complementary', { name: '开始剪纸' });
  await expect(help).toBeVisible();
  await page.getByRole('button', { name: /^圆形C/ }).click();
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const base = Math.min(box.width, box.height), x = box.x + (box.width - base) / 2, y = box.y + (box.height - base) / 2;
  await page.mouse.move(x + .13 * base, y + .17 * base); await page.mouse.down();
  await page.mouse.move(x + .27 * base, y + .31 * base, { steps: 4 }); await page.mouse.up();
  const editor = page.locator('.m15b-editor'); await expect(editor).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: /^选择V/ }).click();
  await canvas.scrollIntoViewIfNeeded();
  const current = (await canvas.boundingBox())!, px = current.x + (current.width - base) / 2, py = current.y + (current.height - base) / 2;
  await page.mouse.click(px + .2 * base, py + .24 * base); await expect(editor).toHaveAttribute('data-selected-id', /.+/);
  const before = await page.getByLabel('中心 X', { exact: true }).inputValue();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px + .2 * base, y: py + .24 * base, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px + .23 * base, y: py + .27 * base, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByLabel('中心 X', { exact: true })).not.toHaveValue(before);
  await expect(help).toBeAttached();
});
