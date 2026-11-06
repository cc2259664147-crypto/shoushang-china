import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { WorkV2 } from '@shoushang/contracts';

const browserModule = (path: string) => '/@fs/' + resolve(path).replaceAll('\\', '/');
// App.tsx 只把 m07-test- 开头的 m07db 名称当作隔离数据库。
const database = () => `m07-test-m16i-${Date.now()}-${Math.random().toString(16).slice(2)}`;

interface LineWorkRow {
  readonly operations: ReadonlyArray<{ kind: string; points: readonly { x: number; y: number }[]; width: number; id: string }>;
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

async function drawLineStroke(page: Page): Promise<void> {
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  const at = (x: number, y: number) => ({ x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base });
  await page.getByRole('button', { name: /直线/ }).click();
  const start = at(0.2, 0.3), end = at(0.32, 0.42);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
}

async function createWorkWithLine(page: Page, name: string): Promise<void> {
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await page.getByRole('button', { name: '使用模板' }).first().click();
  await expect(page).toHaveURL(/workId=[^&]+&version=stored-draft/);
  await drawLineStroke(page);
}

test('a drawn line auto-saves as a two-point brush and survives a refresh', async ({ page }) => {
  const name = database();
  await createWorkWithLine(page, name);
  await expect.poll(async () => {
    const work = (await readRows(page, name)).drafts[0]?.work as LineWorkRow | undefined;
    return work?.operations.length ?? 0;
  }).toBeGreaterThan(0);
  const saved = await readRows(page, name);
  const savedWork = saved.drafts[0]?.work as LineWorkRow;
  expect(savedWork.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(savedWork.operations[0]!.id.startsWith('line-')).toBe(true);
  expect(savedWork.operations[0]!.points).toHaveLength(2);

  await page.reload();
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  const restored = await readRows(page, name);
  const restoredWork = restored.drafts[0]?.work as LineWorkRow;
  expect(restoredWork.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(restoredWork.operations[0]!.points).toHaveLength(2);
  expect(restoredWork.operations[0]!.points[0]!.x).toBeCloseTo(0.2, 4);
  expect(restoredWork.operations[0]!.points[1]!.x).toBeCloseTo(0.32, 4);
});

test('completing a line work saves it with a ready PNG thumbnail and exports a PNG card', async ({ page }) => {
  const name = database();
  await createWorkWithLine(page, name);
  await page.getByRole('button', { name: '完成并保存作品' }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  const rows = await readRows(page, name);
  expect(rows.drafts).toHaveLength(0);
  const savedWork = rows.works[0] as unknown as LineWorkRow;
  expect(savedWork.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(savedWork.operations[0]!.points).toHaveLength(2);
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

test('undo and redo of a line stay consistent after auto-save and refresh', async ({ page }) => {
  const name = database();
  await createWorkWithLine(page, name);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await expect.poll(async () => {
    const work = (await readRows(page, name)).drafts[0]?.work as LineWorkRow | undefined;
    return work?.operations.length ?? 0;
  }).toBe(1);

  await page.reload();
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  const restored = (await readRows(page, name)).drafts[0]?.work as LineWorkRow;
  expect(restored.operations[0]).toMatchObject({ kind: 'brush', width: 0.02 });
  expect(restored.operations[0]!.points).toHaveLength(2);
});
