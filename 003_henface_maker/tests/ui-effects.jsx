import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/styles.css';
import { createFixture } from './fixture.js';
import { createFeatureRenderer } from '../src/featureRenderer.ts';
import { applyFacePreset } from '../src/faceEffects.ts';
const results=[],assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const tick=()=>new Promise(r=>setTimeout(r,30));
const button=name=>[...document.querySelectorAll('#app button')].find(b=>b.getAttribute('aria-label')===name||b.textContent===name);
const select=async(label,value)=>{const e=document.querySelector('[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));await tick();};
const click=async(name)=>{button(name).click();await tick();};
const size=()=>document.querySelector('input[aria-label="大きくする / 小さくする"]');
const setRange=async(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));await tick();};
localStorage.setItem('henface.layout','compact');
createRoot(document.querySelector('#app')).render(<App/>);
await tick();
try{
 assert('4カテゴリを表示',['パーツ','配置','特殊','プリセット'].every(n=>button(n)));
 assert("スマホ幅で横方向の見切れなし",document.querySelector("main").getBoundingClientRect().width<=375 && document.documentElement.scrollWidth<=innerWidth);
 const camera=document.querySelector('canvas');await setRange(size(),130);assert('スライダー変更を反映',size().value==='130');
 for(const layout of ['standard','compact','edge-controls']){
  await select('レイアウト',layout);assert(layout+'で値を保持',size().value==='130');assert(layout+'でcanvasを維持',document.querySelector('canvas')===camera);
  assert(layout+'を保存',localStorage.getItem('henface.layout')===layout);
  const bounds=['このパーツをリセット','全部リセット','選択パーツをランダム','全パーツをランダム'].map(n=>button(n).getBoundingClientRect());
  assert(layout+'で操作ボタン44px以上',bounds.every(b=>b.height>=44&&b.width>=44&&b.left>=0&&b.right<=375));
  assert(layout+'で主要操作が画面内または最小スクロール',bounds.every(b=>b.bottom<innerHeight+(layout==='standard'?100:10)));
 }
 await select('レイアウト','compact');await click('配置');assert('配置8種類と解除',[...document.querySelector('[aria-label="配置エフェクト"]').options].length===9);
 await select('配置エフェクト','gather');await setRange(document.querySelector('[aria-label="配置の強度"]'),70);
 await click('特殊');assert('特殊7種類',[...document.querySelector('[aria-label="特殊エフェクト"]').options].length===7);
 await select('特殊エフェクト','connectedBrows');await setRange(document.querySelector('[aria-label="つながり眉の強度"]'),80);
 await click('配置');assert('カテゴリを戻しても配置保持',document.querySelector('[aria-label="配置エフェクト"]').value==='gather');
 await click('パーツ');assert('配置と特殊の操作後も個別値保持',size().value==='130');
 await click('プリセット');assert('新プリセット4種類',document.querySelectorAll('.face-presets button').length===4);await click('極太眉モンスター');
 await click('特殊');await select('特殊エフェクト','connectedBrows');assert('プリセットの特殊値を手動調整可能',document.querySelector('[aria-label="つながり眉の強度"]').value==='90');
 await click('全部リセット');assert('全リセットで特殊解除',document.querySelector('[aria-label="つながり眉の強度"]').value==='0');
 await click('配置');assert('全リセットで配置解除',document.querySelector('[aria-label="配置エフェクト"]').value==='none');
 await click('パーツ');await click('選択パーツをランダム');assert('選択ランダムの診断表示',document.querySelector('.diagnosis').textContent.includes('口をランダム'));
 document.querySelector('.extra-tools summary').click();await tick();await select('品質','speed');assert('品質4段階',document.querySelector('[aria-label="品質"]').options.length===4);
 const checkbox=[...document.querySelectorAll('.checkbox-option')].find(e=>e.textContent.includes('配置・特殊')).querySelector('input');checkbox.click();await tick();await click('全パーツをランダム');assert('配置・特殊込みランダム',document.querySelector('.diagnosis').textContent.includes('パーツ＋配置＋特殊'));
 const debug=[...document.querySelectorAll('.checkbox-option')].find(e=>e.textContent.includes('処理時間')).querySelector('input');debug.click();await tick();assert('計測を通常UIから切替',!!document.querySelector('.debug-panel'));debug.click();await tick();
 document.querySelector('.extra-tools summary').click();await tick();await click('全部リセット');await click('プリセット');await click('極太眉モンスター');await click('特殊');await select('特殊エフェクト','connectedBrows');
 const {base,landmarks}=createFixture();const defaults=Object.fromEntries(['brows','eyes','nose','mouth','ears','jaw','head','cheeks'].map(id=>[id,{size:1,scaleX:1,scaleY:1,distance:0,opacity:1}]));
 const preset=applyFacePreset(defaults,'monster');camera.width=480;camera.height=640;createFeatureRenderer().renderFeatureEffects(base,camera.getContext('2d'),landmarks,preset.parts,undefined,{effects:preset.effects});
 document.querySelector('.placeholder').textContent='合成画像でUI検証（実カメラではありません）';document.querySelector('.placeholder').classList.add('test-caption');
 document.querySelector('#results').textContent=results.join('\n')+'\n検証幅375px / browser viewport '+innerWidth+'×'+innerHeight;document.documentElement.dataset.result='pass';
}catch(error){document.querySelector('#results').textContent=results.join('\n')+'\n'+error.stack;document.documentElement.dataset.result='fail';}
