import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const startButton = document.querySelector("#startButton");
const offButton = document.querySelector("#offButton");
const debugButton = document.querySelector("#debugButton");
const statusText = document.querySelector("#statusText");
const swingBadge = document.querySelector("#swingBadge");
const sensitivityRange = document.querySelector("#sensitivityRange");
const lengthRange = document.querySelector("#lengthRange");
const colorButtons = [...document.querySelectorAll(".color-button")];
const judgeElements = {
  hands: document.querySelector("#judgeHands"),
  fists: document.querySelector("#judgeFists"),
  close: document.querySelector("#judgeClose"),
  hold: document.querySelector("#judgeHold"),
  saber: document.querySelector("#judgeSaber"),
  score: document.querySelector("#judgeScore")
};
const judgeValues = {
  hands: document.querySelector("#handsValue"),
  fists: document.querySelector("#fistsValue"),
  close: document.querySelector("#closeValue"),
  hold: document.querySelector("#holdValue"),
  saber: document.querySelector("#saberValue"),
  score: document.querySelector("#scoreValue")
};

const COLORS = {
  blue: { core: "#ffffff", glow: "#2f8cff" },
  green: { core: "#ffffff", glow: "#3ee96b" },
  red: { core: "#ffffff", glow: "#ff3c3c" },
  purple: { core: "#ffffff", glow: "#a56bff" }
};

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];
const PALM_POINTS = [0, 5, 9, 13, 17];
const ACTIVATION_HOLD_MS = 180;

let handLandmarker;
let stream;
let isRunning = false;
let debugEnabled = false;
let selectedColor = "blue";
let lastVideoTime = -1;
let fistHoldStartedAt = 0;
let saberState = "off";
let saberStartedAt = 0;
let lastSeenHandsAt = 0;
let handsApartStartedAt = 0;
let lastSwingAt = 0;
let audioContext;
let smoothedPose = null;
let previousPose = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function updateStatus(text) {
  statusText.textContent = text;
}

function setJudgeState(key, value, state = "wait") {
  const item = judgeElements[key];
  const output = judgeValues[key];
  if (!item || !output) return;

  output.textContent = value;
  item.classList.toggle("is-ok", state === "ok");
  item.classList.toggle("is-bad", state === "bad");
  item.classList.toggle("is-active", state === "active");
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(window.innerWidth * dpr);
  const height = Math.floor(window.innerHeight * dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

// MediaPipe の座標は映像基準なので、鏡表示に合わせて X だけ反転してCanvas座標へ変換する。
function toScreenPoint(landmark) {
  return {
    x: (1 - landmark.x) * window.innerWidth,
    y: landmark.y * window.innerHeight
  };
}

function averagePoint(landmarks, indexes) {
  const total = indexes.reduce(
    (sum, index) => {
      const point = toScreenPoint(landmarks[index]);
      sum.x += point.x;
      sum.y += point.y;
      return sum;
    },
    { x: 0, y: 0 }
  );

  return { x: total.x / indexes.length, y: total.y / indexes.length };
}

function handScale(landmarks) {
  return Math.max(distance(landmarks[0], landmarks[9]), distance(landmarks[5], landmarks[17]));
}

function getFistState(landmarks) {
  const scale = handScale(landmarks);
  const sensitivity = Number(sensitivityRange.value) / 100;
  const curlMargin = mix(1.08, 1.24, sensitivity);
  let curled = 0;

  // 人差し指から小指まで、指先がPIP関節より手首側に寄っていれば曲がっているとみなす。
  for (let i = 0; i < FINGER_TIPS.length; i += 1) {
    const tipToWrist = distance(landmarks[FINGER_TIPS[i]], landmarks[0]);
    const pipToWrist = distance(landmarks[FINGER_PIPS[i]], landmarks[0]);
    if (tipToWrist < pipToWrist * curlMargin) curled += 1;
  }

  // 親指は握り込み方向の個人差が大きいため、手のひら中心に近いかだけを緩めに見る。
  const thumbFolded = distance(landmarks[4], landmarks[9]) < scale * mix(1.28, 1.62, sensitivity);
  return {
    curled,
    thumbFolded,
    isFist: curled >= 3 || (curled >= 2 && thumbFolded)
  };
}

function isFist(landmarks) {
  return getFistState(landmarks).isFist;
}

function readHand(landmarks, handedness) {
  const wrist = toScreenPoint(landmarks[0]);
  const palm = averagePoint(landmarks, PALM_POINTS);
  const fingertipCenter = averagePoint(landmarks, [8, 12, 16, 20]);
  const fistState = getFistState(landmarks);

  return {
    landmarks,
    label: handedness?.categoryName || "Hand",
    score: handedness?.score || 0,
    wrist,
    palm,
    fingertipCenter,
    curled: fistState.curled,
    thumbFolded: fistState.thumbFolded,
    fist: fistState.isFist
  };
}

function getTwoHandPose(hands) {
  if (hands.length < 2) return null;

  const [a, b] = hands;
  const center = {
    x: (a.palm.x + b.palm.x) / 2,
    y: (a.palm.y + b.palm.y) / 2
  };
  const wristCenter = {
    x: (a.wrist.x + b.wrist.x) / 2,
    y: (a.wrist.y + b.wrist.y) / 2
  };
  const tipCenter = {
    x: (a.fingertipCenter.x + b.fingertipCenter.x) / 2,
    y: (a.fingertipCenter.y + b.fingertipCenter.y) / 2
  };
  const rawHandle = {
    x: b.palm.x - a.palm.x,
    y: b.palm.y - a.palm.y
  };
  const handleLength = Math.hypot(rawHandle.x, rawHandle.y);
  let handleDirection = { x: 0, y: -1 };

  if (handleLength > 10) {
    // 両手で柄を持っている想定なので、両手を結ぶ線をセーバーの主軸として強く反映する。
    // 上下差がある時は下の手から上の手へ、横並びに近い時は両手の横方向へ傾ける。
    if (Math.abs(rawHandle.y) > Math.abs(rawHandle.x) * 0.45) {
      handleDirection =
        rawHandle.y < 0
          ? normalize(rawHandle)
          : normalize({ x: -rawHandle.x, y: -rawHandle.y });
    } else {
      handleDirection = normalize(rawHandle);
    }
  }

  // 指先方向が取れない時は画面上方向に倒して、セーバーが自然に立つようにする。
  const fingerDirection = normalize({
    x: (tipCenter.x - wristCenter.x) * 0.65,
    y: (tipCenter.y - wristCenter.y) * 0.65 - 0.35 * window.innerHeight
  });
  const direction = normalize({
    x: handleDirection.x * 0.78 + fingerDirection.x * 0.22,
    y: handleDirection.y * 0.78 + fingerDirection.y * 0.22
  });

  const handDistance = distance(a.palm, b.palm);
  const closeThreshold = Math.min(window.innerWidth, window.innerHeight) * mix(0.18, 0.34, Number(sensitivityRange.value) / 100);

  return {
    center,
    direction,
    handDistance,
    closeThreshold,
    handsClose: handDistance < closeThreshold,
    bothFists: a.fist && b.fist
  };
}

function updateDiagnostics(hands, pose, now) {
  const handCount = hands.length;
  const fistCount = hands.filter((hand) => hand.fist).length;
  const averageScore =
    handCount > 0 ? hands.reduce((total, hand) => total + hand.score, 0) / handCount : 0;
  const holdMs = fistHoldStartedAt ? clamp(now - fistHoldStartedAt, 0, ACTIVATION_HOLD_MS) : 0;
  const holdPercent = Math.round((holdMs / ACTIVATION_HOLD_MS) * 100);
  const saberLabel = saberState === "igniting" ? "IGNITE" : saberState === "on" ? "ON" : "OFF";
  const fistDetail =
    handCount === 0
      ? "--"
      : hands
          .slice(0, 2)
          .map((hand) => `${hand.fist ? "OK" : "NG"}:${hand.curled}${hand.thumbFolded ? "T" : ""}`)
          .join(" ");

  setJudgeState("hands", `${handCount} / 2`, handCount >= 2 ? "ok" : handCount > 0 ? "active" : "bad");
  setJudgeState("fists", fistDetail, pose?.bothFists ? "ok" : handCount >= 2 ? "bad" : "wait");
  setJudgeState(
    "close",
    pose ? `${Math.round(pose.handDistance)} / ${Math.round(pose.closeThreshold)}` : "--",
    pose?.handsClose ? "ok" : handCount >= 2 ? "bad" : "wait"
  );
  setJudgeState("hold", `${holdPercent}%`, holdPercent >= 100 ? "ok" : holdPercent > 0 ? "active" : "wait");
  setJudgeState("saber", saberLabel, saberState === "on" ? "ok" : saberState === "igniting" ? "active" : "wait");
  setJudgeState(
    "score",
    handCount > 0 ? `${Math.round(averageScore * 100)}%` : "--",
    averageScore >= 0.55 ? "ok" : handCount > 0 ? "active" : "wait"
  );
}

function smoothPose(pose) {
  if (!smoothedPose) {
    smoothedPose = pose;
    return pose;
  }

  const amount = 0.28;
  smoothedPose = {
    ...pose,
    center: {
      x: mix(smoothedPose.center.x, pose.center.x, amount),
      y: mix(smoothedPose.center.y, pose.center.y, amount)
    },
    direction: normalize({
      x: mix(smoothedPose.direction.x, pose.direction.x, amount),
      y: mix(smoothedPose.direction.y, pose.direction.y, amount)
    })
  };
  return smoothedPose;
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function playIgnitionSound() {
  const audio = ensureAudio();
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();

  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(230, now + 0.42);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(420, now);
  filter.frequency.linearRampToValueAtTime(1400, now + 0.45);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

  osc.connect(filter).connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.58);
}

function playSwingSound() {
  const audio = ensureAudio();
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(170, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.22);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(260, now);
  filter.Q.setValueAtTime(3.5, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

  osc.connect(filter).connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

function activateSaber(now) {
  if (saberState === "on" || saberState === "igniting") return;
  saberState = "igniting";
  saberStartedAt = now;
  playIgnitionSound();
}

function turnOffSaber() {
  saberState = "off";
  fistHoldStartedAt = 0;
  handsApartStartedAt = 0;
  smoothedPose = null;
  previousPose = null;
  updateDiagnostics([], null, performance.now());
  updateStatus(isRunning ? "手認識中" : "待機中");
}

function detectSwing(pose, now) {
  if (!previousPose) {
    previousPose = { pose, at: now };
    return;
  }

  const elapsed = Math.max(16, now - previousPose.at);
  const speed = distance(pose.center, previousPose.pose.center) / elapsed;
  previousPose = { pose, at: now };

  const threshold = mix(0.75, 0.35, Number(sensitivityRange.value) / 100);
  if (saberState === "on" && speed > threshold && now - lastSwingAt > 520) {
    lastSwingAt = now;
    swingBadge.classList.add("is-visible");
    playSwingSound();
    window.setTimeout(() => swingBadge.classList.remove("is-visible"), 260);
  }
}

function drawLandmarks(hands) {
  if (!debugEnabled) return;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.strokeStyle = "rgba(47,140,255,0.64)";
  ctx.lineWidth = 1;

  hands.forEach((hand) => {
    hand.landmarks.forEach((landmark) => {
      const point = toScreenPoint(landmark);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  ctx.restore();
}

function drawSaber(pose, now) {
  if (saberState === "off" || !pose) return;

  const color = COLORS[selectedColor];
  const ignitionProgress = saberState === "igniting" ? clamp((now - saberStartedAt) / 760, 0, 1) : 1;
  if (ignitionProgress >= 1 && saberState === "igniting") saberState = "on";

  const maxLength = Math.min(window.innerHeight * 0.72, window.innerWidth * 1.15) * (Number(lengthRange.value) / 100);
  const bladeLength = maxLength * ignitionProgress;
  const hiltLength = 54;
  const base = pose.center;
  const dir = pose.direction;
  const end = {
    x: base.x + dir.x * bladeLength,
    y: base.y + dir.y * bladeLength
  };
  const rear = {
    x: base.x - dir.x * hiltLength,
    y: base.y - dir.y * hiltLength
  };
  const bladeWidth = clamp(window.innerWidth * 0.028, 12, 22);

  ctx.save();
  ctx.lineCap = "round";

  // 外側から順番に太い半透明線を重ね、軽いCanvas 2Dだけで発光感を作る。
  [4.2, 2.8, 1.8].forEach((scale, index) => {
    ctx.strokeStyle = color.glow;
    ctx.globalAlpha = [0.16, 0.22, 0.34][index];
    ctx.lineWidth = bladeWidth * scale;
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = 18 * scale;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });

  ctx.globalAlpha = 0.95;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = color.core;
  ctx.lineWidth = bladeWidth * 0.58;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(25, 27, 31, 0.95)";
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(rear.x, rear.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(225, 232, 242, 0.82)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(base.x - dir.x * 8, base.y - dir.y * 8);
  ctx.lineTo(rear.x + dir.x * 8, rear.y + dir.y * 8);
  ctx.stroke();

  ctx.restore();
}

function updateState(pose, now) {
  if (!pose) {
    if (saberState !== "off" && now - lastSeenHandsAt > 1200) turnOffSaber();
    updateStatus(saberState === "off" ? "手を認識していません" : "手を見失いました");
    return null;
  }

  lastSeenHandsAt = now;

  if (pose.bothFists && pose.handsClose) {
    if (!fistHoldStartedAt) fistHoldStartedAt = now;
    handsApartStartedAt = 0;
    if (now - fistHoldStartedAt > ACTIVATION_HOLD_MS) activateSaber(now);
  } else {
    fistHoldStartedAt = 0;
    if (saberState !== "off" && !pose.handsClose) {
      if (!handsApartStartedAt) handsApartStartedAt = now;
      if (now - handsApartStartedAt > 1500) turnOffSaber();
    }
  }

  if (saberState === "off") {
    updateStatus(pose.bothFists && pose.handsClose ? "両手グー検出" : "手認識中");
  } else if (saberState === "igniting") {
    updateStatus("セーバー起動中");
  } else {
    updateStatus("セーバー起動中");
  }

  return smoothPose(pose);
}

async function loadHandLandmarker() {
  if (handLandmarker) return handLandmarker;

  updateStatus("MediaPipe読込中");
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const options = {
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5
  };

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: "GPU"
      }
    });
  } catch (error) {
    // iOSの環境や省電力状態でGPU delegateが失敗する場合はCPUへ落として起動を優先する。
    console.warn("GPU delegate failed. Falling back to CPU.", error);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: "CPU"
      }
    });
  }

  return handLandmarker;
}

async function startCamera() {
  startButton.disabled = true;
  try {
    ensureAudio();
    await loadHandLandmarker();

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    isRunning = true;
    lastSeenHandsAt = performance.now();
    requestAnimationFrame(frame);
    updateStatus("手認識中");
  } catch (error) {
    console.error(error);
    updateStatus("カメラ起動に失敗");
    startButton.disabled = false;
  }
}

function frame(now) {
  if (!isRunning) return;
  resizeCanvas();
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, now);
    const hands = (results.landmarks || []).map((landmarks, index) =>
      readHand(landmarks, results.handedness?.[index]?.[0])
    );
    const pose = getTwoHandPose(hands);
    const activePose = updateState(pose, now);
    updateDiagnostics(hands, pose, now);

    drawSaber(activePose, now);
    drawLandmarks(hands);
    if (activePose) detectSwing(activePose, now);
  }

  requestAnimationFrame(frame);
}

startButton.addEventListener("click", startCamera);
offButton.addEventListener("click", turnOffSaber);

debugButton.addEventListener("click", () => {
  debugEnabled = !debugEnabled;
  debugButton.textContent = debugEnabled ? "DEBUG ON" : "DEBUG OFF";
});

colorButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedColor = button.dataset.color;
    document.documentElement.style.setProperty("--accent", COLORS[selectedColor].glow);
    colorButtons.forEach((item) => item.classList.toggle("is-active", item === button));
  });
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pagehide", () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

resizeCanvas();
updateDiagnostics([], null, performance.now());
