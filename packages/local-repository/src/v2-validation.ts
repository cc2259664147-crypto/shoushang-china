import {
  EditorProfileRegistryEntryV2Schema,
  WorkV2Schema,
  type AnyWork,
  type EditorProfileRegistryEntryV2,
  type Result,
  type StorageFailure,
  type WorkV1,
  type WorkV2,
} from '@shoushang/contracts';
import { createPapercutCore, getWorkGeometryV2 } from '@shoushang/papercut-core';

const REQUEST_ID = 'local-repository-v2-validation';
const v1Core = createPapercutCore();

type ValidationCode = 'INVALID_INPUT' | 'UNSUPPORTED_VERSION' | 'STORAGE_UNAVAILABLE';
type ValidationFailure = Omit<StorageFailure, 'code'> & { readonly code: ValidationCode };
type ValidationResult<T> = Result<T, ValidationFailure>;
type HistoricalMode = EditorProfileRegistryEntryV2['lifecycle']['historicalMode'];

export type ValidatedStoredWork =
  | { readonly schemaVersion: 1; readonly work: WorkV1 }
  | { readonly schemaVersion: 2; readonly work: WorkV2; readonly historicalMode: HistoricalMode };

export interface StorageValidationOptions {
  /** Primarily for capability injection in tests; omitted means globalThis.crypto. */
  readonly crypto?: { readonly subtle?: Pick<SubtleCrypto, 'digest'> } | null;
}

function failure(
  code: ValidationFailure['code'],
  message: string,
  path: string,
  fieldMessage = message,
): { ok: false; error: ValidationFailure } {
  return { ok: false, error: { code, message, requestId: REQUEST_ID, fieldErrors: [{ path, message: fieldMessage }] } };
}

function invalid(path: string, message: string): { ok: false; error: ValidationFailure } {
  return failure('INVALID_INPUT', '存储作品校验失败', path, message);
}

function readPath(input: unknown, path: readonly PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    try {
      current = Reflect.get(current, key);
    } catch {
      return undefined;
    }
  }
  return current;
}

const VERSION_FIELDS = new Set(['schemaVersion', 'profileSchemaVersion', 'geometryVersion', 'rendererVersion', 'parameterVersion']);

function hasUnsupportedVersion(input: unknown, issues: readonly { path: PropertyKey[] }[]): boolean {
  return issues.some(issue => {
    const field = String(issue.path.at(-1));
    const value = readPath(input, issue.path);
    return VERSION_FIELDS.has(field) && typeof value === 'number' && Number.isInteger(value) && value > 0;
  });
}

function schemaFailure(input: unknown, issues: readonly { path: PropertyKey[]; message: string }[]): { ok: false; error: ValidationFailure } {
  const unsupported = hasUnsupportedVersion(input, issues);
  return {
    ok: false,
    error: {
      code: unsupported ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT',
      message: unsupported ? '作品包含不支持的版本' : '存储作品结构损坏',
      requestId: REQUEST_ID,
      fieldErrors: issues.map(issue => ({ path: issue.path.join('.') || 'work', message: issue.message })),
    },
  };
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function canonicalize(value: unknown, ancestors: Set<object>, path: string): ValidationResult<string> {
  if (value === null) return { ok: true, value: 'null' };
  if (typeof value === 'boolean') return { ok: true, value: value ? 'true' : 'false' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid(path, 'JCS 只接受有限数');
    return { ok: true, value: JSON.stringify(value) };
  }
  if (typeof value === 'string') {
    if (!validUnicode(value)) return invalid(path, 'JCS 字符串不得包含孤立代理项');
    return { ok: true, value: JSON.stringify(value) };
  }
  if (typeof value !== 'object') return invalid(path, 'JCS 只接受严格 JSON 数据类型');
  if (ancestors.has(value)) return invalid(path, 'JCS 数据不得循环引用');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some(key => typeof key === 'symbol' || key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
        return invalid(path, 'JCS 数组不得包含额外属性');
      }
      const parts: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) return invalid(`${path}.${index}`, 'JCS 数组不得稀疏');
        const item = canonicalize(value[index], ancestors, `${path}.${index}`);
        if (!item.ok) return item;
        parts.push(item.value);
      }
      return { ok: true, value: `[${parts.join(',')}]` };
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) return invalid(path, 'JCS 对象必须是普通对象');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key === 'symbol')) return invalid(path, 'JCS 对象键必须是字符串');
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      if (!validUnicode(key)) return invalid(path, 'JCS 对象键不得包含孤立代理项');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid(`${path}.${key}`, 'JCS 对象只接受可枚举数据属性');
    }
    stringKeys.sort();
    const parts: string[] = [];
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return invalid(`${path}.${key}`, 'JCS 对象属性不可访问');
      const item = canonicalize(descriptor.value, ancestors, `${path}.${key}`);
      if (!item.ok) return item;
      parts.push(`${JSON.stringify(key)}:${item.value}`);
    }
    return { ok: true, value: `{${parts.join(',')}}` };
  } catch {
    return invalid(path, 'JCS 数据无法安全读取');
  } finally {
    ancestors.delete(value);
  }
}

/** RFC 8785/JCS canonical form for the strict JSON subset used by stored snapshots. */
export function canonicalizeJsonJcs(input: unknown): ValidationResult<string> {
  const result = canonicalize(input, new Set<object>(), 'value');
  if (!result.ok || typeof input !== 'object' || input === null) return result;
  try {
    // Structured clone rejects Proxy objects, including transparent proxies that
    // cannot otherwise be distinguished from their target in browser JavaScript.
    structuredClone(input);
    return result;
  } catch {
    return invalid('value', 'JCS 不接受代理对象或不可克隆对象');
  }
}

/** Lower-case SHA-256 of the UTF-8 JCS bytes, using browser Web Crypto only. */
export async function sha256CanonicalJson(input: unknown, options: StorageValidationOptions = {}): Promise<ValidationResult<string>> {
  const canonical = canonicalizeJsonJcs(input);
  if (!canonical.ok) return canonical;
  const cryptoProvider = Object.prototype.hasOwnProperty.call(options, 'crypto') ? options.crypto : globalThis.crypto;
  if (!cryptoProvider?.subtle) return failure('STORAGE_UNAVAILABLE', '浏览器加密能力不可用', 'crypto.subtle', '需要 Web Crypto SHA-256');
  try {
    const bytes = new TextEncoder().encode(canonical.value);
    const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
    return { ok: true, value: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
  } catch {
    return failure('STORAGE_UNAVAILABLE', '浏览器加密能力不可用', 'crypto.subtle', '无法计算 Web Crypto SHA-256');
  }
}

function registryMatch(
  work: WorkV2,
  registry: readonly EditorProfileRegistryEntryV2[],
): ValidationResult<EditorProfileRegistryEntryV2> {
  const parsedEntries: EditorProfileRegistryEntryV2[] = [];
  for (const [index, entry] of registry.entries()) {
    const parsed = EditorProfileRegistryEntryV2Schema.safeParse(entry);
    if (!parsed.success) return schemaFailure(entry, parsed.error.issues.map(issue => ({ ...issue, path: ['registry', index, ...issue.path] })));
    parsedEntries.push(parsed.data);
  }
  const snapshot = work.editorProfileSnapshot;
  const matches = parsedEntries.filter(entry => entry.profile.profileId === snapshot.profileId && entry.profile.profileVersion === snapshot.profileVersion);
  if (matches.length === 0) return failure('UNSUPPORTED_VERSION', '作品引用了未注册的编辑器配置', 'editorProfileSnapshot.profileVersion', '找不到匹配的 profileId + profileVersion');
  if (matches.length !== 1) return invalid('registry', 'profileId + profileVersion 必须唯一');
  return { ok: true, value: matches[0]! };
}

async function validateV2(
  input: unknown,
  registry: readonly EditorProfileRegistryEntryV2[],
  options: StorageValidationOptions,
): Promise<ValidationResult<{ work: WorkV2; entry: EditorProfileRegistryEntryV2 }>> {
  const parsed = WorkV2Schema.safeParse(input);
  if (!parsed.success) return schemaFailure(input, parsed.error.issues);
  const work = parsed.data;
  const geometry = getWorkGeometryV2(work);
  if (!geometry.ok) {
    const code = geometry.error.code === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT';
    return {
      ok: false,
      error: { code, message: code === 'UNSUPPORTED_VERSION' ? '作品包含不支持的几何版本' : '作品几何无效', requestId: REQUEST_ID, fieldErrors: geometry.error.fieldErrors },
    };
  }
  const match = registryMatch(work, registry);
  if (!match.ok) return match;
  const registeredCanonical = canonicalizeJsonJcs(match.value.profile);
  if (!registeredCanonical.ok) return registeredCanonical;
  const snapshotCanonical = canonicalizeJsonJcs(work.editorProfileSnapshot);
  if (!snapshotCanonical.ok) return snapshotCanonical;
  if (snapshotCanonical.value !== registeredCanonical.value) return invalid('editorProfileSnapshot', '完整编辑器配置快照与注册项不一致');
  const source = match.value.profile.sourceTemplate;
  if (work.templateSnapshot.id !== source.id || work.templateSnapshot.version !== source.version) {
    return invalid('templateSnapshot', '模板 id/version 与编辑器配置来源不一致');
  }
  const digest = await sha256CanonicalJson(work.templateSnapshot, options);
  if (!digest.ok) return digest;
  if (digest.value !== source.snapshotSha256) return invalid('templateSnapshot', '模板快照摘要不匹配');
  return { ok: true, value: { work, entry: match.value } };
}

/** Validate an existing v1/v2 record before historical restore. Disabled profiles remain restorable. */
export async function validateStoredWork(
  input: unknown,
  registry: readonly EditorProfileRegistryEntryV2[],
  options: StorageValidationOptions = {},
): Promise<ValidationResult<ValidatedStoredWork>> {
  const schemaVersion = readPath(input, ['schemaVersion']);
  if (schemaVersion === 1) {
    const checked = v1Core.validate(input);
    if (!checked.ok) {
      const code = checked.error.code === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT';
      return { ok: false, error: { code, message: checked.error.message, requestId: REQUEST_ID, fieldErrors: checked.error.fieldErrors } };
    }
    return { ok: true, value: { schemaVersion: 1, work: checked.value } };
  }
  if (schemaVersion === 2) {
    const checked = await validateV2(input, registry, options);
    if (!checked.ok) return checked;
    return { ok: true, value: { schemaVersion: 2, work: checked.value.work, historicalMode: checked.value.entry.lifecycle.historicalMode } };
  }
  if (typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > 0) {
    return failure('UNSUPPORTED_VERSION', '作品 schemaVersion 不受支持', 'schemaVersion');
  }
  return invalid('schemaVersion', '作品缺少有效 schemaVersion');
}

/** Validate a v2 work at the new/save-as boundary; disabled profiles are rejected here only. */
export async function validateNewOrSaveAsWorkV2(
  input: unknown,
  registry: readonly EditorProfileRegistryEntryV2[],
  options: StorageValidationOptions = {},
): Promise<ValidationResult<WorkV2>> {
  const checked = await validateV2(input, registry, options);
  if (!checked.ok) return checked;
  if (!checked.value.entry.lifecycle.newWorkEnabled) {
    return invalid('lifecycle.newWorkEnabled', '该编辑器配置已禁止新建或另存');
  }
  return { ok: true, value: checked.value.work };
}

export type { AnyWork };
