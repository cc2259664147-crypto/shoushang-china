import { describe, expect, it } from 'vitest';
import {
  EditorProfileV2Schema,
  TemplateVersionV1Schema,
  WorkV2Schema,
  type CutOperationV2,
  type WorkV2,
} from '@shoushang/contracts';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import { createArtworkRendererV2 } from './index';

const renderer = createArtworkRendererV2();
const time = '2026-10-23T00:00:00.000Z';

function work(profileIndex = 0): WorkV2 {
  const entry = profilesDocument.profiles[profileIndex]!;
  const profile = EditorProfileV2Schema.parse(entry.profile);
  const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
  return WorkV2Schema.parse({
    id: `renderer-v2-${profileIndex}`, name: '安全标题', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [],
    status: 'draft', schemaVersion: 2, revision: 0, createdAt: time, updatedAt: time,
  });
}

function freehand(id: string, order: number, points = [
  { x: 0.12, y: 0.2 }, { x: 0.22, y: 0.2 }, { x: 0.22, y: 0.3 }, { x: 0.12, y: 0.3 },
]): CutOperationV2 {
  return { kind: 'freehand', id, order, parameterVersion: 2, points, closed: true };
}

function parametric(id = 'circle', order = 0, shape: 'circle' | 'triangle' | 'teardrop' = 'circle'): Extract<CutOperationV2, { kind: 'parametric' }> {
  return { kind: 'parametric', id, order, parameterVersion: 2, shape, center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0 };
}

function svg(value: WorkV2, view: 'folded' | 'unfolded' = 'unfolded'): string {
  const result = renderer.render({ work: value, width: 400, height: 400, view });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.rendererVersion).toBe(2);
  return result.value.svg;
}

function drawing(outer: string): string {
  const encoded = /href="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(outer)?.[1];
  expect(encoded).toBeTruthy();
  return decodeURIComponent(encoded!);
}

function freezeDeep(value: object): void {
  Object.freeze(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) freezeDeep(nested);
}

describe('artwork renderer v2', () => {
  it('renders deterministic open brush strokes and single-point dots in folded and unfolded masks', () => {
    const value = work();
    value.operations = [
      { kind: 'brush', id: 'line', order: 0, parameterVersion: 2, points: [{ x: 0.12, y: 0.2 }, { x: 0.2, y: 0.28 }, { x: 0.3, y: 0.2 }], width: 0.02 },
      { kind: 'brush', id: 'dot', order: 1, parameterVersion: 2, points: [{ x: 0.2, y: 0.4 }], width: 0.04 },
    ];
    const folded = drawing(svg(value, 'folded'));
    const unfolded = drawing(svg(value));
    const stroke = '<path d="M 0.12 0.2 L 0.2 0.28 L 0.3 0.2" fill="none" stroke="black" stroke-width="0.02" stroke-linecap="round" stroke-linejoin="round"/>';
    const dot = '<circle cx="0.2" cy="0.4" r="0.02" fill="black"/>';
    expect(folded.split(stroke).length - 1).toBe(1);
    expect((unfolded.match(/stroke-linecap="round"/g) ?? [])).toHaveLength(2);
    expect((unfolded.match(/<circle cx="0\.2" cy="0\.4"/g) ?? [])).toHaveLength(2);
    expect(folded).toContain(dot);
    expect(unfolded).toContain('matrix(-1 0 0 1 1 0)');
    expect(svg(value)).toBe(svg(value));
    expect(svg(value)).not.toContain('UNSUPPORTED_VERSION');
  });

  it('unions self-intersecting and overlapping brush with legacy cuts', () => {
    const value = work();
    value.operations = [
      parametric('circle', 0),
      freehand('loop', 1),
      { kind: 'brush', id: 'cross', order: 2, parameterVersion: 2, points: [{ x: 0.12, y: 0.2 }, { x: 0.3, y: 0.35 }, { x: 0.12, y: 0.35 }, { x: 0.3, y: 0.2 }], width: 0.02 },
      { kind: 'brush', id: 'overlap', order: 3, parameterVersion: 2, points: [{ x: 0.15, y: 0.275 }, { x: 0.27, y: 0.275 }], width: 0.03 },
    ];
    const output = drawing(svg(value));
    expect(output).toContain('<ellipse');
    expect(output).toContain(' Z"/>');
    expect((output.match(/stroke="black"/g) ?? [])).toHaveLength(4);
    expect(output).not.toContain('fill-rule="evenodd"');
  });

  it('still rejects brush data that violates the contract or swept geometry', () => {
    const invalidWidth = work();
    invalidWidth.operations = [{ kind: 'brush', id: 'wide', order: 0, parameterVersion: 2, points: [{ x: 0.2, y: 0.2 }], width: 0.121 }];
    const outside = work();
    outside.operations = [{ kind: 'brush', id: 'outside', order: 0, parameterVersion: 2, points: [{ x: 0.061, y: 0.2 }], width: 0.01 }];
    for (const value of [invalidWidth, outside]) {
      const result = renderer.render({ work: value, width: 400, height: 400, view: 'unfolded' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['INVALID_INPUT', 'GEOMETRY_INVALID']).toContain(result.error.code);
    }
  });
  it('renders parametric geometry with the frozen v1 formulas', () => {
    const value = work(); value.operations = [parametric(), parametric('drop', 1, 'teardrop')];
    const triangle = work(1); triangle.operations = [parametric('triangle', 0, 'triangle')];
    const output = drawing(svg(value));
    expect(output).toContain('<ellipse cx="0" cy="0" rx="0.04" ry="0.04"/>');
    expect(output).toContain('C -0.053333 0 -0.053333 0.04 0 0.04');
    expect(drawing(svg(triangle))).toContain('<path d="M 0 -0.04 L -0.04 0.04 L 0.04 0.04 Z"/>');
    expect(output).toContain('matrix(1 0 0 1 0.2 0.3)');
  });

  it('renders deterministic v2 ellipse, rectangle, five-point star and pointed petal paths with rotation and symmetry', () => {
    const value = work();
    const newShapes = ['ellipse', 'rectangle', 'star', 'petal'] as const;
    value.templateSnapshot.allowedCuts = newShapes.map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 }));
    value.editorProfileSnapshot.allowedTools.parametric = [...newShapes];
    value.operations = newShapes.map((shape, order) => ({
      kind: 'parametric', id: shape, order, parameterVersion: 2, shape,
      center: { x: 0.15 + (order % 2) * 0.18, y: 0.22 + Math.floor(order / 2) * 0.28 },
      width: 0.06, height: 0.08, angleDeg: order === 1 ? 30 : 0,
    }));
    const folded = drawing(svg(value, 'folded'));
    const unfolded = drawing(svg(value));
    expect(folded).toContain('<ellipse cx="0" cy="0" rx="0.03" ry="0.04"/>');
    expect(folded).toContain('<path d="M -0.03 -0.04 L 0.03 -0.04 L 0.03 0.04 L -0.03 0.04 Z"/>');
    expect(folded).toContain('<path d="M 0 -0.04 L 0.006735 -0.012361');
    expect(folded).toContain('C -0.03 -0.013333 -0.03 0.013333 0 0.04 C 0.03 0.013333 0.03 -0.013333 0 -0.04 Z');
    expect(folded).toContain('matrix(0.866025 0.5 -0.5 0.866025 0.33 0.22)');
    expect((folded.match(/<g transform="matrix\(1 0 0 1 0 0\)">/g) ?? [])).toHaveLength(4);
    expect((unfolded.match(/matrix\(-1 0 0 1 1 0\)/g) ?? [])).toHaveLength(4);
    expect(svg(value)).toBe(svg(value));
  });

  it('renders deterministic closed freehand paths in folded and reflected views', () => {
    const value = work(); value.operations = [freehand('loop', 0)];
    const before = JSON.stringify(value); freezeDeep(value);
    const folded = drawing(svg(value, 'folded'));
    const unfolded = drawing(svg(value));
    expect(folded).toContain('<path d="M 0.12 0.2 L 0.22 0.2 L 0.22 0.3 L 0.12 0.3 Z"/>');
    expect((folded.match(/<path d="M 0\.12 0\.2/g) ?? []).length).toBe(1);
    expect((unfolded.match(/<path d="M 0\.12 0\.2/g) ?? []).length).toBe(2);
    expect(unfolded).toContain('matrix(-1 0 0 1 1 0)');
    expect(svg(value)).toBe(svg(value));
    expect(JSON.stringify(value)).toBe(before);
  });

  it('uses all radial4 transforms and keeps overlapping loops as black union paths', () => {
    const value = work(2);
    const points = [{ x: 0.62, y: 0.62 }, { x: 0.72, y: 0.62 }, { x: 0.72, y: 0.72 }, { x: 0.62, y: 0.72 }];
    value.operations = [freehand('a', 0, points), freehand('b', 1, points)];
    const output = drawing(svg(value));
    expect(output).toContain('matrix(0 1 -1 0 1 0)');
    expect(output).toContain('matrix(-1 0 0 -1 1 1)');
    expect(output).toContain('matrix(0 -1 1 0 0 1)');
    expect((output.match(/<path d="M 0\.62 0\.62/g) ?? []).length).toBe(8);
    expect(output).not.toContain('fill-rule="evenodd"');
  });

  it('rejects version mismatches, non-finite values, limits, and never emits user text', () => {
    const injected = work(); injected.name = '<script onload=alert(1)>'; injected.templateSnapshot.name = '<foreignObject/>';
    const safe = drawing(svg(injected));
    expect(safe).not.toMatch(/script|onload|foreignObject/);
    for (const mutate of [
      (value: WorkV2) => { (value as unknown as { schemaVersion: number }).schemaVersion = 3; },
      (value: WorkV2) => { (value.templateSnapshot as { geometryVersion: number }).geometryVersion = 3; },
      (value: WorkV2) => { (value.templateSnapshot as { rendererVersion: number }).rendererVersion = 3; },
      (value: WorkV2) => { (value.editorProfileSnapshot as { profileSchemaVersion: number }).profileSchemaVersion = 3; },
      (value: WorkV2) => { (value.editorProfileSnapshot as { geometryVersion: number }).geometryVersion = 3; },
      (value: WorkV2) => { (value.editorProfileSnapshot as { rendererVersion: number }).rendererVersion = 3; },
      (value: WorkV2) => { value.operations = [parametric()]; (value.operations[0] as { parameterVersion: number }).parameterVersion = 3; },
    ]) {
      const value = work(); mutate(value);
      const result = renderer.render({ work: value, width: 400, height: 400, view: 'unfolded' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_VERSION');
    }
    for (const width of [NaN, Infinity, 16_385]) {
      expect(renderer.render({ work: work(), width, height: 400, view: 'unfolded' }).ok).toBe(false);
    }
    const invalid = work(); const invalidOperation = parametric(); invalidOperation.center.x = NaN; invalid.operations = [invalidOperation];
    expect(renderer.render({ work: invalid, width: 400, height: 400, view: 'unfolded' }).ok).toBe(false);
  });

  it('preserves __proto__ as an own field so strict validation rejects it', () => {
    const polluted = work() as WorkV2 & Record<string, unknown>;
    Object.defineProperty(polluted, '__proto__', { value: { injected: true }, enumerable: true });
    const result = renderer.render({ work: polluted, width: 400, height: 400, view: 'unfolded' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    expect((Object.prototype as { injected?: unknown }).injected).toBeUndefined();
  });
});
