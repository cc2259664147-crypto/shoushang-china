import type { PapercutCore } from '@shoushang/contracts';
import { validateWork } from './validation';
import { dispatch } from './history';
export type { PapercutCommand, PapercutState, PapercutCore, CoreError, Work, CutOperation, TemplateVersion, Result } from '@shoushang/contracts';
export type { Point, AffineTransform, Cubic, LocalShape, CutGeometry, WorkGeometry } from './geometry';
export { GEOMETRY_TOLERANCES } from './geometry';
export { HISTORY_LIMIT } from './history';
export { getWorkGeometry } from './validation';
export function createPapercutCore() {
 return {validate:validateWork,dispatch,createState(work:unknown){const r=validateWork(work);return r.ok?{ok:true,value:{work:r.value,undo:[],redo:[]}}:r;}} satisfies PapercutCore;
}
