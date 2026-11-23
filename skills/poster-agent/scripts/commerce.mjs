#!/usr/bin/env node
// Poster Agent commerce intake and acceptance tools. Copyright 2026. Apache-2.0.
// No model decisions, generation API, layout template or independent agent runtime.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {launch, open} from './_browser.mjs';
import {ProjectStore} from './project-store.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');
function source(root,relative) {
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)) fail('INPUT_PATH','素材须为清单目录内相对路径');
  const f=path.resolve(root,relative);
  if(!f.startsWith(path.resolve(root)+path.sep)) fail('INPUT_PATH','禁止越界路径');
  if(!fs.existsSync(f)) fail('INPUT_IMAGE','缺少素材：'+relative);
  const real=fs.realpathSync(f);
  if(!real.startsWith(fs.realpathSync(root)+path.sep)||!fs.statSync(real).isFile()) fail('INPUT_PATH','禁止越界路径或链接');
  if(!/\.(png|jpg|jpeg|webp)$/i.test(f)||fs.statSync(f).size>32*1024*1024) fail('INPUT_IMAGE','仅接受不超过32MB的本地 PNG/JPEG/WebP');
  return real;
}
const str=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>160) fail('INPUT_FIELD',label+'需要非空文字（最多160字符）');};
export function facts(p) {
  const common={name:p.name,id:`ID ${p.id}`,spec:p.spec,price:`¥${p.price}`,commission:`佣金 ${p.commissionRate}%`};
  // Preserve a supplied relative/unknown sales period without inventing dates or units.
  if(p.reportedSales)return {...common,sales:`${p.reportedSales.label} ${p.reportedSales.display}`};
  return {...common,sevenDays:`近7天 ${p.sevenDays.value}${p.sevenDays.unit} · ${p.sevenDays.metric}`};
}
export async function inspectInput(file) {
  file=path.resolve(file);const root=path.dirname(file),m=json(file);
  if(m.schema!=='poster-commerce/v1'||!['mock','real'].includes(m.mode)) fail('INPUT_SCHEMA','需要 poster-commerce/v1 与明确的 mock/real 模式');
  str(m.provenance,'数据来源');str(m.brief,'需求');
  if(m.canvas?.width!==1152||m.canvas?.height!==2048) fail('INPUT_CANVAS','本验收入口要求1152×2048');
  if(!Array.isArray(m.products)||m.products.length!==6) fail('INPUT_COUNT','TOP6 需要恰好六件商品');
  const ids=new Set();const assets=[];
  for(const p of m.products) {
    if(typeof p.id!=='string'||!/^[\w-]{1,48}$/.test(p.id)||['qr','reference'].includes(p.id)||ids.has(p.id)) fail('INPUT_ID','商品ID须唯一，使用字母数字下划线或连字符，不可使用保留名qr/reference');ids.add(p.id);
    str(p.name,'商品名称');str(p.spec,'规格');
    if(typeof p.price!=='string'||!/^\d{1,8}(\.\d{1,2})?$/.test(p.price)) fail('INPUT_PRICE','价格须为精确十进制字符串');
    if(typeof p.commissionRate!=='number'||!Number.isFinite(p.commissionRate)||p.commissionRate<0||p.commissionRate>100) fail('INPUT_RATE','佣金率范围0–100');
    if(p.sevenDays&&p.reportedSales) fail('INPUT_METRIC','同一商品不得同时提供两套销量口径');
    if(p.reportedSales) {
      const s=p.reportedSales,labels={last7days:'近7天销量',cumulative:'累计销量',unspecified:'销量'};
      if(!Number.isSafeInteger(s.value)||s.value<0||typeof s.display!=='string'||!/^\d{1,3}(,\d{3})*$|^\d+$/.test(s.display)||Number(s.display.replaceAll(',',''))!==s.value) fail('INPUT_METRIC','原报销量数值与显示值不一致');
      if(!Object.hasOwn(labels,s.period)||s.label!==labels[s.period]) fail('INPUT_PERIOD','销量标签必须与已确认口径一致');
      str(s.source,'销量来源');
    } else {
      const s=p.sevenDays;if(!s||typeof s.value!=='number'||!Number.isFinite(s.value)||s.value<0) fail('INPUT_METRIC','近7天数值缺失或无效');
      str(s.unit,'数据单位');str(s.metric,'指标口径');
      const date=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
      if(!date(s.start)||!date(s.end)||Date.parse(s.end)-Date.parse(s.start)!==6*86400000) fail('INPUT_PERIOD','需给出含首尾七天的数据日期');
    }
    assets.push({role:'product',id:p.id,relative:p.image,file:source(root,p.image)});
  }
  if(m.mode==='real'&&!m.qr&&m.omissions?.qr!=='not-provided') fail('INPUT_QR','真实任务缺少原始二维码；如未提供，须明确 omissions.qr=not-provided，不得编造');
  if(m.qr) {str(m.qr.payload,'二维码可信原文');assets.push({role:'qr',id:'qr',relative:m.qr.image,file:source(root,m.qr.image)});}
  if(m.reference) assets.push({role:'reference',id:'reference',relative:m.reference,file:source(root,m.reference)});
  const browser=await launch();
  try {const page=await browser.newPage();for(const a of assets) {
    const bytes=fs.readFileSync(a.file);const mime=/\.png$/i.test(a.file)?'image/png':/\.webp$/i.test(a.file)?'image/webp':'image/jpeg';
    const size=await page.evaluate(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.naturalWidth,i.naturalHeight]);i.onerror=()=>resolve(null);i.src=src;}),`data:${mime};base64,${bytes.toString('base64')}`);
    if(!size||size[0]*size[1]>32e6) fail('INPUT_IMAGE','图片无法解码或像素过多：'+a.relative);
    Object.assign(a,{width:size[0],height:size[1],sha256:hash(bytes)});
  }} finally {await browser.close();}
  return {manifest:m,assets,mode:m.mode,realFactsVerified:false,qrScanVerified:false,warnings:[...(m.mode==='mock'?['模拟数据与模拟素材，不可作为商业事实发布']:['已校验完整性；商业真实性仍以原始来源人工审核为准']),...(m.products.some(p=>p.reportedSales)?['保留来源确认的销量口径，不推测具体起止日期或单位']:[]),...(!m.qr?['未提供二维码，本次不展示且扫码未验收']:['仅验证二维码文件与可信原文声明，未执行扫码验收'])]};
}
export async function importInput(file,project) {
  project=path.resolve(project);const report=await inspectInput(file);
  if(!fs.existsSync(path.join(project,'poster.json'))||!fs.existsSync(path.join(project,'index.html'))) fail('PROJECT_REQUIRED','先用现有 init-poster.sh 建立空工程');
  const cfg=json(path.join(project,'poster.json'));
  if(cfg.agent?.currentRevision||fs.existsSync(path.join(project,'assets/commerce-input'))) fail('IMPORT_EXISTS','只导入新工程，禁止覆盖版本或已有导入');
  if(cfg.agent?.protection) fail('IMPORT_EXISTS','已有保护策略，禁止覆盖');
  const refDir=path.join(project,'reference/commerce-input');
  if(report.manifest.reference&&fs.existsSync(refDir)) fail('IMPORT_EXISTS','构图参考目录已存在，禁止覆盖');
  const dest=path.join(project,'assets/commerce-input');fs.mkdirSync(dest,{recursive:true});
  try {
    const m=structuredClone(report.manifest),layers={},protectedAssets=[];
    for(const a of report.assets) {
      const relative=`${a.role==='reference'?'reference':'assets'}/commerce-input/${a.id}${path.extname(a.file).toLowerCase()}`;
      const data=fs.readFileSync(a.file);if(hash(data)!==a.sha256) fail('INPUT_CHANGED','导入期间源素材改变');
      if(a.role==='reference')fs.mkdirSync(refDir,{recursive:true});
      fs.writeFileSync(path.join(project,relative),data,{flag:'wx'});
      if(a.role==='reference') {m.reference=relative;protectedAssets.push({path:relative,sha256:a.sha256,kind:'composition-reference'});continue;}
      protectedAssets.push({path:relative,sha256:a.sha256,kind:a.role==='qr'?'qr-original':'product-original'});
      if(a.role==='qr') {m.qr.image=relative;layers.qr={kind:'qr',operations:['move','resize']};}
      else {const p=m.products.find(p=>p.id===a.id);p.image=relative;layers[`product-${p.id}`]={kind:'product',operations:['move','resize','crop']};
        for(const [field,text] of Object.entries(facts(p))) layers[`${p.id}-${field}`]={trustedText:text,trustedSource:'assets/commerce-input/facts.txt'};
      }
    }
    const trusted=Object.values(layers).filter(r=>r.trustedText!==undefined).map(r=>r.trustedText).join('\n');
    fs.writeFileSync(path.join(dest,'facts.txt'),trusted+'\n');
    protectedAssets.push({path:'assets/commerce-input/facts.txt',kind:'trusted-source'});
    write(path.join(dest,'manifest.json'),m);
    protectedAssets.push({path:'assets/commerce-input/manifest.json',kind:'trusted-source'});
    cfg.canvas=m.canvas;cfg.scale=1;cfg.dpi=null;cfg.agent={...cfg.agent,freeEditing:true,inputProvenance:{assets:protectedAssets,layers},protection:{assets:[],layers:{}}};
    write(path.join(project,'poster.json'),cfg);
    return {...report,manifest:m,assets:report.assets.map(({file,...a})=>a)};
  } catch(e) {fs.rmSync(dest,{recursive:true,force:true});if(report.manifest.reference)fs.rmSync(refDir,{recursive:true,force:true});throw e;}
}
export async function auditCommerce(project) {
  const store=new ProjectStore(project),c=store.current(),m=json(path.join(store.root,'assets/commerce-input/manifest.json'));
  store.resources(c.html); // Validate all refs; status checks current resource hashes.
  const status=store.status();if(status.resourceErrors.length) fail('ASSET_CHANGED',JSON.stringify(status.resourceErrors));
  const info=await store.analyze(c.html),cards=[],checks=[];
  for(const p of m.products) {
    for(const [field,text] of Object.entries(facts(p))) if(info.records[`layer:${p.id}-${field}`]?.text!==text) fail('FACT_MISMATCH',p.id+' '+field);
    const image=info.records[`layer:product-${p.id}`];if(!image||image.src!==p.image) fail('IMAGE_ASSOCIATION',p.id);
  }
  if(m.qr&&info.records['layer:qr']?.src!==m.qr.image) fail('IMAGE_ASSOCIATION','二维码原始文件对应错误');
  const browser=await launch();try {
    const {page}=await open(browser,path.join(store.root,'index.html'),{width:1152,height:2048});
    const result=await page.evaluate(products=>{
      const problems=[],cards=[];for(const p of products) {
        const group=document.querySelector(`[data-explode-group="card-${p.id}"]`);if(!group){problems.push('missing card '+p.id);continue;}
        const r=group.getBoundingClientRect();cards.push({id:p.id,x:r.x,y:r.y,width:r.width,height:r.height});
        const leaves=[...document.querySelectorAll('[data-layer-id]')].filter(e=>e.closest('[data-explode-group]')===group||e.dataset.explodeParent===`card-${p.id}`);
        const rects=[];for(const e of leaves){const b=e.getBoundingClientRect();if(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1) problems.push('clipped '+e.dataset.layerId);
          if(b.x<r.x-1||b.y<r.y-1||b.right>r.right+1||b.bottom>r.bottom+1) problems.push('outside card '+e.dataset.layerId);
          if(e.textContent.trim()||e.tagName==='IMG')rects.push({id:e.dataset.layerId,b});}
        for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i].b,b=rects[j].b;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)problems.push('overlap '+rects[i].id+' '+rects[j].id);}
      }
      return {cards,problems,mockVisible:document.body.innerText.includes('模拟数据')};
    },m.products);
    if(result.problems.length) fail('LAYOUT_CHECK',result.problems.join('; '));
    cards.push(...result.cards);if(m.mode==='mock'&&!result.mockVisible)fail('MOCK_LABEL','海报必须显示模拟数据');
  }finally{await browser.close();}
  const xs=[...new Set(cards.map(c=>Math.round(c.x)))],ys=[...new Set(cards.map(c=>Math.round(c.y)))];
  if(xs.length!==2||ys.length!==3||new Set(cards.map(c=>`${c.x},${c.y}`)).size!==6) fail('GRID_CHECK','需要两列三排且六个独立卡片');
  checks.push('six image/fact associations','two columns × three rows','no card text clipping or overlap','no missing/changed resources');
  return {revision:c.revision,mode:m.mode,canvas:c.config.canvas,cards,checks,qrScanVerified:false,realFactsVerified:false};
}
export async function deliverCommerce(project) {
  // Acceptance/export only: never chooses design, mutates layout or calls a provider.
  const audit=await auditCommerce(project),store=new ProjectStore(project);
  const png=await store.exportPNG(audit.revision),scripts=path.dirname(fileURLToPath(import.meta.url));
  for(const [tool,args] of [['wire-editor.mjs',[path.join(store.root,'index.html')]],['verify.mjs',[path.join(store.root,'index.html')]],['build-replay.mjs',[store.root]],['verify-replay.mjs',[path.join(store.root,'replay/index.html')]]]) {
    const r=spawnSync(process.execPath,[path.join(scripts,tool),...args],{encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
    const log=path.join(store.trace,`commerce-${tool}.log`);fs.writeFileSync(log,(r.stdout||'')+(r.stderr||''));
    if(r.status!==0)fail('DELIVERY_FAILED',`${tool} 未通过，见 ${log}`);
  }
  if(store.current().revision!==audit.revision)fail('VERSION_CONFLICT','交付期间设计已更新，重新检查最新版本');
  const receipt={...audit,png,outputs:['index.html','editor.html','layers.html','replay/index.html',png.path]};
  write(path.join(store.trace,'commerce-delivery.json'),receipt);return receipt;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const [command,input,project]=process.argv.slice(2);
  const run=async()=>{if(command==='inspect')return inspectInput(input);if(command==='import')return importInput(input,project);if(command==='audit')return auditCommerce(input);if(command==='deliver')return deliverCommerce(input);throw new Error('Usage: commerce {inspect MANIFEST|import MANIFEST NEW_PROJECT|audit PROJECT|deliver PROJECT}');};
  run().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(JSON.stringify({error:e.code||'COMMERCE_ERROR',message:e.message}));process.exitCode=1;});
}
