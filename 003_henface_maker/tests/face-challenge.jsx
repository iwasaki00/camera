import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
import App from '../src/App.tsx';
import {createFixture} from './fixture.js';
import {renderGameFrame} from './render-game-frame.js';
import {createBlinkDropRenderer} from '../src/game/blinkDropRenderer.ts';
import {createBlinkDropSession,beginBlinkDrop,catchBlinkDropPart,advanceBlinkDrop,DIFFICULTY_MODES} from '../src/game/blinkDropGame.ts';
import {createChallengeRun,challengeTargetPosition,renderChallengeGuide,recordChallengeCatch,CHALLENGES} from '../src/game/faceChallenge.ts';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<700;i++){if(predicate())return;await sleep(10);}throw Error('UI wait timed out '+document.querySelector('main')?.dataset.gamePhase);};
const choose=(selector,value)=>{const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
const click=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)?.click();
const phase=()=>document.querySelector('main')?.dataset.gamePhase;
const {base,landmarks}=createFixture();
const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const bounds=c=>{const data=pixels(c);let left=Infinity,top=Infinity,right=0,bottom=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}return{left,top,right,bottom};};
function testGuide(){
  const renderer=createBlinkDropRenderer(),g=renderer.getGeometry(landmarks,480,640);
  let session={...beginBlinkDrop(createBlinkDropSession('countdown','MONSTER'),100),gameMode:'challenge',challenge:createChallengeRun('chaosFace','MONSTER')};
  const guide=document.createElement('canvas');guide.width=480;guide.height=640;const ctx=guide.getContext('2d');
  const original=base.toDataURL();renderChallengeGuide(ctx,g,session);const a=bounds(guide);
  assert('目と眉のガイドを別Canvasへ描画・元映像は不変',a.left<Infinity&&a.bottom-a.top>30&&base.toDataURL()===original);
  const shifted={...g,pose:{...g.pose,center:{x:g.pose.center.x+18,y:g.pose.center.y+13}},parts:Object.fromEntries(Object.entries(g.parts).map(([k,p])=>[k,{...p,center:{x:p.center.x+18,y:p.center.y+13},contour:p.contour.map(q=>({x:q.x+18,y:q.y+13}))}])),skinOutline:g.skinOutline.map(p=>({x:p.x+18,y:p.y+13}))};
  renderChallengeGuide(ctx,shifted,session);const b=bounds(guide);assert('ガイドは顔の移動量に一致して追従',Math.abs(b.left-a.left-18)<2&&Math.abs(b.top-a.top-13)<2);
  const expected=challengeTargetPosition(g,0,session.challenge.targets[0]);
  assert('ガイドの目標と既存落下の固定座標が一致',Math.hypot(expected.x-renderer.turnPosition(landmarks,480,640,0,session.challenge.targets[0]).x,expected.y-renderer.turnPosition(landmarks,480,640,0,session.challenge.targets[0]).y)<1e-12);
  for(const angle of [.3,-.25]){
    const scale=.85,dx=-12,dy=8,c=Math.cos(angle),s=Math.sin(angle),center=g.pose.center;
    const lm=landmarks.map(p=>{const x=(1-p.x)*480-center.x,y=p.y*640-center.y;return{x:1-(center.x+dx+scale*(c*x-s*y))/480,y:(center.y+dy+scale*(s*x+c*y))/640};});
    const geometry=renderer.getGeometry(lm,480,640);renderChallengeGuide(ctx,geometry,session);const moved=bounds(guide);
    const goal=challengeTargetPosition(geometry,0,session.challenge.targets[0]);
    const screen={x:geometry.pose.center.x+geometry.pose.scale*(Math.cos(geometry.pose.angle)*goal.x-Math.sin(geometry.pose.angle)*goal.y),y:geometry.pose.center.y+geometry.pose.scale*(Math.sin(geometry.pose.angle)*goal.x+Math.cos(geometry.pose.angle)*goal.y)};
    assert('回転 '+angle+'・倍率・移動した顔の目標がガイド内にある',screen.x>=moved.left&&screen.x<=moved.right&&screen.y>=moved.top&&screen.y<=moved.bottom);
  }
  renderChallengeGuide(ctx,null,session);assert('顔未検出時にガイドを消去',bounds(guide).left===Infinity);
  for(let i=0;i<4;i++){
    const target=session.challenge.targets[i],at=session.partStartedAt+target.progress*DIFFICULTY_MODES.MONSTER.durationMs;
    session=recordChallengeCatch(catchBlinkDropPart(session,at,challengeTargetPosition(g,i,target),renderer.turnBrowOffset(landmarks,480,640,i)),g);
    session=advanceBlinkDrop(session,at+450);
  }
  const photo=renderGameFrame(renderer,base,landmarks,session,10000).toDataURL();renderChallengeGuide(ctx,g,session);
  assert('完成ガイドなし・採点情報は合成画像に入らない',bounds(guide).left===Infinity&&renderGameFrame(renderer,base,landmarks,{...session,gameMode:'free',challenge:undefined},10000).toDataURL()===photo);
}
let root,stream,timer,feeds=0,tick=0,eyes=1,mouth=.1;
const drawImage=CanvasRenderingContext2D.prototype.drawImage,videoTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
const raf=window.requestAnimationFrame,cancelRaf=window.cancelAnimationFrame;
try{
  testGuide();
  // Input camera/model are synthetic; React, Canvas and the elapsed clock run in the browser.
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){return drawImage.call(this,image instanceof HTMLVideoElement?base:image,...args);};
  Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get:()=>Math.floor(performance.now()/33)*.033,set(){}});
  window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);
  FilesetResolver.forVisionTasks=async()=>({});
  FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>{
    feeds++;const lm=landmarks.map(p=>({...p}));
    for(const [outer,inner,pairs,cx] of [[362,263,[[386,374,-.015],[385,380,.015]],.365],[33,133,[[159,145,-.015],[158,153,.015]],.635]]){
      lm[outer]={x:cx-.073,y:235/640};lm[inner]={x:cx+.073,y:235/640};
      for(const [a,b,dx] of pairs){lm[a]={x:cx+dx,y:235/640-.021*eyes};lm[b]={x:cx+dx,y:235/640+.021*eyes};}
    }
    lm[61]={x:.39,y:410/640};lm[291]={x:.61,y:410/640};lm[13]={x:.5,y:410/640-.11*mouth};lm[14]={x:.5,y:410/640+.11*mouth};
    return {faceLandmarks:[lm]};
  },close(){}});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    stream=base.captureStream(0);timer=setInterval(()=>{base.getContext('2d').fillStyle=`rgb(${++tick%256},60,200)`;base.getContext('2d').fillRect(0,0,7,7);stream.getVideoTracks()[0].requestFrame();},33);return stream;
  }});
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
  history.replaceState(null,'','?');localStorage.setItem('henface.face-triggers',JSON.stringify({blink:false,eyesWide:true,mouthOpen:false}));
  root=createRoot(document.querySelector('#app'));root.render(<App/>);await sleep(80);
  assert('入口の正式名称',document.querySelector('.game-entry-button').textContent.includes('カオストップ！'));
  document.querySelector('.game-entry-button').click();await sleep(60);
  assert('ゲームタイトル・サブタイトル・初期FREE',document.querySelector('h1').textContent==='カオストップ！'&&document.querySelector('.app-subtitle').textContent==='表情で止めて、変顔を完成させよう！'&&document.querySelector('.game-mode-buttons button').getAttribute('aria-pressed')==='true');
  document.querySelector('.game-operation-details').open=true;
  assert('名称変更で操作の保存値を失わない',!document.querySelector('[aria-label="瞬きで固定"]').checked&&document.querySelector('[aria-label="目を大きく開けるで固定"]').checked&&!document.querySelector('[aria-label="口を大きく開けるで固定"]').checked);
  document.querySelector('[aria-label="瞬きで固定"]').click();await sleep(20);document.querySelector('[aria-label="口を大きく開けるで固定"]').click();await sleep(20);
  document.querySelector('.game-operation-details').open=false;
  click('CHALLENGE · お題');await sleep(50);
  const select=document.querySelector('[aria-label="チャレンジのお題"]');assert('5種類のお題を選択可能',select.options.length===5);
  for(const challenge of CHALLENGES){choose('[aria-label="チャレンジのお題"]',challenge.id);await sleep(20);assert(challenge.code+'の説明を表示',document.querySelector('.game-mode-settings').textContent.includes(challenge.description));}
  choose('[aria-label="ゲーム難易度"]','EASY');choose('[aria-label="チャレンジのお題"]','perfect');await sleep(40);
  const rect=document.querySelector('.game-start-panel .primary-button').getBoundingClientRect();assert('390×844で開始ボタン・モード設定が表示され横スクロールなし',rect.bottom<=844&&rect.top>=0&&document.documentElement.scrollWidth===390);
  click('ゲームスタート');await wait(()=>phase()==='countdown');assert('お題の開始案内・選択を開始時に確定',document.querySelector('.game-countdown').textContent.includes('ぴったり顔に挑戦！')&&!document.querySelector('[aria-label="チャレンジのお題"]'));
  const canvas=document.querySelector('canvas'),guide=document.querySelector('.challenge-guide');
  for(let turn=0;turn<4;turn++){
    await wait(()=>phase()==='playing');const started=performance.now();
    await wait(()=>bounds(guide).left<Infinity);
    assert('ターン'+(turn+1)+'はお題・目標ガイドを表示',document.querySelector('.game-challenge-name').textContent==='ぴったり顔'&&guide.width===canvas.width&&guide.height===canvas.height);
    if(turn===0){const current=canvas.toDataURL();click('通常へ戻る');await sleep(50);assert('途中退出で通常モードへ戻る・ガイド消去',document.querySelector('main').classList.contains('mode-camera')&&bounds(guide).left===Infinity);document.querySelector('.game-entry-button').click();await sleep(50);click('ゲームスタート');await wait(()=>phase()==='playing');}
    const at=turn===0?performance.now():started;
    await sleep(Math.max(0,at+DIFFICULTY_MODES.EASY.durationMs*.75-performance.now()));
    canvas.click();canvas.click();await wait(()=>phase()==='fixing');assert('固定'+(turn+1)+'の得点・ランクを表示、連打でも1ターン',!!document.querySelector('.challenge-feedback')&&document.querySelector('.game-target span').textContent.includes((turn+1)+' / 4'));
    if(turn<3)await wait(()=>phase()==='playing');
  }
  await wait(()=>phase()==='completed');const card=document.querySelector('.game-result-card');
  const score=Number(card.querySelector('strong').textContent.match(/\d+/)[0]);assert('4パーツの総合スコア・ランク・お題・個別得点',score>=95&&card.textContent.includes('PERFECT')&&card.textContent.includes('ぴったり顔')&&card.textContent.includes('パーツ得点'));
  assert('完成時はガイドを消去',bounds(guide).left===Infinity);
  const feed=feeds,photo=canvas.toDataURL();assert('CHALLENGE結果画面に保存ボタンなし',!card.textContent.includes('写真を保存'));await sleep(220);assert('完成後もライブ更新',feeds>feed&&canvas.toDataURL()!==photo);
  const imageBox=canvas.getBoundingClientRect(),cardBox=card.getBoundingClientRect();results.push('結果実測 顔高さ '+imageBox.height+' 顔下端 '+imageBox.bottom+' カード上端 '+cardBox.top+' 下端 '+cardBox.bottom+' / 総合 '+score+'点');assert('完成顔と結果が重ならず390×844内',imageBox.bottom<=cardBox.top+1&&cardBox.bottom<=844&&imageBox.height>300);
  click('もう一回');await wait(()=>phase()==='countdown');assert('リスタートで同じお題・得点初期化',document.querySelector('.game-countdown').textContent.includes('ぴったり顔に挑戦！')&&!document.querySelector('.game-result-card'));
  await wait(()=>phase()==='playing');eyes=.25;await wait(()=>phase()==='fixing');assert('CHALLENGEでも瞬きで固定',!!document.querySelector('.challenge-feedback'));eyes=1;await wait(()=>phase()==='playing');await sleep(250);
  eyes=1.45;await wait(()=>phase()==='fixing');assert('CHALLENGEでも見開きで固定',!!document.querySelector('.challenge-feedback'));eyes=1;await wait(()=>phase()==='playing');await sleep(250);
  mouth=.7;await wait(()=>phase()==='fixing');assert('CHALLENGEでも開口で固定',!!document.querySelector('.challenge-feedback'));mouth=.1;await wait(()=>phase()==='playing');await sleep(250);
  canvas.click();await wait(()=>phase()==='completed');assert('リスタート後も4操作で完成、前回得点を持ち越さない',Number(document.querySelector('.game-result-card strong').textContent.match(/\d+/)[0])<score);
  click('モード選択へ戻る');await wait(()=>phase()==='ready');assert('モード選択へ戻り得点を解除・お題選択を保持',!document.querySelector('.game-result-card')&&document.querySelector('[aria-label="チャレンジのお題"]').value==='perfect');
  click('FREE · フリー');await sleep(30);assert('FREEへ切替でお題UIを隠す',!document.querySelector('[aria-label="チャレンジのお題"]'));
  click('ゲームスタート');await wait(()=>phase()==='playing');canvas.click();await wait(()=>phase()==='fixing');assert('FREEにチャレンジ得点やガイドを持ち越さない',!document.querySelector('.challenge-feedback')&&bounds(guide).left===Infinity);
  click('通常へ戻る');await sleep(50);assert('通常のsimple・ランダム設定は維持',document.querySelector('[aria-label="ランダム強度"]').value==='monster'&&!!document.querySelector('.simple-random-button'));
  document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
finally{root?.unmount();clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());CanvasRenderingContext2D.prototype.drawImage=drawImage;Object.defineProperty(HTMLMediaElement.prototype,'currentTime',videoTime);window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancelRaf;}
document.querySelector('#results').textContent=results.join('\n');
