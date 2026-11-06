import type { RawPointV2 } from '@shoushang/contracts';
import { brushScreenDiameter, paperToScreen, type CanvasSize, type Viewport } from './coordinates';

export interface BrushOverlayProps {
  readonly points: readonly RawPointV2[];
  readonly brushWidth: number;
  readonly size: CanvasSize;
  readonly viewport: Viewport;
}

/** 剪除笔刷实时轨迹：开放路径、圆头圆角，宽度与最终剪除直径一致；单点显示对应直径的圆。 */
export function BrushOverlay({ points, brushWidth, size, viewport }: BrushOverlayProps) {
  if (points.length === 0) return null;
  const screenPoints = points.map(point => paperToScreen(point, viewport, size));
  const diameter = brushScreenDiameter(brushWidth, viewport, size);
  const outline = diameter + 3;
  const single = screenPoints.length === 1;
  const first = screenPoints[0]!;
  return <svg className="m15b-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
    {single
      ? <circle className="m15b-brush-dot-outline" cx={first.x} cy={first.y} r={outline / 2} />
      : <polyline className="m15b-brush-outline" points={screenPoints.map(point => `${point.x},${point.y}`).join(' ')} strokeWidth={outline} />}
    {single
      ? <circle className="m15b-brush-dot" cx={first.x} cy={first.y} r={diameter / 2} />
      : <polyline className="m15b-brush-trail" points={screenPoints.map(point => `${point.x},${point.y}`).join(' ')} strokeWidth={diameter} />}
  </svg>;
}
