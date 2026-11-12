import assert from 'node:assert/strict';

export async function checkZoom({ evaluate, command, touchDrag, waitFor }) {
  const selectMode = async mode => evaluate(`(() => {const el=document.querySelector('#interaction-mode');el.value=${JSON.stringify(mode)};el.dispatchEvent(new Event('change'));})()`);
  const setZoom = async (id, percent) => evaluate(`(() => {const el=document.querySelector('#${id}-view-zoom');el.value=${percent};el.dispatchEvent(new Event('input'));})()`);
  const model = () => evaluate("JSON.stringify(Array.from(document.querySelectorAll('#part-controls input,#source-controls input,#source-zoom')).map(el=>el.value))");
  const matrix = id => evaluate(`(() => {const m=new DOMMatrix(getComputedStyle(document.querySelector('#${id==='photo'?'composition':'camera-preview'}')).transform);return {scale:m.a,x:m.e,y:m.f};})()`);
  const stage = async id => evaluate(`(() => {document.querySelector('#screen-${id}')?.click();const el=document.querySelector('#${id==='photo'?'composition':'camera-preview'}').parentElement;el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};})()`);
  const reset = async id => evaluate(`document.querySelector('#${id}-view-reset').click()`);
  await evaluate("for(const id of ['photo','camera']){const el=document.querySelector('#'+id+'-loupe');el.checked=false;el.dispatchEvent(new Event('change'));}");
  const png = async () => {
    await evaluate("document.querySelector('#save').click()"); await waitFor("!document.querySelector('#save').disabled");
    return evaluate("(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL();})()");
  };
  const baselinePNG = await png(), initialModel = await model();
  for (const id of ['photo','camera']) {
    await stage(id); await setZoom(id, 200);
    assert.equal((await matrix(id)).scale, 2);
    assert.equal((await matrix(id==='photo'?'camera':'photo')).scale, 1);
    await selectMode('pan'); const from = await stage(id), before = await matrix(id);
    await touchDrag(from,{x:from.x+14,y:from.y+8}); const after = await matrix(id);
    assert.ok(Math.abs(after.x-before.x-14)<1 && Math.abs(after.y-before.y-8)<1);
    assert.equal(await model(),initialModel);
    await selectMode('view'); const locked = await matrix(id);
    await touchDrag(from,{x:from.x-20,y:from.y-15}); assert.deepEqual(await matrix(id),locked);
    await reset(id); assert.deepEqual(await matrix(id),{scale:1,x:0,y:0});
  }
  assert.equal(await png(),baselinePNG);
  console.log('PASS: independent zoom/pan/reset, pan/view mode isolation, unchanged model and PNG pixels');

  // Begin with both fingers, then lift one and move the remaining finger: no edit or jump.
  const pinch = async (id, mode) => {
    await selectMode(mode); await reset(id); const c=await stage(id), beforeModel=await model();
    const touch=(x,y,id)=>({x,y,id,radiusX:7,radiusY:7,force:.7});
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(c.x-36,c.y,1),touch(c.x+36,c.y,2)]});
    for(let i=1;i<=4;i++) await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(c.x-36-i*6+i*2,c.y-i,1),touch(c.x+36+i*6+i*2,c.y-i,2)]});
    // Pointer moves may be coalesced until the next animation frame.
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const result=await matrix(id); assert.ok(Math.abs(result.scale-120/72)<.01,`${id}/${mode}: ${JSON.stringify(result)}`);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[touch(c.x-52,c.y-4,1)]});
    await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(c.x-40,c.y+10,1)]});
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.deepEqual(await matrix(id),result); assert.equal(await model(),beforeModel);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await reset(id);
  };
  for (const id of ['photo','camera']) for(const mode of ['edit','pan','view']) await pinch(id,mode);
  assert.equal(await model(),initialModel);
  assert.equal(await png(),baselinePNG);
  console.log('PASS: six two-finger pinch cases across all modes; no crop mutation or one-finger jump');

  for(const id of ['photo','camera']) {
    await selectMode('edit'); await stage(id);
    const before=await model(),box=await evaluate(id==='photo'?'window.photoBox()':'window.cameraBox()');
    const point=(x,y,id)=>({x,y,id,radiusX:7,radiusY:7,force:.7});
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(box.x,box.y,1)]});
    await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(box.x+4,box.y-2,1)]});
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.notEqual(await model(),before);
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(box.x+4,box.y-2,1),point(box.x+64,box.y-2,2)]});
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await model(),before);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  console.log('PASS: adding a second finger rolls back the initial edit before pinching');

  await selectMode('edit');
  for(const id of ['photo','camera']) {
    await stage(id);
    for(const percent of [100,200,400]) {
      await setZoom(id,percent);
      const box=await evaluate(id==='photo'?'window.photoBox()':'window.cameraBox()');
      const sourceX=await evaluate(`Number(document.querySelector('#${id==='photo'?'part':'source'}-x').value)`);
      await touchDrag(box,{x:box.x+6,y:box.y-3});
      const afterX=await evaluate(`Number(document.querySelector('#${id==='photo'?'part':'source'}-x').value)`);
      assert.ok(Math.abs(afterX-sourceX-6/box.surfaceWidth*100)<.25,`${id} at ${percent}%`);
    }
    await reset(id);
  }
  console.log('PASS: photo and camera edit deltas at 100/200/400%, with rotated photo frame');
  for(const percent of [200,400]) {
    await stage('photo'); await setZoom('photo',percent);
    const box=await evaluate('window.photoBox()'), angle=box.angle*Math.PI/180;
    const corner={x:box.x+Math.cos(angle)*box.width/2+Math.sin(angle)*box.height/2,y:box.y+Math.sin(angle)*box.width/2-Math.cos(angle)*box.height/2};
    await touchDrag(corner,{x:corner.x+8*Math.cos(angle)+5*Math.sin(angle),y:corner.y+8*Math.sin(angle)-5*Math.cos(angle)});
    const after=await evaluate('window.photoBox()');
    assert.ok(Math.abs(after.width-box.width-8)<1 && Math.abs(after.height-box.height-5)<1,`rotated resize at ${percent}%`);
  }
  await reset('photo');

  // Hidden frames are never an edit target, while two-finger display zoom still works.
  for(const id of ['photo','camera']) {
    await stage(id); await evaluate(`document.querySelector('#${id}-guide').click()`);
    const before=await model(),box=await evaluate(id==='photo'?'window.photoBox()':'window.cameraBox()');
    await touchDrag(box,{x:box.x+12,y:box.y+5}); assert.equal(await model(),before);
    await pinch(id,'edit'); assert.equal(await model(),before);
    await evaluate(`document.querySelector('#${id}-guide').click()`);
  }
  console.log('PASS: independently hidden guides cannot edit; pinch remains available');

  // Magnifiers follow content coordinates and are independent of display zoom.
  await evaluate("for(const id of ['photo','camera']){const el=document.querySelector('#'+id+'-loupe');el.checked=true;el.dispatchEvent(new Event('change'));}");
  for(const id of ['photo','camera']) {
    await stage(id);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier').hidden`),false);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier select').value`),'3');
    const rect=await evaluate(`(() =>{const r=document.querySelector('#${id}-magnifier').getBoundingClientRect();return{x:r.left+12,y:r.top+14,left:r.left,top:r.top};})()`);
    const dx=id==='photo'?-18:18;
    await touchDrag(rect,{x:rect.x+dx,y:rect.y+12});
    const moved=await evaluate(`(() =>{const r=document.querySelector('#${id}-magnifier').getBoundingClientRect();return{left:r.left,top:r.top};})()`);
    assert.ok(Math.abs(moved.left-rect.left-dx)<1); assert.ok(Math.abs(moved.top-rect.top-12)<1);
    const before=await evaluate(`document.querySelector('#${id}-magnifier canvas').toDataURL()`);
    await evaluate(`(() =>{const el=document.querySelector('#${id}-magnifier select');el.value='2';el.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier select').value`),'2');
    await evaluate(`(() =>{const el=document.querySelector('#${id}-magnifier select');el.value='5';el.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier select').value`),'5');
    // A paused, uniform camera may produce equal rasters; the photo has a non-uniform composite.
    if(id==='photo') assert.notEqual(await evaluate(`document.querySelector('#${id}-magnifier canvas').toDataURL()`),before);
    await evaluate(`document.querySelector('#${id}-magnifier button').click()`);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier').hidden`),true);
    await evaluate(`document.querySelector('#${id}-loupe').click()`);
  }
  // Move the part far from its original location and compare a magnified sample against the real composite.
  await evaluate("for(const [key,value]of Object.entries({x:20,y:70})){const el=document.querySelector('#part-'+key);el.value=value;el.dispatchEvent(new Event('input'));}");
  assert.equal(await evaluate(`(() => {
    const canvas=document.querySelector('#composition'), m=document.querySelector('#photo-magnifier canvas');
    const scale=new DOMMatrix(getComputedStyle(canvas).transform).a;
    const fit=canvas.getBoundingClientRect().width/scale/canvas.width, zoom=Number(document.querySelector('#photo-magnifier select').value);
    const x=canvas.width*.2+16/(fit*zoom*2), y=canvas.height*.7+16/(fit*zoom*2);
    const a=canvas.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data,b=m.getContext('2d').getImageData(144,100,1,1).data;
    return a.every((value,i)=>Math.abs(value-b[i])<20);
  })()`),true);
  await evaluate("for(const [key,value]of Object.entries({x:30,y:40})){const el=document.querySelector('#source-'+key);el.value=value;el.dispatchEvent(new Event('input'));}");
  for(const mirror of [false,true]) {
    await evaluate(`(() => {const el=document.querySelector('#mirror');el.checked=${mirror};el.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate(`(async()=>{
      const {sourceRect}=await import('./renderer.js'), video=document.querySelector('#camera'), frame=document.querySelector('#composition');
      const value=id=>Number(document.querySelector('#'+id).value), mirror=document.querySelector('#mirror').checked;
      const crop=sourceRect(video.videoWidth,video.videoHeight,frame.width*value('part-width')/(frame.height*value('part-height')),{x:value('source-x')/100,y:value('source-y')/100,zoom:value('source-zoom')},mirror);
      const preview=document.querySelector('#camera-preview'),scale=new DOMMatrix(getComputedStyle(preview).transform).a;
      const fit=preview.getBoundingClientRect().width/scale/video.videoWidth,zoom=Number(document.querySelector('#camera-magnifier select').value);
      const loupe=document.querySelector('#camera-magnifier canvas'),dpr=loupe.width/loupe.getBoundingClientRect().width;
      const x=crop.x+crop.width/2+(mirror?-16:16)/(fit*zoom*dpr),y=crop.y+crop.height/2+16/(fit*zoom*dpr);
      const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);
      const a=c.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data,b=document.querySelector('#camera-magnifier canvas').getContext('2d').getImageData(144,100,1,1).data;
      return a.every((value,i)=>Math.abs(value-b[i])<20);
    })()`),true);
  }
  const magnifierRaster=await evaluate("document.querySelector('#photo-magnifier canvas').toDataURL()");
  await setZoom('photo',400); await setZoom('camera',200);
  assert.equal(await evaluate("document.querySelector('#photo-magnifier canvas').toDataURL()"),magnifierRaster);
  const zoomPNG=await png(); await reset('photo'); await reset('camera'); assert.equal(await png(),zoomPNG);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  console.log('PASS: magnifier movement/toggle/2–5x controls, center tracking, and view-independent raster/PNG');
  // Leave the normal editor ready for the existing export and lifecycle checks.
  await selectMode('edit');
}
