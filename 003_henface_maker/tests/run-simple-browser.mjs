// Run against a local Vite server with an installed Chromium browser; no test dependency.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const profile = await mkdtemp(join(tmpdir(), 'henface-simple-'));
const browser = spawn(process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let page;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(tab => tab.type === 'page'); if (page) break;
    }
    catch { /* Browser is starting. */ }
    await delay(100);
  }
  if (!page) throw Error('Browser debugging endpoint unavailable');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), handler = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (handler) { pending.delete(message.id); message.error ? handler.reject(Error(message.error.message)) : handler.resolve(message.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Runtime.enable');
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  const testPath = process.env.TEST_PATH ?? '/tests/simple-layout.html';
  await call('Page.navigate', { url: (process.env.TEST_BASE_URL ?? 'http://127.0.0.1:4178') + testPath });
  await call('Page.bringToFront');
  let result;
  for (let attempt = 0; attempt < Number(process.env.TEST_WAIT_MS ?? 10000) / 100; attempt++) {
    const response = await call('Runtime.evaluate', { expression: '({ status: document.documentElement.dataset.result, text: document.querySelector("#results")?.textContent, width: innerWidth, height: innerHeight })', returnByValue: true });
    result = response.result.value;
    if (result?.status) break;
    await delay(100);
  }
  console.log(result?.text ?? 'No test output');
  if (process.env.TEST_EXPORT_DIR) {
    const images = await call('Runtime.evaluate', { expression: 'window.testImages', returnByValue: true });
    for (const [name, url] of Object.entries(images.result.value ?? {})) {
      if (/^[a-z]+$/.test(name) && url.startsWith('data:image/png;base64,'))
        await writeFile(join(process.env.TEST_EXPORT_DIR, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  if (process.env.TEST_SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.TEST_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  if (result?.status !== 'pass') {
    console.log(errors.join('\n'));
    const diagnostic = await call('Runtime.evaluate', { expression: 'document.querySelector("#app")?.textContent', returnByValue: true });
    console.log(diagnostic.result.value);
  }
  const requiresPhoneViewport = testPath === '/tests/simple-layout.html';
  if (result?.status !== 'pass' || (requiresPhoneViewport && (result.width !== 390 || result.height !== 844))) throw Error('Browser checks failed or viewport mismatch');
} finally {
  socket?.close(); browser.kill();
  await delay(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
