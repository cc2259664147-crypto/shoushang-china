import { describe, expect, it, vi } from 'vitest';
import { BrushCandidateV2Schema, type PapercutCommandV2, type RawPointV2, type WorkV2 } from '@shoushang/contracts';
import { FREEHAND_GEOMETRY_LIMITS_V2 } from '@shoushang/papercut-core';
import { brushScreenDiameter } from './coordinates';
import {
  BRUSH_WIDTH_DEFAULT,
  BRUSH_WIDTH_STEP,
  brushWidthFromSlider,
  canBeginFreehand,
  defaultBrushCandidateId,
  FreehandStrokeBuffer,
  submitBrushStroke,
  type FreehandPhase,
} from './freehand';
import { EDITOR_TOOLS, toolForShortcut, toolLabel } from './tools';

const idle: FreehandPhase = { kind: 'idle' };
const primary = { pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true };

describe('brush tool definition', () => {
  it('exposes the brush tool with its Chinese name and the B shortcut', () => {
    expect(toolForShortcut('b')).toBe('brush');
    expect(toolForShortcut('B')).toBe('brush');
    expect(toolLabel('brush')).toBe('剪除笔刷');
    expect(EDITOR_TOOLS).toContainEqual({ id: 'brush', label: '剪除笔刷', shortcut: 'B' });
    expect(['v', 'F', 'B', 'h'].map(toolForShortcut)).toEqual(['select', 'freehand', 'brush', 'pan']);
    expect(toolForShortcut('x')).toBeNull();
  });
});

describe('brush input gating', () => {
  it.each([
    ['mouse primary', { ...primary }, true],
    ['mouse right', { ...primary, button: 2, buttons: 2 }, false],
    ['mouse middle', { ...primary, button: 1, buttons: 4 }, false],
    ['pen tip', { ...primary, pointerType: 'pen' }, true],
    ['pen eraser', { ...primary, pointerType: 'pen', button: 5, buttons: 32 }, false],
    ['primary touch', { ...primary, pointerType: 'touch' }, true],
    ['second touch', { ...primary, pointerType: 'touch', isPrimary: false }, false],
  ])('filters %s', (_name, input, expected) => {
    expect(canBeginFreehand('brush', 'folded', idle, input, 0)).toBe(expected);
  });

  it('only starts in the brush tool, folded view, and non-validating state', () => {
    expect(canBeginFreehand('select', 'folded', idle, primary, 0)).toBe(false);
    expect(canBeginFreehand('pan', 'folded', idle, primary, 0)).toBe(false);
    expect(canBeginFreehand('freehand', 'folded', idle, primary, 0)).toBe(true);
    expect(canBeginFreehand('brush', 'unfolded', idle, primary, 0)).toBe(false);
    expect(canBeginFreehand('brush', 'folded', { kind: 'drawing' }, primary, 0)).toBe(false);
    expect(canBeginFreehand('brush', 'folded', { kind: 'validating' }, primary, 0)).toBe(false);
    expect(canBeginFreehand('brush', 'folded', idle, { ...primary, pointerType: 'touch' }, 1)).toBe(false);
  });
});

describe('brush width controls', () => {
  it('keeps default and step inside the contract limits', () => {
    expect(BRUSH_WIDTH_DEFAULT).toBe(0.02);
    expect(BRUSH_WIDTH_STEP).toBe(0.005);
    expect(BRUSH_WIDTH_DEFAULT).toBeGreaterThanOrEqual(FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth);
    expect(BRUSH_WIDTH_DEFAULT).toBeLessThanOrEqual(FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth);
  });

  it('normalizes slider step floats to contract-valid widths', () => {
    const sliderSamples: Array<[number, number]> = [
      [0.005, 0.005],
      [0.02, 0.02],
      [0.030000000000000002, 0.03],
      [0.034999999999999996, 0.035],
      [0.07500000000000001, 0.075],
      [0.12000000000000001, 0.12],
    ];
    for (const [sliderValue, expected] of sliderSamples) {
      const width = brushWidthFromSlider(sliderValue);
      expect(width).toBe(expected);
      const parsed = BrushCandidateV2Schema.safeParse({
        id: 'brush-check', order: 0, rawPoints: [{ x: 0.2, y: 0.3 }], width,
      });
      expect(parsed.success).toBe(true);
    }
    expect(brushWidthFromSlider(0.12000000000000001)).toBe(FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth);
    expect(brushWidthFromSlider(0.005)).toBe(FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth);
  });
});

describe('brush Worker submission', () => {
  it('sends one add-brush-cut with unchanged raw order and width', async () => {
    const points: RawPointV2[] = [{ x: 0.30000009, y: 0.4 }, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2 }];
    const work = { operations: [{ id: 'existing' }] } as WorkV2;
    const next = { operations: [{ id: 'existing' }, { id: 'new' }] } as WorkV2;
    const commands: PapercutCommandV2[] = [];
    const controller = { dispatch(command: PapercutCommandV2) { commands.push(command); return Promise.resolve(next); } };
    await expect(submitBrushStroke(controller, work, 'brush-raw', points, 0.02)).resolves.toBe(next);
    expect(commands).toEqual([{
      type: 'add-brush-cut',
      candidate: { id: 'brush-raw', order: 1, rawPoints: points, width: 0.02 },
    }]);
  });

  it('sends a single point as a one-point brush candidate', async () => {
    const commands: PapercutCommandV2[] = [];
    const work = { operations: [] } as unknown as WorkV2;
    await submitBrushStroke({ dispatch(command: PapercutCommandV2) { commands.push(command); return Promise.resolve(work); } }, work, 'brush-dot', [{ x: 0.25, y: 0.5 }], 0.12);
    expect(commands).toEqual([{ type: 'add-brush-cut', candidate: { id: 'brush-dot', order: 0, rawPoints: [{ x: 0.25, y: 0.5 }], width: 0.12 } }]);
  });

  it('does not change a caller Work before success and preserves it on rejection', async () => {
    const work = { operations: [] } as unknown as WorkV2;
    let resolveDispatch: ((work: WorkV2) => void) | null = null;
    const pending = submitBrushStroke({ dispatch: () => new Promise(resolve => { resolveDispatch = resolve; }) }, work, 'brush-pending', [{ x: 0, y: 0 }], 0.02);
    expect(work.operations).toHaveLength(0);
    resolveDispatch!({ ...work, operations: [{ id: 'confirmed' }] } as WorkV2);
    expect((await pending).operations).toHaveLength(1);

    const rejected = submitBrushStroke({ dispatch: () => Promise.reject(new Error('笔刷扫掠区域超出允许区域')) }, work, 'brush-rejected', [{ x: 0, y: 0 }], 0.02);
    await expect(rejected).rejects.toThrow('笔刷扫掠区域超出允许区域');
    expect(work.operations).toHaveLength(0);
  });

  it('generates brush candidate ids with the brush- prefix and unified uuid', () => {
    const first = defaultBrushCandidateId(), second = defaultBrushCandidateId();
    expect(first).toMatch(/^brush-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(second.startsWith('brush-')).toBe(true);
  });

  it('cancels at point 4097 with no truncation or dispatchable brush candidate', () => {
    const dispatch = vi.fn();
    const buffer = new FreehandStrokeBuffer();
    buffer.begin({ x: 0, y: 0 });
    expect(buffer.append(Array.from({ length: FREEHAND_GEOMETRY_LIMITS_V2.rawMaxPoints - 1 }, (_value, index) => ({ x: index / 10_000, y: 0.1 })))).toEqual({ ok: true });
    expect(buffer.length).toBe(4096);
    expect(buffer.append([{ x: 0.2, y: 0.2 }])).toEqual({ ok: false, message: '轨迹过长，请分成多个切口' });
    expect(buffer.isActive).toBe(false);
    expect(buffer.freeze()).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('brush live preview width', () => {
  it('maps paper width to screen diameter with brushWidth × paper size × zoom', () => {
    const size = { width: 640, height: 480 };
    expect(brushScreenDiameter(0.02, { zoom: 1, pan: { x: 0, y: 0 } }, size)).toBeCloseTo(0.02 * 480, 10);
    expect(brushScreenDiameter(0.02, { zoom: 2.5, pan: { x: -30, y: 12 } }, size)).toBeCloseTo(0.02 * 480 * 2.5, 10);
  });

  it('scales proportionally when zoom changes', () => {
    const size = { width: 390, height: 700 };
    const base = brushScreenDiameter(BRUSH_WIDTH_DEFAULT, { zoom: 1, pan: { x: 0, y: 0 } }, size);
    const zoomed = brushScreenDiameter(BRUSH_WIDTH_DEFAULT, { zoom: 1.8, pan: { x: 5, y: -5 } }, size);
    expect(zoomed / base).toBeCloseTo(1.8, 10);
  });
});
