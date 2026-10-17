import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
const read=p=>fs.readFile(new URL("../"+p,import.meta.url),"utf8");
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const stream=()=>({stopped:0,getTracks(){return [{stop:()=>this.stopped++}];}});
class Video extends EventTarget {readyState=2;play(){return Promise.resolve();}pause(){}}
async function cameraFixture(getUserMedia){
 const c=vm.createContext({navigator:{mediaDevices:{getUserMedia}},AbortController,DOMException,setTimeout,clearTimeout});
 vm.runInContext((await read("js/camera.js")).replace("export class","class")+";globalThis.CameraController=CameraController;",c);
 const video=new Video();return {video,camera:new c.CameraController(video)};
}
test("camera startup shares requests, stops late streams, serializes retry",async()=>{
 const gate=deferred(),old=stream(),fresh=stream();let calls=0;
 const {camera,video}=await cameraFixture(()=>++calls===1?gate.promise:Promise.resolve(fresh));
 const p=camera.start();assert.equal(camera.start(),p);await tick();assert.equal(calls,1);
 camera.stop();await assert.rejects(p,{name:"AbortError"});
 const retry=camera.start();await tick();assert.equal(calls,1);
 gate.resolve(old);await retry;assert.equal(old.stopped,1);assert.equal(video.srcObject,fresh);
 camera.stop();assert.equal(fresh.stopped,1);
});
test("play failure releases stream and permits retry",async()=>{
 const streams=[stream(),stream()];let calls=0;
 const {camera,video}=await cameraFixture(async()=>streams[calls++]);
 video.play=async()=>{throw new Error("play");};
 await assert.rejects(camera.start(),/再生/);assert.equal(streams[0].stopped,1);assert.equal(video.srcObject,null);
 video.play=async()=>{};await camera.start();camera.stop();assert.equal(streams[1].stopped,1);
});
test("loadeddata wait stops immediately and video errors release stream",async()=>{
 const s=stream(),{camera,video}=await cameraFixture(async()=>s);video.readyState=0;
 const p=camera.start();await tick();camera.stop();await assert.rejects(p,{name:"AbortError"});assert.equal(s.stopped,1);
 const p2=camera.start();await tick();video.dispatchEvent(new Event("error"));await assert.rejects(p2,/読み込/);
 assert.equal(video.srcObject,null);
});
test("getUserMedia failure can retry; unsupported API is reported",async()=>{
 let calls=0;const {camera}=await cameraFixture(async()=>{if(++calls===1)throw new Error("denied");return stream();});
 await assert.rejects(camera.start(),/denied/);await camera.start();camera.stop();
 const f=await cameraFixture(undefined);await assert.rejects(f.camera.start(),/カメラAPI/);
});
async function appFixture(){
 const nodes=new Map(),listeners={},frames=new Map(),models=[];let id=0,starts=0,plays=0;
 const node=key=>{
  if(!nodes.has(key))nodes.set(key,{textContent:"",hidden:key==="#debugPanel",value:"face",children:[],open:false,
   classList:{add(){},remove(){},toggle(){}},addEventListener(t,fn){this[t]=fn;},replaceChildren(){},
   setAttribute(){},querySelector(){return node("#child");},getContext(){return {clearRect(){}};},close(){this.open=false;}});
  return nodes.get(key);
 };
 class Model {constructor(){this.gate=deferred();this.closed=0;models.push(this);}init(){return this.gate.promise;}close(){this.closed++;}}
 const c=vm.createContext({console:{error(){}},performance:{now:()=>100},navigator:{},
  document:{hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener:(t,f)=>listeners[t]=f},
  window:{addEventListener:(t,f)=>listeners[t]=f},
  requestAnimationFrame:f=>{frames.set(++id,f);return id;},cancelAnimationFrame:i=>frames.delete(i),
  CameraController:class{async start(){starts++;}stop(){}},
  AudioEngine:class{async unlock(){}setVolume(){}setEnabled(v){this.enabled=v;}play(){if(this.enabled)plays++;}},
  ActionDetector:class{reset(){}setCooldown(){}},FaceMode:Model,BodyMode:Model,FACE_THRESHOLDS:{},BODY_THRESHOLDS:{},
  SOUND_LABELS:{},ACTIONS:{face:[],body:[]},PRESETS:{},SOUND_OPTIONS:[],loadSettings:()=>({volume:80}),
  saveSettings(){},createDefaultSensitivities(){},scaledThreshold:x=>x
 });
 const source=(await read("app.js")).replace(/^import .*;\r?\n/gm,"").replace(/renderSettings\(\);\s*$/,"");
 vm.runInContext(source,c);
 vm.runInContext("renderSettings=()=>{};renderAssignments=()=>{};renderGestureStrip=()=>{};globalThis.api={startApp,stopApp,switchMode,triggerSound,audio,get running(){return running;}};",c);
 return {c,api:c.api,node,frames,models,listeners,starts:()=>starts,plays:()=>plays};
}
test("first RAF is cancelled; stale frames cannot reschedule on restart",async()=>{
 const f=await appFixture(),p=f.api.startApp();await f.api.startApp();await tick();
 assert.equal(f.starts(),1);assert.equal(f.frames.size,1);const stale=[...f.frames.values()][0];
 f.api.stopApp();assert.equal(f.frames.size,0);f.models[0].gate.resolve();await p;assert.equal(f.models[0].closed,1);
 const p2=f.api.startApp();await tick();f.models[1].gate.resolve();await p2;stale(200);assert.equal(f.frames.size,1);f.api.stopApp();
});
test("obsolete model results close and current failures allow retry",async()=>{
 const f=await appFixture(),p=f.api.startApp();await tick();const body=f.api.switchMode("body");await tick();
 f.models[0].gate.reject(new Error("stale"));await p;assert.equal(f.models[0].closed,1);assert.match(f.node("#trackingText").textContent,/準備/);
 f.models[1].gate.reject(new Error("network"));await body;assert.match(f.node("#trackingText").textContent,/Pose Landmarker/);
 const retry=f.api.switchMode("body");await tick();f.models[2].gate.resolve();await retry;
 const face=f.api.switchMode("face");await tick();assert.equal(f.models[2].closed,1);
 f.api.stopApp();f.models[3].gate.resolve();await face;assert.equal(f.models[3].closed,1);
});
test("visibility/pagehide cancel startup without automatic restart or new sounds",async()=>{
 const f=await appFixture(),gate=deferred();f.api.audio.unlock=()=>gate.promise;
 const p=f.api.startApp();f.c.document.hidden=true;f.listeners.visibilitychange();gate.resolve();await p;
 assert.equal(f.starts(),0);assert.equal(f.frames.size,0);
 f.c.document.hidden=false;f.listeners.visibilitychange();assert.equal(f.starts(),0);
 f.listeners.pagehide();f.api.triggerSound("test");assert.equal(f.plays(),0);assert.equal(f.node("#startButton").disabled,false);
});
test("startup failures restore the start button",async()=>{
 const f=await appFixture();
 vm.runInContext('camera.start=async()=>{throw Object.assign(new Error("denied"),{name:"NotAllowedError"});}',f.c);
 await f.api.startApp();assert.equal(f.api.running,false);assert.equal(f.node("#startButton").disabled,false);
 assert.match(f.node("#startStatus").textContent,/許可/);assert.equal(f.frames.size,0);
});
test("MediaPipe pending promises share, failures retry and successes cache",async()=>{
 let imports=0,filesets=0,moduleGate=deferred(),filesetGate=deferred();
 const module={FilesetResolver:{forVisionTasks:()=>{filesets++;return filesetGate.promise;}}};
 const c=vm.createContext({load:()=>{imports++;return moduleGate.promise;}});
 const source=(await read("js/vision.js")).replace(/export /g,"").replace(/import\(`https:[^\n]+?\)/,"load()");
 vm.runInContext(source+";globalThis.api={getVision,getFileset};",c);
 const a=c.api.getFileset(),b=c.api.getFileset();await tick();assert.equal(imports,1);
 moduleGate.reject(new Error("module"));await Promise.all([assert.rejects(a),assert.rejects(b)]);
 moduleGate=deferred();const d=c.api.getFileset();moduleGate.resolve(module);await tick();assert.equal(filesets,1);
 filesetGate.reject(new Error("wasm"));await assert.rejects(d);
 filesetGate=deferred();const e=c.api.getFileset();await tick();filesetGate.resolve({ready:true});const result=await e;
 assert.equal(await c.api.getFileset(),result);assert.equal(imports,2);assert.equal(filesets,2);
});
test("DEBUG defaults OFF, internal back button remains, zoom stays accessible",async()=>{
 const html=await read("index.html");
 assert.match(html,/aria-pressed="false">DEBUG <b>OFF/);assert.match(html,/id="debugPanel"[^>]* hidden/);
 assert.match(html,/id="backButton"/);assert.doesNotMatch(html,/user-scalable=no/);assert.doesNotMatch(html,/<a\b[^>]*href=/);
});
test("audio blocks new notes while stopped and resumes interrupted/closed contexts",async()=>{
 let created=0,resumed=0,started=0;
 class Context {
  constructor(){created++;this.state="suspended";this.sampleRate=48000;this.destination={};}
  async resume(){resumed++;this.state="running";}
  createGain(){return {gain:{value:0},connect(){}};}
  createBuffer(){return {};}
  createBufferSource(){return {connect(){},start(){started++;}};}
 }
 const c=vm.createContext({window:{AudioContext:Context},fetch:async()=>({ok:false})});
 vm.runInContext((await read("js/audio.js")).replace(/export /g,"")+";globalThis.AudioEngine=AudioEngine;",c);
 const audio=new c.AudioEngine();await audio.unlock();let notes=0;audio.playSynth=()=>notes++;
 audio.play("kick");assert.equal(notes,0);audio.setEnabled(true);audio.play("kick");assert.equal(notes,1);
 audio.setEnabled(false);audio.play("kick");assert.equal(notes,1);
 audio.context.state="interrupted";await audio.unlock();audio.setEnabled(true);audio.play("kick");assert.equal(notes,2);
 assert.equal(created,1);assert.equal(resumed,2);
 audio.context.state="closed";await audio.unlock();assert.equal(created,2);assert.equal(started,3);
});
test("audio unsupported and resume failures reject for the app to report",async()=>{
 const c=vm.createContext({window:{}});
 vm.runInContext((await read("js/audio.js")).replace(/export /g,"")+";globalThis.AudioEngine=AudioEngine;",c);
 await assert.rejects(new c.AudioEngine().unlock(),/Web Audio API/);
 c.window.AudioContext=class{constructor(){this.state="suspended";}createGain(){return {gain:{},connect(){}};}async resume(){throw new Error("resume failed");}};
 await assert.rejects(new c.AudioEngine().unlock(),/resume failed/);
});
test("stopped play promise cannot release a restarted camera",async()=>{
 const old=stream(),fresh=stream(),gate=deferred();let calls=0;
 const {camera,video}=await cameraFixture(async()=>++calls===1?old:fresh);
 video.play=()=>gate.promise;const p=camera.start();await tick();camera.stop();
 await assert.rejects(p,{name:"AbortError"});assert.equal(old.stopped,1);
 video.play=async()=>{};await camera.start();gate.reject(new Error("old play failed"));await tick();
 assert.equal(video.srcObject,fresh);assert.equal(fresh.stopped,0);camera.stop();
});
test("DEBUG toggle remains available in both directions",async()=>{
 const f=await appFixture();const button=f.node("#debugToggle"),panel=f.node("#debugPanel");
 button.click();assert.equal(panel.hidden,false);assert.equal(f.node("#child").textContent,"ON");
 button.click();assert.equal(panel.hidden,true);assert.equal(f.node("#child").textContent,"OFF");
});
