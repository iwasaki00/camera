import { selectMimeType } from "./utils.js";

function startOne(stream, notify) {
  const mimeType=selectMimeType();
  const recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:2_000_000});
  const entry={recorder,chunks:[],mimeType:recorder.mimeType||mimeType,error:null,settled:false};
  entry.done=new Promise(resolve=>entry.resolve=resolve);
  entry.finish=()=>{
    if(entry.settled)return;
    entry.settled=true;clearTimeout(entry.timer);
    entry.resolve(entry.chunks.length?new Blob(entry.chunks,{type:entry.mimeType||"video/mp4"}):null);
  };
  entry.stop=()=>{
    if(entry.stopping||entry.settled)return entry.done;
    entry.stopping=true;
    entry.timer=setTimeout(()=>{entry.error ||= "録画終了がタイムアウトしました。動画は不完全な可能性があります。";entry.finish();},4000);
    try {if(recorder.state!=="inactive")recorder.stop();else entry.finish();}
    catch(error){entry.error=error.message;entry.finish();}
    return entry.done;
  };
  recorder.ondataavailable=event=>{if(event.data?.size)entry.chunks.push(event.data);};
  recorder.onstop=()=>{entry.finish();notify();};
  recorder.onerror=event=>{
    entry.error=event.error?.message||"録画中にエラーが発生しました。";
    if(recorder.state==="inactive"){
      entry.stopping=true;
      entry.timer=setTimeout(()=>entry.finish(),4000);
    }else entry.stop();
    notify();
  };
  recorder.start(250);
  return entry;
}

export class DualRecorder {
  start(cameraStream,skeletonCanvas,fps=20) {
    if(this.active)throw new Error("録画は既に開始されています。");
    this.active=true;this.stopping=null;this.errors=[];
    const notify=()=>{if(this.active&&!this.stopping){this.stop();this.oninterrupt?.();}};
    // The camera stream belongs to CameraController. Only canvas tracks are ours.
    try {this.original=startOne(cameraStream,notify);}catch(error){this.original=null;this.errors.push("元動画: "+error.message);}
    try {
      this.skeletonStream=skeletonCanvas.captureStream?.(fps);
      if(!this.skeletonStream)throw new Error("このブラウザは骨格動画の録画に対応していません。姿勢JSONは保存できます。");
      this.skeleton=startOne(this.skeletonStream,notify);
    }catch(error){this.skeleton=null;this.errors.push("骨格動画: "+error.message);this.releaseCanvas();}
    if(!this.original&&!this.skeleton){this.active=false;throw new Error(this.errors.join("\n"));}
  }
  releaseCanvas(){this.skeletonStream?.getTracks().forEach(track=>track.stop());this.skeletonStream=null;}
  stop() {
    if(this.stopping)return this.stopping;
    if(!this.active)return Promise.resolve({originalBlob:null,skeletonBlob:null,errors:[]});
    // Assign the promise before recorder.stop(), whose callbacks may be synchronous.
    this.stopping=Promise.resolve().then(async()=>{
      try {
        const [originalBlob,skeletonBlob]=await Promise.all([this.original?.stop()||null,this.skeleton?.stop()||null]);
        const errors=[...this.errors];
        for(const [name,entry,blob] of [["元動画",this.original,originalBlob],["骨格動画",this.skeleton,skeletonBlob]]){
          if(entry?.error)errors.push(name+": "+entry.error);
          else if(entry&&!blob)errors.push(name+": 動画データを取得できませんでした。");
        }
        return {originalBlob,skeletonBlob,errors};
      } finally {this.releaseCanvas();this.original=null;this.skeleton=null;this.active=false;}
    });
    return this.stopping;
  }
}
