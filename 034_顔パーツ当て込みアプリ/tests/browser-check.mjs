// Focused Chromium smoke check. No third-party test dependencies.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { checkZoom } from './zoom-check.mjs';
import { checkMultiParts } from './multi-parts-check.mjs';
import { checkTemplates } from './template-check.mjs';
import { checkTracking } from './tracking-check.mjs';
import { comparePerformance } from './performance-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname);
    let target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if(name.startsWith('/baseline/') && process.env.BASELINE_DIR) {
      const relative=name.slice('/baseline/'.length),baseline=path.resolve(process.env.BASELINE_DIR),candidate=path.resolve(baseline,relative);
      if(!candidate.startsWith(baseline+path.sep)){res.writeHead(403).end();return;}
      try{await readFile(candidate);target=candidate;}catch{target=path.resolve(root,relative);}
    } else if (!target.startsWith(root)) { res.writeHead(403).end(); return; }
    if (process.env.SIMULATE_STALE_CACHE === '1' && name === '/app.js') await new Promise(resolve => setTimeout(resolve, 1000));
    const content = await readFile(target);
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[path.extname(target)] || 'application/octet-stream');
    if (process.env.SIMULATE_STALE_CACHE === '1' && name === '/app.js' && !url.search) {
      // v0.1.1 accessed #guide; v0.1.2 replaced it with independent controls.
      res.end("document.querySelector('#guide').addEventListener('change', () => {});"); return;
    }
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'portrait-browser-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  ...(process.argv.includes('--recording')?['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']:[]),
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chromium launch timed out: ' + output.slice(-1500))), 15000);
    browser.once('error', error => { clearTimeout(timeout); reject(error); });
    browser.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = []; const choosers = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Page.fileChooserOpened') choosers.push(message.params);
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP timed out: ' + method)), process.argv.includes('--recording')?45000:12000);
    pending.set(++id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => call(method, params, sessionId);
  await command('Runtime.enable'); await command('Page.enable');
  const viewportWidth = Number(process.env.BROWSER_WIDTH || 390), viewportHeight = Number(process.env.BROWSER_HEIGHT || 844);
  await command('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: Number(process.env.BROWSER_DPR || 1), mobile: viewportWidth <= 760 });
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await call('Browser.setDownloadBehavior', { behavior: 'deny' }); // The generated blob is checked instead of writing a download.
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, attempts = 80) => {
    for (let i = 0; i < attempts; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
    const state=await evaluate("JSON.stringify({status:document.querySelector('#status')?.textContent,recording:document.querySelector('#record-status')?.textContent,recordingState:document.querySelector('#record-status')?.dataset.state,recordStartDisabled:document.querySelector('#record-start')?.disabled,camera:document.querySelector('#camera-state')?.textContent,tracking:document.querySelector('#tracking-status')?.textContent,template:document.querySelector('#template-message')?.textContent,visibility:document.visibilityState,startDisabled:document.querySelector('#start')?.disabled})");
    throw new Error(`Timed out: ${expression}; state: ${state}; runtime errors: ${JSON.stringify(errors)}`);
  };
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  if(process.env.PICKER_AUDIT==='1'||process.env.PICKER_ONLY==='1'||process.argv.includes('--picker')) {
    const {checkPicker}=await import('./picker-check.mjs');
    await checkPicker({evaluate,command,waitFor,choosers,profile,audit:process.env.PICKER_AUDIT==='1'});
    assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--recording')) {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:profile});
    await waitFor("document.body.dataset.appState==='ready'");
    const {checkRecording}=await import('./recording-check.mjs');await checkRecording({evaluate,command,waitFor,profile});assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--composite')) {
    await waitFor("document.body.dataset.appState==='ready'");
    const {checkComposite}=await import('./composite-check.mjs');await checkComposite({evaluate,command,waitFor});assert.deepEqual(errors,[]);
  } else if(process.env.PERFORMANCE_COMPARE==='1') {
    await waitFor("!!document.querySelector('#image-file')&&!document.querySelector('#image-file').disabled");
    await comparePerformance({evaluate,waitFor});assert.deepEqual(errors,[]);
  } else if(process.env.TRACKING_ONLY==='1') {
    await waitFor("!!document.querySelector('#image-file')&&!document.querySelector('#image-file').disabled");
    await checkTracking({evaluate,command,waitFor});assert.deepEqual(errors,[]);
  } else {
  if (process.env.SIMULATE_STALE_CACHE === '1') {
    await waitFor("!!document.querySelector('#image-file')");
    assert.equal(await evaluate("document.querySelector('#image-file').disabled"), true);
    console.log('PASS: image selection waits for app initialization');
  }
  await waitFor("!!document.querySelector('#part-x')");
  await waitFor("!document.querySelector('#image-file').disabled");
  assert.deepEqual(await evaluate("[document.querySelector('#save').disabled, !document.querySelector('#empty-hint').hidden, document.documentElement.scrollWidth <= innerWidth]"), [true, true, true]);
  console.log(`PASS: empty state and ${viewportWidth}x${viewportHeight} layout`);
  assert.equal(await evaluate("document.querySelector('#advanced').open"), false);
  const collapsedHeight = await evaluate('document.documentElement.scrollHeight');
  await evaluate("document.querySelector('#advanced summary').click()");
  assert.equal(await evaluate("document.querySelector('#advanced').open"), true);
  assert.ok(await evaluate('document.documentElement.scrollHeight') > collapsedHeight + 300);
  await evaluate("document.querySelector('#advanced summary').click()");
  assert.equal(await evaluate("document.querySelector('#advanced').open"), false);
  console.log('PASS: detail controls start collapsed and expand only on demand');
  await evaluate(`(() => {
    const data = new DataTransfer(); data.items.add(new File(['invalid'], 'broken.png', { type: 'image/png' }));
    const input = document.querySelector('#image-file'); input.files = data.files; input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor("document.querySelector('#status').dataset.error === 'true'");
  assert.equal(await evaluate("document.querySelector('#save').disabled"), true);
  console.log('PASS: invalid image reports an error without enabling export');
  await evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 600;
    c.getContext('2d').fillStyle = '#a04030'; c.getContext('2d').fillRect(0,0,400,600);
    const blob = await new Promise(r => c.toBlob(r));
    const data = new DataTransfer(); data.items.add(new File([blob], 'portrait.png', { type: 'image/png' }));
    const input = document.querySelector('#image-file'); input.files = data.files; input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor("!document.querySelector('#save').disabled");
  assert.deepEqual(await evaluate("[document.querySelector('#composition').width,document.querySelector('#composition').height,Array.from(document.querySelector('#composition').getContext('2d').getImageData(0,0,1,1).data)]"), [400, 600, [160,64,48,255]]);
  const touchDrag = async (from, to, cancel = false) => {
    const point = p => ({ x: p.x, y: p.y, id: 1, radiusX: 8, radiusY: 8, force: .7 });
    await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] });
    for (let i = 1; i <= 5; i++) await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point({ x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 })] });
    await command('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  };
  await evaluate(`window.photoBox = () => {
    const r = document.querySelector('#composition').getBoundingClientRect();
    const value = key => Number(document.querySelector('#part-'+key).value);
    return { x:r.left+r.width*value('x')/100, y:r.top+r.height*value('y')/100,
      width:r.width*value('width')/100,height:r.height*value('height')/100,
      surfaceWidth:r.width,surfaceHeight:r.height,percentX:value('x'),percentY:value('y'),angle:value('rotation') };
  }; document.querySelector('#composition').scrollIntoView({block:'center',behavior:'instant'});`);
  await new Promise(r => setTimeout(r, 100));
  const scrollBefore = await evaluate('scrollY');
  let photo = await evaluate('window.photoBox()');
  await touchDrag(photo, { x: photo.x + 17, y: photo.y + 14 });
  let changed = await evaluate('window.photoBox()');
  assert.ok(Math.abs(changed.percentX - photo.percentX - 17 / photo.surfaceWidth * 100) < .2);
  assert.ok(Math.abs(changed.percentY - photo.percentY - 14 / photo.surfaceHeight * 100) < .2);
  assert.ok(Math.abs(await evaluate('scrollY') - scrollBefore) < 1);
  photo = changed;
  const corner = { x: photo.x + photo.width / 2, y: photo.y + photo.height / 2 };
  await touchDrag(corner, { x: corner.x + 18, y: corner.y + 10 });
  changed = await evaluate('window.photoBox()');
  assert.ok(Math.abs(changed.width - photo.width - 18) < 1);
  assert.ok(Math.abs(changed.height - photo.height - 10) < 1);
  // Rotate through the upper handle, then restore zero rotation using fine controls.
  const rotationHandle = { x: changed.x, y: changed.y - changed.height / 2 - 30 };
  await touchDrag(rotationHandle, { x: changed.x + changed.height / 2 + 30, y: changed.y });
  assert.ok(Math.abs((await evaluate('window.photoBox()')).angle - 90) < 1);
  await evaluate("const rot=document.querySelector('#part-rotation'); rot.value=0; rot.dispatchEvent(new Event('input'));");
  photo = await evaluate('window.photoBox()');
  await touchDrag(photo, { x: photo.x + 5, y: photo.y + 4 }, true);
  photo = await evaluate('window.photoBox()');
  await touchDrag(photo, { x: photo.x - 5, y: photo.y - 4 });
  assert.ok(Math.abs((await evaluate('window.photoBox()')).percentX - photo.percentX + 5 / photo.surfaceWidth * 100) < .2);
  photo = await evaluate('window.photoBox()');
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: photo.x, y: photo.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: photo.x + 6, y: photo.y + 3, buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: photo.x + 6, y: photo.y + 3, button: 'left', clickCount: 1 });
  assert.ok(Math.abs((await evaluate('window.photoBox()')).percentX - photo.percentX - 6 / photo.surfaceWidth * 100) < .2);
  console.log('PASS: real touch drag, resize, rotation, no scroll jump, and cancellation recovery');
  await evaluate("document.querySelector('#start').click()");
  await waitFor("document.querySelector('#camera-state').textContent === '使用中' && document.querySelector('#camera').readyState >= 2");
  await new Promise(r => setTimeout(r, 200));
  await evaluate(`window.cameraBox = async () => {
    const {sourceRect} = await import('./renderer.js');
    const r = document.querySelector('#camera-preview').getBoundingClientRect(), video = document.querySelector('#camera');
    const image = document.querySelector('#composition');
    const value = id => Number(document.querySelector('#'+id).value);
    const aspect = image.width * value('part-width') / (image.height * value('part-height'));
    const crop = sourceRect(video.videoWidth,video.videoHeight,aspect,{x:value('source-x')/100,y:value('source-y')/100,zoom:value('source-zoom')},document.querySelector('#mirror').checked);
    return {x:r.left+(crop.visualX+crop.width/2)/video.videoWidth*r.width,y:r.top+(crop.y+crop.height/2)/video.videoHeight*r.height,
      width:crop.width/video.videoWidth*r.width,height:crop.height/video.videoHeight*r.height,surfaceWidth:r.width,surfaceHeight:r.height,zoom:value('source-zoom')};
  }; document.querySelector('#camera-preview').scrollIntoView({block:'center',behavior:'instant'});`);
  const cameraScroll = await evaluate('scrollY');
  let source = await evaluate('window.cameraBox()');
  await touchDrag(source, {x:source.x+12,y:source.y-9});
  let newSource = await evaluate('window.cameraBox()');
  assert.ok(Math.abs(newSource.x-source.x-12)<1);
  assert.ok(Math.abs(newSource.y-source.y+9)<1);
  assert.ok(Math.abs(await evaluate('scrollY')-cameraScroll)<1);
  const sourceCorner = {x:newSource.x+newSource.width/2,y:newSource.y+newSource.height/2};
  await touchDrag(sourceCorner,{x:sourceCorner.x-12,y:sourceCorner.y-6});
  assert.ok((await evaluate('window.cameraBox()')).zoom > newSource.zoom);
  await evaluate("document.querySelector('#mirror').click()");
  source = await evaluate('window.cameraBox()');
  await touchDrag(source, {x:source.x-8,y:source.y+5});
  newSource = await evaluate('window.cameraBox()');
  assert.ok(Math.abs(newSource.x-source.x+8)<1);
  assert.ok(Math.abs(newSource.y-source.y-5)<1);
  await evaluate("document.querySelector('#photo-guide').click()");
  assert.equal(await evaluate("document.querySelector('#photo-guide').checked"), false);
  await evaluate("document.querySelector('#photo-guide').click()");
  console.log('PASS: camera touch move/resize, mirror on/off coordinates, display mode');
  const before = await evaluate("document.querySelector('#composition').toDataURL()");
  await evaluate(`(() => {
    for (const [key,value] of Object.entries({x:40,y:50,width:32,height:18,rotation:25,feather:60})) {
      const el = document.querySelector('#part-'+key); el.value = value; el.dispatchEvent(new Event('input'));
      if (el.previousElementSibling.querySelector('output').value !== value + (key==='rotation'?'°':'%')) throw new Error('control output');
    }
    const shape = document.querySelector('#shape'); shape.value='rectangle'; shape.dispatchEvent(new Event('change'));
    document.querySelector('#mirror').click();
  })()`);
  assert.notEqual(await evaluate("document.querySelector('#composition').toDataURL()"), before);
  assert.equal(await evaluate("document.querySelector('#quick-feather').value"), '60');
  await evaluate("const quick=document.querySelector('#quick-feather');quick.value=35;quick.dispatchEvent(new Event('input'));");
  assert.equal(await evaluate("document.querySelector('#part-feather').value"), '35');
  if (process.env.SCREENSHOT_PATH) {
    await evaluate("window.scrollTo(0,0)");
    const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(process.env.SCREENSHOT_PATH, Buffer.from(data, 'base64'));
  }
  console.log('PASS: image decode/draw, fake camera start, adjustment controls and mirror');
  // Freeze the source frame to compare exported pixels with the clean live composite.
  await evaluate("(async()=>{document.querySelector('#camera').pause();await new Promise(r=>requestAnimationFrame(r));})()");
  await checkZoom({ evaluate, command, touchDrag, waitFor });
  await checkMultiParts({ evaluate, command, touchDrag, waitFor });
  await evaluate("document.querySelector('#save').click()");
  await waitFor("!document.querySelector('#save').disabled && !document.querySelector('#export-result').hidden");
  assert.equal(await evaluate("(async()=>{const r=await fetch(document.querySelector('#export-image').src);const b=await r.blob();const a=new Uint8Array(await b.arrayBuffer());return b.type==='image/png' && a[0]===137 && a[1]===80;})()"), true);
  assert.equal(await evaluate(`(async()=>{const img=document.querySelector('#export-image');await img.decode();const source=document.querySelector('#composition');const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const a=x.getImageData(0,0,c.width,c.height).data,b=source.getContext('2d').getImageData(0,0,c.width,c.height).data;return a.every((value,i)=>value===b[i]);})()`),true);
  await evaluate("window.testStream=document.querySelector('#camera').srcObject; document.querySelector('#stop').click()");
  assert.deepEqual(await evaluate("[window.testStream.getTracks().every(t=>t.readyState==='ended'),document.querySelector('#camera').srcObject,document.querySelector('#start').disabled]"), [true,null,false]);
  await evaluate("document.querySelector('#save').click()");
  await waitFor("!document.querySelector('#save').disabled");
  assert.equal(await evaluate(`(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=4)if(p[i]!==160||p[i+1]!==64||p[i+2]!==48||p[i+3]!==255)return false;return true;})()`), true);
  assert.deepEqual(errors, []);
  console.log('PASS: PNG signature, guide excluded from PNG, camera tracks stopped, no runtime errors');
  await evaluate("document.querySelector('#camera-loupe').checked=false;document.querySelector('#camera-loupe').dispatchEvent(new Event('change'));document.querySelector('#start').click()");
  await waitFor("document.querySelector('#camera-state').textContent === '使用中' && document.querySelector('#camera').readyState >= 2");
  await evaluate("document.querySelector('#camera-preview').scrollIntoView({block:'center',behavior:'instant'})");
  const restarted = await evaluate('window.cameraBox()');
  await touchDrag(restarted,{x:restarted.x+6,y:restarted.y-3});
  assert.ok(Math.abs((await evaluate('window.cameraBox()')).x-restarted.x-6)<1);
  await evaluate("document.querySelector('#stop').click()");
  console.log('PASS: camera stop/restart preserves working view and edit gestures');
  await checkTemplates({ evaluate, command, waitFor });
  await checkTracking({ evaluate, command, waitFor });
  assert.deepEqual(errors, []);
  await evaluate(`navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; document.querySelector('#start').click()`);
  await waitFor("document.querySelector('#status').dataset.error === 'true'");
  assert.deepEqual(await evaluate("[document.querySelector('#start').disabled,document.querySelector('#stop').disabled,document.querySelector('#camera').srcObject,document.querySelector('#status').textContent.includes('許可')]"), [false,true,null,true]);
  console.log('PASS: camera permission denial is shown and controls recover');
  }
} finally {
  socket?.close(); browser.kill();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => (browser.exitCode !== null || browser.signalCode !== null) ? resolve() : browser.once('exit', resolve));
  assert.equal(path.dirname(path.resolve(profile)), path.resolve(tmpdir()));
  assert.ok(path.basename(profile).startsWith('portrait-browser-'));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
