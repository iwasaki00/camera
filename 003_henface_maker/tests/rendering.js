import { createFeatureRenderer, getFeatureRegion, sliderToTransformOptions, buildFeatherMask } from "../src/featureRenderer.ts";
const results = [], images = document.querySelector('#images');
const assert = (name, ok) => { results.push((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) throw new Error(name); };
const canvas = () => { const c = document.createElement('canvas'); c.width=480;c.height=640;return c; };
const pixels = c => c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const equal = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i]);
const base=canvas(), b=base.getContext('2d');
b.fillStyle='#b5d5df';b.fillRect(0,0,480,640);
b.fillStyle='#dbad8e';b.beginPath();b.ellipse(240,310,160,240,0,0,Math.PI*2);b.fill();
// Fine grid reveals clipping seams and sampling discontinuities.
b.strokeStyle='rgba(70,40,20,.15)';b.lineWidth=1;
for(let x=80;x<410;x+=16){b.beginPath();b.moveTo(x,70);b.lineTo(x,550);b.stroke();}
for(let y=80;y<560;y+=16){b.beginPath();b.moveTo(80,y);b.lineTo(400,y);b.stroke();}
const landmarks=Array.from({length:478},()=>({x:.5,y:.5}));
function feature(ids,cx,cy,rx,ry){ids.forEach((id,i)=>{const a=i/ids.length*Math.PI*2;landmarks[id]={x:1-(cx+Math.cos(a)*rx)/480,y:(cy+Math.sin(a)*ry)/640};});}
feature([6,1,2,98,327,168,197],240,315,25,45);
feature([33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],175,235,35,15);
feature([362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382],305,235,35,15);
feature([61,291,13,14,78,308,0,17],240,410,55,20);
feature([46,53,52,65,55,70,63,105,66,107],175,195,40,8);
feature([276,283,282,295,285,300,293,334,296,336],305,195,40,8);
for(const x of [175,305]){b.fillStyle='#fff';b.beginPath();b.ellipse(x,235,35,15,0,0,Math.PI*2);b.fill();b.fillStyle='#352720';b.beginPath();b.arc(x,235,9,0,Math.PI*2);b.fill();b.fillRect(x-40,188,80,9);}
b.strokeStyle='#704c37';b.lineWidth=5;b.beginPath();b.moveTo(240,280);b.lineTo(220,345);b.lineTo(260,345);b.stroke();
b.fillStyle='#a04e50';b.beginPath();b.ellipse(240,410,55,20,0,0,Math.PI*2);b.fill();
b.strokeStyle='#252525';b.lineWidth=4;for(const x of [175,305])b.strokeRect(x-49,210,98,52);b.beginPath();b.moveTo(224,223);b.lineTo(256,223);b.stroke();
const defaults=()=>Object.fromEntries(['nose','eyes','mouth','brows','head','jaw','cheeks','ears'].map(id=>[id,{size:1,scaleX:1,scaleY:1,distance:0,opacity:1}]));
const renderer=createFeatureRenderer(), out=canvas(), ctx=out.getContext('2d'), original=pixels(base).slice();
function show(c,label){const box=document.createElement('div');box.append(label,c);images.append(box);}
try {
 renderer.renderFeatureEffects(base,ctx,landmarks,defaults());
 assert('リセット時は元フレームと完全一致',equal(original,pixels(out)));
 assert('不完全なランドマークをスキップ',getFeatureRegion([], 'nose',{width:480,height:640})===null);
 const mask=canvas();buildFeatherMask(mask.getContext('2d'),480,640,{featherRadius:.28,centerWeight:1});
 const m=pixels(mask);assert('マスク中心は不透明、四隅と外端は透明',m[(320*480+240)*4+3]===255 && m[3]===0 && m[(320*480)*4+3]<5);
 assert('マスク外周のアルファ減衰',m[(320*480+460)*4+3]>m[(320*480+478)*4+3]);
 const state=defaults();state.nose={...state.nose,size:1.8,scaleX:1.8,scaleY:.4};state.eyes.size=1.8;state.eyes.distance=.25;state.mouth.size=.4;state.mouth.scaleX=1.8;state.brows.size=1.5;
 const nose=getFeatureRegion(landmarks,'nose',{width:480,height:640});
 const small=sliderToTransformOptions(defaults().nose,nose,{x:240,y:300},'nose',480);
 const large=sliderToTransformOptions(state.nose,nose,{x:240,y:300},'nose',480);
 assert('高倍率ほど影響範囲が拡大',large.influenceRadius.x>small.influenceRadius.x);
 renderer.renderFeatureEffects(base,ctx,landmarks,state);const first=pixels(out).slice();
 assert('複数パーツが実際に変形',!equal(first,original));
 assert('カメラソースは不変',equal(original,pixels(base)));
 renderer.renderFeatureEffects(base,ctx,landmarks,state);assert('加工の累積なし',equal(first,pixels(out)));
 assert('影響外の四隅を維持',first[0]===original[0] && first[first.length-4]===original[original.length-4]);
 let overlay=false;renderer.renderFeatureEffects(base,ctx,landmarks,state,(c)=>{overlay=true;c.fillStyle='#ff00ff';c.fillRect(0,0,4,4);});
 assert('描画型エフェクトは合成後に維持',overlay && pixels(out)[0]===255 && pixels(out)[2]===255);
 renderer.renderFeatureEffects(base,ctx,undefined,state);assert('顔未検出時は元フレーム',equal(original,pixels(out)));
 let rejected=false;try{renderer.renderFeatureEffects(base,b,landmarks,state);}catch{rejected=true;}assert('出力のソース再利用を拒否',rejected);
 // Frame-edge clipping and strongest combined scales must be safe.
 const edge={center:{x:5,y:5},width:40,height:30};const extreme=sliderToTransformOptions({size:1.8,scaleX:1.8,scaleY:1.8,distance:0,opacity:1},edge,{x:240,y:300},'nose',480);
 renderer.transformFeatureRegion(b,ctx,edge,extreme);assert('画面端・極端倍率でも描画完了',equal(original,pixels(base)));
 renderer.renderFeatureEffects(base,ctx,landmarks,state);
 show(base,'元画像（合成テスト用）');show(out,'複数パーツ・眼鏡・強い変形');
 const start=performance.now();for(let i=0;i<12;i++)renderer.renderFeatureEffects(base,ctx,landmarks,state);
 results.push('参考描画時間: '+((performance.now()-start)/12).toFixed(1)+' ms/frame（480×640、検出処理なし・実機Safariとは別）');
 document.querySelector('#results').textContent=results.join('\n');
} catch(error){document.querySelector('#results').textContent=results.join('\n')+'\n'+error.stack;}
