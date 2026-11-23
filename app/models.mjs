// Copyright 2026 Poster Agent. Apache-2.0. Read-only discovery and local selection.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {AppError,credential,publicConfig,readConfig,imageProfile} from './config.mjs';import {modelPresets} from './model-catalog.mjs';
import {MODELS} from '../skills/poster-agent/scripts/providers/openai-image.mjs';
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id)&&!id.startsWith('sk-');
export async function discoverModels(c,{fetchImpl=fetch}={}){
 const key=credential(c.model,{configDir:path.dirname(c.file)});let response;
 try{response=await fetchImpl(c.model.baseURL+'/models',{method:'GET',headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new AppError('MODEL_LIST_NETWORK','无法读取模型列表；没有自动换地址或发送生成请求。你仍可从预置列表选择。',502);}
 if(!response.ok)throw new AppError('MODEL_LIST_HTTP','读取模型列表返回 HTTP '+response.status+'；未发送生成请求。可继续使用预置选项。',502);
 let raw,data;try{raw=await response.text();if(raw.length>1024*1024)throw Error();data=JSON.parse(raw);}catch{throw new AppError('MODEL_LIST_FORMAT','接口未返回有效的模型列表；可继续使用预置选项。',502);}
 if(!Array.isArray(data.data))throw new AppError('MODEL_LIST_FORMAT','接口缺少 data 模型列表',502);
 const ids=[...new Set(data.data.map(x=>x?.id).filter(id=>valid(id)&&!id.includes(key)))];
 return {source:'api-reported',baseURL:c.model.baseURL,networkChecked:true,toolCallingVerified:false,models:ids.map(id=>({id,label:modelPresets.find(m=>m.id===id)?.label||id,kind:/image|embedding|whisper|tts|moderation|realtime|sora|audio/i.test(id)?'specialized':'candidate'})),note:'接口报告的模型 ID；不代表已验证工具调用、视觉能力或实际上游身份。'};
}
export function selectModel(file,{model}){
 if(!valid(model))throw new AppError('INVALID_MODEL','模型 ID 格式无效');const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.model||={};raw.model.model=model;
 const tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(raw,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);fs.chmodSync(file,0o600);}finally{fs.rmSync(tmp,{force:true});}
 return publicConfig(readConfig(file));
}

export function selectImage(file,{enabled,model,useModelConnection}){
 if(typeof enabled!=='boolean'||typeof useModelConnection!=='boolean'||!Object.hasOwn(MODELS,model))throw new AppError('INVALID_IMAGE_CONFIG','请选择支持的图像模型与连接方式');
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.image={...raw.image,enabled,model,useModelConnection};
 const tmp=file+'.'+randomUUID()+'.tmp';try{
  fs.writeFileSync(tmp,JSON.stringify(raw,null,2)+'\n',{flag:'wx',mode:0o600});const c=readConfig(tmp);
  if(enabled)credential(imageProfile(c),{configDir:path.dirname(path.resolve(file))});
  fs.renameSync(tmp,file);fs.chmodSync(file,0o600);
 }finally{fs.rmSync(tmp,{force:true});}
 return publicConfig(readConfig(file));
}
