import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the actual component's imperative handlers with lightweight hook/browser
// doubles. JSX is excluded; no camera, model download, or extra dependency is needed.
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const body = source.slice(0, source.lastIndexOf("  return ("))
  .replace(/^import .*;\r?\n/gm, "")
  .replace("export default function", "function");
const exports = `return { startCamera, stopCamera, ensureHandLandmarker, takeScreenshot,
  videoRef, canvasRef, frameRef, streamRef, handLandmarkerRef, validFrameRef,
  handsRef, particlesRef, castHoldRef, previousPalmRef, lastVideoTimeRef,
  currentPalmDirectionRef, isPalmOpenRef }; }\nIceMagicApp();`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const stream = () => {
  const track = { stops: 0, stop() { this.stops++; } };
  return { track, getTracks: () => [track] };
};

function setup({ getUserMedia, create, resolveVision } = {}) {
  const effects = [], states = [], raf = new Map(), calls = [], downloads = [], revoked = [];
  const documentListeners = new Map(), windowListeners = new Map();
  const model = { closes: 0, close() { this.closes++; }, detectForVideo: () => ({ landmarks: [] }) };
  let rafId = 0, urls = 0;
  const document = {
    hidden: false,
    addEventListener: (name, fn) => documentListeners.set(name, fn),
    removeEventListener: (name) => documentListeners.delete(name),
    body: { appendChild() {} },
    createElement: () => ({ click() { downloads.push(this.href); }, remove() {} })
  };
  const context = {
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const index = states.length;
      states.push(initial);
      return [initial, (value) => { states[index] = value; }];
    },
    useEffect: (fn) => effects.push(fn),
    FilesetResolver: { forVisionTasks: resolveVision || (async () => ({})) },
    HandLandmarker: { createFromOptions: async (_, options) => {
      calls.push(options);
      return create ? create(options) : model;
    } },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream()) } },
    window: {
      isSecureContext: true,
      addEventListener: (name, fn) => windowListeners.set(name, fn),
      removeEventListener: (name) => windowListeners.delete(name)
    },
    document,
    URL: { createObjectURL: () => `blob:${++urls}`, revokeObjectURL: (url) => revoked.push(url) },
    requestAnimationFrame: (fn) => { raf.set(++rafId, fn); return rafId; },
    cancelAnimationFrame: (id) => raf.delete(id),
    performance: { now: () => 100 },
    console: { warn() {}, error() {} }
  };
  const api = vm.runInNewContext(body + exports, context);
  const cleanups = effects.map((effect) => effect());
  const ctx = new Proxy({}, { get: (_, key) => key === "createLinearGradient" || key === "createRadialGradient"
    ? () => ({ addColorStop() {} }) : () => {} });
  const video = { srcObject: null, readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 1,
    pauses: 0, pause() { this.pauses++; }, play: async () => {} };
  const canvas = { width: 640, height: 480, getContext: () => ctx,
    toBlob: (cb, type) => { assert.equal(type, "image/png"); cb({ type }); } };
  api.videoRef.current = video;
  api.canvasRef.current = canvas;
  api.frameRef.current = {};
  const stateNames = [...source.matchAll(/const \[(\w+), set\w+\] = useState/g)].map((m) => m[1]);
  return { ...api, context, model, calls, raf, video, canvas, downloads, revoked,
    state: (name) => states[stateNames.indexOf(name)],
    hide() { document.hidden = true; documentListeners.get("visibilitychange")(); },
    show() { document.hidden = false; documentListeners.get("visibilitychange")(); },
    pagehide() { windowListeners.get("pagehide")(); },
    unmount() { cleanups.forEach((fn) => fn?.()); },
    frame() { const [id, fn] = raf.entries().next().value; raf.delete(id); fn(); }
  };
}

test("rapid start shares one request and one frame loop; stop releases and resets", async () => {
  let acquisitions = 0;
  const media = stream();
  const app = setup({ getUserMedia: async () => { acquisitions++; return media; } });
  await Promise.all([app.startCamera(), app.startCamera(), app.startCamera()]);
  assert.equal(acquisitions, 1);
  assert.equal(app.calls.length, 1);
  assert.equal(app.raf.size, 1);
  assert.equal(app.state("cameraStarting"), false);
  app.frame();
  assert.equal(app.validFrameRef.current, true);
  app.handsRef.current = [{}]; app.particlesRef.current = [{}]; app.castHoldRef.current = 4;
  app.stopCamera(); app.stopCamera();
  assert.equal(media.track.stops, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.raf.size, 0);
  assert.equal(app.handsRef.current.length, 0);
  assert.equal(app.particlesRef.current.length, 0);
  assert.equal(app.castHoldRef.current, 0);
  assert.equal(app.lastVideoTimeRef.current, -1);
  assert.equal(app.validFrameRef.current, false);
});

test("stop during model load prevents camera acquisition; restart reuses loading model", async () => {
  const loading = deferred(); let acquisitions = 0;
  const app = setup({ create: () => loading.promise, getUserMedia: async () => { acquisitions++; return stream(); } });
  const first = app.startCamera();
  await flush(); app.stopCamera();
  const second = app.startCamera();
  loading.resolve(app.model);
  await Promise.all([first, second]);
  assert.equal(app.calls.length, 1);
  assert.equal(acquisitions, 1);
  assert.equal(app.raf.size, 1);
});

test("late obsolete stream is stopped without disturbing a newer camera", async () => {
  const pending = deferred(), old = stream(), current = stream(); let count = 0;
  const app = setup({ getUserMedia: () => ++count === 1 ? pending.promise : Promise.resolve(current) });
  const first = app.startCamera(); await flush(); app.stopCamera();
  await app.startCamera();
  pending.resolve(old); await first;
  assert.equal(old.track.stops, 1);
  assert.equal(current.track.stops, 0);
  assert.equal(app.streamRef.current, current);
  assert.equal(app.raf.size, 1);
});

test("play failure releases the immediately registered stream and permits retry", async () => {
  const media = stream(), app = setup({ getUserMedia: async () => media });
  app.video.play = async () => { assert.equal(app.streamRef.current, media); throw new Error("play failed"); };
  await app.startCamera();
  assert.equal(media.track.stops, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.raf.size, 0);
  assert.match(app.state("statusText"), /再生/);
  assert.equal(app.state("cameraStarting"), false);
  app.video.play = async () => {};
  await app.startCamera();
  assert.equal(app.state("cameraActive"), true);
});

test("late play completion after stop cannot start a loop", async () => {
  const play = deferred(), media = stream(), app = setup({ getUserMedia: async () => media });
  app.video.play = () => play.promise;
  const start = app.startCamera(); await flush();
  app.stopCamera(); play.resolve(); await start;
  assert.equal(media.track.stops, 1);
  assert.equal(app.raf.size, 0);
  assert.equal(app.state("cameraActive"), false);
});

test("model shares pending promise, falls back to CPU, and retains original options", async () => {
  const app = setup({ create: (options) => {
    if (options.baseOptions.delegate === "GPU") throw new Error("GPU unavailable");
    return app.model;
  } });
  const first = app.ensureHandLandmarker(), second = app.ensureHandLandmarker();
  assert.equal(first, second);
  assert.equal(await first, app.model);
  assert.equal(await app.ensureHandLandmarker(), app.model);
  assert.deepEqual(app.calls.map((o) => o.baseOptions.delegate), ["GPU", "CPU"]);
  for (const options of app.calls) {
    assert.equal(options.numHands, 2);
    for (const key of ["minHandDetectionConfidence", "minHandPresenceConfidence", "minTrackingConfidence"]) assert.equal(options[key], 0.45);
  }
});

test("model resolver and GPU/CPU failures are retryable and explained", async () => {
  let failResolve = true, failCreate = true;
  const app = setup({ resolveVision: async () => { if (failResolve) throw new Error("offline"); return {}; },
    create: () => { if (failCreate) throw new Error("model unavailable"); return app.model; } });
  await assert.rejects(app.ensureHandLandmarker(), /取得/);
  failResolve = false;
  await assert.rejects(app.ensureHandLandmarker(), /GPU・CPU/);
  failCreate = false;
  assert.equal(await app.ensureHandLandmarker(), app.model);
});

test("unmount closes a model that finishes loading later and prevents acquisition", async () => {
  const loading = deferred(); let acquisitions = 0;
  const app = setup({ create: () => loading.promise, getUserMedia: async () => { acquisitions++; return stream(); } });
  const start = app.startCamera(); await flush(); app.unmount(); loading.resolve(app.model); await start;
  assert.equal(app.model.closes, 1);
  assert.equal(acquisitions, 0);
  assert.equal(app.handLandmarkerRef.current, null);
});

test("visibility/pagehide stop pending and active cameras; show requires user restart", async () => {
  const pending = deferred(), old = stream(); let count = 0;
  const app = setup({ getUserMedia: () => ++count === 1 ? pending.promise : Promise.resolve(stream()) });
  const start = app.startCamera(); await flush(); app.hide(); pending.resolve(old); await start;
  assert.equal(old.track.stops, 1);
  app.show(); assert.equal(count, 1); assert.equal(app.raf.size, 0);
  await app.startCamera(); assert.equal(app.raf.size, 1);
  const media = app.streamRef.current;
  app.pagehide(); assert.equal(media.track.stops, 1); assert.equal(app.raf.size, 0);
  await app.startCamera(); assert.equal(app.state("cameraActive"), true);
  app.unmount(); assert.equal(app.model.closes, 1);
});

test("camera error cases and insecure/unsupported environments are explained", async () => {
  for (const [name, message] of [["NotAllowedError", /許可/], ["NotFoundError", /見つかりません/], ["NotReadableError", /他のアプリ/], ["UnknownError", /開始できません/]]) {
    const app = setup({ getUserMedia: async () => { throw Object.assign(new Error("failure"), { name }); } });
    await app.startCamera(); assert.match(app.state("statusText"), message); assert.equal(app.raf.size, 0);
  }
  const app = setup(); app.context.window.isSecureContext = false;
  await app.startCamera(); assert.match(app.state("statusText"), /HTTPS/);
  app.context.window.isSecureContext = true; app.context.navigator.mediaDevices = undefined;
  await app.startCamera(); assert.match(app.state("statusText"), /この環境/);
});

test("PNG requires a rendered frame; URL stays usable until replaced or unmounted", async () => {
  const app = setup();
  await app.takeScreenshot(); assert.equal(app.downloads.length, 0);
  await app.startCamera(); await app.takeScreenshot(); assert.equal(app.downloads.length, 0);
  app.frame(); await app.takeScreenshot();
  assert.deepEqual(app.downloads, ["blob:1"]); assert.equal(app.revoked.length, 0);
  assert.match(app.state("screenshotMessage"), /iPhone/);
  await app.takeScreenshot(); assert.deepEqual(app.revoked, ["blob:1"]);
  app.canvas.toBlob = (cb) => cb(null);
  await app.takeScreenshot(); assert.match(app.state("screenshotMessage"), /失敗/);
  app.stopCamera(); await app.takeScreenshot(); assert.equal(app.downloads.length, 2);
  app.unmount(); assert.deepEqual(app.revoked, ["blob:1", "blob:2"]);
});

test("pending screenshot completion after unmount creates no URL or download", async () => {
  const app = setup(); await app.startCamera(); app.frame();
  let complete; app.canvas.toBlob = (cb) => { complete = cb; };
  const capture = app.takeScreenshot();
  await app.takeScreenshot(); // Repeated tap is ignored while encoding.
  app.unmount(); complete({ type: "image/png" }); await capture;
  assert.equal(app.downloads.length, 0); assert.equal(app.revoked.length, 0);
});
