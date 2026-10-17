import type { ArtworkExporter, ArtworkRenderer, ExportOutput, Result } from '@shoushang/contracts';
import { renderer } from './render';
const timeout=<T>(p:Promise<T>,ms:number):Promise<T>=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('资源等待超时')),ms);p.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
export function createExporter(shared:ArtworkRenderer=renderer):ArtworkExporter {
 let busy=false;
 return {async exportCard({work,width=1600,height=2000}):Promise<Result<ExportOutput>>{
 const error=(message:string,code:'EXPORT_FAILED'|'RESOURCE_UNAVAILABLE'='EXPORT_FAILED')=>({ok:false as const,error:{code,message,requestId:'m02-export',fieldErrors:[]}});
 if(busy)return error('作品卡正在生成，请勿重复提交');
 if(width!==1600||height!==2000)return error('原型仅支持1600×2000');
 busy=true;let url:string|undefined;let image:HTMLImageElement|undefined;
 try {
 const r=shared.render({work,width:1400,height:1400,view:'unfolded'});if(!r.ok)return r;
 try {await timeout(document.fonts.ready,10000);if(!document.fonts.check('32px sans-serif'))return error('字体未就绪','RESOURCE_UNAVAILABLE');}catch{return error('字体等待失败或超时','RESOURCE_UNAVAILABLE');}
 url=URL.createObjectURL(new Blob([r.value.svg],{type:'image/svg+xml'}));image=new Image();image.src=url;
 try{await timeout(image.decode(),10000);}catch{return error('SVG资源解码失败或超时','RESOURCE_UNAVAILABLE');}
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return error('Canvas不可用');
 ctx.fillStyle=work.palette.background;ctx.fillRect(0,0,width,height);ctx.fillStyle='#202020';ctx.font='bold 56px sans-serif';ctx.fillText(work.name,100,150,1400);ctx.font='32px sans-serif';ctx.fillText('工艺：剪纸 · 开发原型',100,230);
 ctx.drawImage(image,100,300,1400,1400);ctx.fillText(`日期：${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(work.updatedAt))}`,100,1790);ctx.fillText('手上中国：非遗技艺数字工坊',100,1860);ctx.font='28px sans-serif';ctx.fillText('数字体验示意，不保证实体可剪。',100,1920);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG编码失败')),'image/png'));
 return {ok:true,value:{bytes:new Uint8Array(await blob.arrayBuffer()),mimeType:'image/png',filename:`papercut-${work.id}.png`,width,height}};
 }catch{return error('作品卡生成失败，请重试');}finally{if(url)URL.revokeObjectURL(url);if(image)image.src='';busy=false;}
 }};
}
export function download(bytes:Uint8Array,filename:string,mime:string){const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
