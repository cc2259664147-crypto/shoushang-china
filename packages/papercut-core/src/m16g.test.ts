import { describe, expect, it } from 'vitest';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import { WorkV2Schema, type ParametricCutV2, type Result, type WorkV2 } from '@shoushang/contracts';
import { createPapercutCoreV2, getWorkGeometryV2 } from './index';

const entry = profilesDocument.profiles[0]!;
const shapes = ['ellipse', 'rectangle', 'star', 'petal'] as const;
const limits = shapes.map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 }));

function work(): WorkV2 {
  const template = { ...JSON.parse(entry.evidence.sourceTemplateCanonicalJcs), id: 'm16g-template', allowedCuts: limits };
  const profile = {
    ...entry.profile, profileId: 'm16g-profile',
    sourceTemplate: { ...entry.profile.sourceTemplate, id: template.id },
    allowedTools: { ...entry.profile.allowedTools, parametric: [...shapes] },
  };
  return WorkV2Schema.parse({
    id: 'm16g-core', name: 'M16-G Core', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [],
    status: 'draft', schemaVersion: 2, revision: 0,
    createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
  });
}

function operation(shape: typeof shapes[number], order = 0, patch: Partial<ParametricCutV2> = {}): ParametricCutV2 {
  return { kind: 'parametric', id: `${shape}-${order}`, order, parameterVersion: 2, shape, center: { x: 0.25, y: 0.3 }, width: 0.08, height: 0.12, angleDeg: 0, ...patch };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('M16-G v2 parametric geometry', () => {
  it('emits deterministic ellipse, rectangle, five-point star and pointed petal geometry', () => {
    const value = work();
    value.operations = shapes.map((shape, order) => operation(shape, order, { center: { x: 0.15 + (order % 2) * 0.18, y: 0.22 + Math.floor(order / 2) * 0.28 }, width: 0.06, height: 0.08 }));
    const geometry = unwrap(getWorkGeometryV2(value));
    expect(geometry.cuts[0]!.localShape).toEqual({ kind: 'ellipse', radiusX: 0.03, radiusY: 0.04 });
    expect(geometry.cuts[1]!.localShape).toEqual({ kind: 'polygon', vertices: [
      { x: -0.03, y: -0.04 }, { x: 0.03, y: -0.04 }, { x: 0.03, y: 0.04 }, { x: -0.03, y: 0.04 },
    ] });
    const star = geometry.cuts[2]!.localShape;
    expect(star.kind).toBe('polygon');
    if (star.kind === 'polygon') {
      expect(star.vertices).toHaveLength(10);
      expect(star.vertices[0]!.x).toBeCloseTo(0, 12);
      expect(star.vertices[0]!.y).toBeCloseTo(-0.04, 12);
    }
    const petal = geometry.cuts[3]!.localShape;
    expect(petal.kind).toBe('cubic-loop');
    if (petal.kind === 'cubic-loop') {
      expect(petal.curves).toHaveLength(2);
      expect(petal.curves[0]![0]).toEqual({ x: 0, y: -0.04 });
      expect(petal.curves[0]![3]).toEqual({ x: 0, y: 0.04 });
      expect(petal.curves[1]![3]).toEqual({ x: 0, y: -0.04 });
    }
    expect(geometry.symmetryTransforms).toHaveLength(2);
  });

  it('rotates every new shape through the common placement matrix', () => {
    for (const shape of shapes) {
      const value = work(); value.operations = [operation(shape, 0, { angleDeg: 30 })];
      const placement = unwrap(getWorkGeometryV2(value)).cuts[0]!.placement;
      expect(placement.a).toBeCloseTo(Math.cos(Math.PI / 6), 12);
      expect(placement.b).toBeCloseTo(0.5, 12);
      expect(placement.c).toBeCloseTo(-0.5, 12);
      expect(placement.d).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    }
  });

  it('validates size, allowed region, folded domain, paper gap and symmetry expansion', () => {
    const invalid: WorkV2[] = [];
    const size = work(); size.operations = [operation('ellipse', 0, { width: 0.21 })]; invalid.push(size);
    const region = work(); region.operations = [operation('rectangle', 0, { center: { x: 0.42, y: 0.3 }, width: 0.08 })]; invalid.push(region);
    const domain = work(); domain.templateSnapshot.geometry.allowedRegion = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]; domain.operations = [operation('star', 0, { center: { x: 0.49, y: 0.3 } })]; invalid.push(domain);
    const gap = work(); gap.templateSnapshot.geometry.allowedRegion = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]; gap.operations = [operation('petal', 0, { center: { x: 0.03, y: 0.3 }, width: 0.06 })]; invalid.push(gap);
    for (const [index, value] of invalid.entries()) {
      const result = getWorkGeometryV2(value);
      expect(result.ok, `invalid case ${index}`).toBe(false);
      if (!result.ok) expect(['INVALID_INPUT', 'GEOMETRY_INVALID']).toContain(result.error.code);
    }
  });

  it('rejects missing template or profile authorization and accepts Worker/session dispatch when both allow', () => {
    const profileDenied = work(); profileDenied.editorProfileSnapshot.allowedTools.parametric = ['ellipse']; profileDenied.operations = [operation('star')];
    expect(getWorkGeometryV2(profileDenied).ok).toBe(false);
    const templateDenied = work(); templateDenied.templateSnapshot.allowedCuts = templateDenied.templateSnapshot.allowedCuts.filter(limit => limit.shape !== 'star'); templateDenied.operations = [operation('star')];
    expect(getWorkGeometryV2(templateDenied).ok).toBe(false);

    const active = unwrap(createPapercutCoreV2().createSession(work()));
    for (const [order, shape] of shapes.entries()) {
      const state = unwrap(active.dispatch({ type: 'add-parametric-cut', operation: operation(shape, order, { center: { x: 0.15 + (order % 2) * 0.18, y: 0.22 + Math.floor(order / 2) * 0.28 }, width: 0.05, height: 0.06 }) }));
      expect(state.work.operations.at(-1)).toMatchObject({ kind: 'parametric', shape });
    }
  });

  it('continues to accept the historical v2 shape semantics unchanged', () => {
    const historical = WorkV2Schema.parse({
      ...work(),
      templateSnapshot: JSON.parse(entry.evidence.sourceTemplateCanonicalJcs),
      editorProfileSnapshot: entry.profile,
      operations: [{ kind: 'parametric', id: 'old-circle', order: 0, parameterVersion: 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.1, angleDeg: 17 }],
    });
    const geometry = unwrap(getWorkGeometryV2(historical));
    expect(geometry.cuts[0]!.localShape).toEqual({ kind: 'ellipse', radiusX: 0.04, radiusY: 0.05 });
  });
});
