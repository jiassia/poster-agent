// Copyright 2026 Poster Agent. Apache-2.0.
import {modelPresets} from './model-catalog.mjs';
import {MODELS} from '../skills/poster-agent/scripts/providers/openai-image.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
export class AppError extends Error{constructor(code,message,status=422){super(message);this.code=code;this.status=status;}}
export const expand=p=>typeof p==='string'&&p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):p;
export function baseURL(value){
 let url;try{if(typeof value!=='string'||value.trim()!==value||/[\s\[\]()]/.test(value))throw Error();url=new URL(value);}catch{throw new AppError('INVALID_CONFIG','baseURL 必须是纯 URL，不能使用 Markdown 链接');}
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new AppError('INVALID_CONFIG','API 地址必须使用 HTTPS（本地模型可用 localhost HTTP），不能包含账户、查询参数或片段');
 return url.href.replace(/\/+$/,'');
}
export function readConfig(file){
 let c;try{c=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new AppError('INVALID_CONFIG','无法读取模型 JSON 配置，请检查格式');}
 c.model||={};c.image||={enabled:false};c.server||={};
 c.model.baseURL=baseURL(c.model.baseURL);if(!['responses','chat-completions'].includes(c.model.apiFormat))throw new AppError('INVALID_CONFIG','apiFormat 使用 responses 或 chat-completions');
 if(typeof c.model.model!=='string'||c.model.model.length>128)throw new AppError('INVALID_CONFIG','请填写模型名称');
 for(const [k,d,min,max]of [['maxOutputTokens',12000,256,64000],['maxCallsPerTask',12,1,30],['timeoutMs',180000,1000,300000]]){c.model[k]??=d;if(!Number.isInteger(c.model[k])||c.model[k]<min||c.model[k]>max)throw new AppError('INVALID_CONFIG',k+' 超出允许范围');}
 if(c.image.enabled){baseURL(imageProfile(c).baseURL);if(!c.image.model)throw new AppError('INVALID_CONFIG','图像模型名称缺失');}
 if(c.server.port!==undefined&&(!Number.isInteger(c.server.port)||c.server.port<0||c.server.port>65535))throw new AppError('INVALID_CONFIG','server.port 需要0–65535的整数');
 c.file=path.resolve(file);return c;
}
export function credential(profile,{env=process.env,required=true,configDir=process.cwd()}={}){
 let key=profile.apiKey;
 if(!key&&profile.apiKeyEnv)key=env[profile.apiKeyEnv];
 if(!key&&profile.apiKeyFile){const file=path.resolve(configDir,expand(profile.apiKeyFile));try{const stat=fs.statSync(file);if(process.platform!=='win32'&&(stat.mode&0o077))throw new AppError('KEY_PERMISSIONS','密钥文件应仅当前用户可读，请设置 chmod 600');key=fs.readFileSync(file,'utf8').trim();}catch(e){if(e instanceof AppError)throw e;if(required)throw new AppError('KEY_UNAVAILABLE','配置的密钥文件不存在或无法读取');}}
 if(!key&&required)throw new AppError('KEY_UNAVAILABLE','未配置模型密钥；请填写独立配置，不会沿用旧密钥');
 if(key&&(typeof key!=='string'||/[\r\n\s]/.test(key)))throw new AppError('KEY_UNAVAILABLE','密钥格式无效');return key||null;
}
export function imageProfile(c){
 return c.image.useModelConnection===true?{...c.image,baseURL:c.model.baseURL,apiKey:c.model.apiKey,apiKeyFile:c.model.apiKeyFile,apiKeyEnv:c.model.apiKeyEnv}:c.image;
}
export function publicConfig(c){
 let keyConfigured=false,keyStatus='未配置密钥';
 try{keyConfigured=!!credential(c.model,{required:false,configDir:path.dirname(c.file)});if(keyConfigured)keyStatus='已从本地配置读取，无需重复填写';}catch(e){keyStatus=e.message;}
 let imageKeyConfigured=false,imageKeyStatus='未配置图像密钥';const image=imageProfile(c);try{imageKeyConfigured=!!credential(image,{required:false,configDir:path.dirname(c.file)});if(imageKeyConfigured)imageKeyStatus=c.image.useModelConnection?'沿用主模型连接与密钥':'已从本地图像配置读取';}catch(e){imageKeyStatus=e.message;}
 const ready=!!c.model.model&&keyConfigured;
 const reason=ready?'本地配置就绪，尚未联网验证权限或兼容性':!keyConfigured?keyStatus:'密钥已配置，请选择主模型';
 return {path:c.file,model:{apiFormat:c.model.apiFormat,baseURL:c.model.baseURL,model:c.model.model,choices:modelPresets,ready,reason,keyConfigured,keyStatus,supportsImages:c.model.supportsImages!==false},image:{enabled:!!c.image.enabled,useModelConnection:c.image.useModelConnection===true,baseURL:image.baseURL||null,model:c.image.model||'gpt-image-2.6-flare',choices:Object.keys(MODELS),keyConfigured:imageKeyConfigured,keyStatus:imageKeyStatus,ready:!!c.image.enabled&&imageKeyConfigured&&!!MODELS[c.image.model],reason:!c.image.enabled?'未启用':!imageKeyConfigured?imageKeyStatus:'本地配置就绪，模型权限及生图接口尚未验证'},networkChecked:false};
}
export function redact(message){return String(message).replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]');}
