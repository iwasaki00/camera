import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function checkScreens({evaluate,command,waitFor}) {
  let count=0;const pass=name=>{count++;console.log('PASS SCREEN:',name);};
  const tab=id=>evaluate(`document.querySelector('#screen-${id}').click()`);
  const values=()=>evaluate(`JSON.stringify([...document.querySelectorAll('#part-controls input,#source-controls input,#source-zoom,#photo-guide,#camera-guide')].map(e=>[e.value,e.checked]))`);
  const set=(id,value)=>evaluate(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.type==='range'?'input':'change'));})()`);
  const drag=async(from,to)=>{
    const point=p=>({...p,id:1,radiusX:8,radiusY:8,force:.7});
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(from)]});
    for(let i=1;i<=5;i++)await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point({x:from.x+(to.x-from.x)*i/5,y:from.y+(to.y-from.y)*i/5})]});
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await evaluate(`(async()=>{
    const c=document.createElement('canvas');c.width=400;c.height=600;const x=c.getContext('2d');x.fillStyle='#ad8063';x.fillRect(0,0,400,600);
    const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'screen.png',{type:'image/png'}));const e=document.querySelector('#image-file');e.files=dt.files;e.dispatchEvent(new Event('change'));
    window.feed=document.createElement('canvas');feed.width=640;feed.height=480;let n=0;
    window.feedTimer=setInterval(()=>{const c=feed.getContext('2d');c.fillStyle='hsl('+(n++*6%360)+' 70% 50%)';c.fillRect(0,0,640,480);},33);
    window.cameraRequests=0;navigator.mediaDevices.getUserMedia=async()=>{cameraRequests++;return feed.captureStream(30);};
    const capture=HTMLCanvasElement.prototype.captureStream;HTMLCanvasElement.prototype.captureStream=function(fps){if(this!==feed)window.recordingCanvas=this;return capture.call(this,fps);};
    document.querySelector('#start').click();
  })()`);
  await waitFor("document.querySelector('#camera').readyState>=2&&!document.querySelector('#save').disabled");
  await evaluate("window.originalStream=document.querySelector('#camera').srcObject;window.originalCanvas=document.querySelector('#composition');window.originalVideo=document.querySelector('#camera');");
  const before=await values();const initialScroll=await evaluate('scrollY');
  const templateLabel=await evaluate("document.querySelector('#templates-open').textContent");
  for(const id of ['camera','finished','photo','camera','photo']){
    await tab(id);assert.equal(await values(),before);
    assert.equal(await evaluate("originalCanvas===document.querySelector('#composition')&&originalVideo===document.querySelector('#camera')&&originalStream===originalVideo.srcObject&&cameraRequests===1&&originalStream.active"),true);
    assert.equal(await evaluate("!originalVideo.closest('[inert]')&&getComputedStyle(originalVideo).visibility==='visible'"),true);
    assert.equal(await evaluate("document.querySelector('#templates-open').textContent"),templateLabel);
    assert.equal(await evaluate('scrollY'),initialScroll);
  }
  pass('three tabs preserve editor values, DOM, stream and scroll position without restarting camera');
  await tab('finished');
  assert.equal(await evaluate(`(()=>{const o=document.querySelector('[data-editor=composition]');return o.getContext('2d').getImageData(0,0,o.width,o.height).data.every(v=>v===0)&&getComputedStyle(document.querySelector('#photo-magnifier')).visibility==='hidden';})()`),true);
  const locked=await values();const center=await evaluate("(()=>{const r=document.querySelector('.stage').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await drag(center,{x:center.x+15,y:center.y+10});assert.equal(await values(),locked);
  pass('finished tab clears guides, hides magnifiers and prevents editing without changing saved guide settings');
  for(const zoom of [100,200,400]){
    await tab('photo');await set('photo-view-zoom',zoom);await set('part-x',50);await set('part-y',50);
    await tab('camera');await tab('photo');
    const p=await evaluate("(()=>{const r=document.querySelector('#composition').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};})()");
    const old=await evaluate("Number(document.querySelector('#part-x').value)");
    await drag(p,{x:p.x+9,y:p.y+3});const next=await evaluate("Number(document.querySelector('#part-x').value)");
    assert.ok(Math.abs(next-old-900/p.w)<.2,`${zoom}% editor delta ${next-old}, width ${p.w}`);
  }
  pass('100/200/400% direct editing remains accurate after hiding and restoring the canvas');
  await tab('camera');await set('camera-view-zoom',200);
  const cameraMatrix=await evaluate("document.querySelector('#camera-preview').style.transform");
  await tab('photo');assert.equal(await evaluate("document.querySelector('#photo-view-value').value"),'400%');
  await tab('camera');assert.equal(await evaluate("document.querySelector('#camera-preview').style.transform"),cameraMatrix);
  pass('photo and camera zoom and pan transforms remain independent across tabs');
  await tab('photo');await evaluate("document.querySelector('#photo-view-reset').click();document.querySelector('#photo-loupe').checked=false;document.querySelector('#photo-loupe').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("document.querySelector('#photo-magnifier').hidden"),true);
  await evaluate("document.querySelector('#photo-loupe').checked=true;document.querySelector('#photo-loupe').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("document.querySelector('#photo-magnifier').hidden"),false);
  pass('magnifier storage and independent toggles');
  await evaluate("document.querySelector('#settings-toggle').click();document.querySelector('#settings-parts').open=true");
  assert.equal(await evaluate("document.querySelector('#settings-panel').open&&document.querySelector('#settings-toggle').getAttribute('aria-expanded')==='true'"),true);
  await set('quick-feather',47);assert.equal(await evaluate("document.querySelector('#part-feather').value"),'47');
  await evaluate("document.querySelector('#settings-toggle').click()");
  assert.equal(await evaluate("document.querySelector('#settings-panel').open"),false);
  pass('bounded settings disclosure opens and closes, with immediate model updates');
  // Native recordings from each tab; tabs stay enabled while editing is locked.
  const recordings=[];
  for(const startTab of ['photo','camera','finished']){
    await tab(startTab);await evaluate("document.querySelector('#record-start').click()");
    await waitFor("document.querySelector('#record-status').dataset.state==='recording'");
    const signatures=[];
    for(const id of ['camera','photo','finished']){
      assert.equal(await evaluate(`document.querySelector('#screen-${id}').disabled`),false);
      await tab(id);await new Promise(r=>setTimeout(r,350));
      signatures.push(await evaluate('recordingCanvas.toDataURL()'));
    }
    assert.ok(new Set(signatures).size>1,'recording continues moving across tabs');
    await evaluate("document.querySelector('#record-stop').click()");
    await waitFor("document.querySelector('#record-result').open");
    await waitFor("document.querySelector('#record-player').readyState>=2");
    const info=await evaluate(`(()=>{const v=document.querySelector('#record-player');return{width:v.videoWidth,height:v.videoHeight,duration:v.duration,mime:v.currentSrc};})()`);
    assert.ok(info.width>0&&info.height>0);
    // Decode two real recorded frames, rather than relying on recorder mocks.
    const frameAt=async time=>evaluate(`(async()=>{const v=document.querySelector('#record-player');await new Promise(r=>{v.addEventListener('seeked',r,{once:true});v.currentTime=${time};});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL();})()`);
    assert.notEqual(await frameAt(.1),await frameAt(.8));
    recordings.push({startTab,width:info.width,height:info.height,duration:Number.isFinite(info.duration)?info.duration:'stream duration unknown'});
    await evaluate("document.querySelector('#record-acknowledge').click();document.querySelector('#record-close').click()");
  }
  pass('three actual recordings start from all tabs and keep moving during tab changes; decoded frames differ');
  await evaluate("document.querySelector('#camera').pause();clearInterval(feedTimer)");
  await tab('photo');await evaluate("document.querySelector('#save').click()");await waitFor("!document.querySelector('#save').disabled");
  const png=await evaluate("(async()=>{const image=document.querySelector('#export-image');await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);return c.toDataURL();})()");
  await tab('finished');await evaluate("document.querySelector('#save').click()");await waitFor("!document.querySelector('#save').disabled");
  assert.equal(await evaluate("(async()=>{const image=document.querySelector('#export-image');await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);return c.toDataURL();})()"),png);
  pass('finished PNG matches editing-tab PNG exactly and excludes presentation UI');
  const layouts=[];
  await evaluate("document.querySelector('#export-result').hidden=true;window.scrollTo(0,0)");
  for(const [width,height] of [[375,812],[390,844],[844,390],[375,568],[1280,900]]){
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});
    await new Promise(r=>setTimeout(r,100));
    for(const id of ['photo','camera','finished']){
      await tab(id);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${width}x${height}/${id} overflow`);
      assert.equal(await evaluate("[...document.querySelectorAll('.screen-tabs button,#basic-bar button:not([hidden]),#image-trigger')].filter(e=>!e.hidden).every(e=>e.getBoundingClientRect().height>=44)"),true);
    }
    await tab('photo');await evaluate("document.querySelector('#photo-loupe').checked=false;document.querySelector('#photo-loupe').dispatchEvent(new Event('change'));document.querySelector('.stage').scrollIntoView({block:'center',behavior:'instant'})");
    const p=await evaluate("(()=>{const r=document.querySelector('#composition').getBoundingClientRect();const v=id=>Number(document.querySelector(id).value);return{x:r.x+r.width*v('#part-x')/100,y:r.y+r.height*v('#part-y')/100,w:r.width,before:v('#part-x')};})()");
    await drag({x:p.x,y:p.y},{x:p.x+4,y:p.y-2});
    assert.ok(Math.abs(await evaluate("Number(document.querySelector('#part-x').value)")-p.before-400/p.w)<.2,`editor after resizing to ${width}x${height}`);
    layouts.push({width,height,pageHeight:await evaluate('document.documentElement.scrollHeight')});
  }
  pass('375/390px portrait, landscape, short screen and desktop: accurate touch edits after resize, no horizontal overflow, main touch targets ≥44px');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await tab('photo');await evaluate('window.scrollTo(0,0)');
  const label=(process.env.CHROME_PATH||'').includes('Edge')?'edge':'chrome';
  const browser=await evaluate('navigator.userAgent');
  const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`reports/v0.7.0-screen-${label}.png`,Buffer.from(data,'base64'));
  await writeFile(`reports/v0.7.0-screens-${label}.json`,JSON.stringify({browser,groups:count,recordings,layouts},null,2)+'\n');
}
