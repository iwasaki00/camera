import { createFixture } from './fixture.js';
import { createBlinkDropRenderer } from '../src/game/blinkDropRenderer.ts';
import { beginBlinkDrop, createBlinkDropSession } from '../src/game/blinkDropGame.ts';
const results=[];
const assert=(name,ok)=>{results.push((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);};
const pixels=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const variance=(data,box)=>{const values=[];for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const i=(y*480+x)*4;values.push(data[i]*.299+data[i+1]*.587+data[i+2]*.114);}const mean=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;};
try{
 const {base,landmarks}=createFixture(),source=pixels(base).slice();
 const out=document.createElement('canvas');out.width=base.width;out.height=base.height;const ctx=out.getContext('2d');
 const renderer=createBlinkDropRenderer();
 const countdown={...createBlinkDropSession('countdown')};
 assert('のっぺらぼう描画成功',renderer.render(base,ctx,landmarks,countdown,0));
 const blank=pixels(out).slice();assert('目鼻口の領域を変更',!equal(blank,source));assert('元フレームは不変',equal(source,pixels(base)));
 const featureBoxes=[{name:'目',x:140,y:220,w:200,h:32},{name:'鼻帯',x:190,y:250,w:100,h:145},{name:'口帯',x:175,y:378,w:130,h:66}];
 for(const box of featureBoxes){const before=variance(source,box),after=variance(blank,box);results.push(box.name+' 輝度分散 '+before.toFixed(0)+' → '+after.toFixed(0));assert(box.name+'の輪郭・陰影を低減',after<before*.72);}
 const playing=beginBlinkDrop(createBlinkDropSession('countdown'),1000);
 renderer.render(base,ctx,landmarks,playing,1300);const falling=pixels(out).slice();assert('落下中パーツを合成',!equal(falling,blank));
 const completed={...playing,phase:'completed',currentIndex:3,fixedOffsets:[-3,1,-2,1.5]};
 renderer.render(base,ctx,landmarks,completed,2000);const final=pixels(out).slice();assert('固定済み4パーツを合成',!equal(final,falling)&&!equal(final,source));
 assert('完成後も元フレームは不変',equal(source,pixels(base)));
 assert('顔未検出時は元画像',!renderer.render(base,ctx,undefined,playing,2100)&&equal(source,pixels(out)));
 const started=performance.now();for(let i=0;i<20;i++)renderer.render(base,ctx,landmarks,playing,2200+i*33);
 results.push('参考描画時間 '+((performance.now()-started)/20).toFixed(1)+'ms/frame（480×640、顔検出を除く）');
 document.querySelector('#images').append(base,out);document.documentElement.dataset.result='pass';
}catch(error){results.push(error.stack);document.documentElement.dataset.result='fail';}
document.querySelector('#results').textContent=results.join('\n');
