import { MODEL_URL, POSE_VERSION, WASM_ROOT } from "./config.js";

export class PoseDetector {
  constructor() { this.landmarker = null; this.lastVideoTime = -1; }

  init() {
    if(this.landmarker)return Promise.resolve();
    if(!this.initPromise)this.initPromise=this.initialize().finally(()=>{this.initPromise=null;});
    return this.initPromise;
  }

  async initialize() {
    const module = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${POSE_VERSION}`);
    const vision = module.default || module;
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
    const options = {
      baseOptions: { modelAssetPath:MODEL_URL, delegate:"GPU" },
      runningMode: "VIDEO", numPoses:1,
      minPoseDetectionConfidence:.45, minPosePresenceConfidence:.45, minTrackingConfidence:.45
    };
    try {
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options);
    }
  }

  detect(video, timestamp) {
    if (!this.landmarker || video.currentTime === this.lastVideoTime || video.readyState < 2) return null;
    this.lastVideoTime = video.currentTime;
    const result = this.landmarker.detectForVideo(video, timestamp);
    return result.landmarks?.[0] || [];
  }

  reset() { this.lastVideoTime=-1; }

  close() { this.reset(); this.landmarker?.close(); this.landmarker = null; }
}
