import { describe, expect, it, vi } from 'vitest';
import {
  EditorProfileRegistryEntryV2Schema,
  PublicTemplateSchema,
  TemplateVersionV1Schema,
  WorkV1Schema,
  WorkV2Schema,
  type Result,
  type StorageFailure,
  type WorkV1,
  type WorkV2,
} from '@shoushang/contracts';
import type {
  EditorDraftV2,
  IndexedDbOptions,
  IndexedDbRepository,
  ValidatedStoredDraft,
  ValidatedStoredWork,
} from '@shoushang/local-repository';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json';
import profileV2C04Document from '../../../../../content/v2-additions-2026-10-27/editor-profile-v2-c04.json';
import templateV2C04Document from '../../../../../content/v2-additions-2026-10-27/template-v2-c04.json';
import { EDITOR_PROFILE_REGISTRY_V2 } from './editor/profiles';
import {
  VersionedWorkshopStorage,
  type EditableV2WorkshopRecord,
  type ReadonlyV1WorkshopRecord,
  type ReadonlyV2WorkshopRecord,
} from './versioned-storage';

const profileEntry = EDITOR_PROFILE_REGISTRY_V2[0]!;
const sourceDocument = profilesDocument.profiles[0]!;
const template = TemplateVersionV1Schema.parse(JSON.parse(sourceDocument.evidence.sourceTemplateCanonicalJcs));

function v1(id = 'work-v1', status: WorkV1['status'] = 'completed'): WorkV1 {
  return WorkV1Schema.parse({
    id, name: 'v1 作品', craftId: template.craftId, templateSnapshot: template,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [], status,
    schemaVersion: 1, revision: status === 'completed' ? 3 : 0,
    createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z',
  });
}

function v2(
  id = 'work-v2',
  status: WorkV2['status'] = 'draft',
  revision = status === 'completed' ? 2 : 0,
): WorkV2 {
  return WorkV2Schema.parse({
    id, name: 'v2 作品', craftId: template.craftId, templateSnapshot: template,
    editorProfileSnapshot: profileEntry.profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [], status,
    schemaVersion: 2, revision,
    createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z',
  });
}

function storageFailure(
  code: StorageFailure['code'],
  message: string = code,
): StorageFailure {
  const common = { message, requestId: 'test', fieldErrors: [] };
  if (code === 'REVISION_CONFLICT') {
    return { ...common, code, expectedRevision: 1, actualRevision: 2 };
  }
  return { ...common, code };
}

const notFound = () => ({ ok: false as const, error: storageFailure('NOT_FOUND') });
const success = <T>(value: T): Result<T, StorageFailure> => ({ ok: true, value });
const rejected = <T>(error: StorageFailure): Result<T, StorageFailure> => ({ ok: false, error });

function mockRepository(overrides: Partial<IndexedDbRepository> = {}): IndexedDbRepository {
  return {
    persistence: 'indexeddb',
    readAnyDraft: vi.fn(async () => notFound()),
    readAnyWork: vi.fn(async () => notFound()),
    saveV1AsV2: vi.fn(),
    saveV1DraftAsV2: vi.fn(),
    saveV2Draft: vi.fn(),
    commitV2Draft: vi.fn(),
    discardV2Draft: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as IndexedDbRepository;
}

function harness(
  repository: IndexedDbRepository,
  createId = () => 'new-v2-id',
  profileRegistry = EDITOR_PROFILE_REGISTRY_V2,
) {
  const open = vi.fn(async (_options?: IndexedDbOptions) => ({ ok: true as const, value: repository }));
  return {
    storage: new VersionedWorkshopStorage({ openIndexedDbRepository: open, createId, profileRegistry }),
    open,
  };
}

function editable(work = v2()): EditableV2WorkshopRecord {
  return {
    kind: 'editable-v2', historicalMode: 'editable', source: 'draft', work,
    step: 'cut', draftRevision: 11, baseRevision: null,
  };
}

describe('formal v2 editor profiles', () => {
  it('strictly parses every JSON profile without dropping profile or lifecycle fields', () => {
    expect(EDITOR_PROFILE_REGISTRY_V2).toHaveLength(profilesDocument.profiles.length + 1);
    profilesDocument.profiles.forEach((entry, index) => {
      const parsed = EditorProfileRegistryEntryV2Schema.parse({ profile: entry.profile, lifecycle: entry.lifecycle });
      expect(EDITOR_PROFILE_REGISTRY_V2[index]).toEqual(parsed);
    });
    expect(EDITOR_PROFILE_REGISTRY_V2.at(-1)).toEqual(EditorProfileRegistryEntryV2Schema.parse({
      profile: profileV2C04Document.profile,
      lifecycle: profileV2C04Document.lifecycle,
    }));
    expect(Object.isFrozen(EDITOR_PROFILE_REGISTRY_V2)).toBe(true);
  });
});

describe('VersionedWorkshopStorage reads', () => {
  it('opens v1 completed and standalone v1 draft as readonly-v1', async () => {
    const completed = v1('completed-v1');
    const completedRepo = mockRepository({
      readAnyWork: vi.fn(async () => success({ schemaVersion: 1, work: completed } satisfies ValidatedStoredWork)),
    });
    const completedResult = await harness(completedRepo).storage.openWork(completed.id);
    expect(completedResult).toMatchObject({ ok: true, value: { kind: 'readonly-v1', source: 'work', draftRevision: null, baseRevision: 3 } });

    const draftWork = v1('draft-v1', 'draft');
    const draft: ValidatedStoredDraft = {
      schemaVersion: 1, workId: draftWork.id, work: draftWork, step: 'preview',
      revision: 7, baseRevision: null, updatedAt: draftWork.updatedAt,
    };
    const draftRepo = mockRepository({ readAnyDraft: vi.fn(async () => success(draft)) });
    const draftResult = await harness(draftRepo).storage.openWork(draftWork.id);
    expect(draftResult).toMatchObject({ ok: true, value: { kind: 'readonly-v1', source: 'draft', step: 'preview', draftRevision: 7 } });
  });

  it('restores editable/read-export-only v2 drafts and completed works', async () => {
    const draftWork = v2('draft-v2');
    const draft: ValidatedStoredDraft = {
      schemaVersion: 2, historicalMode: 'editable', workId: draftWork.id, work: draftWork,
      step: 'save', revision: 8, baseRevision: null, updatedAt: draftWork.updatedAt,
    };
    const draftResult = await harness(mockRepository({
      readAnyDraft: vi.fn(async () => success(draft)),
    })).storage.openWork(draftWork.id);
    expect(draftResult).toMatchObject({ ok: true, value: { kind: 'editable-v2', source: 'draft', draftRevision: 8 } });

    const completed = v2('completed-v2', 'completed', 4);
    const completedResult = await harness(mockRepository({
      readAnyWork: vi.fn(async () => success({ schemaVersion: 2, historicalMode: 'read-export-only', work: completed } satisfies ValidatedStoredWork)),
    })).storage.openWork(completed.id);
    expect(completedResult).toMatchObject({ ok: true, value: { kind: 'readonly-v2', source: 'work', baseRevision: 4 } });
  });

  it('returns unknown or damaged record failures unchanged instead of treating them as absent', async () => {
    const unsupported = storageFailure('UNSUPPORTED_VERSION', 'unknown schema');
    const repository = mockRepository({ readAnyDraft: vi.fn(async () => rejected<ValidatedStoredDraft>(unsupported)) });
    const result = await harness(repository).storage.openWork('unknown-work');
    expect(result).toEqual({ ok: false, error: unsupported });
    expect(repository.readAnyWork).not.toHaveBeenCalled();
  });
});

describe('VersionedWorkshopStorage writes', () => {
  it.each(profilesDocument.profiles.map((entry, index) => [index, entry] as const))(
    'creates formal template %s as one valid v2 draft',
    async (index, entry) => {
      const sourceTemplate = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
      const id = `new-v2-${index}`;
      let captured: WorkV2 | null = null;
      const repository = mockRepository({
        saveV2Draft: vi.fn(async input => {
          captured = input.work;
          return success({
            workId: input.work.id, work: input.work, step: input.step,
            revision: 1, baseRevision: null, updatedAt: input.work.updatedAt,
          });
        }),
      });
      const { storage, open } = harness(repository, () => id);
      const result = await storage.createWorkFromTemplate(sourceTemplate);
      expect(result).toMatchObject({ ok: true, value: { kind: 'editable-v2', work: { id, schemaVersion: 2, revision: 0, status: 'draft', operations: [] } } });
      expect(WorkV2Schema.safeParse(captured).success).toBe(true);
      expect(captured).toMatchObject({
        templateSnapshot: sourceTemplate,
        editorProfileSnapshot: EDITOR_PROFILE_REGISTRY_V2[index]!.profile,
        palette: { paper: sourceTemplate.recommendedColors[0], background: '#FFFFEE' },
      });
      expect(repository.saveV2Draft).toHaveBeenCalledWith({
        work: captured, step: 'cut', expectedDraftRevision: null, baseRevision: null,
      });
      expect(open).toHaveBeenCalledWith({ v2ProfileRegistry: EDITOR_PROFILE_REGISTRY_V2 });
    },
  );

  it('creates the additive seven-shape formal template with its exact profile snapshot', async () => {
    const sourceTemplate = PublicTemplateSchema.parse(templateV2C04Document);
    let captured: WorkV2 | null = null;
    const repository = mockRepository({
      saveV2Draft: vi.fn(async input => {
        captured = input.work;
        return success({ workId: input.work.id, work: input.work, step: input.step, revision: 1, baseRevision: null, updatedAt: input.work.updatedAt });
      }),
    });
    const result = await harness(repository, () => 'new-v2-c04').storage.createWorkFromTemplate(sourceTemplate);
    expect(result).toMatchObject({ ok: true, value: { work: { id: 'new-v2-c04', schemaVersion: 2, operations: [] } } });
    expect(captured).toMatchObject({
      templateSnapshot: sourceTemplate,
      editorProfileSnapshot: profileV2C04Document.profile,
      palette: { paper: sourceTemplate.recommendedColors[0], background: '#FFFFEE' },
    });
  });

  it('rejects missing, disabled, and duplicate eligible profiles before writing', async () => {
    const disabled = [{ ...profileEntry, lifecycle: { ...profileEntry.lifecycle, newWorkEnabled: false } }];
    const cases = [
      { registry: [], message: '缺少匹配' },
      { registry: disabled, message: '已停用' },
      { registry: [profileEntry, structuredClone(profileEntry)], message: '多个' },
    ];
    for (const testCase of cases) {
      const repository = mockRepository();
      const result = await harness(repository, () => 'unused-id', testCase.registry).storage.createWorkFromTemplate(template);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      if (result.ok) throw new Error('expected failure');
      expect(result.error.message).toContain(testCase.message);
      expect(repository.saveV2Draft).not.toHaveBeenCalled();
    }
  });

  it('surfaces digest validation and storage failures without attempting a second record', async () => {
    const error = storageFailure('INVALID_INPUT', '模板快照摘要不匹配');
    const repository = mockRepository({ saveV2Draft: vi.fn(async () => rejected<never>(error)) });
    const result = await harness(repository).storage.createWorkFromTemplate(template);
    expect(result).toEqual({ ok: false, error });
    expect(repository.saveV2Draft).toHaveBeenCalledTimes(1);
  });

  it('prevents v1 from entering v2 saves and saves a v1 completed work as a new editable draft', async () => {
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'work', work: v1(), step: 'cut', draftRevision: null, baseRevision: 3,
    };
    const savedWork = v2('new-v2-id');
    const savedDraft: EditorDraftV2 = {
      workId: savedWork.id, work: savedWork, step: 'cut', revision: 19,
      baseRevision: null, updatedAt: savedWork.updatedAt,
    };
    const repository = mockRepository({
      saveV1AsV2: vi.fn(async () => success({ target: 'draft' as const, draft: savedDraft })),
    });
    const { storage, open } = harness(repository);
    const direct = await storage.saveDraft(source, savedWork);
    expect(direct).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(repository.saveV2Draft).not.toHaveBeenCalled();

    const result = await storage.saveV1AsEditableCopy(source);
    expect(result).toMatchObject({ ok: true, value: { kind: 'editable-v2', work: { id: 'new-v2-id' }, draftRevision: 19 } });
    expect(repository.saveV1AsV2).toHaveBeenCalledWith({
      sourceWorkId: source.work.id, expectedSourceRevision: 3,
      newWorkId: 'new-v2-id', target: 'draft', step: 'cut',
    });
    expect(open).toHaveBeenCalledWith({ v2ProfileRegistry: EDITOR_PROFILE_REGISTRY_V2 });
  });

  it('keeps the original v1 record when save-as fails', async () => {
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'work', work: v1(), step: 'cut', draftRevision: null, baseRevision: 3,
    };
    const before = structuredClone(source);
    const error = storageFailure('QUOTA_EXCEEDED');
    const repository = mockRepository({ saveV1AsV2: vi.fn(async () => rejected<never>(error)) });
    const result = await harness(repository).storage.saveV1AsEditableCopy(source);
    expect(result).toEqual({ ok: false, error });
    expect(source).toEqual(before);
  });

  it('saves a standalone v1 draft through saveV1DraftAsV2 and keeps its draft content', async () => {
    const draftWork = v1('v1-draft-only', 'draft');
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'draft', work: draftWork,
      step: 'preview', draftRevision: 9, baseRevision: null,
    };
    const savedWork = v2('new-v2-id');
    const savedDraft: EditorDraftV2 = {
      workId: savedWork.id, work: savedWork, step: 'preview', revision: 19,
      baseRevision: null, updatedAt: savedWork.updatedAt,
    };
    const repository = mockRepository({
      saveV1DraftAsV2: vi.fn(async () => success(savedDraft)),
    });
    const result = await harness(repository).storage.saveV1AsEditableCopy(source);
    expect(repository.saveV1DraftAsV2).toHaveBeenCalledWith({
      sourceWorkId: 'v1-draft-only', expectedSourceDraftRevision: 9,
      expectedSourceWorkRevision: null, newWorkId: 'new-v2-id',
    });
    expect(repository.saveV1AsV2).not.toHaveBeenCalled();
    expect(repository.readAnyWork).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'editable-v2', source: 'draft', work: { id: 'new-v2-id' },
        step: 'preview', draftRevision: 19, baseRevision: null,
      },
    });
    expect(source.work).toEqual(draftWork);
  });

  it('passes the v1 draft base revision instead of a completed work revision', async () => {
    const draftWork = v1('v1-draft-with-base', 'draft');
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'draft', work: draftWork,
      step: 'cut', draftRevision: 12, baseRevision: 3,
    };
    const savedWork = v2('new-v2-id');
    const savedDraft: EditorDraftV2 = {
      workId: savedWork.id, work: savedWork, step: 'cut', revision: 20,
      baseRevision: 3, updatedAt: savedWork.updatedAt,
    };
    const repository = mockRepository({
      saveV1DraftAsV2: vi.fn(async () => success(savedDraft)),
    });
    const result = await harness(repository).storage.saveV1AsEditableCopy(source);
    expect(repository.saveV1DraftAsV2).toHaveBeenCalledWith({
      sourceWorkId: 'v1-draft-with-base', expectedSourceDraftRevision: 12,
      expectedSourceWorkRevision: 3, newWorkId: 'new-v2-id',
    });
    expect(repository.saveV1AsV2).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { draftRevision: 20, baseRevision: 3 } });
  });

  it('keeps the original v1 draft record when saveV1DraftAsV2 fails', async () => {
    const draftWork = v1('v1-draft-conflict', 'draft');
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'draft', work: draftWork,
      step: 'cut', draftRevision: 9, baseRevision: null,
    };
    const before = structuredClone(source);
    const error = storageFailure('REVISION_CONFLICT');
    const repository = mockRepository({ saveV1DraftAsV2: vi.fn(async () => rejected<never>(error)) });
    const result = await harness(repository).storage.saveV1AsEditableCopy(source);
    expect(result).toEqual({ ok: false, error });
    expect(repository.saveV1AsV2).not.toHaveBeenCalled();
    expect(source).toEqual(before);
  });

  it('uses the matched profile lifecycle for a saved v1 draft', async () => {
    const draftWork = v1('v1-draft-lifecycle', 'draft');
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'draft', work: draftWork,
      step: 'preview', draftRevision: 9, baseRevision: null,
    };
    const savedWork = v2('new-v2-id');
    const savedDraft: EditorDraftV2 = {
      workId: savedWork.id, work: savedWork, step: 'preview', revision: 19,
      baseRevision: null, updatedAt: savedWork.updatedAt,
    };
    const readonlyRegistry = [{
      profile: profileEntry.profile,
      lifecycle: { newWorkEnabled: true, historicalMode: 'read-export-only' as const },
    }];
    const repository = mockRepository({
      saveV1DraftAsV2: vi.fn(async () => success(savedDraft)),
    });
    const result = await harness(repository, () => 'new-v2-id', readonlyRegistry)
      .storage.saveV1AsEditableCopy(source);
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'readonly-v2', historicalMode: 'read-export-only', work: { id: 'new-v2-id' } },
    });
  });

  it('uses the matched profile lifecycle for the save-as result', async () => {
    const source: ReadonlyV1WorkshopRecord = {
      kind: 'readonly-v1', source: 'work', work: v1(), step: 'cut', draftRevision: null, baseRevision: 3,
    };
    const savedWork = v2('new-v2-id');
    const savedDraft: EditorDraftV2 = {
      workId: savedWork.id, work: savedWork, step: 'cut', revision: 19,
      baseRevision: null, updatedAt: savedWork.updatedAt,
    };
    const readonlyRegistry = [{
      profile: profileEntry.profile,
      lifecycle: { newWorkEnabled: true, historicalMode: 'read-export-only' as const },
    }];
    const repository = mockRepository({
      saveV1AsV2: vi.fn(async () => success({ target: 'draft' as const, draft: savedDraft })),
    });
    const result = await harness(repository, () => 'new-v2-id', readonlyRegistry).storage.saveV1AsEditableCopy(source);
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'readonly-v2', historicalMode: 'read-export-only', work: { id: 'new-v2-id' } },
    });
  });

  it('passes current draft/base revisions to save, commit, and discard', async () => {
    const current = editable();
    const edited = WorkV2Schema.parse({ ...current.work, name: '已编辑' });
    const savedDraft: EditorDraftV2 = {
      workId: edited.id, work: edited, step: 'preview', revision: 12,
      baseRevision: null, updatedAt: edited.updatedAt,
    };
    const completed = WorkV2Schema.parse({ ...edited, status: 'completed', revision: 1 });
    const repository = mockRepository({
      saveV2Draft: vi.fn(async () => success(savedDraft)),
      commitV2Draft: vi.fn(async () => success(completed)),
      discardV2Draft: vi.fn(async (workId: string) => success({ workId })),
    });
    const storage = harness(repository).storage;
    const saved = await storage.saveDraft(current, edited, 'preview');
    expect(repository.saveV2Draft).toHaveBeenCalledWith({
      work: edited, step: 'preview', expectedDraftRevision: 11, baseRevision: null,
    });
    expect(saved).toMatchObject({ ok: true, value: { draftRevision: 12, step: 'preview' } });
    if (!saved.ok) throw new Error('expected saved draft');
    const thumbnail = new Blob(['thumbnail'], { type: 'image/png' });
    const committed = await storage.commitDraft(saved.value, thumbnail);
    expect(repository.commitV2Draft).toHaveBeenCalledWith({
      workId: edited.id, expectedDraftRevision: 12, expectedWorkRevision: null, thumbnail,
    });
    expect(committed).toMatchObject({ ok: true, value: { source: 'work', draftRevision: null, baseRevision: 1 } });
    await storage.discardDraft(current);
    expect(repository.discardV2Draft).toHaveBeenCalledWith(edited.id, 11);
  });

  it('turns an editable completed work into a draft without changing its base revision', async () => {
    const completed = v2('existing-v2', 'completed', 4);
    const current: EditableV2WorkshopRecord = {
      kind: 'editable-v2', historicalMode: 'editable', source: 'work', work: completed,
      step: 'cut', draftRevision: null, baseRevision: 4,
    };
    const savedWork = WorkV2Schema.parse({ ...completed, status: 'draft' });
    const savedDraft: EditorDraftV2 = {
      workId: completed.id, work: savedWork, step: 'cut', revision: 21,
      baseRevision: 4, updatedAt: completed.updatedAt,
    };
    const repository = mockRepository({ saveV2Draft: vi.fn(async () => success(savedDraft)) });
    const result = await harness(repository).storage.saveDraft(current, completed);
    expect(repository.saveV2Draft).toHaveBeenCalledWith({
      work: savedWork, step: 'cut', expectedDraftRevision: null, baseRevision: 4,
    });
    expect(result).toMatchObject({ ok: true, value: { source: 'draft', draftRevision: 21, baseRevision: 4 } });
  });

  it('blocks every creative write for read-export-only records', async () => {
    const work = v2('readonly-v2', 'completed', 2);
    const record: ReadonlyV2WorkshopRecord = {
      kind: 'readonly-v2', historicalMode: 'read-export-only', source: 'work', work,
      step: 'cut', draftRevision: 5, baseRevision: 2,
    };
    const repository = mockRepository();
    const storage = harness(repository).storage;
    const results = await Promise.all([
      storage.saveV1AsEditableCopy(record),
      storage.saveDraft(record, work),
      storage.commitDraft(record),
      storage.discardDraft(record),
    ]);
    expect(results.every(result => !result.ok && result.error.code === 'INVALID_INPUT')).toBe(true);
    expect(repository.saveV1AsV2).not.toHaveBeenCalled();
    expect(repository.saveV2Draft).not.toHaveBeenCalled();
    expect(repository.commitV2Draft).not.toHaveBeenCalled();
    expect(repository.discardV2Draft).not.toHaveBeenCalled();
  });

  it('returns revision conflict unchanged and preserves the caller work', async () => {
    const current = editable();
    const edited = WorkV2Schema.parse({ ...current.work, name: '未覆盖的本地编辑' });
    const before = structuredClone(edited);
    const error = storageFailure('REVISION_CONFLICT');
    const repository = mockRepository({ saveV2Draft: vi.fn(async () => rejected<never>(error)) });
    const result = await harness(repository).storage.saveDraft(current, edited);
    expect(result).toEqual({ ok: false, error });
    expect(edited).toEqual(before);
  });

  it('rejects history-bearing work before persistence', async () => {
    const current = editable();
    const tainted = { ...current.work, history: [{ command: 'undo' }], undo: [], redo: [], workerHistory: [] } as unknown as WorkV2;
    const repository = mockRepository();
    const result = await harness(repository).storage.saveDraft(current, tainted);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(repository.saveV2Draft).not.toHaveBeenCalled();
  });

  it('closes the repository exactly once when dispose/close are repeated', async () => {
    const repository = mockRepository();
    const storage = harness(repository).storage;
    await storage.openWork('missing');
    storage.dispose();
    storage.dispose();
    storage.close();
    expect(repository.close).toHaveBeenCalledTimes(1);
  });
});
