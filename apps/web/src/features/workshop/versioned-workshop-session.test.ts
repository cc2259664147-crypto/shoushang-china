import { describe, expect, it, vi } from 'vitest';
import { EditorProfileV2Schema, TemplateVersionV1Schema, WorkV1Schema, WorkV2Schema, type WorkV2 } from '@shoushang/contracts';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json';
import type { EditorWorkerController } from './editor/worker/controller';
import type { EditableV2WorkshopRecord, ReadonlyV1WorkshopRecord, ReadonlyV2WorkshopRecord } from './versioned-storage';
import { VersionedWorkshopStorage } from './versioned-storage';
import { VersionedWorkshopSession, type VersionedWorkshopSessionOptions } from './versioned-workshop-session';

const entry = profilesDocument.profiles[0]!;
const profile = EditorProfileV2Schema.parse(entry.profile);
const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
const work = (id = 'v2-work', revision = 0, status: WorkV2['status'] = 'draft') => WorkV2Schema.parse({
  id, name: '作品', craftId: template.craftId, templateSnapshot: template, editorProfileSnapshot: profile,
  palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [], status, schemaVersion: 2, revision,
  createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z',
});
const editable = (value = work(), draftRevision: number | null = 1): EditableV2WorkshopRecord => ({
  kind: 'editable-v2', historicalMode: 'editable', source: draftRevision === null ? 'work' : 'draft',
  work: value, step: 'cut', draftRevision, baseRevision: value.revision || null,
});

function controller() {
  return {
    initialize: vi.fn(async (_id: string, value: WorkV2) => structuredClone(value)),
    dispose: vi.fn(async () => undefined),
  } as unknown as EditorWorkerController;
}

function harness(
  record: EditableV2WorkshopRecord | ReadonlyV1WorkshopRecord | ReadonlyV2WorkshopRecord,
  overrides: Partial<VersionedWorkshopSessionOptions> = {},
) {
  const controllers: ReturnType<typeof controller>[] = [];
  const storage = {
    openWork: vi.fn(async () => ({ ok: true as const, value: record })),
    saveDraft: vi.fn(async (_record, value: WorkV2) => ({ ok: true as const, value: editable({ ...value, status: 'draft' }, (record.draftRevision ?? 0) + 1) })),
    commitDraft: vi.fn(async (_record, _blob: Blob) => ({ ok: true as const, value: editable({ ...work(record.work.id, 1, 'completed'), operations: _record.work.operations }, null) })),
    saveV1AsEditableCopy: vi.fn(),
    dispose: vi.fn(),
  } as unknown as VersionedWorkshopStorage;
  const session = new VersionedWorkshopSession({
    storage, renderer: { render: vi.fn(() => ({ ok: false as const, error: { code: 'INVALID_INPUT' as const, message: 'unused', requestId: 'test', fieldErrors: [] } })) },
    createController: () => { const value = controller(); controllers.push(value); return value; },
    createThumbnail: async () => new Blob(['png'], { type: 'image/png' }), autoSaveMs: 10,
    createSessionId: () => 'session-id',
    ...overrides,
  });
  return { session, storage, controllers };
}

describe('VersionedWorkshopSession', () => {
  it('creates one controller for editable v2 and serially auto-saves confirmed work', async () => {
    vi.useFakeTimers();
    const { session, storage, controllers } = harness(editable());
    await session.start('v2-work');
    expect(controllers).toHaveLength(1);
    const changed = WorkV2Schema.parse({ ...work(), name: '本地修改' });
    session.confirmed(changed);
    await vi.advanceTimersByTimeAsync(11);
    expect(storage.saveDraft).toHaveBeenCalledTimes(1);
    expect(storage.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ draftRevision: 1 }), changed);
    expect(session.snapshot()).toMatchObject({ status: 'saved', persistedGeneration: 1, currentWork: { name: '本地修改' } });
    await session.dispose();
    vi.useRealTimers();
  });

  it('keeps local work on revision conflict and exposes reload/retry state', async () => {
    const { session, storage } = harness(editable());
    const conflict = { code: 'REVISION_CONFLICT' as const, message: '冲突', requestId: 'test', fieldErrors: [], expectedRevision: 1, actualRevision: 2 };
    vi.mocked(storage.saveDraft).mockResolvedValueOnce({ ok: false, error: conflict });
    await session.start('v2-work');
    const changed = WorkV2Schema.parse({ ...work(), name: '不得丢失' });
    session.confirmed(changed);
    expect(await session.saveNow()).toBe(false);
    expect(session.snapshot()).toMatchObject({ status: 'conflict', currentWork: { name: '不得丢失' } });
    await session.retrySave();
    expect(storage.saveDraft).toHaveBeenCalledTimes(2);
    await session.dispose();
  });

  it('refreshes the latest revision before retrying a conflicted save', async () => {
    const { session, storage } = harness(editable());
    const conflict = { code: 'REVISION_CONFLICT' as const, message: '冲突', requestId: 'test', fieldErrors: [], expectedRevision: 1, actualRevision: 2 };
    vi.mocked(storage.openWork)
      .mockResolvedValueOnce({ ok: true, value: editable() })
      .mockResolvedValueOnce({ ok: true, value: editable(work('v2-work', 5), 2) });
    vi.mocked(storage.saveDraft).mockResolvedValueOnce({ ok: false, error: conflict });
    await session.start('v2-work');
    const changed = WorkV2Schema.parse({ ...work(), name: '不得丢失' });
    session.confirmed(changed);
    expect(await session.saveNow()).toBe(false);
    expect(await session.retrySave()).toBe(true);
    expect(storage.openWork).toHaveBeenCalledTimes(2);
    expect(storage.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ draftRevision: 2 }), expect.objectContaining({ name: '不得丢失' }));
    expect(session.snapshot()).toMatchObject({ status: 'saved', currentWork: { name: '不得丢失' } });
    await session.dispose();
  });

  it('saves the latest draft before committing a ready PNG and recreates the controller', async () => {
    const { session, storage, controllers } = harness(editable(work('v2-work', 2, 'completed'), null));
    await session.start('v2-work');
    expect(await session.commit()).toBe(true);
    expect(storage.saveDraft).toHaveBeenCalledTimes(1);
    expect(storage.commitDraft).toHaveBeenCalledWith(expect.objectContaining({ draftRevision: 1 }), expect.objectContaining({ type: 'image/png' }));
    expect(controllers).toHaveLength(2);
    expect(session.snapshot()).toMatchObject({ status: 'completed', record: { source: 'work' } });
    await session.dispose();
  });

  it('keeps edits confirmed while committing as a pending draft', async () => {
    let markThumbnailStarted!: () => void;
    let releaseThumbnail!: (blob: Blob) => void;
    const thumbnailStarted = new Promise<void>(resolve => { markThumbnailStarted = resolve; });
    const thumbnailBlob = new Promise<Blob>(resolve => { releaseThumbnail = resolve; });
    const { session, storage, controllers } = harness(editable(work('v2-work', 2, 'completed'), null), {
      createThumbnail: () => { markThumbnailStarted(); return thumbnailBlob; },
      autoSaveMs: 1_000_000,
    });
    await session.start('v2-work');
    const committing = session.commit();
    await thumbnailStarted;
    const newer = WorkV2Schema.parse({ ...work(), name: '提交期间的新编辑' });
    session.confirmed(newer);
    releaseThumbnail(new Blob(['png'], { type: 'image/png' }));
    expect(await committing).toBe(true);
    expect(storage.saveDraft).toHaveBeenCalledTimes(1);
    expect(storage.commitDraft).toHaveBeenCalledTimes(1);
    expect(controllers).toHaveLength(1);
    expect(session.snapshot()).toMatchObject({
      status: 'editing', currentWork: { name: '提交期间的新编辑' }, record: { source: 'work' },
    });
    await session.saveNow();
    expect(storage.saveDraft).toHaveBeenCalledTimes(2);
    expect(storage.saveDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ draftRevision: null }),
      expect.objectContaining({ name: '提交期间的新编辑' }),
    );
    await session.dispose();
  });

  it('finishes the commit when the replacement worker fails to initialize', async () => {
    let created = 0;
    const instances: ReturnType<typeof controller>[] = [];
    const { session, storage } = harness(editable(), {
      createController: () => {
        created += 1;
        const value = controller();
        if (created > 1) vi.mocked(value.initialize).mockRejectedValueOnce(new Error('worker 启动失败'));
        instances.push(value);
        return value;
      },
    });
    await session.start('v2-work');
    expect(await session.commit()).toBe(true);
    expect(storage.commitDraft).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
    expect(instances[1]!.dispose).toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ status: 'error', record: { source: 'work' }, currentWork: { id: 'v2-work' } });
    expect(session.snapshot().message).toContain('编辑器重新初始化失败');
    expect(session.snapshot().controller).toBe(instances[0]);
    await session.dispose();
  });

  it('retains the draft and never commits when thumbnail generation fails', async () => {
    const { session, storage } = harness(editable());
    const failing = new VersionedWorkshopSession({
      storage, renderer: { render: vi.fn() }, createController: controller,
      createThumbnail: async () => { throw new Error('编码失败'); },
    });
    await failing.start('v2-work');
    expect(await failing.commit()).toBe(false);
    expect(storage.commitDraft).not.toHaveBeenCalled();
    expect(failing.snapshot().message).toContain('草稿已保留');
    await failing.dispose();
    await session.dispose();
  });

  it('does not create a worker for v1 and routes save-as through storage', async () => {
    const v1 = WorkV1Schema.parse({
      id: 'v1-work', name: '旧版', craftId: template.craftId, templateSnapshot: template,
      palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [], status: 'draft', schemaVersion: 1,
      revision: 0, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z',
    });
    const record: ReadonlyV1WorkshopRecord = { kind: 'readonly-v1', source: 'draft', work: v1, step: 'cut', draftRevision: 4, baseRevision: null };
    const { session, storage, controllers } = harness(record);
    vi.mocked(storage.saveV1AsEditableCopy).mockResolvedValue({ ok: true, value: editable(work('new-v2'), 8) });
    await session.start(v1.id);
    expect(controllers).toHaveLength(0);
    expect(await session.saveV1AsEditableCopy()).toBe('new-v2');
    expect(storage.saveV1AsEditableCopy).toHaveBeenCalledWith(record);
    await session.dispose();
  });

  it('opens read-export-only v2 without creating an editing worker', async () => {
    const value = work('readonly-v2', 3, 'completed');
    const record: ReadonlyV2WorkshopRecord = {
      kind: 'readonly-v2', historicalMode: 'read-export-only', source: 'work', work: value,
      step: 'cut', draftRevision: null, baseRevision: 3,
    };
    const { session, controllers } = harness(record);
    await session.start(value.id);
    expect(controllers).toHaveLength(0);
    expect(session.snapshot()).toMatchObject({ record: { kind: 'readonly-v2' }, controller: null, currentWork: { id: value.id } });
    await session.dispose();
  });
});
