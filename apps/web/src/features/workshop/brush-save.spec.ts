import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { WorkV2 } from '@shoushang/contracts';

const browserModule = (path: string) => '/@fs/' + resolve(path).replaceAll('\\', '/');
// App.tsx 只把 m07-test- 开头的 m07db 名称当作隔离数据库。
const database = () => `m07-test-m16e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const rgba = (hex: string) => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16), 255];

interface BrushWorkRow {
  readonly operations: ReadonlyArray<{ kind: string; points: readonly unknown[]; width: number; id: string }>;
}

async function readRows(page: Page, name: string) {
  return page.evaluate(async dbName => new Promise<{ works: Record<string, unknown>[]; drafts: { work: unknown; revision: number }[]; thumbnails: { state: string; blobType: string; blobSize: number }[] }>((resolveRows, reject) => {
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onsuccess = () => {
      const db = request.result;
      if (!['works', 'drafts', 'thumbnails'].every(store => db.objectStoreNames.contains(store))) {
        db.close();
        reject(new Error(`数据库 ${dbName} 缺少预期存储：${[...db.objectStoreNames].join(',')}`));
        return;
      }
      const tx = db.transaction(['works', 'drafts', 'thumbnails'], 'readonly');
      const works = tx.objectStore('works').getAll(), drafts = tx.objectStore('drafts').getAll(), thumbnails = tx.objectStore('thumbnails').getAll();
      tx.oncomplete = () => {
        resolveRows({
          works: works.result,
          drafts: drafts.result.map((row: { work: unknown; revision: number }) => ({ work: row.work, revision: row.revision })),
          thumbnails: thumbnails.result.map((row: { state: string; blob?: Blob }) => ({ state: row.state, blobType: row.blob?.type ?? '', blobSize: row.blob?.size ?? 0 })),
        });
        db.close();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }), name);
}

async function drawBrushStroke(page: Page): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  const at = (x: number, y: number) => ({ x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base });
  await page.getByRole('button', { name: /剪除笔刷/ }).click();
  const start = at(0.2, 0.3), end = at(0.32, 0.42);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
}

async function createWorkWithBrush(page: Page, name: string): Promise<void> {
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).first().click();
  await expect(page).toHaveURL(/workId=[^&]+&version=stored-draft/);
  await drawBrushStroke(page);
}

async function paperPosition(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

async function createWorkWithParametricCut(page: Page, name: string): Promise<void> {
  await page.goto(`/workshop/papercut?m07db=${name}&templateId=template-v2-c04`);
  await expect(page).toHaveURL(/workId=[^&]+&version=stored-draft/);
  await page.getByRole('button', { name: /^矩形/ }).click();
  const start = await paperPosition(page, 0.16, 0.28), end = await paperPosition(page, 0.24, 0.36);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
}

test('a drawn brush stroke auto-saves and survives a refresh', async ({ page }) => {
  const name = database();
  await createWorkWithBrush(page, name);
  await expect.poll(async () => {
    const work = (await readRows(page, name)).drafts[0]?.work as BrushWorkRow | undefined;
    return work?.operations.length ?? 0;
  }).toBeGreaterThan(0);
  const saved = await readRows(page, name);
  const savedWork = saved.drafts[0]?.work as BrushWorkRow;
  expect(savedWork.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(savedWork.operations[0]!.id.startsWith('brush-')).toBe(true);

  await page.reload();
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  const restored = await readRows(page, name);
  const restoredWork = restored.drafts[0]?.work as BrushWorkRow;
  expect(restoredWork.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(restoredWork.operations[0]!.points.length).toBeGreaterThanOrEqual(1);
});

test('completing a brush work saves it with a ready PNG thumbnail and exports a PNG card', async ({ page }) => {
  const name = database();
  await createWorkWithBrush(page, name);
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const rows = await readRows(page, name);
  expect(rows.drafts).toHaveLength(0);
  const savedWork = rows.works[0] as unknown as BrushWorkRow;
  expect(savedWork.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(rows.thumbnails[0]).toMatchObject({ state: 'ready', blobType: 'image/png' });
  expect(rows.thumbnails[0]?.blobSize).toBeGreaterThan(100);

  const exported = await page.evaluate(async ({ exporterUrl, work }: { exporterUrl: string; work: WorkV2 }) => {
    const { createArtworkExporterV2 } = await import(/* @vite-ignore */ exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const result = await createArtworkExporterV2().exportCard({ work });
    if (!result.ok) return { ok: false as const, error: result.error.code };
    return {
      ok: true as const,
      signature: Array.from(result.value.bytes.slice(0, 8)),
      width: result.value.width,
      height: result.value.height,
      size: result.value.bytes.length,
    };
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), work: rows.works[0] as unknown as WorkV2 });
  expect(exported.ok).toBe(true);
  if (!exported.ok) return;
  expect(exported.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([exported.width, exported.height]).toEqual([1600, 2000]);
  expect(exported.size).toBeGreaterThan(1000);
});

test('a handle-scaled and rotated parametric cut persists, restores, thumbnails and exports transformed pixels', async ({ page }) => {
  const name = database();
  await createWorkWithParametricCut(page, name);
  await expect.poll(async () => {
    const work = (await readRows(page, name)).drafts[0]?.work as WorkV2 | undefined;
    return work?.operations.length ?? 0;
  }).toBe(1);
  await page.getByRole('button', { name: /^选择V/ }).click();
  const originalCenter = await paperPosition(page, 0.2, 0.32);
  await page.mouse.click(originalCenter.x, originalCenter.y);

  let handle = await page.locator('[data-transform-handle="se"]').boundingBox();
  if (!handle) throw new Error('missing scale handle');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 32, handle.y + handle.height / 2 + 8, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => {
    const work = (await readRows(page, name)).drafts[0]?.work as WorkV2 | undefined;
    const operation = work?.operations[0];
    return operation?.kind === 'parametric' ? operation.width : 0;
  }).toBeGreaterThan(0.08);

  let rows = await readRows(page, name);
  let work = rows.drafts[0]?.work as WorkV2;
  const scaled = work.operations[0];
  if (scaled?.kind !== 'parametric') throw new Error('missing scaled parametric cut');
  expect(scaled).toMatchObject({ shape: 'rectangle', parameterVersion: 2, angleDeg: 0 });
  expect(scaled.width).toBeGreaterThan(0.08);
  expect(scaled.height).toBeGreaterThan(0.08);
  expect(scaled.width / scaled.height).not.toBeCloseTo(1, 2);

  handle = await page.locator('[data-transform-handle="rotate"]').boundingBox();
  if (!handle) throw new Error('missing rotate handle');
  const scaledCenter = await paperPosition(page, scaled.center.x, scaled.center.y);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(scaledCenter.x + Math.cos(-Math.PI / 4) * 80, scaledCenter.y + Math.sin(-Math.PI / 4) * 80, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => {
    const saved = (await readRows(page, name)).drafts[0]?.work as WorkV2 | undefined;
    const operation = saved?.operations[0];
    return operation?.kind === 'parametric' ? operation.angleDeg : 0;
  }).toBeGreaterThan(20);

  rows = await readRows(page, name);
  work = rows.drafts[0]?.work as WorkV2;
  const transformed = work.operations[0];
  if (transformed?.kind !== 'parametric') throw new Error('missing transformed parametric cut');
  expect(transformed.width).toBe(scaled.width);
  expect(transformed.height).toBe(scaled.height);
  expect(transformed.angleDeg).toBeGreaterThan(20);
  expect(transformed.angleDeg).toBeLessThan(70);

  await page.reload();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  rows = await readRows(page, name);
  const restored = (rows.drafts[0]?.work as WorkV2).operations[0];
  expect(restored).toEqual(transformed);
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  rows = await readRows(page, name);
  expect(rows.drafts).toHaveLength(0);
  expect(rows.thumbnails[0]).toMatchObject({ state: 'ready', blobType: 'image/png' });
  expect(rows.thumbnails[0]?.blobSize).toBeGreaterThan(100);
  work = rows.works[0] as unknown as WorkV2;
  expect(work.operations[0]).toEqual(transformed);

  const angle = transformed.angleDeg * Math.PI / 180;
  const local = { x: transformed.width * 0.38, y: transformed.height * 0.38 };
  const transformedPixel = {
    x: transformed.center.x + Math.cos(angle) * local.x - Math.sin(angle) * local.y,
    y: transformed.center.y + Math.sin(angle) * local.x + Math.cos(angle) * local.y,
  };
  expect(
    Math.abs(transformedPixel.x - transformed.center.x) > transformed.width / 2
      || Math.abs(transformedPixel.y - transformed.center.y) > transformed.height / 2,
  ).toBe(true);

  const rendered = await page.evaluate(async ({ exporterUrl, value, dbName, cutPoint }: { exporterUrl: string; value: WorkV2; dbName: string; cutPoint: { x: number; y: number } }) => {
    const { createArtworkExporterV2 } = await import(/* @vite-ignore */ exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const thumbnail = await new Promise<Blob>((resolveBlob, reject) => {
      const opened = indexedDB.open(dbName);
      opened.onsuccess = () => {
        const db = opened.result;
        const request = db.transaction('thumbnails', 'readonly').objectStore('thumbnails').get(value.id);
        request.onsuccess = () => { db.close(); request.result?.blob ? resolveBlob(request.result.blob) : reject(new Error('missing thumbnail blob')); };
        request.onerror = () => { db.close(); reject(request.error); };
      };
      opened.onerror = () => reject(opened.error);
    });
    const thumbnailBitmap = await createImageBitmap(thumbnail);
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = thumbnailBitmap.width; thumbnailCanvas.height = thumbnailBitmap.height;
    const thumbnailContext = thumbnailCanvas.getContext('2d', { willReadFrequently: true })!;
    thumbnailContext.drawImage(thumbnailBitmap, 0, 0);
    const thumbnailPixel = Array.from(thumbnailContext.getImageData(Math.round(cutPoint.x * 480), Math.round(cutPoint.y * 480), 1, 1).data);
    thumbnailBitmap.close();

    const result = await createArtworkExporterV2().exportCard({ work: value });
    if (!result.ok) return null;
    const bitmap = await createImageBitmap(new Blob([result.value.bytes.slice().buffer], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const report = {
      signature: Array.from(result.value.bytes.slice(0, 8)), width: result.value.width, height: result.value.height,
      thumbnailPixel,
      transformedPixel: pixel(200 + 1200 * cutPoint.x, 130 + 1200 * cutPoint.y),
      untouchedPaper: pixel(200 + 1200 * 0.36, 130 + 1200 * 0.78),
    };
    bitmap.close();
    return report;
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), value: work, dbName: name, cutPoint: transformedPixel });
  expect(rendered).not.toBeNull();
  expect(rendered?.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([rendered?.width, rendered?.height]).toEqual([1600, 2000]);
  expect(rendered?.thumbnailPixel).toEqual(rgba(work.palette.background));
  expect(rendered?.transformedPixel).toEqual(rgba(work.palette.background));
  expect(rendered?.untouchedPaper).toEqual(rgba(work.palette.paper));
});
