import { createFixtureWork } from '@shoushang/fixtures';
import type { CutOperation, Work } from '@shoushang/contracts';
/** Deterministic fixtures, not production templates. */
export function work(radial=false):Work {
 const w=createFixtureWork(),t=w.templateSnapshot;
 t.geometry.allowedRegion=radial?[{x:.5,y:.5},{x:1,y:.5},{x:1,y:1},{x:.5,y:1}]:[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}];
 t.geometry.symmetry=radial?{kind:'radial',sectors:4,mirror:false}:{kind:'reflection',axis:'vertical'};
 t.rules.minEdgeGap=.025;
 return w;
}
export function operation(index=0,shape:CutOperation['shape']='triangle',radial=false):CutOperation{return {id:`cut-${index}`,order:index,parameterVersion:1,shape,width:.1,height:.12,angleDeg:0,center:radial?{x:.7,y:.7}:{x:.25,y:.35}};}
// Hand-calculated M06 rendering oracles; do not regenerate from implementation.
export const GOLDEN = {
 triangleLocal:[{x:0,y:-.06},{x:-.05,y:.06},{x:.05,y:.06}],
 trianglePlaced:[{x:.25,y:.29},{x:.2,y:.41},{x:.3,y:.41}],
 radialCenterCopies:[{x:.7,y:.8},{x:.2,y:.7},{x:.3,y:.2},{x:.8,y:.3}],
 dropLeft:[{x:0,y:-.06},{x:-1/15,y:0},{x:-1/15,y:.06},{x:0,y:.06}],
 dropRight:[{x:0,y:.06},{x:1/15,y:.06},{x:1/15,y:0},{x:0,y:-.06}],
};
