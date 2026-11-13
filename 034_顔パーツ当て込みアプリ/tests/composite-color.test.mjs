import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAppearance,DEFAULT_COMPOSITE,activeCorrection,correctPixels,skinWeight,representativeColor,matchGains,smoothGains,grainPattern,ColorProcessor,validateAppearance,validateComposite} from '../composite-color.js';
import {createPart} from '../parts.js';
import {validateDocument} from '../template-schema.js';
import {exportTemplate,importTemplate} from '../template-zip.js';
import {Diagnostics} from '../diagnostics.js';
const neutral=()=>Object.fromEntries(Object.keys(defaultAppearance().natural).map(k=>[k,k==='blendStrength'?100:0]));
const pixel=(rgb,settings={},strength=1,gains=[1,1,1],noise=null,comic=false)=>{const d=new Uint8ClampedArray([...rgb,173]);correctPixels(d,1,1,{...neutral(),...settings},strength,gains,noise,comic);return [...d];};
test('ORIGINAL and either zero strength bypass all effects',()=>{
  const p=defaultAppearance();assert.equal(activeCorrection(DEFAULT_COMPOSITE,p),null);
  assert.equal(activeCorrection({...DEFAULT_COMPOSITE,mode:'natural',blendStrength:0},p),null);
  p.natural.blendStrength=0;assert.equal(activeCorrection({...DEFAULT_COMPOSITE,mode:'natural'},p),null);
});
test('all neutral controls retain every RGB and alpha channel exactly',()=>{
  for(const rgb of [[0,0,0],[255,255,255],[126,83,57],[200,10,90]])assert.deepEqual(pixel(rgb),[...rgb,173]);
  assert.equal(activeCorrection({...DEFAULT_COMPOSITE,mode:'natural'},{natural:neutral()}),null);
  assert.equal(activeCorrection({...DEFAULT_COMPOSITE,mode:'natural'},{natural:{...neutral(),edgeContrast:50}}),null);
});
test('brightness shifts pixel intensity without changing alpha',()=>{const p=pixel([100,100,100],{brightness:10});assert.ok(p[0]>120);assert.equal(p[3],173);});
test('positive temperature warms red and cools blue',()=>{const p=pixel([100,100,100],{temperature:20});assert.ok(p[0]>100&&p[2]<100);});
test('tint separates magenta and green',()=>{const p=pixel([100,100,100],{tint:20});assert.ok(p[0]>100&&p[1]<100&&p[2]>100);});
test('desaturation converges RGB to luminance and contrast expands distance from mid-gray',()=>{
  const p=pixel([160,100,70],{saturation:-100});assert.equal(p[0],p[1]);assert.equal(p[1],p[2]);assert.ok(pixel([200,200,200],{contrast:50})[0]>200);
});
test('COMIC defaults visibly increase contrast and saturation but remain bounded',()=>{
  const p=pixel([180,120,90],defaultAppearance().comic);assert.ok(p[0]-p[2]>90);assert.ok(p.slice(0,3).every(v=>v>=0&&v<=255));
});
test('global and per-part blend strengths combine multiplicatively',()=>{
  const full=pixel([100,100,100],{brightness:20}),half=pixel([100,100,100],{brightness:20},.5),part=pixel([100,100,100],{brightness:20,blendStrength:50});
  assert.deepEqual(half,part);assert.ok(Math.abs(half[0]-(100+full[0])/2)<=1);
});
test('parts and modes own independent correction objects',()=>{
  const a=createPart('mouth'),b=createPart('nose');a.appearance.natural.brightness=35;assert.equal(b.appearance.natural.brightness,0);assert.equal(a.appearance.comic.brightness,6);
});
test('representative color ignores dark/light extremes and central mouth pixels',()=>{
  const d=new Uint8ClampedArray(48*48*4);for(let i=0;i<d.length;i+=4)d.set([170,130,105,255],i);
  for(let y=18;y<30;y++)for(let x=18;x<30;x++)d.set([0,0,0,255],(y*48+x)*4);
  for(let i=0;i<100;i++)d.set([255,255,255,255],i*4);
  assert.deepEqual(representativeColor(d,48,48),[170,130,105]);
});
test('no suitable skin ring means no automatic matching',()=>{
  assert.equal(skinWeight(0,0,0),0);assert.equal(skinWeight(250,250,250),0);assert.equal(skinWeight(30,150,200),0);
  assert.equal(representativeColor(new Uint8ClampedArray(48*48*4),48,48),null);assert.deepEqual(matchGains(null,[150,120,90]),[1,1,1]);
});
test('automatic gains are conservative and protect dark mouth and white teeth',()=>{
  const gains=matchGains([230,180,150],[90,70,50]);assert.ok(gains.every(g=>g<=1.18));
  assert.deepEqual(pixel([10,10,10],{},1,gains),[10,10,10,173]);assert.deepEqual(pixel([250,250,250],{},1,gains),[250,250,250,173]);
});
test('automatic matching settles by elapsed time rather than frame count',()=>{
  const next=[1.18,.85,1.1],once=smoothGains([1,1,1],next,300);let many=[1,1,1];for(let i=0;i<10;i++)many=smoothGains(many,next,30);
  once.forEach((n,i)=>assert.ok(Math.abs(n-many[i])<1e-12));assert.ok(once[0]>1&&once[0]<1.18);
});
test('extreme manual settings clamp safely and preserve alpha',()=>{for(const rgb of [[0,0,0],[255,255,255]]){const p=pixel(rgb,{brightness:50,contrast:80,saturation:100,temperature:40,tint:40});assert.ok(p.slice(0,3).every(n=>Number.isFinite(n)&&n>=0&&n<=255));assert.equal(p[3],173);}});
test('grain is fixed between frames, zero mean approximately, and can be disabled',()=>{
  const a=grainPattern(48,48);assert.deepEqual(a,grainPattern(48,48));assert.ok(Math.abs(a.reduce((s,n)=>s+n,0)/a.length)<.03);
  assert.deepEqual(pixel([100,100,100],{grain:10},1,[1,1,1],null),[100,100,100,173]);
});
test('COMIC edge emphasis changes boundary RGB without touching alpha',()=>{const d=new Uint8ClampedArray(16*16*4);for(let i=0;i<d.length;i+=4)d.set([180,120,90,173],i);correctPixels(d,16,16,{...neutral(),edgeContrast:60},1,[1,1,1],null,true);const center=(8*16+8)*4;assert.equal(d[center],180);assert.ok(d[0]<180);assert.equal(d[3],173);});
test('background analysis is cached until source or geometry changes; uses only 48px sample',()=>{
  const data=new Uint8ClampedArray(48*48*4);for(let i=0;i<data.length;i+=4)data.set([170,130,105,255],i);
  const c={resetTransform(){},clearRect(){},save(){},restore(){},setTransform(){},rotate(){},drawImage(){},getImageData(x,y,w,h){assert.equal(w,48);assert.equal(h,48);return {data};}};
  const p=new ColorProcessor(()=>({width:0,height:0,getContext:()=>c})),bg={width:400,height:600},part={x:50,y:50,width:20,height:10,rotation:0,shape:'oval'};
  p.target(bg,part);p.target(bg,part);assert.equal(p.analyses,1);p.target(bg,{...part,rotation:20});assert.equal(p.analyses,2);p.target({...bg},part);assert.equal(p.analyses,3);
});
test('color and composite validation reject invalid values and strip private transient data',()=>{
  for(const value of [NaN,Infinity,101,-1])assert.throws(()=>validateComposite({...DEFAULT_COMPOSITE,blendStrength:value}));
  const p=defaultAppearance();p.natural.grain=NaN;assert.throws(()=>validateAppearance(p));
  const a=defaultAppearance();a.natural.frame='private';assert.equal('frame' in validateAppearance(a).natural,false);
});
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
const document=()=>({schemaVersion:4,id:'color',name:'natural',createdAt:'2026-11-09T00:00:00.000Z',updatedAt:'2026-11-09T00:00:00.000Z',background:{path:'background.png',name:'test.png',mime:'image/png',size:png.length,storedMime:'image/png',storedSize:png.length,width:1,height:1},parts:['mouth','leftEye','rightEye','nose'].map((t,i)=>createPart(t,i)),mirror:true,trackingEnabled:true,composite:{...DEFAULT_COMPOSITE,mode:'natural',autoMatch:true}});
test('schema 4 retains all per-part/per-mode corrections and global settings',()=>{
  const d=document();d.parts[2].appearance.comic.temperature=23;d.parts[0].appearance.natural.brightness=12;const restored=validateDocument(d);assert.deepEqual(restored.parts,d.parts);assert.deepEqual(restored.composite,d.composite);
});
test('schema 1 and 2 migrate to ORIGINAL regardless of newer unknown settings',()=>{
  for(const schemaVersion of [1,2]){const d=document();d.schemaVersion=schemaVersion;d.parts.forEach((p,i)=>{p.partType=['mouth','leftEye','rightEye','nose'][i]});const r=validateDocument(d);assert.equal(r.composite.mode,'original');assert.deepEqual(r.parts[0].sourceRect,d.parts[0].sourceRect);}
});
test('schema 4 requires valid global and part color settings',()=>{
  const d=document();delete d.composite;assert.throws(()=>validateDocument(d));const e=document();delete e.parts[0].appearance;assert.throws(()=>validateDocument(e));
});
test('schema 4 ZIP roundtrip preserves settings without camera, comparison or analysis history',async()=>{
  const doc=document();doc.cameraFrame='private';doc.comparing=true;doc.parts[0].appearance.natural.samples='private';
  const blob=await exportTemplate({doc,background:new Blob([png],{type:'image/png'})}),restored=await importTemplate(blob);
  assert.deepEqual(restored.doc,validateDocument(doc));assert.equal(JSON.stringify(restored.doc).includes('private'),false);assert.equal('comparing' in restored.doc,false);
});
test('compositing diagnostics share the five-second window and stop collecting when OFF',()=>{
  const d=new Diagnostics();d.composition(10,20);assert.equal(d.compositions.length,0);d.enable(true,0);d.composition(100,4);d.composition(200,8);
  assert.equal(d.snapshot(300).compositeAverageMs,6);assert.equal(d.snapshot(300).compositeMaxMs,8);assert.equal(d.snapshot(5201).compositeAverageMs,null);
});
