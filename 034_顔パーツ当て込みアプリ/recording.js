// Owns only recording canvas/microphone tracks. The application's camera is never acquired here.
export const RECORDING_LIMIT_BYTES = 64 * 1024 * 1024;
export const RECORDING_QUALITIES = Object.freeze({normal:{edge:720,fps:24,bitrate:2500000},low:{edge:480,fps:15,bitrate:1200000}});
export function recordingPlan(width,height,quality='normal') {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!RECORDING_QUALITIES[quality])throw new Error('録画サイズまたは画質が不正です。');
  const q=RECORDING_QUALITIES[quality],scale=Math.min(1,q.edge/Math.max(width,height));
  return {...q,width:Math.max(2,Math.ceil(width*scale/2)*2),height:Math.max(2,Math.ceil(height*scale/2)*2)};
}
export function recordingTypes(Recorder,audio=false) {
  if(typeof Recorder?.isTypeSupported!=='function')return [];
  const types=[audio?'video/mp4;codecs=avc1.42E01E,mp4a.40.2':'video/mp4;codecs=avc1.42E01E','video/mp4',audio?'video/webm;codecs=vp8,opus':'video/webm;codecs=vp8',audio?'video/webm;codecs=vp9,opus':'video/webm;codecs=vp9','video/webm'];
  return types.filter(type=>{try{return Recorder.isTypeSupported(type);}catch{return false;}});
}
export async function recordingContainer(blob) {
  const b=new Uint8Array(await blob.slice(0,32).arrayBuffer());
  if(b.length>=8&&b[4]===102&&b[5]===116&&b[6]===121&&b[7]===112)return {mime:'video/mp4',extension:'mp4'};
  if(b.length>=4&&b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3)return {mime:'video/webm',extension:'webm'};
  throw new Error('録画ファイルの形式を確認できませんでした。');
}
export function shareableRecording(result,nav=globalThis.navigator) {
  if(!result||typeof globalThis.File!=='function'||typeof nav?.share!=='function'||typeof nav?.canShare!=='function')return null;
  const file=new File([result.blob],result.filename,{type:result.mime});
  try{return nav.canShare({files:[file]})?file:null;}catch{return null;}
}
const stopTracks=stream=>{for(const t of stream?.getTracks?.()||[])try{t.stop();}catch{}};
export class VideoRecording {
  constructor({Recorder=globalThis.MediaRecorder,Stream=globalThis.MediaStream,mediaDevices=globalThis.navigator?.mediaDevices,createCanvas=()=>document.createElement('canvas'),now=()=>performance.now(),changed=()=>{},schedule=(fn,ms)=>globalThis.setInterval(fn,ms),unschedule=id=>globalThis.clearInterval(id),timeout=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:cancelTimeout=id=>globalThis.clearTimeout(id)}={}) {
    Object.assign(this,{Recorder,Stream,mediaDevices,createCanvas,now,changed,schedule,unschedule,timeout,cancelTimeout});
    this.state='idle';this.result=null;this.error='';this.reason='';this.canRetrySilent=false;this.metrics={frames:0,averageMs:0,maxMs:0,bytes:0};
  }
  get busy(){return ['initializing','recording','stopping'].includes(this.state);}
  get supported(){return this._supported ??= typeof this.Recorder==='function'&&typeof this.Stream==='function'&&recordingTypes(this.Recorder).length>0;}
  get elapsedMs(){const s=this.session;return s?.started===undefined?this.result?.elapsedMs||0:Math.max(0,(s.stopped??this.now())-s.started);}
  notify(state=this.state){this.state=state;this.changed(this);}
  async start({source,duration=30,microphone=false,quality='normal'}={}) {
    if(this.busy)return false;
    this.error='';this.reason='';this.canRetrySilent=false;
    if(!this.supported||typeof source?.captureStream!=='function'){this.error='このブラウザはCanvas動画録画に対応していません。';this.notify('error');return false;}
    if(![15,30,60].includes(duration)){this.error='録画時間は15・30・60秒から選んでください。';this.notify('error');return false;}
    const s={chunks:[],bytes:0,source,duration,microphone,frames:0,totalMs:0,maxMs:0};
    s.done=new Promise(resolve=>s.resolve=resolve);this.session=s;this.result=null;this.metrics={frames:0,averageMs:0,maxMs:0,bytes:0};this.notify('initializing');
    try {
      s.plan=recordingPlan(source.width,source.height,quality);
      if(microphone) {
        let mic;
        try {
          if(!this.mediaDevices?.getUserMedia)throw new Error('MIC_UNAVAILABLE');
          mic=await this.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true}});
        } catch(error) {this.canRetrySilent=this.session===s;throw new Error(error?.name==='NotAllowedError'?'マイクが許可されませんでした。「音声なしで録画」で続行できます。':'マイクを利用できません。「音声なしで録画」で続行できます。');}
        if(this.session!==s){stopTracks(mic);return false;}
        s.mic=mic;
        if(!mic.getAudioTracks().some(t=>t.readyState==='live')){this.canRetrySilent=true;throw new Error('マイクの音声トラックがありません。「音声なしで録画」で続行できます。');}
      }
      if(this.session!==s)return false;
      this.canvas ||= this.createCanvas();this.canvas.width=s.plan.width;this.canvas.height=s.plan.height;
      this.copyFrame(s);
      s.video=this.canvas.captureStream(0);s.track=s.video.getVideoTracks()[0];
      if(!s.track)throw new Error('録画用の映像トラックを取得できませんでした。');
      if(typeof s.track.requestFrame!=='function'){stopTracks(s.video);s.video=this.canvas.captureStream(s.plan.fps);s.track=s.video.getVideoTracks()[0];}
      const audio=s.mic?.getAudioTracks()||[];s.stream=new this.Stream([...s.video.getVideoTracks(),...audio]);
      let started=false,lastError;
      for(const mimeType of recordingTypes(this.Recorder,microphone)) {
        let recorder;
        try {
          recorder=new this.Recorder(s.stream,{mimeType,videoBitsPerSecond:s.plan.bitrate,...(microphone?{audioBitsPerSecond:96000}:{})});s.recorder=recorder;
          recorder.ondataavailable=e=>{if(this.session!==s||!e.data?.size)return;s.chunks.push(e.data);s.bytes+=e.data.size;this.metrics.bytes=s.bytes;if(s.bytes>=RECORDING_LIMIT_BYTES)this.stop('録画サイズが64MBに達したため終了しました。');};
          recorder.onstart=()=>{if(this.session!==s||s.stopping)return;s.nextFrame=this.now();this.notify('recording');this.pushFrame(source,s.nextFrame,true);s.timer=this.schedule(()=>{if(this.session!==s)return;if(this.elapsedMs>=duration*1000)this.stop('指定時間に達しました。');else this.notify();},100);};
          recorder.onerror=e=>{if(this.session!==s)return;s.failure=e.error?.message||'録画エンコード中にエラーが発生しました。';this.error=s.failure;this.stop('録画エラーのため終了しました。');};
          recorder.onstop=()=>this.finish(s);
          s.started=this.now();s.nextFrame=s.started;recorder.start(1000);this.copyFrame(s);s.track.requestFrame?.();started=true;break;
        } catch(error) {lastError=error;if(recorder){recorder.ondataavailable=recorder.onstart=recorder.onerror=recorder.onstop=null;try{if(recorder.state!=='inactive')recorder.stop();}catch{}}s.chunks=[];s.bytes=0;}
      }
      if(!started)throw new Error('利用可能な形式で録画を開始できませんでした。低画質で再試行してください。'+(lastError?.name?` (${lastError.name})`:''));
      for(const t of s.stream.getTracks())t.addEventListener?.('ended',()=>{if(this.session===s&&!s.stopping)this.stop(t.kind==='audio'?'マイク接続が終了しました。':'録画映像が終了しました。');},{once:true});
      return true;
    } catch(error) {
      if(this.session!==s)return false;
      this.error=error.message||'録画を開始できませんでした。';this.release(s);this.session=null;s.resolve(null);this.notify('error');return false;
    }
  }
  copyFrame(s) {
    const start=this.now(),c=this.canvas.getContext('2d'),source=s.source;
    const scale=Math.min(this.canvas.width/source.width,this.canvas.height/source.height),w=source.width*scale,h=source.height*scale;
    c.fillStyle='#000';c.fillRect(0,0,this.canvas.width,this.canvas.height);c.drawImage(source,(this.canvas.width-w)/2,(this.canvas.height-h)/2,w,h);
    const ms=Math.max(0,this.now()-start);s.frames++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);
    this.metrics={frames:s.frames,averageMs:s.totalMs/s.frames,maxMs:s.maxMs,bytes:s.bytes};
  }
  pushFrame(source,time=this.now(),force=false) {
    const s=this.session;if(!s||s.stopping||!(this.state==='recording'||this.state==='initializing'&&s.recorder?.state==='recording'))return;
    if(!force&&time<s.nextFrame-.5)return;
    s.source=source;this.copyFrame(s);s.track.requestFrame?.();
    const interval=1000/s.plan.fps;s.nextFrame+=interval;if(s.nextFrame<time-interval)s.nextFrame=time+interval;
  }
  stop(reason='途中停止しました。') {
    const s=this.session;if(!s)return Promise.resolve(this.result);
    if(s.stopping)return s.done;
    s.stopping=true;s.stopped=this.now();this.reason=reason;this.unschedule(s.timer);
    if(!s.recorder){this.release(s);this.session=null;s.resolve(null);this.notify('idle');return s.done;}
    this.notify('stopping');
    // Keep owned tracks alive until final dataavailable → stop. Bound a broken encoder's wait.
    s.watchdog=this.timeout(()=>{s.failure='録画終了処理がタイムアウトしました。途中ファイルは再生確認が必要です。';this.finish(s);},10000);
    try{if(s.recorder.state!=='inactive')s.recorder.stop();}catch(error){s.failure=error.message;this.finish(s);}
    return s.done;
  }
  async finish(s) {
    if(this.session!==s||s.finishing)return;s.finishing=true;s.stopping=true;
    s.stopped??=this.now();this.unschedule(s.timer);this.cancelTimeout(s.watchdog);this.notify('stopping');
    const elapsedMs=s.started===undefined?0:Math.max(0,s.stopped-s.started);
    try {
      if(!s.bytes)throw new Error(s.failure||'録画データが生成されませんでした。');
      let blob=new Blob(s.chunks,{type:s.recorder.mimeType||s.chunks[0]?.type||''});
      const container=await recordingContainer(blob);const declared=blob.type;
      const mime=declared.split(';')[0]===container.mime?declared:container.mime;
      blob=new Blob([blob],{type:mime});
      this.result={blob,mime,extension:container.extension,filename:`portrait-${new Date().toISOString().replace(/[:.]/g,'-')}.${container.extension}`,elapsedMs,
        hasAudio:!!s.mic?.getAudioTracks().length,width:s.plan.width,height:s.plan.height,fps:s.plan.fps,partial:!!s.failure};
      this.error=s.failure||'';
    } catch(error){this.error=error.message;this.result=null;}
    finally {s.chunks=[];this.release(s);this.session=null;this.notify(this.result?'completed':'error');s.resolve(this.result);}
  }
  release(s) {this.unschedule(s.timer);this.cancelTimeout(s.watchdog);if(s.recorder)s.recorder.ondataavailable=s.recorder.onstart=s.recorder.onerror=s.recorder.onstop=null;stopTracks(s.video);stopTracks(s.mic);}
  clearResult(){if(this.busy)return false;this.result=null;this.error='';this.reason='';this.notify('idle');return true;}
}
