import {createFixture} from './fixture.js';
import {createBlinkDropRenderer} from '../src/game/blinkDropRenderer.ts';
import {createBlinkDropSession} from '../src/game/blinkDropGame.ts';
import {createChallengeRun} from '../src/game/faceChallenge.ts';
import {paintContourMask,roundedBand} from '../src/game/blinkDropMasks.ts';
import {paintCompletedMasks} from '../src/game/completedBlend.ts';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const canvas=(w=480,h=640)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const image=(label,c)=>{const wrap=document.createElement('div');wrap.append(label,c);c.style.width='240px';document.querySelector('#comparison').append(wrap);};
try{
  const oldMask=canvas(160,112),mask=canvas(160,112),ring=canvas(160,112),core=canvas(160,112),contour=roundedBand({x:.5,y:.5},.7,.65);
  paintContourMask(oldMask.getContext('2d'),160,112,contour,6);
  paintCompletedMasks(mask.getContext('2d'),ring.getContext('2d'),core.getContext('2d'),160,112,contour,8);
  const a=pixels(oldMask),b=pixels(mask),r=pixels(ring);
  const alpha=(data,x,y)=>data[(y*160+x)*4+3];
  assert('completedマスクは内部不透明・四隅透明',alpha(b,80,56)===255&&[0,159,160*111,160*112-1].every(i=>b[i*4+3]===0));
  assert('境界リングは中心に作用しない',alpha(r,80,56)===0&&r.some((v,i)=>i%4===3&&v>0));
  const maxJump=data=>{let n=0;for(let y=3;y<32;y++)n=Math.max(n,Math.abs(alpha(data,80,y)-alpha(data,80,y-1)));return n;};
  results.push('マスク外周の最大アルファ段差 旧 '+maxJump(a)+' → 新 '+maxJump(b));
  assert('外周のアルファ段差が減る',maxJump(b)<maxJump(a));
  const {base,landmarks}=createFixture(),ctx=base.getContext('2d');
  ctx.globalCompositeOperation='multiply';const gradient=ctx.createLinearGradient(0,80,480,530);gradient.addColorStop(0,'#aaa4a0');gradient.addColorStop(1,'#fff9f3');ctx.fillStyle=gradient;ctx.fillRect(0,0,480,640);ctx.globalCompositeOperation='source-over';
  const marks=[['rightEye',305,235,[250,20,90]],['rightBrow',305,191,[20,250,80]],['leftEye',175,235,[20,90,250]],['leftBrow',175,191,[250,240,20]],['nose',240,315,[210,20,240]],['mouth',240,410,[20,240,240]]];
  for(const [,x,y,color] of marks){ctx.fillStyle=`rgb(${color.join(',')})`;ctx.fillRect(x-3,y-3,7,7);}
  const old=createBlinkDropRenderer({completedPolish:false}),current=createBlinkDropRenderer(),g=current.getGeometry(landmarks,480,640);
  const before=canvas(),after=canvas(),dest=after.getContext('2d');
  const session={...createBlinkDropSession('completed'),currentIndex:3,fixedOffsets:[-1.4,-.6,-.45,.1],fixedTransforms:[null,null,null,null],fixedBrowOffsets:[null,null,null,null],fixedPositions:[null,null,null,null]};
  const render=(renderer,out,s=session,t=1000,lm=landmarks,source=base,mode='normal')=>renderer.render(source,out.getContext('2d'),lm,s,t,mode);
  const sourceBefore=pixels(base).slice();render(old,before);render(current,after);
  assert('completedだけ6パーツに補正を適用',current.metrics.polishedParts===6&&current.metrics.polishMs>0);
  assert('元映像は変更しない',equal(sourceBefore,pixels(base)));
  assert('completedの比較画像に変化がある',!equal(pixels(before),pixels(after)));
  results.push('色補正適用 '+current.metrics.polishColorParts+'パーツ / 小領域readback '+current.metrics.colorReads+'回');
  assert('周辺リングの色補正が機能する',current.metrics.polishColorParts>=4&&current.metrics.colorReads<=6);
  const indexFor=kind=>({rightEye:0,rightBrow:0,leftEye:1,leftBrow:1,nose:2,mouth:3})[kind];
  const positionFor=(kind,x,y,pose=g.pose)=>{const i=indexFor(kind),shift=session.fixedOffsets[i]*g.parts[kind].dropHeight;return{x:pose.center.x+((x-g.pose.center.x)*Math.cos(pose.angle)-(y+shift-g.pose.center.y)*Math.sin(pose.angle)),y:pose.center.y+((x-g.pose.center.x)*Math.sin(pose.angle)+(y+shift-g.pose.center.y)*Math.cos(pose.angle))};};
  const data=pixels(after);
  for(const [kind,x,y,color] of marks){const p=positionFor(kind,x,y),offset=(Math.round(p.y)*480+Math.round(p.x))*4;const difference=color.reduce((s,c,i)=>s+Math.abs(c-data[offset+i]),0);assert(kind+'の中心色・細部を保持（誤差 '+difference+'）',difference<24);}
  for(const phase of ['countdown','playing','fixing','paused']){
    const s={...session,phase,pausedPhase:phase==='paused'?'fixing':undefined,partStartedAt:0,fixingStartedAt:1000,pauseStartedAt:1100};
    render(old,before,s);render(current,after,s);assert(phase+'は旧描画とピクセル一致・追加処理なし',equal(pixels(before),pixels(after))&&current.metrics.polishedParts===0&&current.metrics.colorReads===0);
  }
  render(old,before,session,1000,landmarks,base,'parts-only');render(current,after,session,1000,landmarks,base,'parts-only');assert('parts-onlyの抽出デバッグは変更なし',equal(pixels(before),pixels(after)));
  render(current,after,session,1000);assert('同一フレームの再描画では色サンプルを再利用',current.metrics.colorReads===0);
  const challenge={...session,gameMode:'challenge',challenge:createChallengeRun('chaosFace','MONSTER')};
  render(current,after,challenge,1033);const free=pixels(after).slice();render(current,after,session,1066);assert('FREEとCHALLENGEの完成合成は共通',equal(free,pixels(after)));
  let reads=0,largest=0;const read=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=function(x,y,w,h,...args){reads++;largest=Math.max(largest,w*h);return read.call(this,x,y,w,h,...args);};
  for(let i=0;i<12;i++)render(current,after,session,1100+i*33);
  CanvasRenderingContext2D.prototype.getImageData=read;assert('readbackは16画素だけ・120ms間隔で間引き',largest===16&&reads<=24);
  let allocations=0;const create=document.createElement.bind(document);
  document.createElement=function(tag,...args){if(tag==='canvas')allocations++;return create(tag,...args);};
  for(let i=0;i<8;i++)render(current,after,session,1600+i*33);
  document.createElement=create;assert('安定した連続フレームでCanvasを再生成しない',allocations===0);
  render(old,before,session,2100);render(current,after,session,2100);
  window.testImages={before:before.toDataURL(),after:after.toDataURL(),source:base.toDataURL()};image('v0.8.1 相当',before);image('v0.9.0 completed',after);
  const kinds=['rightEye','leftEye','nose','mouth'],rotations=[.22,-.18,.14,-.1],scales=[1.1,.9,1.15,.85];
  const monster={...session,difficulty:'MONSTER',fixedPositions:[],fixedTransforms:[],fixedBrowOffsets:[]};
  for(let i=0;i<4;i++){
    const motion={verticalOffset:session.fixedOffsets[i],horizontalOffset:[.08,-.06,.03,-.02][i],rotation:rotations[i],scale:scales[i]};
    monster.fixedPositions.push(current.turnPosition(landmarks,480,640,i,motion));monster.fixedTransforms.push({...motion,partType:kinds[i]});monster.fixedBrowOffsets.push(current.turnBrowOffset(landmarks,480,640,i)??null);
  }
  render(current,after,monster,2133);const monsterPixels=pixels(after);
  for(const [kind,x,y,color] of marks){const i=indexFor(kind),position=monster.fixedPositions[i],main=g.parts[kinds[i]].center,c=Math.cos(rotations[i]),s=Math.sin(rotations[i]);
    const q={x:g.pose.center.x+position.x*g.pose.scale+scales[i]*(c*(x-main.x)-s*(y-main.y)),y:g.pose.center.y+position.y*g.pose.scale+scales[i]*(s*(x-main.x)+c*(y-main.y))};let found=false;
    for(let yy=Math.round(q.y)-3;yy<=Math.round(q.y)+3;yy++)for(let xx=Math.round(q.x)-3;xx<=Math.round(q.x)+3;xx++){const j=(yy*480+xx)*4;if(color.reduce((sum,value,k)=>sum+Math.abs(value-monsterPixels[j+k]),0)<90)found=true;}
    assert(kind+'の顔ローカル固定位置・個別回転・倍率を保持',found);
  }
  const angle=.25,scale=.88,dx=12,dy=9,c=Math.cos(angle),s=Math.sin(angle),center=g.pose.center,moved=canvas(),mc=moved.getContext('2d');
  mc.translate(center.x+dx,center.y+dy);mc.rotate(angle);mc.scale(scale,scale);mc.translate(-center.x,-center.y);mc.drawImage(base,0,0);
  const lm=landmarks.map(p=>{const x=(1-p.x)*480-center.x,y=p.y*640-center.y;return{x:1-(center.x+dx+scale*(c*x-s*y))/480,y:(center.y+dy+scale*(s*x+c*y))/640};});
  render(current,after,session,2200,lm,moved);const transformed=pixels(after);
  for(const [kind,x,y,color] of marks){const p=positionFor(kind,x,y),q={x:center.x+dx+scale*(c*(p.x-center.x)-s*(p.y-center.y)),y:center.y+dy+scale*(s*(p.x-center.x)+c*(p.y-center.y))};let found=false;
    for(let yy=Math.round(q.y)-3;yy<=Math.round(q.y)+3;yy++)for(let xx=Math.round(q.x)-3;xx<=Math.round(q.x)+3;xx++){const i=(yy*480+xx)*4;if(color.reduce((sum,value,j)=>sum+Math.abs(value-transformed[i+j]),0)<90)found=true;}
    assert(kind+'は完成後も顔の移動・回転・倍率に追従',found);
  }
  const times=[[],[]];let clock=2400;
  for(let batch=0;batch<4;batch++)for(const [which,renderer] of (batch%2?[[1,current],[0,old]]:[[0,old],[1,current]])){
    for(let i=0;i<10;i++){render(renderer,after,session,clock+=33);dest.getImageData(0,0,1,1);}
    for(let i=0;i<30;i++){const start=performance.now();render(renderer,after,session,clock+=33);dest.getImageData(0,0,1,1);times[which].push(performance.now()-start);}
  }
  const stats=data=>{data.sort((a,b)=>a-b);return{mean:data.reduce((a,b)=>a+b,0)/data.length,p95:data[Math.floor(data.length*.95)]};};
  const oldTime=stats(times[0]),newTime=stats(times[1]);results.push('参考PC 480×640 / 検出除外・描画完了待ち・交互120フレーム 旧平均 '+oldTime.mean.toFixed(2)+'ms p95 '+oldTime.p95.toFixed(2)+' → 新平均 '+newTime.mean.toFixed(2)+'ms p95 '+newTime.p95.toFixed(2));
  assert('完成後もライブフレームを更新',(()=>{const p=pixels(after).slice();ctx.fillStyle='#ffa000';ctx.fillRect(0,0,20,20);render(current,after,session,5000);return !equal(p,pixels(after));})());
  render(current,after,{...session,fixedPositions:[{x:3,y:3},{x:3,y:3},{x:3,y:3},{x:3,y:3}]},20000);
  assert('顔外の背景を肌色補正のサンプルにしない',current.metrics.polishColorParts===0&&current.metrics.colorReads===0);
  document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
document.querySelector('#results').textContent=results.join('\n');
