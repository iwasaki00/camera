import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
import App from '../src/App.tsx';
import {createFixture} from './fixture.js';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);document.querySelector('#results').textContent=results.join('\n');if(!ok)throw Error(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await sleep(50);}throw Error('UI wait timed out');};
const {base,landmarks}=createFixture();
let closed=false,lost=false,feeds=0,frameTimer,stream,overrideColor,paintTick=0;
// Deterministic camera frames: native captureStream decoding can throttle a
// display:none video in headless Edge. Test the App scheduler, not that decoder.
const drawImage=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
 return drawImage.call(this,image instanceof HTMLVideoElement ? base : image,...args);
};
const videoTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get:()=>Math.floor(performance.now()/33)*.033,set(){}});
const raf=window.requestAnimationFrame,cancelRaf=window.cancelAnimationFrame;
// Headless page visibility can suspend native RAF despite focus emulation.
// This is a functional scheduler fixture; its FPS is not a device benchmark.
window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);
window.cancelAnimationFrame=id=>clearTimeout(id);
const setEyes=(lm,gap)=>{
 for(const [outer,inner,pairs,cx] of [[362,263,[[386,374,-.015],[385,380,.015]],.365],[33,133,[[159,145,-.015],[158,153,.015]],.635]]){
  lm[outer]={x:cx-.073,y:235/640};lm[inner]={x:cx+.073,y:235/640};
  for(const [top,bottom,dx] of pairs){lm[top]={x:cx+dx,y:235/640-gap/2};lm[bottom]={x:cx+dx,y:235/640+gap/2};}
 }
};
FilesetResolver.forVisionTasks=async()=>({});
FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>{feeds++;const lm=landmarks.map(p=>({...p}));setEyes(lm,closed?.007:.042);return{faceLandmarks:lost?[]:[lm]};},close(){}});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
 stream=base.captureStream(0);
 frameTimer=setInterval(()=>{const ctx=base.getContext('2d');ctx.fillStyle=overrideColor??(feeds%2?'#df9344':'#6493df');ctx.fillRect(0,0,20,20);
  ctx.fillStyle=`rgb(${++paintTick%256},64,200)`;ctx.fillRect(21,0,2,2); // Always a new frame, even when the test's main color is fixed.
  stream.getVideoTracks()[0].requestFrame();
 },33);
 return stream;
}});
const root=createRoot(document.querySelector('#app'));
let saved;
HTMLAnchorElement.prototype.click=function(){saved=this.href;};
try{
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}); // Visibility is explicitly controlled below for the background test.
 history.replaceState(null,'','?debug=1');localStorage.setItem('henface.layout','simple');
 root.render(<App/>);await sleep(100);document.querySelector('.game-entry-button').click();await sleep(100);
 document.querySelector('.game-start-panel .primary-button').click();
 await wait(()=>!!document.querySelector('.game-countdown strong'));
 assert('カウントダウンの最初は3',document.querySelector('.game-countdown strong').textContent==='3');
 const labels=[];
 while(document.querySelector('main').dataset.gamePhase==='countdown'){
  const label=document.querySelector('.game-countdown strong')?.textContent;if(label&&!labels.includes(label))labels.push(label);await sleep(25);
 }
 assert('HUDは3→2→1へ更新',labels.join(',')==='3,2,1');
 assert('3秒後にSTART!表示でplaying開始',document.querySelector('.game-start-cue')?.textContent==='START!');
 await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('次ターン受付 可'));
 assert('開始時キャリブレーションと顔検出を実行',feeds>10&&document.querySelector('.blink-debug-details pre').textContent.includes('ready'));
 lost=true;closed=true;await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('顔 未検出/不安定'));
 document.querySelector('canvas').click();await sleep(100);
 assert('顔未検出の瞬き・タップでは誤固定しない',document.querySelector('main').dataset.gamePhase==='playing');
 lost=false;closed=false;await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('次ターン受付 可'));
 closed=true;await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
 assert('瞬きで右目と眉を1回固定',document.querySelector('.game-target span').textContent.includes('1'));
 await sleep(900);assert('閉じたまま次パーツへ進まない',document.querySelector('main').dataset.gamePhase==='fixing');
 closed=false;await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 const canvas=document.querySelector('canvas');
 for(let turn=2;turn<=4;turn++){
  closed=true;
  await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
  assert('2回目以降も瞬きで1ターンだけ固定 '+turn,document.querySelector('.game-target span').textContent.includes(String(turn)));
  await sleep(100);closed=false;
  await wait(()=>document.querySelector('main').dataset.gamePhase===(turn===4?'completed':'playing'));
  if(turn<4)await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('次ターン受付 可'));
 }
 await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('成功 4回'));
 results.push('計測表示確認（30fps模擬入力・16msタイマー、実機FPSのベンチマークではない）:\n'+document.querySelector('.blink-debug-details pre').textContent.split('\n').filter(s=>s.includes('判定 ')||s.includes('合成 ')||s.includes('実測検出間隔')).join('\n'));
 assert('4ターンでライブ結果へ',!!document.querySelector('.game-result-card')&&!document.querySelector('.game-result-image'));
 const before=canvas.toDataURL(),count=feeds;overrideColor='#21f0a0';await sleep(400);
 assert('completed後も検出と描画が継続',feeds>count&&canvas.toDataURL()!==before);
 const card=document.querySelector('.game-result-card'),a=canvas.getBoundingClientRect(),b=card.getBoundingClientRect();
 results.push('結果レイアウト実測 canvas='+JSON.stringify({height:a.height,bottom:a.bottom})+' card='+JSON.stringify({top:b.top,bottom:b.bottom})+' scrollWidth='+document.documentElement.scrollWidth);
 assert('390×844で顔とカードが重ならず横スクロールなし',a.height>300&&a.bottom<=b.top+1&&b.bottom<=844&&document.documentElement.scrollWidth<=390);
 const live=canvas.toDataURL();card.querySelector('.secondary-button').click();
 assert('保存は押した瞬間の合成ライブCanvasのみ',saved===live);
 const savedCount=feeds;await sleep(300);assert('保存後もライブ処理を継続',feeds>savedCount);
 closed=true;await sleep(400);assert('completed後の瞬きで状態を変更しない',document.querySelector('main').dataset.gamePhase==='completed');
 closed=false;card.querySelector('.primary-button').click();await wait(()=>document.querySelector('main').dataset.gamePhase==='countdown');
 assert('リスタートで再キャリブレーション・結果解除',!document.querySelector('.game-result-card'));
 assert('リスタートの最初は3',document.querySelector('.game-countdown strong').textContent==='3');
 await sleep(300);
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
 await wait(()=>document.querySelector('main').dataset.gamePhase==='paused');await sleep(400);
 const pausedLabel=document.querySelector('.game-countdown strong').textContent;
 results.push('一時停止時計 '+JSON.stringify(document.querySelector('main').dataset)+' label='+pausedLabel+' now='+performance.now());
 assert('バックグラウンド相当では進行を一時停止',document.querySelector('main').dataset.gamePhase==='paused');
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));
 Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='再開').click();await wait(()=>document.querySelector('main').dataset.gamePhase==='countdown');
 results.push('再開時計 '+JSON.stringify(document.querySelector('main').dataset)+' now='+performance.now());
 await sleep(100);
 assert('再開で残りカウントダウンを保持',document.querySelector('.game-countdown strong')?.textContent===pausedLabel);
 await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('次ターン受付 可'));
 canvas.click();canvas.click();await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
 assert('連続タップは1ターンのみ固定',document.querySelector('.game-target span').textContent.includes('1'));
 const select=document.querySelector('[aria-label="ゲームデバッグ表示"]');
 select.value='blink-test';select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(100);
 document.querySelector('.blink-debug-details').open=true;
 Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='10回テスト開始').click();
 await wait(()=>{const text=document.querySelector('.blink-debug-details pre').textContent;return text.includes('測定中: 検出 0回')&&text.includes('再アーム 済');});
 for(let i=0;i<10;i++){closed=true;await sleep(100);closed=false;await sleep(330);}
 Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='測定終了').click();await sleep(250);
 const measurement=document.querySelector('.blink-debug-details pre').textContent;
 results.push('単独測定:\n'+measurement);
 assert('単独10回テストの検出数と各イベント時刻を表示',measurement.includes('停止: 検出 10回')&&measurement.split('イベント時刻(開始後秒): ')[1].split(', ').length===10);
 assert('瞬き単独テストでゲームは進行しない',document.querySelector('main').dataset.gamePhase==='ready');
 document.querySelector('.game-header-exit').click();await sleep(100);
 assert('通常simpleとランダムへ復帰',!!document.querySelector('.simple-random-button')&&document.querySelector('main').classList.contains('mode-camera'));
 document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack,'feeds='+feeds+' paintTick='+paintTick+' videoTime='+document.querySelector('video')?.currentTime+' hidden='+document.hidden,'DEBUG: '+document.querySelector('.blink-debug-details pre')?.textContent);document.documentElement.dataset.result='fail';}
finally{root.unmount();clearInterval(frameTimer);stream?.getTracks().forEach(t=>t.stop());CanvasRenderingContext2D.prototype.drawImage=drawImage;Object.defineProperty(HTMLMediaElement.prototype,'currentTime',videoTime);window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancelRaf;}
document.querySelector('#results').textContent=results.join('\n');
