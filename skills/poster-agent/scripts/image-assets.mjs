// Poster Agent, 2026-11-10. Apache-2.0. Apply reviewed independent asset via existing versions.
import fs from 'node:fs';
import path from 'node:path';
import {safeFile} from './project-store.mjs';
import {patchProject} from './project.mjs';
import {inspectPNG,imageError} from './image-utils.mjs';
import {planImageFit,backgroundFitStyle} from './image-fit.mjs';
export async function applyGeneratedAsset(store,{jobId,baseRevision,target,review,fit}) {
  if(!/^[a-f0-9-]{36}$/.test(jobId||''))throw imageError('INVALID_JOB','无效的素材任务标识');
  const current=store.current();
  if(current.revision!==baseRevision)throw imageError('VERSION_CONFLICT','工程已有更新；读取最新人工保存版本后重新审查指定目标');
  if(!/^(layer|region):[\w-]+$/.test(target||''))throw imageError('INVALID_TARGET','只允许明确的 layer:ID 或 region:ID，不允许整张海报或分组替换');
  const receipt=JSON.parse(fs.readFileSync(safeFile(store.root,`.trace/image-jobs/${jobId}.json`),'utf8'));
  const {result,request}=receipt;
  if(result.status!=='success'||request.purpose==='composition-reference'||!result.path?.startsWith('assets/'))throw imageError('NON_SHIPPING_ASSET','仅允许成功生成的独立交付素材；构图参考图不得应用到设计');
  const file=safeFile(store.root,result.path),info=inspectPNG(fs.readFileSync(file));
  if(info.sha256!==result.sha256)throw imageError('ASSET_CHANGED','素材与生成回执哈希不一致');
  if(review?.sha256!==info.sha256||review.noText!==true||review.independentAsset!==true)throw imageError('VISUAL_REVIEW_REQUIRED','先检查真实图片无文字、无完整海报布局且适合目标区域，再提供对应哈希的视觉审查记录');
  const id=target.split(':')[1],rule=current.config.agent.protection?.layers?.[id];
  if(rule&&(rule.locked||rule.trustedText!==undefined||['product','price','product-id','qr'].includes(rule.kind)))throw imageError('PROTECTED_LAYER','生成素材不得替换商品原图、可信事实、二维码或锁定图层');
  const before=await store.analyze(current.html),record=before.records[target];
  if(!record)throw imageError('INVALID_TARGET','指定图层或区域不存在');
  if(record.text||record.children?.length)throw imageError('PROTECTED_CONTENT','目标包含文字或子元素，必须选择独立图片或空背景区域');
  if((current.config.agent.protection?.assets||[]).some(a=>a.path===record.src))throw imageError('PROTECTED_ASSET','目标引用受保护原始素材，不允许用生成图替换');
  let fitting=null;
  if(record.tag!=='IMG') {
    const canvasSize={width:Math.round(record.rect[2]),height:Math.round(record.rect[3])};
    const differentRatio=Math.abs(info.width/info.height-canvasSize.width/canvasSize.height)>.000001;
    if(differentRatio&&!fit)throw imageError('FIT_PREVIEW_REQUIRED','原图与区域比例不同；先生成适配预览，明确选择方式，不默认裁剪');
    if(fit&&Object.keys(fit).some(k=>!['mode','padding','fill','subject'].includes(k)))throw imageError('INVALID_FIT','未知适配参数');
    fitting=planImageFit({sourceSize:{width:info.width,height:info.height},canvasSize,sourceSHA256:info.sha256,...(fit||{mode:'contain'})});
    if(fit&&review.fitPreviewHash!==fitting.previewHash)throw imageError('FIT_PREVIEW_REQUIRED','查看对应适配预览后提交精确 previewHash');
    if(fitting.subjectClipped)throw imageError('UNSAFE_CROP','该方案会裁掉已指定主体，请改用 contain 或安全留白');
    if(fitting.cropped&&review.cropApproved!==true)throw imageError('CROP_APPROVAL_REQUIRED','裁剪方案需要明确查看并批准，不能自动应用');
  }
  const patch=record.tag==='IMG'?{src:result.path}:{style:backgroundFitStyle(fitting,result.path)};
  const saved=await patchProject(store,{baseRevision,target,...patch,task:{type:target.startsWith('region:')?'background':'layers',summary:`Apply reviewed ${result.mock?'MOCK fixture':'generated asset'} to ${target}`,routes:[{region:id,method:'C',reason:'独立图像素材与现有可编辑 HTML 图层组合'}],preserve:['all other layers and manual edits','protected original bytes','trusted text and QR'],tools:['ImageProvider','visual review','project.patch'],imageJob:{jobId,provider:result.provider,model:result.model,sha256:info.sha256,mock:result.mock,review,fitting}}});
  const after=await store.analyze(store.current().html);
  const comparison=Object.entries(before.records).map(([key,b])=>({target:key,rectBefore:b.rect,rectAfter:after.records[key]?.rect,unchanged:JSON.stringify(b)===JSON.stringify(after.records[key])}));
  const evidence={jobId,parent:baseRevision,revision:saved.revision,target,review,fitting,comparison};
  fs.writeFileSync(path.join(store.versionDir(saved.revision),'image-application.json'),JSON.stringify(evidence,null,2)+'\n');
  store.event('image_application',{revision:saved.revision,jobId,target,mock:result.mock,review});
  return {...saved,jobId,target,comparison};
}
