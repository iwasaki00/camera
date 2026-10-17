import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional local Chrome smoke check. No packages or build step required.
// Use a Canvas-backed virtual camera and simulate a VP8-only browser.
// Windows headless fake-device reacquisition and H.264 encoders are unreliable
// in some environments. Real camera acquisition is covered separately by mocks;
// this smoke check exercises native video playback, capture and MediaRecorder.
// The application MIME order is unchanged.
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = await mkdtemp(path.join(tmpdir(), 'miniature-smoke-'));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!/^\/(index\.html|js\/[a-z]+\.js|css\/style\.css)$/.test(name)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(path.join(root, name));
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(artifacts, 'profile'), 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 15000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', bytes => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once('exit', code => { clearTimeout(timer); reject(Error('Chrome exited: ' + code)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.id) {
      const entry = pending.get(message.id); if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(Error(JSON.stringify(message.error))); else entry.resolve(message.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: ' + method)); }, 12000);
    pending.set(key, {resolve, reject, timer});
    socket.send(JSON.stringify({id:key, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  const { targetId } = await send('Target.createTarget', {url:'about:blank'});
  const { sessionId } = await send('Target.attachToTarget', {targetId, flatten:true});
  const cmd = (method, params) => send(method, params, sessionId);
  await cmd('Runtime.enable'); await cmd('Page.enable');
  const evaluate = async expression => {
    const result = await cmd('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let i=0; i<60; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Condition timed out: ' + expression + ' ' + JSON.stringify(await evaluate('({toast:document.querySelector("#toast").textContent, startDisabled:document.querySelector("#startButton").disabled, start:document.querySelector("#startButton").textContent, videoReady:document.querySelector("#sourceVideo").readyState, tracks:document.querySelector("#sourceVideo").srcObject?.getTracks().map(t=>({readyState:t.readyState,kind:t.kind})),hidden:document.hidden,trace:window.mediaTrace})')));
  };
  await cmd('Page.addScriptToEvaluateOnNewDocument', {source:
    'const isTypeSupported=MediaRecorder.isTypeSupported.bind(MediaRecorder);MediaRecorder.isTypeSupported=type=>type==="video/webm;codecs=vp8" && isTypeSupported(type);window.mediaTrace=[];const stop=MediaStreamTrack.prototype.stop;MediaStreamTrack.prototype.stop=function(){mediaTrace.push({kind:this.kind,stack:new Error().stack});return stop.call(this);}; document.addEventListener("visibilitychange",()=>mediaTrace.push({hidden:document.hidden}));const start=MediaRecorder.prototype.start;MediaRecorder.prototype.start=function(...args){this.addEventListener("error",e=>mediaTrace.push({recorderError:e.error?.message}));return start.apply(this,args);};'
  });
  await cmd('Page.addScriptToEvaluateOnNewDocument', {source: `
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.audio) throw new DOMException('No simulated microphone', 'NotFoundError');
      const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=480;
      const ctx=canvas.getContext('2d'); let frame=0;
      const draw=()=>{ctx.fillStyle='#253b41';ctx.fillRect(0,0,640,480);ctx.fillStyle='#d8ff64';ctx.fillRect((frame++*5)%600,170,40,140);};
      draw(); const timer=setInterval(draw,33), stream=canvas.captureStream(30);
      for (const track of stream.getTracks()) { const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();}; }
      return stream;
    };
  `});
  const origin = 'http://127.0.0.1:' + server.address().port;
  await cmd('Page.navigate', {url:origin});
  await wait('document.readyState === "complete"');
  await evaluate('import("./js/main.js").then(() => true)');
  await evaluate('document.querySelector("#startButton").click()');
  await wait('!document.querySelector("#shutterButton").disabled');
  for (const [width,height] of [[320,568],[375,667],[390,844],[430,932],[844,390]]) {
    await cmd('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:true});
    await new Promise(resolve => setTimeout(resolve, 100));
    const layout = await evaluate(`(() => {
      const r = id => { const b=document.querySelector(id).getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right}; };
      return {viewport:r('#viewport'),shutter:r('#shutterButton'),modes:r('.mode-tabs'),scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight};
    })()`);
    assert.ok(layout.viewport.height > 100, JSON.stringify(layout));
    assert.ok(layout.shutter.bottom <= height && layout.shutter.y >= 0, JSON.stringify(layout));
    assert.ok(layout.shutter.width >= 70, JSON.stringify(layout));
    assert.ok(layout.modes.right <= width && layout.scroll <= width, JSON.stringify(layout));
    const screenshot = await cmd('Page.captureScreenshot', {format:'png'});
    await writeFile(path.join(artifacts, `${width}x${height}.png`), Buffer.from(screenshot.data,'base64'));
    console.log('PASS layout', width, height);
  }
  await cmd('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate('document.querySelector(".app").getBoundingClientRect().width'), 500);
  console.log('PASS desktop layout');
  await cmd('Emulation.setDeviceMetricsOverride', {width:844,height:390,deviceScaleFactor:1,mobile:true});
  await evaluate('document.querySelector("#shutterButton").click()');
  await wait('document.querySelector("#reviewDialog").open');
  assert.ok(await evaluate('document.querySelector("#photoReview").naturalWidth > 0'));
  assert.ok(await evaluate('document.querySelector("#downloadButton").getBoundingClientRect().bottom <= innerHeight'));
  await evaluate('document.querySelector("#closeReview").click()');
  console.log('PASS JPEG review and save action');
  await evaluate('document.querySelector("#videoMode").click();document.querySelector("#shutterButton").click()');
  await wait('!document.querySelector("#recStatus").hidden');
  assert.ok(await evaluate('document.querySelector("#qualitySelect").disabled && document.querySelector("#libraryButton").disabled'));
  await new Promise(resolve => setTimeout(resolve, 1200));
  await evaluate('document.querySelector("#shutterButton").click()');
  await wait('document.querySelector("#reviewDialog").open');
  assert.ok(await evaluate('fetch(document.querySelector("#videoReview").src).then(r=>r.blob()).then(b=>b.size>0)'));
  await evaluate('document.querySelector("#closeReview").click()');
  console.log('PASS real MediaRecorder and recording locks');
  await evaluate('document.querySelector("#timelapseMode").click();document.querySelector("#shutterButton").click()');
  await wait('!document.querySelector("#recStatus").hidden');
  await new Promise(resolve => setTimeout(resolve, 600));
  await evaluate('document.querySelector("#shutterButton").click()');
  await wait('document.querySelector("#reviewDialog").open');
  assert.ok(await evaluate('fetch(document.querySelector("#videoReview").src).then(r=>r.blob()).then(b=>b.size>0)'));
  await evaluate('document.querySelector("#closeReview").click()');
  console.log('PASS real timelapse encoding');
  await evaluate('Object.defineProperty(document,"hidden",{value:true,configurable:true});document.dispatchEvent(new Event("visibilitychange"));');
  assert.ok(await evaluate('document.querySelector("#sourceVideo").srcObject === null && !document.querySelector("#emptyState").hidden'));
  await evaluate('Object.defineProperty(document,"hidden",{value:false,configurable:true});document.dispatchEvent(new Event("visibilitychange"));');
  assert.ok(await evaluate('document.querySelector("#shutterButton").disabled'));
  await evaluate('document.querySelector("#startButton").click()');
  await wait('!document.querySelector("#shutterButton").disabled');
  console.log('PASS hidden preview teardown and manual restart');
  await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`const original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(type,...args){ return type.includes('webgl') ? null : original.call(this,type,...args); };`});
  await cmd('Page.reload'); await wait('document.readyState === "complete"');
  await evaluate('import("./js/main.js").then(() => true)');
  await evaluate('document.querySelector("#startButton").click()');
  await wait('!document.querySelector("#shutterButton").disabled');
  await evaluate('document.querySelector("#shutterButton").click()');
  await wait('document.querySelector("#reviewDialog").open');
  assert.ok(await evaluate('document.querySelector("#photoReview").naturalWidth > 0'));
  console.log('PASS Canvas 2D fallback photo');
  assert.deepEqual(errors, []);
  console.log('Screenshots:', artifacts);
  await send('Browser.close');
} finally {
  socket?.close(); chrome.kill(); server.close();
}
