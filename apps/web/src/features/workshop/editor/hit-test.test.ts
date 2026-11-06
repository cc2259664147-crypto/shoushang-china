import { describe, expect, test } from 'vitest';
import { hitTestCandidates, hitToleranceInPaper } from './hit-test';
import { fitViewport } from './viewport';

describe('hit testing', () => {
  test('converts mouse and touch/pen CSS tolerances to paper units', () => {
    const size = { width: 800, height: 400 };
    expect(hitToleranceInPaper('mouse', fitViewport(), size)).toBe(6 / 400);
    expect(hitToleranceInPaper('touch', fitViewport(), size)).toBe(12 / 400);
    expect(hitToleranceInPaper('pen', { zoom: 2, pan: { x: 999, y: -999 } }, size)).toBe(12 / 800);
  });

  test('mouse rejects a 7px miss while touch accepts it', () => {
    const size = { width: 500, height: 500 };
    const candidates = [{ id: 'cut', order: 0, value: { distance: 7 / 500 } }];
    const distance = (value: { distance: number }) => value.distance;
    expect(hitTestCandidates(candidates, { x: 0, y: 0 }, 'mouse', fitViewport(), size, distance)).toHaveLength(0);
    expect(hitTestCandidates(candidates, { x: 0, y: 0 }, 'touch', fitViewport(), size, distance)).toHaveLength(1);
  });

  test('returns topmost candidates first with stable distance and ordinal id ties', () => {
    const candidates = [
      { id: 'z-low', order: 1, value: 0.001 },
      { id: 'b-top', order: 5, value: 0.01 },
      { id: 'a-top', order: 5, value: 0.01 },
      { id: 'near-top', order: 5, value: 0.002 },
    ];
    const hits = hitTestCandidates(candidates, { x: 0.5, y: 0.5 }, 'touch', fitViewport(), { width: 500, height: 500 }, value => value);
    expect(hits.map(hit => hit.id)).toEqual(['near-top', 'a-top', 'b-top', 'z-low']);
  });
});
