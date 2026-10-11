import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../src/game/blinkDropGame.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;
const game = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
assert.deepEqual(game.BLINK_DROP_PARTS,['rightEye','leftEye','nose','mouth']);
const countdown=game.startBlinkDropCountdown(1000);
assert.deepEqual([1000,2000,3000,4000].map(t=>game.countdownLabel(countdown,t)),['3','2','1','START!']);
const stopped=game.pauseBlinkDrop(countdown,2400),continued=game.resumeBlinkDrop(stopped,10000);
assert.equal(game.countdownLabel(stopped,9000),'2');assert.equal(game.countdownLabel(continued,10000),'2');
assert.equal(game.countdownLabel(game.startBlinkDropCountdown(20000),20000),'3');

let session=game.startBlinkDropCountdown();
assert.equal(session.phase,'countdown');
session=game.beginBlinkDrop(session,1000);assert.equal(session.phase,'playing');
const falling=game.fallingOffsetAt(session,1600);assert(falling>-6&&falling<2);
session=game.catchBlinkDropPart(session,1600);assert.equal(session.phase,'fixing');assert.equal(session.fixedOffsets[0],falling);
session=game.advanceBlinkDrop(session,2050);assert.equal(session.phase,'playing');assert.equal(session.currentIndex,1);
const paused=game.pauseBlinkDrop(session,2200), frozen=game.fallingOffsetAt(paused,9999);
assert.equal(paused.phase,'paused');assert.equal(frozen,game.fallingOffsetAt(paused,2200));
session=game.resumeBlinkDrop(paused,3200);assert.equal(session.phase,'playing');assert.equal(game.fallingOffsetAt(session,3200),frozen);
for(let index=1;index<4;index++){session=game.catchBlinkDropPart(session,3300+index*100);session=game.advanceBlinkDrop(session,3350+index*100);}
assert.equal(session.phase,'completed');assert.equal(session.fixedOffsets.filter(v=>v!==null).length,4);
const score=game.blinkDropScore(session);assert(score.accuracy>=0&&score.accuracy<=100&&score.funny>=0&&score.funny<=100&&score.title);

const points=()=>Array.from({length:478},()=>({x:.5,y:.5}));
function setEyes(landmarks,leftGap,rightGap){
 const set=(outer,inner,pairs,cx,gap)=>{landmarks[outer]={x:cx-.05,y:.4};landmarks[inner]={x:cx+.05,y:.4};for(const [top,bottom,dx] of pairs){landmarks[top]={x:cx+dx,y:.4-gap/2};landmarks[bottom]={x:cx+dx,y:.4+gap/2};}};
 set(362,263,[[386,374,-.015],[385,380,.015]],.65,leftGap);
 set(33,133,[[159,145,-.015],[158,153,.015]],.35,rightGap);
}
const detector=new game.BlinkDetector(),landmarks=points();setEyes(landmarks,.03,.03);
for(let i=0;i<14;i++)assert(!detector.update(landmarks,i*40),'calibrate open eyes');
assert(detector.ready);assert(detector.debug.closeLeft<detector.debug.reopenLeft);
setEyes(landmarks,.005,.005);assert(detector.update(landmarks,560),'single short bilateral blink');
for(let t=600;t<=1400;t+=40)assert(!detector.update(landmarks,t),'no repeat while closed');
setEyes(landmarks,.03,.03);detector.update(landmarks,1440);assert(!detector.ready);detector.update(landmarks,1480);assert(detector.ready);
setEyes(landmarks,.005,.03);assert(!detector.update(landmarks,1520),'one eye alone cannot catch');
setEyes(landmarks,.005,.005);assert(detector.update(landmarks,1560));assert.equal(detector.debug.count,2);
detector.reset();assert(!detector.update(undefined,1600));assert.equal(detector.debug.count,0);assert(!detector.debug.calibrated);
for(let i=0;i<14;i++){setEyes(landmarks,.016+(i%3-1)*.0005,.021+(i%2)*.0004);assert(!detector.update(landmarks,i*40));}
assert(detector.ready);assert(detector.debug.baselineLeft<detector.debug.baselineRight);
setEyes(landmarks,.010,.013);assert(!detector.update(landmarks,560),'moderate closing needs confirmation');assert(detector.update(landmarks,600),'glasses-like shallow closure detected');
setEyes(landmarks,.016,.021);detector.update(landmarks,1160);detector.update(landmarks,1200);
landmarks[386]={x:NaN,y:.4};assert(!detector.update(landmarks,1240));assert(!detector.ready);
setEyes(landmarks,.003,.003);assert(!detector.update(landmarks,1280),'lost tracking cannot trigger a close');
setEyes(landmarks,.016,.021);detector.update(landmarks,1320);detector.update(landmarks,1360);
detector.requireReopen();assert(!detector.ready);
setEyes(landmarks,.05,.021);assert(!detector.update(landmarks,1400),'unstable unilateral spike ignored');
detector.reset();setEyes(landmarks,.001,.001);for(let i=0;i<20;i++)detector.update(landmarks,i*40);
assert(!detector.debug.calibrated,'cannot calibrate with closed eyes');
const fixed=game.catchBlinkDropPart(game.beginBlinkDrop(game.createBlinkDropSession(),0),400,{x:0,y:-.4});
assert.deepEqual(fixed.fixedPositions[0],{x:0,y:-.4});assert.equal(game.catchBlinkDropPart(fixed,401),fixed);
const pausedFixing=game.pauseBlinkDrop(fixed,450),resumedFixing=game.resumeBlinkDrop(pausedFixing,1450);
assert.equal(resumedFixing.phase,'fixing');assert.equal(resumedFixing.fixingStartedAt,1400);
assert.deepEqual(resumedFixing.fixedPositions,fixed.fixedPositions);
console.log('PASS: four turns/local positions, calibration/history/hysteresis, glasses-like traces, no-repeat/reopen, invalid/asymmetric/lost tracking, reset');
setEyes(landmarks,.03,.03);detector.reset();for(let i=0;i<20;i++)detector.update(landmarks,i*40);
const benchmarkStart=performance.now();for(let i=0;i<2000;i++)detector.update(landmarks,1000+i*40);
console.log('Blink decision reference '+((performance.now()-benchmarkStart)/2000).toFixed(3)+' ms/update (PC Node, excludes landmark detection)');
