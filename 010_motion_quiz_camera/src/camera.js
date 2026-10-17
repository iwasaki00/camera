const abortError = () => new DOMException("カメラ要求は中断されました。", "AbortError");
const release = stream => stream?.getTracks().forEach(track => track.stop());

export class CameraController {
  constructor(video) {
    this.video=video; this.stream=null; this.facingMode="environment"; this.generation=0;
  }

  async start(facingMode=this.facingMode) {
    this.stop();
    const generation=this.generation;
    const controller=new AbortController();
    this.controller=controller;
    this.facingMode=facingMode;
    let stream,attached=false;
    const valid=()=>generation===this.generation&&!controller.signal.aborted;
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:24,max:30}}});
      if(!valid()) throw abortError();
      this.stream=stream;attached=true;
      this.video.srcObject=stream;
      // Bound both play() and loadeddata, including stop/switch while either waits.
      await new Promise((resolve,reject)=>{
        let played=false;
        const cleanup=()=>{clearTimeout(timer); for(const event of ["loadeddata","error","abort","emptied"]) this.video.removeEventListener(event,onEvent); controller.signal.removeEventListener("abort",onAbort);};
        const finish=error=>{cleanup();error?reject(error):resolve();};
        const check=()=>{if(played&&this.video.readyState>=2)finish();};
        const onAbort=()=>finish(abortError());
        const onEvent=event=>event.type==="loadeddata"?check():finish(new Error("カメラ映像を読み込めませんでした。再試行してください。"));
        const timer=setTimeout(()=>finish(new Error("カメラの開始がタイムアウトしました。再試行してください。")),15000);
        for(const event of ["loadeddata","error","abort","emptied"])this.video.addEventListener(event,onEvent);
        controller.signal.addEventListener("abort",onAbort,{once:true});
        Promise.resolve().then(()=>this.video.play()).then(()=>{played=true;check();},finish);
      });
      if(!valid())throw abortError();
      return stream;
    } catch(error) {
      if(valid())this.stop();
      else if(!attached)release(stream);
      throw error;
    }
  }

  flip(){return this.start(this.facingMode==="environment"?"user":"environment");}
  stop(){
    this.generation++;
    this.controller?.abort(); this.controller=null;
    release(this.stream); this.stream=null;
    this.video.pause(); this.video.srcObject=null;
  }
}
