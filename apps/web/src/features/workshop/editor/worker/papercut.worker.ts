import { EditorWorkerRuntime } from './runtime';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
const runtime = new EditorWorkerRuntime();

scope.onmessage = event => {
  const response = runtime.handle(event.data);
  scope.postMessage(response);
};
