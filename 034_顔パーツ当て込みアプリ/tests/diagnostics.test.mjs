import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostics, diagnosticText, copyDiagnostic } from '../diagnostics.js';
test('diagnostics default OFF collects no samples',()=>{
  const m=new Diagnostics();m.frame(10);m.detection({completed:20,ms:3,accepted:true});assert.deepEqual(m.frames,[]);assert.deepEqual(m.results,[]);
});
test('30 actual renders per second measure 30 fps in a partial window',()=>{
  const m=new Diagnostics();m.enable(true,0);for(let i=1;i<=30;i++)m.frame(i*1000/30);assert.equal(m.snapshot(1000).drawFps,30);
});
test('rolling window excludes older renders and uses exactly 5 seconds',()=>{
  const m=new Diagnostics();m.enable(true,0);for(let i=1;i<=180;i++)m.frame(i*1000/30);const s=m.snapshot(6000);assert.equal(s.drawFps,30);assert.equal(s.elapsedMs,5000);assert.equal(m.frames.length,150);
});
test('inference counts, duration last/mean/max and adopted success rate use completion time',()=>{
  const m=new Diagnostics();m.enable(true,0);for(const [i,ms]of [10,30,20].entries())m.detection({capture:100+i*200,completed:200+i*200,ms,accepted:i!==1});
  const s=m.snapshot(1000);assert.equal(s.detectionFps,3);assert.equal(s.inferenceLastMs,20);assert.equal(s.inferenceAverageMs,20);assert.equal(s.inferenceMaxMs,30);assert.equal(s.successRate,2/3);
});
test('result age uses the original input timestamp and remains available without a new result',()=>{
  const m=new Diagnostics();m.enable(true,0);assert.equal(m.snapshot(1000,{lastCapture:250}).resultAgeMs,750);assert.equal(m.snapshot(1500,{lastCapture:250}).resultAgeMs,1250);
});
test('absent inference samples are unknown rather than invented zero times',()=>{
  const m=new Diagnostics();m.enable(true,0);const s=m.snapshot(500);assert.equal(s.inferenceAverageMs,null);assert.equal(s.inferenceMaxMs,null);assert.equal(s.successRate,null);assert.equal(s.resultAgeMs,null);
});
test('failed inference counts as a failed completion but not as a timing sample',()=>{
  const m=new Diagnostics();m.enable(true,0);m.detection({capture:100,completed:300,ms:null,accepted:false});const s=m.snapshot(1000);assert.equal(s.count,1);assert.equal(s.successRate,0);assert.equal(s.inferenceAverageMs,null);
});
test('closing clears samples and reopening starts a new window',()=>{
  const m=new Diagnostics();m.enable(true,0);m.frame(100);m.enable(false,200);m.frame(300);assert.equal(m.frames.length,0);m.enable(true,1000);assert.equal(m.snapshot(1000).elapsedMs,0);
});
test('old inference maximum and successes expire from the window',()=>{
  const m=new Diagnostics();m.enable(true,0);m.detection({capture:0,completed:50,ms:90,accepted:true});m.detection({capture:5800,completed:5900,ms:10,accepted:false});const s=m.snapshot(6000);assert.equal(s.count,1);assert.equal(s.inferenceMaxMs,10);assert.equal(s.successRate,0);
});
test('diagnostic copy includes explicit window, state, worker and both resolutions',()=>{
  const m=new Diagnostics();m.enable(true,0);const text=diagnosticText(m.snapshot(1000,{status:'tracking',backend:'worker',videoWidth:1280,videoHeight:720,inputWidth:480,inputHeight:270,interval:100}));
  for(const value of ['5秒','tracking','worker','1280×720','480×270'])assert.ok(text.includes(value));assert.equal(text.includes('landmark'),false);
});
test('clipboard copies the exact text and gracefully reports denied/unavailable access',async()=>{
  let copied;assert.equal(await copyDiagnostic('report',{writeText:async t=>copied=t}),true);assert.equal(copied,'report');assert.equal(await copyDiagnostic('report',{}),false);assert.equal(await copyDiagnostic('report',{writeText:async()=>{throw Error('denied');}}),false);
});
