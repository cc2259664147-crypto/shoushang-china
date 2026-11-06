import { describe, expect, it } from 'vitest';
import { parametricPropertyDraft, parseParametricPropertyDraft, screenPixelNudge } from './property-edit';

describe('M16-K precise property editing', () => {
  it('formats paper values as percentages and parses a complete transform', () => {
    const draft = parametricPropertyDraft({
      kind: 'parametric', id: 'p', order: 0, parameterVersion: 2, shape: 'ellipse',
      center: { x: 0.125, y: 0.375 }, width: 0.08, height: 0.1, angleDeg: 22.5,
    });
    expect(draft).toEqual({ centerX: '12.5', centerY: '37.5', width: '8', height: '10', angleDeg: '22.5' });
    expect(parseParametricPropertyDraft({ ...draft, centerX: '20', angleDeg: '-15' })).toEqual({
      ok: true,
      value: { center: { x: 0.2, y: 0.375 }, width: 0.08, height: 0.1, angleDeg: -15 },
    });
  });

  it('rejects empty, non-finite and structurally out-of-range values before dispatch', () => {
    const valid = { centerX: '20', centerY: '30', width: '8', height: '10', angleDeg: '0' };
    expect(parseParametricPropertyDraft({ ...valid, centerX: '' })).toEqual({ ok: false, message: '请输入中心 X' });
    expect(parseParametricPropertyDraft({ ...valid, angleDeg: 'Infinity' })).toEqual({ ok: false, message: '旋转角度必须是有限数字' });
    expect(parseParametricPropertyDraft({ ...valid, width: '0' })).toEqual({ ok: false, message: '宽度必须大于 0% 且不超过 100%' });
    expect(parseParametricPropertyDraft({ ...valid, centerY: '101' })).toEqual({ ok: false, message: '中心 Y 必须在 0% 到 100% 之间' });
  });

  it('converts 1/10 screen pixels at different zoom levels without changing paper geometry rules', () => {
    const size = { width: 720, height: 600 };
    expect(screenPixelNudge('ArrowRight', 1, { zoom: 1, pan: { x: 0, y: 0 } }, size)).toEqual({ dx: 1 / 600, dy: 0 });
    expect(screenPixelNudge('ArrowUp', 10, { zoom: 2, pan: { x: 40, y: 20 } }, size)).toEqual({ dx: 0, dy: -10 / 1200 });
  });
});
