// Copyright 2026 Poster Agent. Apache-2.0. Reuses the existing project store and editor.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {ProjectStore,safeFile} from '../skills/poster-agent/scripts/project-store.mjs';
import {importEditorImage} from '../skills/poster-agent/scripts/editor-upload.mjs';
import {AppError} from './config.mjs';
export const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const skill=path.join(repo,'skills/poster-agent');
export const runFile=promisify(execFile);
export const readJSON=(f,fallback=null)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return fallback;}};
export function writeJSON(f,v){fs.mkdirSync(path.dirname(f),{recursive:true});const temp=f+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(v,null,2)+'\n',{mode:0o600});fs.renameSync(temp,f);}
const digest=b=>createHash('sha256').update(b).digest('hex');
export const downloadStem=title=>String(title).normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'海报';
export class Workspace{
 constructor({dataDir=path.join(repo,'.poster-agent'),exampleDirs=[path.join(repo,'examples')]}={}){this.dataDir=path.resolve(dataDir);fs.mkdirSync(path.join(this.dataDir,'projects'),{recursive:true});this.dataDir=fs.realpathSync(this.dataDir);this.roots=[path.join(this.dataDir,'projects'),...exampleDirs.map(p=>fs.existsSync(p)?fs.realpathSync(p):path.resolve(p))];}
 entries(){const out=[];for(const root of this.roots){if(!fs.existsSync(root))continue;for(const d of fs.readdirSync(root,{withFileTypes:true})){if(!d.isDirectory()||d.isSymbolicLink())continue;const dir=path.join(root,d.name);if(!fs.existsSync(path.join(dir,'poster.json'))||!fs.existsSync(path.join(dir,'index.html')))continue;if(fs.realpathSync(dir)!==dir)continue;const config=readJSON(path.join(dir,'poster.json'));if(!config?.canvas||!config.agent?.currentRevision)continue;const id=digest(dir).slice(0,20);out.push({id,root:dir,title:readJSON(path.join(dir,'.trace/app.json'))?.title||config.agent?.app?.title||d.name,canvas:config.canvas,revision:config.agent?.currentRevision||null,export:config.agent?.export?{...config.agent.export,current:config.agent.export.revision===config.agent.currentRevision}:null,createdAt:config.agent?.app?.createdAt||fs.statSync(dir).birthtime.toISOString(),example:root!==this.roots[0]});}}return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 project(id){const e=this.entries().find(p=>p.id===id);if(!e)throw new AppError('PROJECT_NOT_FOUND','工程不存在',404);return {...e,store:new ProjectStore(e.root)};}
 async delete(id){
  const p=this.project(id),trash=path.join(this.dataDir,'deleted-projects'),destination=path.join(trash,randomUUID());
  await p.store.locked(()=>{fs.mkdirSync(trash,{recursive:true});try{fs.renameSync(p.root,destination);}catch(e){if(e.code==='EXDEV')throw new AppError('DELETE_LOCATION','工程与本地存储不在同一磁盘，未删除任何文件');throw e;}});
  // The project lock moves with its directory; remove only that completed lock.
  fs.rmSync(path.join(destination,'.trace/project.lock'),{recursive:true,force:true});
  return {deleted:true,id};
 }
 async rename(id,{title}){
  if(typeof title!=='string'||!title.trim()||title.trim().length>100||/[\x00-\x1f\x7f]/.test(title))throw new AppError('INVALID_PROJECT','项目名称须为1–100字，不能包含控制字符');
  const p=this.project(id);
  await p.store.locked(()=>{const file=path.join(p.root,'.trace/app.json');writeJSON(file,{...readJSON(file,{}),title:title.trim()});});
  return this.entries().find(x=>x.id===id);
 }
 async create({title='未命名海报',width=1152,height=2048}={}){
  if(typeof title!=='string'||!title.trim()||title.length>100||!Number.isInteger(width)||!Number.isInteger(height)||width<320||height<320||width>4096||height>4096)throw new AppError('INVALID_PROJECT','名称限100字，画布宽高须为320–4096的整数');
  const dir=path.join(this.roots[0],randomUUID());
  await runFile('bash',[path.join(skill,'scripts/init-poster.sh'),dir],{timeout:30000,maxBuffer:1024*1024});
  const config={canvas:{width,height},scale:1,dpi:null,zones:null,agent:{freeEditing:true,protection:{layers:{},assets:[]},app:{title:title.trim(),createdAt:new Date().toISOString()}}};writeJSON(path.join(dir,'poster.json'),config);
  fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>新海报工程</title><style>:root{--font-body:"PingFang SC",sans-serif}*{box-sizing:border-box}html,body{margin:0;padding:0}.poster{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#edf4f1;font-family:var(--font-body)}</style></head><body><main class="poster" data-canvas-width="${width}" data-canvas-height="${height}"><div data-layer-id="welcome" style="position:absolute;left:64px;top:64px;width:240px;height:48px;font-size:32px;line-height:48px">开始你的设计</div></main></body></html>`);
  const store=new ProjectStore(dir);await store.adopt({summary:'新建空白工程，等待用户需求',routes:[],tools:['app.create']});return this.entries().find(p=>p.root===dir);
 }
 attachments(id){const p=this.project(id);return readJSON(path.join(p.root,'.trace/attachments.json'),[]);}
 async upload(id,{name,dataURL}){
  const p=this.project(id);if(typeof name!=='string'||name.length>240||typeof dataURL!=='string')throw new AppError('INVALID_UPLOAD','缺少文件名或文件内容');
  const match=dataURL.match(/^data:([^;,]*);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)throw new AppError('INVALID_UPLOAD','文件编码无效');const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>5*1024*1024)throw new AppError('UPLOAD_SIZE','单个文件须为1字节至5MB');
  const ext=path.extname(name).toLowerCase(),sha256=digest(bytes);let result,extracted;
  if(['.png','.jpg','.jpeg','.webp'].includes(ext)){result=await importEditorImage(p.store,{baseRevision:p.store.current().revision,dataURL});}
  else{
   if(!['.xlsx','.csv','.txt','.md','.json'].includes(ext))throw new AppError('UPLOAD_TYPE','支持图片、XLSX、CSV、TXT、Markdown、JSON');
   const relative='.trace/imports/'+sha256+ext,file=safeFile(p.root,relative,false);fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});
   if(ext==='.xlsx'){try{const r=await runFile(process.env.POSTER_AGENT_PYTHON||'python3',[path.join(repo,'app/read-workbook.py'),file],{timeout:15000,maxBuffer:2*1024*1024});extracted=JSON.parse(r.stdout);}catch{throw new AppError('WORKBOOK_READ','XLSX 读取失败：需要 Python 3，且文件需为有效、未加密且大小适中的工作簿');}}
   else{extracted=bytes.toString('utf8');if(extracted.includes('\u0000'))throw new AppError('UPLOAD_TYPE','文件不是可读取的文本');if(ext==='.json'){try{extracted=JSON.parse(extracted);}catch{throw new AppError('UPLOAD_JSON','JSON 格式无效');}}}
   if(JSON.stringify(extracted).length>240000)throw new AppError('UPLOAD_SIZE','表格/文本内容过多，请精简至12,000个单元格以内');result={path:relative,sha256};
  }
  const attachment={id:randomUUID(),name,path:result.path,sha256:result.sha256,width:result.width,height:result.height,kind:result.width?'image':'document',extracted,at:new Date().toISOString()};
  // Serialize inventory updates against version saves and parallel uploads.
  await p.store.locked(()=>{const list=this.attachments(id);list.push(attachment);writeJSON(path.join(p.root,'.trace/attachments.json'),list);});return attachment;
 }
 async thumbnail(id,relative){const p=this.project(id);if(!/^(?:assets|reference)\/.+\.(png|jpe?g|webp)$/i.test(relative)&&!/^out\/poster(?:-v\d{6}-[a-f0-9]{12})?\.png$/.test(relative))throw new AppError('INVALID_IMAGE_PATH','只允许查看当前工程图片');const file=safeFile(p.root,relative);
  const {launch,open}=await import('../skills/poster-agent/scripts/_browser.mjs');const browser=await launch();try{const {pathToFileURL}=await import('node:url');const page=await browser.newPage();await page.goto('about:blank');const src='data:'+({'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[path.extname(file).toLowerCase()])+';base64,'+fs.readFileSync(file).toString('base64');return await page.evaluate(async src=>{const im=new Image();im.src=src;await im.decode();const k=Math.min(1,640/im.width,640/im.height),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.75);},src);}finally{await browser.close();}}
}
