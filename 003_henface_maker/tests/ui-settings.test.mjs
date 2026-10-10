import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
// Test the same pure helpers as the UI, without adding a test dependency.
const source = await fs.readFile(new URL('../src/uiSettings.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;
const {randomizeParts, RANDOM_LIMITS, readLayout, saveLayout, readRandomStrength, saveRandomStrength, readSettingsOpen, saveSettingsOpen} = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const ids=['brows','eyes','nose','mouth','ears','head','jaw','cheeks'];
const defaults=()=>Object.fromEntries(ids.map(id=>[id,{size:1,scaleX:1,scaleY:1,distance:0,opacity:1}]));
assert(RANDOM_LIMITS.monster.max>RANDOM_LIMITS.chaos.max&&RANDOM_LIMITS.chaos.max>RANDOM_LIMITS.wild.max,'強度ごとの最大振れ幅が段階的に増える');
for(const strength of ['weak','normal','wild','chaos','monster']){
 for(let seed=1;seed<=400;seed++){
  let n=seed;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
  const state=defaults(), original=JSON.stringify(state);
  const next=randomizeParts(state,['brows','eyes','nose','mouth'],strength,random);
  assert.equal(JSON.stringify(state),original,'入力を変更しない');
  for(const id of ids.slice(0,4)){
   const c=next[id], range=RANDOM_LIMITS[strength];
   assert(c.size>=range.min-0.025 && c.size<=range.max+0.025);
   assert(c.scaleX>=0.4 && c.scaleX<=2 && c.scaleY>=0.4 && c.scaleY<=2);
   assert(c.opacity>=0.2 && c.opacity<=1.5 && Math.abs(c.distance)<=0.25);
   for(const axis of ['scaleX','scaleY']){
    const effective=Math.max(.2,1+(c.size-1)*1.6)*Math.max(.2,1+(c[axis]-1)*1.75);
    const min=strength==='monster'?.35:.4,max=strength==='monster'?2.8:strength==='chaos'?2.65:2.4;
    assert(effective>=min-1e-9 && effective<=max+1e-9,'倍率の積を制限');
   }
  }
  for(const id of ids.slice(4))assert.equal(next[id],state[id],'対象外パーツを維持');
 }
 const state=defaults(), next=randomizeParts(state,['eyes'],strength,()=>0.75);
 for(const id of ids.filter(id=>id!=='eyes'))assert.equal(next[id],state[id],'選択以外は変更しない');
 assert.notDeepEqual(next.eyes,state.eyes);
}
assert.equal(readLayout(),'simple','ストレージが使えなくても起動');
assert.equal(readRandomStrength(),'monster');
saveLayout('standard');
saveRandomStrength('weak');
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
assert.equal(readLayout(),'simple','未保存時はsimple');
assert.equal(readRandomStrength(),'monster','未保存時はmonster');
for(const layout of ['standard','compact','edge-controls','simple']){saveLayout(layout);assert.equal(readLayout(),layout);}
for(const strength of ['weak','normal','wild','chaos','monster']){saveRandomStrength(strength);assert.equal(readRandomStrength(),strength);}
for(const invalid of ['invalid','','MONSTER']){
 values.set('henface.layout',invalid);assert.equal(readLayout(),'simple');
 values.set('henface.randomStrength',invalid);assert.equal(readRandomStrength(),'monster');
}
assert.equal(readSettingsOpen(),false);saveSettingsOpen(true);assert.equal(readSettingsOpen(),true);saveSettingsOpen(false);assert.equal(readSettingsOpen(),false);
globalThis.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
assert.equal(readLayout(),'simple');assert.doesNotThrow(()=>saveLayout('compact'));
assert.equal(readRandomStrength(),'monster');assert.doesNotThrow(()=>saveRandomStrength('normal'));
assert.equal(readSettingsOpen(),false);assert.doesNotThrow(()=>saveSettingsOpen(true));
console.log('PASS: 2000 random cases, selected/all scope, multiplier limits, simple/monster defaults, layout/strength/settings persistence and storage failures');
