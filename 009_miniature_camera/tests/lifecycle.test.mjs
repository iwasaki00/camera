import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../js/' + name, import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
class Track {
  constructor(kind='video') { this.kind=kind; this.stopped=false; }
  stop() { this.stopped=true; }
  clone() { return new Track(this.kind); }
  getSettings() { return {frameRate:30}; }
  getCapabilities() { return {}; }
}
class Stream {
  constructor(tracks=[new Track()]) { this.tracks=tracks; }
  get active() { return this.tracks.some(t=>!t.stopped); }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(t=>t.kind==='video'); }
  getAudioTracks() { return this.tracks.filter(t=>t.kind==='audio'); }
  addTrack(track) { this.tracks.push(track); }
}
function environment() {
  const streams=[], instances=[];
  let failConstruct=false;
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream,opts) { if(failConstruct) throw Error('constructor'); this.stream=stream; this.mimeType=opts.mimeType; this.state='inactive'; instances.push(this); }
    start() { this.state='recording'; }
    stop() { this.state='inactive'; queueMicrotask(()=> { this.ondataavailable?.({data:new Blob(['video'])}); this.onstop?.(); }); }
  }
  const canvas=()=> ({width:1280,height:720,getContext:()=>({drawImage(){}}),toBlob(cb){queueMicrotask(()=>cb(new Blob(['frame'])));},captureStream(fps){ const s=new Stream(); s.fps=fps; streams.push(s); return s; }});
  const c=vm.createContext({console,Blob,MediaStream:Stream,MediaRecorder:Recorder,HTMLCanvasElement:{prototype:{captureStream(){}}},window:{MediaRecorder:Recorder,createImageBitmap:true},document:{createElement:canvas},createImageBitmap:async()=>({close(){}}),setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},queueMicrotask,navigator:{mediaDevices:{getUserMedia:async()=>new Stream()}}});
  for(const [file,names] of [['camera.js',['CameraController']],['recorder.js',['CanvasRecorder','TimeLapseRecorder']]]) vm.runInContext(read(file).replace(/export /g,'')+'\nObject.assign(globalThis, {'+names.join(',')+'});',c);
  return {c,canvas,streams,instances,failConstructor(){failConstruct=true;}};
}

test('camera serializes requests and disposes stale acquisition',async()=>{
  const {c}=environment(), wait=deferred(), streams=[new Stream(),new Stream()]; let calls=0;
  c.navigator.mediaDevices.getUserMedia=()=> ++calls===1?wait.promise:Promise.resolve(streams[1]);
  const video={srcObject:null,play:async()=>{}}; const camera=new c.CameraController(video);
  const first=camera.start(); const firstError=assert.rejects(first,/CAMERA_CANCELLED/); await tick();
  const second=camera.start({facingMode:'user'}); await tick(); assert.equal(calls,1);
  wait.resolve(streams[0]); await firstError; await second;
  assert.ok(streams[0].getTracks()[0].stopped); assert.equal(camera.stream,streams[1]); assert.equal(camera.facingMode,'user'); camera.stop();
});
test('play failures release every fallback stream and allow retry',async()=>{
  const {c}=environment(), streams=[]; c.navigator.mediaDevices.getUserMedia=async()=>{const s=new Stream();streams.push(s);return s;};
  const video={srcObject:null,play:async()=>{throw Error('play');}}; const camera=new c.CameraController(video);
  await assert.rejects(camera.start(),/play/); assert.equal(streams.length,4); assert.ok(streams.every(s=>!s.active)); assert.equal(video.srcObject,null);
  video.play=async()=>{}; await camera.start(); camera.stop(); camera.stop(); assert.ok(streams.every(s=>!s.active));
});
test('stop invalidates acquisition and pending audio',async()=>{
  const {c}=environment(), wait=deferred(); c.navigator.mediaDevices.getUserMedia=()=>wait.promise;
  const camera=new c.CameraController({play:async()=>{},srcObject:null}); const audio=camera.setAudio(true); camera.stopAudio();
  const stream=new Stream([new Track('audio')]); wait.resolve(stream); await assert.rejects(audio,/AUDIO_CANCELLED/); assert.equal(stream.active,false);
  const pending=deferred(); c.navigator.mediaDevices.getUserMedia=()=>pending.promise;
  const start=camera.start(); const rejected=assert.rejects(start,/CAMERA_CANCELLED/); await tick(); camera.stop();
  const video=new Stream();pending.resolve(video);await rejected;assert.equal(video.active,false);
});
test('recording stop is shared; all owned tracks released; original audio retained',async()=>{
  const {c,canvas}=environment(), recorder=new c.CanvasRecorder(canvas()); const original=new Stream([new Track('audio')]);
  recorder.start(original); const tracks=recorder.stream.getTracks(); assert.throws(()=>recorder.start(),/BUSY/);
  const first=recorder.stop(); assert.equal(recorder.stop(),first); assert.throws(()=>recorder.start(),/BUSY/);
  assert.ok((await first).size); assert.ok(tracks.every(t=>t.stopped));assert.ok(original.active);assert.equal(recorder.state,'idle');
});
test('recorder errors before Stop release tracks and reject result',async()=>{
  const {c,canvas,instances}=environment(), recorder=new c.CanvasRecorder(canvas()); let notified=0;recorder.onError=()=>notified++;
  recorder.start(); const tracks=recorder.stream.getTracks();instances[0].onerror();
  await assert.rejects(recorder.stop(),/RECORDING_FAILED/);assert.equal(notified,1);assert.ok(tracks.every(t=>t.stopped));assert.equal(recorder.state,'idle');
});
test('recorder constructor failure releases capture stream',()=>{
  const e=environment();e.failConstructor();const recorder=new e.c.CanvasRecorder(e.canvas());assert.throws(()=>recorder.start(),/constructor/);assert.ok(e.streams.every(s=>!s.active));assert.equal(recorder.state,'idle');
});
async function frames(e) { const r=new e.c.TimeLapseRecorder(e.canvas());r.start(8);await tick();await r.captureFrame();return r; }
test('timelapse keeps factor, 640px limit and 30fps; stop is shared',async()=>{
  const e=environment(),r=await frames(e);assert.equal(r.factor,8);assert.equal(r.frameCanvas.width,640);assert.equal(r.maxFrames,600);
  const result=r.stop();assert.equal(r.stop(),result);assert.throws(()=>r.start(),/BUSY/);assert.ok((await result).size);assert.equal(e.streams[0].fps,30);assert.ok(e.streams.every(s=>!s.active));assert.equal(r.frames.length,0);
});
test('timelapse draw and toBlob failures clear capturing and data',async()=>{
  for(const kind of ['draw','blob']) { const e=environment(); const r=new e.c.TimeLapseRecorder(e.canvas());r.state='recording';
    if(kind==='draw')r.frameContext.drawImage=()=>{throw Error('draw');};else r.frameCanvas.toBlob=cb=>cb(null);
    await assert.rejects(r.captureFrame());assert.equal(r.capturing,false);assert.equal(r.state,'idle');assert.equal(r.frames.length,0);
  }
});
test('timelapse bitmap failure releases encoding tracks and permits retry',async()=>{
  const e=environment(),r=await frames(e);e.c.createImageBitmap=async()=>{throw Error('bitmap');};await assert.rejects(r.stop(),/bitmap/);assert.ok(e.streams.every(s=>!s.active));assert.equal(r.frames.length,0);assert.equal(r.state,'idle');r.start(2);await tick();r.cancel();
});
test('timelapse recorder construction failure releases encoding stream',async()=>{
  const e=environment(),r=await frames(e);e.failConstructor();await assert.rejects(r.stop(),/constructor/);assert.ok(e.streams.every(s=>!s.active));assert.equal(r.frames.length,0);
});
test('timelapse interrupted decode closes late bitmap and restores idle',async()=>{
  const e=environment(),r=await frames(e),wait=deferred();let closed=0;e.c.createImageBitmap=()=>wait.promise;
  const result=r.stop();const rejected=assert.rejects(result,/INTERRUPTED/);await tick();r.cancel();await rejected;
  wait.resolve({close(){closed++;}});await tick();assert.equal(closed,1);assert.ok(e.streams.every(s=>!s.active));assert.equal(r.state,'idle');assert.equal(r.frames.length,0);
});
test('timelapse encoder error closes late bitmap and releases stream',async()=>{
  const e=environment(),r=await frames(e),wait=deferred();let closed=0;e.c.createImageBitmap=()=>wait.promise;
  const result=r.stop();const rejected=assert.rejects(result,/ENCODING_FAILED/);await tick();e.instances[0].onerror();await rejected;
  wait.resolve({close(){closed++;}});await tick();assert.equal(closed,1);assert.ok(e.streams.every(s=>!s.active));
});

function mainEnvironment() {
  const e=environment(), elements=new Map(), events={}; let nextTimer=0;
  const element = () => ({value:'',checked:false,hidden:false,disabled:false,style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},firstChild:{textContent:''},dataset:{},
    addEventListener(name,fn){(this.listeners??={})[name]=fn;},setAttribute(){},getAttribute(){return 'true';},querySelector(){return element();},querySelectorAll(){return [];},append(){},remove(){},removeAttribute(){},load(){},pause(){this.paused=true;},play:async()=>{},getBoundingClientRect(){return {left:0,top:0,width:390,height:400};},hasPointerCapture(){return false;},setPointerCapture(){},releasePointerCapture(){},showModal(){this.open=true;},close(){this.open=false;},click(){},toBlob(cb){queueMicrotask(()=>cb(new Blob(['photo'])));}});
  const el=id=>{if(!elements.has(id))elements.set(id, id === "#previewCanvas" ? Object.assign(element(), e.canvas()) : element());return elements.get(id);};
  e.c.document={hidden:false,querySelector:el,createElement:tag=>tag === "canvas" ? e.canvas() : element(),body:{append(){}},addEventListener(name,fn){events[name]=fn;}};
  e.c.window.addEventListener=(name,fn)=>events[name]=fn;e.c.window.removeEventListener=()=>{};e.c.window.isSecureContext=true;
  e.c.localStorage={getItem(){return null;},setItem(){},removeItem(){}}; e.c.location={hostname:'localhost'};
  e.c.URL={createObjectURL:()=> 'blob:test',revokeObjectURL(){}};e.c.Image=class {};e.c.Event=class {};
  e.c.requestAnimationFrame=()=>1;e.c.cancelAnimationFrame=()=>{};
  e.c.setTimeout=()=>++nextTimer;e.c.clearTimeout=()=>{};e.c.setInterval=()=>++nextTimer;e.c.clearInterval=()=>{};
  e.c.DEFAULTS={shape:'horizontal',position:50,centerX:50,centerY:50,width:20,zoom:1};e.c.CONTROL_DEFS=[];e.c.PRESETS={standard:{}};e.c.RECOMMENDATIONS={};e.c.applyDegree=p=>p;
  e.c.MiniatureRenderer=class {constructor(){this.targetFps=30;this.resolutionScale=1;}setParams(){}setSource(){}start(){this.running=true;}pause(){this.running=false;}setCompare(){}setTargetFps(){}setResolutionScale(){} };
  vm.runInContext(read('main.js').replace(/^import .*;$/gm,''),e.c);
  const run=code=>vm.runInContext(code,e.c);
  run('sourceReady=true; els.empty.hidden=true; updateAvailability();');
  return {...e,el,events,run};
}
test('main blocks duplicate recording during microphone prompt and cancels stale permission',async()=>{
  const e=mainEnvironment(),wait=deferred();let calls=0;e.c.navigator.mediaDevices.getUserMedia=()=>{calls++;return wait.promise;};
  e.run('els.audio.checked=true; mode="video"; startRecording(); startRecording();');assert.equal(calls,1);assert.equal(e.run('captureState'),'starting');assert.equal(e.el('#flipButton').disabled,true);
  e.c.document.hidden=true;e.events.visibilitychange();e.c.document.hidden=false;e.events.visibilitychange();const stream=new Stream([new Track('audio')]);wait.resolve(stream);await tick();
  assert.equal(stream.active,false);assert.equal(e.instances.length,0);assert.equal(e.run('captureState'),'idle');assert.equal(e.run('sourceReady'),false);
});
test('main microphone OFF avoids audio permission; stop locks source and mode changes',async()=>{
  const e=mainEnvironment();let calls=0;e.c.navigator.mediaDevices.getUserMedia=async()=>{calls++;return new Stream();};e.el('#previewCanvas').captureStream=()=>new Stream();
  await e.run('mode="video"; startRecording()');assert.equal(calls,0);assert.equal(e.run('captureState'),'recording');
  const stop=e.run('stopRecording()');assert.equal(e.run('captureState'),'stopping');assert.equal(e.el('#libraryButton').disabled,true);assert.equal(e.el('#qualitySelect').disabled,true);
  e.run('startRecording(); setMode("photo");');assert.equal(e.run('mode'),'video');await stop;assert.equal(e.run('captureState'),'idle');assert.equal(e.el('#libraryButton').disabled,false);
});
test('main hidden preview stops camera and only explicit operation restarts it',async()=>{
  const e=mainEnvironment();await e.run('startCamera()');const stream=e.run('camera.stream');assert.ok(stream.active);
  e.c.document.hidden=true;e.events.visibilitychange();assert.equal(stream.active,false);assert.equal(e.run('renderer.running'),false);
  e.c.document.hidden=false;e.events.visibilitychange();assert.equal(e.run('camera.stream'),null);assert.equal(e.el('#shutterButton').disabled,true);
  await e.run('startCamera()');assert.ok(e.run('camera.stream.active'));
});
test('main camera startup failure restores retry controls',async()=>{
  const e=mainEnvironment();e.c.navigator.mediaDevices.getUserMedia=async()=>{throw Error('permission');};await e.run('startCamera()');assert.equal(e.el('#startButton').disabled,false);assert.equal(e.el('#libraryButton').disabled,false);assert.equal(e.run('sourceReady'),false);
});
test('main library image failure restores controls',async()=>{
  const e=mainEnvironment();let image;e.c.Image=class {constructor(){image=this;}};await e.run('openLibraryFile({type:"image/jpeg"})');image.onerror();assert.equal(e.run('sourceBusy'),false);assert.equal(e.el('#startButton').disabled,false);
});
test('main pointer cancellation never moves focus and clears gesture state',()=>{
  const e=mainEnvironment();e.run('pointers.set(1,{x:20,y:20}); tapState={id:1,moved:false}; gestureStart={};');e.el('#previewCanvas').listeners.pointercancel({pointerId:1});assert.equal(e.run('pointers.size'),0);assert.equal(e.run('tapState'),null);assert.equal(e.run('gestureStart'),null);
});

test('main hidden recording finalizes available data and resets REC display',async()=>{
  const e=mainEnvironment();await e.run('mode="video";startRecording()');e.c.document.hidden=true;e.events.visibilitychange();await tick();
  assert.equal(e.run('captureState'),'idle');assert.equal(e.run('recording'),false);assert.ok(e.run('pendingReview.blob.size')>0);
  e.c.document.hidden=false;e.events.visibilitychange();assert.equal(e.el('#reviewDialog').open,true);assert.equal(e.run('sourceReady'),false);
});
test('main recording error releases microphone and restores controls',async()=>{
  const e=mainEnvironment();await e.run('mode="video";startRecording()');e.instances[0].onerror();await tick();assert.equal(e.run('captureState'),'idle');assert.equal(e.run('recording'),false);assert.equal(e.el('#libraryButton').disabled,false);
});
test('main library video play failure restores camera retry',async()=>{
  const e=mainEnvironment();e.el('#sourceVideo').play=async()=>{throw Error('play');};await e.run('openLibraryFile({type:"video/mp4"})');assert.equal(e.run('sourceBusy'),false);assert.equal(e.el('#startButton').disabled,false);
});
test('main pagehide during timelapse encoding aborts and unlocks controls',async()=>{
  const e=mainEnvironment();await e.run('mode="timelapse";startTimelapse()');await tick();await e.run('timelapseRecorder.captureFrame()');
  const wait=deferred();e.c.createImageBitmap=()=>wait.promise;const stop=e.run('stopTimelapse()');await tick();e.events.pagehide();await stop;
  assert.equal(e.run('captureState'),'idle');assert.equal(e.run('recording'),false);assert.equal(e.run('timelapseRecorder.frames.length'),0);assert.ok(e.streams.every(s=>!s.active));assert.equal(e.el('#startButton').disabled,false);
  wait.resolve({close(){}});await tick();
});
test('main late photo callback cannot overwrite a newer snapshot',async()=>{
  const e=mainEnvironment(),callbacks=[];e.el('#previewCanvas').toBlob=cb=>callbacks.push(cb);
  e.run('takePhoto();photoBusy=false;takePhoto()');callbacks[0](new Blob(['old']));assert.equal(e.el('#reviewDialog').open,undefined);
  callbacks[1](new Blob(['new']));assert.equal(e.el('#reviewDialog').open,true);assert.equal(await e.run('reviewBlob.text()'),'new');
});
test('recorder unexpected stop finalizes and notifies completion once',async()=>{
  const e=environment(),recorder=new e.c.CanvasRecorder(e.canvas());let completed=0;recorder.onComplete=()=>completed++;
  recorder.start();e.instances[0].stop();await tick();assert.ok((await recorder.stop()).size);assert.equal(completed,1);assert.ok(e.streams.every(s=>!s.active));
});
test('timelapse too short releases frame data and remains retryable',async()=>{
  const e=environment(),r=new e.c.TimeLapseRecorder(e.canvas());r.start(16);await tick();await assert.rejects(r.stop(),/TOO_SHORT/);assert.equal(r.frames.length,0);assert.equal(r.state,'idle');
});
test('timelapse preserves every factor and refuses frames above 600',async()=>{
  const e=environment(),r=new e.c.TimeLapseRecorder(e.canvas());
  for (const factor of [2,4,8,16]) {r.start(factor);await tick();assert.equal(r.factor,factor);r.frames=Array(600).fill(new Blob(['f']));await r.captureFrame();assert.equal(r.frames.length,600);r.cancel();}
});

test('timelapse cancel releases pending frame capture without waiting for toBlob',async()=>{
  const e=environment(),r=new e.c.TimeLapseRecorder(e.canvas());let callback;r.frameCanvas.toBlob=cb=>{callback=cb;};r.start();await tick();const capture=r.capturePromise;assert.equal(r.capturing,true);r.cancel();await assert.rejects(capture,/INTERRUPTED/);assert.equal(r.capturing,false);callback(new Blob(['late']));assert.equal(r.frames.length,0);
});
test('main flushes settings before clearing background timers',()=>{
  const e=mainEnvironment();let value;e.c.localStorage.setItem=(key,data)=>{value=JSON.parse(data);};e.run('params.width=37;scheduleSave();suspend()');assert.equal(value.params.width,37);
});
test('MIME priority still selects H264 first and respects unsupported browsers',()=>{
  const e=environment();
  assert.equal(new e.c.CanvasRecorder(e.canvas()).mimeType,'video/mp4;codecs=h264');
  e.c.MediaRecorder.isTypeSupported=type=>type==='video/webm;codecs=vp8';assert.equal(new e.c.CanvasRecorder(e.canvas()).mimeType,'video/webm;codecs=vp8');
  e.c.window.MediaRecorder=null;assert.equal(new e.c.CanvasRecorder(e.canvas()).supported,false);
});
