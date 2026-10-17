import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual App lifecycle functions with controllable browser promises.
// No camera, CDN or rendering algorithm is needed for these race tests.
const source = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'App');
const names = ['ensureLandmarker', 'stopCamera', 'startCamera', 'interruptCamera', 'pauseGame', 'resumeGame', 'takeScreenshot'];
const functions = app.body.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name.text))
  .map(n => n.getText(ast)).join('\n');
const code = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const gameSource = await fs.readFile(new URL('../src/game/blinkDropGame.ts', import.meta.url), 'utf8');
const gameJs = ts.transpileModule(gameSource, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const game = await import('data:text/javascript;base64,' + Buffer.from(gameJs).toString('base64'));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const makeStream = () => {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  return { track, getTracks: () => [track] };
};
function harness() {
  const state = {}, calls = { models: 0, media: 0, frames: 0, closed: 0, cache: 0 };
  const env = { document: { hidden: false }, navigator: { mediaDevices: { getUserMedia: async () => { calls.media++; return makeStream(); } } },
    window: { clearTimeout() {} }, performance, WASM_ROOT: 'wasm', FACE_MODEL_URL: 'model',
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: async () => { calls.models++; return { close() { calls.closed++; } }; } },
    requestAnimationFrame: () => ++calls.frames, cancelAnimationFrame() {}, renderLoop() {},
    getSourceCanvas() {}, clearChallengeGuide() {}, ...game,
    updateGame(next) { env.gameSessionRef.current = next; } };
  for (const name of new Set(functions.match(/\b\w+Ref\b/g))) env[name] = { current: null };
  Object.assign(env, {
    mountedRef: { current: true }, lifecycleRef: { current: 0 }, cameraRequestRef: { current: 0 },
    gameActionRef: { current: 0 }, cameraStartingRef: { current: false }, animationFrameRef: { current: 0 },
    appModeRef: { current: 'camera' }, gameSessionRef: { current: game.createBlinkDropSession() },
    videoRef: { current: { srcObject: null, pause() {}, play: async () => {} } },
    blinkTestRef: { current: {} }, smootherRef: { current: { reset() {} } }, metricsRef: { current: { reset() {} } },
    triggerManagerRef: { current: { reset() {}, requireNeutral() {} } },
    gameRendererRef: { current: { clearCache() { calls.cache++; } } }
  });
  for (const name of new Set(functions.match(/\bset[A-Z]\w+/g))) env[name] = value => { state[name] = value; };
  const api = new Function('env', `with (env) { ${code}; return { ${names.join(',')} }; }`)(env);
  return { env, api, calls, state };
}

{
  const h = harness(), model = deferred();
  h.env.FaceLandmarker.createFromOptions = () => { h.calls.models++; return model.promise; };
  const a = h.api.ensureLandmarker(), b = h.api.ensureLandmarker(); await tick();
  assert.equal(h.calls.models, 1);
  const instance = { close() {} }; model.resolve(instance);
  assert.equal(await a, instance); assert.equal(await b, instance);
  assert.equal(await h.api.ensureLandmarker(), instance); assert.equal(h.calls.models, 1);
}
{
  const h = harness(); h.env.FilesetResolver.forVisionTasks = async () => { throw Error('offline'); };
  assert.equal(await h.api.startCamera(), false); assert.equal(h.env.cameraStartingRef.current, false);
  assert.equal(h.env.landmarkerPromiseRef.current, null); assert.match(h.state.setError, /モデル/);
  h.env.FilesetResolver.forVisionTasks = async () => ({});
  assert.equal(await h.api.startCamera(), true);
}
{
  const h = harness(), model = deferred();
  h.env.FaceLandmarker.createFromOptions = () => model.promise;
  const pending = h.api.ensureLandmarker(); await tick();
  h.env.mountedRef.current = false; h.env.lifecycleRef.current++;
  model.resolve({ close() { h.calls.closed++; } });
  await assert.rejects(pending); assert.equal(h.calls.closed, 1); assert.equal(h.env.faceLandmarkerRef.current, null);
}
{
  const h = harness(), media = deferred();
  h.env.navigator.mediaDevices.getUserMedia = () => { h.calls.media++; return media.promise; };
  const first = h.api.startCamera(); await tick();
  assert.equal(await h.api.startCamera(), false); assert.equal(h.calls.media, 1);
  h.env.document.hidden = true; h.api.interruptCamera();
  const stale = makeStream(); media.resolve(stale); assert.equal(await first, false);
  assert(stale.track.stopped); assert.equal(h.env.streamRef.current, null); assert.equal(h.calls.frames, 0);
  h.env.document.hidden = false;
  assert.equal(h.calls.media, 1, 'returning to the page does not restart the camera');
  h.env.navigator.mediaDevices.getUserMedia = async () => makeStream();
  assert.equal(await h.api.startCamera(), true); assert.equal(h.calls.frames, 1);
  await h.api.startCamera(); assert.equal(h.calls.frames, 1);
  const active = h.env.streamRef.current; h.api.stopCamera();
  assert(active.track.stopped); assert.equal(h.env.videoRef.current.srcObject, null);
}
{
  const h = harness(), oldMedia = deferred(); let count = 0;
  const current = makeStream(), stale = makeStream();
  h.env.navigator.mediaDevices.getUserMedia = () => ++count === 1 ? oldMedia.promise : Promise.resolve(current);
  const old = h.api.startCamera(); await tick(); h.api.stopCamera();
  assert.equal(await h.api.startCamera(), true);
  oldMedia.resolve(stale); assert.equal(await old, false);
  assert(stale.track.stopped); assert.equal(h.env.streamRef.current, current); assert(!current.track.stopped);
}
{
  const h = harness(), play = deferred(); h.env.videoRef.current.play = () => play.promise;
  const start = h.api.startCamera(); await tick(); const stream = h.env.streamRef.current;
  h.api.interruptCamera(); play.resolve(); assert.equal(await start, false);
  assert(stream.track.stopped); assert.equal(h.calls.frames, 0);
}
for (const [name, pattern] of [['NotAllowedError', /許可/], ['NotReadableError', /他のアプリ/], ['NotFoundError', /見つかり/]]) {
  const h = harness(); h.env.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(Error('unavailable'), { name }); };
  assert.equal(await h.api.startCamera(), false); assert.match(h.state.setError, pattern);
  h.env.navigator.mediaDevices.getUserMedia = async () => makeStream(); assert.equal(await h.api.startCamera(), true);
}
{
  const h = harness(); h.env.videoRef.current.play = async () => { throw Error('play failed'); };
  assert.equal(await h.api.startCamera(), false); assert.equal(h.env.streamRef.current, null); assert.match(h.state.setError, /再生/);
  h.env.navigator.mediaDevices = undefined;
  assert.equal(await h.api.startCamera(), false); assert.match(h.state.setError, /HTTPS/);
}
{
  const h = harness(); h.env.appModeRef.current = 'blink-drop';
  const fixed = game.catchBlinkDropPart(game.beginBlinkDrop(game.startBlinkDropCountdown(0), 3000), 3300);
  h.env.gameSessionRef.current = fixed; h.api.interruptCamera();
  assert.equal(h.env.gameSessionRef.current.phase, 'paused');
  assert.deepEqual(h.env.gameSessionRef.current.fixedOffsets, fixed.fixedOffsets);
  await h.api.resumeGame(); assert.equal(h.env.gameSessionRef.current.phase, 'fixing');
  assert.deepEqual(h.env.gameSessionRef.current.fixedOffsets, fixed.fixedOffsets);
  const complete = { ...fixed, phase: 'completed' }; h.env.gameSessionRef.current = complete;
  const cache = h.calls.cache; h.api.interruptCamera();
  assert.equal(h.env.gameSessionRef.current, complete); assert.equal(h.calls.cache, cache);
}
for (const phase of ['countdown', 'playing', 'fixing']) {
  const h = harness(); h.env.appModeRef.current = 'blink-drop';
  let session = game.startBlinkDropCountdown(1000);
  if (phase !== 'countdown') session = game.beginBlinkDrop(session, 4000);
  if (phase === 'fixing') session = game.catchBlinkDropPart(session, 4200);
  let now = phase === 'countdown' ? 2400 : 4300;
  h.env.performance = { now: () => now }; h.env.gameSessionRef.current = session;
  h.api.interruptCamera(); const paused = h.env.gameSessionRef.current;
  now += 60000; h.api.interruptCamera();
  assert.equal(h.env.gameSessionRef.current, paused, 'repeated hide/pagehide keeps original pause time');
  await h.api.resumeGame(); const resumed = h.env.gameSessionRef.current;
  assert.equal(resumed.phase, phase);
  const clock = phase === 'countdown' ? 'countdownStartedAt' : phase === 'fixing' ? 'fixingStartedAt' : 'partStartedAt';
  assert.equal(resumed[clock], session[clock] + 60000, 'hidden elapsed time is excluded');
}
{
  const h = harness(), media = deferred(); h.env.appModeRef.current = 'blink-drop';
  h.env.gameSessionRef.current = game.pauseBlinkDrop(game.startBlinkDropCountdown(1000), 2400);
  h.env.navigator.mediaDevices.getUserMedia = () => media.promise;
  const resume = h.api.resumeGame(); await tick(); h.api.interruptCamera();
  const stale = makeStream(); media.resolve(stale); await resume;
  assert.equal(h.env.gameSessionRef.current.phase, 'paused'); assert(stale.track.stopped);
}
{
  const h = harness(); h.api.takeScreenshot(); assert.match(h.state.setError, /準備/);
  let clicked = 0, removed = 0;
  h.env.streamRef.current = makeStream(); h.env.frameReadyRef.current = true;
  h.env.canvasRef.current = { width: 720, height: 960, toDataURL(type) { assert.equal(type, 'image/png'); return 'data:image/png;base64,test'; } };
  h.env.document.createElement = () => ({ click() { clicked++; }, remove() { removed++; } });
  h.env.document.body = { appendChild() {} }; h.api.takeScreenshot();
  assert.equal(clicked, 1); assert.equal(removed, 1);
  h.env.canvasRef.current.toDataURL = () => { throw Error('encode failed'); };
  h.api.takeScreenshot(); assert.match(h.state.setError, /保存できません/);
}
console.log('PASS: model single-flight/retry/disposal, camera races/retry/play failure, interruption/resume, completed cache, PNG readiness/errors');
