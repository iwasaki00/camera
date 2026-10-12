import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLandmarker, FilesetResolver} from '@mediapipe/tasks-vision';
import App from '../src/App.tsx';
import {createFixture} from './fixture.js';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const phase=()=>document.querySelector('main')?.dataset.gamePhase;
const click=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click();
const wait=async predicate=>{for(let i=0;i<180;i++){if(predicate())return;await sleep(30);}throw Error('UI wait timed out: '+phase());};
const noSave=()=>![...document.querySelectorAll('button')].some(b=>b.textContent.includes('写真を保存'));
const {base,landmarks}=createFixture();
let root,stream,timer,feeds=0,tick=0,downloads=[];
const drawImage=CanvasRenderingContext2D.prototype.drawImage,videoTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
const raf=window.requestAnimationFrame,cancelRaf=window.cancelAnimationFrame,anchorClick=HTMLAnchorElement.prototype.click;
async function finishRound(label){
  await wait(()=>phase()==='countdown');assert(label+' カウントダウン中に保存UIなし',noSave());
  await wait(()=>phase()==='playing');const canvas=document.querySelector('canvas');
  for(let turn=0;turn<4;turn++){
    assert(label+' プレイ中に保存UIなし '+(turn+1),noSave());
    canvas.click();await wait(()=>phase()==='fixing');
    await wait(()=>phase()===(turn===3?'completed':'playing'));if(turn<3)await sleep(260);
  }
  const card=document.querySelector('.game-result-card');
  assert(label+' 完成画面は保存なし・再挑戦とモード選択の2ボタン',[...card.querySelectorAll('button')].map(b=>b.textContent).join(',')==='もう一回,モード選択へ戻る'&&noSave());
  assert(label+' 評価とスコアを維持',label.startsWith('FREE')?card.textContent.includes('正解度')&&card.textContent.includes('変顔度'):card.textContent.includes('総合')&&card.textContent.includes('ぴったり顔'));
  const before=canvas.toDataURL(),detections=feeds;await sleep(220);
  assert(label+' 完成後も映像・検出を更新',feeds>detections&&canvas.toDataURL()!==before);
  const image=canvas.getBoundingClientRect(),panel=document.querySelector('.game-result-panel').getBoundingClientRect(),box=card.getBoundingClientRect(),frame=document.querySelector('.preview-frame').getBoundingClientRect();
  assert(label+' 完成映像が50px拡大し、結果と重ならず画面内',Math.abs(image.height-(frame.height-210))<1&&image.height>frame.height-260&&image.bottom<=box.top+1&&box.bottom<=844&&panel.height===200&&document.documentElement.scrollWidth===390);
  for(const b of card.querySelectorAll('button'))assert(label+' '+b.textContent+' タッチ高さ44px以上',b.getBoundingClientRect().height>=44);
  assert(label+' ゲームからダウンロードイベントが発生しない',downloads.length===1);
}
try{
  // Real DOM/Canvas/time, synthetic camera and landmark inputs.
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){return drawImage.call(this,image instanceof HTMLVideoElement?base:image,...args);};
  Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get:()=>Math.floor(performance.now()/33)*.033,set(){}});
  window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);
  FilesetResolver.forVisionTasks=async()=>({});
  FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>{
    feeds++;const lm=landmarks.map(p=>({...p}));
    for(const [outer,inner,pairs,cx] of [[362,263,[[386,374,-.015],[385,380,.015]],.365],[33,133,[[159,145,-.015],[158,153,.015]],.635]]){
      lm[outer]={x:cx-.073,y:235/640};lm[inner]={x:cx+.073,y:235/640};
      for(const [a,b,dx] of pairs){lm[a]={x:cx+dx,y:235/640-.021};lm[b]={x:cx+dx,y:235/640+.021};}
    }
    return {faceLandmarks:[lm]};
  },close(){}});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    stream=base.captureStream(0);timer=setInterval(()=>{const ctx=base.getContext('2d');ctx.fillStyle=`rgb(${++tick%256},70,200)`;ctx.fillRect(0,0,7,7);stream.getVideoTracks()[0].requestFrame();},33);return stream;
  }});
  HTMLAnchorElement.prototype.click=function(){downloads.push({url:this.href,name:this.download});};
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});history.replaceState(null,'','?');localStorage.clear();
  root=createRoot(document.querySelector('#app'));root.render(<App/>);await sleep(70);
  click('カメラ起動');await wait(()=>document.querySelector('.camera-toolbar .primary-button')?.textContent==='カメラ停止');await sleep(100);
  let normal=document.querySelector('canvas').toDataURL();click('写真を保存');
  assert('通常の写真保存は現在のCanvasをPNG・既存ファイル名で保存',downloads.length===1&&downloads[0].url===normal&&downloads[0].url.startsWith('data:image/png')&&/^henface-maker-\d+\.png$/.test(downloads[0].name));
  document.querySelector('.game-entry-button').click();await sleep(50);
  for(const mode of ['FREE','CHALLENGE']){
    click(mode==='FREE'?'FREE · フリー':'CHALLENGE · お題');await sleep(40);
    click('ゲームスタート');await finishRound(mode);
    click('もう一回');await finishRound(mode+' 再挑戦');
    click('モード選択へ戻る');await wait(()=>phase()==='ready');
    assert(mode+' モード選択へ戻れる',!!document.querySelector('.game-mode-buttons')&&!document.querySelector('.game-result-card')&&noSave());
  }
  click('通常へ戻る');await sleep(60);normal=document.querySelector('canvas').toDataURL();click('写真を保存');
  assert('ゲーム退出後も通常の写真保存を維持',downloads.length===2&&downloads[1].url===normal);
  document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
finally{root?.unmount();clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());CanvasRenderingContext2D.prototype.drawImage=drawImage;Object.defineProperty(HTMLMediaElement.prototype,'currentTime',videoTime);window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancelRaf;HTMLAnchorElement.prototype.click=anchorClick;}
document.querySelector('#results').textContent=results.join('\n');
