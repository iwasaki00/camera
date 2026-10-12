import { createFixture } from './fixture.js';
import { renderGameFrame } from './render-game-frame.js';
import { createBlinkDropRenderer } from '../src/game/blinkDropRenderer.ts';
import { beginBlinkDrop, createBlinkDropSession } from '../src/game/blinkDropGame.ts';
import { paintContourMask } from '../src/game/blinkDropMasks.ts';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const pixels=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const variance=(data,box)=>{const values=[];for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const i=(y*480+x)*4;values.push(data[i]*.299+data[i+1]*.587+data[i+2]*.114);}const mean=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;};
try{
 const {base,landmarks}=createFixture(),source=pixels(base).slice();
 const out=document.createElement('canvas');out.width=base.width;out.height=base.height;const ctx=out.getContext('2d');
 const renderer=createBlinkDropRenderer();
 const regions=renderer.getRegions(landmarks,base.width,base.height);
 assert('6領域を別々に抽出',Object.keys(regions).length===6&&regions.rightBrow.kind==='rightBrow'&&regions.leftEye.kind==='leftEye');
 for(const [eye,brow] of [['leftEye','leftBrow'],['rightEye','rightBrow']]){
  assert(eye+'は眉を含まないコンパクト領域',regions[eye].center.y-regions[eye].height/2>regions[brow].center.y);
  assert(eye+'と眉は共通落下量',regions[eye].dropHeight===regions[brow].dropHeight);
 }
 for(const [kind,r] of Object.entries(regions)){
  const mask=document.createElement('canvas');mask.width=160;mask.height=112;
  const width=r.width*1.36,height=r.height*1.7,x=r.center.x-width/2,y=r.center.y-height/2;
  paintContourMask(mask.getContext('2d'),160,112,r.contour.map(p=>({x:(p.x-x)/width,y:(p.y-y)/height})),8);
  const data=pixels(mask),alpha=(px,py)=>data[(py*160+px)*4+3];
  assert(kind+'のマスクは矩形の角を表示しない',alpha(0,0)===0&&alpha(159,0)===0&&alpha(0,111)===0&&alpha(159,111)===0);
  assert(kind+'の内部は不透明',alpha(80,56)===255);
  assert(kind+'の外周だけにフェザーがある',data.some((v,i)=>i%4===3&&v>0&&v<255));
 }
 renderer.setGlassesMargin(1.3);const wider=renderer.getRegions(landmarks,480,640);
 assert('眼鏡余白を拡張しても眉は別領域',wider.rightEye.width>regions.rightEye.width&&wider.rightEye.center.y-wider.rightEye.height/2>wider.rightBrow.center.y);
 renderer.setGlassesMargin(1);
 const countdown={...createBlinkDropSession('countdown')};
 assert('のっぺらぼう描画成功',renderer.render(base,ctx,landmarks,countdown,0));
 const blank=pixels(out).slice();assert('目鼻口の領域を変更',!equal(blank,source));assert('元フレームは不変',equal(source,pixels(base)));
 window.testImages={original:base.toDataURL(),blank:out.toDataURL()};
 renderer.render(base,ctx,landmarks,{...countdown,phase:'paused',pausedPhase:'countdown',pauseStartedAt:200},999);
 assert('カウントダウン一時停止中は落下パーツを描画しない',equal(blank,pixels(out)));
 // Change only the removed content. The opaque core must be independent of it,
 // unlike a semitransparent cover. Surrounding skin and landmarks stay identical.
 const altered=document.createElement('canvas');altered.width=480;altered.height=640;
 const alteredCtx=altered.getContext('2d');alteredCtx.drawImage(base,0,0);
 alteredCtx.fillStyle='#ff00ff';
 for(const x of [175,305]){alteredCtx.fillRect(x-41,187,82,10);alteredCtx.fillRect(x-51,209,102,56);}
 alteredCtx.fillRect(217,277,46,75);alteredCtx.fillRect(186,390,108,40);
 renderer.render(altered,ctx,landmarks,countdown,0);const changedBlank=pixels(out).slice();
 const stableBox=box=>{let max=0;for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++)for(let c=0;c<3;c++){const i=(y*480+x)*4+c;max=Math.max(max,Math.abs(blank[i]-changedBlank[i]));}return max<=2;};
 assert('消去内部は元の眉・眼鏡・目の色を透過しない',stableBox({x:137,y:190,w:76,h:67})&&stableBox({x:267,y:190,w:76,h:67}));
 assert('消去内部は元の鼻・口の色を透過しない',stableBox({x:224,y:285,w:32,h:56})&&stableBox({x:190,y:396,w:100,h:25}));
 const wall=document.createElement('canvas');wall.width=480;wall.height=640;const wc=wall.getContext('2d');wc.drawImage(base,0,0);
 wc.fillStyle='#00ffff';wc.beginPath();wc.rect(0,0,480,640);wc.ellipse(240,310,160,240,0,0,Math.PI*2);wc.fill('evenodd');
 renderer.render(wall,ctx,landmarks,countdown,0);const wallBlank=pixels(out);
 assert('顔外の壁色を変えても消去した肌へ写り込まない',[{x:175,y:235},{x:305,y:235},{x:240,y:310},{x:240,y:410}].every(({x,y})=>{const i=(y*480+x)*4;return [0,1,2].every(c=>Math.abs(wallBlank[i+c]-blank[i+c])<=2);}));
 renderer.render(base,ctx,landmarks,createBlinkDropSession(),0,'parts-only');
 const sets=pixels(out);
 window.testImages.parts=out.toDataURL();
 for(const x of [175,305]){
  for(const [label,px,py] of [['眉',x,191],['眼鏡',x-49,235],['目',x,235]]){
   const i=(py*480+px)*4;assert('parts-onlyに'+label+'の元画素を含む',Math.abs(sets[i]-source[i])<=40&&Math.abs(sets[i+1]-source[i+1])<=40);
  }
 }
 const marked=document.createElement('canvas');marked.width=480;marked.height=640;const markCtx=marked.getContext('2d');markCtx.drawImage(base,0,0);
 const markers=[[305,191,'#00ee88'],[305,235,'#ee3388'],[256,235,'#33bbee'],[175,191,'#00ee88'],[175,235,'#ee3388']];
 for(const [x,y,color] of markers){markCtx.fillStyle=color;markCtx.fillRect(x-1,y-1,3,3);}
 renderer.render(marked,ctx,landmarks,createBlinkDropSession(),0,'parts-only');const markedSource=pixels(marked),markedParts=pixels(out);
 for(const [x,y] of markers){const i=(y*480+x)*4;assert('別々の眉・目・眼鏡抽出に識別用画素を保持 '+x+','+y,Math.abs(markedSource[i+1]-markedParts[i+1])<45);}
 for(const [index,x,kind] of [[0,305,'rightEye'],[1,175,'leftEye']]){
  const turn={...createBlinkDropSession('playing'),currentIndex:index,partStartedAt:1000};
  renderer.render(marked,ctx,landmarks,turn,2200,'parts-only'); // Offset -2 at half of the fall.
  const data=pixels(out),shift=-2*regions[kind].dropHeight;
  const eyeI=(Math.round(235+shift)*480+x)*4,browI=(Math.round(191+shift)*480+x)*4;
  assert(kind+'ターンで目と眉が別画像のまま同時落下',data[eyeI]>150&&data[browI+1]>150);
 }
 const featureBoxes=[{name:'目',x:140,y:220,w:200,h:32},{name:'鼻帯',x:190,y:250,w:100,h:145},{name:'口帯',x:175,y:378,w:130,h:66}];
 for(const box of featureBoxes){const before=variance(source,box),after=variance(blank,box);results.push(box.name+' 輝度分散 '+before.toFixed(0)+' → '+after.toFixed(0));assert(box.name+'の輪郭・陰影を低減',after<before*.72);}
 const playing=beginBlinkDrop(createBlinkDropSession('countdown'),1000);
 renderer.render(base,ctx,landmarks,playing,1300);const falling=pixels(out).slice();assert('落下中パーツを合成',!equal(falling,blank));
 const completed={...playing,phase:'completed',currentIndex:3,fixedOffsets:[-3,1,-2,1.5]};
 renderer.render(base,ctx,landmarks,completed,2000);const final=pixels(out).slice();assert('固定済み4パーツを合成',!equal(final,falling)&&!equal(final,source));
 renderer.render(base,ctx,landmarks,{...completed,phase:'paused',pausedPhase:'fixing',pauseStartedAt:2100},9999);
 assert('固定演出中の一時停止で同じパーツを二重描画しない',equal(final,pixels(out)));
 window.testImages.completed=out.toDataURL();
 assert('完成後も元フレームは不変',equal(source,pixels(base)));
 renderer.render(base,ctx,landmarks,playing,2000,'original');
 assert('originalは元映像のみ',equal(source,pixels(out)));
 renderer.render(base,ctx,landmarks,createBlinkDropSession(),0,'blank-face');
 assert('blank-faceはゲーム開始なしで消去後のみ',equal(blank,pixels(out)));
 renderer.render(base,ctx,landmarks,playing,1300,'parts-only');
 const only=pixels(out).slice();
 assert('parts-onlyの背景は暗色',only[0]===17&&only[1]===21&&only[2]===29);
 assert('parts-onlyで落下パーツを表示',only.some((v,i)=>i%4===0&&v!==17));
 renderer.render(base,ctx,landmarks,completed,2000,'parts-only');
 assert('parts-onlyで固定パーツを保持',!equal(only,pixels(out)));
 renderer.render(base,ctx,landmarks,playing,2000,'bounds');
 assert('boundsで元映像に抽出枠を追加',!equal(source,pixels(out)));
 const frame=renderGameFrame(renderer,base,landmarks,completed,2000),frozen=pixels(frame).slice();
 assert('検証バッファはデバッグによらず通常の完成顔',equal(final,frozen));
 renderer.render(base,ctx,landmarks,playing,2400,'parts-only');
 base.getContext('2d').fillRect(0,0,20,20);
 assert('次フレーム・デバッグ表示・元映像の変更で検証バッファは変わらない',equal(frozen,pixels(frame)));
 base.getContext('2d').putImageData(new ImageData(source,base.width,base.height),0,0);
 renderer.clearCache();
 assert('長い顔未検出時は元画像',!renderer.render(base,ctx,undefined,playing,3000)&&equal(source,pixels(out)));
 const local=renderer.turnPosition(landmarks,480,640,0,-2);
 const browDelta=renderer.turnBrowOffset(landmarks,480,640,0);
 const stable={...completed,fixedPositions:[local,null,{x:0,y:-.3},{x:0,y:.4}],fixedBrowOffsets:[browDelta,null,null,null]};
 renderer.render(base,ctx,landmarks,stable,3100);
 const live=pixels(out).slice();
 base.getContext('2d').fillStyle='#ff9933';base.getContext('2d').fillRect(0,0,20,20);
 renderer.render(base,ctx,landmarks,stable,3133);
 assert('completedも新しいカメラフレームを描画',!equal(live,pixels(out)));
 const current=pixels(out).slice();renderer.render(base,ctx,undefined,stable,3200);
 assert('一時追跡欠落では直前の合成フレームを保持',equal(current,pixels(out)));
 // Transform both the camera and landmarks, then verify offset patches transform with the face.
 const angle=.25,scale=.9,dx=22,dy=12,c=Math.cos(angle),s=Math.sin(angle),center={x:240,y:235};
 const moved=document.createElement('canvas');moved.width=480;moved.height=640;const mc=moved.getContext('2d');
 mc.translate(center.x+dx,center.y+dy);mc.rotate(angle);mc.scale(scale,scale);mc.translate(-center.x,-center.y);mc.drawImage(base,0,0);
 const move=(x,y)=>({x:center.x+dx+scale*(c*(x-center.x)-s*(y-center.y)),y:center.y+dy+scale*(s*(x-center.x)+c*(y-center.y))});
 const lm=landmarks.map(p=>{const q=move((1-p.x)*480,p.y*640);return{x:1-q.x/480,y:q.y/640};});
 const geo=renderer.getGeometry(lm,480,640);
 assert('顔回転・倍率を取得',Math.abs(geo.pose.angle-angle)<.02&&Math.abs(geo.pose.scale-130*scale)<1);
 renderer.render(moved,ctx,lm,stable,3300,'parts-only');const positioned=pixels(out);
 const shift=235+local.y*130-regions.rightEye.center.y;
 const target=move(305,235+shift),i=(Math.round(target.y)*480+Math.round(target.x))*4;
 assert('固定した右目は顔の移動・回転・倍率に追従し本来位置へ戻らない',positioned[i]<100&&positioned[i+1]<100);
 const browTarget=move(305,191+shift),bi=(Math.round(browTarget.y)*480+Math.round(browTarget.x))*4;
 assert('右眉も同じ移動量で目との相対位置を維持',positioned[bi]<120&&positioned[bi+1]<120);
 base.getContext('2d').putImageData(new ImageData(source,480,640),0,0);
 const started=performance.now();for(let i=0;i<20;i++)renderer.render(base,ctx,landmarks,playing,2200+i*33);
 results.push('参考描画時間 '+((performance.now()-started)/20).toFixed(1)+'ms/frame（480×640、顔検出を除く）');
 document.querySelector('#images').append(base,out);document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
document.querySelector('#results').textContent=results.join('\n');
