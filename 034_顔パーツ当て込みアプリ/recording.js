import {outputOptions,drawRecordingOutput} from './recording-output.js?v=0.9.1';
// Owns only recording canvas/microphone tracks. The application's camera is never acquired here.
export const RECORDING_LIMIT_BYTES = 64 * 1024 * 1024;
export const RECORDING_QUALITIES = Object.freeze({normal:{edge:720,fps:24,bitrate:2500000},low:{edge:480,fps:15,bitrate:1200000}});
export function recordingPlan(width,height,quality='normal',aspect='original') {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!RECORDING_QUALITIES[quality])throw new Error('録画サイズまたは画質が不正です。');
  const q=RECORDING_QUALITIES[quality],scale=Math.min(1,q.edge/Math.max(width,height));
  if(aspect==='vertical')return {...q,width:quality==='low'?270:360,height:quality==='low'?480:640};
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
  constructor({Recorder=globalThis.MediaRecorder,Stream=globalThis.MediaStream,mediaDevices=globalThis.navigator?.mediaDevices,createCanvas=()=>document.createElement('canvas'),captureSupported=()=>typeof globalThis.HTMLCanvasElement?.prototype?.captureStream==='function',now=()=>performance.now(),wallNow=()=>new Date().toISOString(),changed=()=>{},schedule=(fn,ms)=>globalThis.setInterval(fn,ms),unschedule=id=>globalThis.clearInterval(id),timeout=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:cancelTimeout=id=>globalThis.clearTimeout(id)}={}) {
    Object.assign(this,{Recorder,Stream,mediaDevices,createCanvas,captureSupported,now,wallNow,changed,schedule,unschedule,timeout,cancelTimeout});
    this.state='idle';this.result=null;this.error='';this.reason='';this.canRetrySilent=false;this.metrics={frames:0,averageMs:0,maxMs:0,bytes:0};
  }
  get busy(){return ['initializing','countdown','recording','stopping'].includes(this.state);}
  get supported(){return this._supported ??= this.captureSupported()&&typeof this.Recorder==='function'&&typeof this.Stream==='function'&&recordingTypes(this.Recorder).length>0;}
  get elapsedMs(){const s=this.session;return s?s.started===undefined?0:Math.max(0,(s.stopped??this.now())-s.started):this.lastInfo?.elapsedMs??this.result?.elapsedMs??0;}
  notify(state=this.state){this.state=state;this.changed(this);}
  sessionInfo(s) {
    return {selectedMime:s.selectedMime||'',actualMime:s.recorder?.mimeType||'',width:s.plan?.width||0,height:s.plan?.height||0,fps:s.plan?.fps||0,
      startedAt:s.startedAt||'',elapsedMs:s.started===undefined?0:Math.max(0,(s.stopped??this.now())-s.started),microphone:!!s.microphone,microphoneStatus:s.microphoneStatus,
      audioTracks:(s.stream?.getAudioTracks()||[]).map(t=>({state:t.readyState,enabled:!!t.enabled,muted:!!t.muted})),captureMode:s.captureMode||'',audioVerification:'unverified',outputAspect:s.output?.aspect||'original',framing:s.output?.framing||'fit',countdown:s.countdown||0,chunks:s.chunkCount,bytes:s.bytes};
  }
  diagnosticSnapshot() {
    // Only scalars and anonymous audio-track states. Never return streams, blobs, IDs or labels.
    return {...(this.session?this.sessionInfo(this.session):this.lastInfo||{}),mediaRecorderSupported:typeof this.Recorder==='function',captureStreamSupported:this.captureSupported(),
      state:({idle:'IDLE',initializing:'PREPARING',countdown:'COUNTDOWN',recording:'RECORDING',stopping:'STOPPING',completed:'READY',error:'ERROR'})[this.state],retainedPrevious:!!this.retainedPrevious,reason:this.reason,lastError:this.error};
  }
  async start({source,duration=30,microphone=false,quality='normal',countdown=false,output={}}={}) {
    if(this.busy)return false;
    this.error='';this.reason='';this.canRetrySilent=false;
    if(!this.supported||typeof source?.captureStream!=='function'){this.error='このブラウザはCanvas動画録画に対応していません。';this.notify('error');return false;}
    if(![15,30,60].includes(duration)){this.error='録画時間は15・30・60秒から選んでください。';this.notify('error');return false;}
    const s={previousResult:this.result,chunks:[],chunkCount:0,bytes:0,source,duration,output:outputOptions(output),microphone,microphoneStatus:microphone?'requesting':'off',frames:0,totalMs:0,maxMs:0};
    s.done=new Promise(resolve=>s.resolve=resolve);this.session=s;this.lastInfo=null;this.retainedPrevious=false;this.metrics={frames:0,averageMs:0,maxMs:0,bytes:0};this.notify('initializing');
    try {
      s.plan=recordingPlan(source.width,source.height,quality,s.output.aspect);
      if(microphone) {
        let mic;
        try {
          if(!this.mediaDevices?.getUserMedia)throw new Error('MIC_UNAVAILABLE');
          mic=await this.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true}});
        } catch(error) {s.microphoneStatus=error?.name==='NotAllowedError'?'denied':'error';this.canRetrySilent=this.session===s;throw new Error(error?.name==='NotAllowedError'?'マイクが許可されませんでした。「音声なしで録画」で続行できます。':'マイクを利用できません。「音声なしで録画」で続行できます。');}
        if(this.session!==s){stopTracks(mic);return false;}
        s.mic=mic;s.microphoneStatus='acquired';
        if(!mic.getAudioTracks().some(t=>t.readyState==='live')){this.canRetrySilent=true;throw new Error('マイクの音声トラックがありません。「音声なしで録画」で続行できます。');}
      }
      if(this.session!==s)return false;
      this.canvas ||= this.createCanvas();this.canvas.width=s.plan.width;this.canvas.height=s.plan.height;
      this.copyFrame(s);
      try {
        s.video=this.canvas.captureStream(0);s.track=s.video.getVideoTracks()[0];
        if(typeof s.track?.requestFrame!=='function')throw new Error('MANUAL_CAPTURE_UNAVAILABLE');
        s.track.requestFrame();s.captureMode='manual';
      } catch {
        stopTracks(s.video);s.video=this.canvas.captureStream(s.plan.fps);s.track=s.video.getVideoTracks()[0];s.captureMode='native-fps';
      }
      if(!s.track)throw new Error('録画用の映像トラックを取得できませんでした。');
      const audio=s.mic?.getAudioTracks()||[];s.stream=new this.Stream([...s.video.getVideoTracks(),...audio]);
      for(const t of s.stream.getTracks())t.addEventListener?.('ended',()=>{if(this.session===s&&!s.stopping)this.stop(t.kind==='audio'?'マイク接続が終了しました。':'録画映像が終了しました。');},{once:true});
      // Validate an encoder before displaying the countdown. Construction does not record.
      const candidates=[];let preparationError;
      for(const mimeType of recordingTypes(this.Recorder,microphone)) {
        try {const recorder=new this.Recorder(s.stream,{mimeType,videoBitsPerSecond:s.plan.bitrate,...(microphone?{audioBitsPerSecond:96000}:{})});candidates.push({mimeType,recorder});break;}
        catch(error){preparationError=error;}
      }
      if(!candidates.length)throw preparationError||new Error('No supported recorder');
      if(countdown) {
        const began=this.now();s.countdown=3;this.notify('countdown');
        const proceed=await new Promise(resolve=>{
          s.cancelCountdown=()=>resolve(false);
          s.countdownTimer=this.schedule(()=>{if(this.session!==s||s.stopping){resolve(false);return;}
            const remaining=Math.max(0,3-Math.floor((this.now()-began)/1000));
            if(!remaining){resolve(true);return;}
            if(remaining!==s.countdown){s.countdown=remaining;this.notify();}
          },50);
        });
        this.unschedule(s.countdownTimer);s.cancelCountdown=null;
        if(!proceed||this.session!==s)return false;
      }
      let started=false,lastError;
      const prepared=candidates[0];
      for(const mimeType of recordingTypes(this.Recorder,microphone).slice(recordingTypes(this.Recorder,microphone).indexOf(prepared.mimeType))) {
        let recorder;
        try {
          s.selectedMime=mimeType;recorder=mimeType===prepared.mimeType?prepared.recorder:new this.Recorder(s.stream,{mimeType,videoBitsPerSecond:s.plan.bitrate,...(microphone?{audioBitsPerSecond:96000}:{})});s.recorder=recorder;
          recorder.ondataavailable=e=>{if(this.session!==s||!e.data?.size)return;s.chunks.push(e.data);s.chunkCount++;s.bytes+=e.data.size;this.metrics.bytes=s.bytes;if(s.bytes>=RECORDING_LIMIT_BYTES)this.stop('録画サイズが64MBに達したため終了しました。');};
          recorder.onstart=()=>{if(this.session!==s||s.stopping)return;s.nextFrame=this.now();this.notify('recording');this.pushFrame(source,s.nextFrame,true);if(s.stopping)return;s.timer=this.schedule(()=>{if(this.session!==s)return;if(this.elapsedMs>=duration*1000)this.stop('指定時間に達しました。');else this.notify();},100);};
          recorder.onerror=e=>{if(this.session!==s)return;s.failure=e.error?.message||'録画エンコード中にエラーが発生しました。';this.error=s.failure;this.stop('録画エラーのため終了しました。');};
          recorder.onstop=()=>this.finish(s);
          s.started=this.now();s.startedAt=this.wallNow();s.nextFrame=s.started;this.copyFrame(s);recorder.start(1000);this.copyFrame(s);if(s.captureMode==='manual')s.track.requestFrame();started=true;break;
        } catch(error) {lastError=error;if(recorder){recorder.ondataavailable=recorder.onstart=recorder.onerror=recorder.onstop=null;try{if(recorder.state!=='inactive')recorder.stop();}catch{}}s.chunks=[];s.chunkCount=0;s.bytes=0;}
      }
      if(!started)throw new Error('利用可能な形式で録画を開始できませんでした。低画質で再試行してください。'+(lastError?.name?` (${lastError.name})`:''));
      return true;
    } catch(error) {
      if(this.session!==s)return false;
      this.error=error.message||'録画を開始できませんでした。';this.retainedPrevious=!!s.previousResult;this.release(s);this.session=null;s.resolve(null);this.notify('error');return false;
    }
  }
  copyFrame(s) {
    const start=this.now(),c=this.canvas.getContext('2d'),source=s.source;
    drawRecordingOutput(c,source,this.canvas.width,this.canvas.height,s.output,s.started===undefined?0:this.elapsedMs/1000,s.duration);
    const ms=Math.max(0,this.now()-start);s.frames++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);
    this.metrics={frames:s.frames,averageMs:s.totalMs/s.frames,maxMs:s.maxMs,bytes:s.bytes};
  }
  pushFrame(source,time=this.now(),force=false) {
    const s=this.session;if(!s||s.stopping||!(this.state==='recording'||this.state==='initializing'&&s.recorder?.state==='recording'))return;
    if(!force&&time<s.nextFrame-.5)return;
    try{s.source=source;this.copyFrame(s);if(s.captureMode==='manual')s.track.requestFrame();}
    catch(error){s.failure=error.message||'録画フレームの転送に失敗しました。';this.error=s.failure;this.stop('フレーム転送エラーのため終了しました。');return;}
    const interval=1000/s.plan.fps;s.nextFrame+=interval;if(s.nextFrame<time-interval)s.nextFrame=time+interval;
  }
  stop(reason='途中停止しました。') {
    const s=this.session;if(!s)return Promise.resolve(this.result);
    if(s.stopping)return s.done;
    s.stopping=true;s.stopped=this.now();this.reason=reason;this.unschedule(s.timer);
    if(!s.recorder){this.retainedPrevious=!!s.previousResult;this.release(s);this.session=null;s.resolve(null);this.notify('idle');return s.done;}
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
    let completed=false;
    try {
      if(!s.bytes)throw new Error(s.failure||'録画データが生成されませんでした。');
      let blob=new Blob(s.chunks,{type:s.recorder.mimeType||s.chunks[0]?.type||''});
      const container=await recordingContainer(blob);const declared=blob.type;
      const mime=declared.split(';')[0]===container.mime?declared:container.mime;
      blob=new Blob([blob],{type:mime});
      this.result={blob,mime,extension:container.extension,filename:`portrait-${new Date().toISOString().replace(/[:.]/g,'-')}.${container.extension}`,elapsedMs,
        hasAudio:!!s.mic?.getAudioTracks().length,width:s.plan.width,height:s.plan.height,fps:s.plan.fps,partial:!!s.failure};
      completed=!s.failure;this.error=s.failure||'';
      if(s.failure&&s.previousResult){this.result=s.previousResult;this.retainedPrevious=true;}
    } catch(error){this.error=error.message;this.result=s.previousResult||null;this.retainedPrevious=!!s.previousResult;}
    finally {s.chunks=[];this.release(s);this.session=null;this.notify(completed?'completed':'error');s.resolve(this.result);}
  }
  release(s) {s.cancelCountdown?.();this.unschedule(s.countdownTimer);this.unschedule(s.timer);this.cancelTimeout(s.watchdog);if(s.recorder)s.recorder.ondataavailable=s.recorder.onstart=s.recorder.onerror=s.recorder.onstop=null;stopTracks(s.video);stopTracks(s.mic);if(s.mic)s.microphoneStatus='released';else if(s.microphoneStatus==='requesting')s.microphoneStatus='canceled';this.lastInfo=this.sessionInfo(s);}
  clearResult(){if(this.busy)return false;this.result=null;this.lastInfo=null;this.retainedPrevious=false;this.error='';this.reason='';this.notify('idle');return true;}
}
