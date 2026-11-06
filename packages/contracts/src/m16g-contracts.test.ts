import { describe, expect, it } from 'vitest';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import {
  CutShapeSchema,
  CutShapeV2Schema,
  EditorProfileV2Schema,
  ParametricCutV2Schema,
  TemplateSnapshotV2Schema,
  TemplateVersionV1Schema,
  WorkSchema,
  WorkV2Schema,
} from './index';

const entry = profilesDocument.profiles[0]!;
const historicalTemplate = JSON.parse(entry.evidence.sourceTemplateCanonicalJcs) as Record<string, unknown>;
const newShapes = ['ellipse', 'rectangle', 'star', 'petal'] as const;
const allowedCuts = newShapes.map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.3, minHeight: 0.02, maxHeight: 0.3 }));
const template = { ...historicalTemplate, id: 'm16g-template', allowedCuts };
const profile = {
  ...entry.profile,
  profileId: 'm16g-profile',
  sourceTemplate: { ...entry.profile.sourceTemplate, id: 'm16g-template' },
  allowedTools: { ...entry.profile.allowedTools, parametric: [...newShapes] },
};
const base = {
  id: 'm16g-work', name: 'M16-G', craftId: historicalTemplate.craftId,
  templateSnapshot: template, editorProfileSnapshot: profile,
  palette: { paper: '#B82025', background: '#F2D9A6' },
  operations: [], status: 'draft', schemaVersion: 2, revision: 0,
  createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
};

describe('M16-G v2 parametric contracts', () => {
  it('parses all four new shapes through operation, template, profile and WorkV2', () => {
    expect(CutShapeV2Schema.options).toEqual(['circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal']);
    expect(TemplateSnapshotV2Schema.safeParse(template).success).toBe(true);
    expect(EditorProfileV2Schema.safeParse(profile).success).toBe(true);
    for (const [order, shape] of newShapes.entries()) {
      const operation = { kind: 'parametric', id: shape, order, parameterVersion: 2, shape, center: { x: 0.25, y: 0.3 }, width: 0.08, height: 0.1, angleDeg: 27 };
      expect(ParametricCutV2Schema.safeParse(operation).success).toBe(true);
    }
    const operations = newShapes.map((shape, order) => ({ kind: 'parametric' as const, id: shape, order, parameterVersion: 2 as const, shape, center: { x: 0.25, y: 0.3 + order * 0.12 }, width: 0.04, height: 0.05, angleDeg: order * 15 }));
    expect(WorkV2Schema.safeParse({ ...base, operations }).success).toBe(true);
  });

  it('does not widen the historical v1 shape, template or work contracts', () => {
    for (const shape of newShapes) expect(CutShapeSchema.safeParse(shape).success).toBe(false);
    expect(TemplateVersionV1Schema.safeParse(template).success).toBe(false);
    expect(WorkSchema.safeParse({ ...base, schemaVersion: 1, operations: [{ id: 'ellipse', order: 0, parameterVersion: 1, shape: 'ellipse', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.1, angleDeg: 0 }] }).success).toBe(false);
    expect(TemplateVersionV1Schema.safeParse(historicalTemplate).success).toBe(true);
  });

  it('rejects non-finite dimensions and unauthorized new shapes', () => {
    const operation = { kind: 'parametric', id: 'new-shape', order: 0, parameterVersion: 2, shape: 'ellipse', center: { x: 0.25, y: 0.3 }, width: 0.08, height: 0.1, angleDeg: 0 };
    for (const patch of [{ width: NaN }, { height: Infinity }, { angleDeg: NaN }, { width: 0 }, { height: 1.1 }]) {
      expect(ParametricCutV2Schema.safeParse({ ...operation, ...patch }).success).toBe(false);
    }
    const historicalProfile = EditorProfileV2Schema.parse(entry.profile);
    const historicalSnapshot = TemplateVersionV1Schema.parse(historicalTemplate);
    expect(WorkV2Schema.safeParse({ ...base, templateSnapshot: historicalSnapshot, editorProfileSnapshot: historicalProfile, operations: [operation] }).success).toBe(false);
  });
});
