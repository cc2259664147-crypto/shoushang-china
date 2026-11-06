import {
  BrushCandidateV2Schema,
  WorkV2Schema,
  type CoreError,
  type PapercutCommandV2,
  type WorkV2,
} from '@shoushang/contracts';

export type EditorWorkerRequest =
  | { readonly type: 'initialize'; readonly sessionId: string; readonly requestId: number; readonly work: WorkV2 }
  | { readonly type: 'dispatch'; readonly sessionId: string; readonly requestId: number; readonly sequence: number; readonly command: PapercutCommandV2 }
  | { readonly type: 'get-current-work'; readonly sessionId: string; readonly requestId: number }
  | { readonly type: 'dispose'; readonly sessionId: string; readonly requestId: number };

export type EditorWorkerErrorCode = CoreError['code']
  | 'PROTOCOL_ERROR'
  | 'SESSION_MISMATCH'
  | 'REQUEST_ORDER'
  | 'SEQUENCE_ORDER'
  | 'DISPOSED';

export interface EditorWorkerError {
  readonly code: EditorWorkerErrorCode;
  readonly message: string;
}

export type EditorWorkerResponse =
  | {
    readonly sessionId: string;
    readonly requestId: number;
    readonly sequence: number;
    readonly work: WorkV2;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
  }
  | {
    readonly sessionId: string;
    readonly requestId: number;
    readonly sequence: number;
    readonly work: WorkV2;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly error: EditorWorkerError;
  }
  | {
    readonly sessionId: string;
    readonly requestId: number;
    readonly sequence: number;
    readonly error: EditorWorkerError;
  }
  | {
    readonly sessionId: string;
    readonly requestId: number;
    readonly sequence: number;
    readonly disposed: true;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseCommand(value: unknown): PapercutCommandV2 | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const keysByType: Readonly<Record<PapercutCommandV2['type'], readonly string[]>> = {
    'add-parametric-cut': ['type', 'operation'],
    'add-freehand-cut': ['type', 'candidate'],
    'add-brush-cut': ['type', 'candidate'],
    'update-cut': ['type', 'operationId', 'change'],
    'duplicate-cut': ['type', 'operationId', 'newOperationId', 'dx', 'dy'],
    'delete-cut': ['type', 'operationId'],
    'clear-cuts': ['type'],
    undo: ['type'],
    redo: ['type'],
    'set-palette': ['type', 'palette'],
  };
  if (!(value.type in keysByType)) return null;
  const type = value.type as PapercutCommandV2['type'];
  if (!hasExactKeys(value, keysByType[type])) return null;
  if (type === 'add-brush-cut' && !BrushCandidateV2Schema.safeParse(value.candidate).success) return null;
  if (type === 'update-cut') {
    if (!isRecord(value.change) || typeof value.change.type !== 'string') return null;
    if (value.change.type === 'translate') {
      if (!hasExactKeys(value.change, ['type', 'dx', 'dy'])) return null;
    } else if (value.change.type === 'transform-parametric') {
      if (!hasExactKeys(value.change, ['type', 'center', 'width', 'height', 'angleDeg'])
        || !isRecord(value.change.center) || !hasExactKeys(value.change.center, ['x', 'y'])) return null;
    } else return null;
  }
  return value as PapercutCommandV2;
}

export function parseEditorWorkerRequest(value: unknown): EditorWorkerRequest | null {
  if (!isRecord(value) || !isIdentifier(value.sessionId) || !isRequestId(value.requestId)) return null;
  if (value.type === 'initialize' && hasExactKeys(value, ['type', 'sessionId', 'requestId', 'work'])) {
    const work = WorkV2Schema.safeParse(value.work);
    return work.success ? { type: 'initialize', sessionId: value.sessionId, requestId: value.requestId, work: work.data } : null;
  }
  if (value.type === 'dispatch' && hasExactKeys(value, ['type', 'sessionId', 'requestId', 'sequence', 'command'])) {
    const command = parseCommand(value.command);
    return isSequence(value.sequence) && command
      ? { type: 'dispatch', sessionId: value.sessionId, requestId: value.requestId, sequence: value.sequence, command }
      : null;
  }
  if (value.type === 'get-current-work' && hasExactKeys(value, ['type', 'sessionId', 'requestId'])) {
    return { type: 'get-current-work', sessionId: value.sessionId, requestId: value.requestId };
  }
  if (value.type === 'dispose' && hasExactKeys(value, ['type', 'sessionId', 'requestId'])) {
    return { type: 'dispose', sessionId: value.sessionId, requestId: value.requestId };
  }
  return null;
}

const errorCodes = new Set<EditorWorkerErrorCode>([
  'INVALID_INPUT', 'GEOMETRY_INVALID', 'UNSUPPORTED_VERSION', 'PROTOCOL_ERROR',
  'SESSION_MISMATCH', 'REQUEST_ORDER', 'SEQUENCE_ORDER', 'DISPOSED',
]);

function parseError(value: unknown): EditorWorkerError | null {
  if (!isRecord(value) || !hasExactKeys(value, ['code', 'message'])) return null;
  if (typeof value.code !== 'string' || !errorCodes.has(value.code as EditorWorkerErrorCode)) return null;
  return typeof value.message === 'string' && value.message.length > 0
    ? { code: value.code as EditorWorkerErrorCode, message: value.message }
    : null;
}

export function parseEditorWorkerResponse(value: unknown): EditorWorkerResponse | null {
  if (!isRecord(value) || !isIdentifier(value.sessionId) || !isRequestId(value.requestId) || !isSequence(value.sequence)) return null;
  const base = { sessionId: value.sessionId, requestId: value.requestId, sequence: value.sequence };
  if (hasExactKeys(value, ['sessionId', 'requestId', 'sequence', 'disposed']) && value.disposed === true) {
    return { ...base, disposed: true };
  }
  const error = 'error' in value ? parseError(value.error) : null;
  if (hasExactKeys(value, ['sessionId', 'requestId', 'sequence', 'error']) && error) return { ...base, error };
  const keys = error
    ? ['sessionId', 'requestId', 'sequence', 'work', 'canUndo', 'canRedo', 'error']
    : ['sessionId', 'requestId', 'sequence', 'work', 'canUndo', 'canRedo'];
  if (!hasExactKeys(value, keys) || typeof value.canUndo !== 'boolean' || typeof value.canRedo !== 'boolean') return null;
  const work = WorkV2Schema.safeParse(value.work);
  if (!work.success) return null;
  return error
    ? { ...base, work: work.data, canUndo: value.canUndo, canRedo: value.canRedo, error }
    : { ...base, work: work.data, canUndo: value.canUndo, canRedo: value.canRedo };
}

export function protocolError(
  sessionId: string,
  requestId: number,
  sequence: number,
  code: EditorWorkerErrorCode,
  message: string,
): EditorWorkerResponse {
  return { sessionId, requestId, sequence, error: { code, message } };
}
