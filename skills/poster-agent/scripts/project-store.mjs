// Poster Agent, 2026-11-10. Apache-2.0. Versioned HTML storage; no model runtime.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launch, open } from './_browser.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
export const sha = data => createHash('sha256').update(data).digest('hex');
export class ProjectError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new ProjectError(code, message, status); };
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => atomic(file, JSON.stringify(data, null, 2) + '\n');
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
export function safeFile(root, relative, mustExist = true) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) fail('INVALID_PATH', '必须使用工程内相对路径');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) fail('INVALID_PATH', '路径越出当前工程');
  // Reject symlink escapes, including an existing parent of a new output file.
  let ancestor = file;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (ancestor !== root && !fs.realpathSync(ancestor).startsWith(root + path.sep)) fail('INVALID_PATH', '符号链接越出当前工程');
  if (mustExist && (!fs.existsSync(file) || !fs.statSync(file).isFile())) fail('MISSING_ASSET', `文件或素材不存在：${relative}`);
  return file;
}
const visualProps = ['color','background-color','background-image','background-size','background-position','background-repeat','opacity','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','white-space','writing-mode','object-fit','object-position','border-top','border-right','border-bottom','border-left','border-radius','box-shadow','filter','clip-path','mix-blend-mode','transform'];
function inspectDOM(props) {
  const cv = document.querySelector('[data-canvas-width]');
  if (!cv) throw new Error('缺少固定画布');
  const box = cv.getBoundingClientRect();
  const rect = el => { const r = el.getBoundingClientRect(); return [r.x-box.x,r.y-box.y,r.width,r.height].map(n => Math.round(n*100)/100); };
  const view = el => ({
    tag: el.tagName, text: el.textContent.trim(),
    src: el.getAttribute('src'),
    style: Object.fromEntries(props.map(p => [p,getComputedStyle(el).getPropertyValue(p)])),
    rect: rect(el),
    pseudo: ['::before','::after'].map(p => { const c=getComputedStyle(el,p);return [c.content,c.color,c.backgroundImage,c.width,c.height,c.transform]; }),
  });
  const keyOf = el => el.hasAttribute('data-layer-id') ? 'layer:'+el.dataset.layerId : el.hasAttribute('data-region-id') ? 'region:'+el.dataset.regionId : el.hasAttribute('data-explode-group') ? 'group:'+el.dataset.explodeGroup : null;
  const ownText = el => [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
  const nodes = [...cv.querySelectorAll('[data-layer-id],[data-region-id],[data-explode-group]')];
  const records = {};
  for (const el of nodes) {
    const key = keyOf(el);
    if (records[key]) throw new Error('重复图层/区域/模块标识：'+key);
    if(key.startsWith('group:')) {
      const children=[];
      const visit = parent => { for(const child of parent.children) {if(keyOf(child)) continue; const value=view(child);value.text=ownText(child);children.push(value);visit(child);} };
      visit(el);
      records[key]={...view(el),text:ownText(el),children};
    } else records[key] = { ...view(el), children: [...el.querySelectorAll('*')].map(view) };
  }
  const treeOf = el => {
    const key=keyOf(el);
    if(key) return {key,paint:getComputedStyle(el).zIndex};
    const value=view(el);
    value.text=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
    return {view:value,paint:getComputedStyle(el).zIndex,children:[...el.children].map(treeOf)};
  };
  const tree=treeOf(cv);
  const broken = [...document.images].filter(i=>!i.complete || i.naturalWidth===0).map(i=>i.getAttribute('src'));
  return { tree, canvas: { width: +cv.dataset.canvasWidth, height: +cv.dataset.canvasHeight, rect: rect(cv), style: view(cv).style }, records, broken, fonts: document.fonts.status, fontErrors: [...document.fonts].filter(f=>f.status==='error').map(f=>f.family) };
}
export class ProjectStore {
  constructor(root) {
    this.root = fs.realpathSync(root);
    this.configFile = path.join(this.root, 'poster.json');
    safeFile(this.root, 'poster.json'); safeFile(this.root, 'index.html');
    this.trace = path.join(this.root, '.trace');
    safeFile(this.root, '.trace', false);
    fs.mkdirSync(path.join(this.trace, 'versions'), { recursive: true });
  }
  async locked(fn) {
    const lock = path.join(this.trace, 'project.lock');
    try { fs.mkdirSync(lock); } catch (e) { if(e.code==='EEXIST') fail('PROJECT_BUSY', '工程正在保存或渲染，请稍后重试',409); throw e; }
    try {
      fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
      this.recover();
      return await fn();
    } finally { fs.rmSync(lock, { recursive:true, force:true }); }
  }
  recover() {
    const journal = path.join(this.trace, 'transaction.json');
    if (!fs.existsSync(journal)) return;
    const { revision } = readJSON(journal);
    const dir = this.versionDir(revision);
    const meta = readJSON(path.join(dir,'meta.json'));
    const html = fs.readFileSync(path.join(dir,'index.html'),'utf8');
    if (sha(html)!==meta.htmlHash) fail('CORRUPT_VERSION','历史快照损坏，无法恢复事务');
    const restoredResources=Object.entries(meta.resources).map(([relative,hash])=>{const data=fs.readFileSync(path.join(dir,'resources',relative));if(sha(data)!==hash) fail('CORRUPT_VERSION','事务素材快照哈希不匹配');return [relative,data];});
    for (const [relative,data] of restoredResources) atomic(safeFile(this.root,relative,false),data);
    atomic(path.join(this.root,'index.html'),html);
    writeJSON(this.configFile,readJSON(path.join(dir,'poster.json')));
    fs.rmSync(journal);
    this.event('transaction_recovered',{revision});
  }
  versionDir(revision) {
    if (!/^v\d{6}-[a-f0-9]{12}$/.test(revision||'')) fail('INVALID_VERSION','无效的版本标识');
    return safeFile(this.root, `.trace/versions/${revision}`, false);
  }
  event(type, detail) {
    fs.appendFileSync(path.join(this.trace,'events.jsonl'),JSON.stringify({type,ts:new Date().toISOString(),...detail})+'\n');
  }
  current() {
    const config=readJSON(this.configFile), revision=config.agent?.currentRevision;
    if (!revision) fail('NOT_ADOPTED','请先执行 project.mjs adopt，为当前设计建立版本基线');
    const dir=this.versionDir(revision), meta=readJSON(path.join(dir,'meta.json'));
    const html=fs.readFileSync(path.join(this.root,'index.html'),'utf8');
    if (sha(html)!==meta.htmlHash) fail('UNCOMMITTED_HTML','index.html 已在版本工具以外修改；请保留改动并以候选文件提交，不可继续使用旧版本',409);
    const saved=readJSON(path.join(dir,'poster.json'));
    const stable = c => { const x=structuredClone(c); delete x.agent?.export; return x; };
    if(JSON.stringify(stable(config))!==JSON.stringify(stable(saved))) fail('UNCOMMITTED_CONFIG','poster.json 的版本配置或保护规则被外部修改',409);
    return {revision,config,html,meta};
  }
  status() {
    const current=this.current();
    const history=fs.readdirSync(path.join(this.trace,'versions')).filter(s=>/^v\d{6}-[a-f0-9]{12}$/.test(s)&&fs.existsSync(path.join(this.versionDir(s),'meta.json'))).sort().map(s=>readJSON(path.join(this.versionDir(s),'meta.json')));
    const resourceErrors=Object.entries(current.meta.resources).flatMap(([relative,hash])=>{try{return sha(fs.readFileSync(safeFile(this.root,relative)))===hash?[]:[relative];}catch{return [relative];}});
    return {resourceErrors,revision:current.revision,html:'index.html',canvas:current.config.canvas,protection:current.config.agent.protection||{},export:current.config.agent.export?{...current.config.agent.export,current:current.config.agent.export.revision===current.revision&&!resourceErrors.length}:null,history:history.map(({revision,parent,task,at})=>({revision,parent,task,at}))};
  }
  resources(html, origin) {
    // Localize browser-computed same-project URLs, retaining relative references.
    if (origin) html=html.split(origin+'/').join('');
    const prefix=pathToFileURL(this.root+path.sep).href;
    html=html.split(prefix).join('');
    if (/<(?:script|iframe|object|embed|base)\b|\son[a-z]+\s*=|javascript\s*:|@import|http-equiv\s*=\s*["']?refresh/i.test(html)) fail('UNSAFE_HTML','设计包含脚本、嵌入内容或外部行为');
    const refs=[];
    for(const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)'";]+)["']?\s*\)/gi)) refs.push(m[1]||m[2]);
    const resources={};
    for(let relative of refs) {
      if(relative.startsWith('#')) continue;
      if(/^(?:[a-z]+:|\/\/|\/)/i.test(relative)) fail('EXTERNAL_ASSET',`不允许工程外素材：${relative}`);
      relative=decodeURIComponent(relative.split(/[?#]/)[0]);
      const file=safeFile(this.root,relative);
      relative=path.relative(this.root,file);
      if (!relative.startsWith('assets'+path.sep) && !relative.startsWith('licenses'+path.sep)) fail('INVALID_ASSET','设计素材必须位于 assets/ 或 licenses/');
      resources[relative]=sha(fs.readFileSync(file));
      if(relative.startsWith('assets/fonts/')) {
        const license=path.join(path.dirname(relative),'LICENSE.txt');
        if(fs.existsSync(safeFile(this.root,license,false))) resources[license]=sha(fs.readFileSync(safeFile(this.root,license)));
      }
    }
    return {html,resources};
  }
  async analyze(html) {
    const temp=path.join(this.root,`_pa_${randomUUID()}.html`);
    fs.writeFileSync(temp,html);
    let browser;
    try {
      browser=await launch();
      const page=await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', req=>{
        try {
          const u=new URL(req.url());
          if(u.protocol==='file:') { safeFile(this.root,path.relative(this.root,fileURLToPath(u))); req.continue(); }
          else if(u.protocol==='data:') req.continue();
          else req.abort();
        } catch { req.abort(); }
      });
      await page.setViewport({width:1600,height:2400});
      await page.goto(pathToFileURL(temp).href,{waitUntil:'networkidle0'});
      await page.evaluate(()=>document.fonts.ready);
      const info=await page.evaluate(inspectDOM,visualProps);
      if(info.broken.length) fail('MISSING_ASSET','图片无法解码或加载：'+info.broken.join(', '));
      if(info.fontErrors.length) fail('FONT_ERROR','字体文件无法解码或加载：'+info.fontErrors.join(', '));
      if(info.fonts!=='loaded') fail('FONT_ERROR','字体没有加载完成');
      return info;
    } finally { if(browser) await browser.close(); fs.rmSync(temp,{force:true}); }
  }
  checkProtection(config, before, after, task, resources) {
    const policy=config.agent?.protection||{};
    for(const asset of policy.assets||[]) {
      const file=safeFile(this.root,asset.path);
      if(sha(fs.readFileSync(file))!==asset.sha256) fail('PROTECTED_ASSET',`原始素材已被修改：${asset.path}`);
    }
    const allowed=new Set([...(task.scope?.layers||[]).map(id=>'layer:'+id),...(task.scope?.regions||[]).map(id=>'region:'+id),...(task.scope?.groups||[]).map(id=>'group:'+id)]);
    if(task.actor==='agent' && !task.scope?.all && !allowed.size) fail('SCOPE_REQUIRED','局部修改必须声明允许修改的图层或区域');
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    if(task.actor==='agent' && !task.scope?.all) {
      if(!same(before.canvas,after.canvas)) fail('OUT_OF_SCOPE','局部修改改变了画布或全局样式');
      const mask = node => {
        if(node.key) return allowed.has(node.key) ? null : node;
        return {...node,children:node.children.map(mask).filter(Boolean)};
      };
      if(!same(mask(before.tree),mask(after.tree))) fail('OUT_OF_SCOPE','局部修改改变了未经授权的背景、装饰、结构或绘制顺序');
      for(const key of new Set([...Object.keys(before.records),...Object.keys(after.records)])) {
        if(!allowed.has(key) && !same(before.records[key],after.records[key])) fail('OUT_OF_SCOPE',`未经授权修改：${key}`);
      }
    }
    for(const id of task.scope?.preserveLayers||[]) if(!same(before.records['layer:'+id],after.records['layer:'+id])) fail('OUT_OF_SCOPE',`声明保留的图层发生变化：${id}`);
    for(const [id,rule] of Object.entries(policy.layers||{})) {
      const a=before.records['layer:'+id],b=after.records['layer:'+id];
      if(!a||!b) fail('PROTECTED_LAYER',`受保护图层缺失：${id}`);
      if(rule.locked && !same(a,b)) fail('LOCKED_LAYER',`锁定图层不得修改：${id}`);
      if(rule.trustedText!==undefined && b.text!==rule.trustedText) fail('TRUSTED_TEXT',`可信文字不匹配：${id}`);
      if(['product','qr'].includes(rule.kind)) {
        const strip=r=>{const x=structuredClone(r);delete x.rect;delete x.style['clip-path'];delete x.style['object-position'];delete x.style['object-fit']; for(const c of x.children){delete c.rect;delete c.style['clip-path'];delete c.style['object-position'];delete c.style['object-fit'];}return x;};
        if(!same(strip(a),strip(b))) fail('PROTECTED_CONTENT',`只能移动、缩放或裁剪受保护原始素材图层：${id}`);
        const ops=rule.operations||['move','resize','crop'];
        if(!ops.includes('move') && !same(a.rect.slice(0,2),b.rect.slice(0,2))) fail('PROTECTED_OPERATION',`不得移动：${id}`);
        if(!ops.includes('resize') && !same(a.rect.slice(2),b.rect.slice(2))) fail('PROTECTED_OPERATION',`不得缩放：${id}`);
        if(!ops.includes('crop') && ['object-fit','object-position','clip-path'].some(p=>a.style[p]!==b.style[p])) fail('PROTECTED_OPERATION',`不得裁剪：${id}`);
      }
    }
    for(const [relative,hash] of Object.entries(resources)) if(sha(fs.readFileSync(safeFile(this.root,relative)))!==hash) fail('ASSET_CHANGED','验证期间素材发生变化',409);
  }
  async validate(html, config) {
    const temp=path.join(this.root,`_pa_check_${randomUUID()}.html`);
    fs.writeFileSync(temp,html);
    let warnings=[];
    try {
      const check=spawnSync('bash',[path.join(scripts,'check-poster.sh'),temp],{encoding:'utf8'});
      if(check.status!==0) fail('INVALID_HTML',check.stdout+check.stderr);
      const contract=spawnSync(process.execPath,[path.join(scripts,'check-contract.mjs'),temp,'--json',...(config.agent?.freeEditing?['--allow-text-overlap']:[])],{encoding:'utf8',timeout:90000});
      if(contract.status!==0) fail('INVALID_CONTRACT',contract.stdout+contract.stderr);
      warnings=JSON.parse(contract.stdout).checks.filter(c=>c.warning).map(c=>c.msg);
    } finally { fs.rmSync(temp,{force:true}); }
    const info=await this.analyze(html),c=config.canvas;
    if(info.canvas.width!==c.width||info.canvas.height!==c.height||info.canvas.rect[2]!==c.width||info.canvas.rect[3]!==c.height) fail('CANVAS_MISMATCH','画布尺寸与 poster.json 不一致');
    if(!Object.keys(info.records).some(k=>k.startsWith('layer:'))) fail('INVALID_HTML','设计没有可编辑图层');
    for(const [key,r] of Object.entries(info.records)) if(r.rect[0]<-0.5||r.rect[1]<-0.5||r.rect[0]+r.rect[2]>c.width+0.5||r.rect[1]+r.rect[3]>c.height+0.5) fail('LAYER_OVERFLOW',`图层超出画布：${key}`);
    return {...info,warnings};
  }
  commit(html, config, task, parent, resources, validation) {
    const versionNames=fs.readdirSync(path.join(this.trace,'versions')).filter(s=>/^v\d{6}-/.test(s));
    const n=1+Math.max(0,...versionNames.map(s=>Number(s.slice(1,7))));
    const revision=`v${String(n).padStart(6,'0')}-${sha(html).slice(0,12)}`;
    const dir=this.versionDir(revision);
    fs.mkdirSync(dir);
    const next=structuredClone(config);
    next.agent={...next.agent,schema:'poster-agent/v1',currentRevision:revision};
    delete next.agent.export;
    const meta={revision,parent,at:new Date().toISOString(),htmlHash:sha(html),resources,task,validation};
    try {
      fs.writeFileSync(path.join(dir,'index.html'),html);
      fs.writeFileSync(path.join(dir,'poster.json'),JSON.stringify(next,null,2)+'\n');
      for(const relative of Object.keys(resources)) {
        const dest=path.join(dir,'resources',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});const data=fs.readFileSync(safeFile(this.root,relative));if(sha(data)!==resources[relative]) fail('ASSET_CHANGED','保存期间素材发生变化',409);fs.writeFileSync(dest,data);
      }
      fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify(meta,null,2)+'\n');
    } catch(e) {fs.rmSync(dir,{recursive:true,force:true});throw e;}
    writeJSON(path.join(this.trace,'transaction.json'),{revision});
    atomic(path.join(this.root,'index.html'),html);
    writeJSON(this.configFile,next);
    this.event('design_version',{revision,parent,task,validation});
    fs.rmSync(path.join(this.trace,'transaction.json'));
    return {revision,parent,validation};
  }
  async adopt(task) {
    return this.locked(async()=>{
      const config=readJSON(this.configFile);
      if(config.agent?.currentRevision) return this.status();
      if(!fs.existsSync(path.join(this.trace,'manifest.json'))) writeJSON(path.join(this.trace,'manifest.json'),{schema:'runlog/v1',run_id:randomUUID(),created_at:new Date().toISOString(),skill:'poster-agent',workspace:this.root,label:task.summary||'Versioned poster project',status:'running'});
      const normalized=this.resources(fs.readFileSync(path.join(this.root,'index.html'),'utf8'));
      config.agent ||= {};
      for(const asset of config.agent.protection?.assets||[]) {
        const actual=sha(fs.readFileSync(safeFile(this.root,asset.path)));
        if(asset.sha256 && asset.sha256!==actual) fail('PROTECTED_ASSET','受保护素材哈希不匹配');
        asset.sha256=actual;
        normalized.resources[asset.path]=actual;
      }
      for (const rule of Object.values(config.agent.protection?.layers||{})) {
        if(rule.trustedText!==undefined && (!rule.trustedSource || !fs.readFileSync(safeFile(this.root,rule.trustedSource),'utf8').includes(rule.trustedText))) fail('UNTRUSTED_FACT','可信文字必须提供包含原值的工程内 trustedSource');
      }
      const info=await this.validate(normalized.html,config);
      this.checkProtection(config,info,info,{actor:'system'},normalized.resources);
      return this.commit(normalized.html,config,{...task,type:'create',actor:'agent'},null,normalized.resources,{contract:'pass',assets:'pass'});
    });
  }
  async save({baseRevision,html,task,origin}) {
    return this.locked(async()=>{
      const before=this.current();
      if(baseRevision!==before.revision) fail('VERSION_CONFLICT','版本冲突：工程已有更新，请先下载当前未保存 HTML，再重新打开最新版本',409);
      if(!task||!['redesign','background','layers','repair','human-edit'].includes(task.type)||!['agent','human'].includes(task.actor)) fail('INVALID_TASK','必须记录任务类型与操作者');
      for(const [relative,hash] of Object.entries(before.meta.resources)) if(sha(fs.readFileSync(safeFile(this.root,relative)))!==hash) fail('ASSET_CHANGED', `已保存的素材被外部修改：${relative}`);
      const normalized=this.resources(html,origin);
      for(const asset of before.config.agent.protection?.assets||[]) normalized.resources[asset.path]=sha(fs.readFileSync(safeFile(this.root,asset.path)));
      const afterInfo=await this.validate(normalized.html,before.config),beforeInfo=await this.analyze(before.html);
      this.checkProtection(before.config,beforeInfo,afterInfo,task,normalized.resources);
      // Re-read after browser work to detect another process or a direct external edit.
      if(this.current().revision!==baseRevision) fail('VERSION_CONFLICT','验证期间工程版本改变',409);
      const actualChanges={targets:[...new Set([...Object.keys(beforeInfo.records),...Object.keys(afterInfo.records)])].filter(key=>JSON.stringify(beforeInfo.records[key])!==JSON.stringify(afterInfo.records[key])),addedResources:Object.keys(normalized.resources).filter(f=>!before.meta.resources[f]),removedResources:Object.keys(before.meta.resources).filter(f=>!normalized.resources[f]),structureChanged:JSON.stringify(beforeInfo.tree)!==JSON.stringify(afterInfo.tree)};
      return this.commit(normalized.html,before.config,{...task,actualChanges},baseRevision,normalized.resources,{contract:'pass',scope:'pass',protection:'pass',assets:'pass',warnings:afterInfo.warnings||[]});
    });
  }
  async restore(revision,baseRevision) {
    return this.locked(async()=>{
      const current=this.current();
      if(current.revision!==baseRevision) fail('VERSION_CONFLICT','恢复前版本已经改变',409);
      const dir=this.versionDir(revision),meta=readJSON(path.join(dir,'meta.json'));
      const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
      if(sha(html)!==meta.htmlHash) fail('CORRUPT_VERSION','历史 HTML 哈希不匹配');
      // Stage asset restoration with backups so a failed validation leaves current files intact.
      const backups=new Map();
      try {
        for(const [relative,hash] of Object.entries(meta.resources)) {
          const data=fs.readFileSync(path.join(dir,'resources',relative));
          if(sha(data)!==hash) fail('CORRUPT_VERSION','历史素材哈希不匹配');
          const file=safeFile(this.root,relative,false);backups.set(file,fs.existsSync(file)?fs.readFileSync(file):null);atomic(file,data);
        }
        await this.validate(html,current.config);
        return this.commit(html,current.config,{type:'restore',actor:'human',restoredFrom:revision,summary:'恢复历史版本并生成新版本'},baseRevision,meta.resources,{contract:'pass',assets:'pass'});
      } catch(e) {for(const [f,data] of backups) {if(data) atomic(f,data);else fs.rmSync(f,{force:true});}throw e;}
    });
  }
  async exportPNG(baseRevision) {
    return this.locked(async()=>{
      let browser,temp;
      try {
        const current=this.current();
        if(current.revision!==baseRevision) fail('VERSION_CONFLICT','导出前版本已经改变',409);
        const normalized=this.resources(current.html);
        for(const [relative,hash] of Object.entries(current.meta.resources)) if(sha(fs.readFileSync(safeFile(this.root,relative)))!==hash) fail('ASSET_CHANGED',`素材与保存版本不符：${relative}`);
        await this.validate(normalized.html,current.config);
        const scale=current.config.dpi ? current.config.dpi/96 : (current.config.scale||2);
        if(!Number.isFinite(scale)||scale<=0||scale>8) fail('INVALID_SCALE','导出倍率必须大于 0 且不超过 8');
        browser=await launch();
        const {page,errors}=await open(browser,path.join(this.root,'index.html'),{width:current.config.canvas.width,height:current.config.canvas.height});
        await page.setViewport({width:current.config.canvas.width,height:current.config.canvas.height,deviceScaleFactor:scale});
        await page.evaluate(()=>document.fonts.ready);
        if(errors.length) fail('RENDER_ERROR','页面加载报错：'+errors.join('; '));
        const broken=await page.evaluate(()=>[...document.images].some(i=>!i.complete||!i.naturalWidth));
        if(broken) fail('MISSING_ASSET','导出时存在未加载图片');
        const canvas=await page.$('[data-canvas-width]'),box=await canvas.boundingBox();
        temp=safeFile(this.root,`out/.render-${randomUUID()}.png`,false);fs.mkdirSync(path.dirname(temp),{recursive:true});
        await page.screenshot({path:temp,type:'png',clip:box,captureBeyondViewport:true});
        const data=fs.readFileSync(temp),width=data.readUInt32BE(16),height=data.readUInt32BE(20);
        if(width!==Math.round(current.config.canvas.width*scale)||height!==Math.round(current.config.canvas.height*scale)) fail('RENDER_SIZE','PNG 实际尺寸不正确');
        if(this.current().revision!==baseRevision) fail('VERSION_CONFLICT','渲染期间版本改变',409);
        for(const [relative,hash] of Object.entries(current.meta.resources)) if(sha(fs.readFileSync(safeFile(this.root,relative)))!==hash) fail('ASSET_CHANGED','渲染期间素材改变',409);
        const relative=`out/poster-${baseRevision}.png`;
        atomic(safeFile(this.root,relative,false),data);atomic(safeFile(this.root,'out/poster.png',false),data);
        const receipt={revision:baseRevision,path:relative,width,height,sha256:sha(data),at:new Date().toISOString()};
        current.config.agent.export=receipt;writeJSON(this.configFile,current.config);
        this.event('design_export',receipt);
        return receipt;
      } catch(e) {this.event('design_export_failed',{revision:baseRevision,code:e.code||'RENDER_ERROR',message:e.message});throw e;}
      finally {if(browser) await browser.close();if(temp) fs.rmSync(temp,{force:true});}
    });
  }
}
