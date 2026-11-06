// Isolated M15-5/M15-7C editor browser entry. It is never imported by the production composition root.
import { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorProfileV2Schema, TemplateSnapshotV2Schema, TemplateVersionV1Schema, WorkV2Schema, type WorkV2 } from '@shoushang/contracts';
import { createArtworkRendererV2 } from '@shoushang/artwork-renderer';
import profilesDocument from '../../../../../../docs/qa/m15/editor-profiles-v2.json';
import templateV2C04Document from '../../../../../../content/v2-additions-2026-10-27/template-v2-c04.json';
import profileV2C04Document from '../../../../../../content/v2-additions-2026-10-27/editor-profile-v2-c04.json';
import { FreehandEditor } from './FreehandEditor';
import { EditorWorkerController, type EditorWorkerFactory, type EditorWorkerLike } from './worker/controller';
import type { EditorWorkerRequest } from './worker/protocol';
import { EditorWorkerRuntime } from './worker/runtime';

interface M15BControls {
  confirmedCount: number;
  operationCount: number;
  getWork(): WorkV2;
  unmount(): void;
}

interface M15CFaultControls {
  workerCount(): number;
  liveWorkerCount(): number;
  holdNextRequest(): void;
  fault(kind: 'crash' | 'messageerror' | 'corrupt' | 'post-throw' | 'silent-terminate'): void;
  inject(data: unknown, target?: 'active' | 'previous'): void;
  lastResponse(): unknown;
  switchWork(): Promise<boolean>;
  probe(): Promise<{ ok: true; operationCount: number } | { ok: false; message: string }>;
  snapshot(): {
    workId: string | null;
    workName: string | null;
    operationCount: number;
    notice: string | null;
    canUndo: boolean;
    canRedo: boolean;
    statusText: string;
    workerCount: number;
    liveWorkerCount: number;
    notices: string[];
    confirmedCount: number;
  };
}

declare global { interface Window { m15b: M15BControls; m15c?: M15CFaultControls } }

const search = new URLSearchParams(location.search);
const large = search.has('large');
const allShapes = search.has('allShapes');
const transformShapes = search.has('transformShapes');
const newShapes = search.has('newShapes') || transformShapes;
const entry = profilesDocument.profiles[large || allShapes ? 2 : 0]!;
const sourceProfile = newShapes ? profileV2C04Document.profile : entry.profile;
// ?noFreehand=1 只在隔离入口把 profile 的自由路径关掉，用于验证直线等工具的权限门。
const profile = EditorProfileV2Schema.parse(search.has('noFreehand')
  ? { ...sourceProfile, allowedTools: { ...sourceProfile.allowedTools, freehand: { ...sourceProfile.allowedTools.freehand, enabled: false } } }
  : sourceProfile);
const template = newShapes
  ? TemplateSnapshotV2Schema.parse(templateV2C04Document)
  : TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
const seeded = search.has('seed');
const largeContour = Array.from({ length: 512 }, (_value, index) => {
  const angle = index * Math.PI * 2 / 512;
  return { x: Number((0.7 + 0.03 * Math.cos(angle)).toFixed(6)), y: Number((0.7 + 0.03 * Math.sin(angle)).toFixed(6)) };
});
const largeOperations = Array.from({ length: 39 }, (_value, order) => ({
  kind: 'freehand' as const,
  id: `large-cut-${order}`,
  order,
  parameterVersion: 2 as const,
  points: largeContour,
  closed: true as const,
}));
const initialWork = WorkV2Schema.parse({
  id: 'm15b-browser-work', name: 'M15-5B 隔离测试', craftId: template.craftId,
  templateSnapshot: template, editorProfileSnapshot: profile,
  palette: { paper: '#B82025', background: '#F2D9A6' },
  operations: large ? largeOperations : transformShapes ? [
    { kind: 'parametric', id: 'transform-circle', order: 0, parameterVersion: 2, shape: 'circle', center: { x: 0.13, y: 0.22 }, width: 0.06, height: 0.08, angleDeg: 0 },
    { kind: 'parametric', id: 'transform-ellipse', order: 1, parameterVersion: 2, shape: 'ellipse', center: { x: 0.25, y: 0.22 }, width: 0.06, height: 0.08, angleDeg: 0 },
    { kind: 'parametric', id: 'transform-rectangle', order: 2, parameterVersion: 2, shape: 'rectangle', center: { x: 0.35, y: 0.22 }, width: 0.06, height: 0.08, angleDeg: 0 },
    { kind: 'parametric', id: 'transform-star', order: 3, parameterVersion: 2, shape: 'star', center: { x: 0.16, y: 0.48 }, width: 0.06, height: 0.08, angleDeg: 0 },
    { kind: 'parametric', id: 'transform-petal', order: 4, parameterVersion: 2, shape: 'petal', center: { x: 0.34, y: 0.48 }, width: 0.06, height: 0.08, angleDeg: 0 },
  ] : seeded ? [
    { kind: 'parametric', id: 'seed-lower', order: 0, parameterVersion: 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.1, height: 0.1, angleDeg: 0 },
    { kind: 'parametric', id: 'seed-upper', order: 1, parameterVersion: 2, shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.06, height: 0.06, angleDeg: 0 },
  ] : [],
  status: 'draft', schemaVersion: 2, revision: 0,
  createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z',
});
class DelayedDispatchWorker implements EditorWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly runtime = new EditorWorkerRuntime();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  postMessage(message: EditorWorkerRequest): void {
    const response = this.runtime.handle(structuredClone(message));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.onmessage?.(new MessageEvent('message', { data: response }));
    }, message.type === 'dispatch' ? 250 : 0);
    this.timers.add(timer);
  }

  terminate(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

/**
 * M15-7C 测试专用故障注入：包装真实 module Worker，只在 ?faults=1 的隔离入口启用。
 * 生产页面不导入本文件，也不暴露任何注入方法。
 */
class FaultInjectingWorker implements EditorWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly worker = new Worker(new URL('./worker/papercut.worker.ts', import.meta.url), { type: 'module' });
  readonly posted: EditorWorkerRequest[] = [];
  readonly responses: unknown[] = [];
  terminated = false;
  private holdNextRequest = false;
  private postThrows = false;

  constructor() {
    this.worker.onmessage = event => {
      this.responses.push(event.data);
      this.onmessage?.(new MessageEvent('message', { data: event.data }));
    };
    this.worker.onerror = event => { this.onerror?.(event); };
    this.worker.onmessageerror = () => { this.onmessageerror?.(new MessageEvent('messageerror')); };
  }

  postMessage(message: EditorWorkerRequest): void {
    if (this.postThrows) throw new Error('测试注入：postMessage 抛错');
    this.posted.push(message);
    if (this.holdNextRequest) {
      this.holdNextRequest = false;
      return;
    }
    if (this.terminated) return;
    this.worker.postMessage(message);
  }

  /** 扣住下一条请求：请求已发出但 Worker 永不回应，用于制造“请求期间故障”。 */
  holdNext(): void { this.holdNextRequest = true; }

  terminate(): void {
    this.terminated = true;
    this.worker.terminate();
  }

  fireCrash(): void {
    this.terminated = true;
    this.worker.terminate();
    this.onerror?.(new ErrorEvent('error', { message: '测试注入：Worker 崩溃' }));
  }

  fireMessageError(): void {
    this.onmessageerror?.(new MessageEvent('messageerror'));
  }

  fireCorrupt(): void {
    this.onmessage?.(new MessageEvent('message', { data: { 测试注入: '损坏响应' } }));
  }

  armPostThrow(): void { this.postThrows = true; }

  /** 静默终止：与真实 terminate 一样不触发任何事件。 */
  terminateSilently(): void {
    this.terminated = true;
    this.worker.terminate();
  }

  inject(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  get lastResponse(): unknown { return this.responses.at(-1) ?? null; }
}

const faults = search.has('faults');
const delayed = search.has('delayDispatch');
const requestTimeoutRaw = search.get('requestTimeout');
const requestTimeoutMs = requestTimeoutRaw === null ? Number.NaN : Number(requestTimeoutRaw);
const faultWorkers: FaultInjectingWorker[] = [];
const faultFactory: EditorWorkerFactory = () => {
  const worker = new FaultInjectingWorker();
  faultWorkers.push(worker);
  return worker;
};
const controllerOptions = {
  ...(faults ? { workerFactory: faultFactory } : delayed ? { workerFactory: () => new DelayedDispatchWorker() } : {}),
  ...(Number.isFinite(requestTimeoutMs) ? { requestTimeoutMs } : {}),
};
let activeController = new EditorWorkerController(controllerOptions);
await activeController.initialize('m15b-browser-session', initialWork);

let root: Root;
let currentWork = initialWork;
let setHarnessWork: ((work: WorkV2) => void) | null = null;
const seenNotices: string[] = [];
activeController.subscribe(snapshot => {
  if (snapshot.notice && seenNotices.at(-1) !== snapshot.notice) seenNotices.push(snapshot.notice);
});

window.m15b = {
  confirmedCount: 0,
  operationCount: initialWork.operations.length,
  getWork: () => structuredClone(currentWork),
  unmount: () => root.unmount(),
};

const switchTarget = WorkV2Schema.parse({
  ...initialWork,
  id: 'm15c-switched-work',
  name: 'M15-7C 切换后的作品',
  operations: [],
});

if (faults) {
  window.m15c = {
    workerCount: () => faultWorkers.length,
    liveWorkerCount: () => faultWorkers.filter(worker => !worker.terminated).length,
    holdNextRequest: () => { faultWorkers.at(-1)?.holdNext(); },
    fault: kind => {
      const worker = faultWorkers.at(-1);
      if (!worker) throw new Error('没有活跃的注入 Worker');
      if (kind === 'crash') worker.fireCrash();
      else if (kind === 'messageerror') worker.fireMessageError();
      else if (kind === 'corrupt') worker.fireCorrupt();
      else if (kind === 'post-throw') worker.armPostThrow();
      else worker.terminateSilently();
    },
    inject: (data, target = 'active') => {
      const worker = target === 'active' ? faultWorkers.at(-1) : faultWorkers.at(-2);
      if (!worker) throw new Error('没有可注入的 Worker');
      worker.inject(data);
    },
    lastResponse: () => structuredClone(faultWorkers.at(-1)?.lastResponse ?? null),
    switchWork: async () => {
      const retiring = activeController;
      const replacement = new EditorWorkerController({
        ...(faults ? { workerFactory: faultFactory } : {}),
        ...(Number.isFinite(requestTimeoutMs) ? { requestTimeoutMs } : {}),
      });
      await retiring.dispose();
      await replacement.initialize('m15c-switched-session', switchTarget);
      activeController = replacement;
      activeController.subscribe(snapshot => {
        if (snapshot.notice && seenNotices.at(-1) !== snapshot.notice) seenNotices.push(snapshot.notice);
      });
      currentWork = switchTarget;
      window.m15b.operationCount = 0;
      setHarnessWork?.(switchTarget);
      return true;
    },
    probe: async () => {
      try {
        const work = await activeController.getCurrentWork();
        return { ok: true, operationCount: work.operations.length };
      } catch (cause) {
        return { ok: false, message: cause instanceof Error ? cause.message : '未知错误' };
      }
    },
    snapshot: () => {
      const state = activeController.snapshot();
      return {
        workId: state.lastConfirmedWork?.id ?? null,
        workName: state.lastConfirmedWork?.name ?? null,
        operationCount: state.lastConfirmedWork?.operations.length ?? 0,
        notice: state.notice,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        statusText: document.getElementById('m15b-status')?.textContent ?? '',
        workerCount: faultWorkers.length,
        liveWorkerCount: faultWorkers.filter(worker => !worker.terminated).length,
        notices: [...seenNotices],
        confirmedCount: window.m15b.confirmedCount,
      };
    },
  };
}

function Harness() {
  const [work, setWork] = useState<WorkV2>(initialWork);
  setHarnessWork = setWork;
  return <FreehandEditor
    work={work}
    controller={activeController}
    renderer={createArtworkRendererV2()}
    candidateIdFactory={() => `browser-cut-${window.m15b.confirmedCount + 1}`}
    onConfirmedWork={confirmed => {
      currentWork = confirmed;
      window.m15b.confirmedCount += 1;
      window.m15b.operationCount = confirmed.operations.length;
      setWork(confirmed);
    }}
  />;
}

root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><Harness /></StrictMode>);
document.body.dataset.ready = 'true';
