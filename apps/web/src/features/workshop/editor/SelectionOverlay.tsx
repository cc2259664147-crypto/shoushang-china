import { paperToScreen, type CanvasSize, type Viewport } from './coordinates';
import { parametricBoxCorners, type ParametricTransformPreview, type ScaleHandle, type SelectableCut } from './selection';

export interface SelectionOverlayProps {
  readonly cut: SelectableCut | null;
  readonly cuts: readonly SelectableCut[];
  readonly interactive: boolean;
  readonly dx: number;
  readonly dy: number;
  readonly transformPreview: ParametricTransformPreview | null;
  readonly size: CanvasSize;
  readonly viewport: Viewport;
}

const screenPoints = (cut: SelectableCut, size: CanvasSize, viewport: Viewport, dx = 0, dy = 0): string => cut.contour
    .map(point => paperToScreen({ x: point.x + dx, y: point.y + dy }, viewport, size))
    .map(point => `${point.x},${point.y}`)
    .join(' ');

export function SelectionOverlay({ cut, cuts, interactive, dx, dy, transformPreview, size, viewport }: SelectionOverlayProps) {
  if (!cut && !interactive) return null;
  const parametric = cut?.operation.kind === 'parametric' ? cut.operation : null;
  const box = parametric ? parametricBoxCorners(transformPreview ?? {
    center: { x: parametric.center.x + dx, y: parametric.center.y + dy },
    width: parametric.width, height: parametric.height, angleDeg: parametric.angleDeg,
  }) : null;
  const handles = box ? (['nw', 'ne', 'se', 'sw'] as const).map(handle => ({ handle, point: paperToScreen(box[handle], viewport, size) })) : [];
  const center = parametric ? paperToScreen(transformPreview?.center ?? { x: parametric.center.x + dx, y: parametric.center.y + dy }, viewport, size) : null;
  const angle = (transformPreview?.angleDeg ?? parametric?.angleDeg ?? 0) * Math.PI / 180;
  const top = box ? paperToScreen({ x: (box.nw.x + box.ne.x) / 2, y: (box.nw.y + box.ne.y) / 2 }, viewport, size) : null;
  const rotate = top ? { x: top.x + Math.sin(angle) * 34, y: top.y - Math.cos(angle) * 34 } : null;
  const boxPoints = handles.map(item => `${item.point.x},${item.point.y}`).join(' ');
  return <svg className="m15b-selection-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
    {interactive ? [...cuts].sort((first, second) => first.order - second.order).map(candidate =>
      <polygon key={candidate.id} className="m15b-selection-touch-target" points={screenPoints(candidate, size, viewport)} />,
    ) : null}
    {cut ? <polygon className="m15b-selection-outline" points={box ? boxPoints : screenPoints(cut, size, viewport, dx, dy)} /> : null}
    {box && center && rotate && top ? <g className="m16j-transform-handles">
      <line className="m16j-rotate-stem" x1={top.x} y1={top.y} x2={rotate.x} y2={rotate.y} />
      {handles.map(({ handle, point }) => <g key={handle}>
        <circle className="m16j-handle-hit" data-transform-handle={handle satisfies ScaleHandle} cx={point.x} cy={point.y} r="22" />
        <rect className="m16j-scale-handle" x={point.x - 6} y={point.y - 6} width="12" height="12" rx="2" />
      </g>)}
      <circle className="m16j-handle-hit" data-transform-handle="rotate" cx={rotate.x} cy={rotate.y} r="22" />
      <circle className="m16j-rotate-handle" cx={rotate.x} cy={rotate.y} r="7" />
    </g> : null}
  </svg>;
}
