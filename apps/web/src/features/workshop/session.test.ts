import { afterEach, expect, test, vi } from 'vitest';
import { createMockContentClient } from '@shoushang/content-client';
import type { Result, StorageFailure } from '@shoushang/contracts';
import type { DraftInput, EditorDraft, IndexedDbRepository } from '@shoushang/local-repository';
import { WorkshopSession } from './session';

const sessions: WorkshopSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(saveDraft: (input: DraftInput) => Promise<Result<EditorDraft, StorageFailure>>) {
  const discardDraft = vi.fn(async () => ({ ok: true as const, value: { workId: 'removed' } }));
  const repo = { saveDraft, discardDraft, listDrafts: async () => ({ ok: true as const, value: [] }), inspectRecords: async () => ({ ok: true as const, value: [] }), close: vi.fn() } as unknown as IndexedDbRepository;
  const session = new WorkshopSession(createMockContentClient(), async () => ({ ok: true, value: repo })); sessions.push(session);
  return { session, discardDraft };
}
function saved(input: DraftInput, revision: number): Result<EditorDraft, StorageFailure> { return { ok: true, value: { workId: input.work.id, work: input.work, step: input.step, revision, baseRevision: input.baseRevision, updatedAt: input.work.updatedAt } }; }

test('old save success retains newer edits and uses repository draft revision', async () => {
  const first = deferred<Result<EditorDraft, StorageFailure>>();
  const calls: DraftInput[] = [];
  const { session } = setup(async input => { calls.push(input); return calls.length === 1 ? first.promise : saved(input, 9002); });
  await session.start(); const template = session.snapshot().templates[0]; if (!template) throw new Error('missing fixture template');
  session.newWork(template);
  const pending = session.saveDraft();
  await Promise.resolve();
  const work = session.snapshot().state?.work; if (!work) throw new Error('missing work');
  session.command({ type: 'set-palette', palette: { ...work.palette, paper: '#276B62' } });
  const original = calls[0]; if (!original) throw new Error('missing first call');
  first.resolve(saved(original, 9001)); await pending;
  expect(session.snapshot().status).toBe('编辑中');
  expect(session.snapshot().persistedGeneration).toBeLessThan(session.snapshot().generation);
  await session.saveDraft();
  expect(calls[1]?.expectedDraftRevision).toBe(9001);
  expect(calls[1]?.work.palette.paper).toBe('#276B62');
  expect(session.snapshot().status).toBe('草稿已保存');
});

test('discard waits for the in-flight save and uses its returned revision', async () => {
  const first = deferred<Result<EditorDraft, StorageFailure>>();
  let input: DraftInput | null = null;
  const { session, discardDraft } = setup(async value => { input = value; return first.promise; });
  await session.start(); const template = session.snapshot().templates[0]; if (!template) throw new Error('missing fixture template');
  session.newWork(template);
  const saving = session.saveDraft(); await Promise.resolve();
  const discarding = session.discard();
  if (!input) throw new Error('missing first call');
  first.resolve(saved(input, 8127));
  await saving; await discarding;
  expect(discardDraft).toHaveBeenCalledWith(expect.any(String), 8127);
  expect(session.snapshot().state).toBeNull();
});
