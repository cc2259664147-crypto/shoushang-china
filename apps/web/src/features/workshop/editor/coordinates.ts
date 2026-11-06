export interface CanvasSize {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PaperPoint {
  x: number;
  y: number;
}

export interface Viewport {
  zoom: number;
  /** Pan is measured in CSS pixels. */
  pan: ScreenPoint;
}

export function canvasMetrics(size: CanvasSize): { base: number; origin: ScreenPoint } {
  const base = Math.min(size.width, size.height);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    throw new RangeError('Canvas dimensions must be positive finite CSS pixel values.');
  }
  return { base, origin: { x: (size.width - base) / 2, y: (size.height - base) / 2 } };
}

export function paperToScreen(point: PaperPoint, viewport: Viewport, size: CanvasSize): ScreenPoint {
  const { base, origin } = canvasMetrics(size);
  return {
    x: origin.x + viewport.pan.x + viewport.zoom * base * point.x,
    y: origin.y + viewport.pan.y + viewport.zoom * base * point.y,
  };
}

/** The returned point is deliberately not clamped to the paper bounds. */
export function screenToPaper(point: ScreenPoint, viewport: Viewport, size: CanvasSize): PaperPoint {
  const { base, origin } = canvasMetrics(size);
  const scale = viewport.zoom * base;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Viewport zoom must be positive and finite.');
  return {
    x: (point.x - origin.x - viewport.pan.x) / scale,
    y: (point.y - origin.y - viewport.pan.y) / scale,
  };
}

/** 笔刷纸面宽度到屏幕像素直径：brushWidth × 纸张显示尺寸 × zoom。 */
export function brushScreenDiameter(brushWidth: number, viewport: Viewport, size: CanvasSize): number {
  return brushWidth * viewport.zoom * canvasMetrics(size).base;
}
