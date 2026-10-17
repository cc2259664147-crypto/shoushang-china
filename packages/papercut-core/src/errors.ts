import type { CoreError, Result } from '@shoushang/contracts';
export function failure(message: string, path: string, code: CoreError['code'] = 'GEOMETRY_INVALID'): Result<never, CoreError> {
  return { ok: false, error: { code, message, requestId: 'papercut-core-v1', fieldErrors: [{ path, message }] } };
}
export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** Missing/malformed version fields are input errors; a different positive integer is a version failure. */
export function unknownVersion(input:unknown,path:readonly PropertyKey[]):boolean {
 let value:unknown=input;
 for(const key of path){if(Array.isArray(value)&&typeof key==='number')value=value[key];else if(record(value)&&typeof key==='string')value=value[key];else return false;}
 return typeof value==='number'&&Number.isInteger(value)&&value>0&&value!==1;
}
