// Copyright 2026 Poster Agent. Apache-2.0. Local image import; never overwrites originals.
import fs from 'node:fs';
import path from 'node:path';
import {ProjectError,safeFile,sha} from './project-store.mjs';
import {launch} from './_browser.mjs';
export async function importEditorImage(store,{baseRevision,dataURL}) {
  return store.locked(async()=>{
    if(store.current().revision!==baseRevision)throw new ProjectError('VERSION_CONFLICT','工程已有新版本，请先保留修改并重新打开最新工程',409);
    const m=typeof dataURL==='string'&&dataURL.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!m)throw new ProjectError('INVALID_IMAGE','请选择 PNG、JPEG 或 WebP 图片');
    const bytes=Buffer.from(m[2],'base64');
    if(!bytes.length||bytes.length>5*1024*1024)throw new ProjectError('IMAGE_TOO_LARGE','图片不能超过 5MB',413);
    const type=m[1],valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid)throw new ProjectError('INVALID_IMAGE','文件内容与图片格式不一致');
    let browser,dimensions;
    try {
      browser=await launch();const page=await browser.newPage();
      dimensions=await page.evaluate(src=>new Promise(resolve=>{const im=new Image();im.onload=()=>resolve({width:im.naturalWidth,height:im.naturalHeight});im.onerror=()=>resolve(null);im.src=src;}),dataURL);
    } finally {if(browser)await browser.close();}
    if(!dimensions?.width||dimensions.width*dimensions.height>40e6)throw new ProjectError('INVALID_IMAGE','图片无法解码或超过 4000 万像素');
    const ext=type==='image/jpeg'?'jpg':type.split('/')[1],digest=sha(bytes),relative=`assets/editor-uploads/${digest}.${ext}`;
    const file=safeFile(store.root,relative,false);fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file)){if(sha(fs.readFileSync(file))!==digest)throw new ProjectError('ASSET_CHANGED','已有同名素材损坏');}
    else fs.writeFileSync(file,bytes,{flag:'wx'});
    store.event('editor_image_import',{path:relative,sha256:digest,...dimensions});
    return {path:relative,sha256:digest,...dimensions};
  });
}
