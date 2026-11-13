// Focused Chromium smoke check. No third-party test dependencies.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

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
  ...(process.argv.some(a=>['--recording','--screens','--short','--free','--free-performance','--custom','--custom-performance'].includes(a))?['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']:[]),
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
  let id = 0; const pending = new Map(); const errors = []; const startupErrors = []; const choosers = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error' && message.params.args[0]?.value === 'Portrait Face Parts Player startup failed:') startupErrors.push(message.params.args.map(a=>a.description||a.value).join(' '));
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
    throw new Error(`Timed out: ${expression}; state: ${state}; runtime errors: ${JSON.stringify([...errors,...startupErrors])}`);
  };
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${process.argv.includes('--layout')&&process.env.BASELINE_DIR?'baseline/index.html':''}` });
  if(process.argv.includes('--layout')) {
    await waitFor("document.body?.dataset.appState==='ready'");
    const measure=()=>evaluate(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top+scrollY,height:r.height,width:r.width};};return {width:innerWidth,height:innerHeight,pageHeight:document.documentElement.scrollHeight,photo:box('.stage'),camera:box('.camera-stage'),image:box('#image-trigger'),record:box('#record-start'),settings:document.querySelector('#settings-panel')?.open??null};})()`);
    const empty=await measure();
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').fillRect(0,0,400,600);const b=await new Promise(r=>c.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([b],'layout.png',{type:'image/png'}));const i=document.querySelector('#image-file');i.files=dt.files;i.dispatchEvent(new Event('change'));document.querySelector('#start').click();})()`);
    await waitFor("document.querySelector('#camera').readyState>=2&&!document.querySelector('#save').disabled");
    const loaded=await measure();
    const report={empty,loaded};console.log(JSON.stringify(report,null,2));
    if(process.env.LAYOUT_REPORT)await writeFile(process.env.LAYOUT_REPORT,JSON.stringify(report,null,2)+'\n');
  } else if(process.argv.includes('--custom')) {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});await command('Page.bringToFront');
    await waitFor("document.body?.dataset.appState==='ready'");
    const {checkCustomShape}=await import('./custom-shape-check.mjs');await checkCustomShape({evaluate,command,waitFor});assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--free-performance')||process.argv.includes('--custom-performance')) {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});await command('Page.bringToFront');
    const {compareFreePerformance}=await import('./free-performance.mjs');await compareFreePerformance({evaluate,command,waitFor,custom:process.argv.includes('--custom-performance')});assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--short')) {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});await command('Page.bringToFront');
    await waitFor("document.body?.dataset.appState==='ready'");
    const {checkShortVideo}=await import('./short-video-check.mjs');await checkShortVideo({evaluate,command,waitFor});assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--screens')) {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    await command('Page.bringToFront');
    await command('Page.setInterceptFileChooserDialog',{enabled:true});
    await waitFor("document.body?.dataset.appState==='ready'");
    const {checkFreeParts}=await import('./free-parts-check.mjs');await checkFreeParts({evaluate,command,waitFor});assert.deepEqual(errors,[]);assert.deepEqual(choosers,[]);
  } else if(process.env.PICKER_AUDIT==='1'||process.env.PICKER_ONLY==='1'||process.argv.includes('--picker')) {
    const {checkPicker}=await import('./picker-check.mjs');
    await checkPicker({evaluate,command,waitFor,choosers,profile,audit:process.env.PICKER_AUDIT==='1'});
    assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--recording')) {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:profile});
    await waitFor("document.body?.dataset.appState==='ready'");
    const {checkRecording}=await import('./recording-check.mjs');await checkRecording({evaluate,command,waitFor,profile});assert.deepEqual(errors,[]);
  } else if(process.argv.includes('--composite')) {
    await waitFor("document.body?.dataset.appState==='ready'");
    const {checkComposite}=await import('./composite-check.mjs');await checkComposite({evaluate,command,waitFor});assert.deepEqual(errors,[]);
  } else {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});await command('Page.bringToFront');
    await waitFor("document.body?.dataset.appState==='ready'");
    const {checkFreeParts}=await import('./free-parts-check.mjs');await checkFreeParts({evaluate,command,waitFor});assert.deepEqual(errors,[]);
  }
} finally {
  socket?.close(); browser.kill();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => (browser.exitCode !== null || browser.signalCode !== null) ? resolve() : browser.once('exit', resolve));
  assert.equal(path.dirname(path.resolve(profile)), path.resolve(tmpdir()));
  assert.ok(path.basename(profile).startsWith('portrait-browser-'));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
