import { WorkSchema, CutOperationSchema, ColorSchema, type CoreError, type PapercutState, type Result, type Work } from '@shoushang/contracts';
import { failure, record, unknownVersion } from './errors';
import { createWorkValidator, type WorkValidator } from './validation';
export const HISTORY_LIMIT = 30;
const copy=(w:Work):Work=>WorkSchema.parse(w);
function copyState(s:PapercutState):PapercutState{return {work:copy(s.work),undo:s.undo.map(copy),redo:s.redo.map(copy)};}
// Object property order is irrelevant to immutable template identity.
function equal(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
 if(record(a)&&record(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));}
 return false;
}
function checkState(input:unknown,validateWork:WorkValidator):Result<PapercutState,CoreError>{
 if(!record(input)||Object.keys(input).some(k=>!['work','undo','redo'].includes(k))||!Array.isArray(input.undo)||!Array.isArray(input.redo))return failure('状态结构非法','state','INVALID_INPUT');
 const current=validateWork(input.work);if(!current.ok)return current;
 const groups:{undo:Work[];redo:Work[]}={undo:[],redo:[]};
 for(const key of ['undo','redo'] as const){
  const entries=input[key];
  if(!Array.isArray(entries))return failure('历史必须为数组',key,'INVALID_INPUT');
  if(entries.length>HISTORY_LIMIT)return failure('历史超过30步上限',key,'INVALID_INPUT');
  for(const [i,entry] of entries.entries()){
   const r=validateWork(entry);if(!r.ok)return {ok:false,error:{...r.error,fieldErrors:r.error.fieldErrors.map(e=>({...e,path:`${key}.${i}.${e.path}`}))}};
   if(r.value.id!==current.value.id||r.value.craftId!==current.value.craftId||!equal(r.value.templateSnapshot,current.value.templateSnapshot))return failure('历史必须属于同一作品及完整模板快照',`${key}.${i}`,'INVALID_INPUT');
   groups[key].push(r.value);
  }
 }
 return {ok:true,value:{work:current.value,...groups}};
}
export function dispatch(input:unknown,command:unknown):Result<PapercutState,CoreError>{
 const validateWork=createWorkValidator();
 const checked=checkState(input,validateWork);if(!checked.ok)return checked;const s=checked.value;
 if(!record(command))return failure('命令结构非法','command','INVALID_INPUT');
 const type=command.type;
 const keys=type==='add-cut'?['type','operation']:type==='set-palette'?['type','palette']:['type'];
 if(typeof type!=='string'||!['add-cut','undo','redo','set-palette'].includes(type)||Object.keys(command).some(k=>!keys.includes(k)))return failure('未知命令或多余字段','command.type','INVALID_INPUT');
 if(type==='undo'||type==='redo'){
  const from=s[type],last=from.at(-1);
  if(!last)return {ok:true,value:copyState(s)};
  // Only creative content is restored. All current metadata and template are retained.
  const work=copy({...s.work,operations:last.operations,palette:last.palette});
  return {ok:true,value:type==='undo'?{work,undo:s.undo.slice(0,-1).map(copy),redo:[...s.redo.map(copy),copy(s.work)].slice(-HISTORY_LIMIT)}:{work,redo:s.redo.slice(0,-1).map(copy),undo:[...s.undo.map(copy),copy(s.work)].slice(-HISTORY_LIMIT)}};
 }
 const next=copy(s.work);
 if(type==='add-cut'){
  const op=CutOperationSchema.safeParse(command.operation);
  if(!op.success)return {ok:false,error:{code:op.error.issues.some(i=>i.code==='invalid_value'&&i.path.at(-1)==='parameterVersion'&&unknownVersion(command.operation,i.path))?'UNSUPPORTED_VERSION':'INVALID_INPUT',message:'剪切参数非法',requestId:'papercut-core-v1',fieldErrors:op.error.issues.map(i=>({path:`command.operation.${i.path.join('.')}`,message:i.message}))}};
  next.operations.push(op.data);
 }else{
  const p=command.palette;
  if(!record(p)||Object.keys(p).length!==2||!ColorSchema.safeParse(p.paper).success||!ColorSchema.safeParse(p.background).success)return failure('配色必须包含两个HEX6颜色','command.palette','INVALID_INPUT');
  // ColorSchema re-parsing provides checked values without assertions.
  next.palette={paper:ColorSchema.parse(p.paper),background:ColorSchema.parse(p.background)};
  if(equal(next.palette,s.work.palette))return {ok:true,value:copyState(s)};
 }
 const result=validateWork(next);return result.ok?{ok:true,value:{work:result.value,undo:[...s.undo.map(copy),copy(s.work)].slice(-HISTORY_LIMIT),redo:[]}}:result;
}
