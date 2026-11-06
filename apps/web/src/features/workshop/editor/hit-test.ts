import { canvasMetrics } from './coordinates';
import type { CanvasSize, PaperPoint, Viewport } from './coordinates';

export type HitPointerType = 'mouse' | 'touch' | 'pen';

export interface HitCandidate<T> {
  id: string;
  order: number;
  value: T;
}

export interface HitResult<T> extends HitCandidate<T> {
  distanceInPaper: number;
}

export function hitToleranceInPaper(pointerType: HitPointerType, viewport: Viewport, size: CanvasSize): number {
  const cssPixels = pointerType === 'mouse' ? 6 : 12;
  return cssPixels / (viewport.zoom * canvasMetrics(size).base);
}

/** Returns all hits in deterministic visual stacking order (topmost first). */
export function hitTestCandidates<T>(
  candidates: readonly HitCandidate<T>[],
  point: PaperPoint,
  pointerType: HitPointerType,
  viewport: Viewport,
  size: CanvasSize,
  distance: (candidate: T, point: PaperPoint) => number,
): HitResult<T>[] {
  const tolerance = hitToleranceInPaper(pointerType, viewport, size);
  return candidates
    .map(candidate => ({ ...candidate, distanceInPaper: distance(candidate.value, point) }))
    .filter(candidate => Number.isFinite(candidate.distanceInPaper) && candidate.distanceInPaper <= tolerance)
    .sort((a, b) => b.order - a.order || a.distanceInPaper - b.distanceInPaper || compareOrdinal(a.id, b.id));
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
