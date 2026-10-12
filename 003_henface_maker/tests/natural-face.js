import {createFixture} from './fixture.js';
import {createBlinkDropRenderer} from '../src/game/blinkDropRenderer.ts';
import {createBlinkDropSession} from '../src/game/blinkDropGame.ts';
import {createSkinReconstruction,SKIN_RECONSTRUCTION} from '../src/game/skinReconstruction.ts';
import {completedFeather} from '../src/game/completedBlend.ts';
import {pointInPolygon} from '../src/game/blinkDropMasks.ts';
const results=[],assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const canvas=(w=480,h=640)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const image=(name,c)=>{const wrap=document.createElement('div');wrap.append(name,c);c.style.width='240px';document.querySelector('#comparison').append(wrap);};
try{
  const fixture=createFixture(),landmarks=fixture.landmarks,truth=canvas(),tc=truth.getContext('2d'),raw=tc.createImageData(480,640);
  for(let y=0;y<640;y++)for(let x=0;x<480;x++){
    const i=(y*480+x)*4,inside=((x-240)/160)**2+((y-310)/240)**2<1;
    const colors=inside?[180+.07*x+.015*y,130+.055*x+.05*y,105+.04*x+.045*y]:[90,190,220];
    for(let c=0;c<3;c++)raw.data[i+c]=colors[c]+(inside?Math.sin(x*.45)*Math.sin(y*.36)*1.2:0);raw.data[i+3]=255;
  }
  tc.putImageData(raw,0,0);
  const base=canvas(),ctx=base.getContext('2d');ctx.drawImage(truth,0,0);
  // Paint features directly onto the known illumination field. Copying a
  // rectangular fixture patch would introduce artificial skin-color boards.
  for(const x of [175,305]){
    ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(x,235,35,15,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#352720';ctx.beginPath();ctx.arc(x,235,9,0,Math.PI*2);ctx.fill();ctx.fillRect(x-40,188,80,9);
  }
  ctx.strokeStyle='#704c37';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(240,280);ctx.lineTo(220,345);ctx.lineTo(260,345);ctx.stroke();
  ctx.fillStyle='#a04e50';ctx.beginPath();ctx.ellipse(240,410,55,20,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#252525';ctx.lineWidth=4;for(const x of [175,305])ctx.strokeRect(x-49,210,98,52);ctx.beginPath();ctx.moveTo(224,223);ctx.lineTo(256,223);ctx.stroke();
  const exactBaseline=new URL(location.href).searchParams.has('baseline');
  const legacyFactory=exactBaseline?(await import('../build-check/baselineRenderer.ts')).createBlinkDropRenderer:createBlinkDropRenderer;
  const current=createBlinkDropRenderer(),legacy=legacyFactory({naturalSkin:false,naturalEdges:false}),g=current.getGeometry(landmarks,480,640);
  const session={...createBlinkDropSession('playing'),partStartedAt:0},before=canvas(),after=canvas();
  const render=(r,c,t=0,mode='blank-face',s=session)=>r.render(base,c.getContext('2d'),landmarks,s,t,mode);
  render(legacy,before);render(current,after);
  const samples=current.getSkinSamples();assert('肌サンプルは3点以上・最大11点',samples.length>=3&&samples.length<=11);
  assert('サンプル四隅は顔内、全パーツ矩形・眼鏡余白と非交差',samples.every(b=>[0,b.width].every(dx=>[0,b.height].every(dy=>pointInPolygon({x:b.x+dx,y:b.y+dy},g.skinOutline)))&&Object.values(g.parts).every(p=>b.x+b.width<p.center.x-p.width/2||b.x>p.center.x+p.width/2||b.y+b.height<p.center.y-p.height/2||b.y>p.center.y+p.height/2)));
  const roi=[[139,190,72,63],[269,190,72,63],[226,284,28,58],[194,396,92,24]];
  const meanError=c=>{const data=pixels(c),target=pixels(truth);let sum=0,n=0;for(const [x,y,w,h] of roi)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)for(let k=0;k<3;k++){const i=(yy*480+xx)*4+k;sum+=Math.abs(data[i]-target[i]);n++;}return sum/n;};
  const e0=meanError(before),e1=meanError(after);results.push('既知の肌陰影との平均RGB誤差：旧4点補間 '+e0.toFixed(2)+' → 新 '+e1.toFixed(2));
  assert('2D補間が照明方向を保持し、平板な肌パッチの色差を軽減',e1<e0*.6&&e1<3);
  assert('肌readbackは1回、フィールド更新後90ms未満は再利用',current.metrics.skinReads===1&&(()=>{render(current,after,33);return current.metrics.skinReads===0&&current.metrics.skinUpdates===0;})());
  const beforeBright=pixels(after).slice(),brighter=canvas(),bc=brighter.getContext('2d');bc.drawImage(base,0,0);bc.globalCompositeOperation='screen';bc.fillStyle='rgb(20,20,20)';bc.fillRect(0,0,480,640);
  const stepSkin=(r,c,source,t)=>r.render(source,c.getContext('2d'),landmarks,session,t,'blank-face');
  stepSkin(current,after,brighter,100);
  const instant=createBlinkDropRenderer(),instantCanvas=canvas();stepSkin(instant,instantCanvas,brighter,100);
  const sample=p=>(p[(315*480+240)*4]+p[(315*480+240)*4+1]+p[(315*480+240)*4+2])/3;
  const start=sample(beforeBright),temporal=sample(pixels(after)),target=sample(pixels(instantCanvas));
  assert('照明切替の色変化を時間平滑化し、旧色へ固定しない',temporal>start&&temporal<target);
  stepSkin(current,after,brighter,200);assert('補間色は新しい照明へ追従',sample(pixels(after))>temporal);
  const recon=createSkinReconstruction(),field=canvas(48,64),box={x:100,y:80,width:280,height:470};
  let allocations=0;const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='canvas')allocations++;return create(tag,...args);};
  recon.build(ctx,field.getContext('2d'),box,g.parts,g.skinOutline,g.pose,0);allocations=0;
  for(let i=1;i<=20;i++)recon.build(ctx,field.getContext('2d'),{...box,x:box.x+i*.7},g.parts,g.skinOutline,g.pose,i*100);
  document.createElement=create;assert('連続補間はCanvasを再生成しない・重みキャッシュ最大4件',allocations===0&&recon.metrics.weightCaches<=SKIN_RECONSTRUCTION.maxWeights);
  const eye=g.parts.rightEye;assert('完成フェザー幅が顔サイズとともに変化',completedFeather(eye,65)<completedFeather(eye,130)&&completedFeather(eye,260)>completedFeather(eye,130));
  const angle=.22,scale=.85,dx=12,dy=9,c=Math.cos(angle),sn=Math.sin(angle),center=g.pose.center;
  const move=(x,y)=>({x:center.x+dx+scale*(c*(x-center.x)-sn*(y-center.y)),y:center.y+dy+scale*(sn*(x-center.x)+c*(y-center.y))});
  const moved=canvas(),mc=moved.getContext('2d');mc.translate(center.x+dx,center.y+dy);mc.rotate(angle);mc.scale(scale,scale);mc.translate(-center.x,-center.y);mc.drawImage(base,0,0);
  const lm=landmarks.map(p=>{const q=move((1-p.x)*480,p.y*640);return{x:1-q.x/480,y:q.y/640};});
  const following=createBlinkDropRenderer(),tracking=canvas();render(following,tracking,400);following.render(moved,tracking.getContext('2d'),lm,session,433,'blank-face');
  const q=move(240,315),i=(Math.round(q.y)*480+Math.round(q.x))*4,t=(315*480+240)*4,tracked=pixels(tracking),truthPixels=pixels(truth);
  assert('肌フィールド再利用中も顔の移動・傾き・倍率へ追従',Math.max(...[0,1,2].map(k=>Math.abs(tracked[i+k]-truthPixels[t+k])))<3);
  legacy.clearCache();current.clearCache();render(legacy,before,300);render(current,after,300);
  const sampled=canvas();sampled.getContext('2d').drawImage(base,0,0);const sc=sampled.getContext('2d');sc.strokeStyle='#00ff80';sc.lineWidth=2;for(const b of current.getSkinSamples())sc.strokeRect(b.x,b.y,b.width,b.height);
  window.testImages={source:base.toDataURL(),before:before.toDataURL(),after:after.toDataURL(),truth:truth.toDataURL(),samples:sampled.toDataURL()};
  image('元画像（模擬顔）',base);image('v0.9.0 肌補間',before);image('v0.9.1 肌補間',after);image('検証用の元肌陰影',truth);
  const finished={...session,phase:'completed',currentIndex:3,fixedOffsets:[-1.4,-.6,-.45,.1],fixedPositions:[null,null,null,null],fixedTransforms:[null,null,null,null],fixedBrowOffsets:[null,null,null,null]};
  const oldFinal=canvas(),newFinal=canvas();render(legacy,oldFinal,700,'normal',finished);render(current,newFinal,700,'normal',finished);
  window.testImages.oldfinal=oldFinal.toDataURL();window.testImages.newfinal=newFinal.toDataURL();image(exactBaseline?'v0.9.0 completed':'旧肌補間 completed（仕上げは現行）',oldFinal);image('v0.9.1 completed',newFinal);image('サンプル位置（検証ページのみ）',sampled);
  let clock=1000;
  const measurePair=phase=>{
    const out=canvas(),dest=out.getContext('2d'),s={...session,phase,currentIndex:3,fixedOffsets:[-1.4,-.6,-.45,.1],fixedPositions:[null,null,null,null],fixedTransforms:[null,null,null,null],fixedBrowOffsets:[null,null,null,null]};
    const times=[[],[]],renderers=[legacy,current];
    for(let batch=0;batch<4;batch++)for(const which of (batch%2?[1,0]:[0,1]))for(let i=0;i<40;i++){
      const start=performance.now();renderers[which].render(base,dest,landmarks,s,clock+=33);dest.getImageData(0,0,1,1);if(i>=10)times[which].push(performance.now()-start);
    }
    return times.map(t=>{t.sort((a,b)=>a-b);return{mean:t.reduce((a,b)=>a+b,0)/t.length,p95:t[Math.floor(t.length*.95)]};});
  };
  for(const phase of ['playing','completed']){const [oldTime,newTime]=measurePair(phase);results.push('参考PC 480×640・検出除外・描画完了待ち・交互120フレーム '+phase+' '+(exactBaseline?'v0.9.0':'旧肌補間')+' 平均 '+oldTime.mean.toFixed(2)+'ms p95 '+oldTime.p95.toFixed(2)+' → v0.9.1 平均 '+newTime.mean.toFixed(2)+'ms p95 '+newTime.p95.toFixed(2));}
  document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
document.querySelector('#results').textContent=results.join('\n');
