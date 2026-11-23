#!/usr/bin/env node
// Poster Agent, 2026-11-10. Apache-2.0. Single-project loopback editor bridge.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProjectStore, ProjectError, safeFile } from './project-store.mjs';
import {importEditorImage} from './editor-upload.mjs';
const scripts=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
export async function serveProject(project,{port=0}={}) {
  const store=new ProjectStore(project);
  await store.locked(()=>store.status());
  const token=randomBytes(32).toString('hex');let origin;
  function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if(req.headers.host!==new URL(origin).host) throw new ProjectError('INVALID_HOST','只允许当前 localhost 地址',403);
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/api/')) {
        const supplied=Buffer.from(req.headers['x-poster-token']||''),expected=Buffer.from(token);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)) throw new ProjectError('UNAUTHORIZED','编辑器会话无效；请使用服务启动时提供的完整链接',403);
        if(req.headers.origin && req.headers.origin!==origin) throw new ProjectError('INVALID_ORIGIN','不允许跨站写入',403);
        if(req.method==='GET'&&url.pathname==='/api/state') return json(res,200,await store.locked(()=>store.status()));
        if(req.method!=='POST'||req.headers['content-type']?.split(';')[0]!=='application/json') throw new ProjectError('INVALID_REQUEST','必须提交 JSON',405);
        const chunks=[];let size=0;
        for await(const chunk of req) {size+=chunk.length;if(size>8*1024*1024) throw new ProjectError('BODY_TOO_LARGE','设计文件超过 8MB',413);chunks.push(chunk);}
        let data;try {data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch {throw new ProjectError('INVALID_JSON','无效 JSON',400);}
        if(url.pathname==='/api/upload-image') return json(res,200,await importEditorImage(store,data));
        if(url.pathname==='/api/save') {
          const saved=await store.save({baseRevision:data.baseRevision,html:data.html,origin,task:{type:'human-edit',actor:'human',summary:'独立编辑器保存',routes:[],tools:['layer-editor.fullHTML','project.save'],scope:{layers:[],regions:[]}}});
          // Save and render are distinct: a failed render must not undo or hide a successful save.
          return json(res,200,saved);
        }
        if(url.pathname==='/api/export') return json(res,200,await store.exportPNG(data.baseRevision));
        if(url.pathname==='/api/restore') return json(res,200,await store.restore(data.revision,data.baseRevision));
        throw new ProjectError('NOT_FOUND','未知操作',404);
      }
      if(!['GET','HEAD'].includes(req.method)) throw new ProjectError('METHOD_NOT_ALLOWED','静态资源只读',405);
      let relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'editor.html';
      if(relative==='editor.html') {
        const result=await store.locked(()=>{
          const current=store.current();
          const wired=spawnSync(process.execPath,[path.join(scripts,'wire-editor.mjs'),path.join(store.root,'index.html')],{encoding:'utf8'});
          if(wired.status!==0) throw new Error(wired.stderr||wired.stdout);
          return fs.readFileSync(path.join(store.root,'editor.html'),'utf8').replace('</head>',`<meta name="poster-agent-revision" content="${current.revision}">\n</head>`);
        });
        res.writeHead(200,{'Content-Type':mime['.html']});return res.end(req.method==='HEAD'?'':result);
      }
      const rootFiles=['index.html','layer-editor.js','layer-editor.css','project-bridge.js'];
      const allowedAsset=/^assets\//.test(relative)&&['.png','.jpg','.jpeg','.webp','.svg','.woff2'].includes(path.extname(relative));
      const allowedPNG=/^out\/poster(?:-v\d{6}-[a-f0-9]{12})?\.png$/.test(relative);
      if(!rootFiles.includes(relative)&&!allowedAsset&&!allowedPNG) throw new ProjectError('NOT_FOUND','文件不在共享范围',404);
      const file=safeFile(store.root,relative),data=fs.readFileSync(file);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?'':data);
    } catch(e) {if(!res.headersSent) json(res,e.status||500,{error:e.code||'SERVER_ERROR',message:e.message});else res.destroy();}
  });
  server.requestTimeout=300000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,store,origin,token,url:`${origin}/editor.html#token=${token}`,close:()=>new Promise(resolve=>{server.closeIdleConnections();server.close(resolve);})};
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const project=process.argv[2];
  if(!project) {console.error('Usage: serve-project.mjs PROJECT [PORT]');process.exitCode=2;}
  else serveProject(project,{port:Number(process.argv[3]||0)}).then(service=>{
    console.log(JSON.stringify({url:service.url,project:service.store.root,host:'127.0.0.1'}));
    for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>service.close().then(()=>process.exit(0)));
  }).catch(e=>{console.error(e.message);process.exitCode=1;});
}
