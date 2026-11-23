#!/usr/bin/env node
// Copyright 2026 Poster Agent. Apache-2.0. Local launch and browser entry only.
import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {pathToFileURL} from 'node:url';
import {startApp} from './server.mjs';import {repo,readJSON,writeJSON} from './workspace.mjs';import {AppError,redact} from './config.mjs';
export async function openBrowser(url){const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];await promisify(execFile)(command,args,{timeout:10000});}
export async function launchApp({stateDir=path.join(repo,'.poster-agent'),configPath=process.env.POSTER_AGENT_CONFIG||path.join(repo,'app/config.local.json'),open=openBrowser,...options}={}){
 configPath=path.resolve(configPath);fs.mkdirSync(stateDir,{recursive:true});const sessionFile=path.join(stateDir,'app-session.json'),lock=path.join(stateDir,'launcher.lock');
 try{fs.mkdirSync(lock);}catch(e){if(e.code!=='EEXIST')throw e;const owner=readJSON(path.join(lock,'owner.json'));let alive=true;if(owner?.pid){try{process.kill(owner.pid,0);}catch(e){alive=e.code!=='ESRCH';}}if(alive)throw new AppError('APP_STARTING','应用正在启动，请稍后再次打开');fs.rmSync(lock,{recursive:true,force:true});fs.mkdirSync(lock);}
 writeJSON(path.join(lock,'owner.json'),{pid:process.pid});let app;
 const release=()=>fs.rmSync(lock,{recursive:true,force:true});
 const show=async url=>{if(open)try{await open(url);}catch{console.warn('浏览器未能自动打开，请复制下方完整网址到浏览器。');}};
 try{
  const saved=readJSON(sessionFile);let existing=false;
  if(saved&&/^http:\/\/127\.0\.0\.1:\d+$/.test(saved.origin)&&/^[a-f0-9]{64}$/.test(saved.token)){
   try{const response=await fetch(saved.origin+'/api/bootstrap',{headers:{'X-Poster-Token':saved.token},redirect:'error',signal:AbortSignal.timeout(2000)});if(response.ok){const b=await response.json();existing=b.config?.path===saved.configPath;}}catch{}
  }
  if(existing){if(saved.configPath!==configPath)throw new AppError('OTHER_CONFIG_RUNNING','已有应用使用另一份配置运行，请先关闭原启动终端');const url=saved.origin+'/#token='+saved.token;release();await show(url);return {url,reused:true};}
  app=await startApp({...options,configPath});writeJSON(sessionFile,{origin:app.origin,token:app.token,configPath});release();
  const close=async()=>{if(readJSON(sessionFile)?.token===app.token)fs.rmSync(sessionFile,{force:true});await app.close();};
  await show(app.url);return {url:app.url,app,reused:false,close};
 }catch(e){release();if(app)await app.close();throw e;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 launchApp({open:process.argv.includes('--no-open')?null:openBrowser}).then(result=>{
  console.log('\nPoster Agent '+(result.reused?'已打开正在运行的应用':'已启动'));
  console.log('本机访问地址：\n'+result.url);
  console.log(result.reused?'无需重复启动服务。':'保持此终端运行；按 Ctrl+C 停止。启动本身不调用模型。');
  if(!result.reused){let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;result.close().then(()=>process.exit(0));});}
 }).catch(e=>{console.error(redact(e.message));process.exitCode=1;});
}
