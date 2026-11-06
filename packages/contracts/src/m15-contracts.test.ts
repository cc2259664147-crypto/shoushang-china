import { describe, expect, it } from 'vitest';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import v1GoldenWork from '../../../tests/fixtures/m15/v1-work.json';
import {
  AnyWorkSchema,
  EditorProfileLifecycleV2Schema,
  EditorProfileRegistryEntryV2Schema,
  EditorProfileV2Schema,
  FreehandCandidateV2Schema,
  FreehandCutV2Schema,
  ParametricCutV2Schema,
  RawPointV2Schema,
  TemplateVersionV1Schema,
  WorkSchema,
  WorkV2Schema,
  type EditorProfileV2,
  type FreehandCutV2,
  type WorkV2,
} from './index';

const fixtureTime = '2026-10-23T00:00:00.000Z';

function profileAt(index = 0): EditorProfileV2 {
  return EditorProfileV2Schema.parse(profilesDocument.profiles[index]?.profile);
}

function templateFor(profile: EditorProfileV2) {
  const entry = profilesDocument.profiles.find(candidate => candidate.profile.profileId === profile.profileId);
  if (!entry) throw new Error(`Missing profile fixture ${profile.profileId}`);
  return TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
}

function freehand(id: string, order: number, points = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.1 },
  { x: 0.2, y: 0.2 },
]): FreehandCutV2 {
  return { kind: 'freehand', id, order, parameterVersion: 2, points, closed: true };
}

function makeWork(overrides: Partial<WorkV2> = {}): WorkV2 {
  const profile = profileAt();
  const template = templateFor(profile);
  return {
    id: 'work-v2-test',
    name: '专业剪纸',
    craftId: template.craftId,
    templateSnapshot: template,
    editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#FFFFFF' },
    operations: [],
    status: 'draft',
    schemaVersion: 2,
    revision: 0,
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    ...overrides,
  };
}

describe('M15-1 editor v2 contracts', () => {
  it('keeps the v1 golden work valid and separated from v2', () => {
    expect(WorkSchema.safeParse(v1GoldenWork).success).toBe(true);
    expect(WorkV2Schema.safeParse(v1GoldenWork).success).toBe(false);
    expect(AnyWorkSchema.parse(v1GoldenWork).schemaVersion).toBe(1);
  });

  it('parses all approved profiles and keeps lifecycle independent', () => {
    for (const entry of profilesDocument.profiles) {
      expect(EditorProfileV2Schema.safeParse(entry.profile).success).toBe(true);
      expect(EditorProfileLifecycleV2Schema.safeParse(entry.lifecycle).success).toBe(true);
      expect(EditorProfileRegistryEntryV2Schema.safeParse({
        profile: entry.profile,
        lifecycle: entry.lifecycle,
      }).success).toBe(true);
    }
    expect(EditorProfileLifecycleV2Schema.safeParse({ newWorkEnabled: false, historicalMode: 'editable' }).success).toBe(true);
    expect(EditorProfileLifecycleV2Schema.safeParse({ newWorkEnabled: false, historicalMode: 'read-export-only' }).success).toBe(true);
    expect(EditorProfileLifecycleV2Schema.safeParse({ newWorkEnabled: true, historicalMode: 'retired' }).success).toBe(false);
  });

  it('accepts finite out-of-bounds raw candidates but rejects non-finite and oversized input', () => {
    const candidate = { id: 'candidate-1', order: 0, rawPoints: [
      { x: -0.1, y: 0.1 }, { x: 0.5, y: 1.2 }, { x: 1.1, y: -2 },
    ] };
    expect(RawPointV2Schema.safeParse({ x: -10, y: 12 }).success).toBe(true);
    expect(FreehandCandidateV2Schema.safeParse(candidate).success).toBe(true);
    expect(FreehandCandidateV2Schema.safeParse({ ...candidate, rawPoints: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }] }).success).toBe(false);
    expect(FreehandCandidateV2Schema.safeParse({ ...candidate, rawPoints: Array.from({ length: 4097 }, () => ({ x: 0, y: 0 })) }).success).toBe(false);
    expect(FreehandCandidateV2Schema.safeParse({ ...candidate, pressure: 0.5 }).success).toBe(false);
  });

  it('enforces normalized persistent points and implicit closure', () => {
    const valid = freehand('freehand-1', 0);
    expect(FreehandCutV2Schema.safeParse(valid).success).toBe(true);
    expect(FreehandCutV2Schema.safeParse({ ...valid, points: [{ x: 0.1234567, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }] }).success).toBe(false);
    expect(FreehandCutV2Schema.safeParse({ ...valid, points: [{ x: Infinity, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }] }).success).toBe(false);
    expect(FreehandCutV2Schema.safeParse({ ...valid, points: [...valid.points, valid.points[0]] }).success).toBe(false);
    expect(FreehandCutV2Schema.safeParse({ ...valid, points: Array.from({ length: 513 }, (_, index) => ({ x: index / 1000, y: 0.1 })) }).success).toBe(false);
  });

  it('enforces profile and work static limits', () => {
    const profile = profileAt();
    expect(EditorProfileV2Schema.safeParse({ ...profile, profileVersion: 0 }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, geometryVersion: 3 }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, sourceTemplate: { ...profile.sourceTemplate, snapshotSha256: 'A'.repeat(64) } }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, allowedTools: { ...profile.allowedTools, parametric: ['circle', 'circle'] } }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, allowedTools: { ...profile.allowedTools, freehand: { ...profile.allowedTools.freehand, minArea: 0.000009 } } }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, allowedTools: { ...profile.allowedTools, freehand: { ...profile.allowedTools.freehand, minPerimeter: 0.009 } } }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, maxTotalFreehandPoints: 20_001 }).success).toBe(false);
    expect(EditorProfileV2Schema.safeParse({ ...profile, unknown: true }).success).toBe(false);

    const constrained = {
      ...profile,
      allowedTools: { ...profile.allowedTools, freehand: { ...profile.allowedTools.freehand, maxPoints: 3 } },
      maxTotalFreehandPoints: 6,
    };
    const fourPoints = [...freehand('freehand-1', 0).points, { x: 0.1, y: 0.2 }];
    expect(WorkV2Schema.safeParse(makeWork({ editorProfileSnapshot: constrained, operations: [freehand('freehand-1', 0, fourPoints)] })).success).toBe(false);
    expect(WorkV2Schema.safeParse(makeWork({ editorProfileSnapshot: constrained, operations: [
      freehand('freehand-1', 0), freehand('freehand-2', 1), freehand('freehand-3', 2),
    ] })).success).toBe(false);
    expect(WorkV2Schema.safeParse(makeWork({
      editorProfileSnapshot: {
        ...profile,
        allowedTools: { ...profile.allowedTools, parametric: [...profile.allowedTools.parametric, 'triangle'] },
      },
    })).success).toBe(false);
  });

  it('rejects unknown fields, illegal versions, broken ordering and v1/v2 operation mixing', () => {
    const v2 = makeWork({ operations: [freehand('freehand-1', 0)] });
    expect(WorkV2Schema.safeParse(v2).success).toBe(true);
    expect(WorkV2Schema.safeParse({ ...v2, extra: true }).success).toBe(false);
    expect(WorkV2Schema.safeParse({ ...v2, schemaVersion: 3 }).success).toBe(false);
    expect(WorkV2Schema.safeParse({ ...v2, operations: [freehand('same', 0), freehand('same', 1)] }).success).toBe(false);
    expect(WorkV2Schema.safeParse({ ...v2, operations: [freehand('freehand-1', 1)] }).success).toBe(false);

    const v1Operation = {
      id: 'parametric-1', shape: 'circle' as const, center: { x: 0.2, y: 0.2 },
      width: 0.1, height: 0.1, angleDeg: 0, order: 0, parameterVersion: 1 as const,
    };
    expect(WorkV2Schema.safeParse({ ...v2, operations: [v1Operation] }).success).toBe(false);
    expect(WorkSchema.safeParse({ ...v1GoldenWork, operations: [v2.operations[0]] }).success).toBe(false);
    expect(ParametricCutV2Schema.safeParse({ ...v1Operation, kind: 'parametric', parameterVersion: 2 }).success).toBe(true);
    expect(AnyWorkSchema.parse(v2).schemaVersion).toBe(2);
    expect(AnyWorkSchema.safeParse({ ...v2, schemaVersion: 7 }).success).toBe(false);
  });
});
