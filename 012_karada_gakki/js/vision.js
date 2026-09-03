export const VISION_VERSION = "0.10.22-rc.20250304";
export const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
export const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
export const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let modulePromise;
let filesetPromise;

export async function getVision() {
  modulePromise ||= import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/+esm`);
  return modulePromise;
}

export async function getFileset() {
  filesetPromise ||= getVision().then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(WASM_ROOT));
  return filesetPromise;
}
