import { canvasMetrics, screenToPaper } from './coordinates';
import type { CanvasSize, ScreenPoint, Viewport } from './coordinates';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
export const MIN_VISIBLE_PAPER_FRACTION = 0.1;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function fitViewport(): Viewport {
  return { zoom: 1, pan: { x: 0, y: 0 } };
}

export function zoomAt(viewport: Viewport, requestedZoom: number, anchor: ScreenPoint, size: CanvasSize): Viewport {
  const zoom = clamp(requestedZoom, MIN_ZOOM, MAX_ZOOM);
  const paperAnchor = screenToPaper(anchor, viewport, size);
  const { base, origin } = canvasMetrics(size);
  return {
    zoom,
    pan: {
      x: anchor.x - origin.x - zoom * base * paperAnchor.x,
      y: anchor.y - origin.y - zoom * base * paperAnchor.y,
    },
  };
}

export function panBy(viewport: Viewport, delta: ScreenPoint): Viewport {
  return { zoom: viewport.zoom, pan: { x: viewport.pan.x + delta.x, y: viewport.pan.y + delta.y } };
}

export function constrainViewport(viewport: Viewport, size: CanvasSize): Viewport {
  const { base, origin } = canvasMetrics(size);
  const zoom = clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM);
  const paperSize = zoom * base;
  const minimumVisible = paperSize * MIN_VISIBLE_PAPER_FRACTION;
  const minX = minimumVisible - origin.x - paperSize;
  const maxX = size.width - origin.x - minimumVisible;
  const minY = minimumVisible - origin.y - paperSize;
  const maxY = size.height - origin.y - minimumVisible;
  return {
    zoom,
    pan: {
      x: clamp(viewport.pan.x, minX, maxX),
      y: clamp(viewport.pan.y, minY, maxY),
    },
  };
}

export type ViewportGesture =
  | { kind: 'idle' }
  | { kind: 'pan'; pointerId: number; last: ScreenPoint }
  | { kind: 'pinch'; pointerIds: readonly [number, number]; startViewport: Viewport; startCenter: ScreenPoint; startDistance: number };

export const idleViewportGesture = (): ViewportGesture => ({ kind: 'idle' });

/** Escape, pointercancel, lost capture and window blur all use this transition. */
export function cancelViewportGesture(_gesture: ViewportGesture): ViewportGesture {
  return idleViewportGesture();
}
