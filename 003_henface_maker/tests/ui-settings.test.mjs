import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
// Test the same pure helpers as the UI, without adding a test dependency.
const source = await fs.readFile(new URL('../src/uiSettings.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;
const {randomizeParts, RANDOM_LIMITS, readLayout, saveLayout} = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const ids=['brows','eyes','nose','mouth','ears','head','jaw','cheeks'];
const defaults=()=>Object.fromEntries(ids.map(id=>[id,{size:1,scaleX:1,scaleY:1,distance:0,opacity:1}]));
for(const strength of ['weak','normal','wild']){
 for(let seed=1;seed<=400;seed++){
  let n=seed;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
  const state=defaults(), original=JSON.stringify(state);
  const next=randomizeParts(state,['brows','eyes','nose','mouth'],strength,random);
  assert.equal(JSON.stringify(state),original,'入力を変更しない');
  for(const id of ids.slice(0,4)){
   const c=next[id], range=RANDOM_LIMITS[strength];
   assert(c.size>=range.min-0.025 && c.size<=range.max+0.025);
   assert(c.scaleX>=0.4 && c.scaleX<=1.8 && c.scaleY>=0.4 && c.scaleY<=1.8);
   assert(c.opacity>=0.2 && c.opacity<=1.5 && Math.abs(c.distance)<=0.25);
   for(const axis of ['scaleX','scaleY']){
    const effective=(1+(c.size-1)*1.6)*(1+(c[axis]-1)*1.75);
    assert(effective>=0.4-1e-9 && effective<=2.4+1e-9,'倍率の積を制限');
   }
  }
  for(const id of ids.slice(4))assert.equal(next[id],state[id],'対象外パーツを維持');
 }
 const state=defaults(), next=randomizeParts(state,['eyes'],strength,()=>0.75);
 for(const id of ids.filter(id=>id!=='eyes'))assert.equal(next[id],state[id],'選択以外は変更しない');
 assert.notDeepEqual(next.eyes,state.eyes);
}
assert.equal(readLayout(),'compact','ストレージが使えなくても起動');
saveLayout('standard');
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
for(const layout of ['standard','compact','edge-controls']){saveLayout(layout);assert.equal(readLayout(),layout);}
values.set('henface.layout','invalid');assert.equal(readLayout(),'compact');
globalThis.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
assert.equal(readLayout(),'compact');assert.doesNotThrow(()=>saveLayout('compact'));
console.log('PASS: 1200 random cases, selected/all scope, multiplier limits, layout persistence and storage failures');
