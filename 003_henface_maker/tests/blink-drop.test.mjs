import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../src/game/blinkDropGame.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;
const game = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

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
for(let i=0;i<4;i++)assert.equal(detector.update(landmarks,i*60),false,'開眼で基準値を学習');
setEyes(landmarks,.005,.005);assert.equal(detector.update(landmarks,300),true,'両目を閉じると1回検知');
assert.equal(detector.update(landmarks,400),false,'閉じたまま連続検知しない');
setEyes(landmarks,.03,.03);assert.equal(detector.update(landmarks,700),false,'開眼で再アーム');
setEyes(landmarks,.005,.03);assert.equal(detector.update(landmarks,900),false,'片目だけでは検知しない');
setEyes(landmarks,.005,.005);assert.equal(detector.update(landmarks,950),true,'クールダウン後の次の両目瞬き');
detector.reset();assert.equal(detector.update(undefined,1200),false,'顔未検出時は判定しない');
console.log('PASS: blink-drop state sequence, falling/pause/four catches, score bounds, bilateral blink/rearm/cooldown/no-face');
