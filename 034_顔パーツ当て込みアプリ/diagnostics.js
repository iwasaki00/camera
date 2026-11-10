// Numeric, in-memory samples only. Collection and UI timers stop when the panel is closed.
export const DIAGNOSTIC_WINDOW_MS = 5000;
export class Diagnostics {
  constructor(windowMs = DIAGNOSTIC_WINDOW_MS) { this.windowMs=windowMs; this.enabled=false; this.frames=[]; this.results=[]; this.compositions=[]; }
  enable(enabled,time) { this.enabled=enabled;this.started=time;this.frames=[];this.results=[];this.compositions=[]; }
  prune(time) {
    const cutoff=Math.max(this.started,time-this.windowMs);
    while(this.frames.length && this.frames[0]<=cutoff)this.frames.shift();
    while(this.results.length && this.results[0].completed<=cutoff)this.results.shift();
    while(this.compositions.length && this.compositions[0].time<=cutoff)this.compositions.shift();
  }
  frame(time) {if(this.enabled){this.frames.push(time);this.prune(time);}}
  detection(sample) {if(this.enabled){this.results.push({...sample});this.prune(sample.completed);}}
  composition(time,ms) {if(this.enabled&&Number.isFinite(ms)){this.compositions.push({time,ms});this.prune(time);}}
  snapshot(time,metadata={}) {
    if(this.enabled)this.prune(time);
    const elapsed=this.enabled?Math.max(0,Math.min(this.windowMs,time-this.started)):0;
    const samples=this.results.filter(r=>Number.isFinite(r.ms)&&r.ms>=0),durations=samples.map(r=>r.ms);
    const last=this.results.at(-1),count=this.results.length;
    return {windowMs:this.windowMs,elapsedMs:elapsed,drawFps:elapsed?this.frames.length*1000/elapsed:0,
      detectionFps:elapsed?count*1000/elapsed:0,count,successRate:count?this.results.filter(r=>r.accepted).length/count:null,
      inferenceLastMs:durations.at(-1)??null,inferenceAverageMs:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,
      inferenceMaxMs:durations.length?Math.max(...durations):null,
      compositeAverageMs:this.compositions.length?this.compositions.reduce((n,s)=>n+s.ms,0)/this.compositions.length:null,
      compositeMaxMs:this.compositions.length?Math.max(...this.compositions.map(s=>s.ms)):null,
      resultAgeMs:Number.isFinite(metadata.lastCapture)?Math.max(0,time-metadata.lastCapture):last?Math.max(0,time-last.capture):null,
      ...metadata};
  }
}
const fixed=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
const stateNames={stopped:'停止中',initializing:'初期化中',detecting:'検出中',tracking:'追従中',lost:'一時的な未検出',notFound:'顔消失',error:'エラー'};
export function diagnosticText(s) {
  return [`Portrait Face Parts Player v0.6.0`, `計測窓: 直近${s.windowMs/1000}秒（現在${fixed(s.elapsedMs/1000)}秒）`,
    `描画fps: ${fixed(s.drawFps)}`,`検出/秒: ${fixed(s.detectionFps)} / 完了${s.count}回`,
    `推論ms 直近/平均/最大: ${fixed(s.inferenceLastMs)} / ${fixed(s.inferenceAverageMs)} / ${fixed(s.inferenceMaxMs)}`,
    `合成ms 平均/最大（同じ計測窓）: ${fixed(s.compositeAverageMs)} / ${fixed(s.compositeMaxMs)}`,
    `録画Canvas転送ms 平均/最大（今回の録画全体）: ${fixed(s.recordingAverageMs,2)} / ${fixed(s.recordingMaxMs,2)}`,
    `録画: ${s.recordingState||'idle'} / 転送${s.recordingFrames||0}回 / ${fixed((s.recordingBytes||0)/1024/1024,2)} MB`,
    `最新結果の経過ms（入力フレーム基準）: ${fixed(s.resultAgeMs)}`,`最新採用の経過ms（650msで非表示）: ${fixed(s.lastGoodAgeMs)}`,`採用成功率: ${s.successRate===null?'—':fixed(s.successRate*100)+'%'}`,
    `状態: ${stateNames[s.status]||s.status} (${s.status})`,`Worker: ${s.backend||'未使用'}`,`映像: ${s.videoWidth}×${s.videoHeight}`,`推論入力: ${s.inputWidth}×${s.inputHeight}`,
    `検出間隔ms: ${fixed(s.interval)}`].join('\n');
}
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
