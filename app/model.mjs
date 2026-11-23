// Copyright 2026 Poster Agent. Apache-2.0. OpenAI-compatible tool transport, no implicit retries/fallbacks.
import path from 'node:path';import {AppError,credential} from './config.mjs';
const imageContent=(text,images,format)=>format==='responses'?[{type:'input_text',text},...images.map(url=>({type:'input_image',image_url:url,detail:'low'}))]:[{type:'text',text},...images.map(url=>({type:'image_url',image_url:{url,detail:'low'}}))];
export class ModelClient{
 constructor(config,{fetchImpl=fetch}={}){this.config=config;this.fetch=fetchImpl;}
 user(session,text,images=[]){session.push({role:'user',content:images.length?imageContent(text,images,this.config.model.apiFormat):text});}
 result(session,call,result){const output=JSON.stringify(result);session.push(this.config.model.apiFormat==='responses'?{type:'function_call_output',call_id:call.id,output}:{role:'tool',tool_call_id:call.id,content:output});}
 async next(session,instructions,tools,{signal}={}){
  const c=this.config.model;if(!c.model)throw new AppError('MODEL_NOT_CONFIGURED','请在 JSON 中填写模型名');const key=credential(c,{configDir:path.dirname(this.config.file)});
  const responses=c.apiFormat==='responses';let body;
  if(responses){body={model:c.model,instructions,input:session,tools:tools.map(t=>({type:'function',...t,strict:false})),parallel_tool_calls:false,store:false,max_output_tokens:c.maxOutputTokens};if(c.reasoningEffort)body.reasoning={effort:c.reasoningEffort};}
  else{body={model:c.model,messages:[{role:'system',content:instructions},...session],tools:tools.map(t=>({type:'function',function:t})),parallel_tool_calls:false,max_completion_tokens:c.maxOutputTokens};if(c.reasoningEffort)body.reasoning_effort=c.reasoningEffort;}
  body.stream=!!c.stream;
  if(c.sendMaxOutputTokens===false){delete body.max_output_tokens;delete body.max_completion_tokens;}
  let response;try{response=await this.fetch(c.baseURL+(responses?'/responses':'/chat/completions'),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(c.timeoutMs)]):AbortSignal.timeout(c.timeoutMs)});}catch{throw new AppError('MODEL_NETWORK','模型连接中断或超时，可能已计费；未自动重试或切换服务商',502);}
  if(!response.ok)throw new AppError('MODEL_HTTP','模型接口返回 HTTP '+response.status+'；请核对地址、模型权限、接口格式和余额。未自动重试',502);
  const raw=await response.text();if(raw.length>8*1024*1024)throw new AppError('MODEL_FORMAT','模型响应过大',502);
  let data;try{data=(response.headers.get('content-type')||'').includes('text/event-stream')?decodeEvents(raw,responses):JSON.parse(raw);}catch(e){if(e instanceof AppError)throw e;throw new AppError('MODEL_FORMAT','模型没有返回合法 JSON / SSE',502);}
  let calls,text;
  if(responses){if(!Array.isArray(data.output)||data.status==='incomplete'||data.error)throw new AppError('MODEL_FORMAT','Responses 返回不完整或不兼容，未执行截断的工具调用',502);
   calls=data.output.filter(i=>i.type==='function_call').map(i=>({id:i.call_id,name:i.name,arguments:i.arguments}));text=data.output.filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n');session.push(...data.output);
  }else{const choice=data.choices?.[0],m=choice?.message;if(!m||choice.finish_reason==='length'||choice.finish_reason==='content_filter')throw new AppError('MODEL_FORMAT','Chat Completions 返回不完整或不兼容',502);calls=(m.tool_calls||[]).map(t=>({id:t.id,name:t.function?.name,arguments:t.function?.arguments}));text=typeof m.content==='string'?m.content:'';session.push({role:'assistant',content:m.content??null,...(m.tool_calls?{tool_calls:m.tool_calls}:{})});}
  if(calls.length>8)throw new AppError('MODEL_FORMAT','一次响应的工具调用过多，请让模型分步执行',502);
  if(calls.some(c=>typeof c.id!=='string'||typeof c.name!=='string'||typeof c.arguments!=='string'))throw new AppError('MODEL_FORMAT','工具调用格式不完整',502);
  if(!calls.length&&!text.trim())throw new AppError('MODEL_FORMAT','模型未返回文字或工具调用',502);return {calls,text,model:typeof data.model==='string'?data.model:null,usage:data.usage?Object.fromEntries(Object.entries(data.usage).filter(([,v])=>typeof v==='number')):null};
 }
}

// Some Codex-compatible gateways return SSE even for a local non-streaming UI.
// Execute tools only after a complete response; never use truncated deltas.
function decodeEvents(raw,responses){
 const chunks=raw.replace(/\r\n/g,'\n').split('\n\n'),events=[];
 for(const chunk of chunks){const value=chunk.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!value||value==='[DONE]')continue;events.push(JSON.parse(value));}
 if(responses){const complete=events.find(e=>e.type==='response.completed');if(!complete?.response)throw new AppError('MODEL_FORMAT','模型流未完整结束，未执行工具',502);return complete.response;}
 let text='',finish=null,model=null,usage=null;const calls=[];
 for(const e of events){model=e.model||model;usage=e.usage||usage;const choice=e.choices?.[0];if(!choice)continue;finish=choice.finish_reason||finish;const d=choice.delta||{};text+=d.content||'';
  for(const t of d.tool_calls||[]){const i=t.index;if(!Number.isInteger(i)||i<0||i>7)throw new AppError('MODEL_FORMAT','流式工具索引无效');calls[i]||={id:'',type:'function',function:{name:'',arguments:''}};if(t.id)calls[i].id=t.id;if(t.function?.name)calls[i].function.name+=t.function.name;if(t.function?.arguments)calls[i].function.arguments+=t.function.arguments;}
 }
 if(!finish)throw new AppError('MODEL_FORMAT','Chat 流未完整结束，未执行工具',502);
 return {model,usage,choices:[{finish_reason:finish,message:{role:'assistant',content:text||null,...(calls.length?{tool_calls:calls}:{})}}]};
}
