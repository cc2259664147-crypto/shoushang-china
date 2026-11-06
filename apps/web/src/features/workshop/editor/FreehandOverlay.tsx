import type { RawPointV2 } from '@shoushang/contracts';
import { paperToScreen, type CanvasSize, type Viewport } from './coordinates';
import type { FreehandPhase } from './freehand';

export interface FreehandOverlayProps {
  readonly points: readonly RawPointV2[];
  readonly size: CanvasSize;
  readonly viewport: Viewport;
  readonly phase: FreehandPhase;
}

export function FreehandOverlay({ points, size, viewport, phase }: FreehandOverlayProps) {
  if (points.length === 0) return null;
  const screenPoints = points.map(point => paperToScreen(point, viewport, size));
  const first = screenPoints[0]!;
  const last = screenPoints[screenPoints.length - 1]!;
  const polyline = screenPoints.map(point => `${point.x},${point.y}`).join(' ');
  return <svg className="m15b-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
    <polyline className="m15b-trail" points={polyline} />
    <circle className="m15b-start" cx={first.x} cy={first.y} r="6" />
    <line className="m15b-closing" x1={last.x} y1={last.y} x2={first.x} y2={first.y} />
    {phase.kind === 'drawing' ? <text className="m15b-overlay-hint" x={last.x + 12} y={last.y - 12}>松开以闭合</text> : null}
  </svg>;
}
