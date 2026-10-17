import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraController } from '../src/camera.js';
import { DualRecorder } from '../src/recorder.js';
import { PoseDetector } from '../src/pose.js';
import { MotionStore } from '../src/storage.js';
import { MotionQuizApp } from '../src/app.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const stream=()=>{const track={stops:0,stop(){this.stops++;},addEventListener(){}};return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};};
class Node extends EventTarget {
  constructor(){super();this.readyState=2;this.videoWidth=640;this.videoHeight=480;this.currentTime=0;this.dataset={};this.style={};this.value='';this.hidden=false;this.disabled=false;this.classList={add(){},remove(){},toggle(){}};this.children=[];}
  play(){return Promise.resolve();} pause(){} load(){} removeAttribute(name){delete this[name];} showModal(){this.open=true;} close(){this.open=false;this.dispatchEvent(new Event('close'));} append(...nodes){this.children.push(...nodes);} replaceChildren(){this.children=[];}
  getContext(){return {clearRect(){},fillRect(){},drawImage(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};}
  toBlob(callback){callback(new Blob(['thumb']));}
}
let nodes;
function setup(){
  nodes=new Map();
  globalThis.document={hidden:false,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);},querySelectorAll:()=>[],createElement:()=>new Node(),addEventListener(){}};
  globalThis.window={MediaRecorder:FakeRecorder,isSecureContext:true,addEventListener(){}};
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  FakeRecorder.instances=[];
}
class FakeRecorder {
  static instances=[];static isTypeSupported(){return true;}
  constructor(stream){this.stream=stream;this.mimeType='video/mp4';this.state='inactive';this.stops=0;FakeRecorder.instances.push(this);}
  start(){this.state='recording';}
  stop(){this.stops++;this.state='inactive';this.ondataavailable?.({data:new Blob(['video'])});this.onstop?.();}
}
globalThis.MediaRecorder=FakeRecorder;
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{}},configurable:true});

 test('camera: late acquisition is released and cannot replace newer stream',async()=>{
  setup();const a=deferred(),b=deferred();let calls=0;navigator.mediaDevices.getUserMedia=()=>++calls===1?a.promise:b.promise;
  const video=new Node(),camera=new CameraController(video),old=camera.start();const rejected=assert.rejects(old,{name:'AbortError'});const current=camera.start('user');
  const second=stream();b.resolve(second);await current;const first=stream();a.resolve(first);await rejected;
  assert.equal(first.track.stops,1);assert.equal(camera.stream,second);assert.equal(video.srcObject,second);camera.stop();assert.equal(second.track.stops,1);
 });
 test('camera: play failure frees stream and retry succeeds',async()=>{
  setup();const first=stream();navigator.mediaDevices.getUserMedia=async()=>first;const video=new Node();video.play=async()=>{throw Error('play failed');};const camera=new CameraController(video);
  await assert.rejects(camera.start(),/play failed/);assert.equal(first.track.stops,1);assert.equal(video.srcObject,null);
  video.play=async()=>{};const second=stream();navigator.mediaDevices.getUserMedia=async()=>second;await camera.start();assert.equal(camera.stream,second);camera.stop();
 });
 test('camera: stop aborts loadeddata wait; video error exits wait',async()=>{
  setup();const first=stream();navigator.mediaDevices.getUserMedia=async()=>first;const video=new Node();video.readyState=0;const camera=new CameraController(video);
  let start=camera.start();let rejected=assert.rejects(start,{name:'AbortError'});await flush();camera.stop();await rejected;assert.equal(first.track.stops,1);
  navigator.mediaDevices.getUserMedia=async()=>stream();start=camera.start();rejected=assert.rejects(start,/読み込めません/);await flush();video.dispatchEvent(new Event('error'));await rejected;assert.equal(camera.stream,null);
 });
 test('recorder: paired stop is idempotent; canvas tracks released, camera retained',async()=>{
  setup();const camera=stream(),canvas=stream();const recorder=new DualRecorder();recorder.start(camera,{captureStream:()=>canvas});
  const a=recorder.stop(),b=recorder.stop();assert.equal(a,b);const result=await a;
  assert.ok(result.originalBlob.size);assert.ok(result.skeletonBlob.size);assert.equal(canvas.track.stops,1);assert.equal(camera.track.stops,0);assert.deepEqual(FakeRecorder.instances.map(r=>r.stops),[1,1]);
 });
 test('recorder: error finalizes sibling and preserves available chunks',async()=>{
  setup();const canvas=stream();const recorder=new DualRecorder();recorder.oninterrupt=()=>recorder.stop();recorder.start(stream(),{captureStream:()=>canvas});
  const failed=FakeRecorder.instances[0];failed.onerror({error:Error('encoder failed')});const result=await recorder.stop();
  assert.ok(result.skeletonBlob.size);assert.match(result.errors.join(),/encoder failed/);assert.equal(canvas.track.stops,1);
 });
 test('recorder: missing stop event has bounded wait and keeps partial data',async t=>{
  setup();t.mock.timers.enable({apis:['setTimeout']});const canvas=stream();const recorder=new DualRecorder();recorder.start(stream(),{captureStream:()=>canvas});
  const broken=FakeRecorder.instances[0];broken.ondataavailable({data:new Blob(['partial'])});broken.stop=()=>{broken.state='inactive';};const resultPromise=recorder.stop();await flush();t.mock.timers.tick(4000);const result=await resultPromise;
  assert.ok(result.originalBlob.size);assert.match(result.errors.join(),/タイムアウト/);assert.equal(canvas.track.stops,1);
 });
 test('recorder: skeleton start failure does not lose original',async()=>{
  setup();const recorder=new DualRecorder();recorder.start(stream(),{captureStream(){throw Error('unsupported');}});const result=await recorder.stop();assert.ok(result.originalBlob.size);assert.equal(result.skeletonBlob,null);assert.match(result.errors.join(),/unsupported/);
 });
 test('pose initialization shares loading promise and permits retry',async()=>{
  const pose=new PoseDetector(),loading=deferred();let calls=0;pose.initialize=()=>{calls++;return loading.promise;};const a=pose.init(),b=pose.init();assert.equal(a,b);assert.equal(calls,1);
  const rejected=assert.rejects(a,/offline/);loading.reject(Error('offline'));await rejected;pose.initialize=async()=>{calls++;};await pose.init();assert.equal(calls,2);pose.lastVideoTime=7;pose.reset();assert.equal(pose.lastVideoTime,-1);
 });
 function app(){setup();const app=new MotionQuizApp();app.cameraReady=true;app.camera.stream=stream();app.message=()=>{};return app;}
 test('countdown cancels immediately, never starts recorder, and is reusable',async()=>{
  const a=app();let starts=0;a.recorder.start=()=>starts++;const capture=a.beginCapture();assert.equal(a.state,'countdown');const duplicate=a.beginCapture();a.cancelCountdown();await Promise.all([capture,duplicate]);assert.equal(starts,0);assert.equal(a.state,'idle');assert.equal(nodes.get('#recordButton').disabled,false);
  const again=a.beginCapture();a.cancelCountdown();await again;assert.equal(starts,0);
 });
 test('switching views or stopping camera invalidates countdown',async()=>{
  for(const action of [a=>a.showView('library'),a=>a.stopCamera()]){const a=app();a.refreshLibrary=async()=>{};let starts=0;a.recorder.start=()=>starts++;const capture=a.beginCapture();action(a);await capture;assert.equal(starts,0);assert.equal(a.cameraReady,false);}
 });
 test('three second countdown, finalizing guard and background recovery',async t=>{
  const a=app();t.mock.timers.enable({apis:['setTimeout']});a.renderer.render=()=>{};a.renderer.renderOriginalFrame=()=>new Node();let starts=0,stops=0;const result=deferred();a.recorder.start=()=>starts++;a.recorder.stop=()=>{stops++;return result.promise;};nodes.set('#durationSelect',Object.assign(new Node(),{value:'5'}));
  const capture=a.beginCapture();for(let i=0;i<3;i++){t.mock.timers.tick(1000);await flush();}await capture;assert.equal(a.state,'recording');assert.equal(starts,1);
  document.hidden=true;a.suspend();const final=a.finishCapture();assert.equal(a.state,'finalizing');assert.equal(a.cameraReady,false);result.resolve({originalBlob:new Blob(['video']),skeletonBlob:null,errors:['骨格動画 unavailable']});await final;
  assert.equal(stops,1);assert.equal(a.state,'review');assert.ok(a.pending.originalBlob.size);assert.equal(nodes.get('#reviewDialog')?.open,undefined);
  document.hidden=false;a.resume();assert.equal(nodes.get('#reviewDialog').open,true);assert.equal(a.cameraReady,false);assert.match(nodes.get('#reviewNotice').textContent,/骨格クイズとして再生できません/);
 });
 test('save rejects duplicate submits; failure retains inputs, data and stable id',async()=>{
  const a=app();a.state='review';a.pending={originalBlob:new Blob(['keep']),motionData:[]};const pending=a.pending;nodes.set('#titleInput',Object.assign(new Node(),{value:'title'}));nodes.set('#answerInput',Object.assign(new Node(),{value:'answer'}));const saving=deferred();let calls=0;const ids=[];a.store.put=work=>{calls++;ids.push(work.id);return saving.promise;};
  const first=a.savePending();await a.savePending();a.closeReview();a.showView('library');assert.equal(calls,1);assert.equal(a.view,'capture');saving.reject(Error('QuotaExceededError'));await first;assert.equal(a.pending,pending);assert.equal(nodes.get('#titleInput').value,'title');assert.equal(a.saving,false);
  a.store.put=async work=>ids.push(work.id);a.refreshLibrary=async()=>{};await a.savePending();assert.equal(ids[0],ids[1]);assert.equal(a.pending,null);assert.equal(a.view,'library');
 });
 test('IndexedDB put waits for commit and rejects transaction abort after request success',async()=>{
  const store=new MotionStore();const tx={objectStore:()=>({put:()=>({})})};store.db={transaction:()=>tx};const put=store.put({id:'x'});let done=false;put.then(()=>done=true,()=>{});await flush();assert.equal(done,false);tx.error=Error('quota');tx.onabort();await assert.rejects(put,/quota/);
  const second=store.put({id:'x'});await flush();tx.oncomplete();await second;
 });
 test('missing video blob clears previous playback URL',()=>{
  const a=app(),video=new Node();a.setBlobVideo(video,new Blob(['video']));assert.ok(video.src);a.setBlobVideo(video,null);assert.equal(video.src,undefined);assert.equal(video.dataset.objectUrl,undefined);
 });

test('camera: switching during pending play does not release the new stream',async()=>{
 setup();const first=stream(),second=stream(),playing=deferred();let calls=0;navigator.mediaDevices.getUserMedia=async()=>++calls===1?first:second;const video=new Node();let plays=0;video.play=()=>++plays===1?playing.promise:Promise.resolve();const camera=new CameraController(video);const old=camera.start();const rejection=assert.rejects(old,{name:'AbortError'});await flush();await camera.start('user');await rejection;playing.reject(Error('old play'));await flush();assert.equal(first.track.stops,1);assert.equal(second.track.stops,0);assert.equal(video.srcObject,second);camera.stop();
});
test('recorder: inactive error waits for final data or bounded fallback',async t=>{
 setup();t.mock.timers.enable({apis:['setTimeout']});const canvas=stream(),recorder=new DualRecorder();recorder.oninterrupt=()=>recorder.stop();recorder.start(stream(),{captureStream:()=>canvas});const failed=FakeRecorder.instances[0];failed.state='inactive';failed.onerror({error:Error('inactive encoder error')});const stop=recorder.stop();await flush();failed.ondataavailable({data:new Blob(['last chunk'])});t.mock.timers.tick(4000);const result=await stop;assert.ok(result.originalBlob.size);assert.ok(result.skeletonBlob.size);assert.equal(canvas.track.stops,1);assert.match(result.errors.join(),/inactive encoder/);
});

test('recorder: error cleans both recorders without an app callback',async()=>{
 setup();const canvas=stream(),recorder=new DualRecorder();recorder.start(stream(),{captureStream:()=>canvas});FakeRecorder.instances[0].onerror({error:Error('standalone failure')});await recorder.stop();assert.equal(canvas.track.stops,1);assert.equal(recorder.active,false);assert.equal(FakeRecorder.instances[1].state,'inactive');
});
test('camera: loadeddata timeout releases stream and allows retry',async t=>{
 setup();t.mock.timers.enable({apis:['setTimeout']});const first=stream();navigator.mediaDevices.getUserMedia=async()=>first;const video=new Node();video.readyState=0;const camera=new CameraController(video);const start=camera.start();const rejection=assert.rejects(start,/タイムアウト/);await flush();t.mock.timers.tick(15000);await rejection;assert.equal(first.track.stops,1);assert.equal(camera.stream,null);video.readyState=2;navigator.mediaDevices.getUserMedia=async()=>stream();await camera.start();camera.stop();
});
