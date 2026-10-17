import type { ArtworkRenderer, CutOperation } from '@shoushang/contracts';
import { core, drop } from './core';
export const escapeXml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
function cut(o:CutOperation):string{const w=o.width,h=o.height;const shape=o.shape==='circle'?`<ellipse rx="${w/2}" ry="${h/2}"/>`:o.shape==='triangle'?`<path d="M0 ${-h/2} L${-w/2} ${h/2} L${w/2} ${h/2} Z"/>`:`<path d="M0 ${-h/2} ${drop(w,h).map(p=>`C${p.slice(1).map(v=>`${v.x} ${v.y}`).join(' ')}`).join(' ')} Z"/>`;return `<g transform="translate(${o.center.x} ${o.center.y}) rotate(${o.angleDeg})">${shape}</g>`;}
export const renderer:ArtworkRenderer={render({work,width,height,view}){
 const valid=core.validate(work);if(!valid.ok)return valid;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>6000||height>6000)return {ok:false,error:{code:'INVALID_INPUT',message:'渲染尺寸必须为1–6000整数',requestId:'m02-render',fieldErrors:[]}};
 const t=work.templateSnapshot,s=t.geometry.symmetry,paths=work.operations.map(cut).join('');
 const unfolded=s.kind==='reflection'?`${paths}<g transform="translate(1 0) scale(-1 1)">${paths}</g>`:Array.from({length:4},(_,i)=>`<g transform="rotate(${i*90} .5 .5)">${paths}</g>`).join('');
 const paper=view==='unfolded'?'<rect width="1" height="1"/>':s.kind==='reflection'?'<rect width=".5" height="1"/>':'<rect x=".5" y=".5" width=".5" height=".5"/>';
 const maskId=`m02-${view}-${work.id}`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet"><title>${escapeXml(work.name)}</title><defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" style="mask-type:luminance"><rect width="1" height="1" fill="white"/><g fill="black">${view==='unfolded'?unfolded:paths}</g></mask></defs><rect width="1" height="1" fill="${work.palette.background}"/><g fill="${work.palette.paper}" mask="url(#${maskId})">${paper}</g></svg>`;
 return {ok:true,value:{svg,width,height,rendererVersion:1}};
}};
