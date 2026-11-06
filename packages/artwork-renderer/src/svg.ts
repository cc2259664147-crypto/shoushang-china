import type { AffineTransform, LocalShape, LocalShapeV2, Point, WorkGeometry, WorkGeometryV2 } from '@shoushang/papercut-core';

export type Geometry = Pick<WorkGeometry, 'cuts' | 'symmetryTransforms' | 'baseDomain'>
  | Pick<WorkGeometryV2, 'cuts' | 'symmetryTransforms' | 'baseDomain'>;
export type NumberFormatter = (value: number) => string;

const point = (value: Point, format: NumberFormatter): string => `${format(value.x)} ${format(value.y)}`;
const matrix = (value: AffineTransform, format: NumberFormatter): string =>
  `matrix(${format(value.a)} ${format(value.b)} ${format(value.c)} ${format(value.d)} ${format(value.e)} ${format(value.f)})`;

function shape(value: LocalShape | LocalShapeV2, format: NumberFormatter): string {
  if (value.kind === 'ellipse') return `<ellipse cx="0" cy="0" rx="${format(value.radiusX)}" ry="${format(value.radiusY)}"/>`;
  if (value.kind === 'polygon' || value.kind === 'paper-loop') {
    return `<path d="M ${value.vertices.map(vertex => point(vertex, format)).join(' L ')} Z"/>`;
  }
  if (value.kind === 'paper-stroke') {
    if (value.centerline.length === 1) {
      const center = value.centerline[0]!;
      return `<circle cx="${format(center.x)}" cy="${format(center.y)}" r="${format(value.width / 2)}" fill="black"/>`;
    }
    return `<path d="M ${value.centerline.map(vertex => point(vertex, format)).join(' L ')}" fill="none" stroke="black" stroke-width="${format(value.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const first = value.curves[0];
  if (!first) throw new Error('Missing cubic curve');
  const segments = value.curves.map(curve => `C ${point(curve[1], format)} ${point(curve[2], format)} ${point(curve[3], format)}`).join(' ');
  return `<path d="M ${point(first[0], format)} ${segments} Z"/>`;
}

export function assembleSvg(
  geometry: Geometry,
  palette: { paper: string; background: string },
  width: number,
  height: number,
  view: 'folded' | 'unfolded',
  format: NumberFormatter,
): string {
  const domain = view === 'folded'
    ? `<path d="M ${geometry.baseDomain.map(value => point(value, format)).join(' L ')} Z" fill="white"/>`
    : '<rect x="0" y="0" width="1" height="1" fill="white"/>';
  const transforms = view === 'folded' ? geometry.symmetryTransforms.slice(0, 1) : geometry.symmetryTransforms;
  const holes = geometry.cuts.map(cut => transforms.map(symmetry =>
    `<g transform="${matrix(symmetry, format)}"><g transform="${matrix(cut.placement, format)}" fill="black">${shape(cut.localShape, format)}</g></g>`
  ).join('')).join('');
  const scale = Math.min(width, height);
  const offsetX = (width - scale) / 2;
  const offsetY = (height - scale) / 2;
  const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><mask id="ss-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" style="mask-type:luminance">${domain}${holes}</mask></defs><rect width="${width}" height="${height}" fill="${palette.background}"/><g transform="translate(${format(offsetX)} ${format(offsetY)}) scale(${format(scale)})"><rect x="0" y="0" width="1" height="1" fill="${palette.paper}" mask="url(#ss-mask)"/></g></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image x="0" y="0" width="${width}" height="${height}" href="data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing)}"/></svg>`;
}
