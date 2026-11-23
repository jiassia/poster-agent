#!/usr/bin/env node
// Copyright 2026 Poster Agent. Apache-2.0. Local UI/API only; no global credentials.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {randomBytes,timingSafeEqual} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {Workspace,repo,readJSON,runFile,downloadStem} from './workspace.mjs';import {Agent} from './agent.mjs';import {AppError,readConfig,publicConfig,redact} from './config.mjs';
import {discoverModels,selectModel,selectImage} from './models.mjs';
import {safeFile} from '../skills/poster-agent/scripts/project-store.mjs';import {serveProject} from '../skills/poster-agent/scripts/serve-project.mjs';
export async function startApp({configPath=process.env.POSTER_AGENT_CONFIG||path.join(repo,'app/config.local.json'),workspace=new Workspace(),clientFactory,modelFetch,port}={}){
 configPath=path.resolve(configPath);if(!fs.existsSync(configPath)){fs.mkdirSync(path.dirname(configPath),{recursive:true});fs.copyFileSync(path.join(repo,'app/config.example.json'),configPath,fs.constants.COPYFILE_EXCL);fs.chmodSync(configPath,0o600);}
 const getConfig=()=>readConfig(configPath),initial=getConfig(),agent=new Agent(workspace,{config:getConfig,clientFactory});agent.recover();
 const token=randomBytes(32).toString('hex'),editors=new Map(),deleting=new Set();let origin;
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 const cleanProject=({root,...p})=>({...p,downloadName:downloadStem(p.title)});
 const disposition=(title,ext,type='attachment')=>type+'; filename="poster.'+ext+'"; filename*=UTF-8\'\''+encodeURIComponent(downloadStem(title)+'.'+ext).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{if(req.headers.host!==new URL(origin).host)throw new AppError('INVALID_HOST','只允许当前本地地址',403);const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/')){
    const supplied=Buffer.from(req.headers['x-poster-token']||''),expected=Buffer.from(token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new AppError('UNAUTHORIZED','请使用启动时提供的完整本地链接',403);
    if(req.headers.origin&&req.headers.origin!==origin)throw new AppError('INVALID_ORIGIN','不允许跨站访问',403);
    let body={};if(req.method==='POST'){if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new AppError('INVALID_BODY','必须提交 JSON');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new AppError('BODY_TOO_LARGE','请求超过8MB',413);chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('INVALID_JSON','JSON 无效');}}
    if(req.method==='GET'&&url.pathname==='/api/bootstrap'){const config=publicConfig(getConfig());return json(res,200,{config,projects:workspace.entries().map(cleanProject)});}
    if(req.method==='POST'&&url.pathname==='/api/projects'){const project=await workspace.create(body);return json(res,201,cleanProject(project));}
    if(req.method==='POST'&&url.pathname==='/api/config/models')return json(res,200,await discoverModels(getConfig(),{fetchImpl:modelFetch}));
    if(req.method==='POST'&&url.pathname==='/api/config/image')return json(res,200,selectImage(configPath,body));
    if(req.method==='POST'&&url.pathname==='/api/config/select-model')return json(res,200,selectModel(configPath,body));
    if(req.method==='POST'&&url.pathname==='/api/config/reload')return json(res,200,publicConfig(getConfig()));
    const m=url.pathname.match(/^\/api\/projects\/([a-f0-9]{20})(?:\/(state|attachments|message|stop|approval|editor|png|source|archive|render|rename|delete))?$/);if(!m)throw new AppError('NOT_FOUND','接口不存在',404);
    const id=m[1],route=m[2]||'state';if(deleting.has(id))throw new AppError('PROJECT_DELETING','项目正在删除',409);const project=workspace.project(id);
    if(req.method==='POST'&&route==='delete'){
     if(body.confirm!==true)throw new AppError('DELETE_CONFIRM_REQUIRED','请先确认删除该项目',422);
     if(agent.running.has(id)||agent.approving.has(id))throw new AppError('AGENT_BUSY','项目正在执行任务，请先停止任务后再删除',409);
     deleting.add(id);try{
      if(editors.has(id)){await editors.get(id).close();editors.delete(id);}
      if(agent.publicState(id).runs.some(r=>r.status==='awaiting-approval'))agent.stop(id);
      return json(res,200,await workspace.delete(id));
     }finally{deleting.delete(id);}
    }
    if(req.method==='POST'&&route==='rename')return json(res,200,cleanProject(await workspace.rename(id,body)));
    if(req.method==='GET'&&route==='state'){const s=project.store.status();return json(res,200,{project:cleanProject(project),status:s,attachments:workspace.attachments(id).map(({extracted,...a})=>a),...agent.publicState(id)});}
    if(req.method==='POST'&&route==='attachments'){if(agent.running.has(id))throw new AppError('AGENT_BUSY','请等当前任务完成后再增加素材',409);return json(res,201,await workspace.upload(id,body));}
    if(req.method==='POST'&&route==='message')return json(res,202,agent.start(id,body.message));
    if(req.method==='POST'&&route==='stop')return json(res,200,agent.stop(id));
    if(req.method==='POST'&&route==='approval')return json(res,202,await agent.approve(id,body));
    if(req.method==='POST'&&route==='editor'){if(!editors.has(id))editors.set(id,await serveProject(project.root));return json(res,200,{url:editors.get(id).url});}
    if(req.method==='POST'&&route==='render'){if(agent.running.has(id))throw new AppError('AGENT_BUSY','请等待 Agent 完成当前操作',409);return json(res,200,await project.store.exportPNG(body.baseRevision));}
    if(req.method==='GET'&&route==='png'){const status=project.store.status();if(!status.export?.current)throw new AppError('EXPORT_STALE','最新版本还没有导出，请先导出 PNG',409);const file=safeFile(project.root,status.export.path);res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':disposition(project.title,'png','inline')});return fs.createReadStream(file).pipe(res);}
    if(req.method==='GET'&&route==='source'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':disposition(project.title,'html')});return res.end(project.store.current().html);}
    if(req.method==='POST'&&route==='archive'){if(agent.running.has(id))throw new AppError('AGENT_BUSY','请等待任务结束后下载工程',409);const dir=path.join(workspace.dataDir,'downloads');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,id+'-'+Date.now()+'.zip');await project.store.locked(()=>runFile('zip',['-qr',file,'.','-x','.trace/project.lock/*'],{cwd:project.root,timeout:120000,maxBuffer:1024*1024}));res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':disposition(project.title,'zip')});const stream=fs.createReadStream(file);stream.on('close',()=>fs.rmSync(file,{force:true}));return stream.pipe(res);}
    throw new AppError('METHOD_NOT_ALLOWED','不支持此操作',405);
   }
   if(!['GET','HEAD'].includes(req.method))throw new AppError('METHOD_NOT_ALLOWED','仅支持读取',405);
   const files={'/':'index.html','/app.js':'app.js','/progress.js':'progress.js','/style.css':'style.css'};if(!files[url.pathname])throw new AppError('NOT_FOUND','页面不存在',404);const file=path.join(repo,'app/public',files[url.pathname]);res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?'':fs.readFileSync(file));
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.code||'APP_ERROR',message:redact(e instanceof AppError||e.code?e.message:'操作失败，请检查本地运行日志')});else res.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port??initial.server.port??0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
 return {server,workspace,agent,origin,token,url:origin+'/#token='+token,configPath,close:async()=>{for(const id of agent.running.keys())agent.stop(id);await Promise.all([...editors.values()].map(e=>e.close()));await new Promise(r=>{server.closeIdleConnections();server.close(r);});}};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)startApp().then(app=>{console.log(JSON.stringify({url:app.url,config:app.configPath,message:'本地应用已启动；未发送任何模型请求。'}));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));}).catch(e=>{console.error(redact(e.message));process.exitCode=1;});
