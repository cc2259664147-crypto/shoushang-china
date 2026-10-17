import { describe,it,expect,vi } from 'vitest';
import type { Result, PapercutState, Work } from '@shoushang/contracts';
import { createPapercutCore, getWorkGeometry } from './index';
import { GOLDEN, operation, work } from './test-data';
import * as geometryModule from './geometry';
const core=createPapercutCore();
function unwrap<T>(r:Result<T>):T{if(!r.ok)throw Error(r.error.message);return r.value;}
const state=():PapercutState=>unwrap(core.createState(work()));
const add=(s:PapercutState)=>unwrap(core.dispatch(s,{type:'add-cut',operation:operation(s.work.operations.length)}));
function freeze(v:unknown):void{if(typeof v==='object'&&v!==null){Object.freeze(v);for(const child of Object.values(v))freeze(child);}}
function rejects(input:unknown,code?:string){const r=core.validate(input);expect(r.ok).toBe(false);if(!r.ok){expect(r.error.fieldErrors.length).toBeGreaterThan(0);if(code)expect(r.error.code).toBe(code);}}
describe('formal papercut core',()=>{
 for(const radial of [false,true])for(const shape of ['triangle','circle','teardrop'] as const)it(`${shape} / ${radial?'radial4':'vertical'}`,()=>{const w=work(radial);w.operations=[operation(0,shape,radial)];freeze(w);expect(core.validate(w).ok).toBe(true);const g=unwrap(getWorkGeometry(w));expect(g.cuts).toHaveLength(1);expect(g.symmetryTransforms).toHaveLength(radial?4:2);expect(g.overlap).toBe('union');});
 it('fixed golden local paths, control points, placement and transforms',()=>{
  const w=work();w.operations=[operation()];const g=unwrap(getWorkGeometry(w)),cut=g.cuts[0]!;
  expect(cut.localShape).toEqual({kind:'polygon',vertices:GOLDEN.triangleLocal});
  cut.conservativeContour.forEach((p,i)=>{expect(p.x).toBeCloseTo(GOLDEN.trianglePlaced[i]!.x,12);expect(p.y).toBeCloseTo(GOLDEN.trianglePlaced[i]!.y,12);});
  w.operations=[operation(0,'teardrop')];expect(unwrap(getWorkGeometry(w)).cuts[0]!.localShape).toEqual({kind:'cubic-loop',curves:[GOLDEN.dropLeft,GOLDEN.dropRight]});
  w.operations=[operation(0,'circle')];expect(unwrap(getWorkGeometry(w)).cuts[0]!.localShape).toEqual({kind:'ellipse',radiusX:.05,radiusY:.06});
  const radial=unwrap(getWorkGeometry(work(true)));radial.symmetryTransforms.forEach((m,i)=>{expect({x:m.a*.7+m.c*.8+m.e,y:m.b*.7+m.d*.8+m.f}).toEqual(expect.objectContaining({x:expect.closeTo(GOLDEN.radialCenterCopies[i]!.x,12),y:expect.closeTo(GOLDEN.radialCenterCopies[i]!.y,12)}));});
  expect(g.symmetryTransforms[1]).toEqual({a:-1,b:0,c:0,d:1,e:1,f:0});
  w.operations=[{...operation(),angleDeg:90}];const rotated=unwrap(getWorkGeometry(w)).cuts[0]!.conservativeContour[0]!;expect(rotated.x).toBeCloseTo(.31);expect(rotated.y).toBeCloseTo(.35);
 });
 it('triangle exact boundary; conservative ellipse and drop near boundaries',()=>{
  const w=work();w.operations=[{...operation(),center:{x:.45,y:.35}}];expect(core.validate(w).ok).toBe(true);
  w.operations[0]!.center.x+=1e-7;rejects(w,'GEOMETRY_INVALID');
  for(const shape of ['circle','teardrop'] as const){w.operations=[{...operation(0,shape),angleDeg:17,center:{x:.25,y:.35}}];const g=unwrap(getWorkGeometry(w)).cuts[0]!;expect(g.conservativeContour.length).toBeGreaterThan(100);expect(core.validate(w).ok).toBe(true);w.operations[0]!.center.x=.49;rejects(w,'GEOMETRY_INVALID');}
 });
 it('ellipse tangent is conservatively rejected while a safe inset passes',()=>{
  const w=work(),angle=17*Math.PI/180;
  // Exact support of a rotated ellipse; independent of the polygon approximation.
  const support=Math.hypot(.05*Math.cos(angle),.06*Math.sin(angle));
  w.operations=[{...operation(0,'circle'),angleDeg:17,center:{x:.5-support,y:.35}}];
  rejects(w,'GEOMETRY_INVALID');w.operations[0]!.center.x-=.0001;expect(core.validate(w).ok).toBe(true);
 });
 it('drop retains exact cubic data and conservative hull covers independent curve samples',()=>{
  const w=work();w.operations=[operation(0,'teardrop')];const g=unwrap(getWorkGeometry(w)).cuts[0]!;
  const xs=g.conservativeContour.map(p=>p.x),ys=g.conservativeContour.map(p=>p.y);
  expect(Math.min(...xs)).toBeLessThanOrEqual(.2);expect(Math.max(...xs)).toBeGreaterThanOrEqual(.3);
  expect(Math.min(...ys)).toBeCloseTo(.29);expect(Math.max(...ys)).toBeCloseTo(.41);
  // B(.5) on left/right is (+/-w/2, 3h/16), before placement.
  expect(g.localShape.kind).toBe('cubic-loop');
  expect(.35+3*.12/16).toBeLessThan(Math.max(...ys));
  w.operations[0]!.center.x=.4499;expect(core.validate(w).ok).toBe(true);
  w.operations[0]!.center.x=.4501;rejects(w);
 });
 it('allowed-region boundary has no additional gap',()=>{
  const w=work();w.templateSnapshot.geometry.allowedRegion=[{x:.1,y:.1},{x:.4,y:.1},{x:.4,y:.8},{x:.1,y:.8}];
  w.operations=[{...operation(),center:{x:.35,y:.3}}];expect(core.validate(w).ok).toBe(true);
 });
 it('real edge gap differs from fold edge; full rotated contour matters',()=>{const w=work();w.operations=[{...operation(),center:{x:.075,y:.2}}];expect(core.validate(w).ok).toBe(true);w.operations[0]!.center.x=.074;rejects(w);w.operations=[{...operation(),center:{x:.45,y:.2}}];expect(core.validate(w).ok).toBe(true);w.operations=[{...operation(),width:.02,height:.2,angleDeg:90,center:{x:.46,y:.4}}];rejects(w);});
 it('CW / CCW convex and invalid polygons',()=>{const w=work();w.templateSnapshot.geometry.allowedRegion.reverse();expect(core.validate(w).ok).toBe(true);for(const ps of [[{x:0,y:0},{x:.2,y:0},{x:.4,y:0}],[{x:0,y:0},{x:.5,y:0},{x:.5,y:0},{x:0,y:1}],[{x:0,y:0},{x:.5,y:1},{x:.5,y:0},{x:0,y:1}],[{x:0,y:0},{x:.5,y:0},{x:.2,y:.2},{x:.5,y:1},{x:0,y:1}]]){w.templateSnapshot.geometry.allowedRegion=ps;rejects(w,'GEOMETRY_INVALID');}});
 it('malformed runtime input and numerical, structural and version errors',()=>{
  for(const input of [null,{},[],{...work(),schemaVersion:2},{...work(),templateSnapshot:{...work().templateSnapshot,geometryVersion:2}},{...work(),operations:[{...operation(),parameterVersion:2}]}])rejects(input);
  rejects({...work(),schemaVersion:2},'UNSUPPORTED_VERSION');rejects({...work(),schemaVersion:'bad'},'INVALID_INPUT');
  for(const o of [{...operation(),width:NaN},{...operation(),height:Infinity},{...operation(),width:0},{...operation(),angleDeg:360},{...operation(),center:{x:-1,y:0}},{...operation(),shape:'square'},{...operation(),order:1},{...operation(),width:.3}])rejects({...work(),operations:[o]});
  rejects({...work(),operations:[operation(),{...operation(1),id:'cut-0'}]});
  const w=work();w.templateSnapshot.allowedCuts=w.templateSnapshot.allowedCuts.filter(l=>l.shape!=='circle');w.operations=[operation(0,'circle')];rejects(w);
  for(const cmd of [null,{}, {type:Object.create(null)}, {type:'wat'},{type:'set-palette',palette:{paper:'red',background:'#FFFFFF'}},{type:'undo',extra:true},{type:'add-cut',operation:null}])expect(core.dispatch(state(),cmd).ok).toBe(false);
  for(const s of [null,{}, {...state(),undo:[null]},{...state(),redo:'bad'}])expect(core.dispatch(s,{type:'undo'}).ok).toBe(false);
  expect(getWorkGeometry(null).ok).toBe(false);
 });
 it('known unsupported configurations have specific errors',()=>{const w=work();w.templateSnapshot.geometry.basePaper={kind:'circle'};rejects(w,'UNSUPPORTED_VERSION');for(const symmetry of [{kind:'reflection',axis:'both'},{kind:'reflection',axis:'horizontal'},{kind:'radial',sectors:6,mirror:false},{kind:'radial',sectors:8,mirror:false},{kind:'radial',sectors:4,mirror:true}] as const){const w=work();w.templateSnapshot.geometry.symmetry=symmetry;rejects(w,'UNSUPPORTED_VERSION');}});
 it('100 hard limit, smaller template limit, last 30 undo/redo steps',()=>{let s=state();for(let i=0;i<100;i++)s=add(s);expect(s.undo).toHaveLength(30);expect(core.dispatch(s,{type:'add-cut',operation:operation(100)}).ok).toBe(false);for(let i=0;i<30;i++)s=unwrap(core.dispatch(s,{type:'undo'}));expect(s.work.operations).toHaveLength(70);for(let i=0;i<30;i++)s=unwrap(core.dispatch(s,{type:'redo'}));expect(s.work.operations).toHaveLength(100);rejects({...s.work,operations:[...s.work.operations,operation(100)]},'INVALID_INPUT');const w=work();w.templateSnapshot.rules.maxOperations=1;const a=add(unwrap(core.createState(w)));expect(core.dispatch(a,{type:'add-cut',operation:operation(1)}).ok).toBe(false);});
 it('palette, branches, empty and same-palette no-ops, invalid command leaves all history untouched',()=>{const s=state();expect(unwrap(core.dispatch(s,{type:'undo'}))).toEqual(s);expect(unwrap(core.dispatch(s,{type:'redo'}))).toEqual(s);const a=add(s),p=unwrap(core.dispatch(a,{type:'set-palette',palette:{paper:'#001122',background:'#FFFFFF'}}));expect(p.work.operations).toHaveLength(1);const u=unwrap(core.dispatch(p,{type:'undo'}));expect(u.work.palette).toEqual(a.work.palette);expect(unwrap(core.dispatch(u,{type:'set-palette',palette:u.work.palette}))).toEqual(u);expect(add(u).redo).toHaveLength(0);const before=JSON.stringify(u);freeze(u);expect(core.dispatch(u,{type:'add-cut',operation:operation(9)}).ok).toBe(false);expect(JSON.stringify(u)).toBe(before);expect(unwrap(core.dispatch(u,{type:'redo'})).work.palette).toEqual(p.work.palette);});
 it('undo and redo preserve current name and all save metadata for cuts and palette',()=>{
  let s=add(state());s=unwrap(core.dispatch(s,{type:'set-palette',palette:{paper:'#001122',background:'#FFFFFF'}}));
  const saved:Work={...s.work,name:'保存后的新名称',revision:9,createdAt:'2026-10-17T01:00:00Z',updatedAt:'2026-10-17T02:00:00Z',status:'completed'};s={...s,work:saved};
  const metadata=(w:Work)=>{const {operations:cuts,palette,...rest}=w;void cuts;void palette;return rest;};
  for(const type of ['undo','undo','redo','redo'] as const){s=unwrap(core.dispatch(s,{type}));expect(metadata(s.work)).toEqual(metadata(saved));}
  expect(s.work.operations).toHaveLength(1);expect(s.work.palette.paper).toBe('#001122');
 });
 it('rejects forged cross-work and cross-template histories including same ID/version edited snapshots',()=>{const s=add(state());for(const change of [(w:Work)=>{w.id='other';},(w:Work)=>{w.templateSnapshot.version=2;},(w:Work)=>{w.templateSnapshot.name='changed';}]){const h=work();change(h);expect(core.dispatch({...s,undo:[h]},{type:'undo'}).ok).toBe(false);expect(core.dispatch({...s,redo:[h]},{type:'redo'}).ok).toBe(false);}});
 it('frozen inputs, template snapshots and all returned/history objects are independent',()=>{const w=work(),s=unwrap(core.createState(w));w.templateSnapshot.name='external';expect(s.work.templateSnapshot.name).not.toBe('external');freeze(s);const cmd={type:'add-cut',operation:operation()};freeze(cmd);const a=unwrap(core.dispatch(s,cmd));a.work.palette.paper='#000000';a.work.templateSnapshot.name='output';expect(a.undo[0]!.palette.paper).toBe(s.work.palette.paper);expect(a.undo[0]!.templateSnapshot.name).toBe(s.work.templateSnapshot.name);const u=unwrap(core.dispatch(add(state()),{type:'undo'}));u.work.templateSnapshot.name='mutated';expect(u.redo[0]!.templateSnapshot.name).not.toBe('mutated');const g=unwrap(getWorkGeometry({...work(),operations:[operation()]}));g.cuts[0]!.conservativeContour[0]!.x=999;expect(operation().center.x).toBe(.25);});
});

describe('history geometry reuse without trusting mutable inputs',()=>{
 function loaded(count:number,distinct=false):PapercutState{
  const w=work();w.operations=Array.from({length:count},(_,i)=>({...operation(i,'teardrop'),angleDeg:distinct?i:0}));
  // Deliberately distinct object instances, as after serializing/restoring history.
  const undo=Array.from({length:30},(_,i)=>unwrap(core.validate({...w,operations:w.operations.slice(0,count-30+i)})));
  return {work:w,undo,redo:[]};
 }
 const palette={paper:'#000000',background:'#FFFFFF'};
 for(const count of [50,100])it(`${count} distinct curve cuts plus 30 snapshots only construct each distinct geometry once`,()=>{
  const s=loaded(count,true),before=JSON.stringify(s);freeze(s);
  const spy=vi.spyOn(geometryModule,'cutGeometry');
  try{
   const next=unwrap(core.dispatch(s,{type:'set-palette',palette}));
   expect(next.work.palette).toEqual(palette);expect(next.undo).toHaveLength(30);
   expect(spy).toHaveBeenCalledTimes(count);
   expect(JSON.stringify(s)).toBe(before);
  }finally{spy.mockRestore();}
 });
 it('identical shapes reuse geometry despite different operation IDs and snapshot object identities',()=>{
  const s=loaded(100),spy=vi.spyOn(geometryModule,'cutGeometry');
  try{expect(core.dispatch(s,{type:'set-palette',palette}).ok).toBe(true);expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
 });
 it('rechecks edited nested history values on the next call and returns the correct history path',()=>{
  const s=loaded(50);expect(core.dispatch(s,{type:'set-palette',palette}).ok).toBe(true);
  s.undo[7]!.operations[3]!.center.x=.499;
  const before=JSON.stringify(s),r=core.dispatch(s,{type:'set-palette',palette});
  expect(r.ok).toBe(false);if(!r.ok)expect(r.error.fieldErrors[0]!.path).toBe('undo.7.operations.3.center');
  expect(JSON.stringify(s)).toBe(before);
 });
 it('rechecks current geometry, order, duplicate IDs and history templates after a successful call',()=>{
  for(const change of [
   (s:PapercutState)=>{s.work.operations[0]!.center.x=.499;},
   (s:PapercutState)=>{s.undo[3]!.operations[0]!.order=9;},
   (s:PapercutState)=>{s.undo[3]!.operations[1]!.id=s.undo[3]!.operations[0]!.id;},
   (s:PapercutState)=>{s.undo[3]!.templateSnapshot.rules.minEdgeGap=.4;},
   (s:PapercutState)=>{s.undo[3]!.id='foreign';},
  ]){const s=loaded(50);expect(core.dispatch(s,{type:'set-palette',palette}).ok).toBe(true);change(s);expect(core.dispatch(s,{type:'set-palette',palette}).ok).toBe(false);}
 });
 it('does not reuse geometry across changed templates, or overlook an invalid redo branch',()=>{
  const s=loaded(50);expect(core.dispatch(s,{type:'set-palette',palette}).ok).toBe(true);
  const changed=work();changed.templateSnapshot.rules.minEdgeGap=.4;changed.operations=[operation(0,'teardrop')];
  expect(core.dispatch({work:changed,undo:[],redo:[]},{type:'set-palette',palette}).ok).toBe(false);
  const redo=work();redo.operations=[{...operation(0,'teardrop'),center:{x:.499,y:.35}}];
  expect(core.dispatch({...s,redo:[redo]},{type:'set-palette',palette}).ok).toBe(false);
 });
 it('undo and redo also deduplicate geometry and keep results isolated',()=>{
  const s=loaded(50,true),spy=vi.spyOn(geometryModule,'cutGeometry');
  try{
   const u=unwrap(core.dispatch(s,{type:'undo'}));expect(spy).toHaveBeenCalledTimes(50);spy.mockClear();
   const r=unwrap(core.dispatch(u,{type:'redo'}));expect(spy).toHaveBeenCalledTimes(50);
   expect(r.work).toEqual(s.work);r.work.operations[0]!.center.x=.1;
   expect(s.work.operations[0]!.center.x).toBe(.25);expect(r.undo[0]!.operations[0]!.center.x).toBe(.25);
  }finally{spy.mockRestore();}
 });
});
