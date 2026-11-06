import { expect, test, type Page } from '@playwright/test';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json' with { type: 'json' };

const entry = profilesDocument.profiles[0]!;
const template = JSON.parse(entry.evidence.sourceTemplateCanonicalJcs);
const profile = entry.profile;
const time = '2026-10-26T00:00:00.000Z';
const database = () => `m07-test-m15e2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const operationV1 = { id: 'v1-cut', shape: 'circle', center: { x: .2, y: .3 }, width: .06, height: .06, angleDeg: 0, order: 0, parameterVersion: 1 };
const operationV2 = { ...operationV1, kind: 'parametric', parameterVersion: 2 };
const rgba = (hex: string) => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16), 255];

function v1(id: string, status: 'draft' | 'completed', revision: number, name = '旧版作品') {
  return { id, name, craftId: template.craftId, templateSnapshot: template, palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [operationV1], status, schemaVersion: 1, revision, createdAt: time, updatedAt: time };
}
function v2(id: string) {
  return { id, name: 'v2 作品', craftId: template.craftId, templateSnapshot: template, editorProfileSnapshot: profile, palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [operationV2], status: 'draft', schemaVersion: 2, revision: 0, createdAt: time, updatedAt: time };
}

async function seed(page: Page, name: string, works: unknown[], drafts: unknown[], ledgers: unknown[] = []) {
  await page.goto('/');
  await page.evaluate(async ({ name: dbName, works: workRows, drafts: draftRows, ledgers: ledgerRows }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        const worksStore = db.createObjectStore('works', { keyPath: 'id' });
        worksStore.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('drafts', { keyPath: 'workId' });
        db.createObjectStore('draftRevisions', { keyPath: 'workId' });
        db.createObjectStore('thumbnails', { keyPath: 'workId' });
        db.createObjectStore('favorites', { keyPath: 'exhibitId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['works', 'drafts', 'draftRevisions'], 'readwrite');
        workRows.forEach(row => tx.objectStore('works').put(row));
        draftRows.forEach(row => tx.objectStore('drafts').put(row));
        ledgerRows.forEach(row => tx.objectStore('draftRevisions').put(row));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, { name, works, drafts, ledgers });
}

async function readRows(page: Page, name: string) {
  return page.evaluate(async dbName => new Promise<{ works: Record<string, unknown>[]; drafts: Record<string, unknown>[]; thumbnails: { state: string; blobType: string; blobSize: number }[] }>((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['works', 'drafts', 'thumbnails'], 'readonly');
      const works = tx.objectStore('works').getAll(), drafts = tx.objectStore('drafts').getAll(), thumbnails = tx.objectStore('thumbnails').getAll();
      tx.oncomplete = () => { resolve({ works: works.result, drafts: drafts.result, thumbnails: thumbnails.result.map(row => ({ state: row.state, blobType: row.blob?.type ?? '', blobSize: row.blob?.size ?? 0 })) }); db.close(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }), name);
}

async function paperPosition(page: Page, x: number, y: number) {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

test('v1 completed, standalone draft, and newer same-id draft save as their actual content', async ({ page }) => {
  for (const scenario of ['completed', 'standalone', 'newer-draft'] as const) {
    const name = database(), id = `source-${scenario}`;
    const completed = v1(id, 'completed', 2);
    const draftWork = { ...v1(id, 'draft', scenario === 'newer-draft' ? 2 : 0, '草稿修改'), palette: { paper: '#276B62', background: '#F2D9A6' } };
    const works = scenario === 'standalone' ? [] : [completed];
    const drafts = scenario === 'completed' ? [] : [{ workId: id, work: draftWork, step: 'preview', revision: 7, baseRevision: scenario === 'newer-draft' ? 2 : null, updatedAt: time }];
    await seed(page, name, works, drafts, drafts.length ? [{ workId: id, revision: 7 }] : []);
    await page.goto(`/workshop/papercut?m07db=${name}&workId=${id}&version=completed`);
    await expect(page.getByText('旧版作品为只读')).toBeVisible();
    if (scenario !== 'completed') await expect(page.getByText('已恢复同 ID 的较新旧版草稿。')).toBeVisible();
    await page.getByRole('button', { name: '另存为可编辑副本' }).click();
    await expect(page).toHaveURL(/workId=(?!source-)[^&]+/);
    await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
    const rows = await readRows(page, name);
    expect(rows.works.find(row => row.id === id)).toEqual(scenario === 'standalone' ? undefined : completed);
    const copied = rows.drafts.find(row => row.workId !== id)!;
    expect((copied.work as { name: string }).name).toBe(scenario === 'completed' ? '旧版作品' : '草稿修改');
    expect((copied.work as { palette: { paper: string } }).palette.paper).toBe(scenario === 'completed' ? '#B82025' : '#276B62');
  }
});

test('editable v2 auto-saves, survives refresh, and commits a ready PNG thumbnail', async ({ page }) => {
  const name = database(), id = 'editable-v2';
  const draft = { workId: id, work: v2(id), step: 'cut', revision: 5, baseRevision: null, updatedAt: time };
  await seed(page, name, [], [draft], [{ workId: id, revision: 5 }]);
  await page.goto(`/workshop/papercut?m07db=${name}&workId=${id}&version=stored-draft`);
  await page.getByRole('button', { name: '清空' }).click();
  await page.getByRole('button', { name: '确认清空' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  await expect.poll(async () => (await readRows(page, name)).drafts[0]?.revision).toBeGreaterThan(5);
  await page.reload();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const rows = await readRows(page, name);
  expect(rows.drafts).toHaveLength(0);
  expect(rows.works[0]?.schemaVersion).toBe(2);
  expect(rows.thumbnails[0]?.state).toBe('ready');
  expect(rows.thumbnails[0]?.blobType).toBe('image/png');
  expect(rows.thumbnails[0]?.blobSize).toBeGreaterThan(100);
});

test('brush draft completes with a ready PNG thumbnail', async ({ page }) => {
  const name = database(), id = 'brush-v2';
  const brushWork = { ...v2(id), operations: [{ kind: 'brush', id: 'brush', order: 0, parameterVersion: 2, points: [{ x: 0.12, y: 0.2 }, { x: 0.3, y: 0.2 }], width: 0.02 }] };
  const draft = { workId: id, work: brushWork, step: 'cut', revision: 5, baseRevision: null, updatedAt: time };
  await seed(page, name, [], [draft], [{ workId: id, revision: 5 }]);
  await page.goto(`/workshop/papercut?m07db=${name}&workId=${id}&version=stored-draft`);
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const rows = await readRows(page, name);
  expect(rows.drafts).toHaveLength(0);
  expect(rows.works[0]?.schemaVersion).toBe(2);
  expect(rows.thumbnails[0]).toMatchObject({ state: 'ready', blobType: 'image/png' });
  expect(rows.thumbnails[0]?.blobSize).toBeGreaterThan(100);
});

test('two tabs report a v2 draft conflict without losing the second canvas', async ({ page, context }) => {
  const name = database(), id = 'conflict-v2';
  const draft = { workId: id, work: v2(id), step: 'cut', revision: 5, baseRevision: null, updatedAt: time };
  await seed(page, name, [], [draft], [{ workId: id, revision: 5 }]);
  const url = `/workshop/papercut?m07db=${name}&workId=${id}&version=stored-draft`;
  await page.goto(url);
  const second = await context.newPage();
  await second.goto(url);
  for (const target of [page, second]) {
    await target.getByRole('button', { name: '清空' }).click();
    await target.getByRole('button', { name: '确认清空' }).click();
    await expect(target.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  }
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect.poll(async () => (await readRows(page, name)).drafts[0]?.revision).toBeGreaterThan(5);
  await second.getByRole('button', { name: '保存草稿' }).click();
  await expect(second.getByText(/修订冲突/)).toBeVisible();
  await expect(second.getByRole('button', { name: '重新载入' })).toBeVisible();
  await expect(second.getByRole('button', { name: '重试保存' })).toBeVisible();
  await expect(second.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
});

test('new work creates only one v2 draft and opens FreehandEditor', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).first().dblclick();
  await expect(page).toHaveURL(/workId=[^&]+&version=stored-draft/);
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  const rows = await readRows(page, name);
  expect(rows.works).toHaveLength(0);
  expect(rows.drafts).toHaveLength(1);
  expect(rows.drafts[0]?.work).toMatchObject({ schemaVersion: 2, revision: 0, status: 'draft', operations: [] });
});

test('templateId deep link auto-creates exactly once across StrictMode effects', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}&templateId=${template.id}`);
  await expect(page).toHaveURL(/workId=[^&]+&version=stored-draft/);
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  const rows = await readRows(page, name);
  expect(rows.works).toHaveLength(0);
  expect(rows.drafts).toHaveLength(1);
  expect((rows.drafts[0]?.work as { templateSnapshot?: { id?: string } }).templateSnapshot?.id).toBe(template.id);
});

test('official seven-shape template creates, exposes isolated tools, auto-saves and restores', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}&templateId=template-v2-c04`);
  await expect(page).toHaveURL(/workId=[^&]+&version=stored-draft/);
  for (const label of ['椭圆', '矩形', '五角星', '花瓣']) await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  await page.getByRole('button', { name: /^五角星/ }).click();
  const start = await paperPosition(page, 0.14, 0.2), end = await paperPosition(page, 0.23, 0.3);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: /^选择V/ }).click();
  const createdCenter = await paperPosition(page, 0.185, 0.25);
  await page.mouse.click(createdCenter.x, createdCenter.y);
  let handle = await page.locator('[data-transform-handle="se"]').boundingBox();
  if (!handle) throw new Error('missing scale handle');
  await page.mouse.move(handle.x + 22, handle.y + 22); await page.mouse.down(); await page.mouse.move(handle.x + 34, handle.y + 30); await page.mouse.up();
  handle = await page.locator('[data-transform-handle="rotate"]').boundingBox();
  if (!handle) throw new Error('missing rotate handle');
  await page.mouse.move(handle.x + 22, handle.y + 22); await page.mouse.down(); await page.mouse.move(handle.x + 42, handle.y + 40); await page.mouse.up();
  await expect.poll(async () => {
    const rows = await readRows(page, name);
    const work = rows.drafts[0]?.work as { operations?: { shape?: string; angleDeg?: number }[] } | undefined;
    return work?.operations?.[0]?.shape === 'star' && (work.operations[0]?.angleDeg ?? 0) > 0;
  }).toBe(true);
  const transformed = ((await readRows(page, name)).drafts[0]?.work as {
    operations?: { shape: string; center: { x: number; y: number }; width: number; height: number; angleDeg: number }[];
  }).operations?.[0];
  expect(transformed).toMatchObject({ shape: 'star' });
  expect(transformed!.width).toBeGreaterThan(0.09);
  expect(transformed!.height).toBeGreaterThan(0.1);
  expect(transformed!.angleDeg).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  const rows = await readRows(page, name);
  expect(rows.drafts).toHaveLength(1);
  expect((rows.drafts[0]?.work as { templateSnapshot?: { id?: string } }).templateSnapshot?.id).toBe('template-v2-c04');
  expect((rows.drafts[0]?.work as { operations?: unknown[] }).operations?.[0]).toEqual(transformed);
  const center = await paperPosition(page, 0.185, 0.25), moved = await paperPosition(page, 0.205, 0.27);
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(moved.x, moved.y, { steps: 3 }); await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-selected-id', /.+/);
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const completedRows = await readRows(page, name);
  expect(completedRows.drafts).toHaveLength(0);
  expect(completedRows.thumbnails[0]).toMatchObject({ state: 'ready', blobType: 'image/png' });
  const completedWork = completedRows.works[0] as {
    palette: { paper: string; background: string };
    operations?: { shape: string; center: { x: number; y: number }; width: number; height: number; angleDeg: number }[];
  };
  const completedOperation = completedWork.operations?.[0];
  expect(completedOperation).toMatchObject({
    shape: 'star', width: transformed!.width, height: transformed!.height, angleDeg: transformed!.angleDeg,
  });
  expect(completedOperation?.center).not.toEqual(transformed!.center);

  await page.goto(`/my/works?m07db=${name}`);
  await page.locator('.mw-version-actions').filter({ hasText: '完成版 · v2' }).getByRole('button', { name: '导出 PNG' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成', { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  const exportedPixels = await page.locator('.mw-export-preview').evaluate(async (element, operation) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const response = await fetch(image.src);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('missing export canvas');
    context.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const artX = 200, artY = 130, artSize = 1200;
    return {
      size: [canvas.width, canvas.height],
      signature: Array.from(bytes.slice(0, 8)),
      transformedCenter: pixel(artX + artSize * operation.center.x, artY + artSize * operation.center.y),
      untouchedPaper: pixel(artX + artSize * 0.32, artY + artSize * 0.25),
    };
  }, completedOperation!);
  expect(exportedPixels.size).toEqual([1600, 2000]);
  expect(exportedPixels.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(exportedPixels.transformedCenter).toEqual(rgba(completedWork.palette.background));
  expect(exportedPixels.untouchedPaper).toEqual(rgba(completedWork.palette.paper));
});

test('legacy formal template does not expose new-shape tools', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}&templateId=${template.id}`);
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  for (const label of ['椭圆', '矩形', '五角星', '花瓣']) await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveCount(0);
});

test('failed creation stays on the chooser and can be retried', async ({ page }) => {
  const name = database();
  await page.goto(`/workshop/papercut?m07db=${name}&m07fault=quota`);
  await page.getByRole('button', { name: '使用模板' }).first().click();
  await expect(page.getByText(/创建失败/)).toBeVisible();
  await expect(page).not.toHaveURL(/workId=/);
  await expect(page.getByRole('button', { name: '使用模板' }).first()).toBeEnabled();
  await page.getByRole('button', { name: '使用模板' }).first().click();
  await expect(page.getByText(/创建失败/)).toBeVisible();
  await page.goto('/');
  const rows = await readRows(page, name);
  expect(rows.works).toHaveLength(0);
  expect(rows.drafts).toHaveLength(0);
});

test('duplicate selection with button and shortcuts persists and undoes in Edge', async ({ page }) => {
  const name = database();
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto(`/workshop/papercut?m07db=${name}&templateId=template-v2-c04`);
  await page.getByRole('button', { name: /^五角星/ }).click();
  const start = await paperPosition(page, 0.14, 0.2), end = await paperPosition(page, 0.23, 0.3);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  const editor = page.locator('.m15b-editor');
  await expect(editor).toHaveAttribute('data-operation-count', '1');
  await page.getByRole('button', { name: /^选择V/ }).click();
  const center = await paperPosition(page, 0.185, 0.25); await page.mouse.click(center.x, center.y);
  const source = await editor.getAttribute('data-selected-id');
  const button = page.getByRole('button', { name: '复制', exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click(); await expect(editor).toHaveAttribute('data-operation-count', '2');
  await expect(editor).not.toHaveAttribute('data-selected-id', source!);
  await page.keyboard.press('Control+d'); await expect(editor).toHaveAttribute('data-operation-count', '3');
  await page.keyboard.press('Meta+d'); await expect(editor).toHaveAttribute('data-operation-count', '4');
  await page.locator('.m16k-properties input').first().focus();
  await page.keyboard.press('Control+d'); await expect(editor).toHaveAttribute('data-operation-count', '4');
  await page.getByRole('button', { name: '撤销' }).click(); await expect(editor).toHaveAttribute('data-operation-count', '3');
  await page.getByRole('button', { name: '重做' }).click(); await expect(editor).toHaveAttribute('data-operation-count', '4');
  await expect.poll(async () => ((await readRows(page, name)).drafts[0]?.work as { operations?: unknown[] })?.operations?.length).toBe(4);
  await page.reload(); await expect(editor).toHaveAttribute('data-operation-count', '4');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const scenario of [
  { name: 'parametric', operation: operationV2, hit: { x: .2, y: .3 } },
  { name: 'freehand', operation: { kind: 'freehand', id: 'freehand', order: 0, parameterVersion: 2, closed: true, points: [{ x: .15, y: .2 }, { x: .25, y: .2 }, { x: .25, y: .3 }, { x: .15, y: .3 }] }, hit: { x: .15, y: .25 } },
  { name: 'brush', operation: { kind: 'brush', id: 'brush', order: 0, parameterVersion: 2, points: [{ x: .14, y: .2 }, { x: .19, y: .23 }, { x: .25, y: .2 }], width: .02 }, hit: { x: .19, y: .23 } },
  { name: 'line', operation: { kind: 'brush', id: 'line', order: 0, parameterVersion: 2, points: [{ x: .14, y: .2 }, { x: .25, y: .2 }], width: .02 }, hit: { x: .19, y: .2 } },
] as const) {
  test(`Edge duplicates and moves ${scenario.name}`, async ({ page }) => {
    const name = database(), id = `copy-${scenario.name}`;
    const work = { ...v2(id), operations: [scenario.operation] };
    await seed(page, name, [], [{ workId: id, work, step: 'cut', revision: 5, baseRevision: null, updatedAt: time }], [{ workId: id, revision: 5 }]);
    await page.goto(`/workshop/papercut?m07db=${name}&workId=${id}&version=stored-draft`);
    await page.getByRole('button', { name: /^选择V/ }).click();
    const hit = await paperPosition(page, scenario.hit.x, scenario.hit.y); await page.mouse.click(hit.x, hit.y);
    const editor = page.locator('.m15b-editor'); await expect(editor).toHaveAttribute('data-selected-id', scenario.operation.id);
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await expect(editor).toHaveAttribute('data-operation-count', '2');
    const copyId = await editor.getAttribute('data-selected-id'); expect(copyId).not.toBe(scenario.operation.id);
    await page.getByRole('application', { name: /剪纸画布/ }).focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => {
      const ops = ((await readRows(page, name)).drafts[0]?.work as { operations: { id: string; order: number; center?: { x: number }; points?: { x: number }[] }[] }).operations;
      const originalX = ops[0]!.center?.x ?? ops[0]!.points![0]!.x;
      const copiedX = ops[1]?.center?.x ?? ops[1]?.points?.[0]?.x;
      return copiedX !== undefined && copiedX - originalX > .025;
    }).toBe(true);
    const ops = ((await readRows(page, name)).drafts[0]?.work as { operations: { id: string; order: number }[] }).operations;
    expect(ops[0]).toEqual(scenario.operation); expect(ops[1]).toMatchObject({ id: copyId, order: 1 });
  });
}

test('Edge transforms a duplicate and renders its pixels in saved thumbnail and PNG', async ({ page }) => {
  const name = database(), id = 'duplicate-pixels';
  const work = v2(id);
  await seed(page, name, [], [{ workId: id, work, step: 'cut', revision: 5, baseRevision: null, updatedAt: time }], [{ workId: id, revision: 5 }]);
  await page.goto(`/workshop/papercut?m07db=${name}&workId=${id}&version=stored-draft`);
  await page.getByRole('button', { name: /^选择V/ }).click();
  const hit = await paperPosition(page, .2, .3); await page.mouse.click(hit.x, hit.y);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
  await page.getByLabel('中心 X', { exact: true }).fill('34');
  await page.getByLabel('中心 Y', { exact: true }).fill('32');
  await page.getByLabel('宽度', { exact: true }).fill('8');
  await page.getByLabel('高度', { exact: true }).fill('8');
  await page.getByLabel('旋转角度', { exact: true }).fill('45');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(async () => {
    const operations = ((await readRows(page, name)).drafts[0]?.work as { operations: { center: { x: number; y: number }; width: number; angleDeg: number }[] }).operations;
    return operations[1];
  }).toMatchObject({ center: { x: .34, y: .32 }, width: .08, height: .08, angleDeg: 45 });
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const pixels = await page.evaluate(async dbName => {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const request = indexedDB.open(dbName, 3);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('thumbnails', 'readonly');
        const get = tx.objectStore('thumbnails').getAll();
        get.onsuccess = () => resolve(get.result[0].blob as Blob); get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
      }; request.onerror = () => reject(request.error);
    });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(x * canvas.width), Math.round(y * canvas.height), 1, 1).data);
    return { duplicate: pixel(.34, .32), paper: pixel(.29, .32) };
  }, name);
  expect(pixels.duplicate).toEqual(rgba(work.palette.background));
  expect(pixels.paper).toEqual(rgba(work.palette.paper));
  const saved = (await readRows(page, name)).works[0] as { operations: unknown[] };
  expect(saved.operations[0]).toEqual(operationV2);
  await page.goto(`/my/works?m07db=${name}`);
  await page.locator('.mw-version-actions').filter({ hasText: '完成版 · v2' }).getByRole('button', { name: '导出 PNG' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成', { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  const cardPixels = await page.locator('.mw-export-preview').evaluate(async element => {
    const image = element as HTMLImageElement; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(200 + x * 1200), Math.round(130 + y * 1200), 1, 1).data);
    return { duplicate: pixel(.34, .32), paper: pixel(.29, .32) };
  });
  expect(cardPixels.duplicate).toEqual(rgba(work.palette.background));
  expect(cardPixels.paper).toEqual(rgba(work.palette.paper));
});
