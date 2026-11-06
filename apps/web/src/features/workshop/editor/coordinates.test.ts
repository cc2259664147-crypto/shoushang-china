import { describe, expect, test } from 'vitest';
import { paperToScreen, screenToPaper } from './coordinates';
import type { CanvasSize, PaperPoint, Viewport } from './coordinates';
import { cancelViewportGesture, constrainViewport, fitViewport, MAX_ZOOM, MIN_ZOOM, panBy, zoomAt } from './viewport';

const sizes: CanvasSize[] = [
  { width: 480, height: 480 },
  { width: 800, height: 400 },
  { width: 320, height: 720 },
];
const point: PaperPoint = { x: 0.234567, y: 0.812345 };

describe('paper and CSS screen coordinates', () => {
  test.each(sizes)('round trips in $width x $height', size => {
    const viewport: Viewport = { zoom: 2.75, pan: { x: -37.5, y: 81.25 } };
    const result = screenToPaper(paperToScreen(point, viewport, size), viewport, size);
    expect(result.x).toBeCloseTo(point.x, 12);
    expect(result.y).toBeCloseTo(point.y, 12);
  });

  test('does not clamp points outside the paper', () => {
    expect(screenToPaper({ x: -100, y: 900 }, fitViewport(), { width: 500, height: 500 })).toEqual({ x: -0.2, y: 1.8 });
  });

  test('recomputes origin and base after resize', () => {
    expect(paperToScreen({ x: 0, y: 0 }, fitViewport(), { width: 900, height: 300 })).toEqual({ x: 300, y: 0 });
    expect(paperToScreen({ x: 0, y: 0 }, fitViewport(), { width: 300, height: 900 })).toEqual({ x: 0, y: 300 });
  });

  test('is independent of DPR and remains proportional at 200% CSS scale', () => {
    const logical = paperToScreen(point, fitViewport(), { width: 400, height: 300 });
    const scaled = paperToScreen(point, fitViewport(), { width: 800, height: 600 });
    expect(scaled).toEqual({ x: logical.x * 2, y: logical.y * 2 });
    // There is intentionally no devicePixelRatio input: 1x and 3x devices use the same CSS point.
    const roundTrip = screenToPaper(logical, fitViewport(), { width: 400, height: 300 });
    expect(roundTrip.x).toBeCloseTo(point.x, 12);
    expect(roundTrip.y).toBeCloseTo(point.y, 12);
  });
});

describe('viewport', () => {
  test('fit is identity viewport', () => expect(fitViewport()).toEqual({ zoom: 1, pan: { x: 0, y: 0 } }));

  test.each(sizes)('zoom keeps its paper anchor fixed in $width x $height', size => {
    const before: Viewport = { zoom: 1.3, pan: { x: 22, y: -14 } };
    const anchor = { x: size.width * 0.73, y: size.height * 0.31 };
    const paperBefore = screenToPaper(anchor, before, size);
    const after = zoomAt(before, 4.2, anchor, size);
    expect(screenToPaper(anchor, after, size).x).toBeCloseTo(paperBefore.x, 12);
    expect(screenToPaper(anchor, after, size).y).toBeCloseTo(paperBefore.y, 12);
  });

  test('clamps zoom to 0.5 through 8', () => {
    const size = { width: 500, height: 500 }, anchor = { x: 250, y: 250 };
    expect(zoomAt(fitViewport(), 0.01, anchor, size).zoom).toBe(MIN_ZOOM);
    expect(zoomAt(fitViewport(), 99, anchor, size).zoom).toBe(MAX_ZOOM);
  });

  test.each(sizes)('constrains pan so ten percent remains visible in $width x $height', size => {
    const constrained = constrainViewport({ zoom: 2, pan: { x: 1e6, y: -1e6 } }, size);
    const topLeft = paperToScreen({ x: 0, y: 0 }, constrained, size);
    const bottomRight = paperToScreen({ x: 1, y: 1 }, constrained, size);
    const minimum = Math.min(size.width, size.height) * constrained.zoom * 0.1;
    expect(size.width - topLeft.x).toBeGreaterThanOrEqual(minimum - 1e-9);
    expect(bottomRight.y).toBeGreaterThanOrEqual(minimum - 1e-9);
  });

  test('view operations and cancellation never mutate Work JSON', () => {
    const work = { id: 'work-1', revision: 7, operations: [{ id: 'cut-1', order: 0, center: { x: 0.2, y: 0.3 } }] };
    const before = JSON.stringify(work);
    const size = { width: 640, height: 480 };
    const zoomed = zoomAt(fitViewport(), 2, { x: 200, y: 300 }, size);
    constrainViewport(panBy(zoomed, { x: 80, y: -20 }), size);
    expect(cancelViewportGesture({ kind: 'pan', pointerId: 1, last: { x: 4, y: 5 } })).toEqual({ kind: 'idle' });
    expect(cancelViewportGesture({ kind: 'pinch', pointerIds: [1, 2], startViewport: zoomed, startCenter: { x: 10, y: 20 }, startDistance: 50 })).toEqual({ kind: 'idle' });
    expect(JSON.stringify(work)).toBe(before);
  });
});
