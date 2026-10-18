import type { ApiError, ArtworkRenderer, RenderInput, RenderOutput, Result } from '@shoushang/contracts';
import { getWorkGeometry } from '@shoushang/papercut-core';
import type { AffineTransform, LocalShape, Point } from '@shoushang/papercut-core';

export type { RenderInput, RenderOutput, ArtworkRenderer } from '@shoushang/contracts';

const requestId = 'artwork-renderer-v1';
const number = (value: number): string => Object.is(value, -0) ? '0' : String(value);
const point = (p: Point): string => `${number(p.x)} ${number(p.y)}`;
const matrix = (m: AffineTransform): string =>
  `matrix(${number(m.a)} ${number(m.b)} ${number(m.c)} ${number(m.d)} ${number(m.e)} ${number(m.f)})`;

function shape(shape: LocalShape): string {
  if (shape.kind === 'ellipse') return `<ellipse cx="0" cy="0" rx="${number(shape.radiusX)}" ry="${number(shape.radiusY)}"/>`;
  if (shape.kind === 'polygon') return `<path d="M ${shape.vertices.map(point).join(' L ')} Z"/>`;
  const first = shape.curves[0];
  if (!first) throw new Error('Missing cubic curve');
  const segments = shape.curves.map(curve => `C ${point(curve[1])} ${point(curve[2])} ${point(curve[3])}`).join(' ');
  return `<path d="M ${point(first[0])} ${segments} Z"/>`;
}

function error(path: string, message: string): Result<never> {
  const value: ApiError = { code: 'INVALID_INPUT', message, requestId, fieldErrors: [{ path, message }] };
  return { ok: false, error: value };
}

function render(input: RenderInput): Result<RenderOutput> {
  if (typeof input !== 'object' || input === null) return error('input', '需要作品和渲染参数');
  const { work, width, height, view } = input;
  if (!Number.isSafeInteger(width) || width <= 0) return error('width', '宽度必须是正整数');
  if (!Number.isSafeInteger(height) || height <= 0) return error('height', '高度必须是正整数');
  if (view !== 'folded' && view !== 'unfolded') return error('view', '视图必须是 folded 或 unfolded');

  const geometry = getWorkGeometry(work);
  if (!geometry.ok) return { ok: false, error: { ...geometry.error, requestId } };
  // The Work was schema checked by core: colors are HEX6. No user text enters XML.
  const paper = work.palette.paper;
  const background = work.palette.background;
  const g = geometry.value;
  const domain = view === 'folded'
    ? `<path d="M ${g.baseDomain.map(point).join(' L ')} Z" fill="white"/>`
    : '<rect x="0" y="0" width="1" height="1" fill="white"/>';
  const transforms = view === 'folded' ? g.symmetryTransforms.slice(0, 1) : g.symmetryTransforms;
  const holes = g.cuts.map(cut => transforms.map(symmetry =>
    `<g transform="${matrix(symmetry)}"><g transform="${matrix(cut.placement)}" fill="black">${shape(cut.localShape)}</g></g>`
  ).join('')).join('');
  // Black cuts over the white domain implement the union of holes.
  const maskBody = `${domain}${holes}`;
  const scale = Math.min(width, height);
  const offsetX = (width - scale) / 2;
  const offsetY = (height - scale) / 2;
  // The mask lives in an embedded SVG image document. Each inline instance gets
  // its own resource scope, even when another identical instance is hidden.
  const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><mask id="ss-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" style="mask-type:luminance">${maskBody}</mask></defs><rect width="${width}" height="${height}" fill="${background}"/><g transform="translate(${number(offsetX)} ${number(offsetY)}) scale(${number(scale)})"><rect x="0" y="0" width="1" height="1" fill="${paper}" mask="url(#ss-mask)"/></g></svg>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image x="0" y="0" width="${width}" height="${height}" href="data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing)}"/></svg>`;
  return { ok: true, value: { svg, width, height, rendererVersion: 1 } };
}

export function createArtworkRenderer(): ArtworkRenderer {
  return { render };
}
