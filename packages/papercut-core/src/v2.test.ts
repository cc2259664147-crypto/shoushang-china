import { describe, expect, it } from 'vitest';
import {
  EditorProfileV2Schema,
  TemplateVersionV1Schema,
  WorkV2Schema,
  type BrushCandidateV2,
  type FreehandCandidateV2,
  type ParametricCutV2,
  type Result,
  type WorkV2,
} from '@shoushang/contracts';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import {
  createPapercutCoreV2,
  FREEHAND_GEOMETRY_LIMITS_V2,
  getWorkGeometryV2,
  type PapercutSessionV2,
} from './index';
import { applyHistoryEntryV2, type HistoryEntryV2 } from './v2-session';

const core = createPapercutCoreV2();
const time = '2026-10-23T00:00:00.000Z';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function fixture(index = 0): WorkV2 {
  const entry = profilesDocument.profiles[index]!;
  const profile = EditorProfileV2Schema.parse(entry.profile);
  const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
  return WorkV2Schema.parse({
    id: `work-v2-${index}`, name: '剪纸 v2', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [],
    status: 'draft', schemaVersion: 2, revision: 0, createdAt: time, updatedAt: time,
  });
}

function candidate(id = 'freehand-1', order = 0, rawPoints: FreehandCandidateV2['rawPoints'] = [
  { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 },
]): FreehandCandidateV2 { return { id, order, rawPoints: [...rawPoints] }; }

function brush(id = 'brush-1', order = 0, rawPoints: BrushCandidateV2['rawPoints'] = [
  { x: 0.12, y: 0.2 }, { x: 0.22, y: 0.25 },
], width = 0.01): BrushCandidateV2 { return { id, order, rawPoints: rawPoints.map(point => ({ ...point })), width }; }

function parametric(id: string, order: number, shape: ParametricCutV2['shape'] = 'circle', center = { x: 0.2, y: 0.3 }): ParametricCutV2 {
  return { kind: 'parametric', id, order, parameterVersion: 2, shape, center, width: 0.08, height: 0.08, angleDeg: 0 };
}

function session(work = fixture()): PapercutSessionV2 { return unwrap(core.createSession(work)); }

function expectFailure(result: Result<unknown>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe('papercut core v2 freehand normalization', () => {
  it('deduplicates, simplifies and quantizes to one deterministic golden path', () => {
    const input = candidate('golden', 0, [
      { x: 0.1, y: 0.1 }, { x: 0.1001, y: 0.1001 },
      { x: 0.15, y: 0.1 }, { x: 0.2000004, y: 0.1 },
      { x: 0.2, y: 0.15 }, { x: 0.2, y: 0.2 },
      { x: 0.15, y: 0.2 }, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.15 },
    ]);
    const first = unwrap(core.prepareFreehandCut(fixture(), input));
    const second = unwrap(core.prepareFreehandCut(fixture(), input));
    expect(first).toEqual(second);
    expect(first.points).toEqual([
      { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 },
      { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.15 },
    ]);
    expect(first.points.some(point => Object.is(point.x, -0) || Object.is(point.y, -0))).toBe(false);
  });

  it('validates both raw and normalized paths', () => {
    const bowTie = candidate('bow', 0, [
      { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }, { x: 0.2, y: 0.1 },
    ]);
    expectFailure(core.prepareFreehandCut(fixture(), bowTie), 'GEOMETRY_INVALID');
    const collapsesAfterRdp = candidate('rdp-collapse', 0, [
      { x: 0.1, y: 0.1 }, { x: 0.12, y: 0.101 }, { x: 0.14, y: 0.101 },
      { x: 0.16, y: 0.101 }, { x: 0.18, y: 0.101 }, { x: 0.2, y: 0.1 },
    ]);
    expectFailure(core.prepareFreehandCut(fixture(), collapsesAfterRdp), 'GEOMETRY_INVALID');
  });

  it('rejects intersection, contact, overlap, bounds, degeneracy and geometry limits', () => {
    const invalidPaths: FreehandCandidateV2['rawPoints'][] = [
      [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }, { x: 0.2, y: 0.1 }],
      [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.15, y: 0.15 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }, { x: 0.15, y: 0.15 }],
      [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.15, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }],
      [{ x: -0.01, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
      [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.10005 }, { x: 0.3, y: 0.1 }],
    ];
    invalidPaths.forEach((points, index) => expectFailure(core.prepareFreehandCut(fixture(), candidate(`invalid-${index}`, 0, points)), 'GEOMETRY_INVALID'));

    const outsideAllowed = candidate('outside-allowed', 0, [{ x: 0.05, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.2 }]);
    expectFailure(core.prepareFreehandCut(fixture(), outsideAllowed), 'GEOMETRY_INVALID');

    const baseWork = fixture();
    baseWork.templateSnapshot.geometry.allowedRegion = [{ x: 0, y: 0 }, { x: 0.8, y: 0 }, { x: 0.8, y: 1 }, { x: 0, y: 1 }];
    expectFailure(core.prepareFreehandCut(baseWork, candidate('outside-domain', 0, [{ x: 0.6, y: 0.2 }, { x: 0.7, y: 0.2 }, { x: 0.7, y: 0.3 }])), 'GEOMETRY_INVALID');

    const edgeWork = fixture();
    edgeWork.templateSnapshot.geometry.allowedRegion = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
    expectFailure(core.prepareFreehandCut(edgeWork, candidate('edge-gap', 0, [{ x: 0.005, y: 0.1 }, { x: 0.02, y: 0.1 }, { x: 0.02, y: 0.2 }])), 'GEOMETRY_INVALID');

    const perimeterWork = fixture();
    perimeterWork.editorProfileSnapshot.allowedTools.freehand.minPerimeter = 0.5;
    expectFailure(core.prepareFreehandCut(perimeterWork, candidate()), 'GEOMETRY_INVALID');
    expectFailure(core.prepareFreehandCut(fixture(), { ...candidate(), rawPoints: candidate().rawPoints.slice(0, 2) }), 'INVALID_INPUT');
    expectFailure(core.prepareFreehandCut(fixture(), candidate('too-many', 0, Array.from({ length: 4097 }, () => ({ x: 0.1, y: 0.1 })))), 'INVALID_INPUT');
  });

  it('uses the same normalizer for prepare and dispatch and handles 4096 raw points diagnostically', () => {
    const work = fixture(), input = candidate();
    const prepared = unwrap(core.prepareFreehandCut(work, input));
    const active = session(work);
    const dispatched = unwrap(active.dispatch({ type: 'add-freehand-cut', candidate: input }));
    expect(dispatched.work.operations[0]).toEqual(prepared);

    const points = Array.from({ length: FREEHAND_GEOMETRY_LIMITS_V2.rawMaxPoints }, (_value, index) => {
      const angle = index * Math.PI * 2 / FREEHAND_GEOMETRY_LIMITS_V2.rawMaxPoints;
      return { x: 0.25 + 0.1 * Math.cos(angle), y: 0.3 + 0.1 * Math.sin(angle) };
    });
    const result = core.prepareFreehandCut(fixture(), candidate('diagnostic-4096', 0, points));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.points.length).toBeLessThanOrEqual(FREEHAND_GEOMETRY_LIMITS_V2.savedMaxPoints);
  });

  it('enforces profile single-path, total-point and operation limits', () => {
    const single = fixture();
    single.editorProfileSnapshot.allowedTools.freehand.maxPoints = 3;
    expectFailure(core.prepareFreehandCut(single, candidate()), 'GEOMETRY_INVALID');

    const total = fixture();
    total.editorProfileSnapshot.allowedTools.freehand.maxPoints = 3;
    total.editorProfileSnapshot.maxTotalFreehandPoints = 6;
    total.operations = [
      { kind: 'freehand', id: 'a', order: 0, parameterVersion: 2, closed: true, points: [{ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.1 }, { x: 0.1, y: 0.15 }] },
      { kind: 'freehand', id: 'b', order: 1, parameterVersion: 2, closed: true, points: [{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.2 }, { x: 0.2, y: 0.25 }] },
    ];
    expectFailure(core.prepareFreehandCut(total, candidate('c', 2, [{ x: 0.3, y: 0.3 }, { x: 0.35, y: 0.3 }, { x: 0.3, y: 0.35 }])), 'GEOMETRY_INVALID');

    const operations = fixture();
    operations.templateSnapshot.rules.maxOperations = 1;
    operations.operations = [parametric('only', 0)];
    expectFailure(core.prepareFreehandCut(operations, candidate('over-limit', 1)), 'GEOMETRY_INVALID');
  });
});

describe('papercut core v2 open brush normalization and geometry', () => {
  it('creates open straight, curved, single-point and self-intersecting brush cuts immutably', () => {
    const inputs = [
      brush('straight', 0, [{ x: 0.12, y: 0.2 }, { x: 0.3, y: 0.2 }]),
      brush('curve', 0, [{ x: 0.12, y: 0.2 }, { x: 0.2, y: 0.3 }, { x: 0.3, y: 0.2 }]),
      brush('dot', 0, [{ x: 0.2, y: 0.2 }]),
      brush('self-cross', 0, [{ x: 0.12, y: 0.2 }, { x: 0.3, y: 0.35 }, { x: 0.12, y: 0.35 }, { x: 0.3, y: 0.2 }]),
    ];
    for (const input of inputs) {
      const before = structuredClone(input);
      const result = unwrap(core.prepareBrushCut(fixture(), input));
      expect(result).toMatchObject({ kind: 'brush', id: input.id, width: 0.01, parameterVersion: 2 });
      expect(result.points.length).toBeGreaterThanOrEqual(1);
      expect(input).toEqual(before);
    }
    const open = unwrap(core.prepareBrushCut(fixture(), inputs[0]!));
    expect(open.points[0]).not.toEqual(open.points.at(-1));
  });

  it('enforces quantized finite width bounds', () => {
    expect(core.prepareBrushCut(fixture(), brush('min', 0, [{ x: 0.12, y: 0.2 }], 0.005)).ok).toBe(true);
    expect(core.prepareBrushCut(fixture(), brush('max', 0, [{ x: 0.2, y: 0.2 }], 0.12)).ok).toBe(true);
    for (const width of [0.004999, 0.120001, 0.0100001, NaN, Infinity]) {
      expectFailure(core.prepareBrushCut(fixture(), { ...brush(), width } as BrushCandidateV2), 'INVALID_INPUT');
    }
  });

  it('deduplicates, simplifies and quantizes up to 4096 raw points', () => {
    const rawPoints = Array.from({ length: 4096 }, (_value, index) => ({ x: 0.12 + index * 0.18 / 4095, y: 0.2000004 }));
    const result = unwrap(core.prepareBrushCut(fixture(), brush('dense', 0, rawPoints)));
    expect(result.points).toEqual([{ x: 0.12, y: 0.2 }, { x: 0.3, y: 0.2 }]);
    expect(result.points.length).toBeLessThanOrEqual(512);
    expectFailure(core.prepareBrushCut(fixture(), brush('too-many', 0, [...rawPoints, { x: 0.31, y: 0.2 }])), 'INVALID_INPUT');
  });

  it('validates the swept radius against allowed region, fold domain and unfolded edge gap', () => {
    expectFailure(core.prepareBrushCut(fixture(), brush('allowed-edge', 0, [{ x: 0.062, y: 0.2 }], 0.01)), 'GEOMETRY_INVALID');
    const domain = fixture();
    domain.templateSnapshot.geometry.allowedRegion = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expectFailure(core.prepareBrushCut(domain, brush('domain-edge', 0, [{ x: 0.498, y: 0.2 }], 0.01)), 'GEOMETRY_INVALID');
    const paper = fixture();
    paper.templateSnapshot.geometry.allowedRegion = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
    expectFailure(core.prepareBrushCut(paper, brush('paper-edge', 0, [{ x: 0.018, y: 0.2 }], 0.01)), 'GEOMETRY_INVALID');
  });

  it('shares profile enablement and total point limits with closed freehand', () => {
    const disabled = fixture();
    disabled.editorProfileSnapshot.allowedTools.freehand.enabled = false;
    expectFailure(core.prepareBrushCut(disabled, brush()), 'GEOMETRY_INVALID');
    const limited = fixture();
    limited.editorProfileSnapshot.allowedTools.freehand.maxPoints = 4;
    limited.editorProfileSnapshot.maxTotalFreehandPoints = 4;
    limited.operations = [{ kind: 'freehand', id: 'closed', order: 0, parameterVersion: 2, closed: true, points: [{ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.1 }, { x: 0.1, y: 0.15 }] }];
    expectFailure(core.prepareBrushCut(limited, brush('over-total', 1)), 'GEOMETRY_INVALID');
    const reverse = fixture();
    reverse.editorProfileSnapshot.allowedTools.freehand.maxPoints = 4;
    reverse.editorProfileSnapshot.maxTotalFreehandPoints = 4;
    reverse.operations = [{ kind: 'brush', id: 'existing-brush', order: 0, parameterVersion: 2, points: [{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.2 }], width: 0.01 }];
    expectFailure(core.prepareFreehandCut(reverse, candidate('over-total-freehand', 1, [{ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.1 }, { x: 0.1, y: 0.15 }])), 'GEOMETRY_INVALID');
    const singlePath = fixture();
    singlePath.editorProfileSnapshot.allowedTools.freehand.maxPoints = 3;
    expectFailure(core.prepareBrushCut(singlePath, brush('over-single', 0, [{ x: 0.12, y: 0.2 }, { x: 0.2, y: 0.3 }, { x: 0.3, y: 0.2 }, { x: 0.2, y: 0.15 }])), 'GEOMETRY_INVALID');
  });

  it('emits round paper-stroke geometry and supports all history operations', () => {
    const active = session();
    let state = unwrap(active.dispatch({ type: 'add-brush-cut', candidate: brush() }));
    const original = state.work.operations[0];
    const geometry = unwrap(getWorkGeometryV2(state.work));
    expect(geometry.cuts[0]).toMatchObject({ kind: 'brush', localShape: { kind: 'paper-stroke', width: 0.01, lineCap: 'round', lineJoin: 'round', conservativeBounds: { minX: 0.115, minY: 0.195, maxX: 0.225, maxY: 0.255 } } });
    state = unwrap(active.dispatch({ type: 'update-cut', operationId: 'brush-1', change: { type: 'translate', dx: 0.01, dy: 0.01 } }));
    expect(state.work.operations[0]).not.toEqual(original);
    state = unwrap(active.dispatch({ type: 'undo' })); expect(state.work.operations[0]).toEqual(original);
    state = unwrap(active.dispatch({ type: 'redo' })); expect(state.work.operations[0]).not.toEqual(original);
    state = unwrap(active.dispatch({ type: 'delete-cut', operationId: 'brush-1' })); expect(state.work.operations).toEqual([]);
    state = unwrap(active.dispatch({ type: 'undo' })); expect(state.work.operations).toHaveLength(1);
    expectFailure(active.dispatch({ type: 'add-brush-cut', candidate: brush('brush-1', 1) }), 'INVALID_INPUT');
    state = unwrap(active.dispatch({ type: 'clear-cuts' })); expect(state.work.operations).toEqual([]);
    state = unwrap(active.dispatch({ type: 'undo' })); expect(state.work.operations).toHaveLength(1);
  });
});

describe('papercut core v2 geometry and session', () => {
  it('reuses all v1 parametric formulas and emits unified v2 geometry', () => {
    const work = fixture(2);
    work.operations = [
      parametric('circle', 0, 'circle', { x: 0.65, y: 0.65 }),
      parametric('triangle', 1, 'triangle', { x: 0.75, y: 0.7 }),
      parametric('teardrop', 2, 'teardrop', { x: 0.85, y: 0.75 }),
    ];
    const active = session(work);
    const withFreehand = unwrap(active.dispatch({ type: 'add-freehand-cut', candidate: candidate('loop', 3, [
      { x: 0.6, y: 0.8 }, { x: 0.7, y: 0.8 }, { x: 0.7, y: 0.88 }, { x: 0.6, y: 0.88 },
    ]) }));
    const geometry = unwrap(getWorkGeometryV2(withFreehand.work));
    expect(geometry).toMatchObject({ geometryVersion: 2, overlap: 'union' });
    expect(geometry.cuts.map(cut => cut.kind)).toEqual(['parametric', 'parametric', 'parametric', 'freehand']);
    expect(geometry.cuts.slice(0, 3).map(cut => cut.localShape.kind)).toEqual(['ellipse', 'polygon', 'cubic-loop']);
    expect(geometry.cuts[3]!.localShape).toEqual({ kind: 'paper-loop', vertices: withFreehand.work.operations[3]!.kind === 'freehand' ? withFreehand.work.operations[3]!.points : [] });
    expect(geometry.symmetryTransforms).toHaveLength(4);
  });

  it('implements add, translate, delete, clear, palette, undo and redo atomically', () => {
    const active = session();
    let state = unwrap(active.dispatch({ type: 'add-parametric-cut', operation: parametric('p1', 0) }));
    state = unwrap(active.dispatch({ type: 'add-freehand-cut', candidate: candidate('f1', 1) }));
    state = unwrap(active.dispatch({ type: 'update-cut', operationId: 'f1', change: { type: 'translate', dx: 0.01, dy: 0.01 } }));
    expect(state.work.operations[1]).toMatchObject({ id: 'f1', order: 1, kind: 'freehand' });
    state = unwrap(active.dispatch({ type: 'delete-cut', operationId: 'p1' }));
    expect(state.work.operations[0]).toMatchObject({ id: 'f1', order: 0 });
    state = unwrap(active.dispatch({ type: 'set-palette', palette: { paper: '#001122', background: '#FFFFFF' } }));
    state = unwrap(active.dispatch({ type: 'clear-cuts' }));
    expect(state.work.operations).toEqual([]);
    state = unwrap(active.dispatch({ type: 'undo' })); expect(state.work.operations).toHaveLength(1);
    state = unwrap(active.dispatch({ type: 'undo' })); expect(state.work.palette.paper).toBe('#B82025');
    state = unwrap(active.dispatch({ type: 'redo' })); expect(state.work.palette.paper).toBe('#001122');
    state = unwrap(active.dispatch({ type: 'redo' })); expect(state.work.operations).toEqual([]);
  });

  it('keeps no-ops and invalid commands from changing state or clearing redo', () => {
    const active = session();
    unwrap(active.dispatch({ type: 'add-parametric-cut', operation: parametric('p1', 0) }));
    unwrap(active.dispatch({ type: 'undo' }));
    const withRedo = active.current();
    expect(withRedo.canRedo).toBe(true);
    expect(unwrap(active.dispatch({ type: 'set-palette', palette: withRedo.work.palette })).canRedo).toBe(true);
    expect(unwrap(active.dispatch({ type: 'clear-cuts' })).canRedo).toBe(true);
    expect(unwrap(active.dispatch({ type: 'undo' })).canRedo).toBe(true);
    const before = active.current();
    expectFailure(active.dispatch({ type: 'delete-cut', operationId: 'missing' }), 'INVALID_INPUT');
    expect(active.current()).toEqual(before);
    unwrap(active.dispatch({ type: 'redo' }));
    const beforeInvalidMove = active.current();
    expectFailure(active.dispatch({ type: 'update-cut', operationId: 'p1', change: { type: 'translate', dx: 1, dy: 0 } }), 'GEOMETRY_INVALID');
    expect(active.current()).toEqual(beforeInvalidMove);
    const zero = unwrap(active.dispatch({ type: 'update-cut', operationId: 'p1', change: { type: 'translate', dx: 0, dy: 0 } }));
    expect(zero.canUndo).toBe(true);
  });

  it('transforms only parametric cuts, normalizes values and records one undo entry', () => {
    const active = session();
    unwrap(active.dispatch({ type: 'add-parametric-cut', operation: parametric('p1', 0) }));
    const transformed = unwrap(active.dispatch({
      type: 'update-cut', operationId: 'p1',
      change: { type: 'transform-parametric', center: { x: 0.2000004, y: 0.3 }, width: 0.1, height: 0.06, angleDeg: -5 },
    }));
    expect(transformed.work.operations[0]).toMatchObject({ center: { x: 0.2, y: 0.3 }, width: 0.1, height: 0.06, angleDeg: 355 });
    const undone = unwrap(active.dispatch({ type: 'undo' }));
    expect(undone.work.operations[0]).toMatchObject({ width: 0.08, height: 0.08, angleDeg: 0 });
    const redone = unwrap(active.dispatch({ type: 'redo' }));
    expect(redone.work.operations[0]).toMatchObject({ width: 0.1, height: 0.06, angleDeg: 355 });
    const beforeInvalid = active.current();
    expectFailure(active.dispatch({ type: 'update-cut', operationId: 'p1', change: { type: 'transform-parametric', center: { x: 0.2, y: 0.3 }, width: 0.001, height: 0.06, angleDeg: 0 } }), 'GEOMETRY_INVALID');
    expect(active.current()).toEqual(beforeInvalid);
    expectFailure(active.dispatch({ type: 'update-cut', operationId: 'p1', change: { type: 'transform-parametric', center: { x: 0.2, y: 0.3 }, width: 1, height: 0.06, angleDeg: 0 } }), 'GEOMETRY_INVALID');
    expect(active.current()).toEqual(beforeInvalid);
  });

  it('caps incremental history at 30 and preserves structure sharing in history application', () => {
    const active = session();
    for (let index = 0; index < 31; index++) {
      const even = index % 2 === 0;
      unwrap(active.dispatch({ type: 'set-palette', palette: { paper: even ? '#001122' : '#112233', background: '#FFFFFF' } }));
    }
    for (let index = 0; index < 30; index++) unwrap(active.dispatch({ type: 'undo' }));
    expect(active.current().canUndo).toBe(false);
    expect(active.current().work.palette.paper).toBe('#001122');

    const work = fixture();
    const first = parametric('one', 0), second = parametric('two', 1, 'teardrop');
    work.operations = [first, second];
    const after = { ...first, center: { x: 0.21, y: 0.3 } };
    const update: HistoryEntryV2 = { kind: 'update', index: 0, before: first, after };
    const updated = applyHistoryEntryV2(work, update, true);
    expect(updated.operations[1]).toBe(second);
    const clear: HistoryEntryV2 = { kind: 'clear', operations: work.operations };
    expect(applyHistoryEntryV2({ ...work, operations: [] }, clear, false).operations).toBe(work.operations);
  });

  it('isolates frozen inputs, commands and returned values from private session state', () => {
    const work = fixture();
    Object.freeze(work);
    const active = session(work);
    const input = candidate();
    Object.freeze(input); Object.freeze(input.rawPoints);
    const result = unwrap(active.dispatch({ type: 'add-freehand-cut', candidate: input }));
    result.work.operations.splice(0);
    result.work.palette.paper = '#000000';
    expect(active.current().work.operations).toHaveLength(1);
    expect(active.current().work.palette.paper).toBe('#B82025');
    input.rawPoints[0]!.x = 0.4;
    expect(active.current().work.operations[0]).not.toMatchObject({ points: [{ x: 0.4 }] });
  });

  it('classifies unknown versions separately from malformed input', () => {
    expectFailure(core.createSession({ ...fixture(), schemaVersion: 3 } as never), 'UNSUPPORTED_VERSION');
    expectFailure(core.createSession({ ...fixture(), schemaVersion: '3' } as never), 'INVALID_INPUT');
    const active = session();
    expectFailure(active.dispatch({ type: 'add-parametric-cut', operation: { ...parametric('bad', 0), parameterVersion: 3 } } as never), 'UNSUPPORTED_VERSION');
  });
});

describe('duplicate cut', () => {
  it('duplicates each cut kind atomically and supports undo and redo', () => {
    for (const kind of ['parametric', 'freehand', 'brush', 'line'] as const) {
      const active = session();
      if (kind === 'parametric') unwrap(active.dispatch({ type: 'add-parametric-cut', operation: parametric('source', 0) }));
      else if (kind === 'freehand') unwrap(active.dispatch({ type: 'add-freehand-cut', candidate: candidate('source') }));
      else unwrap(active.dispatch({ type: 'add-brush-cut', candidate: brush('source') }));
      const before = active.current().work.operations[0]!;
      const result = unwrap(active.dispatch({ type: 'duplicate-cut', operationId: 'source', newOperationId: 'copy', dx: 0.01, dy: 0.01 }));
      const copy = result.work.operations[1]!;
      expect(result.work.operations[0]).toEqual(before);
      expect(copy.id).toBe('copy'); expect(copy.order).toBe(1);
      if (before.kind === 'parametric' && copy.kind === 'parametric') expect(copy.center).toEqual({ x: 0.21, y: 0.31 });
      else if (before.kind !== 'parametric' && copy.kind !== 'parametric') { expect(copy.points[0]!.x).toBeCloseTo(before.points[0]!.x + 0.01); expect(copy.points[0]!.y).toBeCloseTo(before.points[0]!.y + 0.01); }
      expect(unwrap(active.dispatch({ type: 'undo' })).work.operations).toEqual([before]);
      expect(unwrap(active.dispatch({ type: 'redo' })).work.operations).toEqual(result.work.operations);
      const snapshot = active.current();
      expect(active.dispatch({ type: 'duplicate-cut', operationId: 'source', newOperationId: 'copy', dx: 0, dy: 0 }).ok).toBe(false);
      expect(active.dispatch({ type: 'duplicate-cut', operationId: 'source', newOperationId: 'outside', dx: 2, dy: 2 }).ok).toBe(false);
      expect(active.current()).toEqual(snapshot);
    }
  });
});


describe('duplicate limit rejection', () => {
  it('rejects the template operation limit without changing work or history', () => {
    const original = parametric('source', 0);
    const work = fixture();
    const active = session({ ...work, templateSnapshot: { ...work.templateSnapshot, rules: { ...work.templateSnapshot.rules, maxOperations: 1 } }, operations: [original] });
    const before = active.current();
    expect(active.dispatch({ type: 'duplicate-cut', operationId: 'source', newOperationId: 'copy', dx: .01, dy: .01 }).ok).toBe(false);
    expect(active.current()).toEqual(before);
    expect(unwrap(active.dispatch({ type: 'undo' }))).toEqual(before);
  });
  it('rejects the total point limit without changing work or history', () => {
    const work = fixture();
    const original = unwrap(core.prepareBrushCut(work, brush('source')));
    const constrained = { ...work, editorProfileSnapshot: { ...work.editorProfileSnapshot, maxTotalFreehandPoints: 3, allowedTools: { ...work.editorProfileSnapshot.allowedTools, freehand: { ...work.editorProfileSnapshot.allowedTools.freehand, maxPoints: 3 } } }, operations: [original] };
    const active = session(constrained), before = active.current();
    expect(active.dispatch({ type: 'duplicate-cut', operationId: 'source', newOperationId: 'copy', dx: .01, dy: .01 }).ok).toBe(false);
    expect(active.current()).toEqual(before);
    expect(unwrap(active.dispatch({ type: 'undo' }))).toEqual(before);
  });
});
