import { chromium, expect } from '@playwright/test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
await mkdir('evidence',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];let downloadCount=0;page.on('download',()=>downloadCount++);page.on('pageerror',e=>errors.push(e.message));
const report={date:new Date().toISOString(),device:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,memoryGiB:os.totalmem()/2**30},browser:browser.version(),viewport:'1440x900',throttling:'none; local Vite, warm resources',checks:[],performance:[]};
const check=(name)=>report.checks.push(name);
async function visibleHoles(points){
 const bytes=await page.getByTestId('unfolded').screenshot();
 const colors=await page.evaluate(async({b64,points})=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const bmp=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0);const result=points.map(([x,y])=>Array.from(ctx.getImageData(Math.round(1+x*(c.width-2)),Math.round(1+y*(c.height-2)),1,1).data));bmp.close();return result;},{b64:bytes.toString('base64'),points});
 for(const color of colors)expect(color).toEqual([255,243,214,255]);
}

try{
 await page.goto('http://127.0.0.1:5174');
 await page.getByRole('button',{name:'添加剪切',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('操作数量：1');
 expect(await page.getByTestId('unfolded').locator('mask path').count()).toBe(2);check('vertical 2 copies');await visibleHoles([[.25,.35],[.75,.35]]);
 await page.getByLabel('纸张色',{exact:true}).fill('#123456');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.getByLabel('纸张色',{exact:true})).toHaveValue('#b52c35');
 await page.getByRole('button',{name:'重做',exact:true}).click();
 await expect(page.getByLabel('纸张色',{exact:true})).toHaveValue('#123456');check('palette undo redo retains cuts');
 const before=await page.getByTestId('unfolded').innerHTML();
 for(const width of [360,390,768,1920,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const box=await page.getByTestId('unfolded').boundingBox();expect(Math.abs(box.width-box.height)).toBeLessThan(1);expect(await page.getByTestId('unfolded').innerHTML()).toBe(before);}check('360/390/768/1440/1920 ratio and data');
 await page.getByLabel('开发测试：注入导出失败').check();
 await page.getByRole('button',{name:'生成并下载PNG'}).click();await expect(page.getByRole('status')).toContainText('生成失败');
 await expect(page.getByRole('button',{name:'生成并下载PNG'})).toBeEnabled();
 await page.getByLabel('开发测试：注入导出失败').uncheck();
 const downloadsBefore=downloadCount;const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'生成并下载PNG'}).evaluate(b=>{b.click();b.click();});await expect(page.getByRole('button',{name:'生成中…'})).toBeDisabled();const file=await downloadPromise;expect(downloadCount-downloadsBefore).toBe(1);await file.saveAs('evidence/sample-card.png');await expect(page.getByRole('status')).toContainText('作品卡已生成');check('UI failure retry, double click only one download, disabled during export');
 const downloadedComparison=await page.evaluate(async b64=>{
 const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const bmp=await createImageBitmap(new Blob([raw],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=bmp.width;canvas.height=bmp.height;const ctx=canvas.getContext('2d');ctx.drawImage(bmp,0,0);
 const actual=ctx.getImageData(100,300,1400,1400).data;const preview=document.querySelector('[data-testid="unfolded"] svg').cloneNode(true);preview.setAttribute('width','1400');preview.setAttribute('height','1400');const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(preview)],{type:'image/svg+xml'}));const img=new Image();img.src=url;await img.decode();const ref=document.createElement('canvas');ref.width=1400;ref.height=1400;const rc=ref.getContext('2d');rc.drawImage(img,0,0);const expected=rc.getImageData(0,0,1400,1400).data;let differences=0;for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])differences++;URL.revokeObjectURL(url);bmp.close();return {differences,width:canvas.width,height:canvas.height};
 },(await readFile('evidence/sample-card.png')).toString('base64'));
 expect(downloadedComparison).toEqual({differences:0,width:1600,height:2000});report.downloadedVsVisiblePreview=downloadedComparison;check('actual downloaded PNG vs visible page preview: all artwork pixels identical');
 const png=await page.evaluate(async()=>{
 const {renderer}=await import('/src/render.ts');const {createExporter}=await import('/src/export.ts');const {newWork,template}=await import('/src/core.ts');
 const work=newWork(template(),'pixel','2026-10-17T00:00:00Z');work.palette.paper='#123456';work.operations=[{id:'a',shape:'triangle',center:{x:.25,y:.35},width:.12,height:.16,angleDeg:0,order:0,parameterVersion:1}];
 const ex=createExporter();const first=ex.exportCard({work});const second=await ex.exportCard({work});if(second.ok)throw Error('duplicate allowed');const result=await first;if(!result.ok)throw Error(result.error.message);
 const blob=new Blob([result.value.bytes],{type:'image/png'});const bitmap=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=1600;c.height=2000;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const all=ctx.getImageData(0,0,1600,2000).data;let transparent=0;for(let i=3;i<all.length;i+=4)if(all[i]!==255)transparent++;
 const svg=renderer.render({work,width:1400,height:1400,view:'unfolded'});if(!svg.ok)throw Error(svg.error.message);const url=URL.createObjectURL(new Blob([svg.value.svg],{type:'image/svg+xml'}));const image=new Image();image.src=url;await image.decode();const ref=document.createElement('canvas');ref.width=1400;ref.height=1400;const rctx=ref.getContext('2d');rctx.drawImage(image,0,0);const refPixels=rctx.getImageData(0,0,1400,1400).data;const out=ctx.getImageData(100,300,1400,1400).data;let differences=0;for(let i=0;i<out.length;i++)if(out[i]!==refPixels[i])differences++;
 const hole=Array.from(ctx.getImageData(450,790,1,1).data);URL.revokeObjectURL(url);bitmap.close();
 return {width:result.value.width,height:result.value.height,transparentPixels:transparent,artworkChannelDifferences:differences,hole,duplicateRejected:!second.ok};
 });
 expect(png).toMatchObject({width:1600,height:2000,transparentPixels:0,artworkChannelDifferences:0,duplicateRejected:true,hole:[255,243,214,255]});report.png=png;check('PNG all alpha opaque, 1400x1400 pixel-identical shared SVG, hole background');
 // Actual page preview is byte-identical to reconstructed shared renderer output.
 await page.getByRole('button',{name:'导出作品JSON'}).click();const saved=await page.getByLabel('原型JSON',{exact:true}).inputValue();
 await page.getByLabel('原型JSON',{exact:true}).fill('{');await page.getByRole('button',{name:'校验并重建'}).click();expect(await page.getByTestId('unfolded').innerHTML()).toBe(before);
 await page.getByLabel('原型JSON',{exact:true}).fill(saved);await page.getByRole('button',{name:'校验并重建'}).click();expect(await page.getByTestId('unfolded').innerHTML()).toBe(before);check('invalid JSON retains valid work; valid rebuild same preview');
 page.once('dialog',d=>d.accept());await page.getByLabel('对称模板',{exact:true}).selectOption('m02-radial');await page.getByLabel('形状',{exact:true}).selectOption('teardrop');await page.getByRole('button',{name:'添加剪切',exact:true}).click();expect(await page.getByTestId('unfolded').locator('mask path').count()).toBe(4);check('radial4 teardrop copies; confirmed template reset');await visibleHoles([[.7,.7],[.3,.7],[.3,.3],[.7,.3]]);
 await page.screenshot({path:'evidence/desktop.png',fullPage:true});
 for(const count of [0,50,100]){
 const json=await page.evaluate(async count=>{const {newWork,template}=await import('/src/core.ts');const w=newWork(template(),'perf','2026-10-17T00:00:00Z');w.operations=Array.from({length:count},(_,i)=>({id:`op-${i}`,order:i,shape:['triangle','circle','teardrop'][i%3],center:{x:.25,y:.35},width:.12,height:.16,angleDeg:i%360,parameterVersion:1}));return JSON.stringify(w);},count);
 await page.getByLabel('原型JSON',{exact:true}).fill(json);await page.getByRole('button',{name:'校验并重建'}).click();await expect(page.getByRole('status')).toContainText('重建成功');
 const stats=await page.evaluate(async({json,count})=>{
 const {core}=await import('/src/core.ts');const {createExporter}=await import('/src/export.ts');const w=JSON.parse(json);const s=core.createState(w);if(!s.ok)throw Error(s.error.message);const ex=createExporter();const exports=[];for(let i=0;i<5;i++){const start=performance.now();const r=await ex.exportCard({work:w});if(!r.ok)throw Error(r.error.message);exports.push(performance.now()-start);}
 const cutCommands=[];for(let i=0;i<100;i++){const start=performance.now();const r=core.dispatch(s.value,{type:'add-cut',operation:{id:'new-cut',order:count,shape:'triangle',center:{x:.25,y:.35},width:.12,height:.16,angleDeg:0,parameterVersion:1}});if(r.ok!==(count<100))throw Error('unexpected cut command outcome');cutCommands.push(performance.now()-start);}
 const dispatch=[];for(let i=0;i<100;i++){const start=performance.now();const r=core.dispatch(s.value,{type:'set-palette',palette:{paper:'#ABCDEF',background:'#FFF3D6'}});if(!r.ok)throw Error(r.error.message);dispatch.push(performance.now()-start);}
 const updates=[];const input=document.querySelector('input[aria-label="纸张色"]');for(let i=0;i<100;i++){const start=performance.now();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,i%2?'#123456':'#654321');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));updates.push(performance.now()-start);}
 const summarize=a=>{const b=[...a].sort((a,b)=>a-b);return {n:a.length,median:b[Math.floor(b.length/2)],p95:b[Math.ceil(b.length*.95)-1],min:b[0],max:b.at(-1),samples:a};};
 return {count,exportMs:summarize(exports),cutCommandMs:summarize(cutCommands),cutOutcome:count===100?'rejected at cap':'valid add',paletteCommandMs:summarize(dispatch),inputToTwoFramesMs:summarize(updates),drag:'not implemented; no drag timings'};
 },{json,count});
 report.performance.push(stats);
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mp=await mobile.newPage();await mp.goto('http://127.0.0.1:5174');await mp.getByRole('button',{name:'添加剪切',exact:true}).tap();await expect(mp.getByRole('status')).toContainText('操作数量：1');await mp.screenshot({path:'evidence/mobile-simulated.png',fullPage:true});await mobile.close();check('mobile viewport and touch tap SIMULATED; no real device');
 expect(errors).toEqual([]);report.pageErrors=errors;await writeFile('evidence/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,performance:report.performance.map(p=>({...p,exportMs:{...p.exportMs,samples:undefined},cutCommandMs:{...p.cutCommandMs,samples:undefined},paletteCommandMs:{...p.paletteCommandMs,samples:undefined},inputToTwoFramesMs:{...p.inputToTwoFramesMs,samples:undefined}}))},null,2));
}finally{await browser.close();}
