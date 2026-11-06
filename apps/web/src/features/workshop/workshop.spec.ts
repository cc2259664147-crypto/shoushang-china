import { test, expect } from '@playwright/test';

const database = () => `m07-test-${crypto.randomUUID()}`;
test('create, validate, undo, save draft and complete with thumbnail', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await expect(page.getByRole('button', { name: '使用模板' })).toBeVisible();
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '圆形' }).click();
  await page.getByRole('button', { name: '确认剪切' }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('切口 0 / 100')).toBeVisible();
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /未命名作品/ }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  await page.screenshot({ path: 'apps/web/src/features/workshop/evidence/desktop.png', fullPage: true });
  const stored = await page.evaluate(async n => { const req = indexedDB.open(n); return new Promise<{ revision: number; state: string; size: number }>((resolve, reject) => { req.onsuccess = () => { const db = req.result; const tx = db.transaction(['works', 'thumbnails'], 'readonly'); const works = tx.objectStore('works').getAll(); const thumbnails = tx.objectStore('thumbnails').getAll(); tx.oncomplete = () => { const w = works.result[0], t = thumbnails.result[0]; resolve({ revision: w?.revision ?? 0, state: t?.state ?? '', size: t?.blob?.size ?? 0 }); db.close(); }; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); }); }, name);
  expect(stored.revision).toBeGreaterThan(0); expect(stored.state).toBe('ready'); expect(stored.size).toBeGreaterThan(100);
});

test('invalid candidate stays out of history and narrow layout is usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '三角形' }).click();
  await page.getByLabel('中心 X').fill('0.95');
  await expect(page.getByText(/候选不可剪/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认剪切' })).toBeDisabled();
  await expect(page.getByText('切口 0 / 100')).toBeVisible();
  await page.screenshot({ path: 'apps/web/src/features/workshop/evidence/narrow-invalid.png', fullPage: true });
});

test('two tabs keep a real revision conflict and allow an explicit copy', async ({ page, context }) => {
  const name = database(), url = `/workshop/papercut?m07db=${name}`;
  await page.goto(url); await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  const second = await context.newPage(); await second.goto(url);
  await second.getByRole('button', { name: /未命名作品/ }).click();
  await page.getByRole('button', { name: '纸色 #E59C38' }).click();
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await second.getByRole('button', { name: '纸色 #276B62' }).click();
  await second.getByRole('button', { name: '保存草稿' }).click();
  await expect(second.getByText(/保存失败/)).toBeVisible();
  await expect(second.getByRole('button', { name: '纸色 #276B62' })).toHaveAttribute('aria-pressed', 'true');
  await second.screenshot({ path: 'apps/web/src/features/workshop/evidence/conflict.png', fullPage: true });
  await second.getByRole('button', { name: '另存副本' }).click();
  await expect(second.getByText('草稿已保存')).toBeVisible();
  await expect(page.getByRole('button', { name: '纸色 #E59C38' })).toHaveAttribute('aria-pressed', 'true');
});

test('back navigation asks to keep editing or save the draft', async ({ page }) => {
  await page.goto(`/?m07db=${database()}`); await page.getByRole('link', { name: /^开始剪纸/ }).click();
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '离开工坊' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL(/\/workshop\/papercut/);
  await page.getByRole('button', { name: '返回首页' }).click();
  await page.getByRole('button', { name: '保存草稿后离开' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:5173\/$/);
});

test('three shapes, palette, two undos and a new branch', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  for (const shape of ['圆形', '三角形', '水滴形']) {
    await page.getByRole('button', { name: shape }).click();
    await page.getByRole('button', { name: '确认剪切' }).click();
  }
  await expect(page.getByText('切口 3 / 100')).toBeVisible();
  await page.getByRole('button', { name: '纸色 #E59C38' }).click();
  await expect(page.getByText('切口 3 / 100')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('切口 2 / 100')).toBeVisible();
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.getByText('切口 3 / 100')).toBeVisible();
  await page.getByRole('button', { name: '纸色 #276B62' }).click();
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled();
  await expect(page.getByText('切口 3 / 100')).toBeVisible();
});

test('50 and 100 cuts respond on the real page', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  const samples: { count: number; milliseconds: number }[] = [];
  for (let count = 1; count <= 100; count++) {
    await page.getByRole('button', { name: '圆形' }).click();
    const start = Date.now();
    await page.getByRole('button', { name: '确认剪切' }).click();
    await expect(page.getByText(`切口 ${count} / 100`)).toBeVisible();
    if (count === 50 || count === 100) samples.push({ count, milliseconds: Date.now() - start });
  }
  expect(samples).toHaveLength(2);
  console.log(`M07 browser interaction samples: ${JSON.stringify(samples)}`);
  await expect(page.getByText('切口 100 / 100')).toBeVisible();
});

test('content failure and empty list show honest states', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}&m07scenario=failure`);
  await expect(page.getByText(/模板加载失败/)).toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText(/模板加载失败/)).toBeVisible();
  await page.goto(`/workshop/papercut?m07db=${name}&m07scenario=empty`);
  await expect(page.getByRole('heading', { name: '暂无模板' })).toBeVisible();
});

test('storage open failure keeps the canvas and reports the failure', async ({ page }) => {
  const name = database();
  await page.goto('/');
  await page.evaluate(n => new Promise<void>((resolve, reject) => { const request = indexedDB.open(n, 9); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); }), name);
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await expect(page.getByText(/本地存储不可用/)).toBeVisible();
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '圆形' }).click();
  await page.getByRole('button', { name: '确认剪切' }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.screenshot({ path: 'apps/web/src/features/workshop/evidence/storage-failure.png', fullPage: true });
});

test('step changes persist and pointer cancel does not commit a cut', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '水滴形' }).click();
  const canvas = page.getByRole('group', { name: '剪纸画布' });
  const box = await canvas.boundingBox(); if (!box) throw new Error('canvas missing');
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .3, box.y + box.height * .6); await page.mouse.up();
  await expect(page.getByText('切口 0 / 100')).toBeVisible();
  await page.getByRole('button', { name: '展开预览' }).first().click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: /未命名作品/ }).click();
  await expect(page.getByRole('button', { name: '展开预览' }).first()).toHaveClass(/ss-button--primary/);
  await expect(page.getByRole('button', { name: '展开预览' }).last()).toHaveClass(/ss-button--primary/);
});

test('editing a completed work keeps its completed version until commit', async ({ page }) => {
  const name = database(); await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const original = await page.evaluate(async n => new Promise<{ id: string; revision: number; paper: string }>((resolve, reject) => { const req = indexedDB.open(n); req.onsuccess = () => { const db = req.result, tx = db.transaction('works'); const get = tx.objectStore('works').getAll(); tx.oncomplete = () => { const work = get.result[0]; resolve({ id: work.id, revision: work.revision, paper: work.palette.paper }); db.close(); }; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); }), name);
  await page.reload(); await page.getByLabel('按作品 ID 打开已保存作品').fill(original.id); await page.getByRole('button', { name: '打开作品' }).click();
  await page.getByRole('button', { name: '纸色 #E59C38' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  const middle = await page.evaluate(async n => new Promise<{ revision: number; paper: string; draftCount: number }>((resolve, reject) => { const req = indexedDB.open(n); req.onsuccess = () => { const db = req.result, tx = db.transaction(['works', 'drafts']); const work = tx.objectStore('works').getAll(), drafts = tx.objectStore('drafts').getAll(); tx.oncomplete = () => { resolve({ revision: work.result[0].revision, paper: work.result[0].palette.paper, draftCount: drafts.result.length }); db.close(); }; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); }), name);
  expect(middle.revision).toBe(original.revision); expect(middle.paper).toBe(original.paper); expect(middle.draftCount).toBe(1);
  await page.getByRole('button', { name: '完成并保存作品' }).click(); await expect(page.getByText('作品已保存')).toBeVisible();
  const updated = await page.evaluate(async n => new Promise<{ revision: number; paper: string; draftCount: number }>((resolve, reject) => { const req = indexedDB.open(n); req.onsuccess = () => { const db = req.result, tx = db.transaction(['works', 'drafts']); const work = tx.objectStore('works').getAll(), drafts = tx.objectStore('drafts').getAll(); tx.oncomplete = () => { resolve({ revision: work.result[0].revision, paper: work.result[0].palette.paper, draftCount: drafts.result.length }); db.close(); }; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); }), name);
  expect(updated.revision).toBeGreaterThan(original.revision); expect(updated.paper).toBe('#E59C38'); expect(updated.draftCount).toBe(0);
});

test('simulated transaction failure and thumbnail failure preserve the canvas', async ({ page }) => {
  const quota = database();
  await page.goto(`/workshop/papercut?m07db=${quota}&m07fault=quota`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '圆形' }).click(); await page.getByRole('button', { name: '确认剪切' }).click();
  await expect(page.getByText(/保存失败/)).toBeVisible();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.screenshot({ path: 'apps/web/src/features/workshop/evidence/write-failure.png', fullPage: true });
  const thumbnail = database();
  await page.goto(`/workshop/papercut?m07db=${thumbnail}&m07fault=thumbnail`);
  await page.getByRole('button', { name: '使用模板' }).click(); await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /缩略图生成失败/ }).first()).toBeVisible();
  await expect(page.getByText('切口 0 / 100')).toBeVisible();
  await page.screenshot({ path: 'apps/web/src/features/workshop/evidence/thumbnail-failure.png', fullPage: true });
});

test('simulated touch placement survives viewport rotation and page scroll', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`/workshop/papercut?m07db=${database()}`);
    await page.getByRole('button', { name: '使用模板' }).click();
    await page.getByRole('button', { name: '圆形' }).click();
    const canvas = page.getByRole('group', { name: '剪纸画布' });
    await canvas.scrollIntoViewIfNeeded();
    let rect = await canvas.boundingBox(); if (!rect) throw new Error('missing canvas');
    await page.touchscreen.tap(rect.x + rect.width * .25, rect.y + rect.height * .5);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('button', { name: '确认剪切' }).click();
    await expect(page.getByText('切口 1 / 100')).toBeVisible();
  } finally { await context.close(); }
});

test('switching templates asks how to handle the current draft', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click(); await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByRole('heading', { name: '切换作品' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByText('切口 0 / 100')).toBeVisible();
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '保存草稿并切换' }).click();
  await expect(page.getByRole('button', { name: '圆形' })).toBeVisible();
});

test('cancel switch during a blocked draft save keeps the current work', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '圆形' }).click();
  await page.getByRole('button', { name: '确认剪切' }).click();
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.evaluate(async dbName => {
    const request = indexedDB.open(dbName);
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const connection = request.result;
    const windowWithLock = window as Window & { __m07Release?: boolean };
    windowWithLock.__m07Release = false;
    const transaction = connection.transaction(['works', 'drafts', 'draftRevisions'], 'readwrite');
    const pump = () => { const read = transaction.objectStore('drafts').getAllKeys(); read.onsuccess = () => { if (!windowWithLock.__m07Release) pump(); }; };
    pump(); transaction.oncomplete = () => connection.close();
  }, name);
  await page.getByRole('button', { name: '保存草稿并切换' }).click();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await page.evaluate(() => { (window as Window & { __m07Release?: boolean }).__m07Release = true; });
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await expect(page.getByRole('heading', { name: '切换作品' })).toHaveCount(0);
});

test('guarded browser back preserves the forward entry', async ({ page }) => {
  await page.goto(`/?m07db=${database()}`);
  await page.getByRole('link', { name: /^开始剪纸/ }).click();
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: '保存草稿后离开' }).click();
  await expect(page.getByRole('heading', { name: /^手上中国\s*把好奇，\s*留在纸上。$/ })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/workshop\/papercut/);
  await expect(page.getByRole('heading', { name: '剪纸工坊' })).toBeVisible();
});

test('preview step selects the unfolded renderer view', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=${database()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '圆形' }).click();
  await page.getByRole('button', { name: '确认剪切' }).click();
  await page.getByRole('button', { name: '展开预览' }).first().click();
  await expect(page.getByRole('button', { name: '展开预览' }).last()).toHaveClass(/ss-button--primary/);
  const href = await page.locator('.ws-art svg image').getAttribute('href');
  expect(href).not.toBeNull();
  const drawing = decodeURIComponent((href ?? '').split(',').slice(1).join(','));
  expect(drawing).not.toContain('M 0 0 L 0.5 0 L 0.5 1 L 0 1 Z');
  await page.getByRole('button', { name: '剪切' }).click();
  await expect(page.getByRole('button', { name: '折叠视图' })).toHaveClass(/ss-button--primary/);
});

test('cancel leave during a blocked save keeps the workshop open', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.getByRole('button', { name: '圆形' }).click();
  await page.getByRole('button', { name: '确认剪切' }).click();
  await page.getByRole('button', { name: '返回首页' }).click();
  await page.evaluate(async dbName => {
    const request = indexedDB.open(dbName);
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const connection = request.result;
    const windowWithLock = window as Window & { __m07Release?: boolean };
    windowWithLock.__m07Release = false;
    const transaction = connection.transaction(['works', 'drafts', 'draftRevisions'], 'readwrite');
    const pump = () => { const read = transaction.objectStore('drafts').getAllKeys(); read.onsuccess = () => { if (!windowWithLock.__m07Release) pump(); }; };
    pump(); transaction.oncomplete = () => connection.close();
  }, name);
  await page.getByRole('button', { name: '保存草稿后离开' }).click();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await page.evaluate(() => { (window as Window & { __m07Release?: boolean }).__m07Release = true; });
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await expect(page).toHaveURL(/\/workshop\/papercut/);
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
});
