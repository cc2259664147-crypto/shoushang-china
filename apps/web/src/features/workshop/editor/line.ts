import type { RawPointV2, WorkV2 } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import { paperToScreen, type CanvasSize, type PaperPoint, type Viewport } from './coordinates';
import { submitBrushStroke, type FreehandDispatcher, type FreehandPhase, type PointerStartInput } from './freehand';
import type { EditorTool } from './tools';

/** 过短拖动阈值取 CSS 像素：判定的是手势而非纸面几何，缩放后点击抖动同样被拦下。 */
export const LINE_MIN_DRAG_PX = 4;
export const LINE_TOO_SHORT_MESSAGE = '直线太短，请拖动更长距离';

export interface LineDrag {
  readonly pointerId: number;
  readonly start: PaperPoint;
  readonly current: PaperPoint;
  readonly snap: boolean;
}

/** 直线落笔条件与剪除笔刷一致，另加“配置允许自由路径”；只在折叠视图起笔。 */
export function canBeginLine(
  tool: EditorTool,
  view: 'folded' | 'unfolded',
  phase: FreehandPhase,
  input: PointerStartInput,
  activeTouches: number,
  freehandEnabled: boolean,
): boolean {
  if (tool !== 'line' || view !== 'folded' || !freehandEnabled) return false;
  if (phase.kind === 'drawing' || phase.kind === 'validating') return false;
  if (input.button !== 0 || (input.buttons & 1) !== 1) return false;
  if (input.pointerType === 'mouse') return true;
  if (input.pointerType === 'pen') return input.isPrimary && (input.buttons & 32) === 0;
  return input.pointerType === 'touch' && input.isPrimary && activeTouches === 0;
}

/**
 * Shift 吸附到水平、垂直、±45° 四类方向，保持拖动距离不变。
 * 轴向分量返回精确的水平/垂直端点，对角分量两端增量取同一浮点值。
 */
export function snapLineEnd(start: PaperPoint, current: PaperPoint): PaperPoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: start.x, y: start.y };
  const octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const axis = distance;
  const diagonal = distance * Math.SQRT1_2;
  switch (octant) {
    case 0: return { x: start.x + axis, y: start.y };
    case 1: return { x: start.x + diagonal, y: start.y + diagonal };
    case 2: return { x: start.x, y: start.y + axis };
    case 3: return { x: start.x - diagonal, y: start.y + diagonal };
    case 4: return { x: start.x - axis, y: start.y };
    case 5: return { x: start.x - diagonal, y: start.y - diagonal };
    case 6: return { x: start.x, y: start.y - axis };
    default: return { x: start.x + diagonal, y: start.y - diagonal };
  }
}

/** 预览和提交共用的终点：按住 Shift 时吸附，否则用原始终点。 */
export function lineDragEnd(drag: Pick<LineDrag, 'start' | 'current' | 'snap'>): PaperPoint {
  return drag.snap ? snapLineEnd(drag.start, drag.current) : drag.current;
}

export function lineScreenDistance(start: PaperPoint, end: PaperPoint, viewport: Viewport, size: CanvasSize): number {
  const from = paperToScreen(start, viewport, size);
  const to = paperToScreen(end, viewport, size);
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function isLineLongEnough(screenDistance: number): boolean {
  return screenDistance >= LINE_MIN_DRAG_PX;
}

/** 直线候选 ID 统一由 generateUuid 生成并加 line- 前缀，便于与笔刷来源区分。 */
export function defaultLineCandidateId(): string {
  return `line-${generateUuid()}`;
}

/** 直线提交为只有起点和终点的 brush 候选，经现有 Worker 笔刷管线校验。 */
export function submitLineStroke(
  controller: FreehandDispatcher,
  work: WorkV2,
  id: string,
  start: RawPointV2,
  end: RawPointV2,
  width: number,
): Promise<WorkV2> {
  return submitBrushStroke(controller, work, id, [{ x: start.x, y: start.y }, { x: end.x, y: end.y }], width);
}
