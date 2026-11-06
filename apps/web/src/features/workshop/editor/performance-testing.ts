import {
  EditorProfileV2Schema,
  TemplateVersionV1Schema,
  WorkV2Schema,
  type PapercutCommandV2,
  type RawPointV2,
  type WorkV2,
} from '@shoushang/contracts';
import profilesDocument from '../../../../../../docs/qa/m15/editor-profiles-v2.json';
import { submitFreehandStroke } from './freehand';
import { EditorWorkerController, type EditorWorkerLike } from './worker/controller';
import type { EditorWorkerRequest } from './worker/protocol';

export interface WireMessageSample {
  readonly direction: 'request' | 'response';
  readonly type: string;
  readonly requestId: number | null;
  readonly sequence: number | null;
  readonly sessionId: string | null;
  readonly bytes: number;
  readonly keys: readonly string[];
  readonly containsHistory: boolean;
  readonly containsWork: boolean;
  readonly rawPointCount: number | null;
}

export interface MetricSummary {
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

export interface MemoryEvidence {
  readonly status: 'supported';
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface UnsupportedEvidence { readonly status: 'unsupported' }

export interface BrowserPerformanceEvidence {
  readonly moduleWorker: true;
  readonly rawPointCount: 4096;
  readonly dispatchSamplesMs: readonly number[];
  readonly dispatch: MetricSummary;
  readonly animationFrameIntervalsMs: readonly number[];
  readonly animationFrame: MetricSummary;
  readonly longTasksMs: readonly number[] | UnsupportedEvidence;
  readonly memory: MemoryEvidence | UnsupportedEvidence;
  readonly messages: readonly WireMessageSample[];
  readonly historyRequestBytes: readonly number[];
  readonly historyResponseBytes: readonly number[];
  readonly historyFlags: readonly { readonly canUndo: boolean; readonly canRedo: boolean }[];
}

export interface BoundaryEvidence {
  readonly disposed: boolean;
  readonly disposedCode: string | null;
  readonly oldSessionCode: string | null;
}

interface PerformanceMemory { readonly usedJSHeapSize: number }
interface PerformanceWithMemory extends Performance { readonly memory?: PerformanceMemory }

const records: WireMessageSample[] = [];
const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const containsHistory = (value: unknown): boolean => /"(?:undo|redo|history)"\s*:/.test(JSON.stringify(value));

function recordMessage(direction: WireMessageSample['direction'], value: unknown): void {
  const object = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const command = typeof object.command === 'object' && object.command !== null ? object.command as Record<string, unknown> : null;
  const candidate = command && typeof command.candidate === 'object' && command.candidate !== null
    ? command.candidate as Record<string, unknown>
    : null;
  records.push({
    direction,
    type: typeof object.type === 'string' ? object.type : ('disposed' in object ? 'disposed' : 'state'),
    requestId: typeof object.requestId === 'number' ? object.requestId : null,
    sequence: typeof object.sequence === 'number' ? object.sequence : null,
    sessionId: typeof object.sessionId === 'string' ? object.sessionId : null,
    bytes: byteLength(value),
    keys: Object.keys(object).sort(),
    containsHistory: containsHistory(value),
    containsWork: 'work' in object,
    rawPointCount: candidate && Array.isArray(candidate.rawPoints) ? candidate.rawPoints.length : null,
  });
}

class InstrumentedModuleWorker implements EditorWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly worker = new Worker(new URL('./worker/papercut.worker.ts', import.meta.url), { type: 'module' });

  constructor() {
    this.worker.onmessage = event => {
      recordMessage('response', event.data);
      this.onmessage?.(event);
    };
    this.worker.onerror = event => { this.onerror?.(event); };
    this.worker.onmessageerror = event => { this.onmessageerror?.(event); };
  }

  postMessage(message: EditorWorkerRequest): void {
    recordMessage('request', message);
    this.worker.postMessage(message);
  }

  terminate(): void { this.worker.terminate(); }
}

function emptyWork(): WorkV2 {
  const entry = profilesDocument.profiles[0]!;
  const profile = EditorProfileV2Schema.parse(entry.profile);
  const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
  return WorkV2Schema.parse({
    id: 'm15-5d-performance-work', name: 'M15-5D 性能测试', craftId: template.craftId,
    templateSnapshot: template, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [],
    status: 'draft', schemaVersion: 2, revision: 0,
    createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z',
  });
}

function raw4096(): RawPointV2[] {
  return Array.from({ length: 4096 }, (_value, index) => {
    const angle = index * Math.PI * 2 / 4096;
    return { x: 0.25 + 0.1 * Math.cos(angle), y: 0.3 + 0.1 * Math.sin(angle) };
  });
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): MetricSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

async function runPerformance(): Promise<BrowserPerformanceEvidence> {
  records.length = 0;
  const memoryBefore = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  const longTasks: number[] = [];
  const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
  const observer = longTaskSupported ? new PerformanceObserver(list => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  }) : null;
  observer?.observe({ entryTypes: ['longtask'] });

  const frameIntervals: number[] = [];
  let samplingFrames = true;
  let previousFrame: number | null = null;
  const sampleFrame = (now: number): void => {
    if (previousFrame !== null) frameIntervals.push(now - previousFrame);
    previousFrame = now;
    if (samplingFrames) requestAnimationFrame(sampleFrame);
  };
  requestAnimationFrame(sampleFrame);

  const controller = new EditorWorkerController({ workerFactory: () => new InstrumentedModuleWorker() });
  let work = await controller.initialize('m15-5d-4096', emptyWork());
  const points = raw4096();
  const dispatchSamples: number[] = [];
  for (let index = 0; index < 30; index += 1) {
    const started = performance.now();
    work = await submitFreehandStroke(controller, work, 'performance-cut', points);
    dispatchSamples.push(performance.now() - started);
    const added = controller.snapshot();
    if (!added.canUndo || added.canRedo) throw new Error('4096点提交后的历史状态错误');
    work = await controller.dispatch({ type: 'undo' });
    const undone = controller.snapshot();
    if (undone.canUndo || !undone.canRedo || work.operations.length !== 0) throw new Error('4096点撤销后的历史状态错误');
    await nextFrame();
  }
  await controller.dispose();

  const historyController = new EditorWorkerController({ workerFactory: () => new InstrumentedModuleWorker() });
  await historyController.initialize('m15-5d-history', emptyWork());
  const historyFlags: Array<{ canUndo: boolean; canRedo: boolean }> = [];
  for (let index = 0; index < 30; index += 1) {
    const command: PapercutCommandV2 = {
      type: 'set-palette',
      palette: index % 2 === 0
        ? { paper: '#112233', background: '#F2D9A6' }
        : { paper: '#445566', background: '#F2D9A6' },
    };
    await historyController.dispatch(command);
    const snapshot = historyController.snapshot();
    historyFlags.push({ canUndo: snapshot.canUndo, canRedo: snapshot.canRedo });
  }
  await historyController.dispatch({ type: 'undo' });
  const afterUndo = historyController.snapshot();
  if (!afterUndo.canUndo || !afterUndo.canRedo) throw new Error('30步后撤销状态错误');
  await historyController.dispatch({ type: 'redo' });
  const afterRedo = historyController.snapshot();
  if (!afterRedo.canUndo || afterRedo.canRedo) throw new Error('30步后重做状态错误');
  await historyController.dispose();

  samplingFrames = false;
  await nextFrame();
  observer?.takeRecords().forEach(entry => longTasks.push(entry.duration));
  observer?.disconnect();
  const memoryAfter = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  const historyRequests = records.filter(sample => sample.direction === 'request' && sample.sessionId === 'm15-5d-history'
    && sample.type === 'dispatch').slice(0, 30);
  const historyRequestIds = new Set(historyRequests.map(sample => sample.requestId));
  const historyResponses = records.filter(sample => sample.direction === 'response' && sample.sessionId === 'm15-5d-history'
    && sample.requestId !== null && historyRequestIds.has(sample.requestId));
  return {
    moduleWorker: true,
    rawPointCount: 4096,
    dispatchSamplesMs: dispatchSamples,
    dispatch: summarize(dispatchSamples),
    animationFrameIntervalsMs: frameIntervals,
    animationFrame: summarize(frameIntervals),
    longTasksMs: longTaskSupported ? longTasks : { status: 'unsupported' },
    memory: memoryBefore === undefined || memoryAfter === undefined
      ? { status: 'unsupported' }
      : { status: 'supported', before: memoryBefore, after: memoryAfter, delta: memoryAfter - memoryBefore },
    messages: [...records],
    historyRequestBytes: historyRequests.map(sample => sample.bytes),
    historyResponseBytes: historyResponses.map(sample => sample.bytes),
    historyFlags,
  };
}

function rawWorkerRequest(worker: Worker, request: EditorWorkerRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    worker.onmessage = event => {
      recordMessage('response', event.data);
      resolve(typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {});
    };
    worker.onerror = () => { reject(new Error('真实 Worker 边界测试失败')); };
    recordMessage('request', request);
    worker.postMessage(request);
  });
}

async function runBoundary(): Promise<BoundaryEvidence> {
  const worker = new Worker(new URL('./worker/papercut.worker.ts', import.meta.url), { type: 'module' });
  try {
    await rawWorkerRequest(worker, { type: 'initialize', sessionId: 'boundary-current', requestId: 1, work: emptyWork() });
    const disposed = await rawWorkerRequest(worker, { type: 'dispose', sessionId: 'boundary-current', requestId: 2 });
    const afterDispose = await rawWorkerRequest(worker, { type: 'get-current-work', sessionId: 'boundary-current', requestId: 3 });
    const oldSession = await rawWorkerRequest(worker, { type: 'get-current-work', sessionId: 'boundary-old', requestId: 99 });
    const disposedError = typeof afterDispose.error === 'object' && afterDispose.error !== null
      ? afterDispose.error as Record<string, unknown>
      : null;
    const oldSessionError = typeof oldSession.error === 'object' && oldSession.error !== null
      ? oldSession.error as Record<string, unknown>
      : null;
    return {
      disposed: disposed.disposed === true,
      disposedCode: typeof disposedError?.code === 'string' ? disposedError.code : null,
      oldSessionCode: typeof oldSessionError?.code === 'string' ? oldSessionError.code : null,
    };
  } finally {
    worker.terminate();
  }
}

declare global {
  interface Window {
    m15d: {
      runPerformance(): Promise<BrowserPerformanceEvidence>;
      runBoundary(): Promise<BoundaryEvidence>;
    };
  }
}

window.m15d = { runPerformance, runBoundary };
document.body.dataset.ready = 'true';
