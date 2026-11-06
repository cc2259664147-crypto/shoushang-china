import { describe, expect, it } from 'vitest';
import { BrushCandidateV2Schema, type PapercutCommandV2, type WorkV2 } from '@shoushang/contracts';
import { FREEHAND_GEOMETRY_LIMITS_V2 } from '@shoushang/papercut-core';
import {
  BRUSH_WIDTH_DEFAULT,
  BRUSH_WIDTH_STEP,
  brushWidthFromSlider,
  type FreehandPhase,
} from './freehand';
import {
  canBeginLine,
  defaultLineCandidateId,
  isLineLongEnough,
  LINE_MIN_DRAG_PX,
  LINE_TOO_SHORT_MESSAGE,
  lineDragEnd,
  lineScreenDistance,
  snapLineEnd,
  submitLineStroke,
} from './line';
import { EDITOR_TOOLS, toolForShortcut, toolLabel } from './tools';

const idle: FreehandPhase = { kind: 'idle' };
const primary = { pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true };

describe('line tool definition', () => {
  it('exposes the line tool with its Chinese name and the L shortcut', () => {
    expect(toolForShortcut('l')).toBe('line');
    expect(toolForShortcut('L')).toBe('line');
    expect(toolLabel('line')).toBe('直线');
    expect(EDITOR_TOOLS).toContainEqual({ id: 'line', label: '直线', shortcut: 'L' });
    expect(['v', 'F', 'B', 'l', 'h'].map(toolForShortcut)).toEqual(['select', 'freehand', 'brush', 'line', 'pan']);
    expect(new Set(EDITOR_TOOLS.map(item => item.shortcut)).size).toBe(EDITOR_TOOLS.length);
    expect(toolForShortcut('x')).toBeNull();
  });
});

describe('line input gating', () => {
  it.each([
    ['mouse primary', { ...primary }, true],
    ['mouse right', { ...primary, button: 2, buttons: 2 }, false],
    ['mouse middle', { ...primary, button: 1, buttons: 4 }, false],
    ['pen tip', { ...primary, pointerType: 'pen' }, true],
    ['pen eraser', { ...primary, pointerType: 'pen', button: 5, buttons: 32 }, false],
    ['primary touch', { ...primary, pointerType: 'touch' }, true],
    ['second touch', { ...primary, pointerType: 'touch', isPrimary: false }, false],
  ])('filters %s', (_name, input, expected) => {
    expect(canBeginLine('line', 'folded', idle, input, 0, true)).toBe(expected);
  });

  it('only starts in the line tool, folded view, idle phase and a free-path profile', () => {
    expect(canBeginLine('brush', 'folded', idle, primary, 0, true)).toBe(false);
    expect(canBeginLine('freehand', 'folded', idle, primary, 0, true)).toBe(false);
    expect(canBeginLine('pan', 'folded', idle, primary, 0, true)).toBe(false);
    expect(canBeginLine('line', 'unfolded', idle, primary, 0, true)).toBe(false);
    expect(canBeginLine('line', 'folded', { kind: 'drawing' }, primary, 0, true)).toBe(false);
    expect(canBeginLine('line', 'folded', { kind: 'validating' }, primary, 0, true)).toBe(false);
    expect(canBeginLine('line', 'folded', idle, primary, 0, false)).toBe(false);
    expect(canBeginLine('line', 'folded', idle, { ...primary, pointerType: 'touch' }, 1, true)).toBe(false);
  });
});

describe('Shift snap directions', () => {
  const start = { x: 0.2, y: 0.3 };

  it('snaps near-horizontal drags to a pure horizontal line', () => {
    const end = snapLineEnd(start, { x: 0.36, y: 0.321 });
    expect(end.y).toBe(start.y);
    expect(end.x).toBeCloseTo(0.2 + Math.hypot(0.16, 0.021), 12);
  });

  it('snaps near-vertical drags to a pure vertical line', () => {
    const end = snapLineEnd(start, { x: 0.219, y: 0.45 });
    expect(end.x).toBe(start.x);
    expect(end.y).toBeCloseTo(0.3 + Math.hypot(0.019, 0.15), 12);
  });

  it('snaps near-diagonal drags to +45° and -45°', () => {
    const up = snapLineEnd(start, { x: 0.34, y: 0.46 });
    expect(up.x - start.x).toBeCloseTo(up.y - start.y, 12);
    expect(Math.hypot(up.x - start.x, up.y - start.y)).toBeCloseTo(Math.hypot(0.14, 0.16), 12);

    const down = snapLineEnd(start, { x: 0.35, y: 0.14 });
    expect(down.x - start.x).toBeCloseTo(-(down.y - start.y), 12);
    expect(Math.hypot(down.x - start.x, down.y - start.y)).toBeCloseTo(Math.hypot(0.15, 0.16), 12);
  });

  it('keeps every snap on the octant closest to the raw drag direction', () => {
    const cases: ReadonlyArray<readonly [number, number, 'h' | 'v' | 'diagonal']> = [
      [0.3, 0.02, 'h'], [-0.08, 0.004, 'h'],
      [0.02, 0.3, 'v'], [0.021, -0.28, 'v'],
      [0.12, 0.125, 'diagonal'], [-0.1, -0.11, 'diagonal'],
      [0.12, -0.13, 'diagonal'], [-0.11, 0.12, 'diagonal'],
    ];
    for (const [dx, dy, expected] of cases) {
      const end = snapLineEnd(start, { x: start.x + dx, y: start.y + dy });
      const gotX = end.x - start.x, gotY = end.y - start.y;
      expect(Math.hypot(gotX, gotY)).toBeCloseTo(Math.hypot(dx, dy), 12);
      if (expected === 'h') expect(gotY).toBe(0);
      if (expected === 'v') expect(gotX).toBe(0);
      if (expected === 'diagonal') {
        expect(Math.abs(gotX)).toBeCloseTo(Math.abs(gotY), 12);
        expect(Math.sign(gotX)).toBe(Math.sign(dx));
        expect(Math.sign(gotY)).toBe(Math.sign(dy));
      }
    }
  });

  it('returns the raw end without Shift and a zero drag stays at the start', () => {
    const drag = { start, current: { x: 0.33, y: 0.41 }, snap: false };
    expect(lineDragEnd(drag)).toEqual({ x: 0.33, y: 0.41 });
    expect(lineDragEnd({ ...drag, snap: true })).toEqual(snapLineEnd(start, drag.current));
    expect(snapLineEnd(start, start)).toEqual(start);
    expect(snapLineEnd(start, { x: 0.2, y: 0.3 })).toEqual(start);
  });
});

describe('minimum drag length', () => {
  it('rejects clicks and jitters at or below the screen threshold', () => {
    expect(LINE_MIN_DRAG_PX).toBe(4);
    expect(LINE_TOO_SHORT_MESSAGE).toMatch(/[一-鿿]/u);
    expect(isLineLongEnough(0)).toBe(false);
    expect(isLineLongEnough(3.9)).toBe(false);
    expect(isLineLongEnough(LINE_MIN_DRAG_PX)).toBe(true);
    expect(isLineLongEnough(40)).toBe(true);
  });

  it('measures screen distance with pan and zoom like the artwork layer', () => {
    const size = { width: 640, height: 480 };
    const start = { x: 0.2, y: 0.3 };
    const end = { x: 0.3, y: 0.3 };
    expect(lineScreenDistance(start, end, { zoom: 1, pan: { x: 0, y: 0 } }, size)).toBeCloseTo(0.1 * 480, 10);
    expect(lineScreenDistance(start, end, { zoom: 2, pan: { x: -20, y: 8 } }, size)).toBeCloseTo(0.1 * 480 * 2, 10);
  });

  it('a drag shorter than 4 CSS px is never long enough even when zoomed in', () => {
    const size = { width: 390, height: 700 };
    const start = { x: 0.2, y: 0.3 };
    const paperJitter = 4 / (8 * Math.min(size.width, size.height));
    const end = { x: start.x + paperJitter / 2, y: start.y };
    const distance = lineScreenDistance(start, end, { zoom: 8, pan: { x: 0, y: 0 } }, size);
    expect(distance).toBeLessThan(LINE_MIN_DRAG_PX);
    expect(isLineLongEnough(distance)).toBe(false);
  });
});

describe('line width reuses the brush width range', () => {
  it('keeps slider default and step inside the shared brush limits', () => {
    expect(BRUSH_WIDTH_DEFAULT).toBe(0.02);
    expect(BRUSH_WIDTH_STEP).toBe(0.005);
    expect(BRUSH_WIDTH_DEFAULT).toBeGreaterThanOrEqual(FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth);
    expect(BRUSH_WIDTH_DEFAULT).toBeLessThanOrEqual(FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth);
  });

  it('normalizes min and max slider widths to contract-valid values', () => {
    for (const width of [FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth, FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth]) {
      const normalized = brushWidthFromSlider(width);
      expect(normalized).toBe(width);
      expect(BrushCandidateV2Schema.safeParse({
        id: 'line-width', order: 0, rawPoints: [{ x: 0.2, y: 0.3 }, { x: 0.3, y: 0.3 }], width: normalized,
      }).success).toBe(true);
    }
    expect(brushWidthFromSlider(0.005)).toBe(FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth);
    expect(brushWidthFromSlider(0.12)).toBe(FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth);
  });
});

describe('line Worker submission', () => {
  it('sends one add-brush-cut containing exactly the start and end points', async () => {
    const work = { operations: [{ id: 'existing' }] } as WorkV2;
    const next = { operations: [{ id: 'existing' }, { id: 'line-new' }] } as WorkV2;
    const commands: PapercutCommandV2[] = [];
    const controller = { dispatch(command: PapercutCommandV2) { commands.push(command); return Promise.resolve(next); } };
    await expect(submitLineStroke(controller, work, 'line-raw', { x: 0.30000009, y: 0.4 }, { x: 0.1, y: 0.2 }, 0.02)).resolves.toBe(next);
    expect(commands).toEqual([{
      type: 'add-brush-cut',
      candidate: { id: 'line-raw', order: 1, rawPoints: [{ x: 0.30000009, y: 0.4 }, { x: 0.1, y: 0.2 }], width: 0.02 },
    }]);
  });

  it('submits the snapped endpoints once and keeps the caller Work on rejection', async () => {
    const work = { operations: [] } as unknown as WorkV2;
    const commands: PapercutCommandV2[] = [];
    const start = { x: 0.2, y: 0.3 };
    const drag = { start, current: { x: 0.34, y: 0.455 }, snap: true };
    const end = lineDragEnd(drag);
    await submitLineStroke({ dispatch(command: PapercutCommandV2) { commands.push(command); return Promise.resolve(work); } }, work, 'line-snap', start, end, 0.12);
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    if (command.type !== 'add-brush-cut') throw new Error('expected add-brush-cut');
    expect(command.candidate.rawPoints).toHaveLength(2);
    expect(command.candidate.rawPoints[0]).toEqual(start);
    const submitted = command.candidate.rawPoints[1]!;
    expect(submitted.x - start.x).toBeCloseTo(submitted.y - start.y, 12);
    expect(Math.hypot(submitted.x - start.x, submitted.y - start.y)).toBeCloseTo(Math.hypot(0.14, 0.155), 12);
    expect(command.candidate.width).toBe(0.12);

    const rejected = submitLineStroke({ dispatch: () => Promise.reject(new Error('笔刷扫掠区域超出允许区域')) }, work, 'line-rejected', start, end, 0.02);
    await expect(rejected).rejects.toThrow('笔刷扫掠区域超出允许区域');
    expect(work.operations).toHaveLength(0);
  });

  it('generates line candidate ids with the line- prefix and unified uuid', () => {
    const first = defaultLineCandidateId(), second = defaultLineCandidateId();
    expect(first).toMatch(/^line-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });
});
