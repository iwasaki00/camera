import { createFeatureRenderer } from '../src/featureRenderer.ts';
import { emptyFaceEffects, applyFacePreset, FACE_PRESETS, PLACEMENTS, SPECIALS } from '../src/faceEffects.ts';
import { QUALITY_PROFILES } from '../src/performance.ts';
import { createFixture } from './fixture.js';
const {base,landmarks}=createFixture();
const defaults=()=>Object.fromEntries(['brows','eyes','nose','mouth','ears','jaw','head','cheeks'].map(id=>[id,{size:1,scaleX:1,scaleY:1,distance:0,opacity:1}]));
const canvas=()=>{const c=document.createElement('canvas');c.width=480;c.height=640;return c;};
const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const results=[],assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const original=pixels(base).slice(), out=canvas(),ctx=out.getContext('2d'), renderer=createFeatureRenderer();
const show=(image,label)=>{const div=document.createElement('div');div.append(label,image);document.querySelector('#images').append(div);};
try {
 renderer.renderFeatureEffects(base,ctx,landmarks,defaults(),undefined,{effects:emptyFaceEffects(),quality:QUALITY_PROFILES.balanced});
 assert('追加効果0で元画像と完全一致',equal(original,pixels(out)));assert('標準値の変形処理をスキップ',renderer.metrics.transformedParts===0&&renderer.metrics.warpMs===0);
 for(const mode of Object.keys(PLACEMENTS).filter(m=>m!=='none')){
  const e=emptyFaceEffects();e.placement.mode=mode;e.placement.strength=.8;renderer.renderFeatureEffects(base,ctx,landmarks,defaults(),undefined,{effects:e});
  assert('配置 '+PLACEMENTS[mode]+' が反映',!equal(original,pixels(out)));
 }
 for(const special of Object.keys(SPECIALS)){
  const e=emptyFaceEffects();e.special[special]=.8;renderer.renderFeatureEffects(base,ctx,landmarks,defaults(),undefined,{effects:e});assert('特殊 '+SPECIALS[special]+' が反映',!equal(original,pixels(out)));
 }
 show(base,'元画像（合成テスト用）');
 for(const preset of Object.keys(FACE_PRESETS)){
  const p=applyFacePreset(defaults(),preset), image=canvas();renderer.renderFeatureEffects(base,image.getContext('2d'),landmarks,p.parts,undefined,{effects:p.effects});
  assert('プリセット '+FACE_PRESETS[preset],!equal(original,pixels(image)));show(image,FACE_PRESETS[preset]);
 }
 const monster=applyFacePreset(defaults(),'monster');renderer.renderFeatureEffects(base,ctx,landmarks,monster.parts,undefined,{effects:monster.effects});const first=pixels(out).slice();
 renderer.renderFeatureEffects(base,ctx,landmarks,monster.parts,undefined,{effects:monster.effects});assert('新効果も加工の累積なし',equal(first,pixels(out)));assert('新効果も元ソース不変',equal(original,pixels(base)));
 renderer.renderFeatureEffects(base,ctx,undefined,monster.parts,undefined,{effects:monster.effects});assert('顔未検出で描画効果が残らない',equal(original,pixels(out)));
 for(const quality of Object.values(QUALITY_PROFILES)){renderer.renderFeatureEffects(base,ctx,landmarks,monster.parts,undefined,{effects:monster.effects,quality});assert('品質格子 '+quality.patchGrid+' で描画完了',equal(original,pixels(base)));}
 const state=defaults();state.nose.size=1.5;state.nose.scaleX=1.3;state.eyes.size=1.5;state.eyes.distance=.1;state.mouth.size=.7;state.mouth.scaleY=1.3;state.brows.size=1.2;
 const bench=(r,profile)=>{for(let i=0;i<8;i++)r.renderFeatureEffects(base,ctx,landmarks,state,undefined,profile&&{quality:profile});const values=[];for(let j=0;j<4;j++){const start=performance.now();for(let i=0;i<25;i++)r.renderFeatureEffects(base,ctx,landmarks,state,undefined,profile&&{quality:profile});values.push((performance.now()-start)/25);}values.sort((a,b)=>a-b);return (values[1]+values[2])/2;};
 // The baseline copy is local and ignored by git. Skip comparison if absent after a fresh checkout.
 try {let createOld=globalThis.__baselineFactory; if(!createOld){const baselineUrl = new URLSearchParams(location.search).get('baseline'); if (!baselineUrl) throw Error('旧版の比較用モジュール未指定（新機能テストは実施済み）'); createOld=(await import(/* @vite-ignore */ baselineUrl)).createFeatureRenderer;}const old=bench(createOld());const balanced=bench(renderer,QUALITY_PROFILES.balanced);const speed=bench(renderer,QUALITY_PROFILES.speed);
  results.push('計測 480×640・6パーツ / CPU描画呼出し時間（検出を除く）\nv0.3.0: '+old.toFixed(2)+'ms/frame\nv0.4.0 balanced: '+balanced.toFixed(2)+'ms/frame\nv0.4.0 speed: '+speed.toFixed(2)+'ms/frame\nbalanced削減率: '+((1-balanced/old)*100).toFixed(1)+'%');
 }catch(error){results.push('参考ベンチマークは未実施: '+error.message);}
 document.querySelector('#results').textContent=results.join('\n');document.documentElement.dataset.result='pass';
}catch(error){document.querySelector('#results').textContent=results.join('\n')+'\n'+error.stack;document.documentElement.dataset.result='fail';}
