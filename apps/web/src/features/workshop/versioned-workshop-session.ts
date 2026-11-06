import type { StorageFailure, WorkV2 } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import type { ArtworkRendererV2 } from '@shoushang/artwork-renderer';
import { EditorWorkerController } from './editor/worker/controller';
import type { EditableV2WorkshopRecord, VersionedWorkshopRecord } from './versioned-storage';
import { VersionedWorkshopStorage } from './versioned-storage';

export type VersionedSaveStatus = 'idle' | 'editing' | 'saving' | 'saved' | 'committing' | 'completed' | 'conflict' | 'error';
export interface VersionedWorkshopSnapshot {
  readonly loading: boolean;
  readonly record: VersionedWorkshopRecord | null;
  readonly currentWork: WorkV2 | null;
  readonly controller: EditorWorkerController | null;
  readonly status: VersionedSaveStatus;
  readonly error: StorageFailure | null;
  readonly message: string;
  readonly generation: number;
  readonly persistedGeneration: number;
}

export interface VersionedWorkshopSessionOptions {
  readonly storage: VersionedWorkshopStorage;
  readonly renderer: ArtworkRendererV2;
  readonly createController?: () => EditorWorkerController;
  readonly createSessionId?: () => string;
  readonly createThumbnail?: (work: WorkV2, renderer: ArtworkRendererV2) => Promise<Blob>;
  readonly autoSaveMs?: number;
}

export async function createV2Thumbnail(work: WorkV2, renderer: ArtworkRendererV2): Promise<Blob> {
  const rendered = renderer.render({ work, width: 480, height: 480, view: 'unfolded' });
  if (!rendered.ok) throw new Error(rendered.error.message);
  const url = URL.createObjectURL(new Blob([rendered.value.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建缩略图画布');
    context.drawImage(image, 0, 0, 480, 480);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
      if (value) resolve(value); else reject(new Error('PNG 缩略图编码失败'));
    }, 'image/png'));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class VersionedWorkshopSession {
  private readonly storage: VersionedWorkshopStorage;
  private readonly renderer: ArtworkRendererV2;
  private readonly createController: () => EditorWorkerController;
  private readonly createSessionId: () => string;
  private readonly createThumbnail: (work: WorkV2, renderer: ArtworkRendererV2) => Promise<Blob>;
  private readonly autoSaveMs: number;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;
  private disposed = false;
  private blocked = false;
  private workId = '';
  private value: VersionedWorkshopSnapshot = {
    loading: true, record: null, currentWork: null, controller: null,
    status: 'idle', error: null, message: '', generation: 0, persistedGeneration: 0,
  };

  constructor(options: VersionedWorkshopSessionOptions) {
    this.storage = options.storage;
    this.renderer = options.renderer;
    this.createController = options.createController ?? (() => new EditorWorkerController());
    this.createSessionId = options.createSessionId ?? generateUuid;
    this.createThumbnail = options.createThumbnail ?? createV2Thumbnail;
    this.autoSaveMs = options.autoSaveMs ?? 700;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly snapshot = (): VersionedWorkshopSnapshot => this.value;

  async start(workId: string): Promise<void> {
    this.workId = workId;
    await this.load(workId);
  }

  confirmed(work: WorkV2): void {
    if (this.disposed || this.value.record?.kind !== 'editable-v2' || work.id !== this.value.record.work.id) return;
    this.blocked = false;
    this.publish({ currentWork: structuredClone(work), generation: this.value.generation + 1, status: 'editing', error: null, message: '' });
    this.schedule();
  }

  saveNow(): Promise<boolean> {
    this.cancelTimer();
    return this.enqueue(() => this.persistLatest(true));
  }

  retrySave(): Promise<boolean> {
    this.cancelTimer();
    return this.enqueue(async () => {
      if (this.disposed) return false;
      this.blocked = false;
      const current = this.value.record;
      if (!current || current.kind !== 'editable-v2') return false;
      const opened = await this.storage.openWork(this.workId);
      if (this.disposed) return false;
      if (!opened.ok) { this.fail(opened.error); return false; }
      if (opened.value.kind !== 'editable-v2' || opened.value.work.id !== current.work.id) {
        this.publish({ status: 'error', error: null, message: '数据库中已无对应的可编辑作品，请重新载入。' });
        return false;
      }
      this.publish({ record: opened.value, status: 'editing', error: null, message: '已取得最新版本，正在重试保存…' });
      return this.persistLatest(true, true);
    });
  }

  async reload(): Promise<void> {
    this.blocked = false;
    this.cancelTimer();
    await this.queue;
    await this.load(this.workId);
  }

  async saveV1AsEditableCopy(): Promise<string | null> {
    const record = this.value.record;
    if (!record || record.kind !== 'readonly-v1') return null;
    this.publish({ status: 'saving', error: null, message: '' });
    const result = await this.storage.saveV1AsEditableCopy(record);
    if (this.disposed) return null;
    if (!result.ok) {
      this.publish({ status: result.error.code === 'REVISION_CONFLICT' ? 'conflict' : 'error', error: result.error, message: result.error.message });
      return null;
    }
    this.publish({ record: result.value, currentWork: result.value.work, status: 'saved', message: '已另存为 v2 草稿' });
    return result.value.work.id;
  }

  commit(): Promise<boolean> {
    this.cancelTimer();
    return this.enqueue(async () => {
      if (!await this.persistLatest(true)) return false;
      if (this.disposed) return false;
      const record = this.value.record;
      if (!record || record.kind !== 'editable-v2') return false;
      const commitGeneration = this.value.persistedGeneration;
      this.publish({ status: 'committing', error: null, message: '正在生成缩略图…' });
      let thumbnail: Blob;
      try { thumbnail = await this.createThumbnail(record.work, this.renderer); }
      catch (cause) {
        if (!this.disposed) this.publish({ status: 'error', message: `缩略图生成失败：${cause instanceof Error ? cause.message : '未知错误'}；草稿已保留` });
        return false;
      }
      if (this.disposed) return false;
      const result = await this.storage.commitDraft(record, thumbnail);
      if (this.disposed) return false;
      if (!result.ok) {
        this.fail(result.error);
        return false;
      }
      if (this.value.generation > commitGeneration) {
        this.publish({
          record: result.value, status: 'editing', error: null,
          message: '作品已保存；提交期间的修改将另存为草稿', persistedGeneration: commitGeneration,
        });
        this.schedule();
        return true;
      }
      const replacement = await this.createReplacementController(result.value);
      if (this.disposed) return false;
      if (this.value.generation > commitGeneration) {
        if ('controller' in replacement) await replacement.controller.dispose().catch(() => undefined);
        this.publish({
          record: result.value, status: 'editing', error: null,
          message: '作品已保存；提交期间的修改将另存为草稿', persistedGeneration: commitGeneration,
        });
        this.schedule();
        return true;
      }
      if ('error' in replacement) {
        this.publish({
          record: result.value, currentWork: result.value.work, status: 'error', error: null,
          message: `作品已保存，但编辑器重新初始化失败：${replacement.error}；可继续编辑或重新载入`,
          persistedGeneration: commitGeneration,
        });
        return true;
      }
      const previous = this.value.controller;
      this.publish({
        record: result.value, currentWork: result.value.work, controller: replacement.controller,
        status: 'completed', error: null, message: '作品已保存', persistedGeneration: commitGeneration,
      });
      if (previous) await previous.dispose().catch(() => undefined);
      return true;
    });
  }

  hasUncommitted(): boolean {
    return this.value.record?.kind === 'editable-v2'
      && (this.value.generation > this.value.persistedGeneration || this.value.status === 'saving' || this.value.status === 'conflict');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
    this.cancelTimer();
    const controller = this.value.controller;
    this.listeners.clear();
    if (controller) await controller.dispose().catch(() => undefined);
    this.storage.dispose();
  }

  private async load(workId: string): Promise<void> {
    const ticket = ++this.epoch;
    const oldController = this.value.controller;
    this.publish({ loading: true, record: null, currentWork: null, controller: null, status: 'idle', error: null, message: '', generation: 0, persistedGeneration: 0 });
    if (oldController) await oldController.dispose().catch(() => undefined);
    const opened = await this.storage.openWork(workId);
    if (this.disposed || ticket !== this.epoch) return;
    if (!opened.ok) {
      this.publish({ loading: false, error: opened.error, status: 'error', message: opened.error.message });
      return;
    }
    if (opened.value.kind !== 'editable-v2') {
      this.publish({ loading: false, record: opened.value, currentWork: opened.value.kind === 'readonly-v2' ? opened.value.work : null, status: 'idle' });
      return;
    }
    const controller = this.createController();
    try {
      const confirmed = await controller.initialize(this.createSessionId(), opened.value.work);
      if (this.disposed || ticket !== this.epoch) { await controller.dispose().catch(() => undefined); return; }
      this.publish({ loading: false, record: opened.value, currentWork: confirmed, controller, status: 'saved' });
    } catch (cause) {
      await controller.dispose().catch(() => undefined);
      if (!this.disposed && ticket === this.epoch) this.publish({ loading: false, status: 'error', message: `编辑器初始化失败：${cause instanceof Error ? cause.message : '未知错误'}` });
    }
  }

  private async createReplacementController(
    record: EditableV2WorkshopRecord,
  ): Promise<{ readonly controller: EditorWorkerController } | { readonly error: string }> {
    let controller: EditorWorkerController | null = null;
    try {
      controller = this.createController();
      await controller.initialize(this.createSessionId(), record.work);
    } catch (cause) {
      if (controller) await controller.dispose().catch(() => undefined);
      return { error: cause instanceof Error ? cause.message : '未知错误' };
    }
    if (this.disposed) {
      await controller.dispose().catch(() => undefined);
      return { error: '会话已关闭' };
    }
    return { controller };
  }

  private persistLatest(force: boolean, forceWrite = false): Promise<boolean> {
    const record = this.value.record;
    const work = this.value.currentWork;
    if (!record || record.kind !== 'editable-v2' || !work || this.blocked) return Promise.resolve(false);
    if (!force && this.value.generation <= this.value.persistedGeneration) return Promise.resolve(true);
    if (!forceWrite && this.value.generation <= this.value.persistedGeneration && record.draftRevision !== null) return Promise.resolve(true);
    const generation = this.value.generation;
    this.publish({ status: 'saving', error: null, message: '正在保存草稿…' });
    return this.storage.saveDraft(record, work).then(result => {
      if (this.disposed) return false;
      if (!result.ok) { this.fail(result.error); return false; }
      this.publish({ record: result.value, persistedGeneration: generation, status: generation === this.value.generation ? 'saved' : 'editing', error: null, message: '草稿已保存' });
      if (generation < this.value.generation) this.schedule();
      return true;
    });
  }

  private fail(error: StorageFailure): void {
    this.blocked = error.code === 'REVISION_CONFLICT';
    this.publish({ status: this.blocked ? 'conflict' : 'error', error, message: error.message });
  }

  private schedule(): void {
    if (this.timer || this.disposed || this.blocked) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(() => this.persistLatest(false));
    }, this.autoSaveMs);
  }

  private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
  private publish(patch: Partial<VersionedWorkshopSnapshot>): void {
    if (this.disposed) return;
    this.value = { ...this.value, ...patch };
    this.listeners.forEach(listener => listener());
  }
}
