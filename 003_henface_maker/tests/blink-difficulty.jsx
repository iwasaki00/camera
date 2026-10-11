import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
import App from '../src/App.tsx';
import {createFixture} from './fixture.js';
import {createBlinkDropRenderer} from '../src/game/blinkDropRenderer.ts';
import {createBlinkDropSession,beginBlinkDrop,fallingStateAt,catchBlinkDropPart,advanceBlinkDrop,pauseBlinkDrop} from '../src/game/blinkDropGame.ts';
import '../src/styles.css';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);document.querySelector('#results').textContent=results.join('\n');if(!ok)throw Error(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;await sleep(40);}throw Error('UI wait timed out; phase='+document.querySelector('main')?.dataset.gamePhase+'; '+document.querySelector('#app')?.textContent);};
const pixels=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const colorNear=(canvas,point,color)=>{
 const data=pixels(canvas);
 for(let y=Math.round(point.y)-4;y<=Math.round(point.y)+4;y++)for(let x=Math.round(point.x)-4;x<=Math.round(point.x)+4;x++){
  if(x<0||y<0||x>=canvas.width||y>=canvas.height)continue;
  const i=(y*canvas.width+x)*4;
  if(color.reduce((sum,c,j)=>sum+Math.abs(c-data[i+j]),0)<90)return true;
 }
 return false;
};

function testRenderer(){
 const {base,landmarks}=createFixture(),ctx=base.getContext('2d');
 const markers=[{kind:'rightEye',x:305,y:235,rgb:[250,20,90]}, {kind:'rightBrow',x:305,y:191,rgb:[20,250,80]},
  {kind:'leftEye',x:175,y:235,rgb:[20,90,250]}, {kind:'leftBrow',x:175,y:191,rgb:[250,240,20]},
  {kind:'nose',x:240,y:315,rgb:[210,20,240]}, {kind:'mouth',x:240,y:410,rgb:[20,240,240]}];
 for(const m of markers){ctx.fillStyle=`rgb(${m.rgb.join(',')})`;ctx.fillRect(m.x-3,m.y-3,7,7);}
 const out=document.createElement('canvas');out.width=480;out.height=640;const dest=out.getContext('2d');
 const renderer=createBlinkDropRenderer(),g=renderer.getGeometry(landmarks,480,640);
 const toTarget=(session,m,pose=g.pose)=>{
  const index={rightEye:0,rightBrow:0,leftEye:1,leftBrow:1,nose:2,mouth:3}[m.kind];
  const position=session.fixedPositions[index], transform=session.fixedTransforms[index];
  const main=g.parts[['rightEye','leftEye','nose','mouth'][index]];
  const dx=(m.x-main.center.x)/g.pose.scale,dy=(m.y-main.center.y)/g.pose.scale;
  const c=Math.cos(transform.rotation),s=Math.sin(transform.rotation);
  const x=position.x+transform.scale*(c*dx-s*dy),y=position.y+transform.scale*(s*dx+c*dy);
  return {x:pose.center.x+pose.scale*(Math.cos(pose.angle)*x-Math.sin(pose.angle)*y),
   y:pose.center.y+pose.scale*(Math.sin(pose.angle)*x+Math.cos(pose.angle)*y)};
 };
 // Legacy NORMAL coordinates remain unchanged for both separately extracted images.
 for(const [index,kind] of [[0,'rightEye'],[1,'leftEye']]){
  const session={...beginBlinkDrop(createBlinkDropSession(),1000),currentIndex:index};
  const motion=fallingStateAt(session,2200),old=renderer.turnPosition(landmarks,480,640,index,-2),current=renderer.turnPosition(landmarks,480,640,index,motion);
  assert(kind+' NORMALは従来の基準座標と一致',JSON.stringify(old)===JSON.stringify(current));
  renderer.render(base,dest,landmarks,session,2200,'parts-only');
  for(const marker of markers.filter(m=>m.kind===kind||m.kind===(index===0?'rightBrow':'leftBrow')))
   assert(marker.kind+' NORMALの既存落下座標に描画',colorNear(out,{x:marker.x,y:marker.y-2*g.parts[kind].dropHeight},marker.rgb));
 }
 let session=beginBlinkDrop(createBlinkDropSession('countdown','MONSTER'),1000);
 for(let turn=0;turn<4;turn++){
  const at=session.partStartedAt+1500*.68,motion=fallingStateAt(session,at);
  const position=renderer.turnPosition(landmarks,480,640,turn,motion),browOffset=renderer.turnBrowOffset(landmarks,480,640,turn);
  renderer.render(base,dest,landmarks,session,at,'parts-only');
  const before=pixels(out).slice();
  const caught=catchBlinkDropPart(session,at,position,browOffset);
  renderer.render(base,dest,landmarks,caught,at+300,'parts-only');
  assert('ターン'+(turn+1)+'は落下中と固定直後が同じ位置・角度・倍率',equal(before,pixels(out)));
  const paused=pauseBlinkDrop(caught,at+350);renderer.render(base,dest,landmarks,paused,at+9000,'parts-only');
  assert('ターン'+(turn+1)+' FIXING/PAUSEDで動かない',equal(before,pixels(out)));
  session=advanceBlinkDrop(caught,at+450);
 }
 assert('4ターンでMONSTER完成',session.phase==='completed');
 renderer.render(base,dest,landmarks,session,10000,'parts-only');
 for(const marker of markers)assert(marker.kind+'の固定回転・倍率・目眉ペアを保持',colorNear(out,toTarget(session,marker),marker.rgb));
 const angle=.23,scale=.85,dx=-14,dy=8,c=Math.cos(angle),s=Math.sin(angle);
 const moved=document.createElement('canvas');moved.width=480;moved.height=640;const mc=moved.getContext('2d');
 mc.translate(g.pose.center.x+dx,g.pose.center.y+dy);mc.rotate(angle);mc.scale(scale,scale);mc.translate(-g.pose.center.x,-g.pose.center.y);mc.drawImage(base,0,0);
 const move=(x,y)=>({x:g.pose.center.x+dx+scale*(c*(x-g.pose.center.x)-s*(y-g.pose.center.y)),y:g.pose.center.y+dy+scale*(s*(x-g.pose.center.x)+c*(y-g.pose.center.y))});
 const lm=landmarks.map(p=>{const q=move((1-p.x)*480,p.y*640);return{x:1-q.x/480,y:q.y/640};});
 const pose=renderer.getGeometry(lm,480,640).pose;
 renderer.render(moved,dest,lm,session,10033,'parts-only');
 for(const marker of markers)assert(marker.kind+'は完成後も顔の移動・傾き・倍率に追従',colorNear(out,toTarget(session,marker,pose),marker.rgb));
 renderer.render(moved,dest,lm,session,10066);const live=pixels(out).slice();
 const saved=renderer.captureFrame(moved,lm,session,10066);
 assert('保存フレームは現在のMONSTER合成画像',equal(live,pixels(saved))&&saved.toDataURL().startsWith('data:image/png'));
 mc.setTransform(1,0,0,1,0,0);mc.fillStyle='#f04466';mc.fillRect(0,0,20,20);
 renderer.render(moved,dest,lm,session,10100);assert('完成後もライブフレーム更新を継続',!equal(live,pixels(out)));
 assert('保存済みキャプチャは次フレームの変更を受けない',equal(live,pixels(saved)));
 for(const difficulty of ['NORMAL','MONSTER']){
  const test=beginBlinkDrop(createBlinkDropSession('countdown',difficulty),1000);
  for(let i=0;i<10;i++)renderer.render(base,dest,landmarks,test,1000+i*33);
  const started=performance.now();for(let i=0;i<40;i++)renderer.render(base,dest,landmarks,test,2200+i*33);
  results.push('参考 Canvas '+difficulty+' '+((performance.now()-started)/40).toFixed(2)+'ms/frame（PC、480×640、検出を除く）');
 }
}

const {base,landmarks}=createFixture();
let closed=false,feeds=0,stream,frameTimer,root,frameTick=0;
const drawImage=CanvasRenderingContext2D.prototype.drawImage;
const videoTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
const raf=window.requestAnimationFrame,cancelRaf=window.cancelAnimationFrame;
let saved;
const anchorClick=HTMLAnchorElement.prototype.click;
try{
 testRenderer();
 // A deterministic camera fixture for interaction checks; Canvas measurements above
 // are separate. This scheduler's FPS is not an iPhone performance measurement.
 CanvasRenderingContext2D.prototype.drawImage=function(image,...args){return drawImage.call(this,image instanceof HTMLVideoElement?base:image,...args);};
 Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get:()=>Math.floor(performance.now()/33)*.033,set(){}});
 window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);
 FilesetResolver.forVisionTasks=async()=>({});
 FaceLandmarker.createFromOptions=async()=>({detectForVideo:()=>{
  feeds++;const lm=landmarks.map(p=>({...p}));
  for(const [outer,inner,pairs,cx] of [[362,263,[[386,374,-.015],[385,380,.015]],.365],[33,133,[[159,145,-.015],[158,153,.015]],.635]]){
   lm[outer]={x:cx-.073,y:235/640};lm[inner]={x:cx+.073,y:235/640};
   for(const [top,bottom,dx] of pairs){lm[top]={x:cx+dx,y:235/640-(closed?.007:.042)/2};lm[bottom]={x:cx+dx,y:235/640+(closed?.007:.042)/2};}
  }
  return{faceLandmarks:[lm]};
 },close(){}});
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
  stream=base.captureStream(0);frameTimer=setInterval(()=>{
   const ctx=base.getContext('2d');ctx.fillStyle=`rgb(${++frameTick%256},64,200)`;ctx.fillRect(0,0,7,7);
   stream.getVideoTracks()[0].requestFrame();
  },33);return stream;
 }});
 HTMLAnchorElement.prototype.click=function(){saved=this.href;};
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 history.replaceState(null,'','?debug=1');localStorage.clear();
 root=createRoot(document.querySelector('#app'));root.render(<App/>);await sleep(80);
 document.querySelector('.game-entry-button').click();await sleep(80);
 const picker=document.querySelector('[aria-label="ゲーム難易度"]');
 assert('初期NORMAL・5つの難易度を選択可能',picker.value==='NORMAL'&&[...picker.options].map(o=>o.value).join(',')==='EASY,NORMAL,HARD,CHAOS,MONSTER');
 for(const value of ['EASY','HARD','CHAOS','MONSTER']){picker.value=value;picker.dispatchEvent(new Event('change',{bubbles:true}));await sleep(40);assert(value+'の説明と選択値が一致',picker.value===value&&document.querySelector('#game-difficulty-description').textContent.length>0);}
 const rect=picker.getBoundingClientRect();assert('390×844の難易度選択はタッチ可能・横スクロールなし',rect.height>=44&&rect.bottom<=844&&document.documentElement.scrollWidth===390);
 document.querySelector('.game-start-panel .primary-button').click();await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 assert('選択難易度を開始時に確定・プレイ中の変更UIなし',document.querySelector('.game-difficulty').textContent==='MONSTER'&&!document.querySelector('[aria-label="ゲーム難易度"]'));
 await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('次ターン受付 可'));
 closed=true;await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
 assert('MONSTERでも瞬きで右目と眉を1回固定',document.querySelector('.game-target span').textContent.includes('1 / 4'));
 closed=false;await wait(()=>document.querySelector('main').dataset.gamePhase==='playing');
 const canvas=document.querySelector('canvas');
 for(let turn=2;turn<=4;turn++){
  await wait(()=>document.querySelector('.blink-debug-details pre').textContent.includes('次ターン受付 可'));
  canvas.click();canvas.click();await wait(()=>document.querySelector('main').dataset.gamePhase==='fixing');
  assert('MONSTERタップ固定は1操作1ターン '+turn,document.querySelector('.game-target span').textContent.includes(turn+' / 4'));
  await wait(()=>document.querySelector('main').dataset.gamePhase===(turn===4?'completed':'playing'));
  await sleep(660);
 }
 const count=feeds;await sleep(180);assert('MONSTER完成後もライブ処理を継続',feeds>count&&!!document.querySelector('.game-result-card'));
 const current=canvas.toDataURL();document.querySelector('.game-result-card .secondary-button').click();assert('写真保存は押した瞬間の合成Canvas',saved===current);
 document.querySelector('.game-result-card .minor-button').click();await sleep(60);
 assert('ゲーム難易度と通常ランダム強度monsterは別設定',document.querySelector('[aria-label="ランダム強度"]')?.value==='monster');
 document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
finally{
 root?.unmount();clearInterval(frameTimer);stream?.getTracks().forEach(t=>t.stop());
 CanvasRenderingContext2D.prototype.drawImage=drawImage;Object.defineProperty(HTMLMediaElement.prototype,'currentTime',videoTime);
 window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancelRaf;HTMLAnchorElement.prototype.click=anchorClick;
}
document.querySelector('#results').textContent=results.join('\n');
