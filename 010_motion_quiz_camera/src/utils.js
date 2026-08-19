export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const formatTime = seconds => {
  const safe = Math.max(0, seconds || 0);
  return `${String(Math.floor(safe / 60)).padStart(2,"0")}:${String(Math.floor(safe % 60)).padStart(2,"0")}.${Math.floor((safe % 1) * 10)}`;
};
export const formatDate = timestamp => new Intl.DateTimeFormat("ja-JP", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }).format(timestamp);

export function selectMimeType() {
  const candidates = [
    "video/mp4;codecs=h264,aac", "video/mp4;codecs=avc1", "video/mp4",
    "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"
  ];
  return candidates.find(type => window.MediaRecorder?.isTypeSupported(type)) || "";
}

export function canvasToBlob(canvas, type = "image/jpeg", quality = .78) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export function friendlyError(error) {
  if (!window.isSecureContext) return "カメラにはHTTPS接続が必要です。";
  if (error?.name === "NotAllowedError") return "カメラが許可されていません。Safariの設定から許可してください。";
  if (error?.name === "NotFoundError") return "利用できるカメラが見つかりませんでした。";
  if (error?.name === "NotReadableError") return "カメラは別のアプリで使用中の可能性があります。";
  return error?.message || "処理を続けられませんでした。もう一度お試しください。";
}
