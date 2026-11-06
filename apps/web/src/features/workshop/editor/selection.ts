import type { CutOperationV2, ParametricCutV2, WorkV2 } from '@shoushang/contracts';
import { getWorkGeometryV2, type Point } from '@shoushang/papercut-core';
import type { CanvasSize, PaperPoint, Viewport } from './coordinates';
import { hitTestCandidates } from './hit-test';

export interface SelectableCut {
  readonly id: string;
  readonly order: number;
  readonly contour: readonly Point[];
  readonly operation: CutOperationV2;
}

export interface CutDrag {
  readonly pointerId: number;
  readonly operationId: string;
  readonly start: PaperPoint;
  readonly current: PaperPoint;
}

export type ScaleHandle = 'nw' | 'ne' | 'se' | 'sw';
export interface ParametricTransformPreview {
  readonly center: PaperPoint;
  readonly width: number;
  readonly height: number;
  readonly angleDeg: number;
}
export type ParametricTransformDrag =
  | {
    readonly kind: 'scale'; readonly pointerId: number; readonly operationId: string;
    readonly original: ParametricCutV2; readonly handle: ScaleHandle;
    readonly current: PaperPoint; readonly snap: boolean;
  }
  | {
    readonly kind: 'rotate'; readonly pointerId: number; readonly operationId: string;
    readonly original: ParametricCutV2; readonly startPointerAngleDeg: number;
    readonly current: PaperPoint; readonly snap: boolean;
  };

const handleSigns: Readonly<Record<ScaleHandle, readonly [number, number]>> = {
  nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1],
};
const degrees = (radians: number): number => radians * 180 / Math.PI;
export const normalizeAngleDeg = (angleDeg: number): number => ((angleDeg % 360) + 360) % 360;

export function beginParametricTransform(
  operation: ParametricCutV2,
  handle: ScaleHandle | 'rotate',
  pointerId: number,
  current: PaperPoint,
  snap: boolean,
): ParametricTransformDrag {
  return handle === 'rotate'
    ? { kind: 'rotate', pointerId, operationId: operation.id, original: operation, current, snap, startPointerAngleDeg: degrees(Math.atan2(current.y - operation.center.y, current.x - operation.center.x)) }
    : { kind: 'scale', pointerId, operationId: operation.id, original: operation, handle, current, snap };
}

export function parametricTransformPreview(drag: ParametricTransformDrag): ParametricTransformPreview {
  const original = drag.original;
  if (drag.kind === 'rotate') {
    const currentAngle = degrees(Math.atan2(drag.current.y - original.center.y, drag.current.x - original.center.x));
    const raw = original.angleDeg + currentAngle - drag.startPointerAngleDeg;
    return { center: { ...original.center }, width: original.width, height: original.height, angleDeg: normalizeAngleDeg(drag.snap ? Math.round(raw / 15) * 15 : raw) };
  }
  const [signX, signY] = handleSigns[drag.handle];
  const angle = original.angleDeg * Math.PI / 180;
  const axisX = { x: Math.cos(angle), y: Math.sin(angle) };
  const axisY = { x: -Math.sin(angle), y: Math.cos(angle) };
  const anchor = {
    x: original.center.x - signX * original.width / 2 * axisX.x - signY * original.height / 2 * axisY.x,
    y: original.center.y - signX * original.width / 2 * axisX.y - signY * original.height / 2 * axisY.y,
  };
  const delta = { x: drag.current.x - anchor.x, y: drag.current.y - anchor.y };
  let width = Math.max(0, signX * (delta.x * axisX.x + delta.y * axisX.y));
  let height = Math.max(0, signY * (delta.x * axisY.x + delta.y * axisY.y));
  if (drag.snap) {
    const scale = Math.max(width / original.width, height / original.height);
    width = original.width * scale;
    height = original.height * scale;
  }
  return {
    center: {
      x: anchor.x + signX * width / 2 * axisX.x + signY * height / 2 * axisY.x,
      y: anchor.y + signX * width / 2 * axisX.y + signY * height / 2 * axisY.y,
    },
    width, height, angleDeg: original.angleDeg,
  };
}

export function parametricBoxCorners(value: ParametricTransformPreview): Readonly<Record<ScaleHandle, PaperPoint>> {
  const angle = value.angleDeg * Math.PI / 180;
  const axisX = { x: Math.cos(angle), y: Math.sin(angle) };
  const axisY = { x: -Math.sin(angle), y: Math.cos(angle) };
  return Object.fromEntries(Object.entries(handleSigns).map(([handle, [signX, signY]]) => [handle, {
    x: value.center.x + signX * value.width / 2 * axisX.x + signY * value.height / 2 * axisY.x,
    y: value.center.y + signX * value.width / 2 * axisX.y + signY * value.height / 2 * axisY.y,
  }])) as unknown as Readonly<Record<ScaleHandle, PaperPoint>>;
}

const squaredDistance = (first: PaperPoint, second: PaperPoint): number =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2;

function segmentDistance(point: PaperPoint, start: PaperPoint, end: PaperPoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.sqrt(squaredDistance(point, start));
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.sqrt(squaredDistance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy }));
}

function pointInsideContour(contour: readonly Point[], point: PaperPoint): boolean {
  let inside = false;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const first = contour[index]!, second = contour[previous]!;
    const crosses = (first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function distanceToCutContour(contour: readonly Point[], point: PaperPoint): number {
  if (contour.length < 2) return Number.POSITIVE_INFINITY;
  if (pointInsideContour(contour, point)) return 0;
  return contour.reduce((minimum, start, index) => {
    const end = contour[(index + 1) % contour.length]!;
    return Math.min(minimum, segmentDistance(point, start, end));
  }, Number.POSITIVE_INFINITY);
}

export function selectableCuts(work: WorkV2): SelectableCut[] {
  const geometry = getWorkGeometryV2(work);
  if (!geometry.ok) return [];
  const operationById = new Map(work.operations.map(operation => [operation.id, operation]));
  return geometry.value.cuts.map(cut => ({
    id: cut.operationId,
    order: operationById.get(cut.operationId)?.order ?? -1,
    contour: cut.conservativeContour.map(point => ({ ...point })),
    operation: operationById.get(cut.operationId)!,
  })).filter(cut => cut.operation !== undefined);
}

export function topmostCutAt(
  work: WorkV2,
  point: PaperPoint,
  pointerType: 'mouse' | 'touch' | 'pen',
  viewport: Viewport,
  size: CanvasSize,
): SelectableCut | null {
  return hitTestCandidates(
    selectableCuts(work).map(cut => ({ id: cut.id, order: cut.order, value: cut })),
    point,
    pointerType,
    viewport,
    size,
    (cut, target) => distanceToCutContour(cut.contour, target),
  )[0]?.value ?? null;
}

export function dragTranslation(drag: CutDrag): { readonly dx: number; readonly dy: number } {
  return { dx: drag.current.x - drag.start.x, dy: drag.current.y - drag.start.y };
}

export function translatedContour(contour: readonly Point[], dx: number, dy: number): Point[] {
  return contour.map(point => ({ x: point.x + dx, y: point.y + dy }));
}

export function selectedCut(work: WorkV2, operationId: string | null): SelectableCut | null {
  return operationId ? selectableCuts(work).find(cut => cut.id === operationId) ?? null : null;
}

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export class DragPreviewScheduler {
  private frame: number | null = null;

  constructor(
    private readonly requestFrame: RequestFrame,
    private readonly cancelFrame: CancelFrame,
    private readonly publish: (drag: CutDrag) => void,
  ) {}

  schedule(read: () => CutDrag): void {
    if (this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      this.publish(read());
    });
  }

  cancel(): void {
    if (this.frame === null) return;
    this.cancelFrame(this.frame);
    this.frame = null;
  }
}
