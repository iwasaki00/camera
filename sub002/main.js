import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

const LEFT_EYE_INDEXES = {
  outer: 33,
  inner: 133,
  top: 159,
  bottom: 145
};

const RIGHT_EYE_INDEXES = {
  outer: 362,
  inner: 263,
  top: 386,
  bottom: 374
};

const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");
const statusBadge = document.getElementById("statusBadge");
const message = document.getElementById("message");

let stream = null;
let faceLandmarker = null;
let animationFrameId = 0;
let lastVideoTime = -1;
let isRunning = false;

function setStatus(text) {
  statusBadge.textContent = text;
}

function setMessage(text) {
  message.textContent = text;
}

function stopStreamTracks() {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

function drawWaitingScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#2d2019");
  gradient.addColorStop(1, "#130d0a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 250, 244, 0.82)";
  ctx.font = "700 30px 'Hiragino Sans', 'Yu Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("白目カメラ", canvas.width / 2, canvas.height / 2 - 18);

  ctx.font = "20px 'Hiragino Sans', 'Yu Gothic', sans-serif";
  ctx.fillText("下のボタンからカメラを開始", canvas.width / 2, canvas.height / 2 + 26);
}

function resizeCanvasToVideo() {
  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

async function createFaceLandmarker() {
  if (faceLandmarker) {
    return faceLandmarker;
  }

  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });

  return faceLandmarker;
}

function getEyeGeometry(landmarks, eyeIndexes) {
  const outer = landmarks[eyeIndexes.outer];
  const inner = landmarks[eyeIndexes.inner];
  const top = landmarks[eyeIndexes.top];
  const bottom = landmarks[eyeIndexes.bottom];

  const centerX = (outer.x + inner.x) / 2;
  const centerY = (top.y + bottom.y) / 2;
  const width = Math.abs(inner.x - outer.x) * canvas.width * 1.8;
  const height = Math.abs(bottom.y - top.y) * canvas.height * 3.4;

  return {
    x: canvas.width - centerX * canvas.width,
    y: centerY * canvas.height,
    width: Math.max(width, 26),
    height: Math.max(height, 18)
  };
}

function drawEyeOverlay(eye) {
  ctx.save();
  ctx.translate(eye.x, eye.y);
  ctx.rotate(0.04);

  ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
  ctx.beginPath();
  ctx.ellipse(0, 0, eye.width / 2, eye.height / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(35, 28, 22, 0.16)";
  ctx.lineWidth = Math.max(2, eye.height * 0.08);
  ctx.stroke();

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(0, -eye.height * 0.12, Math.max(eye.height * 0.16, 4), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMirroredVideoFrame() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function renderLoop() {
  if (!isRunning || !faceLandmarker) {
    return;
  }

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrameId = window.requestAnimationFrame(renderLoop);
    return;
  }

  resizeCanvasToVideo();
  drawMirroredVideoFrame();

  if (video.currentTime === lastVideoTime) {
    animationFrameId = window.requestAnimationFrame(renderLoop);
    return;
  }

  lastVideoTime = video.currentTime;
  const result = faceLandmarker.detectForVideo(video, performance.now());
  const landmarks = result.faceLandmarks?.[0];

  if (landmarks) {
    const leftEye = getEyeGeometry(landmarks, LEFT_EYE_INDEXES);
    const rightEye = getEyeGeometry(landmarks, RIGHT_EYE_INDEXES);
    drawEyeOverlay(leftEye);
    drawEyeOverlay(rightEye);
    setStatus("顔検出中");
    setMessage("両目を白目風に上書きしています。");
  } else {
    setStatus("顔未検出");
    setMessage("顔が画面中央に入るように調整してください。");
  }

  animationFrameId = window.requestAnimationFrame(renderLoop);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザでは getUserMedia が利用できません。");
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 720 },
      height: { ideal: 960 }
    }
  });

  video.srcObject = stream;
  await video.play();
}

async function boot() {
  if (isRunning) {
    return;
  }

  startButton.disabled = true;
  setStatus("初期化中");
  setMessage("カメラと顔ランドマーカーを準備しています。");

  try {
    await createFaceLandmarker();
    await startCamera();
    isRunning = true;
    lastVideoTime = -1;
    renderLoop();
    setStatus("顔未検出");
    setMessage("顔が映ると白い目を重ねます。");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus("エラー");
    setMessage(detail);
    startButton.disabled = false;
    isRunning = false;
    stopStreamTracks();
    console.error(error);
  }
}

window.addEventListener("beforeunload", () => {
  window.cancelAnimationFrame(animationFrameId);
  stopStreamTracks();
});

drawWaitingScreen();
startButton.addEventListener("click", boot);
