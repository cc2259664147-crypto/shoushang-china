import { describe, expect, it } from 'vitest';
import { createFixtureWork } from '@shoushang/fixtures';
import { EditorProfileV2Schema, TemplateVersionV1Schema, WorkV2Schema } from '@shoushang/contracts';
import type { ArtworkRenderer, Result, Work, WorkV2 } from '@shoushang/contracts';
import type { ArtworkRendererV2, RenderOutputV2 } from '@shoushang/artwork-renderer';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import { createArtworkExporter, createArtworkExporterV2 } from './index';

const blockedRenderer: ArtworkRenderer = { render: () => ({ ok: false, error: { code: 'GEOMETRY_INVALID', message: '测试几何错误', requestId: 'test', fieldErrors: [] } }) };
const rendererError = { code: 'GEOMETRY_INVALID' as const, message: 'v2几何错误', requestId: 'v2-test', fieldErrors: [] };
const blockedRendererV2: ArtworkRendererV2 = { render: () => ({ ok: false, error: rendererError }) };

function workV2(): WorkV2 {
  const entry = profilesDocument.profiles[0]!;
  const profile = EditorProfileV2Schema.parse(entry.profile);
  const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
  return WorkV2Schema.parse({
    id: 'export-v2', name: '导出测试', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [],
    status: 'draft', schemaVersion: 2, revision: 0,
    createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
  });
}

describe('M08 input and snapshot', () => {
  it.each([
    [{ width: 599 }, 'width'], [{ height: 749 }, 'height'], [{ width: NaN }, 'width'],
    [{ height: Infinity }, 'height'], [{ width: 4097 }, 'width'], [{ width: 4000, height: 4000 }, 'width,height'],
  ])('rejects invalid size %j', async (dimensions, path) => {
    const result = await createArtworkExporter({ renderer: blockedRenderer }).exportCard({ work: createFixtureWork(), ...dimensions });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.code).toBe('INVALID_INPUT'); expect(result.error.fieldErrors[0]?.path).toBe(path); }
  });
  it('preserves renderer geometry error and validates historical version', async () => {
    const work = createFixtureWork();
    work.templateSnapshot.enabled = false;
    const result = await createArtworkExporter({ renderer: blockedRenderer }).exportCard({ work });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GEOMETRY_INVALID');
    const unknown = { ...work, schemaVersion: 9 } as unknown as Work;
    const unsupported = await createArtworkExporter({ renderer: blockedRenderer }).exportCard({ work: unknown });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.error.code).toBe('UNSUPPORTED_VERSION');
  });
  it('renders an independent snapshot without mutating nested frozen input', async () => {
    const work = createFixtureWork();
    Object.freeze(work.palette); Object.freeze(work.operations); Object.freeze(work);
    const received: Work[] = [];
    const renderer: ArtworkRenderer = { render(input) { received.push(input.work); return blockedRenderer.render(input); } };
    await createArtworkExporter({ renderer }).exportCard({ work });
    expect(received[0]).not.toBe(work);
    expect(received[0]?.palette).not.toBe(work.palette);
    expect(work.revision).toBe(0);
  });
});

describe('M15 v2 exporter routing and snapshot', () => {
  it('routes only a strict v2 snapshot to the injected v2 renderer', async () => {
    const original = workV2();
    const received: WorkV2[] = [];
    const renderer: ArtworkRendererV2 = { render(input): Result<RenderOutputV2> {
      received.push(input.work);
      return { ok: false, error: rendererError };
    } };
    const result = await createArtworkExporterV2({ renderer }).exportCard({ work: original });
    expect(result.ok).toBe(false);
    expect(received).toHaveLength(1);
    expect(received[0]).not.toBe(original);
    expect(received[0]?.editorProfileSnapshot).not.toBe(original.editorProfileSnapshot);
    original.palette.paper = '#112233';
    expect(received[0]?.palette.paper).toBe('#B82025');
  });

  it('keeps v1 and v2 exporters separated and preserves renderer errors exactly', async () => {
    const v1InV2 = await createArtworkExporterV2({ renderer: blockedRendererV2 }).exportCard({ work: createFixtureWork() as unknown as WorkV2 });
    expect(v1InV2.ok).toBe(false);
    if (!v1InV2.ok) expect(v1InV2.error.code).toBe('UNSUPPORTED_VERSION');
    const v2InV1 = await createArtworkExporter({ renderer: blockedRenderer }).exportCard({ work: workV2() as unknown as Work });
    expect(v2InV1.ok).toBe(false);
    if (!v2InV1.ok) expect(v2InV1.error.code).toBe('UNSUPPORTED_VERSION');
    const failed = await createArtworkExporterV2({ renderer: blockedRendererV2 }).exportCard({ work: workV2() });
    expect(failed).toEqual({ ok: false, error: rendererError });
    if (!failed.ok) expect(failed.error).toBe(rendererError);
  });

  it('rejects unknown v2 versions before invoking the renderer', async () => {
    let calls = 0;
    const renderer: ArtworkRendererV2 = { render() { calls++; return { ok: false, error: rendererError }; } };
    for (const mutate of [
      (value: WorkV2) => { (value as { schemaVersion: number }).schemaVersion = 3; },
      (value: WorkV2) => { (value.templateSnapshot as { geometryVersion: number }).geometryVersion = 3; },
      (value: WorkV2) => { (value.templateSnapshot as { rendererVersion: number }).rendererVersion = 3; },
      (value: WorkV2) => { (value.editorProfileSnapshot as { profileSchemaVersion: number }).profileSchemaVersion = 3; },
      (value: WorkV2) => { (value.editorProfileSnapshot as { geometryVersion: number }).geometryVersion = 3; },
      (value: WorkV2) => { (value.editorProfileSnapshot as { rendererVersion: number }).rendererVersion = 3; },
      (value: WorkV2) => { value.operations = [{ kind: 'parametric', id: 'bad-version', order: 0, parameterVersion: 3 as 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0 }]; },
    ]) {
      const value = workV2(); mutate(value);
      const result = await createArtworkExporterV2({ renderer }).exportCard({ work: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_VERSION');
    }
    expect(calls).toBe(0);
  });

  it('reports malformed version values as invalid input rather than unsupported versions', async () => {
    for (const mutate of [
      (value: WorkV2) => { (value as unknown as { schemaVersion: unknown }).schemaVersion = '2'; },
      (value: WorkV2) => { (value.templateSnapshot as unknown as { geometryVersion: unknown }).geometryVersion = 1.5; },
      (value: WorkV2) => { (value.editorProfileSnapshot as unknown as { profileSchemaVersion: unknown }).profileSchemaVersion = 0; },
      (value: WorkV2) => { value.operations = [{ kind: 'parametric', id: 'malformed-version', order: 0, parameterVersion: '2' as unknown as 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0 }]; },
    ]) {
      const value = workV2(); mutate(value);
      const result = await createArtworkExporterV2({ renderer: blockedRendererV2 }).exportCard({ work: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});
