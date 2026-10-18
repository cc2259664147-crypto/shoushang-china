import { chromium, type Page } from '@playwright/test';
import { createFixtureWork } from '@shoushang/fixtures';
import type { Work } from '@shoushang/contracts';
import { createArtworkRenderer } from '../index';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const output = join(dirname(fileURLToPath(import.meta.url)), 'evidence');
const renderer = createArtworkRenderer();
function work(): Work {
  const w = createFixtureWork();
  w.templateSnapshot.geometry.allowedRegion=[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}];
  w.palette={paper:'#B82025',background:'#FFFFEE'};
  return w;
}
function makeSvg(w: Work, view:'folded'|'unfolded'='unfolded', width=400, height=400):string {
  const r=renderer.render({work:w,width,height,view});
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value.svg;
}
type Pixel = [number,number,number,number];
async function sample(page: Page, png: Buffer, positions: readonly [number,number][]): Promise<Pixel[]> {
  return page.evaluate(async ({base64,positions}) => {
    const image=new Image(); image.src=`data:image/png;base64,${base64}`;
    await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const context=canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image,0,0);
    return positions.map(([x,y])=>Array.from(context.getImageData(x,y,1,1).data) as [number,number,number,number]);
  },{base64:png.toString('base64'),positions});
}
function assertPixel(actual:Pixel, expected:Pixel, name:string):void {
  if (actual.some((value,i)=>Math.abs(value-expected[i]!)>2)) throw new Error(`${name}: ${actual} != ${expected}`);
}
async function screenshotSvg(page:Page, markup:string, name:string):Promise<Buffer> {
  await page.setContent(`<style>html,body{margin:0;padding:0}</style><div id="image">${markup}</div>`);
  const png=await page.locator('#image').screenshot({animations:'disabled'});
  await writeFile(join(output,name),png);
  return png;
}

async function main():Promise<void> {
  await mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
    const w=work();
    w.operations=[
      {id:'a',order:0,parameterVersion:1,shape:'circle',center:{x:.25,y:.35},width:.12,height:.12,angleDeg:0},
      {id:'b',order:1,parameterVersion:1,shape:'circle',center:{x:.29,y:.35},width:.12,height:.12,angleDeg:0},
    ];
    const full=makeSvg(w);
    const png=await screenshotSvg(page,full,'unfolded-overlap.png');
    const colors=await sample(page,png,[[82,140],[108,140],[134,140],[60,140],[350,140]]);
    colors.slice(0,3).forEach((p,i)=>assertPixel(p,[255,255,238,255],`hole ${i}`));
    assertPixel(colors[3]!,[184,32,37,255],'paper');
    assertPixel(colors[4]!,[184,32,37,255],'other paper');

    const folded=makeSvg(w,'folded');
    const foldedPng=await screenshotSvg(page,folded,'folded.png');
    const foldedColors=await sample(page,foldedPng,[[100,140],[300,140]]);
    assertPixel(foldedColors[0]!,[255,255,238,255],'folded hole');
    assertPixel(foldedColors[1]!,[255,255,238,255],'folded outside domain');

    const wide=makeSvg(w,'unfolded',500,300);
    const widePng=await screenshotSvg(page,wide,'wide.png');
    const wideColors=await sample(page,widePng,[[50,150],[120,150],[220,150]]);
    assertPixel(wideColors[0]!,[255,255,238,255],'wide margin');
    assertPixel(wideColors[1]!,[184,32,37,255],'wide paper');
    assertPixel(wideColors[2]!,[184,32,37,255],'wide right paper');

    const recolored=structuredClone(w); recolored.palette.paper='#112233';
    const moved=structuredClone(w); moved.operations[0]!.center.y=.6; moved.operations[1]!.center.y=.6;
    const repeated=full;
    const multi=`<div style="display:flex">${full}${makeSvg(recolored)}${makeSvg(moved)}${repeated}</div>`;
    const multiPng=await screenshotSvg(page,multi,'inline-multiple.png');
    const multiColors=await sample(page,multiPng,[[100,140],[460,140],[500,140],[900,140],[900,240],[1300,140]]);
    assertPixel(multiColors[0]!,[255,255,238,255],'first hole');
    assertPixel(multiColors[1]!,[17,34,51,255],'recolored paper');
    assertPixel(multiColors[2]!,[255,255,238,255],'recolored hole');
    assertPixel(multiColors[3]!,[184,32,37,255],'moved old hole position');
    assertPixel(multiColors[4]!,[255,255,238,255],'moved hole');
    assertPixel(multiColors[5]!,[255,255,238,255],'repeated identical hole');

    const isolationPixels: Record<string, Pixel> = {};
    for(const [name, prefix] of [
      ['hidden-parent', `<div style="display:none">${full}</div>`],
      ['hidden-svg', full.replace('<svg ', '<svg style="display:none" ')],
      ['zero-size', `<div style="width:0;height:0;overflow:hidden">${full}</div>`],
    ] as const) {
      await page.setContent(`<style>body{margin:0}</style>${prefix}<div id="target">${full}</div>`);
      const image=await page.locator('#target').screenshot();
      const [pixel]=await sample(page,image,[[100,140]]);
      if(!pixel) throw new Error(`${name}: no pixel`);
      assertPixel(pixel,[255,255,238,255],name);
      isolationPixels[name]=pixel;
      if(name==='hidden-parent') await writeFile(join(output,'hidden-identical.png'),image);
    }
    await page.setContent(`<style>body{margin:0}</style><div id="first">${full}</div><div id="second">${full}</div>`);
    await page.locator('#first').evaluate(element=>{(element as HTMLElement).style.display='none';});
    const dynamicImage=await page.locator('#second').screenshot();
    const [dynamicPixel]=await sample(page,dynamicImage,[[100,140]]);
    if(!dynamicPixel) throw new Error('dynamic hide: no pixel');
    assertPixel(dynamicPixel,[255,255,238,255],'dynamic hide');
    isolationPixels.dynamicHide=dynamicPixel;
    await writeFile(join(output,'dynamic-hidden.png'),dynamicImage);

    const standalone=await page.evaluate(async markup=>{
      const image=new Image(); image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=400; canvas.height=400;
      const context=canvas.getContext('2d'); if(!context) throw new Error('Canvas unavailable');
      context.drawImage(image,0,0);
      return Array.from(context.getImageData(100,140,1,1).data);
    },full);
    assertPixel(standalone as Pixel,[255,255,238,255],'standalone SVG image hole');

    const performanceResults=[];
    for(const count of [50,100]) {
      const many=work();
      many.operations=Array.from({length:count},(_,i)=>({id:`cut-${i}`,order:i,parameterVersion:1,shape:'circle',center:{x:.1+(i%10)*.035,y:.1+Math.floor(i/10)*.08},width:.02,height:.02,angleDeg:0}));
      const markup=makeSvg(many);
      const ms=await page.evaluate(async svg=>{
        const holder=document.createElement('div'); document.body.append(holder);
        const start=performance.now(); holder.innerHTML=svg;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
        const elapsed=performance.now()-start; holder.remove(); return elapsed;
      },markup);
      performanceResults.push({cuts:count,svgBytes:Buffer.byteLength(markup,'utf8'),browserInsertAndTwoFramesMs:ms});
    }
    const report={browserVersion:browser.version(),checks:'all passed',pixels:{colors,foldedColors,wideColors,multiColors,isolationPixels,standalone},performanceResults};
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    await page.close();
  } finally { await browser.close(); }
}
await main();
