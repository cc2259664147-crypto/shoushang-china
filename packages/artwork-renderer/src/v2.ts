import type { ApiError, Result, WorkV2 } from '@shoushang/contracts';
import { getWorkGeometryV2 } from '@shoushang/papercut-core';
import { snapshotValue } from './snapshot';
import { assembleSvg } from './svg';

export interface RenderInputV2 {
  readonly work: WorkV2;
  readonly width: number;
  readonly height: number;
  readonly view: 'folded' | 'unfolded';
}
export interface RenderOutputV2 {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly rendererVersion: 2;
}
export interface ArtworkRendererV2 { render(input: RenderInputV2): Result<RenderOutputV2> }

const REQUEST_ID = 'artwork-renderer-v2';
const MAX_DIMENSION = 16_384;
const MAX_SVG_BYTES = 4 * 1024 * 1024;
const number = (value: number): string => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};
const error = (path: string, message: string, code: ApiError['code'] = 'INVALID_INPUT'): Result<never> =>
  ({ ok: false, error: { code, message, requestId: REQUEST_ID, fieldErrors: [{ path, message }] } });

function render(input: RenderInputV2): Result<RenderOutputV2> {
  if (typeof input !== 'object' || input === null) return error('input', '需要作品和渲染参数');
  const { width, height, view } = input;
  if (!Number.isSafeInteger(width) || width <= 0 || width > MAX_DIMENSION) return error('width', `宽度必须是 1–${MAX_DIMENSION} 的整数`);
  if (!Number.isSafeInteger(height) || height <= 0 || height > MAX_DIMENSION) return error('height', `高度必须是 1–${MAX_DIMENSION} 的整数`);
  if (view !== 'folded' && view !== 'unfolded') return error('view', '视图必须是 folded 或 unfolded');
  let work: WorkV2;
  try { work = snapshotValue(input.work); }
  catch { return error('work', '作品数据无法读取'); }
  const geometry = getWorkGeometryV2(work);
  if (!geometry.ok) return { ok: false, error: { ...geometry.error, requestId: REQUEST_ID } };
  const svg = assembleSvg(geometry.value, work.palette, width, height, view, number);
  // The fixed XML template, validated numbers and HEX colors are all ASCII,
  // so UTF-8 byte length is exactly the JavaScript string length.
  if (svg.length > MAX_SVG_BYTES) return error('work.operations', 'SVG 输出超过 4 MiB 上限', 'PAYLOAD_TOO_LARGE');
  return { ok: true, value: { svg, width, height, rendererVersion: 2 } };
}

export function createArtworkRendererV2(): ArtworkRendererV2 { return { render } }
