import { describe, expect, it } from 'vitest';
import type { WorkV2 } from '@shoushang/contracts';
import {
  allowedParametricShapes,
  canBeginParametric,
  makeParametricOperation,
  parametricBounds,
  type ParametricDrag,
} from './parametric';
import { EDITOR_TOOLS, toolForShortcut, toolLabel } from './tools';

const limits = [
  { shape: 'circle' as const, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.02, maxHeight: 0.3 },
  { shape: 'triangle' as const, minWidth: 0.03, maxWidth: 0.3, minHeight: 0.04, maxHeight: 0.3 },
  { shape: 'teardrop' as const, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.04, maxHeight: 0.3 },
  { shape: 'ellipse' as const, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.02, maxHeight: 0.3 },
  { shape: 'rectangle' as const, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.02, maxHeight: 0.3 },
  { shape: 'star' as const, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.02, maxHeight: 0.3 },
  { shape: 'petal' as const, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.02, maxHeight: 0.3 },
];
const work = {
  operations: [],
  templateSnapshot: { allowedCuts: limits },
  editorProfileSnapshot: { allowedTools: { parametric: ['circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal'] } },
} as unknown as WorkV2;
const primary = { pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true };

describe('parametric tools', () => {
  it('exposes all seven Chinese tools and keyboard shortcuts', () => {
    expect(EDITOR_TOOLS.filter(item => limits.some(limit => limit.shape === item.id))).toEqual([
      { id: 'circle', label: '圆形', shortcut: 'C' },
      { id: 'triangle', label: '三角形', shortcut: 'T' },
      { id: 'teardrop', label: '水滴形', shortcut: 'D' },
      { id: 'ellipse', label: '椭圆', shortcut: 'E' },
      { id: 'rectangle', label: '矩形', shortcut: 'R' },
      { id: 'star', label: '五角星', shortcut: 'S' },
      { id: 'petal', label: '花瓣', shortcut: 'P' },
    ]);
    expect(['c', 'T', 'd', 'e', 'R', 's', 'P'].map(toolForShortcut)).toEqual(['circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal']);
    expect(toolLabel('teardrop')).toBe('水滴形');
  });

  it('intersects profile and template permissions', () => {
    const restricted = {
      ...work,
      templateSnapshot: { ...work.templateSnapshot, allowedCuts: limits.slice(0, 2) },
      editorProfileSnapshot: { ...work.editorProfileSnapshot, allowedTools: { ...work.editorProfileSnapshot.allowedTools, parametric: ['circle', 'teardrop'] } },
    } as WorkV2;
    expect(allowedParametricShapes(restricted)).toEqual(['circle']);
  });

  it.each([
    ['mouse', primary, 0, true],
    ['right mouse', { ...primary, button: 2, buttons: 2 }, 0, false],
    ['pen tip', { ...primary, pointerType: 'pen' }, 0, true],
    ['pen eraser', { ...primary, pointerType: 'pen', button: 5, buttons: 32 }, 0, false],
    ['one touch', { ...primary, pointerType: 'touch' }, 0, true],
    ['second touch', { ...primary, pointerType: 'touch', isPrimary: false }, 1, false],
  ])('gates %s input', (_name, input, touchCount, expected) => {
    expect(canBeginParametric('circle', 'folded', { kind: 'idle' }, input, touchCount, ['circle'])).toBe(expected);
  });

  it('blocks unfolded, busy, wrong and disallowed tools', () => {
    expect(canBeginParametric('circle', 'unfolded', { kind: 'idle' }, primary, 0, ['circle'])).toBe(false);
    expect(canBeginParametric('circle', 'folded', { kind: 'validating' }, primary, 0, ['circle'])).toBe(false);
    expect(canBeginParametric('circle', 'folded', { kind: 'idle' }, primary, 0, [])).toBe(false);
    expect(canBeginParametric('brush', 'folded', { kind: 'idle' }, primary, 0, ['circle'])).toBe(false);
  });

  it('builds all seven immutable parameter operations from a bounding box', () => {
    for (const shape of ['circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal'] as const) {
      const drag: ParametricDrag = { pointerId: 1, shape, start: { x: 0.1, y: 0.2 }, current: { x: 0.24, y: 0.32 }, lockAspect: false };
      const result = makeParametricOperation(work, drag, `${shape}-1`);
      expect(result).toEqual({ ok: true, operation: {
        kind: 'parametric', id: `${shape}-1`, order: 0, parameterVersion: 2, shape,
        center: { x: 0.17, y: 0.26 }, width: 0.14, height: 0.12, angleDeg: 0,
      } });
      expect(drag.current).toEqual({ x: 0.24, y: 0.32 });
    }
  });

  it('locks width and height with Shift in every drag direction', () => {
    const bounds = parametricBounds({ x: 0.3, y: 0.4 }, { x: 0.2, y: 0.55 }, true);
    expect(bounds.left).toBeCloseTo(0.15, 12);
    expect(bounds.top).toBeCloseTo(0.4, 12);
    expect(bounds.width).toBeCloseTo(0.15, 12);
    expect(bounds.height).toBeCloseTo(0.15, 12);
    expect(bounds.center.x).toBeCloseTo(0.225, 12);
    expect(bounds.center.y).toBeCloseTo(0.475, 12);
  });

  it('rejects below-template minimum and disallowed shapes before dispatch', () => {
    const tiny: ParametricDrag = { pointerId: 1, shape: 'triangle', start: { x: 0.1, y: 0.1 }, current: { x: 0.12, y: 0.13 }, lockAspect: false };
    expect(makeParametricOperation(work, tiny, 'tiny')).toEqual({ ok: false, message: '图形太小，请拖大后再试' });
    const restricted = { ...work, editorProfileSnapshot: { ...work.editorProfileSnapshot, allowedTools: { ...work.editorProfileSnapshot.allowedTools, parametric: ['circle'] } } } as WorkV2;
    expect(makeParametricOperation(restricted, { ...tiny, shape: 'triangle', current: { x: 0.2, y: 0.2 } }, 'blocked')).toEqual({ ok: false, message: '当前模板不允许此图形' });
  });
});
