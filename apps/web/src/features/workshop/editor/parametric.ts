import type { ParametricCutV2, WorkV2 } from '@shoushang/contracts';
import type { PaperPoint } from './coordinates';

export type ParametricShape = ParametricCutV2['shape'];

export interface ParametricDrag {
  readonly pointerId: number;
  readonly shape: ParametricShape;
  readonly start: PaperPoint;
  readonly current: PaperPoint;
  readonly lockAspect: boolean;
}

export interface ParametricBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly center: PaperPoint;
}

export const PARAMETRIC_SHAPES: readonly ParametricShape[] = ['circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal'];
export function isParametricShape(value: string): value is ParametricShape {
  return PARAMETRIC_SHAPES.includes(value as ParametricShape);
}
const quantize = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export function allowedParametricShapes(work: WorkV2): ParametricShape[] {
  const templateShapes = new Set(work.templateSnapshot.allowedCuts.map(limit => limit.shape));
  return work.editorProfileSnapshot.allowedTools.parametric.filter(shape => templateShapes.has(shape));
}

export function canBeginParametric(
  tool: string,
  view: 'folded' | 'unfolded',
  phase: { readonly kind: string },
  input: { readonly button: number; readonly buttons: number; readonly pointerType: string; readonly isPrimary: boolean },
  touchCountBefore: number,
  allowed: readonly ParametricShape[],
): tool is ParametricShape {
  if (!isParametricShape(tool) || !allowed.includes(tool)) return false;
  if (view !== 'folded' || phase.kind === 'drawing' || phase.kind === 'validating') return false;
  if (input.button !== 0 || (input.buttons & 1) !== 1) return false;
  if (input.pointerType === 'mouse') return true;
  if (input.pointerType === 'touch') return input.isPrimary && touchCountBefore === 0;
  return input.pointerType === 'pen' && input.isPrimary && (input.buttons & 32) === 0;
}

export function parametricBounds(start: PaperPoint, current: PaperPoint, lockAspect: boolean): ParametricBounds {
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (lockAspect) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  const left = Math.min(start.x, start.x + dx);
  const top = Math.min(start.y, start.y + dy);
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  return { left, top, width, height, center: { x: left + width / 2, y: top + height / 2 } };
}

export function makeParametricOperation(
  work: WorkV2,
  drag: ParametricDrag,
  id: string,
): { readonly ok: true; readonly operation: ParametricCutV2 } | { readonly ok: false; readonly message: string } {
  const limit = work.templateSnapshot.allowedCuts.find(candidate => candidate.shape === drag.shape);
  if (!limit || !allowedParametricShapes(work).includes(drag.shape)) return { ok: false, message: '当前模板不允许此图形' };
  const bounds = parametricBounds(drag.start, drag.current, drag.lockAspect);
  if (bounds.width < limit.minWidth || bounds.height < limit.minHeight) return { ok: false, message: '图形太小，请拖大后再试' };
  return {
    ok: true,
    operation: {
      kind: 'parametric', id, order: work.operations.length, parameterVersion: 2,
      shape: drag.shape,
      center: { x: quantize(bounds.center.x), y: quantize(bounds.center.y) },
      width: quantize(bounds.width), height: quantize(bounds.height), angleDeg: 0,
    },
  };
}
