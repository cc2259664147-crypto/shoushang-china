import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { EditorProfileV2Schema, TemplateVersionV1Schema, WorkV2Schema, type WorkV2 } from '@shoushang/contracts';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json' with { type: 'json' };

const browserModule = (path: string) => '/@fs/' + resolve(path).replaceAll('\\', '/');
const entry = profilesDocument.profiles[0]!;
const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
const profile = EditorProfileV2Schema.parse(entry.profile);
// 与直线工具提交结果一致：只有起点和终点的 brush。
const work: WorkV2 = WorkV2Schema.parse({
  id: 'line-render-work', name: '直线导出测试', craftId: template.craftId,
  templateSnapshot: template, editorProfileSnapshot: profile,
  palette: { paper: '#B82025', background: '#F2D9A6' },
  operations: [
    { kind: 'brush', id: 'line-a', order: 0, parameterVersion: 2, points: [{ x: 0.12, y: 0.2 }, { x: 0.3, y: 0.2 }], width: 0.02 },
    { kind: 'brush', id: 'line-b', order: 1, parameterVersion: 2, points: [{ x: 0.15, y: 0.55 }, { x: 0.3, y: 0.7 }], width: 0.02 },
  ],
  status: 'draft', schemaVersion: 2, revision: 0,
  createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
});

test('Edge paints two-point line strokes as round-capped removed paper', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ rendererUrl, input }) => {
    const { createArtworkRendererV2 } = await import(/* @vite-ignore */ rendererUrl) as typeof import('@shoushang/artwork-renderer');
    const rendered = createArtworkRendererV2().render({ work: input, width: 400, height: 400, view: 'unfolded' });
    if (!rendered.ok) return { error: rendered.error.code, svg: '', pixels: {} };
    const image = new Image();
    const url = URL.createObjectURL(new Blob([rendered.value.svg], { type: 'image/svg+xml' }));
    try {
      image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
      const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
      return {
        error: '', svg: rendered.value.svg,
        pixels: {
          lineCenter: pixel(84, 80), lineBeside: pixel(84, 90), lineBeyond: pixel(128, 80),
          reflectedCenter: pixel(316, 80), diagonalCenter: pixel(90, 250), outside: pixel(84, 320),
        },
      };
    } finally { URL.revokeObjectURL(url); }
  }, { rendererUrl: browserModule('packages/artwork-renderer/src/index.ts'), input: work });
  expect(result.error).toBe('');
  expect(result.svg).toContain('stroke-linecap%3D%22round%22');
  expect(result.svg).toContain('stroke-linejoin%3D%22round%22');
  expect(result.pixels.lineCenter).toEqual([242, 217, 166]);
  expect(result.pixels.reflectedCenter).toEqual([242, 217, 166]);
  expect(result.pixels.diagonalCenter).toEqual([242, 217, 166]);
  expect(result.pixels.lineBeside).toEqual([184, 32, 37]);
  expect(result.pixels.lineBeyond).toEqual([184, 32, 37]);
  expect(result.pixels.outside).toEqual([184, 32, 37]);
});

test('Edge creates a line thumbnail and a 1600x2000 PNG card with real line pixels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ rendererUrl, exporterUrl, sessionUrl, input }) => {
    const { createArtworkRendererV2 } = await import(/* @vite-ignore */ rendererUrl) as typeof import('@shoushang/artwork-renderer');
    const { createArtworkExporterV2 } = await import(/* @vite-ignore */ exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createV2Thumbnail } = await import(/* @vite-ignore */ sessionUrl) as typeof import('./versioned-workshop-session');
    const renderer = createArtworkRendererV2();
    const thumbnail = await createV2Thumbnail(input, renderer);
    const thumbBitmap = await createImageBitmap(thumbnail);
    const thumbCanvas = document.createElement('canvas'); thumbCanvas.width = thumbBitmap.width; thumbCanvas.height = thumbBitmap.height;
    const thumbContext = thumbCanvas.getContext('2d', { willReadFrequently: true })!;
    thumbContext.drawImage(thumbBitmap, 0, 0);
    const thumbPixel = (x: number, y: number) => Array.from(thumbContext.getImageData(x, y, 1, 1).data.slice(0, 3));

    const exported = await createArtworkExporterV2().exportCard({ work: input });
    if (!exported.ok) return { ok: false as const, error: exported.error.code };
    const signature = Array.from(exported.value.bytes.slice(0, 8));
    const bitmap = await createImageBitmap(new Blob([exported.value.bytes.slice().buffer], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    const report = {
      ok: true as const, signature, width: exported.value.width, height: exported.value.height,
      bitmapWidth: bitmap.width, bitmapHeight: bitmap.height,
      cardLine: pixel(452, 370), cardPaper: pixel(452, 430), cardDiagonal: pixel(470, 880),
      thumbnail: {
        type: thumbnail.type, size: thumbnail.size, width: thumbBitmap.width, height: thumbBitmap.height,
        line: thumbPixel(101, 96), paper: thumbPixel(101, 120),
      },
    };
    bitmap.close(); thumbBitmap.close();
    return report;
  }, {
    rendererUrl: browserModule('packages/artwork-renderer/src/index.ts'),
    exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'),
    sessionUrl: browserModule('apps/web/src/features/workshop/versioned-workshop-session.ts'),
    input: work,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([result.width, result.height, result.bitmapWidth, result.bitmapHeight]).toEqual([1600, 2000, 1600, 2000]);
  expect(result.cardLine).toEqual([242, 217, 166]);
  expect(result.cardDiagonal).toEqual([242, 217, 166]);
  expect(result.cardPaper).toEqual([184, 32, 37]);
  expect(result.thumbnail).toMatchObject({ type: 'image/png', width: 480, height: 480 });
  expect(result.thumbnail.size).toBeGreaterThan(100);
  expect(result.thumbnail.line).toEqual([242, 217, 166]);
  expect(result.thumbnail.paper).toEqual([184, 32, 37]);
});
