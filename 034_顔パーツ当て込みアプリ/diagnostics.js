// Numeric, in-memory samples only. Collection and UI timers stop when the panel is closed.
export const DIAGNOSTIC_WINDOW_MS = 5000;
export class Diagnostics {
  constructor(windowMs=DIAGNOSTIC_WINDOW_MS){this.windowMs=windowMs;this.enabled=false;this.frames=[];this.compositions=[];}
  enable(enabled,time){this.enabled=enabled;this.started=time;this.frames=[];this.compositions=[];}
  prune(time){const cutoff=Math.max(this.started,time-this.windowMs);while(this.frames.length&&this.frames[0]<=cutoff)this.frames.shift();while(this.compositions.length&&this.compositions[0].time<=cutoff)this.compositions.shift();}
  frame(time){if(this.enabled){this.frames.push(time);this.prune(time);}}
  composition(time,ms){if(this.enabled&&Number.isFinite(ms)){this.compositions.push({time,ms});this.prune(time);}}
  snapshot(time,metadata={}){if(this.enabled)this.prune(time);const elapsed=this.enabled?Math.max(0,Math.min(this.windowMs,time-this.started)):0;
    return {windowMs:this.windowMs,elapsedMs:elapsed,drawFps:elapsed?this.frames.length*1000/elapsed:0,compositeAverageMs:this.compositions.length?this.compositions.reduce((n,s)=>n+s.ms,0)/this.compositions.length:null,compositeMaxMs:this.compositions.length?Math.max(...this.compositions.map(s=>s.ms)):null,...metadata};}
}
const fixed=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
export function recordingDiagnosticText(r={},uiError='') {
  const support=v=>v===undefined?'未確認':v?'対応':'非対応';
  const tracks=r.audioTracks||[];
  return ['録画診断（件数・サイズは今回の録画全体／メディアは含みません）',
    `MediaRecorder: ${support(r.mediaRecorderSupported)} / Canvas.captureStream: ${support(r.captureStreamSupported)}`,
    `選択MIME: ${r.selectedMime||'未選択'}`,`MediaRecorder.mimeType: ${r.actualMime||'未生成'}`,
    `録画解像度: ${r.width||0}×${r.height||0} / 設定fps: ${r.fps||0}`,
    `動画出力: ${r.outputAspect||'original'} / ${r.framing||'fit'} / カウント残り: ${r.countdown||0}`,
    `開始日時（UTC）: ${r.startedAt||'未開始'}`,`経過秒: ${fixed((r.elapsedMs||0)/1000,2)} / 録画状態: ${r.state||'IDLE'}`,
    `マイク: ${r.microphone?'ON':'OFF'} / 取得状態: ${r.microphoneStatus||'off'}`,
    `映像取得方式: ${r.captureMode||'未開始'} / ファイルの音声収録: 未検証（取得成功とは別）`,
    `以前の動画を保持: ${r.retainedPrevious?'はい':'いいえ'}`,
    `録画Streamの音声: ${tracks.length}本${tracks.length?' / '+tracks.map(t=>`${t.state} (enabled=${t.enabled}, muted=${t.muted})`).join(', '):' / なし'}`,
    `生成チャンク: ${r.chunks||0} / 生成サイズ: ${r.bytes||0} bytes`,
    `終了理由: ${r.reason||'なし'}`,`最終エラー: ${uiError||r.lastError||'なし'}`].join('\n');
}
export function diagnosticText(s){return [
  'Portrait Face Parts Player v0.9.0', '計測窓: 直近'+s.windowMs/1000+'秒（現在'+fixed(s.elapsedMs/1000)+'秒）',
  '描画fps: '+fixed(s.drawFps), '合成ms 平均/最大（同じ計測窓）: '+fixed(s.compositeAverageMs)+' / '+fixed(s.compositeMaxMs),
  '録画Canvas転送ms 平均/最大（今回の録画全体）: '+fixed(s.recordingAverageMs,2)+' / '+fixed(s.recordingMaxMs,2),
  '録画: '+(s.recordingState||'idle')+' / 転送'+(s.recordingFrames||0)+'回 / '+fixed((s.recordingBytes||0)/1024/1024,2)+' MB',
  'パーツ数: '+(s.parts||0)+' / 映像: '+s.videoWidth+'×'+s.videoHeight,
  recordingDiagnosticText(s.recording,s.recordingUIError)].join('\n');}
export async function copyDiagnostic(text,clipboard=globalThis.navigator?.clipboard) {
  if(!clipboard?.writeText)return false;
  try {await clipboard.writeText(text);return true;}catch{return false;}
}

export class DiagnosticPanel {
  constructor({details,output,copy,fallback,status,sample,metrics,now=()=>performance.now()}) {
    Object.assign(this,{details,output,copy,fallback,status,sample,metrics,now});
    this.resume=()=>{
      clearInterval(this.timer);metrics.enable(details.open,now());
      if(details.open){this.update();this.timer=setInterval(()=>this.update(),500);}
    };
    details.addEventListener('toggle',this.resume);
    copy.addEventListener('click',async()=>{
      const text=diagnosticText(this.sample());
      const copied=await copyDiagnostic(text);status.textContent=copied?'診断テキストをコピーしました。':'コピーが許可されませんでした。下のテキストを選択してコピーしてください。';
      fallback.hidden=copied;if(!copied){fallback.value=text;fallback.focus();fallback.select();}
    });
    this.pause=()=>{clearInterval(this.timer);metrics.enable(false,now());};
  }
  update() {if(this.details.open && this.metrics.enabled)this.output.textContent=diagnosticText(this.sample());}
}
