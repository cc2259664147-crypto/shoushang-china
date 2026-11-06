import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { PapercutCommandV2, RawPointV2, WorkV2 } from '@shoushang/contracts';
import { FREEHAND_GEOMETRY_LIMITS_V2 } from '@shoushang/papercut-core';
import {
  canBeginFreehand,
  FREEHAND_TOO_LONG_MESSAGE,
  FreehandStrokeBuffer,
  orderedPointerSamples,
  submitFreehandStroke,
  VisibleTrailScheduler,
  type FreehandPhase,
} from './freehand';
import { toolForShortcut } from './tools';

const idle: FreehandPhase = { kind: 'idle' };
const primary = { pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true };

describe('freehand input and raw sampling', () => {
  it.each([
    ['mouse primary', { ...primary }, true],
    ['mouse right', { ...primary, button: 2, buttons: 2 }, false],
    ['mouse middle', { ...primary, button: 1, buttons: 4 }, false],
    ['pen tip', { ...primary, pointerType: 'pen' }, true],
    ['pen eraser', { ...primary, pointerType: 'pen', button: 5, buttons: 32 }, false],
    ['primary touch', { ...primary, pointerType: 'touch' }, true],
    ['second touch', { ...primary, pointerType: 'touch', isPrimary: false }, false],
  ])('filters %s', (_name, input, expected) => {
    expect(canBeginFreehand('freehand', 'folded', idle, input, 0)).toBe(expected);
  });

  it('only starts in the freehand tool, folded view, and non-validating state', () => {
    expect(canBeginFreehand('select', 'folded', idle, primary, 0)).toBe(false);
    expect(canBeginFreehand('pan', 'folded', idle, primary, 0)).toBe(false);
    expect(canBeginFreehand('freehand', 'unfolded', idle, primary, 0)).toBe(false);
    expect(canBeginFreehand('freehand', 'folded', { kind: 'validating' }, primary, 0)).toBe(false);
    expect(canBeginFreehand('freehand', 'folded', idle, { ...primary, pointerType: 'touch' }, 1)).toBe(false);
  });

  it('uses coalesced events in exact arrival order and falls back to the event', () => {
    const coalesced = [{ clientX: 9, clientY: 3 }, { clientX: 2, clientY: 8 }, { clientX: 7, clientY: 1 }];
    expect(orderedPointerSamples({ clientX: 99, clientY: 99, getCoalescedEvents: () => coalesced })).toEqual(coalesced);
    expect(orderedPointerSamples({ clientX: 4, clientY: 5, getCoalescedEvents: () => [] })).toEqual([{ clientX: 4, clientY: 5 }]);
  });

  it('keeps duplicate, non-quantized and out-of-bounds raw points untouched', () => {
    const buffer = new FreehandStrokeBuffer();
    const points = [{ x: -0.123456789, y: 1.2 }, { x: -0.123456789, y: 1.2 }, { x: 0.333333333, y: 0.4 }];
    buffer.begin(points[0]!);
    expect(buffer.append(points.slice(1))).toEqual({ ok: true });
    expect(buffer.freeze()).toEqual(points);
  });

  it('cancels at point 4097 with no truncation or dispatchable candidate', () => {
    const buffer = new FreehandStrokeBuffer();
    buffer.begin({ x: 0, y: 0 });
    expect(buffer.append(Array.from({ length: FREEHAND_GEOMETRY_LIMITS_V2.rawMaxPoints - 1 }, (_value, index) => ({ x: index / 10_000, y: 0.1 })))).toEqual({ ok: true });
    expect(buffer.length).toBe(4096);
    expect(buffer.append([{ x: 0.2, y: 0.2 }])).toEqual({ ok: false, message: FREEHAND_TOO_LONG_MESSAGE });
    expect(buffer.isActive).toBe(false);
    expect(buffer.snapshot()).toEqual([]);
  });

  it('cancellation paths clear the candidate without issuing commands', () => {
    const dispatch = vi.fn();
    for (const _reason of ['Escape', 'pointercancel', 'lostpointercapture', 'tool-switch', 'second-touch', 'work-switch']) {
      const buffer = new FreehandStrokeBuffer();
      buffer.begin({ x: 0.1, y: 0.1 });
      buffer.append([{ x: 0.2, y: 0.2 }]);
      buffer.cancel();
      expect(buffer.snapshot()).toEqual([]);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('frame throttling and Worker submission', () => {
  it('publishes at most once per animation frame and cancels pending work on unmount', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancel = vi.fn((handle: number) => { callbacks.delete(handle); });
    const publish = vi.fn();
    let handle = 0;
    const scheduler = new VisibleTrailScheduler(callback => {
      const next = ++handle;
      callbacks.set(next, timestamp => { callbacks.delete(next); callback(timestamp); });
      return next;
    }, cancel, publish);
    const read = () => [{ x: 0.1, y: 0.2 }];
    scheduler.schedule(read);
    scheduler.schedule(read);
    scheduler.schedule(read);
    expect(callbacks.size).toBe(1);
    callbacks.get(1)?.(16);
    expect(publish).toHaveBeenCalledTimes(1);
    scheduler.schedule(read);
    scheduler.cancel();
    expect(cancel).toHaveBeenCalledWith(2);
    expect(callbacks.size).toBe(0);
  });

  it('sends one add-freehand-cut with the unchanged raw point order', async () => {
    const points: RawPointV2[] = [{ x: 0.30000009, y: 0.4 }, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2 }];
    const work = { operations: [{ id: 'existing' }] } as WorkV2;
    const next = { operations: [{ id: 'existing' }, { id: 'new' }] } as WorkV2;
    const commands: PapercutCommandV2[] = [];
    const controller = { dispatch(command: PapercutCommandV2) { commands.push(command); return Promise.resolve(next); } };
    await expect(submitFreehandStroke(controller, work, 'raw-cut', points)).resolves.toBe(next);
    expect(commands).toEqual([{ type: 'add-freehand-cut', candidate: { id: 'raw-cut', order: 1, rawPoints: points } }]);
  });

  it('does not change a caller Work before success and preserves it on rejection', async () => {
    const work = { operations: [] } as unknown as WorkV2;
    let resolveDispatch: ((work: WorkV2) => void) | null = null;
    const pending = submitFreehandStroke({ dispatch: () => new Promise(resolve => { resolveDispatch = resolve; }) }, work, 'pending', [{ x: 0, y: 0 }]);
    expect(work.operations).toHaveLength(0);
    expect(resolveDispatch).not.toBeNull();
    resolveDispatch!({ ...work, operations: [{ id: 'confirmed' }] } as WorkV2);
    expect((await pending).operations).toHaveLength(1);

    const rejected = submitFreehandStroke({ dispatch: () => Promise.reject(new Error('轮廓相交')) }, work, 'rejected', [{ x: 0, y: 0 }]);
    await expect(rejected).rejects.toThrow('轮廓相交');
    expect(work.operations).toHaveLength(0);
  });

  it('exposes only the three real tools and their keyboard shortcuts', () => {
    expect(['v', 'F', 'h'].map(toolForShortcut)).toEqual(['select', 'freehand', 'pan']);
    expect(toolForShortcut('x')).toBeNull();
  });

  it('contains no UI-side geometry, RDP, quantization or intersection algorithm', () => {
    const source = readFileSync(fileURLToPath(new URL('./freehand.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/\b(?:RDP|simplif|quantiz|intersect|shoelace)\b/i);
  });
});
