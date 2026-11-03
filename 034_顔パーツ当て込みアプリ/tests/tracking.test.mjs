import test from 'node:test';
import assert from 'node:assert/strict';
import { landmarksToCrops, TrackingState, correctedCrop, displayCrop, DEFAULT_CORRECTION, TRACKING_CONFIG, angleDelta } from '../tracking-geometry.js';
import { FaceTracker, nextInterval, detectionDelay } from '../tracking.js';
import { createPart } from '../parts.js';
import { CompositeRenderer, PartRenderer } from '../renderer.js';
import { mockLandmarks } from './tracking-fixture.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const crops=options=>landmarksToCrops(mockLandmarks(options),640,480);

test('mock landmarks produce four separate original-frame crops with anatomical eye identity',()=>{
  const p=crops();assert.deepEqual(Object.keys(p),['mouth','leftEye','rightEye','nose']);
  for(const part of Object.values(p)){assert.ok(part.width>0&&part.height>0);near(part.angle,0);}
  near(p.mouth.x,.5);near(p.mouth.y,.67);assert.ok(p.leftEye.x>p.rightEye.x);
});
test('face translation changes every crop center without changing its size',()=>{
  const before=crops(),after=crops({dx:.04,dy:-.03});
  for(const type of Object.keys(before)){near(after[type].x-before[type].x,.04);near(after[type].y-before[type].y,-.03);near(after[type].width,before[type].width);near(after[type].height,before[type].height);}
});
test('face scale changes independent crop sizes proportionally',()=>{
  const a=crops(),b=crops({scale:1.25});for(const type of Object.keys(a)){near(b[type].width/a[type].width,1.25);near(b[type].height/a[type].height,1.25);}
});
test('roll uses physical pixels, including a non-square camera aspect',()=>{
  const a=crops({angle:Math.PI/6});for(const part of Object.values(a))near(part.angle,Math.PI/6);
  const b=landmarksToCrops(mockLandmarks({width:480,height:800,angle:-.4}),480,800);near(b.nose.angle,-.4);
});
test('mirroring changes visible eye positions and angle without swapping raw types',()=>{
  const a=crops({angle:.2});const raw=correctedCrop(a.leftEye,DEFAULT_CORRECTION,640,480);
  const reflected=displayCrop(raw,640,true);near(reflected.x,640-raw.x);near(reflected.angle,-.2);
  assert.ok(reflected.x<displayCrop(correctedCrop(a.rightEye,DEFAULT_CORRECTION,640,480),640,true).x);
  assert.deepEqual(displayCrop(raw,640,false),raw);
});
test('mouth opening grows the crop; closed eyes retain a useful minimum height',()=>{
  const closed=crops(),open=crops({mouthHeight:.22});assert.ok(open.mouth.height>closed.mouth.height*1.5);near(open.mouth.width,closed.mouth.width);
  assert.ok(closed.leftEye.height>0.04);
});
test('position, size and rotation smoothing converge with low latency',()=>{
  const state=new TrackingState();state.accept(mockLandmarks(),640,480,0);const first=structuredClone(state.crops);
  state.accept(mockLandmarks({dx:.05,scale:1.15,angle:.1}),640,480,16);
  assert.ok(state.crops.mouth.x>first.mouth.x&&state.crops.mouth.x<.55);
  assert.ok(state.crops.mouth.width>first.mouth.width);assert.ok(state.crops.mouth.angle>0&&state.crops.mouth.angle<.1);
  for(let t=32;t<=240;t+=16)state.accept(mockLandmarks({dx:.05,scale:1.15,angle:.1}),640,480,t);
  near(state.crops.mouth.x,crops({dx:.05,scale:1.15,angle:.1}).mouth.x,.002);
});
test('mouth height expands rapidly instead of lagging behind opening',()=>{
  const state=new TrackingState();state.accept(mockLandmarks(),640,480,0);state.accept(mockLandmarks({mouthHeight:.22}),640,480,16);
  assert.ok(state.crops.mouth.height/crops({mouthHeight:.22}).mouth.height>.9);
});
test('invalid or out-of-range landmarks are excluded without throwing',()=>{
  for(const invalid of [null,[],mockLandmarks().map(p=>({...p,x:NaN})),mockLandmarks().map(p=>({...p,y:2}))])assert.equal(landmarksToCrops(invalid,640,480),null);
});
test('excessive face angle and depth discrepancy reduce detection quality',()=>{
  assert.equal(crops({angle:Math.PI/2}),null);
  const points=mockLandmarks();for(const id of [263,249,390,373,374,380,381,382,362,466,388,387,386,385,384,398])points[id].z=1;
  assert.equal(landmarksToCrops(points,640,480),null);
});
test('sudden outlier jumps retain the previous accepted position',()=>{
  const state=new TrackingState();state.accept(mockLandmarks({scale:.6}),640,480,0);const previous=structuredClone(state.crops);
  assert.equal(state.accept(mockLandmarks({dx:.3,scale:.6}),640,480,100),false);assert.deepEqual(state.crops,previous);assert.equal(state.status,'lost');
});
test('face loss holds briefly, then hides all tracked crops',()=>{
  const state=new TrackingState();state.accept(mockLandmarks(),640,480,0);state.miss(100);assert.equal(state.status,'lost');assert.ok(state.visible(600));
  assert.equal(state.visible(651),null);assert.equal(state.status,'notFound');assert.deepEqual(state.resolve([createPart('mouth')],640,480,700),{});
});
test('face reacquisition after expiry resets smoothing and safely resumes',()=>{
  const state=new TrackingState();state.accept(mockLandmarks(),640,480,0);state.miss(800);
  assert.equal(state.accept(mockLandmarks({dx:.12}),640,480,1000),true);near(state.crops.mouth.x,.62);assert.equal(state.status,'tracking');
});
test('per-part relative correction changes only the selected crop and never the manual source',()=>{
  const state=new TrackingState();state.accept(mockLandmarks(),640,480,0);
  const parts=['mouth','leftEye'].map((t,i)=>createPart(t,i)),before=structuredClone(parts);
  const initial=state.resolve(parts,640,480,0);parts[0].tracking={offsetX:.2,offsetY:-.1,widthScale:1.3,heightScale:.8,rotation:20};
  const after=state.resolve(parts,640,480,0);assert.deepEqual(after.leftEye,initial.leftEye);
  near(after.mouth.width/initial.mouth.width,1.3);near(after.mouth.height/initial.mouth.height,.8);near(after.mouth.angle,20*Math.PI/180);
  assert.deepEqual(parts[0].sourceRect,before[0].sourceRect);assert.deepEqual(parts[0].targetRect,before[0].targetRect);
});
test('corrected rotated crop stays fully inside original frame bounds',()=>{
  const r=correctedCrop({x:.01,y:.99,width:.6,height:.4,angle:.6},{offsetX:-1.5,offsetY:1.5,widthScale:3,heightScale:3,rotation:40},640,480);
  const hx=(Math.abs(Math.cos(r.angle))*r.width+Math.abs(Math.sin(r.angle))*r.height)/2,hy=(Math.abs(Math.sin(r.angle))*r.width+Math.abs(Math.cos(r.angle))*r.height)/2;
  assert.ok(r.x>=hx-.001&&r.x+hx<=640.001&&r.y>=hy-.001&&r.y+hy<=480.001);
});
test('display zoom/pan cannot enter tracking coordinates',()=>{
  const a=crops(),b=crops();const before=correctedCrop(a.mouth,DEFAULT_CORRECTION,640,480);
  b.mouth.displayZoom=4;b.mouth.pan={x:100,y:-20};assert.deepEqual(correctedCrop(b.mouth,DEFAULT_CORRECTION,640,480),before);
});
test('angle smoothing uses the shortest arc at the wrap boundary',()=>{near(angleDelta(-Math.PI+.01,Math.PI-.01),.02);});
test('adaptive detection interval is bounded and falls back gradually after load',()=>{
  const heavy=nextInterval(100,250,100);assert.ok(heavy>100);assert.equal(nextInterval(500,1000,100),500);
  assert.ok(nextInterval(heavy,10,100)<heavy);assert.equal(nextInterval(100,1,200),200);
});
test('overloaded inference still leaves time to process stop/manual controls',()=>{
  assert.equal(detectionDelay(100,40,100),60);assert.equal(detectionDelay(500,1200,200),50);
});

const setupTracker=(factory,options={})=>{
  const video={readyState:2,videoWidth:640,videoHeight:480,currentTime:1};
  const tracker=new FaceTracker({video,factory,createCanvas:()=>({getContext:()=>({drawImage(){}})}),...options});return {tracker,video};
};
const flush=()=>new Promise(r=>setImmediate(r));
test('controller never overlaps inferences and discards results after stop',async()=>{
  let resolveDetect,calls=0,closed=0;
  const {tracker,video}=setupTracker(async()=>({backend:'worker',detect:()=>{calls++;return new Promise(r=>resolveDetect=r);},close:()=>closed++}));
  await tracker.start();await flush();video.currentTime=2;await flush();assert.equal(calls,1);tracker.stop();
  resolveDetect({landmarks:mockLandmarks(),ms:1});await flush();assert.equal(tracker.state.crops,null);assert.equal(closed,1);assert.equal(tracker.active,false);
});
test('late model initialization is released when camera/tracking is stopped',async()=>{
  let resolveModel,closed=0;const {tracker}=setupTracker(()=>new Promise(r=>resolveModel=r));
  const start=tracker.start();tracker.stop();resolveModel({close:()=>closed++});await start;assert.equal(closed,1);assert.equal(tracker.active,false);
});
test('model loading failure reports error and leaves manual fallback possible',async()=>{
  let errors=0;const {tracker}=setupTracker(async()=>{throw new Error('model unavailable');},{failed:()=>errors++});
  await tracker.start();assert.equal(errors,1);assert.equal(tracker.state.status,'error');assert.equal(tracker.active,false);assert.equal(tracker.state.crops,null);
});
test('camera restart begins a fresh tracking session without changing manual parts',async()=>{
  const parts=[createPart('mouth')],copy=structuredClone(parts);let started=0;
  const {tracker}=setupTracker(async()=>({backend:'worker',detect:()=>({landmarks:mockLandmarks(),ms:1}),close:()=>{}}));
  await tracker.start();await flush();started+=tracker.metrics.count;tracker.stop();await tracker.start();await flush();started+=tracker.metrics.count;tracker.stop();
  assert.equal(started,2);assert.deepEqual(parts,copy);
});
test('slow stale detection cannot resurrect expired face geometry',async()=>{
  let now=0;const {tracker}=setupTracker(async()=>({backend:'main',detect:()=>{now=1000;return {landmarks:mockLandmarks(),ms:1000};},close:()=>{}}),{now:()=>now});
  await tracker.start();await flush();assert.equal(tracker.state.crops,null);assert.equal(tracker.state.status,'notFound');tracker.stop();
});
test('in-flight results are discarded when camera dimensions change',async()=>{
  let resolveDetect;const {tracker,video}=setupTracker(async()=>({backend:'worker',detect:()=>new Promise(r=>resolveDetect=r),close:()=>{}}));
  await tracker.start();video.videoWidth=480;video.videoHeight=640;resolveDetect({landmarks:mockLandmarks(),ms:1});await flush();
  assert.equal(tracker.state.crops,null);assert.equal(tracker.state.status,'detecting');tracker.stop();
});
test('compositor hides missing tracked crops, retains z-order and leaves model data unchanged',()=>{
  const parts=[createPart('mouth'),createPart('leftEye',1)],copy=structuredClone(parts),calls=[];
  const renderer=new CompositeRenderer(()=>({draw:(...args)=>calls.push(args)}));
  const crop={x:300,y:200,width:80,height:40,angle:.2};
  renderer.draw({}, {}, parts, true, {leftEye:crop});assert.equal(calls.length,1);assert.deepEqual(calls[0][3].crop,crop);assert.equal(calls[0][5],false);
  renderer.draw({}, {}, parts, true, {});assert.equal(calls.length,1);assert.deepEqual(parts,copy);
});
test('tracked video sampling unrolls the raw crop, then mirrors within an isolated canvas state',()=>{
  const log=[],context={clearRect(){},save(){log.push(['save']);},restore(){log.push(['restore']);},translate:(...a)=>log.push(['translate',...a]),scale:(...a)=>log.push(['scale',...a]),rotate:a=>log.push(['rotate',a]),drawImage:(...a)=>log.push(['drawImage',...a])};
  const r=new PartRenderer(()=>({width:0,height:0,getContext:()=>context}));r.prepareMask=()=>{};
  const target={...context,canvas:{width:400,height:600}},video={readyState:2,videoWidth:640,videoHeight:480};
  r.draw(target,video,{x:50,y:60,width:20,height:10,rotation:30,shape:'oval',feather:20},{crop:{x:300,y:200,width:160,height:120,angle:.4}},true,false);
  assert.ok(log.some(a=>a[0]==='rotate'&&a[1]===-.4));assert.ok(log.some(a=>a[0]==='scale'&&a[1]===-1&&a[2]===1));
  assert.ok(log.some(a=>a[0]==='drawImage'&&a[1]===video&&a[2]===-300&&a[3]===-200));
  assert.equal(log.filter(a=>a[0]==='save').length,log.filter(a=>a[0]==='restore').length);
});
