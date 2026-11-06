import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { WorkV2Schema, type WorkV2 } from '@shoushang/contracts';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json' with { type: 'json' };

const browserModule = (path: string) => '/@fs/' + resolve(path).replaceAll('\\', '/');
const entry = profilesDocument.profiles[0]!;
const shapes = ['ellipse', 'rectangle', 'star', 'petal'] as const;
const template = {
  ...JSON.parse(entry.evidence.sourceTemplateCanonicalJcs), id: 'm16g-render-template',
  allowedCuts: shapes.map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 })),
};
const profile = {
  ...entry.profile, profileId: 'm16g-render-profile',
  sourceTemplate: { ...entry.profile.sourceTemplate, id: template.id },
  allowedTools: { ...entry.profile.allowedTools, parametric: [...shapes] },
};
const centers = [{ x: 0.15, y: 0.2 }, { x: 0.34, y: 0.2 }, { x: 0.15, y: 0.45 }, { x: 0.34, y: 0.45 }];
const work: WorkV2 = WorkV2Schema.parse({
  id: 'm16g-render-work', name: 'M16-G 图形', craftId: template.craftId,
  templateSnapshot: template, editorProfileSnapshot: profile,
  palette: { paper: '#B82025', background: '#F2D9A6' },
  operations: shapes.map((shape, order) => ({ kind: 'parametric', id: shape, order, parameterVersion: 2, shape, center: centers[order], width: 0.08, height: 0.1, angleDeg: 23 })),
  status: 'draft', schemaVersion: 2, revision: 0,
  createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
});

test('Edge paints all four new SVG shapes and their symmetric copies as removed paper', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ rendererUrl, input, points }) => {
    const { createArtworkRendererV2 } = await import(/* @vite-ignore */ rendererUrl) as typeof import('@shoushang/artwork-renderer');
    const rendered = createArtworkRendererV2().render({ work: input, width: 400, height: 400, view: 'unfolded' });
    if (!rendered.ok) return { error: rendered.error.code, svg: '', pixels: [] as number[][], mirrors: [] as number[][] };
    const image = new Image();
    const url = URL.createObjectURL(new Blob([rendered.value.svg], { type: 'image/svg+xml' }));
    try {
      image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
      const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
      return {
        error: '', svg: rendered.value.svg,
        pixels: points.map(point => pixel(point.x * 400, point.y * 400)),
        mirrors: points.map(point => pixel((1 - point.x) * 400, point.y * 400)),
      };
    } finally { URL.revokeObjectURL(url); }
  }, { rendererUrl: browserModule('packages/artwork-renderer/src/index.ts'), input: work, points: centers });
  expect(result.error).toBe('');
  expect(result.svg).toContain('%3Cellipse');
  expect(result.svg).toContain('matrix(0.920505%200.390731%20-0.390731%200.920505');
  expect(result.pixels).toEqual(Array.from({ length: 4 }, () => [242, 217, 166]));
  expect(result.mirrors).toEqual(Array.from({ length: 4 }, () => [242, 217, 166]));
});

test('thumbnail and 1600x2000 PNG use the same new-shape cut pixels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ rendererUrl, exporterUrl, sessionUrl, input, points }) => {
    const { createArtworkRendererV2 } = await import(/* @vite-ignore */ rendererUrl) as typeof import('@shoushang/artwork-renderer');
    const { createArtworkExporterV2 } = await import(/* @vite-ignore */ exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createV2Thumbnail } = await import(/* @vite-ignore */ sessionUrl) as typeof import('./versioned-workshop-session');
    const renderer = createArtworkRendererV2();
    const thumbnail = await createV2Thumbnail(input, renderer);
    const thumb = await createImageBitmap(thumbnail);
    const exported = await createArtworkExporterV2().exportCard({ work: input });
    if (!exported.ok) return { ok: false as const, error: exported.error.code };
    const bitmap = await createImageBitmap(new Blob([exported.value.bytes.slice().buffer], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    const cutPixels = points.map(point => pixel(200 + 1200 * point.x, 130 + 1200 * point.y));
    const report = {
      ok: true as const, signature: Array.from(exported.value.bytes.slice(0, 8)),
      width: bitmap.width, height: bitmap.height, cutPixels,
      thumbnail: { type: thumbnail.type, size: thumbnail.size, width: thumb.width, height: thumb.height },
    };
    bitmap.close(); thumb.close();
    return report;
  }, {
    rendererUrl: browserModule('packages/artwork-renderer/src/index.ts'),
    exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'),
    sessionUrl: browserModule('apps/web/src/features/workshop/versioned-workshop-session.ts'),
    input: work, points: centers,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([result.width, result.height]).toEqual([1600, 2000]);
  expect(result.cutPixels).toEqual(Array.from({ length: 4 }, () => [242, 217, 166]));
  expect(result.thumbnail).toMatchObject({ type: 'image/png', width: 480, height: 480 });
  expect(result.thumbnail.size).toBeGreaterThan(100);
});
