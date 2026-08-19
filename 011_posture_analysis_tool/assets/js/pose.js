import{MODEL_URL,POSE_VERSION,WASM_ROOT}from"./config.js";
export class PoseDetector{
  constructor(){this.landmarker=null;this.lastTime=-1;this.runningMode="VIDEO"}
  async init(){const mod=await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${POSE_VERSION}`);const vision=mod.default||mod;const files=await vision.FilesetResolver.forVisionTasks(WASM_ROOT);const opts={baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},runningMode:this.runningMode,numPoses:1,minPoseDetectionConfidence:.48,minPosePresenceConfidence:.48,minTrackingConfidence:.48};try{this.landmarker=await vision.PoseLandmarker.createFromOptions(files,opts)}catch{opts.baseOptions.delegate="CPU";this.landmarker=await vision.PoseLandmarker.createFromOptions(files,opts)}}
  async setRunningMode(mode){if(this.runningMode===mode)return;await this.landmarker.setOptions({runningMode:mode});this.runningMode=mode;this.lastTime=-1}
  async prepareVideo(){await this.setRunningMode("VIDEO")}
  detect(video,now){if(!this.landmarker||video.readyState<2||video.currentTime===this.lastTime)return null;this.lastTime=video.currentTime;return this.landmarker.detectForVideo(video,now).landmarks?.[0]||[]}
  async detectImage(image){if(!this.landmarker)return[];await this.setRunningMode("IMAGE");return this.landmarker.detect(image).landmarks?.[0]||[]}
}
