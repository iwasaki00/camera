import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoRecording,recordingPlan,recordingTypes,recordingContainer,shareableRecording,RECORDING_LIMIT_BYTES} from '../recording.js';
const mp4=new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
const webm=new Uint8Array([0x1a,0x45,0xdf,0xa3,1,2,3,4]);
class Track extends EventTarget {constructor(kind){super();this.kind=kind;this.readyState='live';this.stops=0;this.requests=0;}stop(){this.stops++;this.readyState='ended';}requestFrame(){this.requests++;}}
class Stream {constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}}
class Recorder {
  static isTypeSupported(type){return type.startsWith('video/mp4')||type.startsWith('video/webm');}
  constructor(stream,options){this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';this.options=options;}
  start(){this.state='recording';queueMicrotask(()=>this.onstart?.());}
  chunk(){this.ondataavailable?.({data:new Blob([this.mimeType.includes('webm')?webm:mp4],{type:this.mimeType})});}
  stop(){this.beforeFlush?.();this.state='inactive';queueMicrotask(()=>{this.chunk();this.onstop?.();});}
}
function fixture(options={}) {
  let clock=1000,id=0;const intervals=new Map(),timeouts=new Map(),copies=[],states=[];
  const microphone=new Stream([new Track('audio')]);
  const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){copies.push(args);}}),captureStream:()=>new Stream([new Track('video')])};
  const source={width:400,height:600,captureStream(){}};
  const recording=new VideoRecording({Recorder,Stream,mediaDevices:{getUserMedia:async()=>microphone},createCanvas:()=>canvas,now:()=>clock,changed:r=>states.push(r.state),
    schedule:fn=>{intervals.set(++id,fn);return id;},unschedule:i=>intervals.delete(i),timeout:fn=>{timeouts.set(++id,fn);return id;},clearTimeout:i=>timeouts.delete(i),...options});
  return {recording,source,canvas,microphone,copies,states,intervals,timeouts,advance:ms=>{clock+=ms;},timer:()=>{for(const fn of [...intervals.values()])fn();}};
}
test('normal/low recording plans cap resolution and never upscale',()=>{
  assert.deepEqual([recordingPlan(1600,2400).width,recordingPlan(1600,2400).height,recordingPlan(1600,2400).fps],[480,720,24]);
  assert.equal(recordingPlan(2400,1600,'low').width,480);assert.equal(recordingPlan(320,240).width,320);assert.throws(()=>recordingPlan(0,4));assert.throws(()=>recordingPlan(4,4,'bad'));
});
test('MIME support negotiation prefers actual MP4, then supported WebM',()=>{
  assert.ok(recordingTypes(Recorder,true)[0].includes('mp4a'));assert.ok(recordingTypes(Recorder,false)[0].startsWith('video/mp4'));
  assert.deepEqual(recordingTypes({isTypeSupported:t=>t==='video/webm'}),['video/webm']);assert.deepEqual(recordingTypes(null),[]);
});
test('container signatures determine the extension without renaming WebM to MP4',async()=>{
  assert.equal((await recordingContainer(new Blob([webm],{type:'video/mp4'}))).extension,'webm');assert.equal((await recordingContainer(new Blob([mp4]))).extension,'mp4');await assert.rejects(recordingContainer(new Blob(['broken'])));
});
test('video-only start/stop produces a typed result and releases only recording tracks',async()=>{
  const f=fixture();assert.equal(await f.recording.start({source:f.source}),true);assert.equal(f.recording.state,'recording');const track=f.recording.session.track;
  f.advance(2500);const r=await f.recording.stop();assert.equal(r.extension,'mp4');assert.equal(r.hasAudio,false);assert.equal(r.elapsedMs,2500);assert.equal(track.stops,1);assert.equal(f.microphone.getTracks()[0].stops,0);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);
});
for(const seconds of [15,30,60])test(`actual elapsed clock automatically stops at ${seconds}s`,async()=>{
  const f=fixture();await f.recording.start({source:f.source,duration:seconds});f.advance(seconds*1000-1);f.timer();assert.equal(f.recording.state,'recording');f.advance(2);f.timer();await f.recording.session?.done;assert.equal(f.recording.state,'completed');assert.equal(f.recording.result.elapsedMs,seconds*1000+1);
});
test('duplicate start and duplicate stop share one recording',async()=>{
  const f=fixture();await f.recording.start({source:f.source});const s=f.recording.session;assert.equal(await f.recording.start({source:f.source}),false);assert.equal(f.recording.session,s);const a=f.recording.stop(),b=f.recording.stop();assert.equal(a,b);await a;assert.equal(f.recording.state,'completed');
});
test('elapsed time includes delayed native encoder start notification',async()=>{
  class Delayed extends Recorder{start(){this.state='recording';}}
  const f=fixture({Recorder:Delayed});await f.recording.start({source:f.source,duration:15});const before=f.recording.metrics.frames;f.advance(600);f.recording.pushFrame(f.source);assert.ok(f.recording.metrics.frames>before);f.advance(600);f.recording.session.recorder.onstart();assert.equal(f.recording.elapsedMs,1200);f.advance(13800);f.timer();await f.recording.session?.done;assert.equal(f.recording.result.elapsedMs,15000);
});
test('missing requestFrame uses a native fps stream and releases the rejected manual stream',async()=>{
  const f=fixture(),rates=[],tracks=[];f.canvas.captureStream=rate=>{rates.push(rate);const t=new Track('video');t.requestFrame=undefined;tracks.push(t);return new Stream([t]);};await f.recording.start({source:f.source});assert.deepEqual(rates,[0,24]);assert.equal(tracks[0].stops,1);await f.recording.stop();assert.equal(tracks[1].stops,1);
});
test('microphone is requested only when enabled, without a second camera',async()=>{
  const calls=[],f=fixture({mediaDevices:{getUserMedia:async c=>{calls.push(c);return f.microphone;}}});await f.recording.start({source:f.source});await f.recording.stop();assert.equal(calls.length,0);
  await f.recording.start({source:f.source,microphone:true});assert.equal(calls.length,1);assert.equal(calls[0].video,false);assert.ok(calls[0].audio);const r=await f.recording.stop();assert.equal(r.hasAudio,true);assert.equal(f.microphone.getTracks()[0].stops,1);
});
test('microphone denial offers silent retry without silently starting it',async()=>{
  const f=fixture({mediaDevices:{getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}}});assert.equal(await f.recording.start({source:f.source,microphone:true}),false);assert.equal(f.recording.state,'error');assert.equal(f.recording.canRetrySilent,true);assert.equal(f.recording.session,null);
  assert.equal(await f.recording.start({source:f.source,microphone:false}),true);assert.equal((await f.recording.stop()).hasAudio,false);
});
test('canceling a pending permission request stops a late microphone and cannot replace a new session',async()=>{
  let resolve;const f=fixture({mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});const pending=f.recording.start({source:f.source,microphone:true});await f.recording.stop();assert.equal(f.recording.state,'idle');await f.recording.start({source:f.source});const s=f.recording.session;resolve(f.microphone);assert.equal(await pending,false);assert.equal(f.microphone.getTracks()[0].stops,1);assert.equal(f.recording.session,s);await f.recording.stop();
});
test('tracks remain live until the final dataavailable and stop events',async()=>{
  const f=fixture();await f.recording.start({source:f.source,microphone:true});const s=f.recording.session;s.recorder.beforeFlush=()=>{assert.equal(s.track.stops,0);assert.equal(f.microphone.getTracks()[0].stops,0);};await f.recording.stop();assert.equal(f.microphone.getTracks()[0].stops,1);
});
test('24fps transfer uses accumulated cadence instead of falling to 15fps on a 30fps source',async()=>{
  const f=fixture();await f.recording.start({source:f.source});const before=f.recording.metrics.frames;for(let i=1;i<=30;i++){f.advance(1000/30);f.recording.pushFrame(f.source);}const count=f.recording.metrics.frames-before;assert.ok(count>=23&&count<=25,count);await f.recording.stop();
});
test('recording canvas copy preserves aspect with padding and performs no scene rendering',async()=>{
  const f=fixture();f.source.width=401;f.source.height=601;await f.recording.start({source:f.source});const [source,x,y,w,h]=f.copies.at(-1);assert.equal(source,f.source);assert.ok(Math.abs(w/h-401/601)<1e-12);assert.ok(x>=0&&y>=0);await f.recording.stop();
});
test('a revoked microphone safely finalizes the current recording',async()=>{
  const f=fixture();await f.recording.start({source:f.source,microphone:true});const done=f.recording.session.done;f.microphone.getTracks()[0].dispatchEvent(new Event('ended'));await done;assert.equal(f.recording.state,'completed');assert.match(f.recording.reason,/マイク/);
});
test('unsupported MediaRecorder leaves the rest of the app independent',async()=>{const f=fixture({Recorder:null});assert.equal(await f.recording.start({source:f.source}),false);assert.equal(f.recording.state,'error');assert.match(f.recording.error,/対応/);});
test('unsupported captureStream and invalid duration fail explicitly',async()=>{
  const f=fixture();assert.equal(await f.recording.start({source:{width:20,height:20}}),false);assert.equal(await f.recording.start({source:f.source,duration:120}),false);
});
test('constructor failure falls back to a genuinely different supported container',async()=>{
  class Fallback extends Recorder {constructor(s,o){if(o.mimeType.includes('mp4'))throw new Error('no mp4');super(s,o);}}
  const f=fixture({Recorder:Fallback});await f.recording.start({source:f.source});const r=await f.recording.stop();assert.equal(r.extension,'webm');assert.match(r.mime,/webm/);
});
test('all synchronous encoding failures release microphone/canvas tracks',async()=>{
  class Broken extends Recorder {start(){throw new Error('encoder unavailable');}}
  const f=fixture({Recorder:Broken});assert.equal(await f.recording.start({source:f.source,microphone:true}),false);assert.equal(f.recording.state,'error');assert.equal(f.microphone.getTracks()[0].stops,1);
});
test('asynchronous encoder errors retain final chunks, with an explicit partial-file warning',async()=>{
  const f=fixture();await f.recording.start({source:f.source});const s=f.recording.session;s.recorder.state='inactive';s.recorder.onerror({error:new Error('encoder failed')});assert.equal(s.chunks.length,0);s.recorder.chunk();s.recorder.onstop();const r=await s.done;assert.equal(r.partial,true);assert.match(f.recording.error,/encoder failed/);
});
test('empty output and unknown file signatures are rejected',async()=>{
  class Empty extends Recorder {chunk(){}}
  const f=fixture({Recorder:Empty});await f.recording.start({source:f.source});assert.equal(await f.recording.stop(),null);assert.equal(f.recording.state,'error');
  class Invalid extends Recorder {chunk(){this.ondataavailable?.({data:new Blob(['invalid'])});}}
  const g=fixture({Recorder:Invalid});await g.recording.start({source:g.source});assert.equal(await g.recording.stop(),null);assert.match(g.recording.error,/形式/);
});
test('a broken stop event has a bounded cleanup path',async()=>{
  class Stalled extends Recorder {stop(){this.state='inactive';this.chunk();}}
  const f=fixture({Recorder:Stalled});await f.recording.start({source:f.source});const done=f.recording.stop();for(const fn of f.timeouts.values())fn();const r=await done;assert.equal(r.partial,true);assert.equal(f.recording.session,null);
});
test('chunk memory bound stops encoding and clearResult releases the retained blob',async()=>{
  const f=fixture();await f.recording.start({source:f.source});const s=f.recording.session;s.bytes=RECORDING_LIMIT_BYTES-1;s.recorder.chunk();await s.done;assert.match(f.recording.reason,/64MB/);assert.equal(f.recording.clearResult(),true);assert.equal(f.recording.result,null);
});
test('sharing checks actual file support and handles exceptions safely',()=>{
  const r={blob:new Blob([mp4],{type:'video/mp4'}),filename:'record.mp4',mime:'video/mp4'};
  assert.equal(shareableRecording(r,{share(){},canShare(){return false;}}),null);assert.equal(shareableRecording(r,{share(){},canShare(){throw new Error();}}),null);
  assert.equal(shareableRecording(r,{share(){},canShare:({files})=>files[0].name==='record.mp4'}).name,'record.mp4');
});
