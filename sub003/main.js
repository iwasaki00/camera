import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

const LEFT_EYE_INDEXES = [33, 133, 159, 145, 160, 144, 158, 153];
const RIGHT_EYE_INDEXES = [362, 263, 386, 374, 385, 380, 387, 373];
const LEFT_IRIS_INDEXES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDEXES = [473, 474, 475, 476, 477];

const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");
const statusBadge = document.getElementById("statusBadge");
const message = document.getElementById("message");
const errorMessage = document.getElementById("errorMessage");

let stream = null;
let faceLandmarker = null;
let animationFrameId = 0;
let lastVideoTime = -1;
let isRunning = false;

function setStatus(text, state) {
  statusBadge.textContent = text;
  statusBadge.dataset.state = state;
}

function setMessage(text) {
  message.textContent = text;
}

function setError(text = "") {
  errorMessage.textContent = text;
  errorMessage.hidden = !text;
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
  gradient.addColorStop(0, "#2e2119");
  gradient.addColorStop(1, "#130c09");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 249, 243, 0.86)";
  ctx.textAlign = "center";
  ctx.font = "700 32px 'Hiragino Sans', 'Yu Gothic', sans-serif";
  ctx.fillText("白目カメラ", canvas.width / 2, canvas.height / 2 - 18);
  ctx.font = "20px 'Hiragino Sans', 'Yu Gothic', sans-serif";
  ctx.fillText("ボタンを押してカメラを開始", canvas.width / 2, canvas.height / 2 + 28);
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
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });

  return faceLandmarker;
}

function averagePoint(landmarks, indexes) {
  const total = indexes.reduce((acc, index) => {
    const point = landmarks[index];
    acc.x += point.x;
    acc.y += point.y;
    return acc;
  }, { x: 0, y: 0 });

  return {
    x: total.x / indexes.length,
    y: total.y / indexes.length
  };
}

function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function getEyeGeometry(landmarks, eyeIndexes, irisIndexes) {
  const points = eyeIndexes.map((index) => landmarks[index]);
  const irisCenter = averagePoint(landmarks, irisIndexes);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const anchorWidth = distanceBetween(landmarks[eyeIndexes[0]], landmarks[eyeIndexes[1]]);
  const anchorHeight = distanceBetween(landmarks[eyeIndexes[2]], landmarks[eyeIndexes[3]]);
  const width = Math.max((maxX - minX) * canvas.width * 1.75, anchorWidth * canvas.width * 1.45, 30);
  const height = Math.max((maxY - minY) * canvas.height * 2.8, anchorHeight * canvas.height * 2.8, 18);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    x: canvas.width - centerX * canvas.width,
    y: centerY * canvas.height,
    width,
    height,
    pupilX: canvas.width - irisCenter.x * canvas.width,
    pupilY: irisCenter.y * canvas.height - height * 0.12
  };
}

function drawEyeOverlay(eye) {
  ctx.save();
  ctx.translate(eye.x, eye.y);

  ctx.fillStyle = "rgba(255, 255, 255, 0.99)";
  ctx.beginPath();
  ctx.ellipse(0, 0, eye.width / 2, eye.height / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(42, 30, 24, 0.18)";
  ctx.lineWidth = Math.max(2, eye.height * 0.07);
  ctx.stroke();
  ctx.restore();

  const pupilRadius = Math.max(eye.height * 0.16, 4);
  const pupilOffsetX = (eye.pupilX - eye.x) * 0.22;

  ctx.fillStyle = "#121212";
  ctx.beginPath();
  ctx.arc(eye.x + pupilOffsetX, eye.pupilY, pupilRadius, 0, Math.PI * 2);
  ctx.fill();
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
    const leftEye = getEyeGeometry(landmarks, LEFT_EYE_INDEXES, LEFT_IRIS_INDEXES);
    const rightEye = getEyeGeometry(landmarks, RIGHT_EYE_INDEXES, RIGHT_IRIS_INDEXES);
    drawEyeOverlay(leftEye);
    drawEyeOverlay(rightEye);
    setStatus("顔検出中", "detecting");
    setMessage("両目に白い楕円を重ねています。");
    setError("");
  } else {
    setStatus("顔未検出", "waiting");
    setMessage("顔全体が画面に入る位置へ調整してください。");
  }

  animationFrameId = window.requestAnimationFrame(renderLoop);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザでは getUserMedia() が利用できません。HTTPS または対応ブラウザを確認してください。");
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
  setStatus("初期化中", "waiting");
  setMessage("カメラと顔ランドマーカーを準備しています。");
  setError("");

  try {
    await createFaceLandmarker();
    await startCamera();
    isRunning = true;
    lastVideoTime = -1;
    renderLoop();
    setStatus("顔未検出", "waiting");
    setMessage("顔が映ると白目フィルターを重ねます。");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus("エラー", "error");
    setMessage("カメラまたはモデルの初期化に失敗しました。");
    setError(detail);
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
