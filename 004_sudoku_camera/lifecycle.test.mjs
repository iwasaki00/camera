import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function stream() {
  const track = { readyState: 'live', stop() { this.readyState='ended'; } };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
class Video extends EventTarget {
  paused = true; readyState = 2; videoWidth = 1920; videoHeight = 1080; srcObject = null;
  setAttribute() {}
  play() { this.paused=false; return Promise.resolve(); }
  pause() { this.paused=true; }
}
async function camera(getUserMedia) {
  const code=(await readFile(new URL('./camera.js',import.meta.url),'utf8')).replaceAll('export ', '');
  const ctx=vm.createContext({ navigator:{mediaDevices:{getUserMedia}}, DOMException, setTimeout, clearTimeout, console });
  vm.runInContext(code+'\nglobalThis.api={startCamera,stopCamera,isCameraReady};',ctx);
  return ctx.api;
}
test('camera deduplicates acquisition and waits for a usable frame', async () => {
  const pending=deferred(); let calls=0; const api=await camera(() => {calls++; return pending.promise;});
  const video=new Video(); video.readyState=0; video.videoWidth=0;
  const first=api.startCamera(video); assert.equal(first,api.startCamera(video)); assert.equal(calls,1);
  pending.resolve(stream()); await tick(); assert.equal(api.isCameraReady(video),false);
  let done=false; first.then(() => {done=true;}); await tick(); assert.equal(done,false);
  video.readyState=2; video.videoWidth=1920; video.dispatchEvent(new Event('loadeddata'));
  await first; assert.equal(api.isCameraReady(video),true); api.stopCamera(video); assert.equal(api.isCameraReady(video),false);
});
test('late acquisition after stop is released and cannot overwrite a new stream', async () => {
  const old=deferred(), fresh=stream(), stale=stream(); let calls=0;
  const api=await camera(() => ++calls===1 ? old.promise : Promise.resolve(fresh)); const video=new Video();
  const first=api.startCamera(video); const rejected=assert.rejects(first,{name:'AbortError'});
  api.stopCamera(video); await rejected; await api.startCamera(video);
  old.resolve(stale); await tick(); assert.equal(stale.track.readyState,'ended'); assert.equal(video.srcObject,fresh); api.stopCamera(video);
});
test('cancelled preferred failure does not launch fallback', async () => {
  const pending=deferred(); let calls=0; const api=await camera(() => { calls++; return pending.promise; }); const video=new Video();
  const result=api.startCamera(video); const rejected=assert.rejects(result,{name:'AbortError'}); api.stopCamera(video); await rejected;
  pending.reject(new Error('denied')); await tick(); assert.equal(calls,1);
});
test('fallback is retained; playback rejection releases stream and permits retry', async () => {
  let calls=0; const streams=[stream(),stream()];
  const api=await camera(() => {calls++; if(calls===1) return Promise.reject(new Error('constraints')); return Promise.resolve(streams[calls-2]);});
  const video=new Video(); video.play=() => Promise.reject(new Error('play failed'));
  await assert.rejects(api.startCamera(video),/再試行/); assert.equal(streams[0].track.readyState,'ended'); assert.equal(video.srcObject,null);
  video.play=Video.prototype.play; await api.startCamera(video); assert.equal(api.isCameraReady(video),true); api.stopCamera(video);
});
test('stopping during pending play releases stream and ignores late completion', async () => {
  const play=deferred(), source=stream(); const api=await camera(async()=>source); const video=new Video(); video.play=()=>play.promise;
  const result=api.startCamera(video); const rejected=assert.rejects(result,{name:'AbortError'}); await tick(); api.stopCamera(video); await rejected;
  play.resolve(); await tick(); assert.equal(source.track.readyState,'ended'); assert.equal(video.srcObject,null);
});

function element() {
  return { textContent:'', value:0, width:900, height:900, disabled:false, hidden:false, dataset:{}, style:{},
    classList:{add(){},remove(){},toggle(){}}, setAttribute(){}, scrollIntoView(){}, getContext(){return {drawImage(){},clearRect(){}};}, closest(){return null;} };
}
async function app(recognize = null) {
  let code=await readFile(new URL('./app.js',import.meta.url),'utf8');
  code=code.replace(/^import[\s\S]*?from "[^"]+";\s*/gm,'');
  code=code.slice(0,code.indexOf('\nbuildCellViews();'));
  const nodes=new Map(); const get=id=>{if(!nodes.has(id)) nodes.set(id,element()); return nodes.get(id);};
  let recognizeCalls=0, stopCalls=0, listener=null; const pending=deferred();
  const ctx=vm.createContext({document:{getElementById:get,querySelectorAll:()=>[],createElement:element,body:element(),hidden:false}, console, performance,
    createDefaultAlignment:()=>({x:0,y:0,scale:1,rotation:0}), setOcrPageSegmentationMode:async()=>{},
    stopCamera(){stopCalls++;}, startCamera:async()=>{throw new Error('camera denied');}, isCameraReady:()=>true,
    captureGuideArea(){},
    setOcrProgressListener:fn=>{listener=fn;}, recognizeSingleDigit:()=>{recognizeCalls++;return recognize ? recognize() : pending.promise;},
    drawCellCrop(){},isClearlyBlankCell:()=>false,prepareFinalOcrImages(){},prepareOcrImages(){},OCR_INPUT_SIZE:100,
  });
  vm.runInContext(code,ctx);
  vm.runInContext(`cells=Array.from({length:81},(_,i)=>({row:Math.floor(i/9),col:i%9}));
    regenerateFromAlignment=()=>{}; closeMiniKeypad=()=>{};closeCellModal=()=>{};clearSolverResult=()=>{};clearExplanationResult=()=>{};
    renderOcrResultBoard=()=>{}; updateOcrResultCell=()=>{}; validateFullOcrResults=()=>{};
    clearOcrHistory=()=>{}; closeBenchmarkModal=()=>{}; closeResultDiagnostics=()=>{};
    clearBenchmarkResults=()=>{};clearTuningResults=()=>{};
    globalThis.api={run:handleRunFullOcr, single:handleRunSingleOcr, benchmark:handleRunBenchmark,
      capture:handleCapture,retake:handleRetake, sourceWidth:()=>capturedSourceCanvas.width,
      change:()=>{alignmentRevision++; fullOcrGeneration++;}, state:()=>({running:isFullOcrRunning,revision:fullOcrRevision,results:fullOcrResults}),
      select:()=>{selectedCellIndex=0;}};`,ctx);
  return {api:ctx.api,nodes,get,pending,calls:()=>recognizeCalls,stops:()=>stopCalls,progress:()=>listener?.({progress:.5})};
}
test('81-cell OCR prevents duplicate starts and diagnostics while in progress', async()=>{
  const a=await app(); const run=a.api.run(); await tick();
  await a.api.run(); a.api.select(); await a.api.single(); await a.api.benchmark(); assert.equal(a.calls(),1);
  a.pending.resolve({digit:'1',rawText:'1',confidence:90,elapsedMs:1,status:'digit'}); await run;
  assert.equal(a.calls(),81); assert.equal(a.api.state().revision,0); assert.equal(a.api.state().running,false);
});
test('old OCR progress and result cannot commit after image/settings revision changes',async()=>{
  const a=await app(); const run=a.api.run(); await tick(); a.api.change();
  a.get('fullOcrProgressText').textContent='new image'; a.progress(); assert.equal(a.get('fullOcrProgressText').textContent,'new image');
  a.pending.resolve({digit:'1'}); await run; assert.equal(a.api.state().revision,null);
  assert.ok(a.api.state().results.every(result=>result===null)); assert.equal(a.calls(),1); assert.equal(a.api.state().running,false);
});
test('OCR failure discards partial results, keeps solve disabled and unlocks retry',async()=>{
  let calls=0;
  const a=await app(async()=>{
    if(++calls===2) throw new Error('OCR failed after first cell');
    return {digit:'1',rawText:'1',confidence:90,elapsedMs:1,status:'digit'};
  });
  await a.api.run();
  assert.equal(a.api.state().revision,null); assert.ok(a.api.state().results.every(result=>result===null));
  assert.equal(a.get('solveButton').disabled,true); assert.equal(a.get('runFullOcrButton').disabled,false);
  await a.api.run(); assert.equal(a.calls(),83); assert.equal(a.api.state().revision,0);
  assert.ok(a.api.state().results.every(Boolean)); assert.equal(a.api.state().running,false);
});

test('capture stops camera and retake failure preserves the captured canvas',async()=>{
  const a=await app(); a.api.capture();
  assert.equal(a.stops(),1);
  assert.equal(a.get('captureButton').disabled,true);
  assert.equal(a.get('cameraSection').hidden,true);
  assert.equal(a.get('resultSection').hidden,false);
  const width=a.api.sourceWidth();
  await a.api.retake();
  assert.equal(a.api.sourceWidth(),width);
  assert.equal(a.get('croppedCanvas').width,900);
  assert.equal(a.get('resultSection').hidden,false);
  assert.equal(a.get('captureButton').disabled,true);
  assert.equal(a.get('startCameraButton').disabled,false);
  assert.equal(a.api.state().revision,null);
});

test('failed Tesseract worker initialization is retryable',async()=>{
  const code=(await readFile(new URL('./ocr.js',import.meta.url),'utf8')).replaceAll('export ','');
  let calls=0;
  const ctx=vm.createContext({console:{log(){}},performance,window:{Tesseract:{createWorker:async()=>{
    if(++calls===1) throw new Error('initialization failed');
    return {setParameters:async()=>{},recognize:async()=>({data:{text:'5',confidence:95}})};
  }}}});
  vm.runInContext(code+'\nglobalThis.api={setOcrPageSegmentationMode,recognizeSingleDigit};',ctx);
  await assert.rejects(ctx.api.setOcrPageSegmentationMode('8'),/initialization failed/);
  await ctx.api.setOcrPageSegmentationMode('8');
  assert.equal((await ctx.api.recognizeSingleDigit({width:100,height:100})).digit,'5');
  assert.equal(calls,2);
});
