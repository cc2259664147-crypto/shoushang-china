import { describe, expect, it } from 'vitest';
import { createFixtureWork, fixtureTime } from '@shoushang/fixtures';
import { createMemoryRepository } from './index';

describe('test-only memory repository', () => {
  it('saves, reads, lists, updates and deletes with optimistic revision checks', async () => {
    const repository = createMemoryRepository({ now: () => fixtureTime });
    const input = createFixtureWork();
    const saved = await repository.save({ work: input, expectedRevision: null });
    expect(saved.ok && saved.value.revision).toBe(1);
    expect(input.revision).toBe(0);
    const collision = await repository.save({ work: input, expectedRevision: null });
    expect(!collision.ok && collision.error.code).toBe('REVISION_CONFLICT');
    if (!saved.ok) throw new Error('save failed');
    saved.value.name = '新名称';
    const read = await repository.read(input.id);
    expect(read.ok && read.value.name).toBe(input.name);
    const updated = await repository.save({ work: saved.value, expectedRevision: 1 });
    expect(updated.ok && updated.value.revision).toBe(2);
    const stale = await repository.delete(input.id, 1);
    expect(!stale.ok && stale.error.code).toBe('REVISION_CONFLICT');
    const rows = await repository.list({ status: 'draft' });
    expect(rows.ok && rows.value.total).toBe(1);
    expect((await repository.delete(input.id, 2)).ok).toBe(true);
    const missing = await repository.read(input.id);
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
  });
  it('injects failures and capacity without discarding existing data', async () => {
    for (const failure of ['STORAGE_UNAVAILABLE', 'QUOTA_EXCEEDED'] as const) {
      const result = await createMemoryRepository({ failure }).save({ work: createFixtureWork(), expectedRevision: null });
      expect(!result.ok && result.error.code).toBe(failure);
    }
    const repository = createMemoryRepository({ maxWorks: 1, now: () => fixtureTime });
    expect((await repository.save({ work: createFixtureWork(), expectedRevision: null })).ok).toBe(true);
    const result = await repository.save({ work: { ...createFixtureWork(), id: 'work-second' }, expectedRevision: null });
    expect(!result.ok && result.error.code).toBe('QUOTA_EXCEEDED');
    const list = await repository.list();
    expect(list.ok && list.value.total).toBe(1);
    const isolated = await createMemoryRepository().list();
    expect(isolated.ok && isolated.value.total).toBe(0);
  });
  it('rejects invalid work, revision and query instead of returning fake success', async () => {
    const repository = createMemoryRepository();
    const result = await repository.save({ work: { ...createFixtureWork(), name: '' }, expectedRevision: null });
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    const list = await repository.list({ page: 0 });
    expect(!list.ok && list.error.code).toBe('INVALID_INPUT');
  });
});
