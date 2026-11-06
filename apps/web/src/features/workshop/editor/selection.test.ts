import { describe, expect, it, vi } from 'vitest';
import { EditorProfileV2Schema, TemplateVersionV1Schema, WorkV2Schema, type WorkV2 } from '@shoushang/contracts';
import profilesDocument from '../../../../../../docs/qa/m15/editor-profiles-v2.json';
import {
  distanceToCutContour,
  DragPreviewScheduler,
  beginParametricTransform,
  dragTranslation,
  parametricBoxCorners,
  parametricTransformPreview,
  selectedCut,
  topmostCutAt,
  translatedContour,
  type CutDrag,
} from './selection';

const entry = profilesDocument.profiles[0]!;
const profile = EditorProfileV2Schema.parse(entry.profile);
const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));

function fixture(): WorkV2 {
  return WorkV2Schema.parse({
    id: 'selection-work', name: '选择测试', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' },
    operations: [
      { kind: 'parametric', id: 'lower', order: 0, parameterVersion: 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0 },
      { kind: 'parametric', id: 'upper', order: 1, parameterVersion: 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.06, height: 0.06, angleDeg: 0 },
    ],
    status: 'draft', schemaVersion: 2, revision: 0,
    createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z',
  });
}

describe('selection and drag interactions', () => {
  it('uses existing hit ordering to select the visually topmost overlapping cut', () => {
    expect(topmostCutAt(fixture(), { x: 0.2, y: 0.3 }, 'mouse', { zoom: 1, pan: { x: 0, y: 0 } }, { width: 600, height: 600 })?.id).toBe('upper');
    expect(topmostCutAt(fixture(), { x: 0.4, y: 0.8 }, 'mouse', { zoom: 1, pan: { x: 0, y: 0 } }, { width: 600, height: 600 })).toBeNull();
  });

  it('computes contour distance, paper delta and temporary contour without changing Work', () => {
    const work = fixture(), before = JSON.stringify(work);
    expect(distanceToCutContour([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], { x: 0.5, y: 0.5 })).toBe(0);
    const drag: CutDrag = { pointerId: 1, operationId: 'upper', start: { x: 0.2, y: 0.3 }, current: { x: 0.27, y: 0.26 } };
    expect(dragTranslation(drag)).toEqual({ dx: 0.07, dy: -0.03999999999999998 });
    const contour = selectedCut(work, 'upper')!.contour;
    expect(translatedContour(contour, 0.07, -0.04)[0]).toEqual({ x: contour[0]!.x + 0.07, y: contour[0]!.y - 0.04 });
    expect(JSON.stringify(work)).toBe(before);
    expect(selectedCut(work, 'missing')).toBeNull();
  });

  it('publishes drag preview at most once per animation frame and cancels pending work', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let handle = 0;
    const cancel = vi.fn((id: number) => callbacks.delete(id));
    const publish = vi.fn();
    const scheduler = new DragPreviewScheduler(callback => { const id = ++handle; callbacks.set(id, callback); return id; }, cancel, publish);
    const drag: CutDrag = { pointerId: 1, operationId: 'upper', start: { x: 0, y: 0 }, current: { x: 0.1, y: 0.1 } };
    scheduler.schedule(() => drag);
    scheduler.schedule(() => drag);
    expect(callbacks.size).toBe(1);
    callbacks.get(1)?.(16);
    expect(publish).toHaveBeenCalledTimes(1);
    scheduler.schedule(() => drag);
    scheduler.cancel();
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it('scales from a fixed opposite corner and Shift preserves the original ratio', () => {
    const operation = fixture().operations[1]!;
    if (operation.kind !== 'parametric') throw new Error('missing parametric fixture');
    const originalBox = parametricBoxCorners(operation);
    const free = parametricTransformPreview(beginParametricTransform(operation, 'se', 1, { x: 0.28, y: 0.36 }, false));
    expect(parametricBoxCorners(free).nw.x).toBeCloseTo(originalBox.nw.x, 12);
    expect(parametricBoxCorners(free).nw.y).toBeCloseTo(originalBox.nw.y, 12);
    expect(free.width).not.toBeCloseTo(free.height, 6);
    const locked = parametricTransformPreview(beginParametricTransform(operation, 'se', 1, { x: 0.28, y: 0.36 }, true));
    expect(locked.width / locked.height).toBeCloseTo(operation.width / operation.height, 12);
  });

  it('rotates around the center, snaps to 15 degrees and normalizes across zero', () => {
    const operation = { ...(fixture().operations[1] as Extract<WorkV2['operations'][number], { kind: 'parametric' }>), angleDeg: 350 };
    const start = { x: operation.center.x + 0.1, y: operation.center.y };
    const current = { x: operation.center.x + Math.cos(20 * Math.PI / 180) * 0.1, y: operation.center.y + Math.sin(20 * Math.PI / 180) * 0.1 };
    const free = parametricTransformPreview({ ...beginParametricTransform(operation, 'rotate', 1, start, false), current });
    expect(free.angleDeg).toBeCloseTo(10, 10);
    const snapped = parametricTransformPreview({ ...beginParametricTransform(operation, 'rotate', 1, start, true), current });
    expect(snapped.angleDeg).toBe(15);
  });
});
