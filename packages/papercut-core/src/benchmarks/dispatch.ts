/** Node-only measurement harness, excluded from the pure production tsconfig. */
import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import type { PapercutState } from '@shoushang/contracts';
import { createPapercutCore } from '../index';
import { operation, work } from '../test-data';

const core = createPapercutCore();
console.log(JSON.stringify({node:process.version,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,warmups:2,samples:10,clock:'performance.now',scenario:'set-palette, 30 undo snapshots, independently cloned mutable input; no render'}));
for(const distinct of [false,true]){
 for(const shape of ['circle','teardrop'] as const){
  for(const count of [50,100]){
   const current=work();
   current.operations=Array.from({length:count},(_,i)=>({...operation(i,shape),angleDeg:distinct?i:0}));
   // Full caller-owned snapshots; setup and any validation happen outside timing.
   const history=Array.from({length:30},(_,i)=>{
    const checked=core.validate({...current,operations:current.operations.slice(0,count-30+i)});
    if(!checked.ok)throw Error(checked.error.message);
    return checked.value;
   });
   const state:PapercutState={work:current,undo:history,redo:[]},samples:number[]=[];
   for(let i=0;i<12;i++){
    const start=performance.now();
    const result=core.dispatch(state,{type:'set-palette',palette:{paper:'#000000',background:'#FFFFFF'}});
    const elapsed=performance.now()-start;
    if(!result.ok)throw Error(result.error.message);
    if(i>=2)samples.push(elapsed);
   }
   const sorted=[...samples].sort((a,b)=>a-b);
   console.log(JSON.stringify({shape,count,history:30,parameters:distinct?'distinct angles':'repeated',n:samples.length,samplesMs:samples,medianMs:(sorted[4]!+sorted[5]!)/2,maxMs:sorted.at(-1)}));
  }
 }
}
