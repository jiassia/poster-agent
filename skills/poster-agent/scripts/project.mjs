#!/usr/bin/env node
// Poster Agent, 2026-11-10. Apache-2.0. Deterministic project operations.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ProjectStore, ProjectError, sha } from './project-store.mjs';
import { launch, open } from './_browser.mjs';

// Explicit user-requested geometry unlock, versioned like all project changes.
// Preserve content/pixel guards; never rewrite an immutable historical snapshot.
export async function unlockPositions(store,{baseRevision}) {
  return store.locked(async()=>{
    const current=store.current();
    if(current.revision!==baseRevision)throw new ProjectError('VERSION_CONFLICT','解锁前已有新版本，请先读取最新工程',409);
    if(store.status().resourceErrors.length)throw new ProjectError('ASSET_CHANGED','当前素材与保存版本不一致');
    const config=structuredClone(current.config),policy=config.agent.protection||{layers:{},assets:[]};config.agent.protection=policy;
    policy.layers||={};policy.assets||=[];
    const before=await store.analyze(current.html),unlocked=[],expanded=[],text=[];
    const trustedFile=`assets/unlock-content-${randomUUID()}.txt`;
    for(const [id,rule]of Object.entries(policy.layers)) {
      if(rule.locked) {
        const record=before.records['layer:'+id];
        if(!record)throw new ProjectError('PROTECTED_LAYER','原锁定图层不存在：'+id);
        if(rule.trustedText===undefined&&record.text) {rule.trustedText=record.text;rule.trustedSource=trustedFile;text.push(record.text);}
        delete rule.locked;unlocked.push(id);
      }
      if(rule.operations&&(!rule.operations.includes('move')||!rule.operations.includes('resize'))) {
        rule.operations=[...new Set([...rule.operations,'move','resize'])];expanded.push(id);
      }
    }
    if(!unlocked.length&&!expanded.length)return {revision:current.revision,unchanged:true};
    const resources={...current.meta.resources};
    if(text.length) {
      const data=Buffer.from(text.join('\n')+'\n');fs.writeFileSync(path.join(store.root,trustedFile),data,{flag:'wx'});
      const digest=sha(data);resources[trustedFile]=digest;policy.assets.push({path:trustedFile,sha256:digest,kind:'trusted-source'});
    }
    const html=current.html.replace(/\sdata-pa-locked=(['"])1\1/g,'');
    const after=await store.validate(html,config);
    if(JSON.stringify(before.records)!==JSON.stringify(after.records)||JSON.stringify(before.canvas)!==JSON.stringify(after.canvas))throw new ProjectError('UNEXPECTED_CHANGE','解锁不得改变任何图层的内容、样式或坐标');
    store.checkProtection(config,before,after,{actor:'human'},resources);
    const saved=store.commit(html,config,{type:'protection-update',actor:'human',summary:'按用户要求解除所有位置锁定；保留可信文字与原图保护',unlocked,expanded,tools:['project.unlock-positions'],actualChanges:{visualRecords:[],protectionOnly:true}},current.revision,resources,{contract:'pass',contentAndCoordinates:'identical',protection:'pass'});
    return {...saved,unlocked,expanded};
  });
}

// Remove editing restrictions only on explicit user instruction; preserve latest visuals/history.
export async function unlockEditing(store,{baseRevision}) {
  return store.locked(async()=>{
    const current=store.current();
    if(current.revision!==baseRevision)throw new ProjectError('VERSION_CONFLICT','工程已有新版本，请先读取最新工程',409);
    const config=structuredClone(current.config);
    if(config.agent.freeEditing===true&&!Object.keys(config.agent.protection?.layers||{}).length&&!(config.agent.protection?.assets||[]).length)return {revision:current.revision,unchanged:true};
    config.agent.freeEditing=true;
    config.agent.protection={layers:{},assets:[]};
    const before=await store.analyze(current.html);
    const html=current.html.replace(/\sdata-pa-(?:locked|trusted|kind|operations)=(['"])[^'"]*\1/g,'');
    const after=await store.validate(html,config);
    if(JSON.stringify(before.records)!==JSON.stringify(after.records)||JSON.stringify(before.canvas)!==JSON.stringify(after.canvas))throw new ProjectError('UNEXPECTED_CHANGE','解除限制不得改变当前内容或排版');
    return store.commit(html,config,{type:'protection-update',actor:'human',summary:'用户要求完全自由编辑：解除文字、图片和图层操作限制',tools:['project.unlock-editing']},current.revision,current.meta.resources,{contract:'pass',contentAndCoordinates:'identical',editing:'unrestricted'});
  });
}

export async function patchProject(store, {baseRevision,target,style,text,src,task}) {
  const current=store.current();
  if(current.revision!==baseRevision) throw new ProjectError('VERSION_CONFLICT','开始修改前工程已有更新',409);
  if(!/^(layer|region|group):[\w-]+$/.test(target)) throw new ProjectError('INVALID_TARGET','使用 layer:ID、region:ID 或 group:ID');
  const [kind,id]=target.split(':');
  const rule=kind==='layer'?current.config.agent.protection?.layers?.[id]:null;
  if(rule?.locked) throw new ProjectError('LOCKED_LAYER','该图层已锁定');
  if(rule?.kind==='qr' && src!==undefined) throw new ProjectError('PROTECTED_CONTENT','二维码不得生成或替换像素');
  if(style && (typeof style!=='object'||Object.values(style).some(v=>typeof v!=='string'||/[<>]/.test(v)))) throw new ProjectError('INVALID_PATCH','样式值必须是 CSS 字符串');
  const browser=await launch();let candidate;
  try {
    const {page}=await open(browser,path.join(store.root,'index.html'));
    candidate=await page.evaluate(({kind,id,style,text,src})=>{
      const el=document.querySelector(`[${kind==='group'?'data-explode-group':kind==='layer'?'data-layer-id':'data-region-id'}="${id}"]`);
      if(!el) throw new Error('目标不存在');
      // The inherited editor may promote grouped leaves to canvas siblings.
      // Preserve semantic module membership through data-explode-parent.
      const promoted = kind==='group' ? [...document.querySelectorAll(`[data-explode-parent="${id}"]`)].filter(node=>!el.contains(node)) : [];
      for(const [key,value] of Object.entries(style||{})) {
        el.style.setProperty(key,value);
        if(['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing'].includes(key)) for(const member of promoted) member.style.setProperty(key,value);
      }
      if(text!==undefined) {if(el.children.length) throw new Error('混合内容须修改具体文字叶子');el.textContent=text;}
      if(src!==undefined) {if(el.tagName!=='IMG') throw new Error('图片替换须指定 IMG 图层');el.setAttribute('src',src);}
      return {html:'<!doctype html>\n'+document.documentElement.outerHTML,layers:[...new Set([...el.querySelectorAll('[data-layer-id]'),...promoted])].map(e=>e.dataset.layerId),regions:[...el.querySelectorAll('[data-region-id]')].map(e=>e.dataset.regionId)};
    },{kind,id,style,text,src});
  } finally {await browser.close();}
  return store.save({baseRevision,html:candidate.html,task:{...task,actor:'agent',scope:{layers:kind==='layer'?[id]:candidate.layers,regions:[...(kind==='region'?[id]:[]),...candidate.regions],groups:kind==='group'?[id]:[],preserveLayers:task?.scope?.preserveLayers||[]}}});
}

async function main() {
  const [command,project,...args]=process.argv.slice(2);
  if(!project) throw new Error('Usage: project.mjs {adopt|status|save|patch|restore|export|unlock-positions|unlock-editing} PROJECT [JSON_FILE or VERSION]');
  const store=new ProjectStore(project);
  const request=()=>JSON.parse(fs.readFileSync(args[0],'utf8'));
  let result;
  if(command==='status') result=await store.locked(()=>store.status());
  else if(command==='adopt') result=await store.adopt(args[0]?request():{summary:'为现有设计建立基线',routes:[],tools:['adopt']});
  else if(command==='patch') result=await patchProject(store,request());
  else if(command==='unlock-editing') result=await unlockEditing(store,request());
  else if(command==='unlock-positions') result=await unlockPositions(store,request());
  else if(command==='save') {const data=request();data.html=fs.readFileSync(path.resolve(data.candidate),'utf8');result=await store.save(data);}
  else if(command==='restore') result=await store.restore(args[0],args[1]);
  else if(command==='export') result=await store.exportPNG(args[0]);
  else throw new Error('Unknown project command');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) main().catch(e=>{console.error(JSON.stringify({error:e.code||'PROJECT_ERROR',message:e.message}));process.exitCode=1;});
