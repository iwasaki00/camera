import { TrackingState, TRACKING_CONFIG } from './tracking-geometry.js?v=0.4.0';

class WorkerDetector {
  constructor() {
    this.worker=new Worker(new URL('./tracking-worker.js?v=0.4.0',import.meta.url));
    this.pending=new Map();this.id=0;this.backend='worker';this.closed=false;
    this.worker.onmessage=({data})=>{
      const request=this.pending.get(data.id);if(!request)return;
      this.pending.delete(data.id);clearTimeout(request.timer);
      data.error?request.reject(new Error(data.error)):request.resolve(data);
    };
    this.worker.onerror=event=>{event.preventDefault();this.close(new Error('顔検出Workerを利用できません。'));};
  }
  request(type,values={},transfer=[],timeout=5000) {
    if(this.closed)return Promise.reject(new Error('顔検出を停止しました。'));
    return new Promise((resolve,reject)=>{
      const id=++this.id,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('顔検出の応答がありません。'));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try{this.worker.postMessage({id,type,...values},transfer);}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async detect(canvas,time) {
    const image=await createImageBitmap(canvas);
    try{return await this.request('detect',{image,time},[image]);}finally{image.close();}
  }
  close(error=new Error('顔検出を停止しました。')) {
    this.closed=true;
    this.worker.terminate();
    for(const r of this.pending.values()){clearTimeout(r.timer);r.reject(error);}this.pending.clear();
  }
}

export async function createDetector(signal) {
  if(typeof Worker==='function' && typeof OffscreenCanvas==='function' && typeof createImageBitmap==='function') {
    let worker;
    const abort=()=>worker?.close(new DOMException('Stopped','AbortError'));
    try{
      worker=new WorkerDetector();signal?.addEventListener('abort',abort,{once:true});
      await worker.request('init',{},[],20000);
      if(signal?.aborted)throw new DOMException('Stopped','AbortError');return worker;
    } catch(error){worker?.close();if(signal?.aborted)throw error;}
    finally{signal?.removeEventListener('abort',abort);}
  }
  const {createFaceDetector}=await import('./face-detector.js?v=0.4.0');
  const detector=await createFaceDetector();
  return {backend:'main',detect:(canvas,time)=>{const start=performance.now();return {landmarks:detector.detect(canvas,time),ms:performance.now()-start};},close:()=>detector.close()};
}

export const nextInterval = (current,ms,minimum,maximum=TRACKING_CONFIG.maxInterval) =>
  Math.min(maximum,Math.max(minimum, current*.65+ms*1.8*.35));
// Keep an idle window for stop/manual UI events even when inference exceeds the intended interval.
export const detectionDelay = (interval,elapsed,minimum) => Math.max(minimum*.25,interval-elapsed);

export class FaceTracker {
  constructor({video,changed=()=>{},failed=()=>{},factory=createDetector,config=TRACKING_CONFIG,
    createCanvas=()=>document.createElement('canvas'),now=()=>performance.now()}) {
    Object.assign(this,{video,changed,failed,factory,config,createCanvas,now});
    this.state=new TrackingState(config);this.generation=0;this.active=false;this.metrics={count:0,ms:0,interval:config.interval,backend:''};
  }
  async start() {
    this.stop();const generation=++this.generation;this.active=true;this.state.status='detecting';this.changed();
    this.abort=new AbortController();
    try {
      const detector=await this.factory(this.abort.signal);
      if(generation!==this.generation){detector.close();return;}
      this.detector=detector;this.input=this.createCanvas();this.lastVideoTime=-1;
      this.minimum=detector.backend==='worker'?this.config.interval:this.config.fallbackInterval;
      this.metrics={count:0,ms:0,interval:this.minimum,backend:detector.backend};this.changed();
      this.loop(generation);
    } catch(error){if(generation===this.generation)this.error(error);}
  }
  error(error) {this.stop();this.state.status='error';this.changed();this.failed(error);}
  stop() {
    this.active=false;this.generation++;this.abort?.abort();this.abort=null;clearTimeout(this.timer);this.detector?.close();this.detector=null;
    this.input=null;this.state.clear();this.changed();
  }
  async loop(generation) {
    if(!this.active || generation!==this.generation)return;
    const start=this.now(),video=this.video;
    try {
      if(video.readyState>=2 && video.videoWidth && video.videoHeight && video.currentTime!==this.lastVideoTime) {
        const frameWidth=video.videoWidth,frameHeight=video.videoHeight;
        const edge=this.detector.backend==='worker'?this.config.inputEdge:this.config.fallbackEdge;
        const scale=Math.min(1,edge/Math.max(video.videoWidth,video.videoHeight));
        this.input.width=Math.max(1,Math.round(video.videoWidth*scale));this.input.height=Math.max(1,Math.round(video.videoHeight*scale));
        this.input.getContext('2d').drawImage(video,0,0,this.input.width,this.input.height);
        this.lastVideoTime=video.currentTime;
        const result=await this.detector.detect(this.input,start);
        if(generation!==this.generation)return;
        const latency=this.now()-start;
        // A stalled inference must not resurrect an already expired camera frame.
        if(frameWidth!==video.videoWidth || frameHeight!==video.videoHeight){this.state.clear();this.state.status='detecting';this.lastVideoTime=-1;}
        else if(latency<=this.config.holdMs)this.state.accept(result.landmarks,frameWidth,frameHeight,start);
        else this.state.miss(this.now());
        this.metrics.count++;this.metrics.ms=result.ms;this.metrics.latency=latency;
        this.metrics.interval=nextInterval(this.metrics.interval,latency,this.minimum,this.config.maxInterval);
        this.changed();
      } else {this.state.visible(this.now());this.changed();}
    } catch(error){if(generation===this.generation)this.error(error);return;}
    if(generation===this.generation && this.active)this.timer=setTimeout(()=>this.loop(generation),detectionDelay(this.metrics.interval,this.now()-start,this.minimum));
  }
  crops(parts,width,height) {return this.state.resolve(parts,width,height,this.now());}
}
