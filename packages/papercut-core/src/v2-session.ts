import {
  BrushCandidateV2Schema,
  ColorSchema,
  FreehandCandidateV2Schema,
  IdSchema,
  ParametricCutV2Schema,
  WorkV2Schema,
  type CoreError,
  type CutOperationV2,
  type FreehandCutV2,
  type PapercutCommandV2,
  type PapercutSessionV2,
  type PapercutStateV2,
  type ParametricCutV2,
  type Result,
  type WorkV2,
} from '@shoushang/contracts';
import { FREEHAND_GEOMETRY_LIMITS_V2, quantizePointV2, validateBrushCandidateForSession, validateCandidateForSession, validateWorkV2 } from './v2-geometry';

const HISTORY_LIMIT_V2 = 30;
type Palette = WorkV2['palette'];
export type HistoryEntryV2 =
  | { kind: 'add'; operation: CutOperationV2 }
  | { kind: 'update'; index: number; before: CutOperationV2; after: CutOperationV2 }
  | { kind: 'delete'; index: number; operation: CutOperationV2 }
  | { kind: 'clear'; operations: WorkV2['operations'] }
  | { kind: 'palette'; before: Palette; after: Palette };

function failed<T>(message: string, path: string, code: CoreError['code'] = 'INVALID_INPUT'): Result<T, CoreError> {
  return { ok: false, error: { code, message, requestId: 'papercut-core-v2', fieldErrors: [{ path, message }] } };
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(input);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function cloneWork(work: WorkV2): WorkV2 {
  return WorkV2Schema.parse(work);
}

function publicState(work: WorkV2, undo: readonly HistoryEntryV2[], redo: readonly HistoryEntryV2[]): PapercutStateV2 {
  return { work: cloneWork(work), canUndo: undo.length > 0, canRedo: redo.length > 0 };
}

function samePalette(a: Palette, b: Palette): boolean {
  return a.paper === b.paper && a.background === b.background;
}

function sameOperation(a: CutOperationV2, b: CutOperationV2): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function reorder(operations: readonly CutOperationV2[]): CutOperationV2[] {
  return operations.map((operation, index) => operation.order === index ? operation : { ...operation, order: index });
}

function replaceAt(operations: readonly CutOperationV2[], index: number, operation: CutOperationV2): CutOperationV2[] {
  const next = operations.slice();
  next[index] = operation;
  return next;
}

function quantizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeAngle(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  const quantized = quantizeNumber(normalized);
  return quantized === 360 ? 0 : quantized;
}

export function applyHistoryEntryV2(work: WorkV2, entry: HistoryEntryV2, forward: boolean): WorkV2 {
  if (entry.kind === 'add') {
    const operations = forward ? [...work.operations, entry.operation] : work.operations.slice(0, -1);
    return { ...work, operations };
  }
  if (entry.kind === 'update') return { ...work, operations: replaceAt(work.operations, entry.index, forward ? entry.after : entry.before) };
  if (entry.kind === 'delete') {
    if (forward) return { ...work, operations: reorder(work.operations.filter((_operation, index) => index !== entry.index)) };
    const operations = work.operations.slice(); operations.splice(entry.index, 0, entry.operation);
    return { ...work, operations: reorder(operations) };
  }
  if (entry.kind === 'clear') return { ...work, operations: forward ? [] : entry.operations };
  return { ...work, palette: forward ? entry.after : entry.before };
}

function parseParametric(input: unknown): Result<ParametricCutV2, CoreError> {
  const parsed = ParametricCutV2Schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const rawVersion = record(input) ? input.parameterVersion : undefined;
  const unsupported = typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion > 0 && rawVersion !== 2;
  return failed('参数切口结构或版本非法', 'command.operation', unsupported ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT');
}

function parsePalette(input: unknown): Result<Palette, CoreError> {
  if (!record(input) || !exactKeys(input, ['paper', 'background'])) return failed('配色必须严格包含两个颜色', 'command.palette');
  const paper = ColorSchema.safeParse(input.paper), background = ColorSchema.safeParse(input.background);
  return paper.success && background.success
    ? { ok: true, value: { paper: paper.data, background: background.data } }
    : failed('配色必须为HEX6颜色', 'command.palette');
}

class SessionV2 implements PapercutSessionV2 {
  private work: WorkV2;
  private undo: HistoryEntryV2[] = [];
  private redo: HistoryEntryV2[] = [];

  constructor(work: WorkV2) { this.work = work; }

  current(): PapercutStateV2 { return publicState(this.work, this.undo, this.redo); }

  private commit(work: WorkV2, entry: HistoryEntryV2): Result<PapercutStateV2, CoreError> {
    const checked = validateWorkV2(work);
    if (!checked.ok) return checked.error.code === 'INVALID_INPUT'
      ? { ok: false, error: { ...checked.error, code: 'GEOMETRY_INVALID' } }
      : checked;
    this.work = work;
    this.undo = [...this.undo, entry].slice(-HISTORY_LIMIT_V2);
    this.redo = [];
    return { ok: true, value: this.current() };
  }

  dispatch(command: PapercutCommandV2): Result<PapercutStateV2, CoreError> {
    if (!record(command) || typeof command.type !== 'string') return failed('命令结构非法', 'command');
    if (command.type === 'undo' || command.type === 'redo') {
      if (!exactKeys(command, ['type'])) return failed('命令包含多余字段', 'command');
      const source = command.type === 'undo' ? this.undo : this.redo;
      const entry = source.at(-1);
      if (!entry) return { ok: true, value: this.current() };
      this.work = applyHistoryEntryV2(this.work, entry, command.type === 'redo');
      if (command.type === 'undo') {
        this.undo = this.undo.slice(0, -1); this.redo = [...this.redo, entry].slice(-HISTORY_LIMIT_V2);
      } else {
        this.redo = this.redo.slice(0, -1); this.undo = [...this.undo, entry].slice(-HISTORY_LIMIT_V2);
      }
      return { ok: true, value: this.current() };
    }
    if (command.type === 'add-parametric-cut') {
      if (!exactKeys(command, ['type', 'operation'])) return failed('命令包含多余字段', 'command');
      const parsed = parseParametric(command.operation); if (!parsed.ok) return parsed;
      const operation = parsed.value;
      if (operation.order !== this.work.operations.length) return failed('新操作顺序必须紧接当前末尾', 'command.operation.order');
      if (this.work.operations.some(current => current.id === operation.id)) return failed('操作ID不可重复', 'command.operation.id');
      const next = { ...this.work, operations: [...this.work.operations, operation] };
      return this.commit(next, { kind: 'add', operation });
    }
    if (command.type === 'add-freehand-cut') {
      if (!exactKeys(command, ['type', 'candidate'])) return failed('命令包含多余字段', 'command');
      const candidate = FreehandCandidateV2Schema.safeParse(command.candidate);
      if (!candidate.success) return failed('自由路径候选结构非法', 'command.candidate');
      const prepared = validateCandidateForSession(this.work, candidate.data); if (!prepared.ok) return prepared;
      const operation = prepared.value;
      const next = { ...this.work, operations: [...this.work.operations, operation] };
      return this.commit(next, { kind: 'add', operation });
    }
    if (command.type === 'add-brush-cut') {
      if (!exactKeys(command, ['type', 'candidate'])) return failed('命令包含多余字段', 'command');
      const candidate = BrushCandidateV2Schema.safeParse(command.candidate);
      if (!candidate.success) return failed('笔刷候选结构非法', 'command.candidate');
      const prepared = validateBrushCandidateForSession(this.work, candidate.data); if (!prepared.ok) return prepared;
      const operation = prepared.value;
      return this.commit({ ...this.work, operations: [...this.work.operations, operation] }, { kind: 'add', operation });
    }
    if (command.type === 'update-cut') {
      if (!exactKeys(command, ['type', 'operationId', 'change']) || !IdSchema.safeParse(command.operationId).success
        || !record(command.change) || typeof command.change.type !== 'string') return failed('更新命令结构非法', 'command');
      const index = this.work.operations.findIndex(operation => operation.id === command.operationId);
      if (index < 0) return failed('要更新的切口不存在', 'command.operationId');
      const before = this.work.operations[index]!;
      let after: CutOperationV2;
      if (command.change.type === 'translate') {
        if (!exactKeys(command.change, ['type', 'dx', 'dy'])
          || typeof command.change.dx !== 'number' || !Number.isFinite(command.change.dx)
          || typeof command.change.dy !== 'number' || !Number.isFinite(command.change.dy)) return failed('平移命令结构非法', 'command.change');
        const { dx, dy } = command.change;
        if (dx === 0 && dy === 0) return { ok: true, value: this.current() };
        after = before.kind === 'parametric'
          ? { ...before, center: { x: before.center.x + dx, y: before.center.y + dy } }
          : { ...before, points: before.points.map(point => quantizePointV2({ x: point.x + dx, y: point.y + dy })) };
      } else if (command.change.type === 'transform-parametric') {
        if (!exactKeys(command.change, ['type', 'center', 'width', 'height', 'angleDeg'])
          || before.kind !== 'parametric' || !record(command.change.center)
          || !exactKeys(command.change.center, ['x', 'y'])
          || typeof command.change.center.x !== 'number' || !Number.isFinite(command.change.center.x)
          || typeof command.change.center.y !== 'number' || !Number.isFinite(command.change.center.y)
          || typeof command.change.width !== 'number' || !Number.isFinite(command.change.width)
          || typeof command.change.height !== 'number' || !Number.isFinite(command.change.height)
          || typeof command.change.angleDeg !== 'number' || !Number.isFinite(command.change.angleDeg)) {
          return failed('参数图形变换命令结构非法', 'command.change');
        }
        after = {
          ...before,
          center: quantizePointV2(command.change.center),
          width: quantizeNumber(command.change.width),
          height: quantizeNumber(command.change.height),
          angleDeg: normalizeAngle(command.change.angleDeg),
        };
      } else return failed('更新命令类型非法', 'command.change.type');
      if (sameOperation(before, after)) return { ok: true, value: this.current() };
      const next = { ...this.work, operations: replaceAt(this.work.operations, index, after) };
      return this.commit(next, { kind: 'update', index, before, after });
    }
    if (command.type === 'duplicate-cut') {
      if (!exactKeys(command, ['type', 'operationId', 'newOperationId', 'dx', 'dy'])
        || !IdSchema.safeParse(command.operationId).success || !IdSchema.safeParse(command.newOperationId).success
        || typeof command.dx !== 'number' || !Number.isFinite(command.dx)
        || typeof command.dy !== 'number' || !Number.isFinite(command.dy)) return failed('复制命令结构非法', 'command');
      const original = this.work.operations.find(operation => operation.id === command.operationId);
      if (!original) return failed('要复制的切口不存在', 'command.operationId');
      if (this.work.operations.some(operation => operation.id === command.newOperationId)) return failed('操作ID不可重复', 'command.newOperationId');
      const copy = structuredClone(original);
      const operation: CutOperationV2 = copy.kind === 'parametric'
        ? { ...copy, id: command.newOperationId, order: this.work.operations.length, center: quantizePointV2({ x: copy.center.x + command.dx, y: copy.center.y + command.dy }) }
        : { ...copy, id: command.newOperationId, order: this.work.operations.length, points: copy.points.map(point => quantizePointV2({ x: point.x + command.dx, y: point.y + command.dy })) };
      return this.commit({ ...this.work, operations: [...this.work.operations, operation] }, { kind: 'add', operation });
    }
    if (command.type === 'delete-cut') {
      if (!exactKeys(command, ['type', 'operationId']) || !IdSchema.safeParse(command.operationId).success) return failed('删除命令结构非法', 'command');
      const index = this.work.operations.findIndex(operation => operation.id === command.operationId);
      if (index < 0) return failed('要删除的切口不存在', 'command.operationId');
      const operation = this.work.operations[index]!;
      const next = { ...this.work, operations: reorder(this.work.operations.filter((_value, operationIndex) => operationIndex !== index)) };
      return this.commit(next, { kind: 'delete', index, operation });
    }
    if (command.type === 'clear-cuts') {
      if (!exactKeys(command, ['type'])) return failed('命令包含多余字段', 'command');
      if (!this.work.operations.length) return { ok: true, value: this.current() };
      const operations = this.work.operations;
      return this.commit({ ...this.work, operations: [] }, { kind: 'clear', operations });
    }
    if (command.type === 'set-palette') {
      if (!exactKeys(command, ['type', 'palette'])) return failed('命令包含多余字段', 'command');
      const palette = parsePalette(command.palette); if (!palette.ok) return palette;
      if (samePalette(this.work.palette, palette.value)) return { ok: true, value: this.current() };
      const before = this.work.palette, after = palette.value;
      return this.commit({ ...this.work, palette: after }, { kind: 'palette', before, after });
    }
    return failed('未知命令', 'command.type');
  }
}

export function createSessionV2(input: unknown): Result<PapercutSessionV2, CoreError> {
  const checked = validateWorkV2(input);
  return checked.ok ? { ok: true, value: new SessionV2(checked.value) } : checked;
}

export function historyLimitV2(): number { return HISTORY_LIMIT_V2; }

export function totalFreehandPointsV2(work: WorkV2): number {
  return work.operations.reduce((sum, operation) => sum + (operation.kind === 'freehand' || operation.kind === 'brush' ? operation.points.length : 0), 0);
}

export function isWithinPlatformPointLimitV2(work: WorkV2): boolean {
  return totalFreehandPointsV2(work) <= FREEHAND_GEOMETRY_LIMITS_V2.totalMaxPoints;
}

export type { FreehandCutV2 };
