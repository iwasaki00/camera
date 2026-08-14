export const POSE_VERSION="0.10.35";
export const WASM_ROOT=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${POSE_VERSION}/wasm`;
export const MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const VISIBILITY=.5;
export const SAMPLE_COUNT=8;
export const CONNECTIONS=[[0,7],[0,8],[7,11],[8,12],[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
export const MODE_LABELS={front:"正面",left:"左側面",right:"右側面"};
