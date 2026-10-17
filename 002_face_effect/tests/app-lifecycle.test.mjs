import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the actual component logic with deterministic React/browser boundaries.
// No camera, model download, or test-only production exports are needed.
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const logic = source.slice(0, source.indexOf('  return (\n    <main'))
  .replace(/^import .*;\r?\n/gm, "")
  .replace("export default function App", "function App") + `
  return {
    startCamera, stopCamera, ensureLandmarker, takeScreenshot, releaseSavedImage,
    videoRef, canvasRef, frameRef, effectRef, settingsRef, streamRef,
    faceLandmarkerRef, modelPromiseRef, cameraGenerationRef, uiRef,
    state: { cameraActive, cameraStarting, frameReady, saving, captureError, savedImage }
  };
}
globalThis.App = App;`;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function mediaStream() {
  const tracks = [{ stopped: 0, stop() { this.stopped++; } }, { stopped: 0, stop() { this.stopped++; } }];
  return { tracks, getTracks: () => tracks };
}

function harness() {
  const slots = [], effects = [], cleanups = new Map();
  let cursor = 0, id = 0, creates = 0, acquisitions = 0, draws = 0, detections = 0;
  const raf = new Map(), timers = new Map(), events = new Map(), revoked = [], downloads = [];
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => {
    if (key === "drawImage") draws++;
  }) });
  const video = { readyState: 2, videoWidth: 720, videoHeight: 960, currentTime: 1,
    srcObject: null, play: async () => {}, pause() {} };
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    toBlob: (callback, type) => callback(new Blob(["png"], { type })) };
  const model = { closed: 0, close() { this.closed++; }, detectForVideo() {
    detections++;
    return { faceLandmarks: [] };
  } };
  let create = async () => model;
  let acquire = async () => mediaStream();
  const addEventListener = (name, callback) => events.set(name, callback);
  const removeEventListener = (name) => events.delete(name);
  const document = { hidden: false, addEventListener, removeEventListener,
    body: { appendChild() {} }, createElement: (tag) => tag === "canvas" ? canvas : {
      click() { downloads.push({ href: this.href, download: this.download }); }, remove() {}
    } };
  const window = { isSecureContext: true, addEventListener, removeEventListener,
    requestAnimationFrame: (fn) => { raf.set(++id, fn); return id; },
    cancelAnimationFrame: (key) => raf.delete(key),
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearTimeout: (key) => timers.delete(key) };
  const context = vm.createContext({
    useRef: (value) => {
      const index = cursor++;
      return slots[index] ??= { current: value };
    },
    useState: (value) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], (next) => { slots[index] = next; }];
    },
    useEffect: (fn, deps) => {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, n) => dep !== slots[index][n])) {
        slots[index] = deps;
        effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, fn()); });
      }
    },
    FaceLandmarker: { createFromOptions: (...args) => { creates++; return create(...args); } },
    FilesetResolver: { forVisionTasks: async () => ({}) },
    navigator: { mediaDevices: { getUserMedia: (...args) => { acquisitions++; return acquire(...args); } } },
    document, window, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    performance: { now: () => id + 100 }, Blob, atob,
    URL: { createObjectURL: () => `blob:local-${++id}`, revokeObjectURL: (url) => revoked.push(url) }
  });
  vm.runInContext(logic, context);
  const h = {
    app: null, video, canvas, ctx, model, document, window, context,
    raf, timers, events, revoked, downloads,
    render() {
      cursor = 0;
      h.app = context.App();
      h.app.videoRef.current = video;
      h.app.canvasRef.current = canvas;
      h.app.frameRef.current = { style: {} };
      effects.splice(0).forEach((fn) => fn());
      return h.app;
    },
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); },
    setCreate(fn) { create = fn; }, setAcquire(fn) { acquire = fn; },
    counts: () => ({ creates, acquisitions, draws, detections }),
    frame() {
      assert.equal(raf.size, 1, "exactly one render loop must be scheduled");
      const [key, fn] = [...raf][0];
      raf.delete(key);
      fn();
    }
  };
  h.render();
  return h;
}

test("model requests share one promise and reuse the instance", async () => {
  const h = harness(), loading = deferred();
  h.setCreate(() => loading.promise);
  const first = h.app.ensureLandmarker(), second = h.app.ensureLandmarker();
  assert.equal(first, second);
  await tick();
  assert.equal(h.counts().creates, 1);
  loading.resolve(h.model);
  assert.equal(await first, h.model);
  assert.equal(await h.app.ensureLandmarker(), h.model);
  assert.equal(h.counts().creates, 1);
  h.unmount();
  assert.equal(h.model.closed, 1);
});

test("model failure clears the promise and allows a successful retry", async () => {
  const h = harness();
  h.setCreate(async () => { throw new Error("offline"); });
  await h.app.startCamera();
  assert.match(h.app.uiRef.current.error, /モデル/);
  assert.equal(h.app.modelPromiseRef.current, null);
  assert.equal(h.render().state.cameraStarting, false);
  h.setCreate(async () => h.model);
  await h.app.startCamera();
  assert.equal(h.counts().creates, 2);
  assert.equal(h.render().state.cameraActive, true);
  h.unmount();
});

test("WASM loading failure can be retried without changing model options", async () => {
  const h = harness();
  h.context.FilesetResolver.forVisionTasks = async () => { throw new Error("WASM offline"); };
  await assert.rejects(h.app.ensureLandmarker(), /WASM offline/);
  assert.equal(h.app.modelPromiseRef.current, null);
  assert.equal(h.counts().creates, 0);
  h.context.FilesetResolver.forVisionTasks = async () => ({});
  h.setCreate(async (_, options) => {
    assert.deepEqual(JSON.parse(JSON.stringify(options)), {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
      runningMode: "VIDEO", numFaces: 1,
      minFaceDetectionConfidence: 0.45, minFacePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45, outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    });
    return h.model;
  });
  assert.equal(await h.app.ensureLandmarker(), h.model);
  h.unmount();
});

test("unmount while resolving WASM prevents model creation", async () => {
  const h = harness(), loading = deferred();
  h.context.FilesetResolver.forVisionTasks = () => loading.promise;
  const start = h.app.startCamera();
  h.unmount();
  loading.resolve({});
  await start;
  assert.equal(h.counts().creates, 0);
  assert.equal(h.counts().acquisitions, 0);
});

test("a model created after unmount is closed and cannot start a camera", async () => {
  const h = harness(), loading = deferred();
  h.setCreate(() => loading.promise);
  const start = h.app.startCamera();
  await tick();
  h.unmount();
  loading.resolve(h.model);
  await start;
  assert.equal(h.model.closed, 1);
  assert.equal(h.app.faceLandmarkerRef.current, null);
  assert.equal(h.counts().acquisitions, 0);
});

test("rapid starts and a cancelled pending acquisition never overlap", async () => {
  const h = harness(), pending = deferred(), stream = mediaStream();
  h.setAcquire(() => pending.promise);
  const start = h.app.startCamera();
  await h.app.startCamera();
  await tick();
  assert.equal(h.counts().acquisitions, 1);
  h.app.stopCamera();
  await h.app.startCamera();
  assert.equal(h.counts().acquisitions, 1);
  pending.resolve(stream);
  await start;
  assert.ok(stream.tracks.every((track) => track.stopped === 1));
  assert.equal(h.video.srcObject, null);
  assert.equal(h.raf.size, 0);
  assert.equal(h.render().state.cameraStarting, false);
  h.setAcquire(async () => mediaStream());
  await h.app.startCamera();
  assert.equal(h.counts().acquisitions, 2);
  assert.equal(h.render().state.cameraActive, true);
  h.unmount();
});

for (const interruption of ["visibilitychange", "pagehide", "unmount"]) {
  test(`${interruption} releases a late stream`, async () => {
    const h = harness(), pending = deferred(), stream = mediaStream();
    h.setAcquire(() => pending.promise);
    const start = h.app.startCamera();
    await tick();
    if (interruption === "unmount") h.unmount();
    else {
      if (interruption === "visibilitychange") h.document.hidden = true;
      h.events.get(interruption)();
      h.document.hidden = false;
    }
    pending.resolve(stream);
    await start;
    assert.ok(stream.tracks.every((track) => track.stopped === 1));
    assert.equal(h.video.srcObject, null);
    assert.equal(h.raf.size, 0);
    h.unmount();
  });
}

test("stop during video.play prevents a late completion from restarting rendering", async () => {
  const h = harness(), playing = deferred(), stream = mediaStream();
  h.setAcquire(async () => stream);
  h.video.play = () => playing.promise;
  const start = h.app.startCamera();
  await tick();
  h.app.stopCamera();
  playing.resolve();
  await start;
  assert.ok(stream.tracks.every((track) => track.stopped === 1));
  assert.equal(h.render().state.cameraActive, false);
  assert.equal(h.raf.size, 0);
  h.unmount();
});

test("active streams and the sole RAF are stopped on hiding; resume is manual", async () => {
  const h = harness(), stream = mediaStream();
  h.setAcquire(async (constraints) => {
    assert.equal(constraints.video.facingMode, "user");
    assert.equal(constraints.audio, false);
    return stream;
  });
  await h.app.startCamera();
  await h.app.startCamera();
  assert.equal(h.counts().acquisitions, 1);
  assert.equal(h.raf.size, 1);
  const staleCallback = [...h.raf.values()][0];
  h.document.hidden = true;
  h.events.get("visibilitychange")();
  h.document.hidden = false;
  h.events.get("visibilitychange")();
  staleCallback();
  assert.equal(h.raf.size, 0);
  assert.equal(h.video.srcObject, null);
  assert.ok(stream.tracks.every((track) => track.stopped === 1));
  h.unmount();
  assert.equal(h.events.size, 0);
});

for (const [name, message] of [
  ["NotAllowedError", /許可/], ["NotFoundError", /見つかりません/],
  ["NotReadableError", /使用中の可能性/], ["OtherError", /原因を特定できません/]
]) {
  test(`${name} gives specific guidance and permits retry`, async () => {
    const h = harness();
    h.setAcquire(async () => { throw Object.assign(new Error(), { name }); });
    await h.app.startCamera();
    assert.match(h.app.uiRef.current.error, message);
    assert.equal(h.render().state.cameraStarting, false);
    h.setAcquire(async () => mediaStream());
    await h.app.startCamera();
    assert.equal(h.render().state.cameraActive, true);
    h.unmount();
  });
}

test("insecure context is rejected before model or camera access", async () => {
  const h = harness();
  h.window.isSecureContext = false;
  await h.app.startCamera();
  assert.match(h.app.uiRef.current.error, /HTTPS/);
  assert.equal(h.counts().creates, 0);
  assert.equal(h.counts().acquisitions, 0);
  assert.equal(h.render().state.cameraStarting, false);
  h.unmount();
});

test("video playback failure releases the stream and allows retry", async () => {
  const h = harness(), stream = mediaStream();
  h.setAcquire(async () => stream);
  h.video.play = async () => { throw new Error(); };
  await h.app.startCamera();
  assert.match(h.app.uiRef.current.error, /再生/);
  assert.ok(stream.tracks.every((track) => track.stopped === 1));
  assert.equal(h.raf.size, 0);
  h.video.play = async () => {};
  h.setAcquire(async () => mediaStream());
  await h.app.startCamera();
  assert.equal(h.render().state.cameraActive, true);
  h.unmount();
});

test("inference errors and missing faces keep one loop; identical frames retain the composite", async () => {
  const h = harness();
  h.model.detectForVideo = () => { throw new Error("inference"); };
  await h.app.startCamera();
  assert.match(h.app.uiRef.current.error, /顔認識/);
  const draws = h.counts().draws;
  h.frame();
  assert.equal(h.counts().draws, draws);
  assert.equal(h.raf.size, 1);
  h.video.currentTime++;
  h.model.detectForVideo = () => ({ faceLandmarks: [] });
  h.frame();
  assert.equal(h.app.uiRef.current.status, "顔が見つかりません");
  assert.equal(h.app.uiRef.current.thinking, false);
  assert.equal(h.app.uiRef.current.error, "");
  assert.equal(h.raf.size, 1);
  h.unmount();
});

test("all six existing overlays render and recover after a face returns", async () => {
  const h = harness();
  const landmarks = Array.from({ length: 478 }, (_, i) => ({
    x: 0.3 + (i % 20) / 50, y: 0.25 + Math.floor(i / 20) / 60, z: 0
  }));
  await h.app.startCamera();
  for (const effect of ["genius", "white-eye", "unibrow", "eye-mask", "heart-eyes", "eye-mosaic"]) {
    h.app.effectRef.current = effect;
    h.model.detectForVideo = () => ({ faceLandmarks: [landmarks] });
    h.video.currentTime++;
    h.frame();
    assert.equal(h.app.uiRef.current.error, "", effect);
    assert.equal(h.app.uiRef.current.statusState, "detecting", effect);
    assert.equal(h.raf.size, 1);
  }
  h.unmount();
});

test("screenshots require an active, drawable frame", async () => {
  const h = harness();
  await h.app.takeScreenshot();
  assert.match(h.render().state.captureError, /映像がありません/);
  h.video.readyState = 0;
  await h.app.startCamera();
  await h.app.takeScreenshot();
  assert.equal(h.downloads.length, 0);
  h.video.readyState = 2;
  h.frame();
  assert.equal(h.render().state.frameReady, true);
  h.app.stopCamera();
  await h.app.takeScreenshot();
  assert.equal(h.downloads.length, 0);
  h.unmount();
});

test("PNG Blob download and Safari image URLs are released at their respective lifetimes", async () => {
  const h = harness();
  await h.app.startCamera();
  h.canvas.toBlob = (callback, type) => {
    assert.equal(type, "image/png");
    callback(new Blob(["composite"], { type }));
  };
  await h.app.takeScreenshot();
  const image = h.render().state.savedImage;
  assert.match(h.downloads[0].download, /\.png$/);
  assert.notEqual(h.downloads[0].href, image.url);
  assert.equal(h.revoked.length, 0);
  [...h.timers.values()][0]();
  assert.ok(h.revoked.includes(h.downloads[0].href));
  assert.ok(!h.revoked.includes(image.url));
  h.app.releaseSavedImage();
  h.render();
  assert.ok(h.revoked.includes(image.url));
  await h.app.takeScreenshot();
  h.render();
  h.unmount();
  assert.ok(h.downloads.every(({ href }) => h.revoked.includes(href)));
});

test("PNG generation failure is visible and a later capture succeeds", async () => {
  const h = harness();
  await h.app.startCamera();
  h.canvas.toBlob = (callback) => callback(null);
  await h.app.takeScreenshot();
  assert.match(h.render().state.captureError, /生成・保存に失敗/);
  assert.equal(h.app.state.saving, false);
  h.canvas.toBlob = (callback) => callback(new Blob(["png"]));
  await h.app.takeScreenshot();
  assert.equal(h.downloads.length, 1);
  h.render();
  h.unmount();
});

test("stop during PNG generation discards the result without leaving URLs", async () => {
  const h = harness();
  await h.app.startCamera();
  let complete;
  h.canvas.toBlob = (callback) => { complete = callback; };
  const capture = h.app.takeScreenshot();
  await h.app.takeScreenshot();
  h.app.stopCamera();
  complete(new Blob(["png"]));
  await capture;
  assert.equal(h.downloads.length, 0);
  assert.equal(h.render().state.savedImage, null);
  assert.equal(h.app.state.saving, false);
  h.unmount();
});

test("unmount during PNG generation leaves no download or image URLs", async () => {
  const h = harness();
  await h.app.startCamera();
  let complete;
  h.canvas.toBlob = (callback) => { complete = callback; };
  const capture = h.app.takeScreenshot();
  h.unmount();
  complete(new Blob(["png"]));
  await capture;
  assert.equal(h.downloads.length, 0);
  assert.equal(h.timers.size, 0);
});
