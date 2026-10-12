import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const transpile=async file=>ts.transpileModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const url=js=>'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const masks=url(await transpile('../src/game/blinkDropMasks.ts'));
const skin=await import(url((await transpile('../src/game/skinReconstruction.ts')).replace('"./blinkDropMasks"',JSON.stringify(masks))));
const locations=[[.2,.1],[.8,.1],[.15,.5],[.85,.5],[.3,.9],[.7,.9]];
const nodes=locations.map(([x,y])=>({x,y,color:[180+30*x+10*y,130+15*x+30*y,100+10*x+20*y],texture:Array(16).fill(0)}));
const w=48,h=64,weights=skin.skinWeights(nodes,w,h),data=new Uint8ClampedArray(w*h*4);
for(let p=0;p<w*h;p++){let sum=0;for(let i=0;i<nodes.length;i++){assert(Number.isFinite(weights[p*nodes.length+i]));sum+=weights[p*nodes.length+i];}assert(Math.abs(sum-1)<1e-6);}
skin.fillSkinField(data,w,h,nodes,weights);
let error=0,step=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=(x+.5)/w,v=(y+.5)/h,i=(y*w+x)*4,expected=[180+30*u+10*v,130+15*u+30*v,100+10*u+20*v];
  assert.equal(data[i+3],255);for(let c=0;c<3;c++)error=Math.max(error,Math.abs(data[i+c]-expected[c]));
  if(x)step=Math.max(step,Math.abs(data[i]-data[i-4]));
}
assert(error<1);assert(step<=1);
console.log('PASS 2D illumination field: opaque, affine shading error <1 RGB, no vertical column steps');
const textured=nodes.map(p=>({...p,texture:Array.from({length:16},(_,i)=>i%2?20:-20)}));
const texturedData=new Uint8ClampedArray(data.length);skin.fillSkinField(texturedData,w,h,textured,weights);
assert(texturedData.every((v,i)=>i%4===3?v===255:Math.abs(v-data[i])<=2));
console.log('PASS real donor texture residual bounded to ±1.5 RGB; no random texture');
const constant=nodes.map(p=>({...p,color:[95,70,60]})),out=new Uint8ClampedArray(data.length);
skin.fillSkinField(out,w,h,constant,weights);assert(out.every((v,i)=>v===[95,70,60,255][i%4]));
console.log('PASS uniform/darker skin stays uniform without fitted-plane singularities');
