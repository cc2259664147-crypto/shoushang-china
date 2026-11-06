import type { BrushCandidateV2, FreehandCandidateV2, RawPointV2, WorkV2 } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import { FREEHAND_GEOMETRY_LIMITS_V2 } from '@shoushang/papercut-core';
import type { EditorWorkerController } from './worker/controller';
import type { EditorTool } from './tools';

export const FREEHAND_TOO_LONG_MESSAGE = '轨迹过长，请分成多个切口';

export type FreehandPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'drawing' }
  | { readonly kind: 'validating'; readonly message?: string }
  | { readonly kind: 'error'; readonly message: string };

export interface PointerStartInput {
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly isPrimary: boolean;
}

export interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
}

export interface CoalescedPointerInput extends PointerSample {
  getCoalescedEvents?: () => readonly PointerSample[];
}

/** 自由剪刀与剪除笔刷共用同一套落笔条件；两者都只在折叠视图且非绘制/校验状态起笔。 */
export function canBeginFreehand(
  tool: EditorTool,
  view: 'folded' | 'unfolded',
  phase: FreehandPhase,
  input: PointerStartInput,
  activeTouches: number,
): boolean {
  if ((tool !== 'freehand' && tool !== 'brush') || view !== 'folded' || phase.kind === 'drawing' || phase.kind === 'validating') return false;
  if (input.button !== 0 || (input.buttons & 1) !== 1) return false;
  if (input.pointerType === 'mouse') return true;
  if (input.pointerType === 'pen') return input.isPrimary && (input.buttons & 32) === 0;
  return input.pointerType === 'touch' && input.isPrimary && activeTouches === 0;
}

/** Uses the browser-provided order verbatim; no dedupe, sorting or geometry work occurs here. */
export function orderedPointerSamples(input: CoalescedPointerInput): readonly PointerSample[] {
  const coalesced = input.getCoalescedEvents?.() ?? [];
  return coalesced.length > 0 ? coalesced : [{ clientX: input.clientX, clientY: input.clientY }];
}

export class FreehandStrokeBuffer {
  private points: RawPointV2[] = [];
  private active = false;

  begin(first: RawPointV2): void {
    this.points = [{ x: first.x, y: first.y }];
    this.active = true;
  }

  append(samples: readonly RawPointV2[]): { readonly ok: true } | { readonly ok: false; readonly message: string } {
    if (!this.active) return { ok: false, message: '当前没有正在绘制的轨迹' };
    if (this.points.length + samples.length > FREEHAND_GEOMETRY_LIMITS_V2.rawMaxPoints) {
      this.cancel();
      return { ok: false, message: FREEHAND_TOO_LONG_MESSAGE };
    }
    for (const point of samples) this.points.push({ x: point.x, y: point.y });
    return { ok: true };
  }

  snapshot(): RawPointV2[] {
    return this.points.map(point => ({ x: point.x, y: point.y }));
  }

  freeze(): RawPointV2[] {
    const frozen = this.snapshot();
    this.points = [];
    this.active = false;
    return frozen;
  }

  cancel(): void {
    this.points = [];
    this.active = false;
  }

  get length(): number { return this.points.length; }
  get isActive(): boolean { return this.active; }
}

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export class VisibleTrailScheduler {
  private frame: number | null = null;

  constructor(
    private readonly requestFrame: RequestFrame,
    private readonly cancelFrame: CancelFrame,
    private readonly publish: (points: readonly RawPointV2[]) => void,
  ) {}

  schedule(read: () => readonly RawPointV2[]): void {
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

  get pending(): boolean { return this.frame !== null; }
}

export interface FreehandDispatcher {
  dispatch: EditorWorkerController['dispatch'];
}

export function submitFreehandStroke(
  controller: FreehandDispatcher,
  work: WorkV2,
  id: string,
  rawPoints: readonly RawPointV2[],
): Promise<WorkV2> {
  const candidate: FreehandCandidateV2 = {
    id,
    order: work.operations.length,
    rawPoints: rawPoints.map(point => ({ x: point.x, y: point.y })),
  };
  return controller.dispatch({ type: 'add-freehand-cut', candidate });
}

export const BRUSH_WIDTH_DEFAULT = 0.02;
export const BRUSH_WIDTH_STEP = 0.005;

/** 剪除笔刷候选 ID 统一由 generateUuid 生成并加 brush- 前缀。 */
export function defaultBrushCandidateId(): string {
  return `brush-${generateUuid()}`;
}

/** 滑块步进浮点值取三位小数，得到与契约六位小数宽度规则一致的规范值。 */
export function brushWidthFromSlider(value: number): number {
  return Number(value.toFixed(3));
}

export function submitBrushStroke(
  controller: FreehandDispatcher,
  work: WorkV2,
  id: string,
  rawPoints: readonly RawPointV2[],
  width: number,
): Promise<WorkV2> {
  const candidate: BrushCandidateV2 = {
    id,
    order: work.operations.length,
    rawPoints: rawPoints.map(point => ({ x: point.x, y: point.y })),
    width,
  };
  return controller.dispatch({ type: 'add-brush-cut', candidate });
}
