// Copyright 2026 Poster Agent. Apache-2.0. Elapsed time is not model telemetry.
export function taskProgress(state,now=Date.now(),lastSync=now){
 const run=state?.runs?.at(-1);if(!run)return '';
 const secs=t=>Math.max(0,Math.floor((now-Date.parse(t))/1000))||0;
 const format=n=>Math.floor(n/60)+'分'+String(n%60).padStart(2,'0')+'秒';
 if(!state.busy)return run.status==='awaiting-approval'?'等待你的生图批准 · 尚未发送生图请求':'';
 const event=run.events?.at(-1),age=secs(event?.at||run.startedAt),elapsed=format(secs(run.startedAt));
 const phase=event?.type==='thinking'?'等待模型响应':event?.message||'任务启动中';
 const connection=now-lastSync>8000?'本地连接暂未更新，请检查连接':age>=30?'此步骤较久未有新进展，可查看执行记录或停止':'本地连接正常';
 return `已用时 ${elapsed} · ${phase} · 最近进展 ${age}秒前 · ${connection}。计时不代表模型实时思考。`;
}
