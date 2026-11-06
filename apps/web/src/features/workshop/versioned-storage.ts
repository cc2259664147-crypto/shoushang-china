import { WorkV2Schema } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import type {
  EditorProfileRegistryEntryV2,
  Result,
  StorageFailure,
  PublicTemplate,
  WorkV1,
  WorkV2,
} from '@shoushang/contracts';
import {
  openIndexedDbRepository,
  type EditorDraftV2,
  type EditorStep,
  type IndexedDbOptions,
  type IndexedDbRepository,
} from '@shoushang/local-repository';
import { EDITOR_PROFILE_REGISTRY_V2 } from './editor/profiles';

type StoredSource = 'draft' | 'work';

interface WorkshopRecordBase<TWork extends WorkV1 | WorkV2> {
  readonly source: StoredSource;
  readonly work: TWork;
  readonly step: EditorStep;
  readonly draftRevision: number | null;
  readonly baseRevision: number | null;
}

export interface ReadonlyV1WorkshopRecord extends WorkshopRecordBase<WorkV1> {
  readonly kind: 'readonly-v1';
}

export interface EditableV2WorkshopRecord extends WorkshopRecordBase<WorkV2> {
  readonly kind: 'editable-v2';
  readonly historicalMode: 'editable';
}

export interface ReadonlyV2WorkshopRecord extends WorkshopRecordBase<WorkV2> {
  readonly kind: 'readonly-v2';
  readonly historicalMode: 'read-export-only';
}

export type VersionedWorkshopRecord =
  | ReadonlyV1WorkshopRecord
  | EditableV2WorkshopRecord
  | ReadonlyV2WorkshopRecord;

export type V2WorkshopRecord = EditableV2WorkshopRecord | ReadonlyV2WorkshopRecord;

export type OpenIndexedDbRepository = (
  options?: IndexedDbOptions,
) => Promise<Result<IndexedDbRepository, StorageFailure>>;

export interface VersionedWorkshopStorageOptions {
  readonly openIndexedDbRepository?: OpenIndexedDbRepository;
  readonly profileRegistry?: readonly EditorProfileRegistryEntryV2[];
  readonly createId?: () => string;
  readonly now?: () => string;
}

function failure(message: string, path = 'session'): { ok: false; error: StorageFailure } {
  return {
    ok: false,
    error: {
      code: 'INVALID_INPUT',
      message,
      requestId: 'versioned-workshop-storage',
      fieldErrors: [{ path, message }],
    },
  };
}

function parseWork(work: WorkV2): Result<WorkV2, StorageFailure> {
  const parsed = WorkV2Schema.safeParse(work);
  if (!parsed.success) return failure('当前 v2 作品结构无效，未执行保存', 'work');
  return { ok: true, value: parsed.data };
}

function fromV2(
  source: StoredSource,
  work: WorkV2,
  historicalMode: 'editable' | 'read-export-only',
  step: EditorStep,
  draftRevision: number | null,
  baseRevision: number | null,
): EditableV2WorkshopRecord | ReadonlyV2WorkshopRecord {
  const common = { source, work, step, draftRevision, baseRevision } as const;
  return historicalMode === 'editable'
    ? { ...common, kind: 'editable-v2', historicalMode }
    : { ...common, kind: 'readonly-v2', historicalMode };
}

export class VersionedWorkshopStorage {
  private readonly openRepository: OpenIndexedDbRepository;
  private readonly profileRegistry: readonly EditorProfileRegistryEntryV2[];
  private readonly createId: () => string;
  private readonly now: () => string;
  private repository: IndexedDbRepository | null = null;
  private opening: Promise<Result<IndexedDbRepository, StorageFailure>> | null = null;
  private disposed = false;

  constructor(options: VersionedWorkshopStorageOptions = {}) {
    this.openRepository = options.openIndexedDbRepository ?? openIndexedDbRepository;
    this.profileRegistry = options.profileRegistry ?? EDITOR_PROFILE_REGISTRY_V2;
    this.createId = options.createId ?? generateUuid;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createWorkFromTemplate(
    template: PublicTemplate,
  ): Promise<Result<EditableV2WorkshopRecord, StorageFailure>> {
    if (!template.enabled || template.craftId !== 'craft-papercut') {
      return failure('所选剪纸模板不可用于新建作品', 'templateSnapshot');
    }
    const identityMatches = this.profileRegistry.filter(entry =>
      entry.profile.sourceTemplate.id === template.id
      && entry.profile.sourceTemplate.version === template.version,
    );
    if (identityMatches.length === 0) {
      return failure('所选模板缺少匹配的编辑器 profile，无法新建作品', 'editorProfileSnapshot');
    }
    const matches = identityMatches.filter(entry => entry.lifecycle.newWorkEnabled);
    if (matches.length === 0) {
      return failure('所选模板的编辑器 profile 已停用，无法新建作品', 'lifecycle.newWorkEnabled');
    }
    if (matches.length !== 1) {
      return failure('所选模板匹配到多个可新建的编辑器 profile，无法确定唯一配置', 'editorProfileSnapshot');
    }
    const timestamp = this.now();
    const work: WorkV2 = {
      id: this.createId(),
      name: '未命名作品',
      craftId: template.craftId,
      templateSnapshot: structuredClone(template),
      editorProfileSnapshot: structuredClone(matches[0]!.profile),
      palette: {
        paper: template.recommendedColors[0] ?? '#B82025',
        background: '#FFFFEE',
      },
      operations: [],
      status: 'draft',
      schemaVersion: 2,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const parsed = parseWork(work);
    if (!parsed.ok) return parsed;
    const connection = await this.connection();
    if (!connection.ok) return connection;
    const saved = await connection.value.saveV2Draft({
      work: parsed.value,
      step: 'cut',
      expectedDraftRevision: null,
      baseRevision: null,
    });
    if (!saved.ok) return saved;
    return {
      ok: true,
      value: {
        kind: 'editable-v2', historicalMode: 'editable', source: 'draft',
        work: saved.value.work, step: saved.value.step,
        draftRevision: saved.value.revision, baseRevision: saved.value.baseRevision,
      },
    };
  }

  async openWork(workId: string): Promise<Result<VersionedWorkshopRecord, StorageFailure>> {
    const connection = await this.connection();
    if (!connection.ok) return connection;

    const draft = await connection.value.readAnyDraft(workId);
    if (draft.ok) {
      if (draft.value.schemaVersion === 1) {
        return {
          ok: true,
          value: {
            kind: 'readonly-v1', source: 'draft', work: draft.value.work,
            step: draft.value.step, draftRevision: draft.value.revision,
            baseRevision: draft.value.baseRevision,
          },
        };
      }
      return {
        ok: true,
        value: fromV2(
          'draft', draft.value.work, draft.value.historicalMode, draft.value.step,
          draft.value.revision, draft.value.baseRevision,
        ),
      };
    }
    if (draft.error.code !== 'NOT_FOUND') return draft;

    const stored = await connection.value.readAnyWork(workId);
    if (!stored.ok) return stored;
    if (stored.value.schemaVersion === 1) {
      return {
        ok: true,
        value: {
          kind: 'readonly-v1', source: 'work', work: stored.value.work,
          step: 'cut', draftRevision: null, baseRevision: stored.value.work.revision,
        },
      };
    }
    return {
      ok: true,
      value: fromV2(
        'work', stored.value.work, stored.value.historicalMode, 'cut', null,
        stored.value.work.revision,
      ),
    };
  }

  async saveV1AsEditableCopy(
    record: VersionedWorkshopRecord,
  ): Promise<Result<V2WorkshopRecord, StorageFailure>> {
    if (record.kind !== 'readonly-v1') {
      return failure('只有只读 v1 作品可以另存为可编辑副本');
    }
    const connection = await this.connection();
    if (!connection.ok) return connection;
    if (record.source === 'draft') {
      if (record.draftRevision === null) {
        return failure('当前 v1 草稿缺少修订号', 'draftRevision');
      }
      const saved = await connection.value.saveV1DraftAsV2({
        sourceWorkId: record.work.id,
        expectedSourceDraftRevision: record.draftRevision,
        expectedSourceWorkRevision: record.baseRevision,
        newWorkId: this.createId(),
      });
      if (!saved.ok) return saved;
      return this.savedDraftRecord(saved.value);
    }
    const saved = await connection.value.saveV1AsV2({
      sourceWorkId: record.work.id,
      expectedSourceRevision: record.work.revision,
      newWorkId: this.createId(),
      target: 'draft',
      step: record.step,
    });
    if (!saved.ok) return saved;
    if (saved.value.target !== 'draft') return failure('仓储返回了非草稿另存结果');
    return this.savedDraftRecord(saved.value.draft);
  }

  private savedDraftRecord(
    draft: EditorDraftV2,
  ): Result<V2WorkshopRecord, StorageFailure> {
    const savedWork = draft.work;
    const matches = this.profileRegistry.filter(entry =>
      entry.profile.profileId === savedWork.editorProfileSnapshot.profileId
      && entry.profile.profileVersion === savedWork.editorProfileSnapshot.profileVersion,
    );
    if (matches.length !== 1) {
      return failure('另存结果引用的编辑器 profile 不唯一或不存在', 'editorProfileSnapshot');
    }
    const historicalMode = matches[0]!.lifecycle.historicalMode;
    return {
      ok: true,
      value: fromV2(
        'draft', savedWork, historicalMode, draft.step,
        draft.revision, draft.baseRevision,
      ),
    };
  }

  async saveDraft(
    record: VersionedWorkshopRecord,
    work: WorkV2,
    step: EditorStep = record.step,
  ): Promise<Result<EditableV2WorkshopRecord, StorageFailure>> {
    if (record.kind !== 'editable-v2') return failure('当前记录不可编辑，不能保存草稿');
    if (work.id !== record.work.id) return failure('保存作品 ID 与当前会话不一致', 'work.id');
    const parsed = parseWork({ ...work, status: 'draft' });
    if (!parsed.ok) return parsed;
    const connection = await this.connection();
    if (!connection.ok) return connection;
    const saved = await connection.value.saveV2Draft({
      work: parsed.value,
      step,
      expectedDraftRevision: record.draftRevision,
      baseRevision: record.baseRevision,
    });
    if (!saved.ok) return saved;
    return {
      ok: true,
      value: {
        kind: 'editable-v2', historicalMode: 'editable', source: 'draft',
        work: saved.value.work, step: saved.value.step,
        draftRevision: saved.value.revision, baseRevision: saved.value.baseRevision,
      },
    };
  }

  async commitDraft(
    record: VersionedWorkshopRecord,
    thumbnail?: Blob,
  ): Promise<Result<EditableV2WorkshopRecord, StorageFailure>> {
    if (record.kind !== 'editable-v2') return failure('当前记录不可编辑，不能提交草稿');
    if (record.draftRevision === null) return failure('当前会话没有可提交的草稿', 'draftRevision');
    const connection = await this.connection();
    if (!connection.ok) return connection;
    const committed = await connection.value.commitV2Draft({
      workId: record.work.id,
      expectedDraftRevision: record.draftRevision,
      expectedWorkRevision: record.baseRevision,
      ...(thumbnail === undefined ? {} : { thumbnail }),
    });
    if (!committed.ok) return committed;
    return {
      ok: true,
      value: {
        kind: 'editable-v2', historicalMode: 'editable', source: 'work',
        work: committed.value, step: record.step, draftRevision: null,
        baseRevision: committed.value.revision,
      },
    };
  }

  async discardDraft(
    record: VersionedWorkshopRecord,
  ): Promise<Result<{ readonly workId: string }, StorageFailure>> {
    if (record.kind !== 'editable-v2') return failure('当前记录不可编辑，不能丢弃草稿');
    if (record.draftRevision === null) return failure('当前会话没有可丢弃的草稿', 'draftRevision');
    const connection = await this.connection();
    if (!connection.ok) return connection;
    return connection.value.discardV2Draft(record.work.id, record.draftRevision);
  }

  close(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.repository?.close();
    this.repository = null;
    const opening = this.opening;
    this.opening = null;
    if (opening) void opening.then(result => { if (result.ok) result.value.close(); });
  }

  private connection(): Promise<Result<IndexedDbRepository, StorageFailure>> {
    if (this.disposed) return Promise.resolve(failure('存储适配器已关闭'));
    if (this.repository) return Promise.resolve({ ok: true, value: this.repository });
    if (!this.opening) {
      this.opening = this.openRepository({ v2ProfileRegistry: this.profileRegistry }).then(result => {
        this.opening = null;
        if (!result.ok) return result;
        if (this.disposed) {
          result.value.close();
          return failure('存储适配器已关闭');
        }
        this.repository = result.value;
        return result;
      });
    }
    return this.opening;
  }
}
