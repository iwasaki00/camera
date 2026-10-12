import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
async function load(file) {
  const source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
const game = await load('../src/game/blinkDropGame.ts');
const { FaceTriggerManager, mouthOpeningRatio, readFaceTriggers, saveFaceTriggers, defaultFaceTriggers } = await load('../src/game/faceTriggers.ts');
function face(eyes = 1, mouth = .1, right = eyes) {
  const lm = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  for (const [outer, inner, pairs, cx, ratio] of [[362,263,[[386,374],[385,380]],.65,.30*eyes], [33,133,[[159,145],[158,153]],.35,.26*right]]) {
    lm[outer] = { x: cx-.05, y: .4 }; lm[inner] = { x: cx+.05, y: .4 };
    pairs.forEach(([a,b], i) => { lm[a] = {x:cx+(i-.5)*.03,y:.4-ratio*.05}; lm[b] = {x:cx+(i-.5)*.03,y:.4+ratio*.05}; });
  }
  lm[61] = {x:.4,y:.65}; lm[291] = {x:.6,y:.65};
  lm[13] = {x:.5,y:.65-mouth*.1}; lm[14] = {x:.5,y:.65+mouth*.1};
  return lm;
}
function trace(settings = defaultFaceTriggers()) {
  const blink = new game.BlinkDetector(), manager = new FaceTriggerManager(blink); manager.reset(settings);
  let t = 0, hits = [];
  const sample = (eyes = 1, mouth = .1, accepting = true, right = eyes, dt = 33) => {
    t += dt;
    const hit = manager.update(eyes === null ? undefined : face(eyes,mouth,right), t, accepting);
    if (hit) { hits.push(hit); manager.accept(hit, t); }
    return hit;
  };
  const frames = (n=20, eyes=1, mouth=.1, accepting=true, right=eyes) => { for(let i=0;i<n;i++) sample(eyes,mouth,accepting,right); };
  frames(24);
  assert(blink.ready && manager.eyes.neutral && manager.mouth.neutral, 'calibrated and independently armed');
  return {blink,manager,sample,frames,hits,get now(){return t;}};
}
for (const [trigger, eye, mouth] of [['BLINK',.25,.1],['EYES_WIDE',1.45,.1],['MOUTH_OPEN',1,.7]]) {
  const x=trace();
  for(let turn=0;turn<4;turn++) {
    x.frames(8,eye,mouth); assert.equal(x.hits.length,turn+1); assert.equal(x.hits.at(-1),trigger);
    x.frames(50,eye,mouth); assert.equal(x.hits.length,turn+1,'held expression cannot repeat');
    x.frames(); assert(x.manager.armed,trigger+': neutral returns global arm');
  }
  console.log('PASS '+trigger+': four repetitions, held latch, neutral rearm');
}
{
  const blink=new game.BlinkDetector(), manager=new FaceTriggerManager(blink);let now=0,hits=0;
  const sample=eye=>{now+=33;if(manager.update(face(eye),now,true,true))hits++;};
  for(let i=0;i<24;i++)sample(1);
  for(let i=0;i<10;i++){for(let j=0;j<3;j++)sample(.25);for(let j=0;j<10;j++)sample(1);}
  assert.equal(hits,10);assert.equal(blink.debug.count,10);
  console.log('PASS existing 10-blink test keeps detector cooldown (429ms spacing)');
}
{
  const x=trace(); x.frames(8,1.45,.7);
  assert.deepEqual(x.hits,['EYES_WIDE']); assert.equal(x.manager.eyes.count,1); assert.equal(x.manager.mouth.count,1);
  x.frames(40,1,.7); assert(!x.manager.armed,'concurrent held mouth prevents next facial catch');
  x.frames(); x.frames(8,1,.7); assert.deepEqual(x.hits,['EYES_WIDE','MOUTH_OPEN']);
  console.log('PASS simultaneous triggers: one acceptance, both latches consumed');
}
{
  const x=trace(); x.sample(1.45); x.frames(); x.frames(30,1,.35); x.frames(30,1.18);
  x.frames(30,1.5,.1,true,1); assert.equal(x.hits.length,0,'short, speech-like or unilateral noise cannot fix');
  x.frames(30,1.5,.7,true,1); assert.equal(x.hits.length,0,'unstable eye geometry cannot trigger mouth catch');
  x.sample(null);x.frames(20,1.45,.7); assert.equal(x.hits.length,0,'lost face must first return neutral');
  x.frames(); x.frames(8,1.45); assert.deepEqual(x.hits,['EYES_WIDE']);
  console.log('PASS small changes, reflection/asymmetric noise, missing face and neutral recovery');
}
{
  const x=trace(); x.frames(8,1,.7); x.frames(18,1,.7,false);
  assert(!x.manager.armed); assert(x.manager.canFix('TAP','playing',x.now),'tap rescues held mouth');
  x.manager.accept('TAP',x.now);
  assert(!x.manager.canFix('TAP','fixing',x.now),'fixing rejects all inputs');
  assert(!x.manager.canFix('TAP','playing',x.now+10),'tap debounce');
  x.frames(21,1,.7,false); assert(x.manager.canFix('TAP','playing',x.now),'tap remains available');
  x.sample(null); assert(!x.manager.canFix('TAP','playing',x.now),'no tracking means no tap catch');
  console.log('PASS TAP rescue, fixing exclusion, rapid taps, tracking guard');
}
for (const key of ['blink','eyesWide','mouthOpen']) {
  const settings=defaultFaceTriggers();settings[key]=false; const x=trace(settings);
  const parameters={blink:[.25,.1],eyesWide:[1.45,.1],mouthOpen:[1,.7]};
  x.frames(15,...parameters[key]); assert.equal(x.hits.length,0,key+' OFF');
  x.frames(); assert(x.manager.canFix('TAP','playing',x.now));
}
{
  const x=trace({blink:true,eyesWide:false,mouthOpen:false});x.frames(30,1,.7);x.sample(.25,.7);
  assert.deepEqual(x.hits,['BLINK'],'disabled held mouth never blocks blink');
  x.frames(20,1,.7);x.sample(.25,.7);assert.equal(x.hits.length,2);
  const y=trace(); y.frames(10,1.45,.7,false); y.frames(20,1.45,.7,true);assert.equal(y.hits.length,0,'countdown/fixing events not queued');
  y.frames();y.frames(8,1,.7);assert.equal(y.hits.length,1);
  y.manager.reset();assert.equal(y.manager.debug.accepted,0);assert.equal(y.manager.mouth.count,0);assert(!y.blink.ready);
  console.log('PASS ON/OFF, unrelated detectors, out-of-phase event discard, restart reset');
}
{
  const lm=face(1,.7), original=mouthOpeningRatio(lm);
  const moved=lm.map(p=>({x:1.3*(Math.cos(.3)*p.x-Math.sin(.3)*p.y)+.1,y:1.3*(Math.sin(.3)*p.x+Math.cos(.3)*p.y)-.05}));
  assert(Math.abs(mouthOpeningRatio(moved)-original)<1e-10,'mouth normalizes scale and rotation');
  lm[13]={x:NaN,y:.5};assert.equal(mouthOpeningRatio(lm),undefined);
  const x=trace();x.manager.setThresholds(1.5,.75);x.frames();x.frames(10,1.4,.7);assert.equal(x.hits.length,0,'debug thresholds take effect');
  x.frames();x.frames(8,1.6,.8);assert.equal(x.hits.length,1);
  console.log('PASS normalized mouth geometry, invalid landmarks, configurable safe thresholds');
}
{
  let saved=null;
  globalThis.localStorage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
  assert.deepEqual(readFaceTriggers(),defaultFaceTriggers());
  saveFaceTriggers({blink:false,eyesWide:true,mouthOpen:false});assert.deepEqual(readFaceTriggers(),{blink:false,eyesWide:true,mouthOpen:false});
  saved='{"blink":"false","eyesWide":false,"mouthOpen":null}';assert.deepEqual(readFaceTriggers(),{blink:true,eyesWide:false,mouthOpen:true});
  saved='{bad';assert.deepEqual(readFaceTriggers(),defaultFaceTriggers());
  globalThis.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  assert.deepEqual(readFaceTriggers(),defaultFaceTriggers());saveFaceTriggers(defaultFaceTriggers());delete globalThis.localStorage;
  console.log('PASS storage defaults, boolean restoration, unknown values, denied access');
}
// Drive all triggers through the unchanged game catch/advance functions for each difficulty.
for(const difficulty of game.BLINK_DROP_DIFFICULTIES) {
  const blink=new game.BlinkDetector(),manager=new FaceTriggerManager(blink);manager.reset();let now=0;
  let session=game.beginBlinkDrop(game.createBlinkDropSession('countdown',difficulty),0);
  function sample(eyes=1,mouth=.1,tap=false) {
    now+=33;
    const trigger=manager.update(face(eyes,mouth),now,session.phase==='playing');
    const selected=tap?'TAP':trigger;
    if(selected&&manager.canFix(selected,session.phase,now)) {
      session=game.catchBlinkDropPart(session,now,{x:.2,y:.1},.2);manager.accept(selected,now);
    }
    if(session.phase==='fixing'&&now-session.fixingStartedAt>=450)session=game.advanceBlinkDrop(session,now);
  }
  const frames=(n=24,e=1,m=.1)=>{for(let i=0;i<n;i++)sample(e,m);};
  frames();sample(.25);frames();assert.equal(session.currentIndex,1);
  frames(8,1.45);frames();assert.equal(session.currentIndex,2);
  frames(8,1,.7);frames();assert.equal(session.currentIndex,3);
  sample(1,.1,true);sample(1,.1,true);frames();assert.equal(session.phase,'completed');
  assert.equal(manager.debug.accepted,4);assert.equal(session.fixedPositions.filter(Boolean).length,4);
  const completed=JSON.stringify(session);frames(30,1.45,.7);assert.equal(JSON.stringify(session),completed);
  console.log('PASS '+difficulty+': BLINK → EYES_WIDE → MOUTH_OPEN → TAP, four turns, completed unchanged');
}
{
  const x=trace(),lm=face();const started=performance.now();
  for(let i=0;i<10000;i++)x.manager.update(lm,x.now+i*33,false);
  console.log('Reference PC detector-only '+((performance.now()-started)/10000).toFixed(4)+'ms/sample (no camera/Canvas; not iPhone FPS)');
}
