import type { ApiError, ArtworkRenderer, RenderInput, RenderOutput, Result } from '@shoushang/contracts';
import { getWorkGeometry } from '@shoushang/papercut-core';
import { snapshotValue } from './snapshot';
import { assembleSvg } from './svg';

export type { RenderInput, RenderOutput, ArtworkRenderer } from '@shoushang/contracts';
export type { RenderInputV2, RenderOutputV2, ArtworkRendererV2 } from './v2';
export { createArtworkRendererV2 } from './v2';

const requestId = 'artwork-renderer-v1';
const number = (value: number): string => Object.is(value, -0) ? '0' : String(value);

function error(path: string, message: string): Result<never> {
  const value: ApiError = { code: 'INVALID_INPUT', message, requestId, fieldErrors: [{ path, message }] };
  return { ok: false, error: value };
}

function render(input: RenderInput): Result<RenderOutput> {
  if (typeof input !== 'object' || input === null) return error('input', '需要作品和渲染参数');
  const { width, height, view } = input;
  if (!Number.isSafeInteger(width) || width <= 0 || width > 16_384) return error('width', '宽度必须是 1–16384 的整数');
  if (!Number.isSafeInteger(height) || height <= 0 || height > 16_384) return error('height', '高度必须是 1–16384 的整数');
  if (view !== 'folded' && view !== 'unfolded') return error('view', '视图必须是 folded 或 unfolded');
  let work: RenderInput['work'];
  try { work = snapshotValue(input.work); }
  catch { return error('work', '作品数据无法读取'); }
  const geometry = getWorkGeometry(work);
  if (!geometry.ok) return { ok: false, error: { ...geometry.error, requestId } };
  // The Work was schema checked by core: colors are HEX6. No user text enters XML.
  const svg = assembleSvg(geometry.value, work.palette, width, height, view, number);
  return { ok: true, value: { svg, width, height, rendererVersion: 1 } };
}

export function createArtworkRenderer(): ArtworkRenderer {
  return { render };
}
