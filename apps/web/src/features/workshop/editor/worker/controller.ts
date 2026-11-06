import { WorkV2Schema, type PapercutCommandV2, type WorkV2 } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import {
  parseEditorWorkerResponse,
  type EditorWorkerRequest,
  type EditorWorkerResponse,
} from './protocol';

export const EDITOR_RECOVERY_NOTICE = '编辑器已恢复，撤销历史已重置；刚才未确认的操作未保存';

/** 连续恢复尝试上限：Worker 脚本持续失败时不得无限创建 Worker。 */
const MAX_RECOVERY_ATTEMPTS = 5;

export interface EditorWorkSummary {
  readonly operationCount: number;
  readonly freehandPointCount: number;
}

export interface EditorControllerSnapshot {
  readonly lastConfirmedWork: WorkV2 | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly summary: EditorWorkSummary;
  readonly notice: string | null;
}

export interface EditorWorkerLike {
  postMessage(message: EditorWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export type EditorWorkerFactory = () => EditorWorkerLike;
export type EditorControllerListener = (snapshot: EditorControllerSnapshot) => void;

export interface EditorWorkerControllerOptions {
  readonly workerFactory?: EditorWorkerFactory;
  readonly createSessionId?: () => string;
  readonly disposeTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly requestId: number;
  readonly sessionId: string;
  readonly sequence: number;
  readonly kind: EditorWorkerRequest['type'];
  readonly resolve: (response: EditorWorkerResponse) => void;
  readonly reject: (error: Error) => void;
}

interface QueuedDispatch {
  readonly command: PapercutCommandV2;
  readonly resolve: (work: WorkV2) => void;
  readonly reject: (error: Error) => void;
}

function defaultWorkerFactory(): EditorWorkerLike {
  return new Worker(new URL('./papercut.worker.ts', import.meta.url), { type: 'module' });
}

function defaultSessionId(): string {
  return generateUuid();
}

function summarize(work: WorkV2): EditorWorkSummary {
  return {
    operationCount: work.operations.length,
    freehandPointCount: work.operations.reduce(
      (total, operation) => total + (operation.kind === 'freehand' || operation.kind === 'brush' ? operation.points.length : 0),
      0,
    ),
  };
}

function responseError(response: EditorWorkerResponse): Error | null {
  return 'error' in response ? new Error(`${response.error.code}: ${response.error.message}`) : null;
}

export class EditorWorkerController {
  private readonly workerFactory: EditorWorkerFactory;
  private readonly createSessionId: () => string;
  private readonly disposeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private worker: EditorWorkerLike | null = null;
  private sessionId: string | null = null;
  private requestId = 0;
  private sequence = 0;
  private pending: PendingRequest | null = null;
  private dispatchQueue: QueuedDispatch[] = [];
  private idleWaiters: Array<() => void> = [];
  private recovering: Promise<void> | null = null;
  private initialized = false;
  private disposing = false;
  private disposed = false;
  private lastConfirmedWork: WorkV2 | null = null;
  private canUndo = false;
  private canRedo = false;
  private summary: EditorWorkSummary = { operationCount: 0, freehandPointCount: 0 };
  private notice: string | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryAttempts = 0;
  private readonly listeners = new Set<EditorControllerListener>();

  constructor(options: EditorWorkerControllerOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.disposeTimeoutMs = options.disposeTimeoutMs ?? 1_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  snapshot(): EditorControllerSnapshot {
    return {
      lastConfirmedWork: this.lastConfirmedWork ? WorkV2Schema.parse(this.lastConfirmedWork) : null,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      summary: { ...this.summary },
      notice: this.notice,
    };
  }

  subscribe(listener: EditorControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  async initialize(sessionId: string, work: WorkV2): Promise<WorkV2> {
    if (this.initialized || this.worker || this.disposed || this.disposing) throw new Error('控制器不能重复初始化');
    if (!sessionId) throw new Error('sessionId 不能为空');
    const confirmed = WorkV2Schema.parse(work);
    this.sessionId = sessionId;
    this.attachWorker(this.workerFactory());
    const request: EditorWorkerRequest = { type: 'initialize', sessionId, requestId: this.nextRequestId(), work: confirmed };
    const response = await this.send(request, 0);
    const error = responseError(response);
    if (error) {
      this.releaseWorker();
      throw error;
    }
    if (!('work' in response)) throw new Error('initialize 未返回作品');
    this.acceptState(response);
    this.initialized = true;
    return WorkV2Schema.parse(response.work);
  }

  dispatch(command: PapercutCommandV2): Promise<WorkV2> {
    if (this.disposed || this.disposing) throw new Error('编辑会话不可用');
    // 新命令一旦发出，恢复提示即被用户操作取代；否则提示会让后续确认一直被界面丢弃。
    this.notice = null;
    if (this.recovering) {
      // 恢复窗口内不得同步抛错（指针处理会中断）；先排队，新 Worker 就绪后执行。
      return new Promise<WorkV2>((resolve, reject) => {
        this.dispatchQueue.push({ command, resolve, reject });
      });
    }
    if (!this.initialized) return Promise.reject(new Error('编辑会话不可用'));
    return new Promise<WorkV2>((resolve, reject) => {
      this.dispatchQueue.push({ command, resolve, reject });
      this.pumpDispatch();
    });
  }

  async getCurrentWork(): Promise<WorkV2> {
    this.assertUsable();
    await this.waitForDispatchIdle();
    await this.waitForPending();
    this.assertUsable();
    const sessionId = this.sessionId!;
    const request: EditorWorkerRequest = { type: 'get-current-work', sessionId, requestId: this.nextRequestId() };
    const response = await this.send(request, this.sequence);
    const error = responseError(response);
    if (error) throw error;
    if (!('work' in response)) throw new Error('get-current-work 未返回作品');
    this.acceptState(response);
    this.pumpDispatch();
    return WorkV2Schema.parse(response.work);
  }

  async dispose(): Promise<void> {
    if (this.disposed || this.disposing) return;
    this.disposing = true;
    this.cancelDispatches(new Error('编辑会话正在释放'));
    this.rejectPending(new Error('编辑会话正在释放'));
    const worker = this.worker;
    const sessionId = this.sessionId;
    try {
      if (worker && sessionId && this.initialized) {
        const request: EditorWorkerRequest = { type: 'dispose', sessionId, requestId: this.nextRequestId() };
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const response = await Promise.race([
          this.send(request, this.sequence),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('dispose 确认超时')), this.disposeTimeoutMs);
          }),
        ]).finally(() => { if (timeout !== null) clearTimeout(timeout); });
        if (!('disposed' in response) || response.disposed !== true) throw responseError(response) ?? new Error('dispose 未得到确认');
      }
    } finally {
      this.rejectPending(new Error('编辑会话已释放'));
      this.disposed = true;
      this.disposing = false;
      this.initialized = false;
      this.releaseWorker();
      this.sessionId = null;
      this.lastConfirmedWork = null;
      this.canUndo = false;
      this.canRedo = false;
      this.summary = { operationCount: 0, freehandPointCount: 0 };
      this.notice = null;
      this.notify();
      this.listeners.clear();
      this.resolveIdleWaiters();
    }
  }

  private assertUsable(): void {
    if (!this.initialized || this.disposed || this.disposing) throw new Error('编辑会话不可用');
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private attachWorker(worker: EditorWorkerLike): void {
    this.worker = worker;
    worker.onmessage = event => { this.receive(worker, event.data); };
    worker.onerror = () => { this.failWorker(worker, new Error('Worker 运行错误')); };
    worker.onmessageerror = () => { this.failWorker(worker, new Error('Worker 消息反序列化失败')); };
  }

  private releaseWorker(): void {
    if (!this.worker) return;
    const worker = this.worker;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.worker = null;
    this.rejectPending(new Error('Worker 已终止'));
  }

  private armRequestWatchdog(worker: EditorWorkerLike): void {
    this.clearRequestWatchdog();
    this.requestTimer = setTimeout(() => {
      this.requestTimer = null;
      this.failWorker(worker, new Error('Worker 未响应请求（可能已终止）'));
    }, this.requestTimeoutMs);
  }

  private clearRequestWatchdog(): void {
    if (this.requestTimer === null) return;
    clearTimeout(this.requestTimer);
    this.requestTimer = null;
  }

  private send(request: EditorWorkerRequest, expectedSequence: number): Promise<EditorWorkerResponse> {
    const worker = this.worker;
    if (!worker || this.pending) return Promise.reject(new Error('Worker 请求通道忙或不可用'));
    return new Promise<EditorWorkerResponse>((resolve, reject) => {
      this.pending = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        sequence: expectedSequence,
        kind: request.type,
        resolve,
        reject,
      };
      try {
        worker.postMessage(request);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error('Worker postMessage 失败');
        this.rejectPending(error);
        this.failWorker(worker, error);
        return;
      }
      this.armRequestWatchdog(worker);
    });
  }

  private receive(source: EditorWorkerLike, value: unknown): void {
    if (source !== this.worker) return;
    const response = parseEditorWorkerResponse(value);
    if (!response) {
      this.failWorker(source, new Error('Worker 返回损坏数据'));
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    if (response.sessionId !== pending.sessionId || response.requestId !== pending.requestId || response.sequence !== pending.sequence) return;
    this.clearRequestWatchdog();
    this.pending = null;
    pending.resolve(response);
    this.resolveIdleWaiters();
  }

  private pumpDispatch(): void {
    if (!this.initialized || this.disposed || this.disposing || this.recovering || this.pending) return;
    const queued = this.dispatchQueue.shift();
    if (!queued) {
      this.resolveIdleWaiters();
      return;
    }
    const sessionId = this.sessionId!;
    this.sequence += 1;
    const request: EditorWorkerRequest = {
      type: 'dispatch', sessionId, requestId: this.nextRequestId(), sequence: this.sequence, command: queued.command,
    };
    void this.send(request, this.sequence).then(response => {
      const error = responseError(response);
      if (error) queued.reject(error);
      else if ('work' in response) {
        this.acceptState(response);
        queued.resolve(WorkV2Schema.parse(response.work));
      } else queued.reject(new Error('dispatch 未返回作品'));
    }).catch(error => queued.reject(error instanceof Error ? error : new Error('dispatch 失败'))).finally(() => {
      this.pumpDispatch();
      this.resolveIdleWaiters();
    });
  }

  private acceptState(response: Extract<EditorWorkerResponse, { work: WorkV2 }>): void {
    this.lastConfirmedWork = WorkV2Schema.parse(response.work);
    this.canUndo = response.canUndo;
    this.canRedo = response.canRedo;
    this.summary = summarize(response.work);
    this.notify();
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* observers cannot break the session channel */ }
    }
  }

  private waitForDispatchIdle(): Promise<void> {
    if (this.dispatchQueue.length === 0 && this.pending?.kind !== 'dispatch') return Promise.resolve();
    return new Promise(resolve => { this.idleWaiters.push(resolve); });
  }

  private async waitForPending(): Promise<void> {
    while (this.pending) await new Promise<void>(resolve => { this.idleWaiters.push(resolve); });
  }

  private resolveIdleWaiters(): void {
    if (this.pending || this.dispatchQueue.length > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach(resolve => resolve());
  }

  private rejectPending(error: Error): void {
    this.clearRequestWatchdog();
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private cancelDispatches(error: Error): void {
    const queued = this.dispatchQueue;
    this.dispatchQueue = [];
    queued.forEach(item => item.reject(error));
  }

  private failWorker(source: EditorWorkerLike, error: Error): void {
    if (source !== this.worker) return;
    if (this.disposed || this.disposing) {
      this.rejectPending(error);
      this.releaseWorker();
      return;
    }
    const previous = this.recovering;
    this.rejectPending(error);
    this.cancelDispatches(error);
    this.releaseWorker();
    this.canUndo = false;
    this.canRedo = false;
    const confirmed = this.lastConfirmedWork ? WorkV2Schema.parse(this.lastConfirmedWork) : null;
    if (!confirmed || this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      this.initialized = false;
      if (confirmed) {
        this.notice = EDITOR_RECOVERY_NOTICE;
        this.notify();
      }
      this.resolveIdleWaiters();
      return;
    }
    this.recoveryAttempts += 1;
    this.notice = EDITOR_RECOVERY_NOTICE;
    this.initialized = false;
    this.notify();
    // 若故障发生在恢复窗口内，先等上一条恢复链收尾，再重新创建 Worker，避免泄漏或悬挂。
    const run = previous === null
      ? this.recover(confirmed)
      : previous.then(() => this.recover(confirmed));
    let chain: Promise<void>;
    chain = run.catch(() => {
      if (this.recovering !== chain) return;
      this.initialized = false;
      this.cancelDispatches(new Error('编辑器恢复失败'));
      this.releaseWorker();
    }).finally(() => {
      if (this.recovering !== chain) return;
      this.recovering = null;
      this.pumpDispatch();
      this.resolveIdleWaiters();
    });
    this.recovering = chain;
  }

  private async recover(work: WorkV2): Promise<void> {
    this.sessionId = this.createSessionId();
    this.requestId = 0;
    this.sequence = 0;
    this.attachWorker(this.workerFactory());
    const request: EditorWorkerRequest = {
      type: 'initialize', sessionId: this.sessionId, requestId: this.nextRequestId(), work,
    };
    const response = await this.send(request, 0);
    const error = responseError(response);
    if (error || !('work' in response)) {
      this.releaseWorker();
      throw error ?? new Error('恢复初始化失败');
    }
    if (this.disposed || this.disposing) return;
    this.acceptState(response);
    this.canUndo = false;
    this.canRedo = false;
    this.recoveryAttempts = 0;
    this.initialized = true;
  }
}
