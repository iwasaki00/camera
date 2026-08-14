export const POSE_VERSION = "0.10.35";
export const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${POSE_VERSION}/wasm`;
export const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const TARGET_FPS = 20;
export const DB_NAME = "motion-quiz-camera";
export const DB_VERSION = 1;

export const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];

export const DIFFICULTIES = {
  easy: { label: "かんたん", points: true, lines: true, joints: null },
  normal: { label: "ふつう", points: false, lines: true, joints: null },
  hard: { label: "むずかしい", points: true, lines: false, joints: null },
  extreme: { label: "激ムズ", points: true, lines: false, joints: [0,11,12,15,16,23,24,27,28] }
};
