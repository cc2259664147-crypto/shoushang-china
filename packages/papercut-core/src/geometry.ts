import type { CutOperation, TemplateVersion } from '@shoushang/contracts';
export interface Point { x: number; y: number }
/** x'=a*x+c*y+e; y'=b*x+d*y+f. Unit paper coordinates. */
export interface AffineTransform { a: number; b: number; c: number; d: number; e: number; f: number }
export type Cubic = readonly [Point, Point, Point, Point];
export type LocalShape = { kind: 'polygon'; vertices: Point[] } | { kind: 'ellipse'; radiusX: number; radiusY: number } | { kind: 'cubic-loop'; curves: Cubic[] };
export interface CutGeometry { operationId: string; localShape: LocalShape; placement: AffineTransform; conservativeContour: Point[] }
export interface WorkGeometry { geometryVersion: 1; unit: 'paper-side'; overlap: 'union'; cuts: CutGeometry[]; symmetryTransforms: AffineTransform[]; baseDomain: Point[] }
export const GEOMETRY_TOLERANCES = Object.freeze({ boundary: 1e-10, polygonArea: 1e-10, curveFlatness: 1e-5, curveMaxDepth: 16, ellipseSides: 128 });
export const apply = (m: AffineTransform, p: Point): Point => ({ x: m.a*p.x+m.c*p.y+m.e, y: m.b*p.x+m.d*p.y+m.f });
const cross = (a: Point,b: Point,p: Point) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const area = (ps: readonly Point[]) => ps.reduce((s,p,i)=>{ const q=ps[(i+1)%ps.length]!; return s+p.x*q.y-p.y*q.x; },0);
export function convex(ps: readonly Point[]): boolean {
  if(ps.length<3 || Math.abs(area(ps))<=GEOMETRY_TOLERANCES.polygonArea) return false;
  if(ps.some((p,i)=>ps.some((q,j)=>i!==j && Math.hypot(p.x-q.x,p.y-q.y)<=GEOMETRY_TOLERANCES.boundary))) return false;
  const sign=Math.sign(area(ps));
  // Every other vertex must be on the interior side of every edge. This also rejects self intersections.
  return ps.every((p,i)=>{ const q=ps[(i+1)%ps.length]!; return ps.every(v=>cross(p,q,v)*sign>=-GEOMETRY_TOLERANCES.boundary*Math.hypot(q.x-p.x,q.y-p.y)); });
}
export function inside(ps: readonly Point[],p: Point): boolean { const sign=Math.sign(area(ps)); return ps.every((a,i)=>{const b=ps[(i+1)%ps.length]!;return cross(a,b,p)*sign>=-GEOMETRY_TOLERANCES.boundary*Math.hypot(b.x-a.x,b.y-a.y);}); }
export function localShape(o: CutOperation): LocalShape {
 const w=o.width,h=o.height;
 if(o.shape==='triangle')return {kind:'polygon',vertices:[{x:0,y:-h/2},{x:-w/2,y:h/2},{x:w/2,y:h/2}]};
 if(o.shape==='circle')return {kind:'ellipse',radiusX:w/2,radiusY:h/2};
 return {kind:'cubic-loop',curves:[[{x:0,y:-h/2},{x:-2*w/3,y:0},{x:-2*w/3,y:h/2},{x:0,y:h/2}],[{x:0,y:h/2},{x:2*w/3,y:h/2},{x:2*w/3,y:0},{x:0,y:-h/2}]]};
}
const mid=(p:Point,q:Point):Point=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2});
function hull(curve: Cubic,depth=0): Point[] | undefined {
 const [a,b,c,d]=curve,length=Math.hypot(d.x-a.x,d.y-a.y);
 const distance=(v:Point)=>length?Math.abs(cross(a,d,v))/length:Math.hypot(v.x-a.x,v.y-a.y);
 if(Math.max(distance(b),distance(c))<=GEOMETRY_TOLERANCES.curveFlatness)return [...curve];
 if(depth>=GEOMETRY_TOLERANCES.curveMaxDepth)return undefined;
 const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);
 const left=hull([a,ab,abc,m],depth+1),right=hull([m,bcd,cd,d],depth+1);
 return left && right ? [...left,...right] : undefined;
}
export function cutGeometry(o: CutOperation): CutGeometry | undefined {
 const shape=localShape(o),r=o.angleDeg*Math.PI/180;
 const placement={a:Math.cos(r),b:Math.sin(r),c:-Math.sin(r),d:Math.cos(r),e:o.center.x,f:o.center.y};
 let points:Point[]=[];
 if(shape.kind==='polygon')points=shape.vertices;
 else if(shape.kind==='ellipse') { const n=GEOMETRY_TOLERANCES.ellipseSides; points=Array.from({length:n},(_,i)=>({x:shape.radiusX*Math.cos((i+.5)*2*Math.PI/n)/Math.cos(Math.PI/n),y:shape.radiusY*Math.sin((i+.5)*2*Math.PI/n)/Math.cos(Math.PI/n)})); }
 else for(const curve of shape.curves){const p=hull(curve);if(!p)return undefined;points.push(...p);}
 return {operationId:o.id,localShape:shape,placement,conservativeContour:points.map(p=>apply(placement,p))};
}
export function symmetry(t:TemplateVersion): AffineTransform[] {
 const identity={a:1,b:0,c:0,d:1,e:0,f:0};
 return t.geometry.symmetry.kind==='reflection'?[identity,{a:-1,b:0,c:0,d:1,e:1,f:0}]:[identity,{a:0,b:1,c:-1,d:0,e:1,f:0},{a:-1,b:0,c:0,d:-1,e:1,f:1},{a:0,b:-1,c:1,d:0,e:0,f:1}];
}
export function baseDomain(t:TemplateVersion):Point[]{return t.geometry.symmetry.kind==='reflection'?[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}]:[{x:.5,y:.5},{x:1,y:.5},{x:1,y:1},{x:.5,y:1}];}
