import { PaginationSchema, WorkSchema } from '@shoushang/contracts';
import type { LocalRepository, StorageFailure, Work } from '@shoushang/contracts';

export interface MemoryRepositoryOptions {
  readonly failure?: 'STORAGE_UNAVAILABLE' | 'QUOTA_EXCEEDED';
  readonly maxWorks?: number;
  readonly now?: () => string;
}
function error(code: Exclude<StorageFailure['code'], 'REVISION_CONFLICT'>, message: string): { ok: false; error: StorageFailure } {
  return { ok: false, error: { code, message, requestId: 'memory-repository-request', fieldErrors: [] } };
}
function conflict(expectedRevision: number | null, actualRevision: number | null): { ok: false; error: StorageFailure } {
  return { ok: false, error: { code: 'REVISION_CONFLICT', message: '作品已被修改，请保留当前内容并另存副本', requestId: 'memory-repository-request', fieldErrors: [], expectedRevision, actualRevision } };
}
/** TEST ONLY. In-memory records disappear on refresh/process exit. Never a persistence substitute. */
export function createMemoryRepository(options: MemoryRepositoryOptions = {}): LocalRepository {
  const records = new Map<string, Work>();
  const now = options.now ?? (() => new Date().toISOString());
  const unavailable = () => options.failure === 'STORAGE_UNAVAILABLE' ? error('STORAGE_UNAVAILABLE', '测试：存储不可用') : undefined;
  const writeFailure = () => unavailable() ?? (options.failure === 'QUOTA_EXCEEDED' ? error('QUOTA_EXCEEDED', '测试：容量不足') : undefined);
  return {
    persistence: 'memory',
    async list(query = {}) {
      const failure = unavailable(); if (failure) return failure;
      const p = PaginationSchema.safeParse({ page: query.page, pageSize: query.pageSize });
      if (!p.success || (query.status !== undefined && query.status !== 'draft' && query.status !== 'completed')) return error('INVALID_INPUT', '列表参数非法');
      const { page, pageSize } = p.data;
      const rows = [...records.values()].filter(w => !query.status || w.status === query.status).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
      return { ok: true, value: structuredClone({ items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }) };
    },
    async read(id) {
      const failure = unavailable(); if (failure) return failure;
      const work = records.get(id);
      return work ? { ok: true, value: structuredClone(work) } : error('NOT_FOUND', '作品不存在');
    },
    async save(input) {
      const failure = writeFailure(); if (failure) return failure;
      const parsed = WorkSchema.safeParse(input.work);
      if (!parsed.success || (input.expectedRevision !== null && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0))) return error('INVALID_INPUT', '作品或预期修订非法');
      const current = records.get(parsed.data.id);
      if ((current?.revision ?? null) !== input.expectedRevision) return conflict(input.expectedRevision, current?.revision ?? null);
      if (!current && records.size >= (options.maxWorks ?? 100)) return error('QUOTA_EXCEEDED', '已达到作品数量限制');
      if (parsed.data.revision !== (input.expectedRevision ?? 0)) return error('INVALID_INPUT', '作品修订必须与预期修订一致，新作品为0');
      const saved = WorkSchema.safeParse({ ...parsed.data, createdAt: current?.createdAt ?? parsed.data.createdAt, updatedAt: now(), revision: (current?.revision ?? 0) + 1 });
      if (!saved.success) return error('INVALID_INPUT', '保存时间或作品字段非法');
      records.set(saved.data.id, structuredClone(saved.data));
      return { ok: true, value: structuredClone(saved.data) };
    },
    async delete(id, expectedRevision) {
      const failure = writeFailure(); if (failure) return failure;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return error('INVALID_INPUT', '修订号非法');
      const current = records.get(id);
      if (!current) return error('NOT_FOUND', '作品不存在');
      if (current.revision !== expectedRevision) return conflict(expectedRevision, current.revision);
      records.delete(id);
      return { ok: true, value: { id } };
    },
  };
}
