import { createPapercutCoreV2, type PapercutSessionV2, type PapercutStateV2 } from '@shoushang/papercut-core';
import {
  parseEditorWorkerRequest,
  protocolError,
  type EditorWorkerRequest,
  type EditorWorkerResponse,
} from './protocol';

function stateResponse(
  request: EditorWorkerRequest,
  sequence: number,
  state: PapercutStateV2,
): EditorWorkerResponse {
  return {
    sessionId: request.sessionId,
    requestId: request.requestId,
    sequence,
    work: state.work,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
  };
}

export class EditorWorkerRuntime {
  private session: PapercutSessionV2 | null = null;
  private sessionId: string | null = null;
  private lastRequestId = 0;
  private sequence = 0;
  private disposed = false;

  handle(value: unknown): EditorWorkerResponse {
    const request = parseEditorWorkerRequest(value);
    if (!request) throw new Error('编辑器 Worker 收到损坏的请求');

    if (this.sessionId !== null && request.sessionId !== this.sessionId) {
      return protocolError(request.sessionId, request.requestId, request.type === 'dispatch' ? request.sequence : this.sequence,
        'SESSION_MISMATCH', '请求属于旧的编辑会话');
    }
    if (this.disposed) {
      return protocolError(request.sessionId, request.requestId, request.type === 'dispatch' ? request.sequence : this.sequence,
        'DISPOSED', '编辑会话已释放');
    }
    if (request.requestId <= this.lastRequestId) {
      return protocolError(request.sessionId, request.requestId, request.type === 'dispatch' ? request.sequence : this.sequence,
        'REQUEST_ORDER', 'requestId 必须严格递增且不可重复');
    }

    if (request.type === 'initialize') return this.initialize(request);
    if (!this.session || !this.sessionId) {
      return protocolError(request.sessionId, request.requestId, request.type === 'dispatch' ? request.sequence : this.sequence,
        'PROTOCOL_ERROR', '编辑会话尚未初始化');
    }

    this.lastRequestId = request.requestId;
    if (request.type === 'dispatch') return this.dispatch(request);
    if (request.type === 'get-current-work') return stateResponse(request, this.sequence, this.session.current());

    this.session = null;
    this.disposed = true;
    return { sessionId: request.sessionId, requestId: request.requestId, sequence: this.sequence, disposed: true };
  }

  private initialize(request: Extract<EditorWorkerRequest, { type: 'initialize' }>): EditorWorkerResponse {
    if (this.sessionId !== null) {
      return protocolError(request.sessionId, request.requestId, this.sequence, 'PROTOCOL_ERROR', 'Worker 同时只能持有一个编辑会话');
    }
    this.lastRequestId = request.requestId;
    const created = createPapercutCoreV2().createSession(request.work);
    if (!created.ok) {
      return protocolError(request.sessionId, request.requestId, 0, created.error.code, created.error.message);
    }
    this.sessionId = request.sessionId;
    this.session = created.value;
    this.sequence = 0;
    return stateResponse(request, 0, this.session.current());
  }

  private dispatch(request: Extract<EditorWorkerRequest, { type: 'dispatch' }>): EditorWorkerResponse {
    const expected = this.sequence + 1;
    if (request.sequence !== expected) {
      return protocolError(request.sessionId, request.requestId, request.sequence, 'SEQUENCE_ORDER',
        `sequence 必须严格递增，期望 ${expected}`);
    }
    this.sequence = request.sequence;
    const result = this.session!.dispatch(request.command);
    if (result.ok) return stateResponse(request, this.sequence, result.value);
    const current = this.session!.current();
    return {
      ...stateResponse(request, this.sequence, current),
      error: { code: result.error.code, message: result.error.message },
    };
  }
}
