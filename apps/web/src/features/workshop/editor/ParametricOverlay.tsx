import { paperToScreen, type CanvasSize, type Viewport } from './coordinates';
import { parametricBounds, type ParametricDrag } from './parametric';

export interface ParametricOverlayProps {
  readonly drag: ParametricDrag | null;
  readonly size: CanvasSize;
  readonly viewport: Viewport;
}

export function ParametricOverlay({ drag, size, viewport }: ParametricOverlayProps) {
  if (!drag) return null;
  const bounds = parametricBounds(drag.start, drag.current, drag.lockAspect);
  const topLeft = paperToScreen({ x: bounds.left, y: bounds.top }, viewport, size);
  const bottomRight = paperToScreen({ x: bounds.left + bounds.width, y: bounds.top + bounds.height }, viewport, size);
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;
  const cx = topLeft.x + width / 2;
  const cy = topLeft.y + height / 2;
  const starPoints = Array.from({ length: 10 }, (_value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 1 : (3 - Math.sqrt(5)) / 2;
    return `${cx + width / 2 * radius * Math.cos(angle)},${cy + height / 2 * radius * Math.sin(angle)}`;
  }).join(' ');
  const shape = drag.shape === 'circle' || drag.shape === 'ellipse'
    ? <ellipse cx={cx} cy={cy} rx={width / 2} ry={height / 2} />
    : drag.shape === 'triangle'
      ? <path d={`M ${cx} ${topLeft.y} L ${topLeft.x} ${bottomRight.y} L ${bottomRight.x} ${bottomRight.y} Z`} />
      : drag.shape === 'rectangle'
        ? <path d={`M ${topLeft.x} ${topLeft.y} L ${bottomRight.x} ${topLeft.y} L ${bottomRight.x} ${bottomRight.y} L ${topLeft.x} ${bottomRight.y} Z`} />
        : drag.shape === 'star'
          ? <polygon points={starPoints} />
          : drag.shape === 'petal'
            ? <path d={`M ${cx} ${topLeft.y} C ${topLeft.x} ${cy - height / 6} ${topLeft.x} ${cy + height / 6} ${cx} ${bottomRight.y} C ${bottomRight.x} ${cy + height / 6} ${bottomRight.x} ${cy - height / 6} ${cx} ${topLeft.y} Z`} />
            : <path d={`M ${cx} ${topLeft.y} C ${cx - 2 * width / 3} ${cy} ${cx - 2 * width / 3} ${bottomRight.y} ${cx} ${bottomRight.y} C ${cx + 2 * width / 3} ${bottomRight.y} ${cx + 2 * width / 3} ${cy} ${cx} ${topLeft.y} Z`} />;
  return <svg className="m15b-overlay m16f-parametric-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
    <g className="m16f-parametric-preview">{shape}</g>
  </svg>;
}
