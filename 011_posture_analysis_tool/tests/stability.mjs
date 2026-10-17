import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { CameraController } from "../assets/js/camera.js";
import { getRecords, saveRecord, deleteRecord } from "../assets/js/storage.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const stream = () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
};
class Video extends EventTarget {
  readyState = 2;
  currentTime = 1;
  srcObject = null;
  play = () => Promise.resolve();
  pause() {}
}
const requests = [];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  mediaDevices: { getUserMedia: () => { const d = deferred(); requests.push(d); return d.promise; } },
}});
const camera = new CameraController(new Video());
let first = camera.start();
assert.equal(camera.start(), first, "share duplicate camera start");
camera.stop();
const second = camera.start("user");
const staleStream = stream();
requests[0].resolve(staleStream);
await assert.rejects(first, { name: "AbortError" });
assert.equal(staleStream.track.stopped, true);
const latestStream = stream();
requests[1].resolve(latestStream);
await second;
assert.equal(camera.stream, latestStream);
assert.equal(latestStream.track.stopped, false);
camera.stop();
assert.equal(latestStream.track.stopped, true);

camera.video.play = () => Promise.reject(new Error("play failed"));
first = camera.start();
const failedStream = stream();
requests.at(-1).resolve(failedStream);
await assert.rejects(first, /play failed/);
assert.equal(failedStream.track.stopped, true);
assert.equal(camera.stream, null);

const playing = deferred();
camera.video.play = () => playing.promise;
first = camera.start();
const earlyStream = stream();
requests.at(-1).resolve(earlyStream);
await flush();
camera.video.dispatchEvent(new Event("loadeddata"));
playing.reject(new Error("late play failure"));
await assert.rejects(first, /late play failure/);
assert.equal(earlyStream.track.stopped, true);

camera.video.readyState = 0;
camera.video.play = () => Promise.resolve();
first = camera.start();
const waitingStream = stream();
requests.at(-1).resolve(waitingStream);
await flush();
camera.stop();
await assert.rejects(first, { name: "AbortError" });
assert.equal(waitingStream.track.stopped, true);
first = camera.start();
const errorStream = stream();
requests.at(-1).resolve(errorStream);
await flush();
camera.video.dispatchEvent(new Event("error"));
await assert.rejects(first, /読み込めません/);
assert.equal(errorStream.track.stopped, true);
camera.video.readyState = 2;
first = camera.start();
requests.at(-1).resolve(stream());
await first;
camera.stop();
console.log("PASS camera: duplicate, stale stream, play failures, readiness abort/error, retry");

let models = [], creates = 0, fail = false, failGpu = false, options = [];
let createGate = null;
const context = vm.createContext({ DOMException });
const vision = {
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: { createFromOptions: async (_, opts) => {
    creates++;
    options.push(structuredClone(opts));
    if (fail || (failGpu && opts.baseOptions.delegate === "GPU")) throw new Error("model failed");
    if (createGate) await createGate.promise;
    const model = {
      closed: false, imageCalls: 0, videoCalls: 0, gate: null,
      async setOptions(opts) { if (this.gate) await this.gate.promise; this.mode = opts.runningMode; },
      detect() { this.imageCalls++; return { landmarks: [[{ x: 1 }]] }; },
      detectForVideo() { this.videoCalls++; return { landmarks: [[{ x: 2 }]] }; },
      close() { this.closed = true; },
    };
    models.push(model);
    return model;
  }},
};
const remote = new vm.SyntheticModule(["default"], function () { this.setExport("default", vision); }, { context });
const config = new vm.SyntheticModule(["MODEL_URL", "POSE_VERSION", "WASM_ROOT"], function () {
  for (const key of ["MODEL_URL", "POSE_VERSION", "WASM_ROOT"]) this.setExport(key, "test");
}, { context });
await remote.link(() => {}); await remote.evaluate();
const poseModule = new vm.SourceTextModule(await readFile(new URL("../assets/js/pose.js", import.meta.url), "utf8"), {
  context, importModuleDynamically: () => remote,
});
await poseModule.link(() => config); await poseModule.evaluate();
const PoseDetector = poseModule.namespace.PoseDetector;
const detector = new PoseDetector();
createGate = deferred();
first = detector.init();
assert.equal(detector.init(), first);
await flush();
assert.equal(creates, 1);
createGate.resolve(); await first; createGate = null;
await detector.init(); assert.equal(creates, 1);
let model = models.at(-1);
model.gate = deferred();
const imageTask = detector.detectImage({});
await flush();
assert.equal(detector.detect({ readyState: 2, currentTime: 1 }, 1), null);
const videoTask = detector.prepareVideo();
model.gate.resolve();
await imageTask; await videoTask; await flush();
assert.equal(model.imageCalls, 1);
await detector.detectImage({}, () => false);
assert.equal(model.imageCalls, 1, "cancelled image request never infers");
assert.equal(detector.runningMode, "VIDEO");
assert.equal(detector.detect({ readyState: 2, currentTime: 1 }, 2)[0].x, 2);
assert.equal(detector.detect({ readyState: 2, currentTime: 1 }, 3), null);
detector.resetVideo();
assert.ok(detector.detect({ readyState: 2, currentTime: 1 }, 4));
detector.close(); await detector.queue;
assert.equal(model.closed, true);
fail = true;
await assert.rejects(detector.init(), /model failed/);
fail = false; failGpu = true;
await detector.init();
assert.equal(options.at(-1).baseOptions.delegate, "CPU");
assert.equal(options.at(-1).numPoses, 1);
assert.equal(options.at(-1).minTrackingConfidence, .48);
createGate = deferred();
detector.close(); await detector.queue;
first = detector.init();
await flush();
detector.close();
createGate.resolve();
await assert.rejects(first, { name: "AbortError" });
assert.equal(models.at(-1).closed, true);
createGate = null;
console.log("PASS model: shared init, reuse, VIDEO/IMAGE serialization, lastTime reset, close, retry, CPU fallback");

let stored = null, storageFail = false;
globalThis.localStorage = {
  getItem: () => stored,
  setItem: (_, value) => { if (storageFail) throw new Error("quota"); stored = value; },
};
for (let i = 0; i < 42; i++) assert.ok(saveRecord({ id: String(i) }));
assert.equal(getRecords().length, 40);
const before = stored;
storageFail = true;
assert.equal(deleteRecord("41"), null);
assert.equal(stored, before);
assert.equal(saveRecord({ id: "fail" }), null);
storageFail = false;
assert.equal(deleteRecord("41").length, 39);
console.log("PASS storage: 40 record cap, save/delete failure consistency");

const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
class Element {
  constructor() { this.disabled = false; this.hidden = false; this.open = false; this.listeners = {}; this.dataset = {}; this.textContent = ""; this.src = ""; }
  classList = { add() {}, remove() {}, toggle() {} };
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  removeAttribute() { this.src = ""; }
  replaceChildren() { this.textContent = ""; }
  decode() { return Promise.resolve(); }
}
const elements = new Map();
const el = (key) => { if (!elements.has(key)) elements.set(key, new Element()); return elements.get(key); };
const modes = ["front", "left", "right"].map((mode) => { const e = new Element(); e.dataset.mode = mode; return e; });
const doc = new Element();
doc.hidden = false;
doc.querySelector = el;
doc.querySelectorAll = (selector) => selector === "[data-mode]" ? modes : selector === "[data-compare]:checked" ? selected : [];
let selected = [];
const win = new Element();
let liveCamera, livePose, draws = [], saves = 0, deleteFail = false, historyRenders = 0;
class MainCamera {
  constructor() { liveCamera = this; this.facing = "environment"; this.stream = null; this.calls = []; }
  start(facing) { this.facing = facing; const d = deferred(); this.calls.push(d); return d.promise; }
  stop() { this.stream = null; }
}
class MainPose {
  constructor() { livePose = this; this.imageCalls = []; this.output = points; }
  init() { return Promise.resolve(); }
  prepareVideo() { return Promise.resolve(); }
  resetVideo() {}
  detect() { return this.output; }
  detectImage(image) { const d = deferred(); this.imageCalls.push({ image, ...d }); return d.promise; }
  close() {}
}
const images = [], urls = new Set(), raf = new Map(); let nextRaf = 0;
const scope = {
  document: doc, window: win, performance: { now: () => 0 }, location: { protocol: "https:" },
  CameraController: MainCamera, PoseDetector: MainPose,
  Renderer: class { constructor() { this.flags = {}; } draw(p) { draws.push(p); } setSource(source) { this.source = source; } },
  SAMPLE_COUNT: 8, VISIBILITY: .5, MODE_LABELS: { front: "正面", left: "左側面", right: "右側面" },
  averageFrames: (frames) => { assert.equal(frames.length, 8); return frames[0]; },
  analyzePose: (_, mode) => ({ mode, score: 90, comment: "", items: [] }),
  renderResult() {}, renderHistory() { historyRenders++; }, renderCompare() {},
  getRecords: () => [{ id: "a" }, { id: "b" }],
  deleteRecord: () => deleteFail ? null : [],
  saveRecord: () => { saves++; return []; },
  Image: class { constructor() { this.d = deferred(); images.push(this); } decode() { return this.d.promise; } },
  URL: { createObjectURL() { const url = "blob:" + images.length; urls.add(url); return url; }, revokeObjectURL(url) { urls.delete(url); } },
  requestAnimationFrame(fn) { raf.set(++nextRaf, fn); return nextRaf; },
  cancelAnimationFrame(id) { raf.delete(id); },
};
let main = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
main = main.replace(/^import .*;\r?\n/gm, "");
main += "\nglobalThis.app = { start, loadImage, analyze, suspend, reset, state: () => ({ running, landmarks, frames, current, fileMode, imageLoading }) };";
vm.runInNewContext(main, scope);
const app = scope.app;
const tick = () => { const batch = [...raf.values()]; raf.clear(); batch.forEach((fn) => fn(100)); };
first = app.start();
await app.start();
assert.equal(liveCamera.calls.length, 1);
liveCamera.calls[0].resolve(); await first;
assert.equal(raf.size, 1);
for (let i = 0; i < 7; i++) tick();
assert.equal(el("#analyzeButton").disabled, true);
tick();
assert.equal(app.state().frames.length, 8);
app.analyze();
assert.equal(app.state().current.mode, "front");
el("#saveButton").emit("click"); el("#saveButton").emit("click");
assert.equal(saves, 1);
const oldCallback = [...raf.values()][0];
first = app.start("user");
assert.equal(raf.size, 0);
assert.equal(app.state().landmarks.length, 0);
oldCallback(200);
assert.equal(raf.size, 0);
liveCamera.calls.at(-1).resolve(); await first;
assert.equal(raf.size, 1);
livePose.output = [];
tick();
app.analyze();
assert.equal(app.state().current, null);
livePose.output = points;

const file = { type: "image/jpeg", size: 100 };
const photoA = app.loadImage(file);
assert.equal(raf.size, 0);
assert.equal(app.state().frames.length, 0);
assert.equal(el("#analyzeButton").disabled, true);
const photoB = app.loadImage(file);
images[1].d.resolve(); await flush();
assert.equal(livePose.imageCalls.length, 1);
livePose.imageCalls[0].resolve(points); await photoB;
const latestSrc = el("#uploadedImage").src;
images[0].d.resolve(); await photoA;
assert.equal(el("#uploadedImage").src, latestSrc);
assert.equal(urls.size, 0);
assert.equal(app.state().current.mode, "front");
assert.equal(app.state().fileMode, true);
assert.equal(el("#statusPill").textContent.includes("起動中"), false);

const photoC = app.loadImage(file);
images[2].d.resolve(); await flush();
modes[1].emit("click");
livePose.imageCalls.at(-1).resolve(points);
await photoC;
assert.equal(app.state().current, null, "direction changes invalidate automatic result");
app.analyze();
assert.equal(app.state().current.mode, "left");

doc.hidden = true;
doc.emit("visibilitychange");
const retainedImage = app.state().landmarks;
doc.hidden = false;
doc.emit("visibilitychange");
assert.equal(app.state().fileMode, true);
assert.equal(app.state().landmarks, retainedImage, "completed image remains available after backgrounding");

const photoD = app.loadImage(file);
images[3].d.resolve(); await flush();
first = app.start();
livePose.imageCalls.at(-1).resolve(points); await photoD;
assert.equal(app.state().current, null, "old image inference cannot overwrite new camera");
liveCamera.calls.at(-1).reject(new Error("denied")); await first;
assert.equal(el("#startCamera").disabled, false);
assert.equal(el("#emptyState").classList !== null, true);
assert.equal(app.state().running, false);

first = app.start();
doc.hidden = true;
doc.emit("visibilitychange");
liveCamera.calls.at(-1).resolve(); await first;
assert.equal(app.state().running, false);
assert.equal(raf.size, 0);
const count = liveCamera.calls.length;
doc.hidden = false; doc.emit("visibilitychange");
assert.equal(liveCamera.calls.length, count, "no auto restart on visibility restoration");
first = app.start();
liveCamera.calls.at(-1).resolve(); await first;
for (let i = 0; i < 8; i++) tick();
app.analyze();
const result = app.state().current;
doc.hidden = true; doc.emit("visibilitychange");
assert.equal(app.state().current, result, "background preserves analysed result");
assert.equal(app.state().frames.length, 0);
doc.hidden = false;

deleteFail = true;
const priorHistoryRenders = historyRenders;
const deleteEvent = { preventDefault() {}, target: { closest: () => ({ dataset: { delete: "a" } }) } };
el("#historyList").emit("click", deleteEvent);
assert.equal(historyRenders, priorHistoryRenders);
assert.match(el("#historyMessage").textContent, /削除できません/);
deleteFail = false;
el("#comparePanel").hidden = false;
el("#historyList").emit("click", deleteEvent);
assert.equal(el("#comparePanel").hidden, true);
assert.equal(historyRenders, priorHistoryRenders + 1);
selected = [{ dataset: { compare: "a" } }, { dataset: { compare: "b" } }];
el("#historyList").emit("change", {});
assert.equal(el("#comparePanel").hidden, false);
console.log("PASS main: one RAF, stale callbacks, 8 frames, image races, direction snapshot, restart failure, visibility, duplicate save, delete/compare");
