import type { PapercutCore } from '@shoushang/contracts';
import type { PapercutCoreV2 } from '@shoushang/contracts';
import { validateWork } from './validation';
import { dispatch } from './history';
import { prepareBrushCutV2, prepareFreehandCutV2 } from './v2-geometry';
import { createSessionV2 } from './v2-session';
export type { PapercutCommand, PapercutState, PapercutCore, CoreError, Work, CutOperation, TemplateVersion, Result } from '@shoushang/contracts';
export type { PapercutCommandV2, PapercutStateV2, PapercutSessionV2, PapercutCoreV2, WorkV2, CutOperationV2, BrushCandidateV2, BrushCutV2, FreehandCutV2, ParametricCutV2, FreehandCandidateV2 } from '@shoushang/contracts';
export type { Point, AffineTransform, Cubic, LocalShape, CutGeometry, WorkGeometry } from './geometry';
export { GEOMETRY_TOLERANCES } from './geometry';
export { HISTORY_LIMIT } from './history';
export { getWorkGeometry } from './validation';
export type { LocalShapeV2, PaperStrokeV2, CutGeometryV2, WorkGeometryV2 } from './v2-geometry';
export { FREEHAND_GEOMETRY_LIMITS_V2, getWorkGeometryV2 } from './v2-geometry';
export function createPapercutCore() {
 return {validate:validateWork,dispatch,createState(work:unknown){const r=validateWork(work);return r.ok?{ok:true,value:{work:r.value,undo:[],redo:[]}}:r;}} satisfies PapercutCore;
}
export function createPapercutCoreV2() {
 return { prepareFreehandCut: prepareFreehandCutV2, prepareBrushCut: prepareBrushCutV2, createSession: createSessionV2 } satisfies PapercutCoreV2;
}
