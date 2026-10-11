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
let closed=false,feeds=0,frameTimer,stream,overrideColor;
const setEyes=(lm,gap)=>{
 for(const [outer,inner,pairs,cx] of [[362,263,[[386,374,-.015],[385,380,.015]],.365],[33,133,[[159,145,-.015],[158,153,.015]],.635]]){
  lm[outer]={x:cx-.073,y:235/640};lm[inner]={x:cx+.073,y:235/640};
  for(const [top,bottom,dx] of pairs){lm[top]={x:cx+dx,y:235/640-gap/2};lm[bottom]={x:cx+dx,y:235/640+gap/2};}
 }
};
FilesetResolver.forVisionTasks=async()=>({});
FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>{feeds++;const lm=landmarks.map(p=>({...p}));setEyes(lm,closed?.007:.042);return{faceLandmarks:[lm]};},close(){}});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
 stream=base.captureStream(30);
 frameTimer=setInterval(()=>{const ctx=base.getContext('2d');ctx.fillStyle=overrideColor??(feeds%2?'#df9344':'#6493df');ctx.fillRect(0,0,20,20);},33);
 return stream;
}});
const root=createRoot(document.querySelector('#app'));
let saved;
HTMLAnchorElement.prototype.click=function(){saved=this.href;};
try{
 history.replaceState(null,'','?debug=1');localStorage.setItem('henface.layout','simple');
 root.render(<App/>);await sleep(100);document.querySelector('.game-entry-button').click();await sleep(100);
 document.querySelector('.game-start-panel .primary-button').click();
 await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 assert('開始時キャリブレーションと顔検出を実行',feeds>10&&document.querySelector('.blink-debug-details pre').textContent.includes('ready'));
 closed=true;await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
 assert('瞬きで右目と眉を1回固定',document.querySelector('.game-target span').textContent.includes('1'));
 await sleep(900);assert('閉じたまま次パーツへ進まない',document.querySelector('main').dataset.gamePhase==='fixing');
 closed=false;await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 const canvas=document.querySelector('canvas');
 for(let turn=2;turn<=4;turn++){
  canvas.click();canvas.click();
  await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
  assert('連続タップで1ターンだけ固定 '+turn,document.querySelector('.game-target span').textContent.includes(String(turn)));
  await wait(()=>document.querySelector('main').dataset.gamePhase===(turn===4?'completed':'playing'));
  if(turn<4)await sleep(250);
 }
 assert('4ターンでライブ結果へ',!!document.querySelector('.game-result-card')&&!document.querySelector('.game-result-image'));
 const before=canvas.toDataURL(),count=feeds;overrideColor='#21f0a0';await sleep(400);
 assert('completed後も検出と描画が継続',feeds>count&&canvas.toDataURL()!==before);
 const card=document.querySelector('.game-result-card'),a=canvas.getBoundingClientRect(),b=card.getBoundingClientRect();
 assert('390×844で顔とカードが重ならず横スクロールなし',a.height>300&&a.bottom<=b.top+1&&b.bottom<=844&&document.documentElement.scrollWidth<=390);
 const live=canvas.toDataURL();card.querySelector('.secondary-button').click();
 assert('保存は押した瞬間の合成ライブCanvasのみ',saved===live);
 const savedCount=feeds;await sleep(300);assert('保存後もライブ処理を継続',feeds>savedCount);
 closed=true;await sleep(400);assert('completed後の瞬きで状態を変更しない',document.querySelector('main').dataset.gamePhase==='completed');
 closed=false;card.querySelector('.primary-button').click();await wait(()=>document.querySelector('main').dataset.gamePhase==='countdown');
 assert('リスタートで再キャリブレーション・結果解除',!document.querySelector('.game-result-card'));
 document.querySelector('.game-header-exit').click();await sleep(100);
 assert('通常simpleとランダムへ復帰',!!document.querySelector('.simple-random-button')&&document.querySelector('main').classList.contains('mode-camera'));
 document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
finally{root.unmount();clearInterval(frameTimer);stream?.getTracks().forEach(t=>t.stop());}
document.querySelector('#results').textContent=results.join('\n');
