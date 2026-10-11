import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../src/game/blinkDropGame.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;
const {BlinkDetector} = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
function face(left=.30,right=.26) {
 const lm=Array.from({length:478},()=>({x:.5,y:.5}));
 for(const [outer,inner,pairs,cx,ratio] of [[362,263,[[386,374],[385,380]],.65,left],[33,133,[[159,145],[158,153]],.35,right]]) {
  lm[outer]={x:cx-.05,y:.4};lm[inner]={x:cx+.05,y:.4};
  pairs.forEach(([a,b],i)=>{lm[a]={x:cx+(i-.5)*.03,y:.4-ratio*.05};lm[b]={x:cx+(i-.5)*.03,y:.4+ratio*.05};});
 }
 return lm;
}
function trace(sensitivity='normal',outliers=false) {
 const detector=new BlinkDetector();detector.setSensitivity(sensitivity);let t=0;
 const events=[];
 const sample=(l=1,r=l,allow=true,dt=33)=>{t+=dt;const hit=detector.update(l===null?undefined:face(.30*l,.26*r),t,allow);if(hit)events.push(t);return hit;};
 for(let i=0;i<22;i++)sample(outliers&&i===3?.2:outliers&&i===8?1.5:1);
 assert(detector.ready,'open after robust independent calibration');
 const open=(n=10)=>{for(let i=0;i<n;i++)sample(1);};
 return {detector,sample,open,events};
}
for(const pattern of ['normal','short','long','slow-reopen','slow-close','fast-series']) {
 const x=trace('normal',true),b=x.detector.debug.baselineLeft;
 for(let turn=0;turn<4;turn++) {
  if(pattern==='slow-close')for(let i=0;i<15;i++)x.sample(.8); // Original 350ms open deadline expired here.
  const shallow=pattern==='normal'||pattern==='slow-close';
  for(let i=0;i<(pattern==='long'?30:shallow?2:1);i++)x.sample(shallow?.68:.25);
  assert.equal(x.events.length,turn+1,pattern+': one event per closure');
  for(let i=0;i<5;i++)x.sample(.25);
  assert.equal(x.events.length,turn+1,'held closed cannot repeat');
  if(pattern==='slow-reopen')for(let i=0;i<15;i++)x.sample(.76);
  x.open(pattern==='fast-series'?4:10);assert(x.detector.ready,pattern+': rearmed');
 }
 assert.equal(x.events.length,4);assert(Math.abs(x.detector.debug.baselineLeft-b)<.01,'closed values never lower baseline');
 console.log('PASS blink trace: '+pattern+' / four events, no repeat, return OPEN');
}
{
 const x=trace();
 // Moderate unilateral reflections/partial bilateral changes are not closures.
 for(let i=0;i<20;i++){x.sample(i%2?.65:1,1);x.sample(.8,.84);x.sample(1);}
 assert.equal(x.events.length,0);
 x.sample(2,1);assert(!x.detector.ready);x.sample(.25);assert.equal(x.events.length,0);
 x.open();x.sample(null);x.sample(.25);assert.equal(x.events.length,0,'missing face followed by closed eyes cannot catch');
 x.open();x.sample(.25);assert.equal(x.events.length,1);
 console.log('PASS blink trace: glasses-like/asymmetric noise, spike, lost tracking, safe reopen');
}
{
 const x=trace();x.sample(.25, .25, false);assert.equal(x.events.length,0);assert.equal(x.detector.debug.count,0);
 x.open();x.sample(.25);assert.equal(x.events.length,1,'suppression in countdown/fixing does not prevent next accepted blink');
 x.sample(.25);x.open(3);assert(!x.detector.ready,'reopen latched during cooldown');x.open(6);assert(x.detector.ready);
 x.sample(.25);assert.equal(x.events.length,2);
 x.detector.reset();assert.equal(x.detector.debug.count,0);assert(!x.detector.ready);
 console.log('PASS event gating/countdown/fixing, cooldown/reopen latch, restart');
}
for(const [level,ratio,expected] of [['low',.7,0],['normal',.7,1],['high',.77,1],['normal',.77,0]]) {
 const x=trace(level);x.sample(ratio);x.sample(ratio);assert.equal(x.events.length,expected,level+' sensitivity');
}
console.log('PASS sensitivity hysteresis low/normal/high');
