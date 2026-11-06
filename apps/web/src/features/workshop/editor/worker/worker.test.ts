import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  EditorProfileV2Schema,
  TemplateVersionV1Schema,
  WorkV2Schema,
  type PapercutCommandV2,
  type WorkV2,
} from '@shoushang/contracts';
import profilesDocument from '../../../../../../../docs/qa/m15/editor-profiles-v2.json';
import {
  EDITOR_RECOVERY_NOTICE,
  EditorWorkerController,
  type EditorWorkerLike,
} from './controller';
import { parseEditorWorkerRequest, parseEditorWorkerResponse, type EditorWorkerRequest, type EditorWorkerResponse } from './protocol';
import { EditorWorkerRuntime } from './runtime';

const time = '2026-10-23T00:00:00.000Z';

function workFixture(profileIndex = 0): WorkV2 {
  const entry = profilesDocument.profiles[profileIndex]!;
  const profile = EditorProfileV2Schema.parse(entry.profile);
  const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
  return WorkV2Schema.parse({
    id: `worker-work-${profileIndex}`, name: 'Worker 测试', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [],
    status: 'draft', schemaVersion: 2, revision: 0, createdAt: time, updatedAt: time,
  });
}

function addCircle(id: string, order: number): PapercutCommandV2 {
  return {
    type: 'add-parametric-cut',
    operation: { kind: 'parametric', id, order, parameterVersion: 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0 },
  };
}

function extendedShapeWork(): WorkV2 {
  const value = workFixture();
  const shapes = ['ellipse', 'rectangle', 'star', 'petal'] as const;
  value.templateSnapshot.allowedCuts = shapes.map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 }));
  value.editorProfileSnapshot.allowedTools.parametric = [...shapes];
  return WorkV2Schema.parse(value);
}

function initialize(runtime: EditorWorkerRuntime, work = workFixture(), requestId = 1, sessionId = 'session-a'): EditorWorkerResponse {
  return runtime.handle({ type: 'initialize', sessionId, requestId, work });
}

class FakeWorker implements EditorWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly runtime = new EditorWorkerRuntime();
  readonly posted: EditorWorkerRequest[] = [];
  readonly replies: EditorWorkerResponse[] = [];
  terminated = false;
  autoReply = true;
  throwOnPost = false;

  postMessage(message: EditorWorkerRequest): void {
    if (this.throwOnPost) throw new Error('simulated terminated worker');
    this.posted.push(message);
    const response = this.runtime.handle(structuredClone(message));
    this.replies.push(response);
    if (this.autoReply) queueMicrotask(() => this.emit(response));
  }

  terminate(): void { this.terminated = true; }

  /** 外部终止：不触发任何事件，请求会永远等不到响应。 */
  killSilently(): void {
    this.terminated = true;
    this.autoReply = false;
    this.throwOnPost = true;
  }

  flush(index = 0): void {
    const response = this.replies[index];
    if (!response) throw new Error(`missing fake response ${index}`);
    this.emit(response);
  }

  emit(value: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: value }));
  }

  crash(kind: 'error' | 'messageerror'): void {
    if (kind === 'error') this.onerror?.(new Event('error') as ErrorEvent);
    else this.onmessageerror?.(new MessageEvent('messageerror'));
  }
}

function controllerHarness(autoReply = true, disposeTimeoutMs = 1_000, requestTimeoutMs?: number) {
  const workers: FakeWorker[] = [];
  let recovered = 0;
  const controller = new EditorWorkerController({
    workerFactory: () => {
      const worker = new FakeWorker();
      worker.autoReply = autoReply;
      workers.push(worker);
      return worker;
    },
    createSessionId: () => `recovered-${++recovered}`,
    disposeTimeoutMs,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
  return { controller, workers };
}

interface TrackedPromise {
  readonly settled: () => boolean;
  readonly outcome: () => 'pending' | 'resolved' | 'rejected';
}

function track<T>(promise: Promise<T>): TrackedPromise {
  let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
  void promise.then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
  return { settled: () => outcome !== 'pending', outcome: () => outcome };
}

async function settle(): Promise<void> {
  await vi.waitFor(() => { expect(true).toBe(true); });
}

describe('Worker runtime protocol', () => {
  it('accepts all M16-G parameterized shapes through the existing Worker command', () => {
    const runtime = new EditorWorkerRuntime();
    initialize(runtime, extendedShapeWork());
    for (const [order, shape] of (['ellipse', 'rectangle', 'star', 'petal'] as const).entries()) {
      const request = {
        type: 'dispatch' as const, sessionId: 'session-a', requestId: order + 2, sequence: order + 1,
        command: {
          type: 'add-parametric-cut' as const,
          operation: { kind: 'parametric' as const, id: shape, order, parameterVersion: 2 as const, shape, center: { x: 0.14 + (order % 2) * 0.2, y: 0.22 + Math.floor(order / 2) * 0.3 }, width: 0.05, height: 0.06, angleDeg: 15 },
        },
      };
      expect(parseEditorWorkerRequest(request)).toEqual(request);
      expect(runtime.handle(request)).toMatchObject({ sequence: order + 1, work: { operations: expect.arrayContaining([expect.objectContaining({ shape })]) } });
    }
  });

  it('accepts a strict brush command and rejects extra fields', () => {
    const request = {
      type: 'dispatch', sessionId: 'session-a', requestId: 2, sequence: 1,
      command: { type: 'add-brush-cut', candidate: { id: 'brush', order: 0, rawPoints: [{ x: 0.2, y: 0.2 }], width: 0.01 } },
    };
    expect(parseEditorWorkerRequest(request)).toEqual(request);
    expect(parseEditorWorkerRequest({ ...request, command: { ...request.command, extra: true } })).toBeNull();
    expect(parseEditorWorkerRequest({ ...request, command: { ...request.command, candidate: { ...request.command.candidate, extra: true } } })).toBeNull();
    const runtime = new EditorWorkerRuntime();
    initialize(runtime);
    const response = runtime.handle(request);
    expect(response).toMatchObject({ sequence: 1, canUndo: true, work: { operations: [{ kind: 'brush', width: 0.01 }] } });
  });
  it('accepts strict parametric transforms and rejects nested extra fields', () => {
    const command: PapercutCommandV2 = {
      type: 'update-cut', operationId: 'cut-1',
      change: { type: 'transform-parametric', center: { x: 0.2, y: 0.3 }, width: 0.1, height: 0.08, angleDeg: 15 },
    };
    const request = { type: 'dispatch' as const, sessionId: 'session-a', requestId: 2, sequence: 1, command };
    expect(parseEditorWorkerRequest(request)).toEqual(request);
    expect(parseEditorWorkerRequest({ ...request, command: { ...command, change: { ...command.change, extra: true } } })).toBeNull();
    expect(parseEditorWorkerRequest({ ...request, command: { ...command, change: { ...command.change, center: { x: 0.2, y: 0.3, extra: true } } } })).toBeNull();
  });
  it('initializes, dispatches, gets current work and disposes without exposing history', () => {
    const runtime = new EditorWorkerRuntime();
    const first = initialize(runtime);
    expect(first).toMatchObject({ sessionId: 'session-a', requestId: 1, sequence: 0, canUndo: false, canRedo: false });
    const dispatched = runtime.handle({ type: 'dispatch', sessionId: 'session-a', requestId: 2, sequence: 1, command: addCircle('cut-1', 0) });
    expect(dispatched).toMatchObject({ sequence: 1, canUndo: true, canRedo: false });
    const current = runtime.handle({ type: 'get-current-work', sessionId: 'session-a', requestId: 3 });
    expect('work' in current && current.work.operations).toHaveLength(1);
    expect(runtime.handle({ type: 'dispose', sessionId: 'session-a', requestId: 4 })).toEqual({
      sessionId: 'session-a', requestId: 4, sequence: 1, disposed: true,
    });
    expect(runtime.handle({ type: 'get-current-work', sessionId: 'session-a', requestId: 5 })).toMatchObject({ error: { code: 'DISPOSED' } });
    for (const response of [first, dispatched, current]) {
      expect(Object.keys(response)).not.toContain('undo');
      expect(Object.keys(response)).not.toContain('redo');
      expect(Object.keys(response)).not.toContain('history');
      expect(JSON.stringify(response)).not.toMatch(/"(?:undo|redo|history)"\s*:/);
    }
  });

  it('rejects duplicate/out-of-order requestId, sequence and old sessions', () => {
    const runtime = new EditorWorkerRuntime();
    initialize(runtime);
    expect(runtime.handle({ type: 'get-current-work', sessionId: 'session-a', requestId: 1 })).toMatchObject({ error: { code: 'REQUEST_ORDER' } });
    expect(runtime.handle({ type: 'dispatch', sessionId: 'session-a', requestId: 2, sequence: 2, command: { type: 'undo' } })).toMatchObject({ error: { code: 'SEQUENCE_ORDER' } });
    expect(runtime.handle({ type: 'dispatch', sessionId: 'session-a', requestId: 3, sequence: 1, command: { type: 'undo' } })).toMatchObject({ sequence: 1 });
    expect(runtime.handle({ type: 'dispatch', sessionId: 'session-a', requestId: 4, sequence: 1, command: { type: 'undo' } })).toMatchObject({ error: { code: 'SEQUENCE_ORDER' } });
    expect(runtime.handle({ type: 'get-current-work', sessionId: 'old-session', requestId: 99 })).toMatchObject({ error: { code: 'SESSION_MISMATCH' } });
  });

  it('keeps Work unchanged and consumes sequence when core rejects a command', () => {
    const runtime = new EditorWorkerRuntime();
    const initial = initialize(runtime);
    const rejected = runtime.handle({ type: 'dispatch', sessionId: 'session-a', requestId: 2, sequence: 1, command: { type: 'delete-cut', operationId: 'missing' } });
    expect(rejected).toMatchObject({ sequence: 1, error: { code: 'INVALID_INPUT' } });
    if (!('work' in initial) || !('work' in rejected)) throw new Error('expected state-bearing responses');
    expect(rejected.work).toEqual(initial.work);
    expect(runtime.handle({ type: 'dispatch', sessionId: 'session-a', requestId: 3, sequence: 2, command: addCircle('cut-1', 0) })).toMatchObject({ sequence: 2 });
  });

  it('strictly rejects damaged requests and responses', () => {
    const runtime = new EditorWorkerRuntime();
    expect(() => runtime.handle({ type: 'initialize', sessionId: 's', requestId: 1, work: { schemaVersion: 2 } })).toThrow(/损坏/);
    const valid = initialize(runtime);
    expect(parseEditorWorkerResponse({ ...valid, history: [] })).toBeNull();
    expect(parseEditorWorkerResponse({ ...valid, work: { schemaVersion: 2 } })).toBeNull();
  });
});

describe('main-thread Worker controller', () => {
  it('serializes commands and waits for the queue before getCurrentWork', async () => {
    const { controller, workers } = controllerHarness(false);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    const first = controller.dispatch(addCircle('cut-1', 0));
    const second = controller.dispatch(addCircle('cut-2', 1));
    const current = controller.getCurrentWork();
    expect(workers[0]!.posted.filter(request => request.type === 'dispatch')).toHaveLength(1);
    workers[0]!.flush(1);
    await first;
    await settle();
    expect(workers[0]!.posted.filter(request => request.type === 'dispatch')).toHaveLength(2);
    workers[0]!.flush(2);
    await second;
    await settle();
    expect(workers[0]!.posted.at(-1)?.type).toBe('get-current-work');
    workers[0]!.flush(3);
    expect((await current).operations).toHaveLength(2);
    expect(workers[0]!.posted.filter(request => request.type === 'dispatch').map(request => request.type === 'dispatch' ? request.sequence : -1)).toEqual([1, 2]);
  });

  it('ignores old-session and wrong-sequence responses without overwriting confirmed Work', async () => {
    const { controller, workers } = controllerHarness(false);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    const dispatched = controller.dispatch(addCircle('cut-1', 0));
    const valid = workers[0]!.replies[1]!;
    workers[0]!.emit({ ...valid, sessionId: 'old-session' });
    workers[0]!.emit({ ...valid, sequence: 99 });
    expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(0);
    workers[0]!.flush(1);
    await dispatched;
    expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1);
  });

  it('does not change lastConfirmedWork when core rejects a command', async () => {
    const { controller } = controllerHarness();
    await controller.initialize('session-a', workFixture());
    const before = controller.snapshot().lastConfirmedWork;
    await expect(controller.dispatch({ type: 'delete-cut', operationId: 'missing' })).rejects.toThrow('INVALID_INPUT');
    expect(controller.snapshot().lastConfirmedWork).toEqual(before);
  });

  it.each(['error', 'messageerror'] as const)('recovers from %s, clears history and never replays unconfirmed commands', async kind => {
    const { controller, workers } = controllerHarness();
    await controller.initialize('session-a', workFixture());
    await controller.dispatch(addCircle('confirmed', 0));
    workers[0]!.autoReply = false;
    const unconfirmed = controller.dispatch(addCircle('unconfirmed', 1));
    workers[0]!.crash(kind);
    await expect(unconfirmed).rejects.toThrow();
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await vi.waitFor(() => expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1));
    expect(controller.snapshot()).toMatchObject({ canUndo: false, canRedo: false, notice: EDITOR_RECOVERY_NOTICE });
    expect(workers[1]!.posted.filter(request => request.type === 'dispatch')).toHaveLength(0);
    expect(workers[1]!.posted[0]).toMatchObject({ type: 'initialize', work: controller.snapshot().lastConfirmedWork });
  });

  it('recovers from damaged Worker data and an abnormal postMessage termination', async () => {
    const damaged = controllerHarness();
    await damaged.controller.initialize('session-a', workFixture());
    damaged.workers[0]!.emit({ sessionId: 'session-a', requestId: 404, sequence: 0, history: [] });
    await vi.waitFor(() => expect(damaged.workers).toHaveLength(2));
    expect(damaged.controller.snapshot().notice).toBe(EDITOR_RECOVERY_NOTICE);

    const terminated = controllerHarness();
    await terminated.controller.initialize('session-b', workFixture());
    terminated.workers[0]!.throwOnPost = true;
    await expect(terminated.controller.dispatch({ type: 'undo' })).rejects.toThrow('simulated terminated worker');
    await vi.waitFor(() => expect(terminated.workers).toHaveLength(2));
    expect(terminated.controller.snapshot().notice).toBe(EDITOR_RECOVERY_NOTICE);
  });

  it('invalidates late responses after recovery and dispose, then releases references', async () => {
    const { controller, workers } = controllerHarness();
    await controller.initialize('session-a', workFixture());
    const oldResponse = workers[0]!.replies[0]!;
    workers[0]!.crash('error');
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[0]!.emit({ ...oldResponse, work: { ...workFixture(), name: '迟到作品' } });
    expect(controller.snapshot().lastConfirmedWork?.name).toBe('Worker 测试');
    await controller.dispose();
    workers[1]!.emit(oldResponse);
    expect(controller.snapshot()).toMatchObject({ lastConfirmedWork: null, canUndo: false, canRedo: false });
    expect(workers[1]!.terminated).toBe(true);
    expect(() => controller.dispatch({ type: 'undo' })).toThrow('不可用');
  });

  it('terminates and releases a Worker that never confirms dispose', async () => {
    const { controller, workers } = controllerHarness(false, 1);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    await expect(controller.dispose()).rejects.toThrow('确认超时');
    expect(workers[0]!.terminated).toBe(true);
    expect(controller.snapshot().lastConfirmedWork).toBeNull();
  });

  it('does not wait forever when recovery initialize never responds', async () => {
    const { controller, workers } = controllerHarness(false);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    workers[0]!.crash('error');
    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted[0]?.type).toBe('initialize');

    const outcome = await Promise.race([
      controller.dispose().then(() => 'disposed'),
      new Promise<string>(resolve => { setTimeout(() => resolve('timed-out'), 25); }),
    ]);
    expect(outcome).toBe('disposed');
    expect(workers[1]!.terminated).toBe(true);
    expect(controller.snapshot().lastConfirmedWork).toBeNull();
  });

  it('moves a 20,000-point Work without cloning 30 history snapshots', () => {
    const base = workFixture(2);
    const points = Array.from({ length: 250 }, (_value, index) => {
      const side = Math.floor(index / 63);
      const offset = (index % 63) / 63 * 0.3;
      if (side === 0) return { x: Number((0.56 + offset).toFixed(6)), y: 0.56 };
      if (side === 1) return { x: 0.86, y: Number((0.56 + offset).toFixed(6)) };
      if (side === 2) return { x: Number((0.86 - offset).toFixed(6)), y: 0.86 };
      return { x: 0.56, y: Number((0.86 - offset).toFixed(6)) };
    });
    const work = WorkV2Schema.parse({
      ...base,
      operations: Array.from({ length: 80 }, (_value, order) => ({
        kind: 'freehand', id: `large-cut-${order}`, order, parameterVersion: 2, points, closed: true,
      })),
    });
    expect(work.operations.reduce((total, operation) => total + (operation.kind === 'freehand' ? operation.points.length : 0), 0)).toBe(20_000);
    const response = initialize(new EditorWorkerRuntime(), work);
    const serializedWork = JSON.stringify(work);
    const serializedResponse = JSON.stringify(response);
    expect(serializedResponse.length).toBeLessThan(serializedWork.length * 2);
    expect(serializedResponse).not.toMatch(/"(?:undo|redo|history)"\s*:/);
  });

  it('contains no geometry, RDP, quantization or intersection implementation', () => {
    const source = readFileSync(fileURLToPath(new URL('./controller.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/\b(?:RDP|simplif|quantiz|intersect|geometry)\b/i);
    expect(source).not.toContain('createPapercutCoreV2');
  });
});

describe('M15-7C Worker 故障、乱序消息和恢复', () => {
  it('ignores duplicate, stale and out-of-order requestId/sequence/session responses', async () => {
    const { controller, workers } = controllerHarness(false);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    const dispatched = controller.dispatch(addCircle('cut-1', 0));
    const valid = workers[0]!.replies[1]!;
    if (!('work' in valid)) throw new Error('expected state-bearing response');
    workers[0]!.emit({ ...valid, requestId: 999 });
    workers[0]!.emit({ ...valid, requestId: 1 });
    workers[0]!.emit({ ...valid, sequence: 0 });
    workers[0]!.emit({ ...valid, sessionId: 'ghost-session' });
    workers[0]!.emit({ ...valid, work: { ...valid.work, name: '伪造作品' } , requestId: 2, sequence: 1, sessionId: 'ghost-session' });
    expect(controller.snapshot().lastConfirmedWork?.name).toBe('Worker 测试');
    expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(0);
    workers[0]!.flush(1);
    await dispatched;
    expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1);
    // 已消费 requestId 的重复响应不得二次生效
    workers[0]!.emit({ ...valid, work: { ...valid.work, name: '重复响应' } });
    workers[0]!.emit({ ...valid, work: { ...valid.work, name: '重复响应' } });
    expect(controller.snapshot().lastConfirmedWork?.name).toBe('Worker 测试');
    expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1);
  });

  it('never lets a late response of a switched-away work overwrite the new work', async () => {
    const previous = controllerHarness();
    await previous.controller.initialize('session-a', workFixture());
    await previous.controller.dispatch(addCircle('old-cut', 0));
    const lateWork = previous.controller.snapshot().lastConfirmedWork!;
    await previous.controller.dispose();

    const workB = WorkV2Schema.parse({ ...workFixture(), id: 'work-b', name: '切换后的作品', operations: [] });
    const current = controllerHarness(false);
    const initialization = current.controller.initialize('session-b', workB);
    current.workers[0]!.flush(0);
    await initialization;

    // 旧 Worker 与旧会话的迟到响应都不能覆盖新作品
    previous.workers[0]!.emit({ sessionId: 'session-a', requestId: 2, sequence: 1, work: lateWork, canUndo: true, canRedo: true });
    current.workers[0]!.emit({ sessionId: 'session-a', requestId: 2, sequence: 1, work: lateWork, canUndo: true, canRedo: true });
    expect(current.controller.snapshot().lastConfirmedWork?.id).toBe('work-b');
    expect(current.controller.snapshot().lastConfirmedWork?.name).toBe('切换后的作品');

    const pendingDispatch = current.controller.dispatch(addCircle('new-cut', 0));
    current.workers[0]!.emit({ sessionId: 'session-a', requestId: 5, sequence: 1, work: lateWork, canUndo: true, canRedo: true });
    current.workers[0]!.emit({ ...current.workers[0]!.replies[1]!, sessionId: 'session-a' });
    expect(current.controller.snapshot().lastConfirmedWork?.id).toBe('work-b');
    expect(current.controller.snapshot().lastConfirmedWork?.operations).toHaveLength(0);
    current.workers[0]!.flush(1);
    await pendingDispatch;
    expect(current.controller.snapshot().lastConfirmedWork?.id).toBe('work-b');
    expect(current.controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1);
  });

  it.each([
    ['error', (worker: FakeWorker) => { worker.crash('error'); }],
    ['messageerror', (worker: FakeWorker) => { worker.crash('messageerror'); }],
    ['corrupt', (worker: FakeWorker) => { worker.emit({ damaged: true }); }],
  ] as const)('%s keeps the last confirmed Work, drops the candidate and recovers', async (_kind, inject) => {
    const { controller, workers } = controllerHarness();
    await controller.initialize('session-a', workFixture());
    await controller.dispatch(addCircle('confirmed', 0));
    const confirmed = controller.snapshot().lastConfirmedWork!;
    workers[0]!.autoReply = false;
    const candidate = track(controller.dispatch(addCircle('candidate', 1)));
    inject(workers[0]!);
    await vi.waitFor(() => expect(candidate.outcome()).toBe('rejected'));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await vi.waitFor(() => expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1));
    expect(controller.snapshot().lastConfirmedWork).toEqual(confirmed);
    expect(controller.snapshot()).toMatchObject({ canUndo: false, canRedo: false, notice: EDITOR_RECOVERY_NOTICE });
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[0]!.onerror).toBeNull();
    expect(workers[0]!.onmessageerror).toBeNull();
    const reinitialized = workers[1]!.posted[0];
    expect(reinitialized).toMatchObject({ type: 'initialize', sessionId: 'recovered-1' });
    if (reinitialized?.type !== 'initialize') throw new Error('expected initialize');
    expect(reinitialized.work.operations.map(operation => operation.id)).toEqual(['confirmed']);
  });

  it('rejects the candidate when postMessage throws and still recovers', async () => {
    const { controller, workers } = controllerHarness();
    await controller.initialize('session-a', workFixture());
    await controller.dispatch(addCircle('confirmed', 0));
    const confirmed = controller.snapshot().lastConfirmedWork!;
    workers[0]!.throwOnPost = true;
    const candidate = track(controller.dispatch({ type: 'add-freehand-cut', candidate: { id: 'candidate', order: 1, rawPoints: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }] } }));
    await vi.waitFor(() => expect(candidate.outcome()).toBe('rejected'));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(controller.snapshot().lastConfirmedWork).toEqual(confirmed);
    expect(controller.snapshot().notice).toBe(EDITOR_RECOVERY_NOTICE);
  });

  it('detects a Worker that dies silently during a request, keeps Work and recovers', async () => {
    const { controller, workers } = controllerHarness(true, 1_000, 25);
    await controller.initialize('session-a', workFixture());
    await controller.dispatch(addCircle('confirmed', 0));
    const confirmed = controller.snapshot().lastConfirmedWork!;
    workers[0]!.autoReply = false;
    const candidate = track(controller.dispatch(addCircle('candidate', 1)));
    workers[0]!.killSilently();
    await vi.waitFor(() => expect(candidate.outcome()).toBe('rejected'));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await vi.waitFor(() => expect(controller.snapshot().lastConfirmedWork).toEqual(confirmed));
    expect(controller.snapshot()).toMatchObject({ canUndo: false, canRedo: false, notice: EDITOR_RECOVERY_NOTICE });
    expect(workers[1]!.posted[0]).toMatchObject({ type: 'initialize' });
    // 新命令会取代恢复提示，且确认结果可以继续进入 lastConfirmedWork
    await controller.dispatch(addCircle('after-recovery', 1));
    expect(controller.snapshot().notice).toBeNull();
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['confirmed', 'after-recovery']);
  });

  it('settles in-flight requests when dispose happens mid-request (page unload)', async () => {
    const { controller, workers } = controllerHarness(false);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    const candidate = track(controller.dispatch(addCircle('candidate', 0)));
    expect(candidate.outcome()).toBe('pending');
    const disposing = controller.dispose();
    await vi.waitFor(() => expect(workers[0]!.posted.filter(request => request.type === 'dispose')).toHaveLength(1));
    await vi.waitFor(() => expect(candidate.outcome()).toBe('rejected'));
    workers[0]!.flush(2);
    await disposing;
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[0]!.onerror).toBeNull();
    expect(controller.snapshot()).toMatchObject({ lastConfirmedWork: null, notice: null });
  });

  it('continues cutting, deleting, undoing and redoing after recovery', async () => {
    const { controller, workers } = controllerHarness();
    await controller.initialize('session-a', workFixture());
    await controller.dispatch(addCircle('keep', 0));
    workers[0]!.autoReply = false;
    const lost = track(controller.dispatch(addCircle('lost', 1)));
    workers[0]!.crash('error');
    await vi.waitFor(() => expect(lost.outcome()).toBe('rejected'));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await vi.waitFor(() => expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1));
    await controller.dispatch(addCircle('cut', 1));
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['keep', 'cut']);
    await controller.dispatch({ type: 'delete-cut', operationId: 'cut' });
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['keep']);
    await controller.dispatch({ type: 'undo' });
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['keep', 'cut']);
    expect(controller.snapshot().canRedo).toBe(true);
    await controller.dispatch({ type: 'redo' });
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['keep']);
    expect(controller.snapshot()).toMatchObject({ canUndo: true, canRedo: false });
    expect(workers).toHaveLength(2);
  });

  it('queues a command issued during recovery without throwing or leaking promises', async () => {
    const { controller, workers } = controllerHarness(false);
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    workers[0]!.crash('error');
    expect(controller.snapshot().notice).toBe(EDITOR_RECOVERY_NOTICE);
    const queued = track(controller.dispatch(addCircle('queued-cut', 0)));
    expect(controller.snapshot().notice).toBeNull();
    expect(workers).toHaveLength(2);
    expect(queued.outcome()).toBe('pending');
    expect(workers[1]!.posted.filter(request => request.type === 'dispatch')).toHaveLength(0);
    workers[1]!.flush(0);
    await vi.waitFor(() => expect(workers[1]!.posted.filter(request => request.type === 'dispatch')).toHaveLength(1));
    workers[1]!.flush(1);
    await vi.waitFor(() => expect(queued.outcome()).toBe('resolved'));
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['queued-cut']);
  });

  it('repeated faults release old Workers, keep one listener and settle every promise', async () => {
    const { controller, workers } = controllerHarness(false);
    let deliveries = 0;
    const unsubscribe = controller.subscribe(() => { deliveries += 1; });
    const initialization = controller.initialize('session-a', workFixture());
    workers[0]!.flush(0);
    await initialization;
    const confirmed = controller.dispatch(addCircle('confirmed', 0));
    workers[0]!.flush(1);
    await confirmed;
    const tracked: TrackedPromise[] = [];
    for (let round = 0; round < 3; round += 1) {
      const current = workers[workers.length - 1]!;
      const candidate = track(controller.dispatch(addCircle(`lost-${round}`, 1)));
      tracked.push(candidate);
      current.crash('error');
      await vi.waitFor(() => expect(candidate.outcome()).toBe('rejected'));
      await vi.waitFor(() => expect(workers).toHaveLength(round + 2));
      expect(workers[round]!.terminated).toBe(true);
      expect(workers[round]!.onmessage).toBeNull();
      workers[workers.length - 1]!.flush(0);
      await vi.waitFor(() => expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(1));
    }
    expect(workers).toHaveLength(4);
    expect(workers.filter(worker => !worker.terminated)).toHaveLength(1);
    expect(workers.slice(0, 3).every(worker => worker.onmessage === null && worker.onerror === null && worker.onmessageerror === null)).toBe(true);
    expect(tracked.every(promise => promise.settled())).toBe(true);
    expect(tracked.every(promise => promise.outcome() === 'rejected')).toBe(true);
    expect(controller.snapshot().lastConfirmedWork?.operations.map(operation => operation.id)).toEqual(['confirmed']);
    // 每次通知只送达一个监听器，恢复不会重复注册
    const before = deliveries;
    const final = controller.dispatch(addCircle('final', 1));
    await vi.waitFor(() => expect(workers[workers.length - 1]!.posted.filter(request => request.type === 'dispatch')).toHaveLength(1));
    workers[workers.length - 1]!.flush(1);
    await final;
    expect(deliveries - before).toBe(1);
    expect(controller.snapshot().lastConfirmedWork?.operations).toHaveLength(2);
    unsubscribe();
  });
});
