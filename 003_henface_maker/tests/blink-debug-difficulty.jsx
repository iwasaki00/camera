import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLandmarker, FilesetResolver} from '@mediapipe/tasks-vision';
import App from '../src/App.tsx';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;await sleep(50);}throw Error('UI wait timed out: '+document.querySelector('#app')?.textContent);};
const choose=(selector,value)=>{const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
const camera=document.createElement('canvas');camera.width=240;camera.height=320;
const ctx=camera.getContext('2d');ctx.fillStyle='#856';ctx.fillRect(0,0,240,320);
let stream,timer,tick=0,root;
FilesetResolver.forVisionTasks=async()=>({});
FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>({faceLandmarks:[]}),close(){}});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
 stream=camera.captureStream(0);timer=setInterval(()=>{ctx.fillStyle=`rgb(${++tick%256},50,80)`;ctx.fillRect(0,0,10,10);stream.getVideoTracks()[0].requestFrame();},33);return stream;
}});
try{
 history.replaceState(null,'','?debug=1');localStorage.clear();
 root=createRoot(document.querySelector('#app'));root.render(<App/>);await sleep(80);
 document.querySelector('.game-entry-button').click();await sleep(60);
 assert('通常の開始HUDは初期NORMAL',document.querySelector('[aria-label="ゲーム難易度"]').value==='NORMAL');
 const modes=['parts-only','original','blank-face','bounds','blink-test'];
 const levels=['EASY','HARD','CHAOS','MONSTER','NORMAL'];
 for(let i=0;i<modes.length;i++){
  choose('[aria-label="ゲームデバッグ表示"]',modes[i]);await sleep(50);
  const pickers=document.querySelectorAll('[aria-label="ゲーム難易度"]'),picker=pickers[0];
  assert(modes[i]+'でも5レベルを1箇所で選択可能',pickers.length===1&&picker.options.length===5);
  const box=picker.getBoundingClientRect();assert(modes[i]+'の難易度選択が画面上で見える',box.width>0&&box.height>0&&box.right<=390&&box.bottom<=844);
  choose('[aria-label="ゲーム難易度"]',levels[i]);await sleep(40);
  choose('[aria-label="ゲームデバッグ表示"]','normal');await sleep(40);
  assert(modes[i]+'から通常HUDへ選択を引き継ぐ',document.querySelector('[aria-label="ゲーム難易度"]').value===levels[i]);
 }
 choose('[aria-label="ゲームデバッグ表示"]','parts-only');await sleep(40);
 choose('[aria-label="ゲーム難易度"]','MONSTER');await sleep(40);
 const start=[...document.querySelectorAll('.game-debug-tools button')].find(b=>b.textContent==='ゲームスタート');start.click();
 await wait(()=>document.querySelector('main')?.dataset.gamePhase==='countdown');
 assert('開始後は難易度を変更できない',!document.querySelector('[aria-label="ゲーム難易度"]'));
 await wait(()=>document.querySelector('main')?.dataset.gamePhase==='playing');
 assert('parts-onlyは選択したMONSTERで開始',document.querySelector('.game-difficulty')?.textContent==='MONSTER');
 document.querySelector('.game-mini-actions button:nth-child(2)').click();
 await wait(()=>document.querySelector('main')?.dataset.gamePhase==='countdown');
 await wait(()=>document.querySelector('main')?.dataset.gamePhase==='playing');
 assert('リスタートもMONSTERを維持',document.querySelector('.game-difficulty')?.textContent==='MONSTER');
 assert('390×844で横スクロールなし',document.documentElement.scrollWidth===390);
 document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
finally{root?.unmount();clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());}
document.querySelector('#results').textContent=results.join('\n');
