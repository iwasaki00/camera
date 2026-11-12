import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { checkDiagnosticPanel } from './diagnostic-check.mjs';

// Integration: actual shipped Face Landmarker + WASM + model, using a public-domain face image.
export async function checkTracking({evaluate,command,waitFor}) {
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const write=values=>evaluate(`(()=>{for(const [id,value]of Object.entries(${JSON.stringify(values)})){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event(e.type==='range'?'input':'change'));}})()`);
  await command('Network.enable');
  // The app's local-only contract is also checked through all resource URLs recorded by the page.
  await evaluate(`(async()=>{
    document.querySelector('#stop').click();if(document.querySelector('#tracking-toggle').checked)document.querySelector('#tracking-manual').click();
    const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').fillStyle='#a04030';c.getContext('2d').fillRect(0,0,400,600);
    const blob=await new Promise(r=>c.toBlob(r)),dt=new DataTransfer();dt.items.add(new File([blob],'tracking-background.png',{type:'image/png'}));
    const e=document.querySelector('#image-file');e.files=dt.files;e.dispatchEvent(new Event('change'));
    window.faceImage=new Image();window.faceImage.src='./tests/fixtures/astronaut.png';await window.faceImage.decode();
    window.faceCanvas=document.createElement('canvas');window.faceCanvas.width=640;window.faceCanvas.height=480;
    const renderFace=({dx=0,scale=1,angle=0,blank=false}={})=>{
      const ctx=window.faceCanvas.getContext('2d');ctx.fillStyle='#191919';ctx.fillRect(0,0,640,480);if(blank)return;
      ctx.save();ctx.translate(320+dx,240);ctx.rotate(angle);ctx.scale(scale,scale);
      // Crop the NASA photo around the face, enlarging it for stable landmark testing.
      ctx.drawImage(window.faceImage,100,30,240,270,-170,-190,340,382.5);ctx.restore();
    };window.facePose={};window.drawFace=pose=>{window.facePose=pose||{};renderFace(window.facePose)};window.drawFace();
    window.faceTimer=setInterval(()=>renderFace(window.facePose),33);
    window.originalGetUserMedia=navigator.mediaDevices.getUserMedia;
    window.nativeTrackingWorker=window.Worker;window.Worker=class extends window.nativeTrackingWorker {constructor(...args){super(...args);window.testTrackingWorker=this;}};
    navigator.mediaDevices.getUserMedia=async()=>{window.faceStream=window.faceCanvas.captureStream(30);return window.faceStream;};
  })()`);
  await waitFor("!document.querySelector('#save').disabled");
  for(const [i,type]of ['mouth','leftEye','rightEye','nose'].entries()){
    await click(`select-${type}`);await write({'part-x':i%2?75:25,'part-y':i<2?25:75,'part-width':26,'part-height':16,'part-rotation':0,'part-feather':10});
    if(!await evaluate("document.querySelector('#part-enabled').checked"))await click('part-enabled');
  }
  await evaluate("window.manualSources={};for(const type of ['mouth','leftEye','rightEye','nose']){document.querySelector('#select-'+type).click();window.manualSources[type]=['source-x','source-y','source-zoom'].map(id=>document.getElementById(id).value)}");
  assert.equal(await evaluate("document.querySelector('#tracking-toggle').checked"),false);
  await evaluate("document.querySelector('#screen-camera')?.click();document.querySelector('#camera-preview').scrollIntoView({block:'center',behavior:'instant'})");
  await click('start');await waitFor("document.querySelector('#camera-state').textContent==='使用中'&&document.querySelector('#camera').readyState>=2");
  await click('tracking-toggle');
  await waitFor("['tracking','error'].includes(document.querySelector('#tracking-status').dataset.state)",300);
  assert.equal(await evaluate("document.querySelector('#tracking-status').dataset.state"),'tracking',await evaluate("document.querySelector('#status').textContent"));
  assert.equal(await evaluate("document.querySelector('#tracking-status').dataset.backend"),'worker');
  assert.equal(await evaluate("document.querySelector('#source-x').disabled"),true);
  console.log('PASS REAL MODEL: local VIDEO-mode Worker/WASM inference detects the face and enables live tracking');
  await evaluate("window.trackedStream=document.querySelector('#camera').srcObject;window.tabDetectionCount=Number(document.querySelector('#tracking-status').dataset.count);for(const id of ['photo','finished','camera'])document.querySelector('#screen-'+id).click()");
  await waitFor("Number(document.querySelector('#tracking-status').dataset.count)>tabDetectionCount&&document.querySelector('#tracking-status').dataset.state==='tracking'",150);
  assert.equal(await evaluate("document.querySelector('#tracking-toggle').checked&&document.querySelector('#camera').srcObject===trackedStream"),true);
  console.log('PASS SCREEN TRACKING: tab switches preserve active real-model inference and the camera stream');
  await checkDiagnosticPanel({evaluate,waitFor});

  // Inspect raw model geometry directly as a separate integration assertion, without injecting app state.
  await evaluate(`(async()=>{const {createFaceDetector}=await import('./face-detector.js?v=0.6.2');window.checkDetector=await createFaceDetector();
    const {landmarksToCrops}=await import('./tracking-geometry.js?v=0.6.2');window.realCrops=()=>landmarksToCrops(window.checkDetector.detect(window.faceCanvas,performance.now()),640,480);
    window.baseCrops=window.realCrops();})()`);
  const base=await evaluate('window.baseCrops');assert.deepEqual(Object.keys(base),['mouth','leftEye','rightEye','nose']);assert.ok(base.leftEye.x>base.rightEye.x);
  await evaluate('window.drawFace({dx:32})');const moved=await evaluate('window.realCrops()');assert.ok(moved.mouth.x-base.mouth.x>.025);
  await evaluate('window.drawFace({scale:1.12})');const scaled=await evaluate('window.realCrops()');assert.ok(scaled.mouth.width>base.mouth.width*1.03);
  await evaluate('window.drawFace({angle:.22})');const rotated=await evaluate('window.realCrops()');assert.ok(rotated.mouth.angle-base.mouth.angle>.12);
  await evaluate('window.drawFace();window.checkDetector.close();window.checkDetector=null');
  const settlingCount=await evaluate("Number(document.querySelector('#tracking-status').dataset.count)");
  await waitFor(`document.querySelector('#tracking-status').dataset.state==='tracking'&&Number(document.querySelector('#tracking-status').dataset.count)>=${settlingCount+3}`,150);
  console.log('PASS REAL MODEL: four landmark crops, anatomical eye identity, translation, scale and roll on transformed image input');
  await write({'composite-mode':'natural'});
  console.log('PASS COLOR TRACKING: NATURAL corrections enabled alongside actual four-part face tracking');

  await click('select-mouth');await write({'tracking-offsetX':20,'tracking-offsetY':-10,'tracking-widthScale':1.2,'tracking-heightScale':1.3,'tracking-rotation':12});
  await click('select-leftEye');assert.equal(await evaluate("document.querySelector('#tracking-offsetX').value"),'0');await click('select-mouth');assert.equal(await evaluate("document.querySelector('#tracking-offsetX').value"),'20');
  const verifyManual=async()=>{assert.equal(await evaluate("(()=>{for(const [type,expected]of Object.entries(window.manualSources)){document.querySelector('#select-'+type).click();if(JSON.stringify(['source-x','source-y','source-zoom'].map(id=>document.getElementById(id).value))!==JSON.stringify(expected))return false;}return true;})()"),true);};
  await verifyManual();
  await write({'photo-view-zoom':200,'camera-view-zoom':300,'interaction-mode':'pan'});
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
  await evaluate("document.querySelector('#tracking-settings').open=true");
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);await evaluate("document.querySelector('#tracking-settings').open=false");
  await verifyManual();
  console.log('PASS TRACKING UI: independent corrections, protected manual sources, compact layout and zoom/pan separation');

  // Export the current live composite; no overlay canvas is ever passed to the PNG encoder.
  const savePNG=async()=>{await click('save');await waitFor("!document.querySelector('#save').disabled");return evaluate("(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL();})()");};
  const image=await savePNG();assert.ok(image!==await evaluate("(()=>{const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').fillStyle='#a04030';c.getContext('2d').fillRect(0,0,400,600);return c.toDataURL()})()"),'Tracked PNG must include face crops');
  // PNG contains pixels from all four parts, while guides and magnifiers remain separate canvases.
  assert.equal(await evaluate(`(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').drawImage(img,0,0);
    return [[100,150],[300,150],[100,450],[300,450]].every(([x,y])=>{const p=c.getContext('2d').getImageData(x,y,1,1).data;return !(p[0]===160&&p[1]===64&&p[2]===48)});})()`),true);
  await evaluate("document.querySelector('#camera-loupe').checked=true;document.querySelector('#camera-loupe').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("document.querySelector('#camera-magnifier').hidden"),false);
  await click('select-leftEye');assert.equal(await evaluate("document.querySelector('#camera-magnifier .magnifier-heading span').textContent"),'左目');
  console.log('PASS TRACKING UI: magnifiers follow selected tracked parts; PNG contains all active crops and no UI');

  // Measure actual composition cadence and inference timings on this desktop Chromium, not an iPhone.
  const measure=()=>evaluate(`(async()=>{
    const canvas=document.querySelector('#composition'),ctx=canvas.getContext('2d'),original=ctx.clearRect;let count=0;
    ctx.clearRect=function(...args){count++;return original.apply(this,args)};
    const start=performance.now(),before=Number(document.querySelector('#tracking-status').dataset.count);
    await new Promise(r=>setTimeout(r,2000));const elapsed=performance.now()-start;ctx.clearRect=original;
    return {drawFps:Number((count*1000/elapsed).toFixed(1)),detectionFps:Number(((Number(document.querySelector('#tracking-status').dataset.count)-before)*1000/elapsed).toFixed(1)),timing:document.querySelector('#tracking-metrics').textContent};})()`);
  const perf=await measure();assert.ok(perf.drawFps>0&&perf.detectionFps>0);console.log('PERF REAL MODEL (desktop Chromium / 4 parts / worker): '+JSON.stringify(perf));
  if(process.env.NATURAL_PERFORMANCE==='1'){const {compareNaturalPerformance}=await import('./natural-performance.mjs');await compareNaturalPerformance({evaluate,waitFor});}
  if(process.env.RECORDING_PERFORMANCE==='1'){const {compareRecordingPerformance}=await import('./recording-performance.mjs');await compareRecordingPerformance({evaluate,waitFor});}
  if(process.env.TRACKING_SCREENSHOT_PATH){await evaluate('window.scrollTo(0,0)');const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.TRACKING_SCREENSHOT_PATH,Buffer.from(data,'base64'));}

  // A black frame is a real-model no-face test. Expired crops and magnifiers must disappear.
  await evaluate('window.drawFace({blank:true})');await waitFor("document.querySelector('#tracking-status').dataset.state==='notFound'",150);
  const blankPNG=await savePNG();assert.equal(blankPNG,await evaluate("document.querySelector('#composition').toDataURL()"));
  assert.equal(await evaluate("(()=>{const p=document.querySelector('#composition').getContext('2d').getImageData(0,0,400,600).data;for(let i=0;i<p.length;i+=4)if(p[i]!==160||p[i+1]!==64||p[i+2]!==48||p[i+3]!==255)return false;return true;})()"),true);
  assert.equal(await evaluate("document.querySelector('#camera-magnifier').hidden"),true);
  await evaluate('window.drawFace()');await waitFor("document.querySelector('#tracking-status').dataset.state==='tracking'",150);
  console.log('PASS REAL MODEL: face loss hides expired composition/PNG crops and reacquisition resumes safely');

  await click('tracking-manual');await verifyManual();assert.equal(await evaluate("document.querySelector('#source-x').disabled"),false);
  assert.equal(await evaluate("document.querySelector('#tracking-status').textContent"),'手動');
  await click('tracking-toggle');await waitFor("document.querySelector('#tracking-status').dataset.state==='tracking'",300);
  // New schema retains preference/corrections but never serializes dynamic detections.
  await click('templates-open');await waitFor("document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  await click('template-export');await waitFor("document.querySelector('#template-manager').getAttribute('aria-busy')==='false'&&!document.querySelector('#template-download').hidden");
  await evaluate(`(async()=>{const {importTemplate}=await import('./template-zip.js?v=0.6.2');window.trackingZIP=await (await fetch(document.querySelector('#template-download').href)).blob();window.trackingDoc=(await importTemplate(window.trackingZIP)).doc;})()`);
  const saved=await evaluate('window.trackingDoc');assert.equal(saved.schemaVersion,3);assert.equal(saved.trackingEnabled,true);
  assert.equal(saved.parts.find(p=>p.partType==='mouth').tracking.offsetX,.2);
  assert.equal(JSON.stringify(saved).includes('landmarks'),false);assert.equal(JSON.stringify(saved).includes('baseCrops'),false);
  assert.equal(JSON.stringify(saved).includes('drawFps'),false);assert.equal(JSON.stringify(saved).includes('inferenceAverageMs'),false);
  await click('template-save-as');await evaluate("document.querySelector('#template-name').value='自動追従';document.querySelector('#template-name-form').requestSubmit()");
  await waitFor("!document.querySelector('#template-name-dialog').open&&document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  assert.equal(await evaluate(`(async()=>{const {TemplateStore}=await import('./template-store.js?v=0.6.2'),store=new TemplateStore();
    const record=(await store.list()).find(r=>r.doc.name==='自動追従');store.close();return record.doc.trackingEnabled&&record.doc.parts.find(p=>p.partType==='mouth').tracking.offsetX===.2;})()`),true);
  await click('templates-close');await click('tracking-manual');await click('templates-open');
  await waitFor("document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  await evaluate("const dt=new DataTransfer();dt.items.add(new File([window.trackingZIP],'tracking.zip',{type:'application/zip'}));const e=document.querySelector('#template-import');e.files=dt.files;e.dispatchEvent(new Event('change'));");
  await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-yes');await waitFor("!document.querySelector('#template-manager').open");
  assert.equal(await evaluate("document.querySelector('#tracking-toggle').checked"),true);assert.equal(await evaluate("document.querySelector('#camera').srcObject"),null);
  assert.equal(await evaluate("document.querySelector('#tracking-status').textContent"),'カメラ停止中');await verifyManual();
  assert.equal(saved.composite.mode,'natural');
  console.log('PASS TRACKING TEMPLATE: schema 3 ZIP retains natural mode, auto preference, per-part correction and manual sources; loading starts no camera/model');

  await click('start');await waitFor("document.querySelector('#camera-state').textContent==='使用中'");
  await waitFor("document.querySelector('#tracking-status').dataset.state==='tracking'",300);
  await evaluate("window.testTrackingWorker.dispatchEvent(new ErrorEvent('error',{message:'simulated worker failure',cancelable:true}))");
  await waitFor("document.querySelector('#tracking-status').dataset.state==='error'");assert.equal(await evaluate("document.querySelector('#tracking-toggle').checked"),false);await verifyManual();
  await click('tracking-toggle');await waitFor("document.querySelector('#tracking-status').dataset.state==='tracking'",300);await click('stop');
  console.log('PASS STABILITY: simulated Worker error during real tracking returns to manual; tracking can be started again');
  assert.equal(await evaluate("document.querySelector('#tracking-status').textContent"),'カメラ停止中');
  console.log('PASS REAL MODEL: camera stop and explicit restart maintain configuration and restart inference');

  // Worker failure must fall back to the main-thread detector rather than making the editor unusable.
  await evaluate("window.originalWorker=window.Worker;window.Worker=class{constructor(){throw new Error('worker unavailable')}}");
  await click('start');await waitFor("document.querySelector('#camera-state').textContent==='使用中'");
  await waitFor("['tracking','error'].includes(document.querySelector('#tracking-status').dataset.state)",300);
  assert.equal(await evaluate("document.querySelector('#tracking-status').dataset.state"),'tracking');
  assert.equal(await evaluate("document.querySelector('#tracking-status').dataset.backend"),'main');
  const fallbackPerf=await measure();assert.ok(fallbackPerf.drawFps>0&&fallbackPerf.detectionFps>0);console.log('PERF REAL MODEL (desktop Chromium / 4 parts / main fallback): '+JSON.stringify(fallbackPerf));await click('stop');
  console.log('PASS REAL MODEL: unavailable Worker uses actual main-thread inference at reduced input size/frequency');

  // Fail the actual model request on a fresh instance, exercising the application's manual fallback.
  await command('Network.setBlockedURLs',{urls:['*face_landmarker.task*']});
  await click('start');await waitFor("document.querySelector('#tracking-status').dataset.state==='error'",300);
  assert.equal(await evaluate("document.querySelector('#tracking-toggle').checked"),false);assert.equal(await evaluate("document.querySelector('#source-x').disabled"),false);
  await verifyManual();await command('Network.setBlockedURLs',{urls:[]});await click('stop');await evaluate('window.Worker=window.originalWorker');
  await evaluate('clearInterval(window.faceTimer);window.faceStream.getTracks().forEach(t=>t.stop());navigator.mediaDevices.getUserMedia=window.originalGetUserMedia;window.Worker=window.nativeTrackingWorker');
  assert.equal(await evaluate("performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)).every(r=>new URL(r.name).origin===location.origin)"),true);
  console.log('PASS TRACKING UI: model-load failure returns to preserved manual settings; page resources are all same-origin');
  // Actual old ZIP format, not just a mocked schema validator. Old auto fields must not activate detection.
  await click('templates-open');await waitFor("document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  await evaluate(`(async()=>{
    const {importTemplate}=await import('./template-zip.js?v=0.6.2'),{zipSync,strToU8}=await import('./vendor/fflate-0.8.2.js');
    const r=await importTemplate(window.trackingZIP),old=structuredClone(r.doc);old.schemaVersion=1;old.appVersion='0.3.0';delete old.trackingEnabled;for(const p of old.parts)delete p.tracking;
    const archive=zipSync({'template.json':strToU8(JSON.stringify(old)),[old.background.path]:new Uint8Array(await r.background.arrayBuffer())});
    const dt=new DataTransfer();dt.items.add(new File([archive],'legacy.zip',{type:'application/zip'}));const e=document.querySelector('#template-import');e.files=dt.files;e.dispatchEvent(new Event('change'));
  })()`);
  await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-yes');await waitFor("!document.querySelector('#template-manager').open");
  assert.equal(await evaluate("document.querySelector('#tracking-toggle').checked"),false);assert.equal(await evaluate("document.querySelector('#camera').srcObject"),null);await verifyManual();
  await click('select-mouth');assert.equal(await evaluate("document.querySelector('#tracking-offsetX').value"),'0');
  console.log('PASS TRACKING TEMPLATE: actual v0.3.0 schema 1 ZIP restores manual mode and original settings');
}
