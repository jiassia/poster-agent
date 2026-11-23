import {taskProgress} from './progress.js';
// Copyright 2026 Poster Agent. Apache-2.0. No credentials in browser storage.
const $=id=>document.getElementById(id),token=new URLSearchParams(location.hash.slice(1)).get('token')||sessionStorage.getItem('poster-app-token');
if(token)sessionStorage.setItem('poster-app-token',token);
let discoveredModels=null,lastStateSync=0;
let config,projects=[],active=null,state=null,polling=false,previewURL=null,previewRevision=null,toastTimer,paintKey='',approvalKey='';
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
async function api(route,data,{binary=false}={}){const r=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{'X-Poster-Token':token||'',...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});if(!r.ok){let body;try{body=await r.json();}catch{}throw Error(body?.message||'请求失败：'+r.status);}return binary?r.blob():r.json();}
async function bootstrap(){const b=await api('bootstrap');config=b.config;projects=b.projects;drawConfig();drawProjects();}
function drawConfig(){const c=config.model;$('model-badge').textContent=c.ready?c.model:'请配置模型';$('model-badge').classList.toggle('ready',c.ready);$('model-badge').title=c.reason;
 const dl=$('config-details');dl.replaceChildren();for(const [name,value]of [['配置文件',config.path],['接口地址',c.baseURL],['接口格式',c.apiFormat],['当前模型',c.model||'请选择下方主模型'],['密钥状态',c.keyStatus],['图像服务',config.image.enabled?config.image.model+' · 每次生成单独审批':'未启用']]){dl.append(el('dt',null,name),el('dd',null,value));}
 if(discoveredModels?.baseURL!==c.baseURL)discoveredModels=null;
 drawModelChoices(discoveredModels?.models||c.choices||[],c.model);
 if(!discoveredModels)$('model-list-note').textContent='选择后自动保存，无需重复配置地址或密钥。型号权限尚未联网验证。';
 drawImageConfig();if(active)drawControls();}
function drawImageConfig(){
 const c=config.image;$('image-enabled').checked=c.enabled;
 $('image-use-model').checked=c.useModelConnection||(!c.enabled&&!c.keyConfigured);
 const select=$('image-model-select');select.replaceChildren();for(const id of c.choices||[]){const option=el('option',null,id);option.value=id;select.append(option);}select.value=c.model;
 $('image-connection-status').textContent=(c.baseURL||'未配置独立图像地址')+' · '+c.keyStatus+' · '+c.reason;
}
let savingImage=false;
async function saveImageConfig(){
 if(savingImage)return;const controls=['image-enabled','image-model-select','image-use-model'];savingImage=true;controls.forEach(id=>$(id).disabled=true);$('image-config-status').textContent='正在保存…';
 try{config=await api('config/image',{enabled:$('image-enabled').checked,model:$('image-model-select').value,useModelConnection:$('image-use-model').checked});drawConfig();$('image-config-status').textContent='已保存。'+config.image.reason;}
 catch(e){drawImageConfig();$('image-config-status').textContent='保存失败：'+e.message;}
 finally{savingImage=false;controls.forEach(id=>$(id).disabled=false);}
}
for(const id of ['image-enabled','image-model-select','image-use-model'])$(id).onchange=saveImageConfig;
function drawProgress(){const message=taskProgress(state,Date.now(),lastStateSync);$('task-progress').textContent=message;$('task-progress').hidden=!message;}
function drawModelChoices(models,selected){
 const select=$('main-model-select');select.replaceChildren();
 const all=[...models];if(selected&&!all.some(m=>m.id===selected))all.unshift({id:selected,label:selected});
 if(!selected){const option=el('option',null,'请选择主模型');option.value='';select.append(option);}
 for(const m of all){const option=el('option',null,m.label+' · '+m.id+(m.kind==='specialized'?'（专用模型）':''));option.value=m.id;option.disabled=m.kind==='specialized';select.append(option);}select.value=selected||'';
}
function drawProjects(){const recent=$('recent-projects');recent.replaceChildren();for(const p of projects.slice(0,12)){const b=el('button',p.id===active?'selected':'',p.title);b.onclick=()=>selectProject(p.id);recent.append(b);}const grid=$('project-grid');grid.replaceChildren();$('project-count').textContent=projects.length+' 个项目';
 for(const p of projects){const card=el('article','project-card');card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','打开项目 '+p.title);const thumb=el('div','project-thumbnail');thumb.append(el('span','project-placeholder','✦'));const info=el('div','project-info');info.append(el('h3',null,p.title));const line=el('p');line.append(el('span',null,p.canvas.width+' × '+p.canvas.height),el('span',null,p.example?'本地已有项目':'我的创作'));info.append(line);const remove=el('button','delete-project','删除');remove.setAttribute('aria-label','删除项目 '+p.title);remove.onclick=e=>{e.stopPropagation();askDeleteProject(p);};remove.onkeydown=e=>e.stopPropagation();card.append(thumb,info,remove);card.onclick=()=>selectProject(p.id);card.onkeydown=e=>{if(e.key==='Enter')selectProject(p.id);};grid.append(card);
  if(p.export?.current)api('projects/'+p.id+'/png',undefined,{binary:true}).then(blob=>{const img=el('img');const url=URL.createObjectURL(blob);img.onload=()=>URL.revokeObjectURL(url);img.src=url;img.alt=p.title;thumb.replaceChildren(img);}).catch(()=>{});
 }
 const add=el('button','project-card project-new');add.append(el('span',null,'＋'),el('strong',null,'新建一张海报'),el('small',null,'从灵感开始，自由创作'));add.onclick=showCreate;grid.append(add);
}
let projectToDelete=null;
function askDeleteProject(project){projectToDelete=project;$('delete-project-name').textContent=project.title;$('delete-project-status').textContent='';$('delete-confirm').disabled=false;$('delete-return').disabled=false;$('delete-project-dialog').showModal();$('delete-return').focus();}
$('delete-return').onclick=()=>{$('delete-project-dialog').close();projectToDelete=null;};
$('delete-confirm').onclick=async()=>{
 if(!projectToDelete)return;const project=projectToDelete;$('delete-confirm').disabled=true;$('delete-return').disabled=true;$('delete-project-status').textContent='正在删除…';
 try{await api('projects/'+project.id+'/delete',{confirm:true});$('delete-project-dialog').close();projectToDelete=null;if(active===project.id){active=null;state=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;previewRevision=null;$('workspace-view').hidden=true;$('home-view').hidden=false;$('breadcrumbs').textContent='工作空间 / 我的项目';}await bootstrap();toast('项目已删除');}
 catch(e){$('delete-project-status').textContent='删除失败：'+e.message;}
 finally{$('delete-confirm').disabled=false;$('delete-return').disabled=false;}
};
function showHome(){active=null;state=null;$('home-view').hidden=false;$('workspace-view').hidden=true;$('breadcrumbs').textContent='工作空间 / 我的项目';paintKey='';bootstrap().catch(e=>toast(e.message));}
function showCreate(){$('create-status').textContent='';$('create-dialog').showModal();$('new-title').focus();}
async function selectProject(id){active=id;paintKey='';approvalKey='';previewRevision=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('poster-preview').hidden=true;$('preview-empty').hidden=false;$('home-view').hidden=true;$('workspace-view').hidden=false;$('messages').replaceChildren(el('p','subtle','正在读取最新工程…'));drawProjects();await refresh().catch(e=>toast(e.message));}
async function refresh(){if(!active||polling)return;polling=true;const id=active;try{const current=await api('projects/'+id+'/state');if(active!==id)return;state=current;lastStateSync=Date.now();drawState();}finally{polling=false;}}
function drawState(){const p=state.project;$('project-title').textContent=p.title;$('project-meta').textContent=(state.status.revision||'新工程')+' · 本地保存';$('canvas-size').textContent=p.canvas.width+' × '+p.canvas.height;$('breadcrumbs').textContent='工作空间 / '+p.title;
 drawControls();drawProgress();drawMessages();drawAttachments();drawTrace();drawApproval();drawPreview();}
function drawControls(){const busy=state?.busy,waiting=state?.runs.some(r=>r.status==='awaiting-approval');$('send-message').disabled=busy||waiting||!config?.model.ready;$('attachment-input').disabled=busy;$('stop-agent').hidden=!busy;$('agent-state').textContent=waiting?'等待生图授权':busy?'正在处理，可随时停止':config?.model.ready?'准备好听你的想法':'先配置你的模型连接';$('send-notice').textContent=config?.model.ready?`发送后将调用 ${config.model.model}，需求与素材会发送至 ${config.model.baseURL}；可能产生模型费用。生图另行确认。`:'先在“模型与设置”中配置接口。浏览项目、上传素材和手动编辑不调用模型。';$('render-png').disabled=busy;$('download-png').disabled=!state?.status.export?.current;}
function drawMessages(){const key=JSON.stringify(state.messages)+':'+state.busy;if(key===paintKey)return;paintKey=key;const list=$('messages'),nearBottom=list.scrollTop+list.clientHeight>=list.scrollHeight-100;list.replaceChildren();if(!state.messages.length){const welcome=el('div','chat-welcome');welcome.append(el('h3',null,'你好，今天想设计什么？'),el('p',null,'告诉我海报的用途、内容和喜欢的感觉。你可以先在右侧上传商品图片、表格或参考图，我会自主规划设计。'));list.append(welcome);}
 for(const m of state.messages){const row=el('div','message '+m.role);row.append(el('span','message-role',m.role==='user'?'你':'✦ Poster Agent'),el('div',null,m.text));list.append(row);}if(state.busy)list.append(el('div','message assistant subtle','✦ 正在执行，你可以在“执行记录”查看进展…'));if(nearBottom||state.messages.at(-1)?.role==='user')list.scrollTop=list.scrollHeight;}
function drawAttachments(){const list=$('attachment-list'),details=$('asset-details');list.replaceChildren();details.replaceChildren();for(const a of state.attachments){const item=el('div','attachment-item');item.append(el('span','file-icon',a.kind==='image'?'▧':'▤'));const label=el('div',null,a.name);label.append(el('small',null,a.width?a.width+' × '+a.height:'已导入原始资料'));item.append(label);list.append(item);const row=el('div','asset-row',a.name);row.append(el('small',null,(a.width?'原图 '+a.width+' × '+a.height:'资料文件')+' · '+a.path),el('small',null,'SHA-256 '+a.sha256.slice(0,16)+'…'));details.append(row);}if(!state.attachments.length)details.append(el('p','subtle','尚未上传素材。已有工程可能直接引用工程内的 assets 文件。'));}
function drawTrace(){const box=$('trace-list');box.replaceChildren();for(const run of state.runs.slice(-5)){const title=el('h4',null,'任务 · '+new Date(run.startedAt).toLocaleString('zh-CN')+' · '+statusLabel(run.status));box.append(title);for(const ev of run.events){const row=el('div','trace-event'+(ev.type.includes('error')||ev.type==='failed'?' error':''));row.append(el('small',null,new Date(ev.at).toLocaleTimeString('zh-CN')),el('div',null,ev.message));if(ev.details&&Object.keys(ev.details).length)row.append(el('pre',null,JSON.stringify(ev.details,null,2)));box.append(row);}}if(!state.runs.length)box.append(el('p','subtle','发送需求后，实际工具选择、保存版本和验证结果会出现在这里。'));}
function statusLabel(s){return {running:'执行中',completed:'已完成',failed:'未完成',cancelled:'已停止',limited:'达到调用上限',interrupted:'已中断', 'awaiting-approval':'等待生图批准'}[s]||s;}
function drawApproval(){const run=state.runs.find(r=>r.status==='awaiting-approval'),box=$('approval-box');if(!run){box.hidden=true;approvalKey='';return;}box.hidden=false;if(approvalKey===run.pending.id)return;approvalKey=run.pending.id;box.replaceChildren();const p=run.pending;box.append(el('strong',null,'一次付费生图 · 等待你的授权'),el('pre',null,JSON.stringify({地址:p.plan.url,模型:p.plan.parameters?.model,参数:p.plan.parameters,输出:p.request.output},null,2)),el('p',null,p.warning));for(const [label,approve]of [['批准生成并继续',true],['拒绝本次生图',false]]){const b=el('button',approve?'primary':'',label);b.onclick=async()=>{b.disabled=true;try{await api('projects/'+active+'/approval',{runId:run.id,approvalId:p.id,approve});approvalKey='';await refresh();}catch(e){toast(e.message);b.disabled=false;}};box.append(b);}}
async function drawPreview(){const ex=state.status.export,id=active;if(!ex?.current){$('preview-state').textContent=ex?'设计有新修改，请重新导出预览':'尚未渲染';$('poster-preview').hidden=true;$('preview-empty').hidden=false;previewRevision=null;return;}$('preview-state').textContent='最新导出 · '+ex.revision;if(previewRevision===ex.revision)return;previewRevision=ex.revision;try{const blob=await api('projects/'+id+'/png',undefined,{binary:true});if(active!==id)return;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);$('poster-preview').src=previewURL;$('poster-preview').hidden=false;$('preview-empty').hidden=true;}catch(e){previewRevision=null;toast(e.message);}}
async function download(route,name,post){const blob=await api('projects/'+active+'/'+route,post,{binary:true}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(state.project.downloadName||'海报')+'.'+name.split('.').at(-1);a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('new-project').onclick=$('hero-create').onclick=showCreate;$('home-button').onclick=$('back-home').onclick=showHome;
$('settings-button').onclick=()=>{$('config-status').textContent='';$('settings-dialog').showModal();};$('model-badge').onclick=()=>$('settings-dialog').showModal();
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
let savingModel=false;
async function saveModelChoice(){
 if(savingModel)return;
 const select=$('main-model-select'),button=$('save-model-choice'),model=select.value;
 if(!model)return;
 savingModel=true;select.disabled=button.disabled=true;$('config-status').textContent='正在保存模型选择…';
 try{config=await api('config/select-model',{model});drawConfig();$('config-status').textContent='已保存，刷新后仍会使用 '+config.model.model+'。';}
 catch(e){select.value=config.model.model||'';$('config-status').textContent='保存失败：'+e.message;toast('模型选择保存失败，请重试');}
 finally{savingModel=false;select.disabled=button.disabled=false;}
}
$('main-model-select').onchange=saveModelChoice;
$('save-model-choice').onclick=saveModelChoice;
$('fetch-models').onclick=async()=>{const button=$('fetch-models');button.disabled=true;$('model-list-note').textContent='正在从配置地址读取列表（不发送生成请求）…';try{const result=await api('config/models',{});discoveredModels=result;drawModelChoices(result.models,config.model.model);$('model-list-note').textContent=result.note+' 选择后自动保存。';}catch(e){$('model-list-note').textContent=e.message;}finally{button.disabled=false;}};
$('reload-config').onclick=async()=>{try{config=await api('config/reload',{});drawConfig();$('config-status').textContent=config.model.reason;}catch(e){$('config-status').textContent=e.message;}};
let renamingProject=null;
$('project-title').ondblclick=e=>{e.preventDefault();if(renamingProject)return;renamingProject={id:active,title:state.project.title};$('rename-title').value=renamingProject.title;$('project-title').hidden=true;$('rename-title').hidden=false;requestAnimationFrame(()=>{if(renamingProject){$('rename-title').focus();$('rename-title').select();}});};
async function finishRename(cancel=false){
 if(!renamingProject)return;
 const original=renamingProject,title=$('rename-title').value.trim();renamingProject=null;
 $('rename-title').hidden=true;$('project-title').hidden=false;
 if(cancel||title===original.title)return;
 if(!title){toast('项目名称不能为空');return;}
 try{const updated=await api('projects/'+original.id+'/rename',{title});if(active===original.id&&state){state.project={...state.project,...updated};drawState();}await bootstrap();toast('名称已保存，下载文件将使用新名称');}catch(e){toast('名称保存失败：'+e.message);}
}
$('rename-title').onkeydown=e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();finishRename();}if(e.key==='Escape'){e.preventDefault();finishRename(true);}};
$('rename-title').onblur=()=>setTimeout(()=>{if(document.activeElement!==$('rename-title'))finishRename();},0);
$('create-form').onsubmit=async e=>{e.preventDefault();$('create-submit').disabled=true;$('create-status').textContent='正在创建可编辑工程…';try{const p=await api('projects',{title:$('new-title').value,width:Number($('new-width').value),height:Number($('new-height').value)});$('create-dialog').close();await bootstrap();await selectProject(p.id);}catch(e){$('create-status').textContent=e.message;}finally{$('create-submit').disabled=false;}};
$('chat-form').onsubmit=async e=>{e.preventDefault();const text=$('message-input').value.trim();if(!text||!active)return;$('send-message').disabled=true;try{await api('projects/'+active+'/message',{message:text});$('message-input').value='';await refresh();}catch(e){toast(e.message);drawControls();}};
$('stop-agent').onclick=async()=>{try{await api('projects/'+active+'/stop',{});toast('已请求停止；正在完成的保存操作会保留。');await refresh();}catch(e){toast(e.message);}};
$('attachment-input').onchange=async e=>{const files=[...e.target.files],id=active;$('attachment-input').disabled=true;try{for(let i=0;i<files.length;i++){const file=files[i];if(file.size>5*1024*1024)throw Error(file.name+' 超过5MB');$('upload-status').textContent='正在导入 '+(i+1)+'/'+files.length+'：'+file.name;const dataURL=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await api('projects/'+id+'/attachments',{name:file.name,dataURL});}$('upload-status').textContent='素材已导入。发送需求后，Agent 会读取这些资料。';await refresh();}catch(e){$('upload-status').textContent='导入未完成：'+e.message;}finally{$('attachment-input').disabled=!!state?.busy;e.target.value='';}};
$('open-editor').onclick=async()=>{const tab=window.open('about:blank','_blank');try{const r=await api('projects/'+active+'/editor',{});if(tab)tab.location=r.url;else toast('浏览器拦截了新窗口，请允许本地弹窗后重试');}catch(e){tab?.close();toast(e.message);}};
$('render-png').onclick=async()=>{$('render-png').disabled=true;toast('正在渲染最新版本，请稍候…');try{await api('projects/'+active+'/render',{baseRevision:state.status.revision});await refresh();toast('最新版本已导出');}catch(e){toast(e.message);}finally{drawControls();}};
$('download-png').onclick=()=>download('png','poster.png').catch(e=>toast(e.message));$('download-project').onclick=async()=>{$('download-project').disabled=true;try{await download('archive','poster-project.zip',{});}catch(e){toast(e.message);}finally{$('download-project').disabled=false;}};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const t of document.querySelectorAll('[data-tab]'))t.classList.toggle('active',t===b);for(const name of ['preview','assets','trace'])$(name+'-tab').hidden=name!==b.dataset.tab;};
if(!token)toast('请使用终端启动后提供的完整链接打开应用。');else bootstrap().catch(e=>toast(e.message));
setInterval(()=>{if(active)refresh().catch(e=>{if(!document.hidden)toast(e.message);});},2200);

setInterval(()=>{if(active&&state)drawProgress();},1000);
