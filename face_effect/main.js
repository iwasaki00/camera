import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

const EFFECT_LABELS = {
  "white-eye": "白目",
  unibrow: "つながり眉",
  equations: "数式"
};

const LEFT_EYE_INDEXES = [33, 133, 159, 145, 160, 144, 158, 153];
const RIGHT_EYE_INDEXES = [362, 263, 386, 374, 385, 380, 387, 373];
const LEFT_IRIS_INDEXES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDEXES = [473, 474, 475, 476, 477];

const LEFT_BROW_CURVE = [70, 63, 105];
const RIGHT_BROW_CURVE = [336, 296, 334];
const BROW_BRIDGE = [107, 9, 336];
const FOREHEAD_ANCHORS = [10, 67, 109, 338, 297];

const EQUATIONS = [
  "E = mc^2",
  "f(x) = sin(x)",
  "x^2 + y^2 = r^2",
  "P(A|B)",
  "integral f dx",
  "Sigma a_n",
  "a^2 + b^2"
];

const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");
const statusBadge = document.getElementById("statusBadge");
const message = document.getElementById("message");
const errorMessage = document.getElementById("errorMessage");
const effectButtons = Array.from(document.querySelectorAll(".effect-button"));

let stream = null;
let faceLandmarker = null;
let animationFrameId = 0;
let lastVideoTime = -1;
let isRunning = false;
let currentEffect = "white-eye";
let lastDetectionAt = 0;

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

function setEffect(effectName) {
  currentEffect = effectName;
  effectButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.effect === effectName);
  });

  if (isRunning) {
    setMessage(`${EFFECT_LABELS[effectName]}エフェクトを表示しています。`);
  }
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
  ctx.fillText("顔エフェクトカメラ", canvas.width / 2, canvas.height / 2 - 18);
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

function mirroredPoint(point) {
  return {
    x: canvas.width - point.x * canvas.width,
    y: point.y * canvas.height
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

function getHeadGeometry(landmarks) {
  const allX = landmarks.map((point) => point.x);
  const allY = landmarks.map((point) => point.y);
  const foreheadCenter = mirroredPoint(averagePoint(landmarks, FOREHEAD_ANCHORS));

  return {
    centerX: canvas.width - ((Math.min(...allX) + Math.max(...allX)) / 2) * canvas.width,
    topY: Math.min(...allY) * canvas.height,
    width: (Math.max(...allX) - Math.min(...allX)) * canvas.width,
    foreheadX: foreheadCenter.x,
    foreheadY: foreheadCenter.y
  };
}

function drawWhiteEyeOverlay(landmarks) {
  const leftEye = getEyeGeometry(landmarks, LEFT_EYE_INDEXES, LEFT_IRIS_INDEXES);
  const rightEye = getEyeGeometry(landmarks, RIGHT_EYE_INDEXES, RIGHT_IRIS_INDEXES);
  [leftEye, rightEye].forEach((eye) => {
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
  });
}

function drawUnibrowOverlay(landmarks) {
  const left = LEFT_BROW_CURVE.map((index) => mirroredPoint(landmarks[index]));
  const right = RIGHT_BROW_CURVE.map((index) => mirroredPoint(landmarks[index]));
  const bridge = BROW_BRIDGE.map((index) => mirroredPoint(landmarks[index]));
  const browThickness = Math.max(distanceBetween(left[0], left[2]) * 0.18, 10);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(34, 20, 12, 0.94)";
  ctx.shadowColor = "rgba(34, 20, 12, 0.24)";
  ctx.shadowBlur = browThickness * 0.5;

  ctx.lineWidth = browThickness;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  ctx.quadraticCurveTo(left[1].x, left[1].y - browThickness * 0.18, left[2].x, left[2].y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(right[0].x, right[0].y);
  ctx.quadraticCurveTo(right[1].x, right[1].y - browThickness * 0.18, right[2].x, right[2].y);
  ctx.stroke();

  ctx.lineWidth = browThickness * 0.92;
  ctx.beginPath();
  ctx.moveTo(left[2].x, left[2].y - browThickness * 0.1);
  ctx.quadraticCurveTo(bridge[1].x, bridge[1].y + browThickness * 0.5, right[0].x, right[0].y - browThickness * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawEquationOverlay(landmarks, now) {
  const head = getHeadGeometry(landmarks);
  const baseY = Math.min(head.topY - head.width * 0.08, head.foreheadY - 26);
  const spacing = Math.max(head.width * 0.18, 72);

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255, 252, 245, 0.95)";
  ctx.strokeStyle = "rgba(21, 26, 45, 0.72)";
  ctx.shadowColor = "rgba(8, 12, 25, 0.25)";
  ctx.shadowBlur = 14;

  EQUATIONS.forEach((formula, index) => {
    const wave = now / 700 + index * 0.9;
    const x = head.foreheadX + (index - 3) * spacing * 0.52 + Math.sin(wave * 1.2) * 10;
    const y = baseY - Math.sin(wave) * 14 - index * 12;
    const alpha = 0.58 + ((Math.sin(wave) + 1) / 2) * 0.35;
    const fontSize = 20 + (index % 3) * 4;

    ctx.globalAlpha = alpha;
    ctx.font = `700 ${fontSize}px Georgia, 'Times New Roman', serif`;
    ctx.strokeText(formula, x, y);
    ctx.fillText(formula, x, y);
  });

  ctx.restore();
}

function drawMirroredVideoFrame() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawSelectedEffect(landmarks, now) {
  if (currentEffect === "white-eye") {
    drawWhiteEyeOverlay(landmarks);
    return;
  }

  if (currentEffect === "unibrow") {
    drawUnibrowOverlay(landmarks);
    return;
  }

  drawEquationOverlay(landmarks, now);
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

  const now = performance.now();
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = faceLandmarker.detectForVideo(video, now);
    const landmarks = result.faceLandmarks?.[0];

    if (landmarks) {
      drawSelectedEffect(landmarks, now);
      lastDetectionAt = now;
      setStatus("顔検出中", "detecting");
      setMessage(`${EFFECT_LABELS[currentEffect]}エフェクトを表示しています。`);
      setError("");
    } else {
      setStatus("顔未検出", "waiting");
      setMessage("顔全体が画面に入る位置へ調整してください。");
    }
  } else if (currentEffect === "equations" && lastDetectionAt > 0) {
    const result = faceLandmarker.detectForVideo(video, now);
    const landmarks = result.faceLandmarks?.[0];
    if (landmarks) {
      drawEquationOverlay(landmarks, now);
    }
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
    setMessage("顔が映ると選択中のエフェクトを重ねます。");
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

effectButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setEffect(button.dataset.effect);
  });
});

drawWaitingScreen();
setEffect(currentEffect);
startButton.addEventListener("click", boot);
