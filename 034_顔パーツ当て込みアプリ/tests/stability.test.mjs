import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackingState, TRACKING_CONFIG } from '../tracking-geometry.js';
import { FaceTracker, WorkerDetector, nextInterval } from '../tracking.js';
import { mockLandmarks } from './tracking-fixture.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
const setup=factory=>new FaceTracker({video:{readyState:2,videoWidth:640,videoHeight:480,currentTime:1},factory,createCanvas:()=>({getContext:()=>({drawImage(){}})})});
test('sub-pixel position jitter stays within a deadband instead of moving every detection',()=>{
  const s=new TrackingState();s.accept(mockLandmarks(),640,480,0);const x=s.crops.mouth.x;
  for(let t=100;t<=1000;t+=100)s.accept(mockLandmarks({dx:t%200?.0004:-.0004}),640,480,t);assert.equal(s.crops.mouth.x,x);
});
test('smoothing at 5 and 20 detections/sec has comparable response at equal elapsed time',()=>{
  const response=step=>{const s=new TrackingState();s.accept(mockLandmarks(),640,480,0);for(let t=step;t<=400;t+=step)s.accept(mockLandmarks({dx:.05,scale:1.2}),640,480,t);return s.crops;};
  const a=response(50),b=response(200);assert.ok(Math.abs(a.nose.x-b.nose.x)<.001);assert.ok(Math.abs(a.nose.width-b.nose.width)<.002);
});
test('small steady movement escapes the deadband without freezing the face',()=>{
  const s=new TrackingState();s.accept(mockLandmarks(),640,480,0);for(let t=100;t<=1000;t+=100)s.accept(mockLandmarks({dx:t*.00001}),640,480,t);assert.ok(s.crops.mouth.x>.508);
});
test('distant reacquisition is hidden until two consistent fresh results arrive',()=>{
  const s=new TrackingState();s.accept(mockLandmarks({scale:.6}),640,480,0);
  assert.equal(s.accept(mockLandmarks({scale:.6,dx:.3}),640,480,1000),false);assert.equal(s.visible(1000),null);assert.equal(s.status,'detecting');
  assert.equal(s.accept(mockLandmarks({scale:.6,dx:.301}),640,480,1100),true);assert.ok(s.visible(1100));assert.ok(s.crops.nose.x>.79);
});
test('face expiry remains 650ms even when detection cadence is low',()=>{
  const s=new TrackingState();s.accept(mockLandmarks(),640,480,0);assert.ok(s.visible(650));assert.equal(s.visible(651),null);
});
test('a stalled distant-reacquisition confirmation expires into face loss',()=>{
  const s=new TrackingState();s.accept(mockLandmarks({scale:.6}),640,480,0);s.accept(mockLandmarks({scale:.6,dx:.3}),640,480,1000);
  assert.equal(s.status,'detecting');assert.equal(s.visible(1651),null);assert.equal(s.status,'notFound');assert.equal(s.pending,null);
});
test('rotation remains continuous on the shortest arc',()=>{
  const s=new TrackingState({...TRACKING_CONFIG,maxRoll:180});s.accept(mockLandmarks({angle:Math.PI-.05,scale:.4}),640,480,0);
  s.accept(mockLandmarks({angle:-Math.PI+.05,scale:.4}),640,480,100);assert.ok(s.crops.mouth.angle>Math.PI-.05);assert.ok(s.crops.mouth.angle<Math.PI+.05);
});
test('load rises quickly and recovers gradually within the original rate bounds',()=>{
  const heavy=nextInterval(100,250,100);assert.ok(heavy>=300);const light=nextInterval(heavy,10,100);assert.ok(light<heavy&&light>100);
  let current=heavy;for(let i=0;i<50;i++)current=nextInterval(current,10,100);assert.ok(current<101);
});
test('duplicate start calls share model initialization and keep a single session',async()=>{
  let loads=0,resolve;const tracker=setup(()=>{loads++;return new Promise(r=>resolve=r);});
  const a=tracker.start(),b=tracker.start();assert.equal(a,b);await flush();assert.equal(loads,1);assert.equal(tracker.state.status,'initializing');
  resolve({backend:'worker',detect:()=>({landmarks:mockLandmarks(),ms:1}),close(){}});await a;await flush();assert.equal(tracker.state.status,'tracking');tracker.stop();
});
test('restart waits for a canceled late model to be released before initializing another',async()=>{
  let loads=0,release,closed=0;const tracker=setup(()=>{loads++;if(loads===1)return new Promise(r=>release=r);return {backend:'worker',detect:()=>({landmarks:mockLandmarks(),ms:1}),close(){}};});
  const first=tracker.start();await flush();tracker.stop();const second=tracker.start();await flush();assert.equal(loads,1);
  release({close:()=>closed++});await first;await second;assert.equal(closed,1);assert.equal(loads,2);tracker.stop();
});
test('stopping before queued initialization starts creates no model',async()=>{
  let loads=0;const tracker=setup(()=>{loads++;});const p=tracker.start();tracker.stop();await p;assert.equal(loads,0);
});
test('Worker error rejects pending work, terminates and rejects later calls',async()=>{
  let worker;class FakeWorker {constructor(){worker=this;}postMessage(){}terminate(){this.stopped=true;}}
  const detector=new WorkerDetector(FakeWorker),pending=detector.request('detect');worker.onerror({preventDefault(){}});await assert.rejects(pending);assert.equal(worker.stopped,true);await assert.rejects(detector.request('detect'));
});
test('unchanged inference dimensions do not reset the canvas again',async()=>{
  let widthWrites=0,heightWrites=0,width=0,height=0;const video={readyState:2,videoWidth:640,videoHeight:480,currentTime:1};
  const canvas={get width(){return width;},set width(v){width=v;widthWrites++;},get height(){return height;},set height(v){height=v;heightWrites++;},getContext:()=>({drawImage(){}})};
  const tracker=new FaceTracker({video,createCanvas:()=>canvas,factory:async()=>({backend:'worker',detect:()=>({landmarks:mockLandmarks(),ms:1}),close(){}})});
  await tracker.start();await flush();clearTimeout(tracker.timer);video.currentTime=2;await tracker.loop(tracker.generation);tracker.stop();assert.equal(widthWrites,1);assert.equal(heightWrites,1);
});
test('expensive preview drawing reduces inference frequency to protect drawing',async()=>{
  const tracker=setup(async()=>({backend:'worker',detect:()=>({landmarks:mockLandmarks(),ms:1}),close(){}}));
  for(let i=0;i<50;i++)tracker.observeDraw(30);await tracker.start();await flush();assert.ok(tracker.metrics.interval>=300);tracker.stop();
});
