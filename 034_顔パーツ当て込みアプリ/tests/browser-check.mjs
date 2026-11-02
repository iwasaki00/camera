// Focused Chromium smoke check. No third-party test dependencies.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(root)) { res.writeHead(403).end(); return; }
    const content = await readFile(target);
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(target)] || 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'portrait-browser-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
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
  let id = 0; const pending = new Map(); const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP timed out: ' + method)), 12000);
    pending.set(++id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => call(method, params, sessionId);
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Browser.setDownloadBehavior', { behavior: 'deny' }); // The generated blob is checked instead of writing a download.
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`Timed out: ${expression}`);
  };
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await waitFor("!!document.querySelector('#part-x')");
  assert.deepEqual(await evaluate("[document.querySelector('#save').disabled, !document.querySelector('#empty-hint').hidden, document.documentElement.scrollWidth <= innerWidth]"), [true, true, true]);
  console.log('PASS: empty state and 390px mobile layout');
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
  await evaluate("document.querySelector('#start').click()");
  await waitFor("document.querySelector('#camera-state').textContent === '使用中' && document.querySelector('#camera').readyState >= 2");
  await new Promise(r => setTimeout(r, 200));
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
  console.log('PASS: image decode/draw, fake camera start, adjustment controls and mirror');
  await evaluate("document.querySelector('#save').click()");
  await waitFor("!document.querySelector('#export-result').hidden");
  assert.equal(await evaluate("(async()=>{const r=await fetch(document.querySelector('#export-image').src);const b=await r.blob();const a=new Uint8Array(await b.arrayBuffer());return b.type==='image/png' && a[0]===137 && a[1]===80;})()"), true);
  await evaluate("window.testStream=document.querySelector('#camera').srcObject; document.querySelector('#stop').click()");
  assert.deepEqual(await evaluate("[window.testStream.getTracks().every(t=>t.readyState==='ended'),document.querySelector('#camera').srcObject,document.querySelector('#start').disabled]"), [true,null,false]);
  await evaluate("document.querySelector('#save').click()");
  await waitFor("!document.querySelector('#save').disabled");
  assert.equal(await evaluate(`(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=4)if(p[i]!==160||p[i+1]!==64||p[i+2]!==48||p[i+3]!==255)return false;return true;})()`), true);
  assert.deepEqual(errors, []);
  console.log('PASS: PNG signature, guide excluded from PNG, camera tracks stopped, no runtime errors');
  await evaluate(`navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; document.querySelector('#start').click()`);
  await waitFor("document.querySelector('#status').dataset.error === 'true'");
  assert.deepEqual(await evaluate("[document.querySelector('#start').disabled,document.querySelector('#stop').disabled,document.querySelector('#camera').srcObject,document.querySelector('#status').textContent.includes('許可')]"), [false,true,null,true]);
  console.log('PASS: camera permission denial is shown and controls recover');
} finally {
  socket?.close(); browser.kill();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => (browser.exitCode !== null || browser.signalCode !== null) ? resolve() : browser.once('exit', resolve));
  assert.equal(path.dirname(path.resolve(profile)), path.resolve(tmpdir()));
  assert.ok(path.basename(profile).startsWith('portrait-browser-'));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
