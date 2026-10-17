// Run with: node --test tests/lifecycle.test.mjs (no build or dependencies).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8")
  .replace(/await import\("https:[^"]+"\)/, "await visionModule");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function media() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } },
    { stopped: false, stop() { this.stopped = true; } }];
  return { tracks, getTracks: () => tracks };
}
function setup() {
  const elements = new Map(), events = {}, raf = new Map();
  let nextFrame = 0;
  const ctx = new Proxy({}, { get: (o, k) => o[k] || (() => {}) });
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", style: {}, disabled: false, hidden: false,
      value: id === "#lengthRange" ? "52" : "55",
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { this[name] = fn; }, setAttribute() {},
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 390, height: 844 }),
      srcObject: null, readyState: 2, currentTime: 0,
      videoWidth: 1280, videoHeight: 720,
      pause() { this.paused = true; }, play: async () => {}
    });
    return elements.get(id);
  };
  const doc = { hidden: false, querySelector: element, querySelectorAll: () => [],
    addEventListener: (name, fn) => { events[name] = fn; } };
  const models = [], options = [];
  const state = { cameraCalls: 0, creates: 0, detects: 0 };
  const sandbox = {
    document: doc, console: { warn() {}, error() {} }, performance: { now: () => 100 },
    navigator: { mediaDevices: { getUserMedia: async () => { state.cameraCalls++; return media(); } } },
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async (_, config) => {
      state.creates++; options.push(config);
      const model = { closed: false, close() { this.closed = true; },
        detectForVideo() { state.detects++; return { landmarks: [] }; } };
      models.push(model); return model;
    } },
    requestAnimationFrame: (fn) => { const id = ++nextFrame; raf.set(id, fn); return id; },
    cancelAnimationFrame: (id) => raf.delete(id),
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
    setTimeout, clearTimeout, addEventListener: (name, fn) => { events[name] = fn; }
  };
  sandbox.window = sandbox;
  sandbox.visionModule = { FilesetResolver: sandbox.FilesetResolver, HandLandmarker: sandbox.HandLandmarker };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  const run = (code) => vm.runInContext(code, context);
  return { sandbox, run, element, doc, events, raf, models, options, state };
}

test("start/stop/restart, OFF and duplicate start preserve a single loop/model", async () => {
  const h = setup();
  const first = h.run("startCamera()");
  await h.run("startCamera()");
  await first;
  assert.equal(h.state.cameraCalls, 1);
  assert.equal(h.raf.size, 1);
  const stream = h.element("#camera").srcObject;
  h.run("turnOffSaber()");
  assert.equal(stream.tracks[0].stopped, false);
  assert.equal(h.run("isRunning"), true);
  h.run('lastVideoTime = 12; previousPose = {}; smoothedPose = {}; stopCamera(); stopCamera()');
  assert.ok(stream.tracks.every((t) => t.stopped));
  assert.equal(h.raf.size, 0);
  assert.equal(h.element("#camera").srcObject, null);
  assert.equal(h.run("previousPose === null && smoothedPose === null && lastVideoTime === -1 && saberState === 'off'"), true);
  await h.run("startCamera()");
  assert.equal(h.state.creates, 1);
  assert.equal(h.raf.size, 1);
  assert.equal(h.run("isRunning"), true);
  assert.equal(h.element("#audioStatus").textContent.includes("音声"), true);
});

test("late getUserMedia cannot replace a newer running stream", async () => {
  const h = setup(), pending = deferred();
  h.sandbox.navigator.mediaDevices.getUserMedia = () => pending.promise;
  const old = h.run("startCamera()"); await flush();
  h.run("stopCamera()");
  const current = media();
  h.sandbox.navigator.mediaDevices.getUserMedia = async () => current;
  await h.run("startCamera()");
  const obsolete = media(); pending.resolve(obsolete); await old;
  assert.ok(obsolete.tracks.every((t) => t.stopped));
  assert.equal(h.element("#camera").srcObject, current);
  assert.equal(h.raf.size, 1);
});

test("play failure releases stream and permits retry", async () => {
  const h = setup(), acquired = media();
  h.sandbox.navigator.mediaDevices.getUserMedia = async () => acquired;
  h.element("#camera").play = async () => { throw new Error("play failed"); };
  await h.run("startCamera()");
  assert.ok(acquired.tracks.every((t) => t.stopped));
  assert.equal(h.element("#camera").srcObject, null);
  assert.equal(h.run("cameraState"), "error");
  assert.equal(h.raf.size, 0);
  h.element("#camera").play = async () => {};
  await h.run("startCamera()");
  assert.equal(h.run("cameraState"), "running");
});

for (const rejectPlay of [false, true]) {
  test(`stop/restart while play pending ignores stale ${rejectPlay ? "rejection" : "success"}`, async () => {
    const h = setup(), pending = deferred();
    h.element("#camera").play = () => pending.promise;
    const old = h.run("startCamera()"); await flush();
    const obsolete = h.element("#camera").srcObject;
    h.run("stopCamera()");
    h.element("#camera").play = async () => {};
    await h.run("startCamera()");
    const current = h.element("#camera").srcObject;
    rejectPlay ? pending.reject(new Error("interrupted")) : pending.resolve();
    await old;
    assert.ok(obsolete.tracks.every((t) => t.stopped));
    assert.equal(h.element("#camera").srcObject, current);
    assert.equal(h.run("cameraState"), "running");
    assert.equal(h.raf.size, 1);
  });
}

test("model initialization shares promise, falls back to CPU and retains thresholds", async () => {
  const h = setup();
  const create = h.sandbox.HandLandmarker.createFromOptions;
  const delegates = [];
  h.sandbox.HandLandmarker.createFromOptions = async (v, options) => {
    delegates.push(options.baseOptions.delegate);
    assert.equal(options.numHands, 2);
    assert.equal(options.minHandDetectionConfidence, 0.55);
    assert.equal(options.minHandPresenceConfidence, 0.55);
    assert.equal(options.minTrackingConfidence, 0.5);
    if (options.baseOptions.delegate === "GPU") throw new Error("GPU failure");
    return create(v, options);
  };
  assert.equal(h.run("loadHandLandmarker() === loadHandLandmarker()"), true);
  await h.run("loadHandLandmarker()");
  assert.deepEqual(delegates, ["GPU", "CPU"]);
  await h.run("startCamera()");
  assert.equal(h.state.creates, 1);
});

test("both model delegates failing permits retry without camera allocation", async () => {
  const h = setup(), create = h.sandbox.HandLandmarker.createFromOptions;
  h.sandbox.HandLandmarker.createFromOptions = async () => { throw new Error("model failed"); };
  await h.run("startCamera()");
  assert.equal(h.run("cameraState"), "error");
  assert.equal(h.state.cameraCalls, 0);
  assert.equal(h.run("modelPromise"), null);
  h.sandbox.HandLandmarker.createFromOptions = create;
  await h.run("startCamera()");
  assert.equal(h.run("isRunning"), true);
});

test("visibility stops tracks and loop; returning requires user restart", async () => {
  const h = setup(); await h.run("startCamera()");
  const stream = h.element("#camera").srcObject;
  h.doc.hidden = true; h.events.visibilitychange();
  assert.ok(stream.tracks.every((t) => t.stopped));
  assert.equal(h.raf.size, 0);
  h.doc.hidden = false; h.events.visibilitychange();
  assert.equal(h.run("isRunning"), false);
  await h.run("startCamera()");
  assert.equal(h.run("isRunning"), true);
  h.events.pagehide();
  assert.equal(h.models[0].closed, true);
  assert.equal(h.raf.size, 0);
});

test("pagehide closes a late model and serializes restart initialization", async () => {
  const h = setup(), pending = deferred();
  const create = h.sandbox.HandLandmarker.createFromOptions;
  h.sandbox.HandLandmarker.createFromOptions = () => pending.promise;
  const old = h.run("startCamera()"); await flush();
  h.events.pagehide();
  h.sandbox.HandLandmarker.createFromOptions = create;
  const restart = h.run("startCamera()"); await flush();
  assert.equal(h.state.creates, 0);
  const obsolete = { closed: false, close() { this.closed = true; } };
  pending.resolve(obsolete);
  await Promise.all([old, restart]);
  assert.equal(obsolete.closed, true);
  assert.equal(h.state.creates, 1);
  assert.equal(h.run("isRunning"), true);
});

for (const name of ["NotAllowedError", "NotReadableError", "api"]) {
  test(`camera failure: ${name}`, async () => {
    const h = setup();
    if (name === "api") h.sandbox.navigator.mediaDevices = undefined;
    else h.sandbox.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error(), { name }); };
    await h.run("startCamera()");
    assert.equal(h.run("cameraState"), "error");
    assert.equal(h.element("#startButton").disabled, false);
    assert.equal(h.raf.size, 0);
    assert.equal(h.element("#camera").srcObject, null);
    assert.ok(h.element("#cameraStateText").textContent.length > 10);
  });
}

test("cover coordinates follow mirrored crop and activation stays at 180ms", () => {
  const h = setup();
  assert.equal(h.run("ACTIVATION_HOLD_MS"), 180);
  const center = h.run("toScreenPoint({x: 0.5, y: 0.5})");
  assert.equal(center.x, 195); assert.equal(center.y, 422);
  h.run("updateState({bothFists:true,handsClose:true,center:{x:100,y:100},direction:{x:0,y:-1}}, 100)");
  h.run("updateState({bothFists:true,handsClose:true,center:{x:100,y:100},direction:{x:0,y:-1}}, 279)");
  assert.equal(h.run("saberState"), "off");
  h.run("updateState({bothFists:true,handsClose:true,center:{x:100,y:100},direction:{x:0,y:-1}}, 281)");
  assert.equal(h.run("saberState"), "igniting");
});

test("module/WASM load failure is recoverable", async () => {
  const moduleFailure = setup();
  const module = moduleFailure.sandbox.visionModule;
  moduleFailure.sandbox.visionModule = Promise.reject(new Error("CDN unavailable"));
  await moduleFailure.run("startCamera()");
  assert.equal(moduleFailure.run("cameraState"), "error");
  assert.equal(moduleFailure.state.cameraCalls, 0);
  moduleFailure.sandbox.visionModule = module;
  await moduleFailure.run("startCamera()");
  assert.equal(moduleFailure.run("isRunning"), true);

  const h = setup(), original = h.sandbox.FilesetResolver.forVisionTasks;
  h.sandbox.FilesetResolver.forVisionTasks = async () => { throw new Error("WASM unavailable"); };
  await h.run("startCamera()");
  assert.equal(h.run("cameraState"), "error");
  assert.equal(h.state.cameraCalls, 0);
  h.sandbox.FilesetResolver.forVisionTasks = original;
  await h.run("startCamera()");
  assert.equal(h.run("isRunning"), true);
});

test("pagehide during resolver prevents obsolete model creation", async () => {
  const h = setup(), pending = deferred();
  h.sandbox.FilesetResolver.forVisionTasks = () => pending.promise;
  const old = h.run("startCamera()"); await flush();
  h.events.pagehide(); pending.resolve({}); await old;
  assert.equal(h.state.creates, 0);
  assert.equal(h.state.cameraCalls, 0);
  assert.equal(h.run("cameraState"), "stopped");
});

test("audio nodes disconnect naturally and camera stop silences active voices", async () => {
  const h = setup(), nodes = [];
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
  const node = () => {
    const n = { frequency: param, gain: param, Q: param, stopped: false, disconnected: false,
      connect(other) { return other; }, start() {}, stop() { this.stopped = true; },
      disconnect() { this.disconnected = true; } };
    nodes.push(n); return n;
  };
  h.sandbox.AudioContext = class {
    state = "running"; currentTime = 0; destination = {};
    createOscillator = node; createGain = node; createBiquadFilter = node;
  };
  await h.run("startCamera()");
  h.run("playIgnitionSound()");
  assert.equal(h.run("audioVoices.size"), 1);
  nodes[0].onended();
  assert.equal(h.run("audioVoices.size"), 0);
  assert.ok(nodes.slice(0, 3).every(n => n.disconnected));
  h.run("playSwingSound(); stopCamera()");
  assert.equal(h.run("audioVoices.size"), 0);
  assert.ok(nodes.every(n => n.disconnected));
  assert.equal(nodes[3].stopped, true);
});

test("audio constructor/resume failure does not block camera", async () => {
  for (const failure of ["constructor", "resume"]) {
    const h = setup();
    h.sandbox.AudioContext = class {
      constructor() { if (failure === "constructor") throw new Error("unavailable"); }
      state = "suspended";
      resume() { return Promise.reject(new Error("unavailable")); }
    };
    await h.run("startCamera()"); await flush();
    assert.equal(h.run("isRunning"), true);
    assert.ok(h.element("#audioStatus").textContent.includes("音声"));
  }
});
