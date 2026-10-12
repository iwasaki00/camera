import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
import App from '../src/App.tsx';
import {createFixture} from './fixture.js';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const main=()=>document.querySelector('main');
const phase=()=>main()?.dataset.gamePhase;
const debug=()=>document.querySelector('.blink-debug-details pre')?.textContent??'';
const wait=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await sleep(40);}throw Error('UI wait timed out: '+phase()+' '+debug());};
const clickText=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click();
const choose=(selector,value)=>{const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
const checkbox=label=>document.querySelector('[aria-label="'+label+'で固定"]');
const {base,landmarks}=createFixture();
let eyes=1,mouth=.1,found=true,feeds=0,stream,timer,root,tick=0,saved;
const drawImage=CanvasRenderingContext2D.prototype.drawImage;
const currentTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
const raf=window.requestAnimationFrame,cancelRaf=window.cancelAnimationFrame;
const anchorClick=HTMLAnchorElement.prototype.click;
try {
  // Real React/DOM/Canvas and real elapsed time; camera/model inputs are synthetic.
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){return drawImage.call(this,image instanceof HTMLVideoElement?base:image,...args);};
  Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get:()=>Math.floor(performance.now()/33)*.033,set(){}});
  window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);
  FilesetResolver.forVisionTasks=async()=>({});
  FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>{
    feeds++;if(!found)return {faceLandmarks:[]};const lm=landmarks.map(p=>({...p}));
    for(const [outer,inner,pairs,cx] of [[362,263,[[386,374,-.015],[385,380,.015]],.365],[33,133,[[159,145,-.015],[158,153,.015]],.635]]) {
      lm[outer]={x:cx-.073,y:235/640};lm[inner]={x:cx+.073,y:235/640};
      for(const [a,b,dx] of pairs){lm[a]={x:cx+dx,y:235/640-.042*eyes/2};lm[b]={x:cx+dx,y:235/640+.042*eyes/2};}
    }
    lm[61]={x:.39,y:410/640};lm[291]={x:.61,y:410/640};
    lm[13]={x:.5,y:410/640-.11*mouth};lm[14]={x:.5,y:410/640+.11*mouth};
    return {faceLandmarks:[lm]};
  },close(){}});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    clearInterval(timer);stream=base.captureStream(0);timer=setInterval(()=>{
      base.getContext('2d').fillStyle=`rgb(${++tick%256},64,200)`;base.getContext('2d').fillRect(0,0,7,7);
      stream.getVideoTracks()[0].requestFrame();
    },33);return stream;
  }});
  HTMLAnchorElement.prototype.click=function(){saved=this.href;};
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
  history.replaceState(null,'','?debug=1');localStorage.clear();
  root=createRoot(document.querySelector('#app'));root.render(<App/>);await sleep(80);
  clickText('👁 カオストップ！');await sleep(80);
  assert('初期3操作ON、NORMALは独立',checkbox('瞬き').checked&&checkbox('目を大きく開ける').checked&&checkbox('口を大きく開ける').checked&&document.querySelector('[aria-label="ゲーム難易度"]').value==='NORMAL');
  const start=document.querySelector('.game-start-panel .primary-button').getBoundingClientRect();
  assert('390×844で開始・操作設定が画面内、横スクロールなし',start.top>=0&&start.bottom<=844&&checkbox('口を大きく開ける').getBoundingClientRect().bottom<=844&&document.documentElement.scrollWidth===390);
  checkbox('目を大きく開ける').click();checkbox('口を大きく開ける').click();await sleep(60);
  // Remount verifies actual localStorage restoration into React and detector config.
  root.unmount();root=createRoot(document.querySelector('#app'));root.render(<App/>);await sleep(80);clickText('👁 カオストップ！');await sleep(60);
  assert('保存した操作ON/OFFを再起動で復元',checkbox('瞬き').checked&&!checkbox('目を大きく開ける').checked&&!checkbox('口を大きく開ける').checked);
  choose('[aria-label="ゲームデバッグ表示"]','parts-only');await sleep(60);
  assert('デバッグでも難易度・3操作を重複なく設定可能',document.querySelectorAll('[aria-label="ゲーム難易度"]').length===1&&document.querySelectorAll('.game-trigger-settings').length===1);
  checkbox('目を大きく開ける').click();await sleep(30);checkbox('口を大きく開ける').click();await sleep(30);
  choose('[aria-label="ゲームデバッグ表示"]','normal');await sleep(60);
  clickText('ゲームスタート');await wait(()=>phase()==='countdown');
  assert('3表示、開始後は操作設定を変更できない',document.querySelector('.game-countdown strong').textContent==='3'&&!checkbox('瞬き'));
  await wait(()=>document.querySelector('.game-countdown strong')?.textContent==='2');assert('カウントダウン2',true);
  await wait(()=>document.querySelector('.game-countdown strong')?.textContent==='1');assert('カウントダウン1',true);
  await wait(()=>phase()==='playing');await sleep(300);
  eyes=.25;await wait(()=>phase()==='fixing');assert('BLINKで右目と眉を固定',document.querySelector('.game-target span').textContent.includes('1 / 4'));
  eyes=1;await wait(()=>phase()==='playing');await sleep(650);
  eyes=1.45;await wait(()=>phase()==='fixing');assert('EYES_WIDEで左目と眉を固定',document.querySelector('.game-target span').textContent.includes('2 / 4'));
  await sleep(900);assert('見開きを保持しても次ターンを固定しない',phase()==='playing'&&document.querySelector('.game-target span').textContent.includes('3 / 4'));
  eyes=1;await sleep(650);
  mouth=.7;await wait(()=>phase()==='fixing');assert('MOUTH_OPENで鼻を固定',document.querySelector('.game-target span').textContent.includes('3 / 4'));
  await sleep(900);assert('開口を保持しても次ターンを固定しない',phase()==='playing'&&document.querySelector('.game-target span').textContent.includes('4 / 4'));
  const canvas=document.querySelector('canvas');canvas.click();canvas.click();await wait(()=>phase()==='fixing');
  assert('ニュートラル待機中でもTAPで救済、連打で二重固定なし',document.querySelector('.game-target span').textContent.includes('4 / 4'));
  await wait(()=>phase()==='completed');assert('4ターンで完成',!!document.querySelector('.game-result-card'));
  const previous=feeds;await sleep(250);assert('完成後もライブ処理・結果表示を継続',feeds>previous&&phase()==='completed');
  const live=canvas.toDataURL();clickText('写真を保存');assert('写真保存は現在の合成Canvas、デバッグは含まない',saved===live);
  clickText('もう一回');mouth=.1;eyes=1;await wait(()=>phase()==='countdown');
  await wait(()=>debug().includes('表情検出数 瞬き 0 / 見開き 0 / 開口 0'));assert('リスタートで全検出数を初期化',true);
  await wait(()=>phase()==='playing');found=false;await sleep(300);canvas.click();await sleep(100);assert('顔未検出時はタップでも誤固定しない',phase()==='playing'&&document.querySelector('.game-target span').textContent.includes('1 / 4'));found=true;
  choose('[aria-label="ゲームデバッグ表示"]','blink-test');await sleep(100);
  document.querySelector('.blink-debug-details').open=true;clickText('表情テスト開始');await sleep(850);
  eyes=1.45;await wait(()=>debug().includes('表情イベント(開始後秒): EYES_WIDE'));
  eyes=1;await sleep(650);mouth=.7;await wait(()=>debug().includes('MOUTH_OPEN'));
  mouth=.1;await sleep(650);eyes=.25;await wait(()=>debug().includes('BLINK '));eyes=1;
  assert('表情単独テストで3操作の時刻・状態を表示、ゲームを進めない',phase()==='ready'&&debug().includes('見開き')&&debug().includes('口 開き比率')&&debug().includes('再アーム'));
  clickText('測定終了');await sleep(250);assert('測定終了後も記録を確認可能',debug().includes('表情単独テスト 停止')&&debug().includes('MOUTH_OPEN'));
  clickText('10回テスト開始');await sleep(850);
  for(let i=0;i<10;i++){eyes=.25;await sleep(100);eyes=1;await sleep(330);}
  clickText('測定終了');await sleep(250);
  assert('既存の10回瞬きテストは短い間隔でも10回検出',debug().includes('停止: 検出 10回')&&phase()==='ready');
  clickText('通常へ戻る');await sleep(80);assert('通常モード・simple・ランダムmonsterを維持',main().classList.contains('layout-simple')&&document.querySelector('[aria-label="ランダム強度"]').value==='monster'&&!!document.querySelector('.simple-random-button'));
  document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
finally {
  root?.unmount();clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());
  CanvasRenderingContext2D.prototype.drawImage=drawImage;Object.defineProperty(HTMLMediaElement.prototype,'currentTime',currentTime);
  window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancelRaf;HTMLAnchorElement.prototype.click=anchorClick;
}
document.querySelector('#results').textContent=results.join('\n');
