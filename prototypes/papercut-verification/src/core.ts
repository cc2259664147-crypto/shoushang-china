import { CutOperationSchema, WorkSchema, type Work, type TemplateVersion, type CutOperation, type PapercutCore, type CoreError, type Result, type PapercutState } from '@shoushang/contracts';
export type Point = {x:number;y:number};
export const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v)) as T;
export function fail(message:string, code:CoreError['code']='GEOMETRY_INVALID'): {ok:false;error:CoreError} { return {ok:false,error:{code,message,requestId:'m02-local',fieldErrors:[]}}; }
const cross=(a:Point,b:Point,p:Point)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
export function polygon(points:Point[]): boolean {
 if(points.length<3)return false;
 const area=points.reduce((s,a,i)=>{const b=points[(i+1)%points.length]!;return s+a.x*b.y-a.y*b.x;},0);
 if(Math.abs(area)<1e-10)return false;
 return points.every((a,i)=>{const b=points[(i+1)%points.length]!;return Math.hypot(a.x-b.x,a.y-b.y)>1e-10 && points.every(p=>cross(a,b,p)*Math.sign(area)>=-1e-10);});
}
function inside(points:Point[],p:Point){const area=points.reduce((s,a,i)=>{const b=points[(i+1)%points.length]!;return s+a.x*b.y-a.y*b.x;},0);return points.every((a,i)=>cross(a,points[(i+1)%points.length]!,p)*Math.sign(area)>=-1e-10*Math.hypot(points[(i+1)%points.length]!.x-a.x,points[(i+1)%points.length]!.y-a.y));}
export function supported(t:TemplateVersion):string|undefined {
 const s=t.geometry.symmetry;
 if(t.geometry.basePaper.kind!=='square')return '原型暂不支持圆纸';
 if(!(s.kind==='reflection'&&s.axis==='vertical'||s.kind==='radial'&&s.sectors===4&&!s.mirror))return '原型不支持此对称配置';
 if(!polygon(t.geometry.allowedRegion))return '允许区域必须为非退化凸多边形';
 return undefined;
}
export function transform(o:CutOperation,p:Point):Point{const r=o.angleDeg*Math.PI/180;return {x:o.center.x+p.x*Math.cos(r)-p.y*Math.sin(r),y:o.center.y+p.x*Math.sin(r)+p.y*Math.cos(r)};}
export function drop(w:number,h:number):Point[][] {return [[{x:0,y:-h/2},{x:-2*w/3,y:0},{x:-2*w/3,y:h/2},{x:0,y:h/2}],[{x:0,y:h/2},{x:2*w/3,y:h/2},{x:2*w/3,y:0},{x:0,y:-h/2}]];}
function bezierHull(p:Point[],depth=0):Point[]{const [a,b,c,d]=p as [Point,Point,Point,Point];const length=Math.hypot(d.x-a.x,d.y-a.y);const distance=(v:Point)=>length ? Math.abs(cross(a,d,v))/length : Math.hypot(v.x-a.x,v.y-a.y);if(Math.max(distance(b),distance(c))<=1e-5)return p;if(depth===16)throw Error('曲线近似未收敛');const mid=(u:Point,v:Point)=>({x:(u.x+v.x)/2,y:(u.y+v.y)/2});const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);return [...bezierHull([a,ab,abc,m],depth+1),...bezierHull([m,bcd,cd,d],depth+1)];}
export function contour(o:CutOperation):Point[]{const w=o.width,h=o.height;const pts=o.shape==='triangle'?[{x:0,y:-h/2},{x:-w/2,y:h/2},{x:w/2,y:h/2}]:o.shape==='circle'?Array.from({length:128},(_,i)=>({x:w/2*Math.cos((i+.5)*Math.PI/64)/Math.cos(Math.PI/128),y:h/2*Math.sin((i+.5)*Math.PI/64)/Math.cos(Math.PI/128)})):drop(w,h).flatMap(p=>bezierHull(p));return pts.map(p=>transform(o,p));}
export function copies(t:TemplateVersion,p:Point):Point[]{if(t.geometry.symmetry.kind==='reflection')return [p,{x:1-p.x,y:p.y}];return Array.from({length:4},(_,i)=>{const r=i*Math.PI/2;return {x:.5+(p.x-.5)*Math.cos(r)-(p.y-.5)*Math.sin(r),y:.5+(p.x-.5)*Math.sin(r)+(p.y-.5)*Math.cos(r)};});}
function checkCut(t:TemplateVersion,o:CutOperation):string|undefined {
 const limit=t.allowedCuts.find(l=>l.shape===o.shape);if(!limit)return '模板不允许此形状';
 if(o.width<limit.minWidth||o.width>limit.maxWidth||o.height<limit.minHeight||o.height>limit.maxHeight)return '尺寸超出模板限制';
 const pts=contour(o),s=t.geometry.symmetry;
 if(pts.some(p=>!inside(t.geometry.allowedRegion,p)))return '旋转后完整轮廓超出允许区域';
 if(pts.some(p=>s.kind==='reflection'?p.x>.5+1e-10:p.x<.5-1e-10||p.y<.5-1e-10))return '完整轮廓超出对称基础域（折叠边界）';
 const gap=t.rules.minEdgeGap;
 if(pts.flatMap(p=>copies(t,p)).some(p=>p.x<gap-1e-10||p.x>1-gap+1e-10||p.y<gap-1e-10||p.y>1-gap+1e-10))return '切口到真实纸边的间距不足';
 return undefined;
}
export const core:PapercutCore={
 validate(input){
 const parsed=WorkSchema.safeParse(input);if(!parsed.success){const version=parsed.error.issues.some(i=>i.path.some(p=>String(p).endsWith('Version')));return fail(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),version?'UNSUPPORTED_VERSION':'INVALID_INPUT');}
 const w=parsed.data,t=w.templateSnapshot,reason=supported(t);if(reason)return fail(reason,'UNSUPPORTED_VERSION');
 if(w.operations.length>t.rules.maxOperations)return fail('达到模板操作数量上限');
 for(const o of w.operations){const reason=checkCut(t,o);if(reason)return fail(reason);}
 return {ok:true,value:clone(w)};
 },
 createState(work){const r=core.validate(work);return r.ok?{ok:true,value:{work:r.value,undo:[],redo:[]}}:r;},
 dispatch(state,command){
 if(command.type==='undo'||command.type==='redo'){
 const from=command.type==='undo'?state.undo:state.redo;const last=from.at(-1);if(!last)return {ok:true,value:clone(state)};
 const out:PapercutState=command.type==='undo'?{work:clone(last),undo:clone(state.undo.slice(0,-1)),redo:[...clone(state.redo),clone(state.work)].slice(-30)}:{work:clone(last),redo:clone(state.redo.slice(0,-1)),undo:[...clone(state.undo),clone(state.work)].slice(-30)};return {ok:true,value:out};
 }
 const next=clone(state.work);
 if(command.type==='add-cut') {const r=CutOperationSchema.safeParse(command.operation);if(!r.success)return fail('剪切参数格式非法','INVALID_INPUT');next.operations.push(clone(r.data));}
 else {next.palette=clone(command.palette);if(JSON.stringify(next.palette)===JSON.stringify(state.work.palette))return {ok:true,value:clone(state)};}
 const result=core.validate(next);return result.ok?{ok:true,value:{work:result.value,undo:[...clone(state.undo),clone(state.work)].slice(-30),redo:[]}}:result;
 }
};
export function rebuild(json:string):Result<PapercutState,CoreError>{if(Array.from(json).reduce((n,c)=>n+(c.codePointAt(0)!<128?1:c.codePointAt(0)!<2048?2:c.codePointAt(0)!<65536?3:4),0)>256*1024)return fail('JSON超过256KiB限制','INVALID_INPUT');try{return core.createState(JSON.parse(json) as Work);}catch{return fail('JSON语法非法','INVALID_INPUT');}}
export function template(radial=false):TemplateVersion{return {id:radial?'m02-radial':'m02-reflection',craftId:'papercut',version:1,name:radial?'四扇区旋转验证':'竖轴镜像验证',difficulty:'beginner',steps:['选择参数并添加剪切'],enabled:true,geometry:{basePaper:{kind:'square'},symmetry:radial?{kind:'radial',sectors:4,mirror:false}:{kind:'reflection',axis:'vertical'},allowedRegion:radial?[{x:.5,y:.5},{x:1,y:.5},{x:1,y:1},{x:.5,y:1}]:[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}]},allowedCuts:(['triangle','circle','teardrop'] as const).map(shape=>({shape,minWidth:.01,maxWidth:.3,minHeight:.01,maxHeight:.3})),rules:{minEdgeGap:.025,maxOperations:100},recommendedColors:['#B52C35','#FFF3D6'],license:{name:'CC0',attribution:'项目自制开发几何样例'},digitalNotice:'数字体验示意，不保证实体可剪',geometryVersion:1,rendererVersion:1};}
export function newWork(t:TemplateVersion,id:string,time:string):Work{return {id,name:'剪纸验证作品',craftId:t.craftId,templateSnapshot:clone(t),palette:{paper:'#B52C35',background:'#FFF3D6'},operations:[],status:'draft',schemaVersion:1,revision:0,createdAt:time,updatedAt:time};}
