import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import BlinkDropHud from '../src/game/BlinkDropHud.tsx';
import { createBlinkDropSession } from '../src/game/blinkDropGame.ts';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const tick=()=>new Promise(r=>setTimeout(r,50));
let root=createRoot(document.querySelector('#app'));
try {
 history.replaceState(null,'','?debug=1');
 root.render(<App/>); await tick();
 document.querySelector('.game-entry-button').click(); await tick();
 const select=document.querySelector('[aria-label="ゲームデバッグ表示"]');
 assert('開発用の5表示を選択可能',select.options.length===5);
 for(const mode of ['parts-only','original','blank-face','bounds']) {
  select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  assert(mode+'では開始パネルが映像を覆わない',!document.querySelector('.game-start-panel'));
 }
 document.querySelector('.game-debug-tools button:last-of-type').click();await tick();
 assert('デバッグOFFで通常のゲーム表示へ復帰',!document.querySelector('.game-debug-tools')&&!!document.querySelector('.game-start-panel'));
 root.unmount();root=createRoot(document.querySelector('#app'));
 const canvas=document.createElement('canvas');canvas.width=480;canvas.height=640;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#ae8';ctx.fillRect(0,0,480,640);
 const calls=[];
 const session={...createBlinkDropSession('completed'),currentIndex:3,fixedOffsets:[-3,1,-2,1.5]};
 root.render(<main className="henface-app layout-simple mode-blink-drop"><header className="app-header"><h1>瞬きキャッチ</h1></header><div className="camera-workspace"><section className="viewer-card"><div className="preview-frame"><BlinkDropHud session={session} cameraActive={false} tracking={false} resultSnapshot={canvas.toDataURL()} start={()=>{}} pause={()=>{}} resume={()=>{}} restart={()=>calls.push('restart')} save={()=>calls.push('save')} exit={()=>calls.push('exit')}/></div></section></div></main>);
 await tick();
 const img=document.querySelector('.game-result-image');await img.decode();
 const card=document.querySelector('.game-result-card'),a=img.getBoundingClientRect(),b=card.getBoundingClientRect();
 assert('完成顔は静止画像として大きく表示',img.naturalWidth===480&&a.height>300&&a.width>300);
 assert('画像と結果カードが重ならず画面内に表示',a.bottom<=b.top+1&&b.bottom<=844&&document.documentElement.scrollWidth<=390);
 assert('完成・評価・2つのスコアが見える',card.textContent.includes('完成！')&&card.textContent.includes('正解度')&&card.textContent.includes('変顔度')&&card.querySelector('strong').textContent.length>0);
 for(const button of card.querySelectorAll('button')){assert(button.textContent+'はタッチ可能',button.getBoundingClientRect().height>=44&&!button.disabled);button.click();}
 assert('再挑戦・保存・通常へ戻るの各処理を実行',calls.join(',')==='restart,save,exit');
 document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
document.querySelector('#results').textContent=results.join('\n');
