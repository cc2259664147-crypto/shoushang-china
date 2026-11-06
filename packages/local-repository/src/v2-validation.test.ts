import { describe, expect, it } from 'vitest';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import v1GoldenWork from '../../../tests/fixtures/m15/v1-work.json';
import {
  EditorProfileRegistryEntryV2Schema,
  TemplateVersionV1Schema,
  type EditorProfileRegistryEntryV2,
  type WorkV2,
} from '@shoushang/contracts';
import {
  canonicalizeJsonJcs,
  sha256CanonicalJson,
  validateNewOrSaveAsWorkV2,
  validateStoredWork,
} from './v2-validation';

function registry(): EditorProfileRegistryEntryV2[] {
  return profilesDocument.profiles.map(entry => EditorProfileRegistryEntryV2Schema.parse({
    profile: entry.profile,
    lifecycle: entry.lifecycle,
  }));
}

function workV2(index = 0): WorkV2 {
  const entry = registry()[index];
  const evidence = profilesDocument.profiles[index]?.evidence;
  if (!entry || !evidence) throw new Error('missing profile fixture');
  const template = TemplateVersionV1Schema.parse(JSON.parse(evidence.sourceTemplateCanonicalJcs));
  return {
    id: `work-v2-${index}`,
    name: '存储校验作品',
    craftId: template.craftId,
    templateSnapshot: template,
    editorProfileSnapshot: entry.profile,
    palette: { paper: '#B82025', background: '#FFFFFF' },
    operations: [],
    status: 'draft',
    schemaVersion: 2,
    revision: 0,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  };
}

describe('M15-6A JCS and SHA-256 boundary', () => {
  it('matches all three golden template JCS/digests and profile digests', async () => {
    for (const [index, documentEntry] of profilesDocument.profiles.entries()) {
      const work = workV2(index);
      const templateCanonical = canonicalizeJsonJcs(work.templateSnapshot);
      expect(templateCanonical).toEqual({ ok: true, value: documentEntry.evidence.sourceTemplateCanonicalJcs });
      const templateDigest = await sha256CanonicalJson(work.templateSnapshot);
      expect(templateDigest.ok && templateDigest.value).toBe(documentEntry.profile.sourceTemplate.snapshotSha256);
      const profileDigest = await sha256CanonicalJson(registry()[index]!.profile);
      expect(profileDigest.ok && profileDigest.value).toBe(documentEntry.evidence.profileCanonicalSha256);
    }
  });

  it('keeps the digest stable when object key insertion order changes', async () => {
    const original = workV2().templateSnapshot;
    const reversed = Object.fromEntries(Object.entries(original).reverse());
    const first = await sha256CanonicalJson(original);
    const second = await sha256CanonicalJson(reversed);
    expect(first.ok && first.value).toBe(second.ok && second.value);
  });

  it('rejects non-JSON and unsafe JCS inputs', () => {
    const sparse = new Array(2); sparse[1] = true;
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hidden'); } });
    const transparent = new Proxy({ safe: true }, {});
    for (const value of [NaN, Infinity, sparse, cycle, '\ud800', new Date(), hostile, transparent]) {
      const result = canonicalizeJsonJcs(value);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('reports unavailable crypto without leaking its exception', async () => {
    const missing = await sha256CanonicalJson({}, { crypto: null });
    expect(!missing.ok && missing.error).toMatchObject({ code: 'STORAGE_UNAVAILABLE', fieldErrors: [{ path: 'crypto.subtle' }] });
    const rejecting = await sha256CanonicalJson({}, { crypto: { subtle: { digest: async () => { throw new Error('secret stack'); } } } });
    expect(!rejecting.ok && JSON.stringify(rejecting.error)).not.toContain('secret');
  });
});

describe('M15-6A stored work validation', () => {
  it('preserves all M16-G parametric fields across the storage validation boundary', async () => {
    const shapes = ['ellipse', 'rectangle', 'star', 'petal'] as const;
    const source = workV2();
    const template = {
      ...source.templateSnapshot, id: 'm16g-storage-template',
      allowedCuts: shapes.map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 })),
    };
    const digest = await sha256CanonicalJson(template);
    if (!digest.ok) throw new Error(digest.error.message);
    const profile = {
      ...source.editorProfileSnapshot, profileId: 'm16g-storage-profile',
      sourceTemplate: { id: template.id, version: template.version, snapshotSha256: digest.value },
      allowedTools: { ...source.editorProfileSnapshot.allowedTools, parametric: [...shapes] },
    };
    const work: WorkV2 = {
      ...source, id: 'm16g-storage-work', templateSnapshot: template, editorProfileSnapshot: profile,
      operations: shapes.map((shape, order) => ({ kind: 'parametric', id: shape, order, parameterVersion: 2, shape, center: { x: 0.14 + (order % 2) * 0.2, y: 0.22 + Math.floor(order / 2) * 0.3 }, width: 0.05, height: 0.06, angleDeg: 17 })),
    };
    const customRegistry = [EditorProfileRegistryEntryV2Schema.parse({ profile, lifecycle: { newWorkEnabled: true, historicalMode: 'editable' } })];
    const result = await validateStoredWork(JSON.parse(JSON.stringify(work)), customRegistry);
    expect(result).toMatchObject({ ok: true, value: { schemaVersion: 2, work } });
  });

  it('preserves every brush field across the storage validation boundary', async () => {
    const work = workV2();
    work.operations = [{ kind: 'brush', id: 'stored-brush', order: 0, parameterVersion: 2, points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.25 }], width: 0.01 }];
    const before = structuredClone(work);
    const result = await validateStoredWork(JSON.parse(JSON.stringify(work)), registry());
    expect(result).toMatchObject({ ok: true, value: { schemaVersion: 2, work: before } });
    expect(work).toEqual(before);
  });
  it('accepts a valid v1 through the existing v1 core semantics', async () => {
    const result = await validateStoredWork(v1GoldenWork, []);
    expect(result.ok && result.value.schemaVersion).toBe(1);
  });

  it('accepts a valid v2 and returns its editable historical mode', async () => {
    const result = await validateStoredWork(workV2(), registry());
    expect(result.ok && result.value).toMatchObject({ schemaVersion: 2, historicalMode: 'editable' });
  });

  it('restores a disabled historical profile but rejects it for new/save-as', async () => {
    const disabled = registry();
    disabled[0] = { profile: disabled[0]!.profile, lifecycle: { ...disabled[0]!.lifecycle, newWorkEnabled: false } };
    const restored = await validateStoredWork(workV2(), disabled);
    expect(restored.ok && restored.value.schemaVersion === 2 && restored.value.historicalMode).toBe('editable');
    const created = await validateNewOrSaveAsWorkV2(workV2(), disabled);
    expect(!created.ok && created.error).toMatchObject({ code: 'INVALID_INPUT', fieldErrors: [{ path: 'lifecycle.newWorkEnabled' }] });
  });

  it('returns read-export-only for historical profiles configured as read-only', async () => {
    const readOnly = registry();
    readOnly[0] = { profile: readOnly[0]!.profile, lifecycle: { ...readOnly[0]!.lifecycle, historicalMode: 'read-export-only' } };
    const result = await validateStoredWork(workV2(), readOnly);
    expect(result.ok && result.value.schemaVersion === 2 && result.value.historicalMode).toBe('read-export-only');
  });

  it('classifies an unregistered profile as unsupported', async () => {
    const result = await validateStoredWork(workV2(), registry().slice(1));
    expect(!result.ok && result.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('rejects a complete profile snapshot mismatch', async () => {
    const work = workV2();
    work.editorProfileSnapshot = { ...work.editorProfileSnapshot, maxTotalFreehandPoints: 19_999 };
    const result = await validateStoredWork(work, registry());
    expect(!result.ok && result.error).toMatchObject({ code: 'INVALID_INPUT', fieldErrors: [{ path: 'editorProfileSnapshot' }] });
  });

  it('rejects template content tampering by digest', async () => {
    const work = workV2();
    work.templateSnapshot = { ...work.templateSnapshot, name: `${work.templateSnapshot.name}篡改` };
    const result = await validateStoredWork(work, registry());
    expect(!result.ok && result.error).toMatchObject({ code: 'INVALID_INPUT', fieldErrors: [{ path: 'templateSnapshot' }] });
  });

  it('rejects source template id/version mismatches', async () => {
    const work = workV2();
    work.templateSnapshot = { ...work.templateSnapshot, version: 2 };
    const result = await validateStoredWork(work, registry());
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    expect(!result.ok && result.error.fieldErrors.some(error => error.path.includes('sourceTemplate'))).toBe(true);
  });

  it('classifies unknown schema and algorithm versions as unsupported', async () => {
    const schema = await validateStoredWork({ ...workV2(), schemaVersion: 3 }, registry());
    expect(!schema.ok && schema.error.code).toBe('UNSUPPORTED_VERSION');
    const renderer = await validateStoredWork({ ...workV2(), editorProfileSnapshot: { ...workV2().editorProfileSnapshot, rendererVersion: 3 } }, registry());
    expect(!renderer.ok && renderer.error.code).toBe('UNSUPPORTED_VERSION');
    const operation = {
      kind: 'parametric', id: 'cut-version', order: 0, parameterVersion: 3,
      shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0,
    };
    const parameter = await validateStoredWork({ ...workV2(), operations: [operation] }, registry());
    expect(!parameter.ok && parameter.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('does not modify caller input on success or failure', async () => {
    const valid = workV2();
    const validBefore = JSON.stringify(valid);
    await validateStoredWork(valid, registry());
    expect(JSON.stringify(valid)).toBe(validBefore);
    const invalidWork = { ...workV2(), schemaVersion: 3 };
    const invalidBefore = JSON.stringify(invalidWork);
    await validateStoredWork(invalidWork, registry());
    expect(JSON.stringify(invalidWork)).toBe(invalidBefore);
  });

  it('fails v2 restore explicitly when crypto.subtle is unavailable', async () => {
    const result = await validateStoredWork(workV2(), registry(), { crypto: null });
    expect(!result.ok && result.error.code).toBe('STORAGE_UNAVAILABLE');
  });
});
