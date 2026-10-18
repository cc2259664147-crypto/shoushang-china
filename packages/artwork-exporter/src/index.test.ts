import { describe, expect, it } from 'vitest';
import { createFixtureWork } from '@shoushang/fixtures';
import type { ArtworkRenderer, Work } from '@shoushang/contracts';
import { createArtworkExporter } from './index';

const blockedRenderer: ArtworkRenderer = { render: () => ({ ok: false, error: { code: 'GEOMETRY_INVALID', message: '测试几何错误', requestId: 'test', fieldErrors: [] } }) };

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
