// Poster Agent, 2026-11-11. Apache-2.0. Explicit aspect-preserving fit and previews.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest,inspectPNG,imageError} from './image-utils.mjs';
import {safeFile,ProjectStore} from './project-store.mjs';

export function planImageFit({sourceSize,canvasSize,mode='contain',padding=96,fill='#740a0e',subject=null,sourceSHA256=null}) {
  const valid=s=>s&&Number.isInteger(s.width)&&Number.isInteger(s.height)&&s.width>0&&s.height>0&&s.width*s.height<=8294400;
  if(!valid(sourceSize)||!valid(canvasSize))throw imageError('INVALID_SIZE','素材与画布须分别提供有效像素尺寸');
  if(!['contain','cover','safe-padding'].includes(mode))throw imageError('INVALID_FIT','只支持 contain / cover / safe-padding，禁止拉伸');
  if(!/^#[0-9a-f]{6}$/i.test(fill))throw imageError('INVALID_FIT','底色须为六位十六进制颜色');
  const {width:sw,height:sh}=sourceSize,{width:cw,height:ch}=canvasSize;
  const inset=mode==='safe-padding'?padding:0;
  if(!Number.isFinite(inset)||inset<0||inset*2>=Math.min(cw,ch))throw imageError('INVALID_FIT','安全留白必须小于画布短边的一半');
  const scale=mode==='cover'?Math.max(cw/sw,ch/sh):Math.min((cw-2*inset)/sw,(ch-2*inset)/sh);
  const frame={x:(cw-sw*scale)/2,y:(ch-sh*scale)/2,width:sw*scale,height:sh*scale};
  const visibleSourceRect={x:Math.max(0,-frame.x/scale),y:Math.max(0,-frame.y/scale),width:Math.min(sw,cw/scale),height:Math.min(sh,ch/scale)};
  const cropped=frame.x<-.0001||frame.y<-.0001;
  if(subject&&(!['x','y','width','height'].every(k=>Number.isFinite(subject[k]))||subject.x<0||subject.y<0||subject.width<=0||subject.height<=0||subject.x+subject.width>sw||subject.y+subject.height>sh))throw imageError('INVALID_SUBJECT','主体框须使用原图像素坐标且位于原图内');
  const subjectClipped=Boolean(subject&&(subject.x<visibleSourceRect.x-.001||subject.y<visibleSourceRect.y-.001||subject.x+subject.width>visibleSourceRect.x+visibleSourceRect.width+.001||subject.y+subject.height>visibleSourceRect.y+visibleSourceRect.height+.001));
  const plan={schema:'poster-agent/image-fit/v1',sourceSize,canvasSize,sourceSHA256,mode,padding:inset,fill,scale,frame,visibleSourceRect,cropped,croppedFraction:1-visibleSourceRect.width*visibleSourceRect.height/(sw*sh),subject,subjectClipped,upscaled:scale>1,shipping:false};
  return {...plan,previewHash:digest(JSON.stringify(plan)),warnings:[...(cropped?['裁剪必须查看预览并明确批准；未提供主体框时，主体安全性未知']:[]),...(subjectClipped?['指定主体会被裁掉，禁止应用此方案']:[]),...(scale>1?['显示时等比放大，原图像素与画布尺寸保持分别记录']:[])]};
}
export function backgroundFitStyle(plan,source) {
  return {'background-image':`url("${source}")`,'background-size':`${plan.frame.width}px ${plan.frame.height}px`,'background-position':`${plan.frame.x}px ${plan.frame.y}px`,'background-repeat':'no-repeat','background-color':plan.fill,'background-origin':'border-box','background-clip':'border-box','background-attachment':'scroll','background-blend-mode':'normal'};
}
export async function createFitPreview(project,{jobId,outputDirectory,target='region:background',padding=96,fill='#740a0e',subject=null}) {
  const store=new ProjectStore(project),current=store.current(),root=store.root;
  if(!/^[a-f0-9-]{36}$/.test(jobId||'')||!/^region:[\w-]+$/.test(target))throw imageError('INVALID_FIT','预览必须指定任务和背景 region');
  const receipt=JSON.parse(fs.readFileSync(safeFile(root,`.trace/image-jobs/${jobId}.json`),'utf8'));
  const r=receipt.result,q=r.diagnostic?.quarantine;
  if(receipt.request.purpose!=='background'||!(r.status==='success'||(r.error?.code==='SIZE_MISMATCH'&&q?.status==='saved')))throw imageError('NON_PREVIEW_ASSET','只允许背景任务的成功素材或已验证的尺寸不符隔离原图');
  const source=safeFile(root,r.status==='success'?r.path:q.path),bytes=fs.readFileSync(source),info=inspectPNG(bytes);
  if(info.sha256!==(r.status==='success'?r.sha256:q.sha256))throw imageError('ASSET_CHANGED','预览素材哈希与回执不一致');
  if(!outputDirectory)throw imageError('INVALID_OUTPUT','必须指定工程外的新预览目录');
  const out=path.resolve(outputDirectory);let ancestor=out;
  while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const actual=path.join(fs.realpathSync(ancestor),path.relative(ancestor,out));
  if(actual===root||actual.startsWith(root+path.sep)||fs.existsSync(out))throw imageError('INVALID_OUTPUT','预览必须写入工程外的新目录，不覆盖现有文件');
  const {launch}=await import('./_browser.mjs');
  const browser=await launch();let report;
  try {
    const page=await browser.newPage(),errors=[];
    await page.setViewport({width:current.config.canvas.width,height:current.config.canvas.height,deviceScaleFactor:1});
    // Block external requests before navigation, including resources in source HTML.
    await page.setRequestInterception(true);
    page.on('request',req=>/^(file|data|about):/.test(req.url())?req.continue():req.abort());
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push('resource error');});
    await page.goto(pathToFileURL(path.join(root,'index.html')).href,{waitUntil:'networkidle0'});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
    const selector=`[data-region-id="${target.split(':')[1]}"]`;
    const state=await page.evaluate(selector=>{
      const region=document.querySelector(selector),canvas=document.querySelector('[data-canvas-width]');
      if(!region||region.children.length||region.textContent.trim())throw new Error('请选择独立空背景区域');
      const r=region.getBoundingClientRect(),c=canvas.getBoundingClientRect();
      if(Math.abs(r.width-c.width)>.1||Math.abs(r.height-c.height)>.1||Math.abs(r.x-c.x)>.1||Math.abs(r.y-c.y)>.1)throw new Error('此预览要求全画布背景区域');
      const layers=()=>Object.fromEntries([...document.querySelectorAll('[data-layer-id]')].map(e=>{const b=e.getBoundingClientRect();return [e.dataset.layerId,{rect:[b.x,b.y,b.width,b.height],text:e.textContent,src:e.getAttribute('src'),style:e.getAttribute('style')}];}));
      return {layers:layers(),originalStyle:region.getAttribute('style')};
    },selector);
    if(errors.length)throw imageError('PREVIEW_RENDER_FAILED','原设计资源加载失败，预览停止');
    fs.mkdirSync(out,{recursive:true,mode:0o700});fs.writeFileSync(path.join(out,'original.png'),bytes,{flag:'wx',mode:0o600});
    const plans=[];
    for(const mode of ['contain','cover','safe-padding']) {
      const plan=planImageFit({sourceSize:{width:info.width,height:info.height},canvasSize:current.config.canvas,sourceSHA256:info.sha256,mode,padding,fill,subject});
      await page.evaluate(({selector,style,originalStyle})=>{
        const el=document.querySelector(selector);if(originalStyle===null)el.removeAttribute('style');else el.setAttribute('style',originalStyle);
        for(const [key,value] of Object.entries(style))el.style.setProperty(key,value);
      },{selector,originalStyle:state.originalStyle,style:backgroundFitStyle(plan,'data:image/png;base64,'+bytes.toString('base64'))});
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
      // Force background decode before screenshot.
      await page.evaluate(src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=resolve;i.onerror=reject;i.src=src;}),'data:image/png;base64,'+bytes.toString('base64'));
      const after=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-layer-id]')].map(e=>{const b=e.getBoundingClientRect();return [e.dataset.layerId,{rect:[b.x,b.y,b.width,b.height],text:e.textContent,src:e.getAttribute('src'),style:e.getAttribute('style')}];})));
      if(JSON.stringify(after)!==JSON.stringify(state.layers))throw imageError('LAYER_DRIFT','预览改变了其他图层，停止');
      const cv=await page.$('[data-canvas-width]'),box=await cv.boundingBox();
      const png=await page.screenshot({type:'png',clip:box,captureBeyondViewport:true});
      const decoded=inspectPNG(Buffer.from(png));
      if(decoded.width!==current.config.canvas.width||decoded.height!==current.config.canvas.height)throw imageError('PREVIEW_RENDER_FAILED','预览 PNG 尺寸错误');
      fs.writeFileSync(path.join(out,mode+'.png'),png,{flag:'wx'});
      plans.push({...plan,png:mode+'.png',renderedSize:{width:decoded.width,height:decoded.height},allContentLayersUnchanged:true});
    }
    report={schema:'poster-agent/image-fit-preview/v1',jobId,parentRevision:current.revision,target,originalSize:{width:info.width,height:info.height},canvasSize:current.config.canvas,sourceSHA256:info.sha256,sourceStatus:r.status,shipping:false,plans};
    fs.writeFileSync(path.join(out,'preview.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    const panels=plans.map(p=>`<section><h2>${p.mode}</h2><p>原图 ${info.width}×${info.height} → 画布 ${p.canvasSize.width}×${p.canvasSize.height}；裁掉 ${(p.croppedFraction*100).toFixed(1)}%；主体框 ${p.subject?'已指定':'未指定，安全性须人工检查'}；仅预览</p><img src="${p.png}" alt="${p.mode} 海报预览"><h3>原图保留范围（框外会裁掉）</h3><div style="position:relative;width:300px"><img style="width:300px" src="original.png" alt="未改动的原图"><div style="position:absolute;box-sizing:border-box;border:3px solid cyan;left:${p.visibleSourceRect.x/info.width*100}%;top:${p.visibleSourceRect.y/info.height*100}%;width:${p.visibleSourceRect.width/info.width*100}%;height:${p.visibleSourceRect.height/info.height*100}%"></div></div></section>`).join('');
    fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><title>背景适配对比 · 非交付预览</title><style>body{font:16px sans-serif;background:#eee;margin:24px}main{display:flex;gap:24px;align-items:start}section{width:340px;background:white;padding:16px}img{max-width:100%;display:block}p{line-height:1.6}</style><h1>背景适配预览：原图不变，正式海报未修改</h1><p>cover 会裁剪左右边缘。没有任何方案被自动应用。预览含现有海报内容，仅供本地检查。</p><main>${panels}</main></html>`,{flag:'wx'});
  } finally {await browser.close();}
  return {directory:out,index:path.join(out,'index.html'),...report};
}
