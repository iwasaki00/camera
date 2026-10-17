import { MODEL_URL, POSE_VERSION, WASM_ROOT } from "./config.js";

export class PoseDetector {
  constructor() {
    this.landmarker = null;
    this.lastTime = -1;
    this.runningMode = "VIDEO";
    this.initializing = null;
    this.queue = Promise.resolve();
    this.busy = 0;
    this.generation = 0;
  }

  init() {
    if (this.initializing) return this.initializing;
    if (this.landmarker) return Promise.resolve();
    const generation = this.generation;
    const task = (async () => {
      const mod = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${POSE_VERSION}`);
      const vision = mod.default || mod;
      const files = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      const opts = { baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: .48, minPosePresenceConfidence: .48, minTrackingConfidence: .48 };
      let model;
      try { model = await vision.PoseLandmarker.createFromOptions(files, opts); }
      catch { opts.baseOptions.delegate = "CPU"; model = await vision.PoseLandmarker.createFromOptions(files, opts); }
      if (generation !== this.generation) {
        model.close();
        throw new DOMException("モデル準備を中断しました", "AbortError");
      }
      this.landmarker = model;
      this.runningMode = "VIDEO";
      this.resetVideo();
    })();
    this.initializing = task;
    const clear = () => { if (this.initializing === task) this.initializing = null; };
    task.then(clear, clear);
    return task;
  }

  serialize(operation) {
    const generation = this.generation;
    this.busy += 1;
    const task = this.queue.then(async () => {
      if (generation !== this.generation) throw new DOMException("推論を中断しました", "AbortError");
      await this.init();
      if (generation !== this.generation) throw new DOMException("推論を中断しました", "AbortError");
      return operation(generation);
    });
    this.queue = task.catch(() => {}).finally(() => { this.busy -= 1; });
    return task;
  }

  async changeMode(mode) {
    const model = this.landmarker;
    if (this.runningMode !== mode) {
      await model.setOptions({ runningMode: mode });
      this.runningMode = mode;
    }
    this.resetVideo();
  }

  setRunningMode(mode) { return this.serialize(() => this.changeMode(mode)); }
  prepareVideo() { return this.setRunningMode("VIDEO"); }
  resetVideo() { this.lastTime = -1; }

  detect(video, now) {
    if (this.busy || this.runningMode !== "VIDEO" || !this.landmarker || video.readyState < 2 || video.currentTime === this.lastTime) return null;
    this.lastTime = video.currentTime;
    return this.landmarker.detectForVideo(video, now).landmarks?.[0] || [];
  }

  detectImage(image, isCurrent = () => true) {
    return this.serialize(async (generation) => {
      if (!isCurrent()) return [];
      await this.changeMode("IMAGE");
      if (!isCurrent()) return [];
      if (generation !== this.generation) throw new DOMException("推論を中断しました", "AbortError");
      return this.landmarker.detect(image).landmarks?.[0] || [];
    });
  }

  close() {
    this.generation += 1;
    this.initializing = null;
    const model = this.landmarker;
    this.landmarker = null;
    this.resetVideo();
    this.queue = this.queue.then(() => model?.close());
  }
}
