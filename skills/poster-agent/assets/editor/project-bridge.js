/* Poster Agent localhost save bridge, 2026-11-10. Apache-2.0.
   Uses the inherited editor export; no new editor or design representation. */
(() => {
  'use strict';
  async function start() {
    while (!window.__layerEditor) await new Promise(resolve=>setTimeout(resolve,50));
    const editor=window.__layerEditor,panel=document.querySelector('.hf-panel');
    const controls=document.createElement('section');controls.className='hf-project';
    controls.style.cssText='padding:14px;display:grid;gap:8px;border-bottom:1px solid #32363d;font-size:12px;line-height:1.5;';
    controls.setAttribute('aria-label','当前工程');panel.prepend(controls);
    const button=(id,label)=>{const b=document.createElement('button');b.id=id;b.className='hf-btn';b.textContent=label;controls.append(b);return b;};
    const save=button('pa-save-project','保存到当前项目');save.classList.add('primary');
    const render=button('pa-save-render','保存并导出 PNG');
    const versions=document.createElement('select');versions.id='pa-versions';versions.title='历史设计版本';versions.style.cssText='width:100%;min-width:0;background:#282c33;color:#e6e8ea;border:1px solid #3a3f47;border-radius:6px;padding:6px;';controls.append(versions);
    const restore=button('pa-restore','恢复所选版本');
    const status=document.createElement('span');status.id='pa-project-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.cssText='overflow-wrap:anywhere;color:#c3c9d1;';controls.append(status);
    let revision=document.querySelector('meta[name="poster-agent-revision"]')?.content;
    const token=new URLSearchParams(location.hash.slice(1)).get('token');
    if(location.protocol!=='http:'||location.hostname!=='127.0.0.1'||!token||!revision) {
      [save,render,restore,versions].forEach(b=>b.disabled=true);
      status.textContent='工程保存需使用本地服务链接打开；仍可下载 HTML';return;
    }
    async function api(route,data) {
      const res=await fetch('/api/'+route,{method:data?'POST':'GET',headers:{'X-Poster-Token':token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
      const result=await res.json();
      if(!res.ok) {const error=new Error(result.message||'服务请求失败');error.code=result.error;throw error;}return result;
    }
    let busy=false;
    const feedback=message=>{status.textContent=message;editor.toast(message);};
    async function refresh() {
      const current=await api('state');versions.replaceChildren();
      for (const {id,el} of editor.layers()) {
        const rule=current.protection.layers?.[id]||{};
        // Saved HTML can retain old hints. Server policy is authoritative,
        // including removal of a lock; never let stale attributes block editing.
        for(const key of ['paLocked','paTrusted','paKind','paOperations'])delete el.dataset[key];
        if(rule.locked) el.dataset.paLocked='1';
        if(rule.trustedText!==undefined) el.dataset.paTrusted='1';
        if(rule.kind) el.dataset.paKind=rule.kind;
        if(rule.operations) el.dataset.paOperations=rule.operations.join(',');
      }
      for(const record of current.history.slice().reverse()) {const option=document.createElement('option');option.value=record.revision;option.textContent=record.revision+' · '+(record.task?.summary||record.task?.type);versions.append(option);}
      if(current.revision!==revision) feedback('已有新版本；先下载未保存修改，再重新打开工程，避免覆盖');
      else status.textContent=current.resourceErrors.length?'工程素材缺失或被外部修改：'+current.resourceErrors.join(', '):'当前版本 '+revision;
      return current;
    }
    async function persist(exportPNG=false) {
      if(busy) return;
      if(editor.state.imageUploading) {feedback('图片正在上传，请稍后保存');return;}
      if(editor.state.exploded||editor.state.transitioning) {feedback('请先收拢拆解视图，再保存工程');return;}
      busy=true;save.disabled=render.disabled=restore.disabled=true;
      let saved=false;
      try {
        // Finish active text/gesture edits before the inherited clean export.
        window.dispatchEvent(new Event('pointerup'));
        const result=await api('save',{baseRevision:revision,html:editor.fullHTML()});
        revision=result.revision;saved=true;editor.markProjectSaved(revision);
        status.textContent='已保存 '+revision;
        await refresh();
        if(exportPNG) {
          status.textContent='已保存，正在渲染最新版本…';
          const png=await api('export',{baseRevision:revision});
          const a=document.createElement('a');a.href='/'+png.path;a.download='poster-'+revision+'.png';a.click();
          feedback(`已保存并导出 ${png.width}×${png.height} PNG · ${revision}`);
        } else feedback('已保存到当前项目 · '+revision+(result.validation?.warnings?.length?'；有图层遮挡文字，可自行调整':''));
      } catch(e) {feedback((saved?(exportPNG?'设计已保存；PNG 导出未完成：':'设计已保存；状态刷新失败：'):'保存失败：')+e.message+'；可使用下载 HTML 保留修改');}
      finally {busy=false;save.disabled=render.disabled=restore.disabled=false;}
    }
    save.addEventListener('click',()=>persist(false));render.addEventListener('click',()=>persist(true));
    restore.addEventListener('click',async()=>{
      if(busy||!versions.value) return;
      // Recovery is deliberate and always creates a new version; preserve drafts via download if needed.
      if(!confirm('恢复将打开所选历史设计，并生成新版本。未保存修改请先下载 HTML。继续？')) return;
      busy=true;
      try {await api('restore',{baseRevision:revision,revision:versions.value});location.reload();}
      catch(e) {feedback('恢复失败：'+e.message);busy=false;}
    });
    window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();persist(false);}},true);
    window.__posterProject={save:persist,refresh,uploadImage:dataURL=>api('upload-image',{baseRevision:revision,dataURL}),get revision(){return revision;}};
    try {await refresh();}catch(e){feedback('无法连接当前工程：'+e.message);}
  }
  start().catch(e=>console.error('[poster-agent]',e));
})();
