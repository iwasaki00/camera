// Test the actual production bundle in Edge, with native clocks, timers, RAF,
// MediaPipe and a browser-provided fake camera (no App/module/clock mocks).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'henface-countdown-'));
const browser = spawn(process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless', '--disable-gpu', '--no-first-run', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let socket;
const report = { url: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:4178/', cases: [] };
const expectedVersion = /APP_VERSION = "([^"]+)"/.exec(await readFile(new URL('../src/uiSettings.ts', import.meta.url), 'utf8'))[1];
try {
  let page;
  for (let i = 0; i < 100; i++) {
    try {
      const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(tab => tab.type === 'page');
      if (page) break;
    } catch { /* Starting the browser. */ }
    await delay(100);
  }
  assert(page, 'Browser debugging endpoint available');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), handler = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (handler) {
      pending.delete(message.id);
      message.error ? handler.reject(Error(message.error.message)) : handler.resolve(message.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const state = () => evaluate(`(() => {
    const main = document.querySelector('main'), label = document.querySelector('.game-countdown strong, .game-start-cue');
    const box = label?.getBoundingClientRect();
    return { phase: main?.dataset.gamePhase, label: label?.innerText ?? '', now: performance.now(),
      start: Number(main?.dataset.countdownStart), prop: main?.dataset.countdownLabel,
      visible: !!box?.width && !!box?.height && getComputedStyle(label).visibility !== 'hidden',
      text: document.body.innerText };
  })()`);
  const wait = async (predicate, timeout = 10000) => {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) { const current = await state(); if (predicate(current)) return current; await delay(30); }
    throw Error('DOM wait timed out: ' + JSON.stringify(await state()) + '\n' + errors.join('\n'));
  };
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.innerText === ${JSON.stringify(text)});
    if (!button || button.disabled) throw Error('Button unavailable: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Observe the rendered DOM. Do not replace any browser clock or scheduler.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.countdownChanges = [];
    let last = '';
    new MutationObserver(() => {
      const main = document.querySelector('main'), el = document.querySelector('.game-countdown strong, .game-start-cue');
      const phase = main?.dataset.gamePhase, label = el?.innerText ?? '', key = phase + ':' + label;
      if (main && key !== last) {
        const rect = el?.getBoundingClientRect(); last = key;
        window.countdownChanges.push({ phase, label, now: performance.now(),
          start: Number(main.dataset.countdownStart), prop: main.dataset.countdownLabel,
          visible: !!rect?.width && !!rect?.height });
      }
    }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  ` });
  const url = new URL(report.url); url.searchParams.set('debug', '1');
  await call('Page.navigate', { url: url.href }); await call('Page.bringToFront');
  await wait(s => s.text.includes('カオストップ！'));
  report.version = await evaluate(`document.querySelector('main')?.dataset.appVersion ?? [...document.querySelectorAll('small')].find(s => s.textContent.startsWith('バージョン '))?.textContent.replace('バージョン ', '')`);
  report.scripts = await evaluate(`[...document.scripts].map(s => s.src).filter(Boolean)`);
  report.serviceWorkers = await evaluate(`navigator.serviceWorker.getRegistrations().then(items => items.length)`);
  const start = async () => {
    await evaluate('window.countdownChanges = []');
    await click('ゲームスタート');
    const current = await wait(s => s.phase === 'countdown', 60000);
    assert.equal(current.label, '3'); assert(current.visible, 'Countdown visibly rendered');
  };
  const collect = async name => {
    await wait(s => s.phase === 'playing' && s.label === '', 7000);
    const changes = await evaluate('window.countdownChanges');
    report.cases.push({ name, changes });
    console.log(name + ': ' + changes.filter(s => s.label).map(s => `${s.label}@${Math.round(s.now - (Number.isFinite(s.start) ? s.start : changes[0].now))}ms`).join(' → '));
    return changes;
  };
  const checkSequence = changes => {
    const countdown = changes.filter(s => s.phase === 'countdown');
    assert.deepEqual(countdown.map(s => s.label), ['3', '2', '1']);
    for (const [i, item] of countdown.entries()) {
      assert(item.visible, item.label + ' visible'); assert.equal(item.prop, item.label, 'React prop agrees with DOM');
      const elapsed = item.now - item.start;
      assert(elapsed >= i * 1000 - 50 && elapsed < i * 1000 + 450, `Label ${item.label} at ${elapsed}ms`);
    }
    const begun = changes.find(s => s.phase === 'playing');
    assert.equal(begun.label, 'START!'); assert(begun.visible);
    assert(begun.now - begun.start >= 2950 && begun.now - begun.start < 3450, 'Playing begins at the 3s deadline');
  };
  await click([...await evaluate(`[...document.querySelectorAll('.game-entry-button')].map(b=>b.innerText)`)][0]);
  await start();
  const initial = await collect('初回開始');
  if (process.env.TEST_EXPECT_LEGACY === '1') {
    assert.deepEqual(initial.filter(s => s.phase === 'countdown').map(s => s.label), ['3']);
    console.log('REPRODUCED: published countdown remains 3 until playing.');
  } else {
    assert.equal(report.version, expectedVersion); checkSequence(initial);
    await evaluate('window.countdownChanges = []'); await click('リスタート');
    checkSequence(await collect('リスタート'));

    await evaluate('window.countdownChanges = []'); await click('リスタート');
    await wait(s => s.phase === 'countdown' && s.label === '2'); await click('一時停止');
    const paused = await wait(s => s.phase === 'paused');
    await delay(1250); assert.equal((await state()).label, '2'); assert.equal((await state()).phase, 'paused');
    await click('再開'); await wait(s => s.phase === 'countdown');
    const resumed = await collect('一時停止・再開');
    assert.deepEqual(resumed.filter(s => s.phase === 'countdown').map(s => s.label), ['3', '2', '2', '1']);
    assert(resumed.find(s => s.phase === 'playing').now - paused.start >= 4200, 'Pause duration excluded from game clock');

    // Leave during countdown, wait beyond the cancelled deadline, re-enter.
    await click('リスタート'); await wait(s => s.phase === 'countdown'); await delay(400);
    await click('通常へ戻る'); await delay(3300);
    assert.equal((await state()).phase, 'ready');
    assert(await evaluate(`document.querySelector('main').classList.contains('mode-camera')`));
    await click([...await evaluate(`[...document.querySelectorAll('.game-entry-button')].map(b=>b.innerText)`)][0]);
    await start(); checkSequence(await collect('画面を退出・再入場'));

    // Native tab visibility, not a mocked document.hidden getter.
    await click('リスタート'); await wait(s => s.phase === 'countdown' && s.label === '2');
    await call('Emulation.setFocusEmulationEnabled', { enabled: false });
    const other = await call('Target.createTarget', { url: 'about:blank' });
    await call('Target.activateTarget', { targetId: other.targetId }); await delay(1250);
    report.lifecycle = await state();
    await call('Page.bringToFront'); await call('Target.closeTarget', { targetId: other.targetId });
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Only claim this check if the browser delivered a hidden/paused transition.
    if (report.lifecycle.phase === 'paused') {
      assert.equal(report.lifecycle.label, '2');
      await click('再開'); await wait(s => s.phase === 'playing');
      console.log('PASS native lifecycle auto-pause/resume');
    } else console.log('INFO headless tab switch did not deliver visibilitychange; background Safari remains unverified.');

    // The normal user UI has the same countdown subscription as the debug HUD.
    await click('デバッグOFF');
    await evaluate('window.countdownChanges = []'); await click('リスタート');
    const normal = await collect('通常UI（デバッグOFF）');
    assert.deepEqual(normal.filter(s => s.phase === 'countdown').map(s => s.label), ['3', '2', '1']);
    assert(normal.filter(s => s.label).every(s => s.visible));
    assert.equal(normal.find(s => s.phase === 'playing').label, 'START!');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  if (process.env.TEST_REPORT) await writeFile(process.env.TEST_REPORT, JSON.stringify(report, null, 2));
  console.log('PASS actual production DOM / native time / 390×844; version=' + report.version);
} finally {
  socket?.close(); browser.kill(); await delay(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
