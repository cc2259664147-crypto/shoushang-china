import type { ContentClient, CutOperation, PapercutCore, PapercutState, TemplateVersion, Work } from '@shoushang/contracts';
import type { EditorDraft, EditorStep, IndexedDbRepository, RecordIssue } from '@shoushang/local-repository';
import { createPapercutCore } from '@shoushang/papercut-core';
import { openIndexedDbRepository } from '@shoushang/local-repository';

export type SaveStatus = '未开始' | '编辑中' | '保存中' | '草稿已保存' | '作品已保存' | '保存失败' | '恢复中';
export interface Snapshot {
  state: PapercutState | null; step: EditorStep; status: SaveStatus; error: string;
  templates: TemplateVersion[]; templateLoading: boolean; templateError: string;
  drafts: EditorDraft[]; issues: RecordIssue[]; storageError: string;
  generation: number; persistedGeneration: number; draftRevision: number | null; baseRevision: number | null;
}
export class WorkshopSession {
  readonly core: PapercutCore;
  private repo: IndexedDbRepository | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;
  private disposed = false;
  private blocked = false;
  private value: Snapshot = { state: null, step: 'template', status: '未开始', error: '', templates: [], templateLoading: true, templateError: '', drafts: [], issues: [], storageError: '', generation: 0, persistedGeneration: 0, draftRevision: null, baseRevision: null };
  constructor(private readonly content: ContentClient, private readonly open = openIndexedDbRepository, core = createPapercutCore()) { this.core = core; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.value;
  private publish(patch: Partial<Snapshot>) { if (this.disposed) return; this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
  private failure(message: string, conflict = false) { this.blocked = conflict; this.publish({ status: '保存失败', error: message }); }
  private enqueue<T>(task: () => Promise<T>) { const next = this.queue.then(task, task); this.queue = next.then(() => undefined, () => { this.failure('存储操作失败，请重试。'); }); return next; }
  async start() {
    this.disposed = false;
    const ticket = ++this.epoch;
    const [templates, connection] = await Promise.all([this.content.listTemplates({ craftId: 'craft-papercut', pageSize: 50 }), this.open()]);
    if (this.disposed || ticket !== this.epoch) { if (connection.ok) connection.value.close(); return; }
    this.publish({ templateLoading: false, templates: templates.ok ? templates.value.items : [], templateError: templates.ok ? '' : templates.error.message, storageError: connection.ok ? '' : connection.error.message });
    if (!connection.ok) return;
    this.repo = connection.value;
    await this.refreshSaved();
  }
  async refreshTemplates() { this.publish({ templateLoading: true, templateError: '' }); const r = await this.content.listTemplates({ craftId: 'craft-papercut', pageSize: 50 }); if (!this.disposed) this.publish({ templateLoading: false, templates: r.ok ? r.value.items : [], templateError: r.ok ? '' : r.error.message }); }
  async refreshSaved() {
    if (!this.repo) return;
    const [drafts, issues] = await Promise.all([this.repo.listDrafts(), this.repo.inspectRecords()]);
    this.publish({ drafts: drafts.ok ? drafts.value : [], issues: issues.ok ? issues.value : [], storageError: !drafts.ok ? drafts.error.message : !issues.ok ? issues.error.message : '' });
  }
  private install(work: Work, step: EditorStep, draftRevision: number | null, baseRevision: number | null) {
    const checked = this.core.createState(work);
    if (!checked.ok) { this.failure(checked.error.message); return false; }
    this.cancelTimer(); this.epoch++; this.blocked = false;
    this.publish({ state: checked.value, step, draftRevision, baseRevision, generation: 0, persistedGeneration: 0, status: draftRevision === null && work.status === 'completed' ? '作品已保存' : '草稿已保存', error: '' });
    return true;
  }
  newWork(template: TemplateVersion) {
    if (!template.enabled || template.craftId !== 'craft-papercut') { this.failure('此模板目前不可新建作品。'); return false; }
    const now = new Date().toISOString();
    const work: Work = { id: crypto.randomUUID(), name: '未命名作品', craftId: template.craftId, templateSnapshot: structuredClone(template), palette: { paper: template.recommendedColors[0] ?? '#B82025', background: '#FFFFEE' }, operations: [], status: 'draft', schemaVersion: 1, revision: 0, createdAt: now, updatedAt: now };
    const checked = this.core.createState(work);
    if (!checked.ok) { this.failure(`模板暂不支持：${checked.error.message}`); return false; }
    this.cancelTimer(); this.epoch++; this.blocked = false;
    this.publish({ state: checked.value, step: 'color', status: '编辑中', error: '', draftRevision: null, baseRevision: null, generation: 1, persistedGeneration: 0 }); this.schedule();
    return true;
  }
  async restore(id: string) {
    if (!this.repo) { this.failure('存储不可用，无法恢复草稿。'); return false; }
    this.publish({ status: '恢复中', error: '' });
    const r = await this.repo.readDraft(id);
    if (!r.ok) { this.failure(`${r.error.message}；原始记录保留，可导出备份。`); return false; }
    return this.install(r.value.work, r.value.step, r.value.revision, r.value.baseRevision);
  }
  async openCompleted(id: string) {
    if (!this.repo) { this.failure('存储不可用。'); return false; }
    this.publish({ status: '恢复中' });
    const draft = await this.repo.readDraft(id);
    if (draft.ok) return this.install(draft.value.work, draft.value.step, draft.value.revision, draft.value.baseRevision);
    if (draft.error.code !== 'NOT_FOUND') { this.failure(draft.error.message); return false; }
    const r = await this.repo.read(id);
    if (!r.ok) { this.failure(`${r.error.message}；原始记录保留，可导出备份。`); return false; }
    return this.install(r.value, 'cut', null, r.value.revision);
  }
  private changed(state: PapercutState, step = this.value.step) { this.publish({ state, step, generation: this.value.generation + 1, status: '编辑中', error: '' }); this.schedule(); }
  setStep(step: EditorStep) { if (!this.value.state || step === this.value.step) return; this.changed(this.value.state, step); }
  setName(name: string) { const state = this.value.state; if (!state) return; const trimmed = name.trim(); if (!trimmed || trimmed.length > 30) { this.failure('作品名称须为 1–30 个字符。'); return; } this.changed({ ...state, work: { ...state.work, name: trimmed } }); }
  command(command: { type: 'add-cut'; operation: CutOperation } | { type: 'undo' | 'redo' } | { type: 'set-palette'; palette: Work['palette'] }) {
    const state = this.value.state; if (!state) return false;
    const r = this.core.dispatch(state, command);
    if (!r.ok) { this.publish({ error: r.error.message }); return false; }
    if (r.value.work === state.work || JSON.stringify(r.value.work) === JSON.stringify(state.work)) { this.publish({ error: '' }); return true; }
    this.changed(r.value); return true;
  }
  private cancelTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule() { if (this.blocked || !this.repo || this.timer || this.disposed) return; this.timer = setTimeout(() => { this.timer = null; void this.saveDraft(); }, 700); }
  async saveDraft() {
    this.cancelTimer();
    return this.enqueue(async () => {
      const repo = this.repo, state = this.value.state;
      if (!repo || !state || this.blocked || this.value.generation <= this.value.persistedGeneration) return;
      const generation = this.value.generation, epoch = this.epoch, step = this.value.step;
      this.publish({ status: '保存中' });
      const result = await repo.saveDraft({ work: state.work, step, expectedDraftRevision: this.value.draftRevision, baseRevision: this.value.baseRevision });
      if (epoch !== this.epoch || this.disposed) return;
      if (!result.ok) { this.failure(result.error.message, result.error.code === 'REVISION_CONFLICT'); return; }
      const latest = this.value.state;
      this.publish({ draftRevision: result.value.revision, persistedGeneration: generation, state: latest ? { ...latest, work: { ...latest.work, revision: result.value.work.revision, createdAt: result.value.work.createdAt, updatedAt: result.value.work.updatedAt } } : latest, status: generation === this.value.generation ? '草稿已保存' : '编辑中' });
      if (generation < this.value.generation) this.schedule();
      void this.refreshSaved();
    });
  }
  async saveCompleted(thumbnail: (work: Work) => Promise<Blob>) {
    if (!this.repo || !this.value.state) { this.failure('存储不可用，作品仍保留在当前画布。'); return false; }
    while (this.value.generation > this.value.persistedGeneration && !this.blocked) {
      const before = this.value.persistedGeneration;
      await this.saveDraft();
      if (this.value.persistedGeneration === before) break;
    }
    return this.enqueue(async () => {
      const repo = this.repo, state = this.value.state, revision = this.value.draftRevision;
      if (!repo || !state || revision === null || this.blocked || this.value.generation !== this.value.persistedGeneration) return false;
      const epoch = this.epoch, generation = this.value.generation;
      this.publish({ status: '保存中' });
      let blob: Blob;
      try { blob = await thumbnail(state.work); } catch { this.failure('缩略图生成失败；草稿已保留，请重试。'); return false; }
      if (this.epoch !== epoch || this.value.generation !== generation) { this.publish({ status: '编辑中' }); this.schedule(); return false; }
      const r = await repo.commitDraft({ workId: state.work.id, expectedDraftRevision: revision, expectedWorkRevision: this.value.baseRevision, thumbnail: blob });
      if (this.epoch !== epoch || this.disposed) return false;
      if (!r.ok) { this.failure(r.error.message, r.error.code === 'REVISION_CONFLICT'); return false; }
      const current = this.value.state;
      const editedDuringCommit = this.value.generation !== generation;
      this.publish({ state: current ? { ...current, work: editedDuringCommit ? { ...current.work, revision: r.value.revision, createdAt: r.value.createdAt, updatedAt: r.value.updatedAt } : r.value } : current, baseRevision: r.value.revision, draftRevision: null, status: editedDuringCommit ? '编辑中' : '作品已保存', error: '', persistedGeneration: generation });
      if (editedDuringCommit) this.schedule();
      void this.refreshSaved(); return true;
    });
  }
  async discard() {
    this.cancelTimer();
    return this.enqueue(async () => {
      this.epoch++;
      const repo = this.repo, revision = this.value.draftRevision, id = this.value.state?.work.id;
      if (repo && revision !== null && id) { const r = await repo.discardDraft(id, revision); if (!r.ok) { this.failure(r.error.message, r.error.code === 'REVISION_CONFLICT'); return false; } }
      this.blocked = false; this.publish({ state: null, step: 'template', status: '未开始', error: '', generation: 0, persistedGeneration: 0, draftRevision: null, baseRevision: null }); void this.refreshSaved(); return true;
    });
  }
  async fork() {
    const current = this.value.state; if (!current) return false;
    this.cancelTimer(); await this.queue; this.epoch++; this.blocked = false;
    const now = new Date().toISOString();
    const work: Work = { ...current.work, id: crypto.randomUUID(), name: `${current.work.name.slice(0, 27)}副本`, status: 'draft', revision: 0, createdAt: now, updatedAt: now };
    const state = this.core.createState(work); if (!state.ok) { this.failure(state.error.message); return false; }
    this.publish({ state: state.value, draftRevision: null, baseRevision: null, generation: 1, persistedGeneration: 0, status: '编辑中', error: '' }); this.schedule(); return true;
  }
  async downloadBackup() {
    if (!this.repo) return false;
    const result = await this.repo.exportRawBackup(); if (!result.ok) { this.failure(result.error.message); return false; }
    const encode = async (value: unknown): Promise<unknown> => {
      if (value instanceof Blob) return { type: value.type, dataUrl: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(value); }) };
      if (Array.isArray(value)) return Promise.all(value.map(encode));
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encode(item)])));
      return value;
    };
    const blob = new Blob([JSON.stringify(await encode(result.value), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `shoushang-backup-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
  }
  hasUncommitted() { return this.value.state !== null && (this.value.draftRevision !== null || this.value.generation > this.value.persistedGeneration); }
  dispose() { this.disposed = true; this.epoch++; this.cancelTimer(); const repo = this.repo; this.repo = null; void this.queue.finally(() => repo?.close()); this.listeners.clear(); }
}
