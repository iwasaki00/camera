import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const load=async file=>{ const source=await fs.readFile(new URL('../src/'+file,import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64')); };
const f=await load('faceEffects.ts'), p=await load('performance.ts');
const defaults=()=>Object.fromEntries(['brows','eyes','nose','mouth','ears','jaw','head','cheeks'].map(id=>[id,{size:1,scaleX:1,scaleY:1,distance:0,opacity:1}]));
const region={center:{x:80,y:60},width:30,height:15},center={x:100,y:100};
for(const mode of ['gather','spread','compress','expand','close','separate','up','down']){
 const e=f.emptyFaceEffects();e.placement.mode=mode;e.placement.strength=1;const d=f.placementOffset('eyes',region,center,e);
 if(['gather','close'].includes(mode))assert(d.x>0);if(['spread','separate'].includes(mode))assert(d.x<0);
 if(['gather','compress','down'].includes(mode))assert(d.y>0);if(['spread','expand','up'].includes(mode))assert(d.y<0);
 e.placement.strength=0;assert.deepEqual(f.placementOffset('eyes',region,center,e),{x:0,y:0});
}
for(const name of Object.keys(f.FACE_PRESETS)){const state=defaults(),old=JSON.stringify(state),r=f.applyFacePreset(state,name);assert.equal(JSON.stringify(state),old);assert.notDeepEqual(r.effects,f.emptyFaceEffects());assert.equal(r.parts.ears,state.ears);}
const monster=f.applyFacePreset(defaults(),'monster');for(const key of ['thickBrows','connectedBrows','crossedEyes','flatNose','crookedMouth','lowerFace'])assert(monster.effects.special[key]>0);
const alien=f.applyFacePreset(defaults(),'alien');assert(alien.effects.special.lowerFace<0 && alien.parts.eyes.size>1);
for(const strength of ['weak','normal','wild'])for(let seed=1;seed<=400;seed++){
 let n=seed;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};const e=f.randomFaceEffects(strength,random),limit={weak:.2,normal:.45,wild:.75}[strength];
 assert(e.placement.strength<=limit);for(const value of Object.values(e.special))assert(value>=0&&value<=limit);
 const o={translation:{x:1000,y:-1000},influenceRadius:{x:40,y:30}};f.applyFaceOffsets('eyes',region,center,o,e);assert(Math.abs(o.translation.x)<=11.2+1e-8&&Math.abs(o.translation.y)<=8.4+1e-8);
}
const smoother=new p.LandmarkSmoother(),points=()=>Array.from({length:478},()=>({x:.4,y:.4}));
smoother.update(points(),0);const before=smoother.sample(0);const next=points();next.forEach(p=>p.x=.45);smoother.update(next,50);assert(smoother.fastUntil>50,"動きが大きいと検出を短時間増速");const middle=smoother.sample(70);assert(middle[1].x>.4&&middle[1].x<.45);assert.equal(before,middle,'追従バッファを再利用');
smoother.sample(200);assert(middle[1].x>.44);smoother.update(undefined,300);assert.equal(smoother.sample(300),undefined);assert.equal(smoother.fastUntil,0);
smoother.update(points(),400);const jump=points();jump.forEach(p=>p.x=.7);smoother.update(jump,410);assert.equal(smoother.sample(410)[1].x,.7,'大移動・再検出は残像を避ける');
const metrics=new p.FrameMetrics();let now=1;for(let i=0;i<75;i++){now+=34;metrics.record(now,20,25,2,48);}assert.equal(metrics.autoLevel,'speed');for(let i=0;i<200;i++){now+=34;metrics.record(now,5,4,1,10);}assert.equal(metrics.autoLevel,'balanced');
assert(p.QUALITY_PROFILES.speed.maxFrameDimension<p.QUALITY_PROFILES.balanced.maxFrameDimension);assert(p.QUALITY_PROFILES.speed.detectInterval>p.QUALITY_PROFILES.quality.detectInterval);
console.log('PASS: placement directions/zero, presets/immutability, 1200 extras cases, bounded translation, smoothing/lost/jump, auto quality hysteresis');

for(const fps of [24,30]) {let previous=0,count=0;for(let i=1;i<=360;i++){const now=i*1000/60;if(now-previous<1000/fps-1)continue;previous=p.advanceFrameClock(previous,now,fps,false);count++;}assert(Math.abs(count/6-fps)<1,'RAF間隔を丸めず目標fpsを維持');}
console.log('PASS: 60Hz RAF scheduling targets 24/30fps');
