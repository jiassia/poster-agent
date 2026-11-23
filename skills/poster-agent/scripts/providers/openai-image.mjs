// Poster Agent, 2026-11-10. Apache-2.0. OpenAI-compatible Images API adapter.
import fs from 'node:fs';
import path from 'node:path';
import {digest,imageError,PURPOSES} from '../image-utils.mjs';
export const DEFAULT_BASE_URL='https://api.openai.com/v1';
export function resolveBaseURL(value=DEFAULT_BASE_URL) {
  let url;
  try {url=new URL(value||DEFAULT_BASE_URL);}catch {throw imageError('INVALID_BASE_URL','OPENAI_BASE_URL 必须是有效的 HTTPS API 根地址');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw imageError('INVALID_BASE_URL','API 根地址仅支持 HTTPS，不能包含用户名、密码、查询参数或片段');
  url.pathname=url.pathname.replace(/\/+$/,'')||'/v1';
  return url.href.replace(/\/$/,'');
}
// Verified official model profiles, not an account-access guarantee. Unknown models
// require a reviewed profile here; never silently substitute a requested model.
const flexible={flexible:true,qualities:['auto','low','medium','high'],transparent:'preview'};
const standard={flexible:false,qualities:['auto','low','medium','high'],transparent:true};
export const MODELS={
  'gpt-image-2':{...flexible,deprecated:true},
  'gpt-image-2-2026-04-21':{...flexible,deprecated:true},
  'gpt-image-1.5':standard,'gpt-image-1-mini':standard,
  ...Object.fromEntries(['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare'].map(id=>[id,{...flexible,transparent:true,qualities:['auto','low','medium','high','xhigh','max']}]))
};
function credential(env,root,read=false) {
  if(env.OPENAI_API_KEY?.trim())return read?env.OPENAI_API_KEY.trim():'environment';
  if(!env.OPENAI_API_KEY_FILE)return null;
  const name=path.resolve(env.OPENAI_API_KEY_FILE),actual=fs.realpathSync(name),stat=fs.statSync(actual);
  let boundary=root;
  if(root)for(let dir=root;;dir=path.dirname(dir)){if(fs.existsSync(path.join(dir,'.git'))){boundary=dir;break;}if(path.dirname(dir)===dir)break;}
  if(boundary&&(actual===boundary||actual.startsWith(boundary+path.sep)))throw imageError('UNSAFE_KEY_FILE','密钥文件必须位于海报工程与 Git 仓库之外');
  if(!stat.isFile()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))throw imageError('UNSAFE_KEY_FILE','密钥文件需归当前用户所有且权限为 600');
  return read?fs.readFileSync(actual,'utf8').trim():'private-file';
}
export function openAIParameters(request) {
  const profile=MODELS[request.model];if(!profile)throw imageError('UNSUPPORTED_MODEL','该模型没有经过核对的 OpenAI Images 参数配置');
  const {size,aspectRatio}=request;
  let dimensions=size;
  if(!dimensions&&aspectRatio){const [w,h]=aspectRatio.split(':').map(Number);dimensions=w===h?{width:1024,height:1024}:w>h?{width:1536,height:1024}:{width:1024,height:1536};}
  if(!dimensions)throw imageError('INVALID_SIZE','需要尺寸或比例');
  const {width:w,height:h}=dimensions;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1)throw imageError('INVALID_SIZE','尺寸必须为正整数');
  if(profile.flexible) {
    if(w%16||h%16||Math.max(w,h)>3840||Math.max(w/h,h/w)>3||w*h<655360||w*h>8294400)throw imageError('INVALID_SIZE','该模型尺寸要求：16 的倍数、边长≤3840、比例≤3:1、655360–8294400 像素');
  } else if(!['1024x1024','1024x1536','1536x1024'].includes(`${w}x${h}`))throw imageError('INVALID_SIZE','该模型仅支持 1024x1024、1024x1536、1536x1024');
  if(aspectRatio){const [aw,ah]=aspectRatio.split(':').map(Number);if(Math.abs(w/h-aw/ah)>0.01)throw imageError('ASPECT_RATIO_MISMATCH','比例与实际请求尺寸不一致，请提供明确 size');}
  const quality=request.quality||'low',background=request.background||'opaque';
  if(!profile.qualities.includes(quality))throw imageError('INVALID_QUALITY','模型不支持指定 quality');
  if(!['opaque','transparent','auto'].includes(background))throw imageError('INVALID_BACKGROUND','未知背景参数');
  if(background==='transparent'&&profile.transparent==='preview'&&!request.allowPreviewTransparency)throw imageError('PREVIEW_REQUIRED','GPT Image 2 透明背景为预览能力；需显式 allowPreviewTransparency 或选择其他支持模型');
  const safety=request.purpose==='composition-reference'?'Non-shipping composition reference.':'Create ONLY one independent visual asset. No text, letters, numbers, price, SKU, QR code, watermark, logo, typography, cards or complete poster layout. Live text and protected product photographs are composed separately in HTML. Leave calm negative space where appropriate.';
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  const divisor=gcd(w,h),orientation=w===h?'square':w<h?'portrait':'landscape';
  // Use the same validated dimensions for the API field and effective prompt.
  // This reinforces intent for wrappers; actual PNG dimensions remain enforced.
  const dimensionsPrompt=`Output image dimensions: exactly ${w}x${h} pixels (width ${w} px, height ${h} px), aspect ratio ${w/divisor}:${h/divisor}, ${orientation} orientation. These are the required dimensions of the image file itself, not text to draw in the image. Do not substitute another size or aspect ratio. Compose directly for this canvas.`;
  const prompt=request.prompt+'\n\n'+safety+'\n\n'+dimensionsPrompt;
  if(prompt.length>32000)throw imageError('PROMPT_TOO_LONG','附加素材边界后的提示词超过 32000 字符');
  return {model:request.model,prompt,n:1,size:`${w}x${h}`,quality,background,output_format:'png'};
}
// Hash includes normalized wire parameters and exact local reference bytes.
export function openAIPlan(request,{baseURL=DEFAULT_BASE_URL}={}) {
  const parameters=openAIParameters(request),references=(request.references||[]).map(relative=>{
    const file=path.resolve(request.projectRoot,relative);return {path:relative,sha256:digest(fs.readFileSync(file))};
  });
  const base=resolveBaseURL(baseURL),url=base+(references.length?'/images/edits':'/images/generations');
  const thirdParty=new URL(base).origin!==new URL(DEFAULT_BASE_URL).origin;
  const plan={provider:'openai',baseURL:base,url,endpoint:new URL(url).pathname,thirdParty,parameters,references,output:request.output};
  return {...plan,requestHash:digest(JSON.stringify(plan)),paid:true,modelsAccess:'not-verified',warnings:[...(thirdParty?[`将向 ${new URL(base).origin} 发送该中转站密钥、提示词及所选参考图；中转站协议和模型支持未经联网验证`]:[]),...(MODELS[request.model].deprecated?['官方模型页面标记 deprecated；没有自动替换模型，账户可用性未验证']:[]),...(parameters.background==='transparent'&&MODELS[request.model].transparent==='preview'?['透明背景需要账户的 preview 支持']:[])]};
}
export function createOpenAIProvider({env=process.env,fetchImpl=globalThis.fetch}={}) {
  const plan=request=>openAIPlan(request,{baseURL:env.OPENAI_BASE_URL||DEFAULT_BASE_URL});
  return {id:'openai',paid:true,
    async detect(){let source,baseURL;try{baseURL=resolveBaseURL(env.OPENAI_BASE_URL||DEFAULT_BASE_URL);source=credential(env,null,false);}catch(e){return {available:false,models:Object.keys(MODELS),purposes:PURPOSES,reason:e.code==='INVALID_BASE_URL'?e.message:'密钥文件不可用或权限不安全',accountAccess:'not-verified',networkChecked:false};}return {available:Boolean(source),baseURL,thirdParty:new URL(baseURL).origin!==new URL(DEFAULT_BASE_URL).origin,models:Object.keys(MODELS),purposes:PURPOSES,reason:source?'适配器已配置；未访问 API 验证模型权限或中转站兼容性':'未配置 OPENAI_API_KEY 或 OPENAI_API_KEY_FILE',accountAccess:'not-verified',networkChecked:false};},
    plan,
    async generate(request,{authorization}={}) {
      const execution=plan(request);
      if(!authorization?.allowPaid||authorization.requestHash!==execution.requestHash)throw imageError('PAID_REQUEST_NOT_APPROVED','真实请求需要用户明确批准，并提供与当前地址和计划一致的 requestHash');
      const key=credential(env,request.projectRoot,true);if(!key)throw imageError('MISSING_KEY','未配置 OpenAI 密钥');
      const headers={Authorization:`Bearer ${key}`};let body;
      if(execution.references.length) {
        body=new FormData();for(const [k,v] of Object.entries(execution.parameters))body.append(k,String(v));
        for(const ref of execution.references){const file=path.join(request.projectRoot,ref.path),ext=path.extname(file).toLowerCase();const type=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[ext];
          if(!type||fs.statSync(file).size>=50*1024*1024)throw imageError('INVALID_REFERENCE','参考图需为小于 50MB 的 PNG/JPEG/WebP');
          const bytes=fs.readFileSync(file);if(digest(bytes)!==ref.sha256)throw imageError('REFERENCE_CHANGED','参考图在计划后发生变化；未发送请求');
          body.append('image[]',new Blob([bytes],{type}),path.basename(file));}
      } else {headers['Content-Type']='application/json';body=JSON.stringify(execution.parameters);}
      // Persist only structured metadata, never headers, credentials or raw errors.
      const diagnostic={wireRequest:{model:execution.parameters.model,size:execution.parameters.size,quality:execution.parameters.quality,n:execution.parameters.n,background:execution.parameters.background,output_format:'png',contentType:execution.references.length?'multipart/form-data':'application/json',bodySHA256:typeof body==='string'?digest(body):null}};
      const fail=(code,message)=>{throw Object.assign(imageError(code,message),{diagnostic});};
      const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)&&!value.includes(key)&&!value.includes('sk-')?value:null;
      let response;
      try {response=await fetchImpl(execution.url,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(180000)});}
      catch {fail('NETWORK_AMBIGUOUS','请求超时或网络失败，可能已计费；未自动重试，请先核对用量');}
      const mime=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
      diagnostic.response={httpStatus:response.status,requestId:safeId(response.headers?.get('x-request-id')),contentType:['application/json','text/plain','text/html','image/png','application/octet-stream'].includes(mime)?mime:'other',model:null};
      // Model support is classified only from an explicit, known structured code.
      // An arbitrary 400 (or wrong output size) does not imply model unsupported.
      if(!response.ok){
        const status=response.status;let modelUnsupported=false;
        if([400,404].includes(status)&&Number(response.headers?.get('content-length')||0)<1024*1024){
          try {const error=await response.json();modelUnsupported=['model_not_found','unsupported_model','invalid_model'].includes(error?.error?.code);}catch {}
        }
        fail(modelUnsupported?'UPSTREAM_MODEL_UNSUPPORTED':status===401?'AUTH_FAILED':status===403?'MODEL_ACCESS_DENIED':status===429?'RATE_LIMITED':status>=500?'UPSTREAM_ERROR':'API_REJECTED',`图像服务返回 HTTP ${status}；未自动重试，请检查账户、参数或用量`);
      }
      if(Number(response.headers?.get('content-length')||0)>90*1024*1024)fail('INVALID_RESPONSE','API 响应过大');
      let value;try{value=await response.json();}catch{fail('INVALID_RESPONSE','API 未返回有效 JSON');}
      diagnostic.response.model=safeId(value?.model);
      const encoded=value?.data?.length===1&&value.data[0]?.b64_json;
      diagnostic.response.imageEncoding='base64-png';
      if(typeof encoded!=='string'||encoded.length>90*1024*1024||!encoded.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('INVALID_RESPONSE','API 未返回单张有效 base64 PNG；不下载未知 URL');
      return {data:Buffer.from(encoded,'base64'),usage:value.usage||null,requestId:diagnostic.response.requestId,diagnostic,requestHash:execution.requestHash};
    }
  };
}
