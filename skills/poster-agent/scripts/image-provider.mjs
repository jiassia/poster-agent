#!/usr/bin/env node
// Poster Agent, 2026-11-10. Apache-2.0. Unified adapter and immutable asset receipts.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {safeFile} from './project-store.mjs';
import {inspectPNG,imageError,PURPOSES} from './image-utils.mjs';
import {createOpenAIProvider} from './providers/openai-image.mjs';
/**
 * ImageProvider {id, paid, detect(), plan?(request), generate(request, {authorization})}
 * generate returns {data: Buffer, mock?, usage?, requestId?}; legacy injected
 * adapters returning {path,width,height} remain supported. Only the coordinator
 * publishes a validated new asset. No adapter can overwrite a protected file.
 * ImageRequest {provider,model,purpose,prompt,size?|aspectRatio?,references?,output,
 * background?,quality?,sourceKind?,allowPreviewTransparency?}
 * Result {status,path,width,height,sha256,hasTransparency,attempts,jobId,mock,...}
 */
export const defaultProviders=()=>[createOpenAIProvider()];
export async function detectProviders(providers=defaultProviders()) {
  return Promise.all(providers.map(async p=>{try{return {id:p.id,paid:Boolean(p.paid),...await p.detect()};}catch{return {id:p.id,available:false,models:[],purposes:[],reason:'Provider 配置不可用'};}}));
}
export function normalizeImageRequest(root,request) {
  root=fs.realpathSync(root);
  const fields=['provider','model','purpose','prompt','size','aspectRatio','references','output','background','quality','sourceKind','allowPreviewTransparency'];
  if(!request||typeof request!=='object'||Object.keys(request).some(k=>!fields.includes(k)))throw imageError('INVALID_IMAGE_REQUEST','请求包含未知字段；密钥或接口地址不可放入请求文件');
  const {provider,model,purpose,prompt,size,aspectRatio,output}=request;
  if(typeof provider!=='string'||typeof model!=='string'||typeof prompt!=='string'||!prompt.trim())throw imageError('INVALID_IMAGE_REQUEST','缺少 Provider、模型或提示词');
  if(!PURPOSES.includes(purpose))throw imageError('INVALID_PURPOSE','未知素材用途');
  if(['product-original','product','price','product-id','qr'].includes(request.sourceKind))throw imageError('PROTECTED_ASSET','商品原图、可信事实和二维码不能由图像模型重绘');
  if(!size&&!aspectRatio)throw imageError('INVALID_SIZE','必须提供目标尺寸或比例');
  if(size&&(!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<1||size.height<1||size.width*size.height>8294400))throw imageError('INVALID_SIZE','目标尺寸必须为正整数，最多 8294400 像素');
  if(aspectRatio&&(!/^\d+:\d+$/.test(aspectRatio)||aspectRatio.split(':').some(n=>+n<=0)))throw imageError('INVALID_SIZE','比例使用正整数 W:H');
  const expected=purpose==='composition-reference'?'reference/':'assets/';
  const dest=safeFile(root,output,false),relative=path.relative(root,dest).split(path.sep).join('/');
  if(!relative.startsWith(expected)||!relative.endsWith('.png'))throw imageError('INVALID_OUTPUT','参考图必须进入 reference/，交付 PNG 必须进入 assets/');
  if(fs.existsSync(dest))throw imageError('OUTPUT_EXISTS','生成结果不得覆盖已有素材；请选择新文件名');
  if(request.references&&(!Array.isArray(request.references)||request.references.length>16))throw imageError('INVALID_REFERENCE','最多支持 16 张工程内参考图');
  for(const ref of request.references||[]){const file=safeFile(root,ref);if(!/^\.(png|jpe?g|webp)$/i.test(path.extname(file))||fs.statSync(file).size>=50*1024*1024)throw imageError('INVALID_REFERENCE','参考图必须为小于 50MB 的工程内 PNG/JPEG/WebP');}
  return {...request,output:relative,projectRoot:root};
}
export async function planImage(root,request,{providers=defaultProviders()}={}) {
  const normalized=normalizeImageRequest(root,request),adapter=providers.find(p=>p.id===request.provider);
  if(!adapter)throw imageError('PROVIDER_UNAVAILABLE','未注册该 Provider');
  if(!adapter.plan)return {provider:adapter.id,paid:Boolean(adapter.paid),mock:adapter.id==='mock',request:request};
  return adapter.plan(normalized);
}
const redact=message=>String(message).replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').split(process.env.OPENAI_API_KEY||'\0').join('[REDACTED]');
function usageNumbers(value){if(!value||typeof value!=='object')return null;return Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)));}
function failureCategory(code) {
  if(code==='SIZE_MISMATCH')return 'size-validation';
  if(['UNSUPPORTED_MODEL','UNSUPPORTED_CAPABILITY','UPSTREAM_MODEL_UNSUPPORTED'].includes(code))return 'model-support';
  if(['AUTH_FAILED','MODEL_ACCESS_DENIED','RATE_LIMITED','UPSTREAM_ERROR','API_REJECTED'].includes(code))return 'http';
  if(['INVALID_RESPONSE','INVALID_IMAGE','INVALID_RESULT'].includes(code))return 'response-format';
  if(code==='NETWORK_AMBIGUOUS')return 'network';
  return 'validation';
}
// Only a fully decoded, bounded PNG can enter quarantine. It never becomes
// result.path, and applyGeneratedAsset rejects every failed job.
function quarantinePNG(root,jobId,number,data,info) {
  try {
    const relative=`.trace/image-diagnostics/${jobId}/attempt-${number}.png`;
    for(const parent of ['.trace','.trace/image-diagnostics']){
      const entry=path.join(root,parent);
      if(fs.existsSync(entry)&&fs.lstatSync(entry).isSymbolicLink())throw imageError('INVALID_PATH','隔离目录不能使用符号链接');
    }
    const file=safeFile(root,relative,false);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    fs.writeFileSync(file,data,{flag:'wx',mode:0o600});
    return {status:'saved',path:relative,...info,bytes:data.length,shipping:false};
  } catch {return {status:'failed',reason:'DIAGNOSTIC_WRITE_FAILED',shipping:false};}
}
export async function generateImage(root,request,{providers=defaultProviders(),maxAttempts,authorization}={}) {
  root=fs.realpathSync(root);
  const result={provider:request?.provider,model:request?.model,purpose:request?.purpose,status:'failed',path:null,width:null,height:null,attempts:[],jobId:randomUUID(),diagnostic:{requestedSize:request?.size||null,actualSize:null},dimensions:{requested:request?.size||null,source:null}};
  let dest,owned=false,executionPlan;
  try {
    const normalized=normalizeImageRequest(root,request);dest=safeFile(root,normalized.output,false);
    const adapter=providers.find(p=>p.id===request.provider),capability=(await detectProviders(providers)).find(p=>p.id===request.provider);
    if(!adapter||!capability?.available){result.status='unavailable';throw imageError('PROVIDER_UNAVAILABLE',capability?.reason||'未注册该 Provider');}
    if(!capability.models.includes(request.model)||!capability.purposes.includes(request.purpose))throw imageError('UNSUPPORTED_CAPABILITY','Provider 不支持指定模型或素材用途');
    executionPlan=adapter.plan?await adapter.plan(normalized):null;
    if(adapter.paid&&(!executionPlan||!authorization?.allowPaid||authorization.requestHash!==executionPlan.requestHash))throw imageError('PAID_REQUEST_NOT_APPROVED','真实请求需要用户明确批准，并提供与当前计划一致的 requestHash');
    const limit=Math.min(Math.max(Number.isInteger(maxAttempts)?maxAttempts:(adapter.paid?1:2),1),2);
    // Real requests never auto-retry: a timeout/server error may already be billed.
    if(adapter.paid&&limit!==1)throw imageError('PAID_RETRY_DISABLED','真实生图只发送一次；重试需要重新获得用户批准');
    for(let number=1;number<=limit;number++) {
      try {
        const value=await adapter.generate(normalized,{authorization});
        if(value.diagnostic)Object.assign(result.diagnostic,value.diagnostic);
        let data=value.data;
        if(!data){if(fs.realpathSync(value.path)!==fs.realpathSync(dest))throw imageError('INVALID_RESULT','Provider 返回错误输出路径');data=fs.readFileSync(dest);owned=true;}
        const info=inspectPNG(data);
        result.diagnostic.actualSize={width:info.width,height:info.height};
        result.dimensions.source={width:info.width,height:info.height};
        result.diagnostic.decoded={format:'png',bytes:data.length,sha256:info.sha256};
        if(!result.diagnostic.requestedSize&&executionPlan?.parameters?.size){
          const [width,height]=executionPlan.parameters.size.split('x').map(Number);
          result.diagnostic.requestedSize={width,height};
          result.dimensions.requested={width,height};
        }
        if(value.width!==undefined&&(value.width!==info.width||value.height!==info.height))throw imageError('INVALID_RESULT','实际尺寸与 Provider 返回值不一致');
        const expected=result.diagnostic.requestedSize;
        if(expected&&(info.width!==expected.width||info.height!==expected.height)){
          result.diagnostic.quarantine=quarantinePNG(root,result.jobId,number,data,info);
          throw imageError('SIZE_MISMATCH',`请求 ${expected.width}×${expected.height}，实际解码 ${info.width}×${info.height}；未缩放或裁剪，隔离图片不可应用`);
        }
        if(request.background==='transparent'&&!info.hasTransparency)throw imageError('TRANSPARENCY_MISSING','请求透明素材，但结果没有透明像素');
        if(!owned){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data,{flag:'wx'});owned=true;}
        result.attempts.push({number,status:'success'});
        Object.assign(result,{status:'success',path:normalized.output,...info,mock:Boolean(value.mock),usage:usageNumbers(value.usage),requestId:value.requestId||null,requestHash:value.requestHash||null});
        break;
      } catch(e) {
        if(e.diagnostic)Object.assign(result.diagnostic,e.diagnostic);
        result.attempts.push({number,status:'failed',code:e.code||'PROVIDER_ERROR',category:failureCategory(e.code),message:redact(e.message),diagnostic:structuredClone(result.diagnostic)});
        if(owned){fs.rmSync(dest,{force:true});owned=false;}
        if(!e.retryable||number===limit)throw e;
      }
    }
  } catch(e) {result.error={code:e.code||'PROVIDER_ERROR',category:failureCategory(e.code),message:redact(e.message)};}
  // Existing trace is the receipt/evidence store, never a second current-design state.
  const receiptDir=safeFile(root,'.trace/image-jobs',false);fs.mkdirSync(receiptDir,{recursive:true});
  const allowed=['provider','model','purpose','prompt','size','aspectRatio','references','output','background','quality','sourceKind','allowPreviewTransparency'];
  const safeRequest=JSON.parse(redact(JSON.stringify(Object.fromEntries(Object.entries(request||{}).filter(([k])=>allowed.includes(k))))));
  const receipt={schema:'poster-agent/image-job/v1',at:new Date().toISOString(),request:safeRequest,plan:executionPlan||null,result};
  fs.writeFileSync(path.join(receiptDir,result.jobId+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  fs.appendFileSync(safeFile(root,'.trace/events.jsonl',false),JSON.stringify({type:'image_generation',ts:receipt.at,jobId:result.jobId,status:result.status,provider:result.provider,model:result.model,mock:result.mock||false})+'\n');
  return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await detectProviders(),null,2));
