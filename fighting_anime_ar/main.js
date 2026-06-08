import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const startButton = document.querySelector("#startButton");
const panelButton = document.querySelector("#panelButton");
const hudBody = document.querySelector("#hudBody");
const statusText = document.querySelector("#statusText");

const values = {
  mode: document.querySelector("#modeValue"),
  leftHand: document.querySelector("#leftHandValue"),
  rightHand: document.querySelector("#rightHandValue"),
  leftAngle: document.querySelector("#leftAngleValue"),
  rightAngle: document.querySelector("#rightAngleValue"),
  barrier: document.querySelector("#barrierValue")
};

const controls = {
  effectAmount: document.querySelector("#effectAmount"),
  auraPower: document.querySelector("#auraPower"),
  ballSpeed: document.querySelector("#ballSpeed"),
  sensitivity: document.querySelector("#sensitivity"),
  shakePower: document.querySelector("#shakePower")
};

const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const POSE_CONNECTIONS = [
  [POSE.leftShoulder, POSE.rightShoulder],
  [POSE.leftShoulder, POSE.leftElbow],
  [POSE.leftElbow, POSE.leftWrist],
  [POSE.rightShoulder, POSE.rightElbow],
  [POSE.rightElbow, POSE.rightWrist],
  [POSE.leftShoulder, POSE.leftHip],
  [POSE.rightShoulder, POSE.rightHip],
  [POSE.leftHip, POSE.rightHip]
];

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];
const STABLE_FRAMES = 4;

let handLandmarker;
let poseLandmarker;
let stream;
let isRunning = false;
let lastVideoTime = -1;
let mode = "idle";
let chargeFrames = 0;
let barrierFrames = 0;
let chargeStartedAt = 0;
let shakeUntil = 0;
let shakeMagnitude = 0;
let particles = [];
let projectiles = [];
let shockwaves = [];
let previousHands = { left: "unknown", right: "unknown" };
let lastPose = null;
let lastHands = { left: { state: "unknown", landmarks: null }, right: { state: "unknown", landmarks: null } };
let lastTechnique = { barrier: false };

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

function controlValue(name) {
  return Number(controls[name].value) / 100;
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

function toScreenPoint(landmark) {
  return {
    x: (1 - landmark.x) * window.innerWidth,
    y: landmark.y * window.innerHeight,
    visibility: landmark.visibility ?? 1
  };
}

function angleDegrees(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const len = Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y) || 1;
  return Math.acos(clamp(dot / len, -1, 1)) * (180 / Math.PI);
}

function average(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function classifyHand(landmarks) {
  const sensitivity = controlValue("sensitivity");
  const fistMargin = 1 + sensitivity * 0.25;
  const openMargin = 1.02 + sensitivity * 0.12;
  let curled = 0;
  let extended = 0;

  for (let i = 0; i < FINGER_TIPS.length; i += 1) {
    const tipToWrist = distance(landmarks[FINGER_TIPS[i]], landmarks[0]);
    const pipToWrist = distance(landmarks[FINGER_PIPS[i]], landmarks[0]);
    if (tipToWrist < pipToWrist * fistMargin) curled += 1;
    if (tipToWrist > pipToWrist * openMargin) extended += 1;
  }

  if (curled >= 4) return "fist";
  if (extended >= 4) return "open";
  if (curled >= 3 && sensitivity > 0.55) return "fist";
  if (extended >= 3 && sensitivity > 0.7) return "open";
  return "unknown";
}

function readHands(results, poseData) {
  const hands = (results.landmarks || []).map((landmarks) => {
    const points = landmarks.map(toScreenPoint);
    return {
      landmarks: points,
      wrist: points[0],
      state: classifyHand(points)
    };
  });

  const assigned = {
    left: { state: "unknown", landmarks: null },
    right: { state: "unknown", landmarks: null }
  };

  if (!poseData) return assigned;

  const candidates = [...hands];
  for (const side of ["left", "right"]) {
    const wrist = poseData[`${side}Wrist`];
    let bestIndex = -1;
    let bestDistance = Infinity;
    candidates.forEach((hand, index) => {
      const d = distance(hand.wrist, wrist);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestDistance < Math.min(window.innerWidth, window.innerHeight) * 0.32) {
      assigned[side] = candidates.splice(bestIndex, 1)[0];
    }
  }

  return assigned;
}

function readPose(results) {
  const landmarks = results.landmarks?.[0];
  if (!landmarks) return null;

  const p = {};
  Object.entries(POSE).forEach(([name, index]) => {
    p[name] = toScreenPoint(landmarks[index]);
  });

  p.center = average([p.leftShoulder, p.rightShoulder, p.leftHip, p.rightHip]);
  p.chest = average([p.leftShoulder, p.rightShoulder]);
  p.bodyWidth = Math.max(distance(p.leftShoulder, p.rightShoulder), 80);
  p.leftAngle = angleDegrees(p.leftShoulder, p.leftElbow, p.leftWrist);
  p.rightAngle = angleDegrees(p.rightShoulder, p.rightElbow, p.rightWrist);
  return p;
}

function isArmDown(pose, side) {
  const wrist = pose[`${side}Wrist`];
  const elbow = pose[`${side}Elbow`];
  const shoulder = pose[`${side}Shoulder`];
  const slack = 10 + (1 - controlValue("sensitivity")) * 28;
  return wrist.y > elbow.y - slack && wrist.y > shoulder.y + slack;
}

function isArmExtended(pose, side) {
  const threshold = 150 + controlValue("sensitivity") * 16;
  return pose[`${side}Angle`] >= threshold;
}

function isBarrierPose(pose) {
  const sensitivity = controlValue("sensitivity");
  const near = distance(pose.leftWrist, pose.rightWrist) < pose.bodyWidth * (1.45 + (1 - sensitivity) * 0.5);
  const crossed =
    pose.leftWrist.x > pose.rightWrist.x + pose.bodyWidth * (0.02 + sensitivity * 0.04);
  const nearCenter =
    Math.abs(pose.leftWrist.x - pose.chest.x) < pose.bodyWidth * 1.25 &&
    Math.abs(pose.rightWrist.x - pose.chest.x) < pose.bodyWidth * 1.25;
  const inChestBand =
    Math.abs(pose.leftWrist.y - pose.chest.y) < pose.bodyWidth * 1.65 &&
    Math.abs(pose.rightWrist.y - pose.chest.y) < pose.bodyWidth * 1.65;
  return crossed && near && nearCenter && inChestBand;
}

function setShake(amount, now, duration = 260) {
  shakeMagnitude = Math.max(shakeMagnitude, amount * controlValue("shakePower"));
  shakeUntil = Math.max(shakeUntil, now + duration);
}

function spawnChargeParticles(pose, intensity) {
  const count = Math.ceil(2 + intensity * controlValue("effectAmount") * 5);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = pose.bodyWidth * (0.9 + Math.random() * 1.2);
    particles.push({
      x: pose.center.x + Math.cos(angle) * radius,
      y: pose.center.y + Math.sin(angle) * radius * 1.35,
      vx: 0,
      vy: 0,
      target: pose.center,
      life: 520 + Math.random() * 460,
      age: 0,
      size: 2 + Math.random() * 4,
      color: Math.random() > 0.35 ? "#9fefff" : "#ffffff"
    });
  }
}

function spawnProjectile(pose, side, now) {
  const wrist = pose[`${side}Wrist`];
  const shoulder = pose[`${side}Shoulder`];
  const direction = normalize({ x: wrist.x - shoulder.x, y: wrist.y - shoulder.y });
  const speed = 8 * controlValue("ballSpeed");
  projectiles.push({
    x: wrist.x,
    y: wrist.y,
    vx: direction.x * speed,
    vy: direction.y * speed,
    age: 0,
    life: 1500,
    radius: 16 + 8 * controlValue("effectAmount"),
    trail: []
  });
  shockwaves.push({ x: wrist.x, y: wrist.y, age: 0, life: 360, maxRadius: 90 });
  setShake(10, now, 220);
}

function updateTechniqueState(pose, hands, now) {
  const leftHand = hands.left.state;
  const rightHand = hands.right.state;
  const charge =
    pose &&
    isArmDown(pose, "left") &&
    isArmDown(pose, "right") &&
    leftHand === "fist" &&
    rightHand === "fist";
  const barrier = pose && isBarrierPose(pose);

  chargeFrames = charge ? chargeFrames + 1 : 0;
  barrierFrames = barrier ? barrierFrames + 1 : 0;

  if (pose && isArmExtended(pose, "left") && previousHands.left === "fist" && leftHand === "open") {
    spawnProjectile(pose, "left", now);
  }
  if (pose && isArmExtended(pose, "right") && previousHands.right === "fist" && rightHand === "open") {
    spawnProjectile(pose, "right", now);
  }

  if (barrierFrames >= STABLE_FRAMES) {
    mode = "barrier";
  } else if (chargeFrames >= STABLE_FRAMES) {
    if (!chargeStartedAt) chargeStartedAt = now;
    mode = "charge";
    setShake(2.4, now, 120);
  } else if (projectiles.length > 0) {
    mode = "fire";
    chargeStartedAt = 0;
  } else {
    mode = "idle";
    chargeStartedAt = 0;
  }

  previousHands = { left: leftHand, right: rightHand };
  return { charge, barrier };
}

function drawLine(a, b, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawRecognition(pose, hands) {
  ctx.save();
  ctx.lineCap = "round";
  if (pose) {
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    POSE_CONNECTIONS.forEach(([a, b]) => drawLine(toScreenPointByPoseIndex(pose, a), toScreenPointByPoseIndex(pose, b), "rgba(255,255,255,0.55)", 3));
    Object.values(POSE).forEach((index) => {
      const point = toScreenPointByPoseIndex(pose, index);
      ctx.fillStyle = "rgba(83,214,255,0.95)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  for (const hand of [hands.left, hands.right]) {
    if (!hand.landmarks) continue;
    HAND_CONNECTIONS.forEach(([a, b]) => drawLine(hand.landmarks[a], hand.landmarks[b], "rgba(255,208,105,0.58)", 2));
    hand.landmarks.forEach((point) => {
      ctx.fillStyle = hand.state === "fist" ? "#ff6842" : hand.state === "open" ? "#7df1d7" : "#ffffff";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

function toScreenPointByPoseIndex(pose, index) {
  const entry = Object.entries(POSE).find(([, value]) => value === index);
  return entry ? pose[entry[0]] : { x: 0, y: 0 };
}

function drawAura(pose, now) {
  if (mode !== "charge" || !pose) return;
  const chargeSeconds = chargeStartedAt ? (now - chargeStartedAt) / 1000 : 0;
  const intensity = clamp(0.35 + chargeSeconds * 0.22, 0.35, 1.8) * controlValue("auraPower");
  const amount = controlValue("effectAmount");
  const baseRadius = pose.bodyWidth * (1.25 + intensity * 0.28);

  spawnChargeParticles(pose, intensity);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i += 1) {
    const phase = now * 0.004 + i;
    const radius = baseRadius * (0.72 + i * 0.07 + Math.sin(phase) * 0.035);
    const yScale = 1.35 + Math.sin(phase * 1.7) * 0.08;
    const alpha = 0.045 * intensity * (1 - i / 12);
    const gradient = ctx.createRadialGradient(pose.center.x, pose.center.y, radius * 0.1, pose.center.x, pose.center.y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha * 0.2})`);
    gradient.addColorStop(0.45, `rgba(91,220,255,${alpha})`);
    gradient.addColorStop(1, "rgba(30,92,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(pose.center.x, pose.center.y + pose.bodyWidth * 0.2, radius, radius * yScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 18 * amount; i += 1) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
    const x = pose.center.x + (Math.random() - 0.5) * pose.bodyWidth * 2.4;
    const y = pose.center.y + pose.bodyWidth * 1.25;
    const length = pose.bodyWidth * (0.55 + Math.random() * 1.0) * intensity;
    ctx.strokeStyle = `rgba(116,232,255,${0.12 + Math.random() * 0.18})`;
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.35,
      y + Math.sin(angle) * length * 0.35,
      x + Math.cos(angle) * length,
      y - length
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawBarrier(pose, now) {
  if (mode !== "barrier" || !pose) return;
  const center = average([pose.leftWrist, pose.rightWrist]);
  const radius = pose.bodyWidth * 0.9;
  if (now % 180 < 18) {
    shockwaves.push({ x: center.x, y: center.y, age: 0, life: 520, maxRadius: radius * 1.4, weak: true });
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const gradient = ctx.createRadialGradient(center.x, center.y, radius * 0.15, center.x, center.y, radius);
  gradient.addColorStop(0, "rgba(255,255,255,0.18)");
  gradient.addColorStop(0.55, "rgba(83,214,255,0.16)");
  gradient.addColorStop(1, "rgba(83,214,255,0.03)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();

  drawHexagon(center, radius * 0.86, now * 0.0006, "rgba(130,238,255,0.62)", 3);
  drawHexagon(center, radius * 1.02, -now * 0.0009, "rgba(255,255,255,0.34)", 2);

  ctx.strokeStyle = "rgba(83,214,255,0.56)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 1.08, now * 0.004, now * 0.004 + Math.PI * 1.35);
  ctx.stroke();

  ctx.restore();
}

function drawHexagon(center, radius, rotation, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = rotation + i * (Math.PI / 3);
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function updateParticles(delta) {
  particles = particles.filter((particle) => {
    particle.age += delta;
    const t = clamp(particle.age / particle.life, 0, 1);
    particle.x += (particle.target.x - particle.x) * 0.035;
    particle.y += (particle.target.y - particle.y) * 0.035;
    particle.size *= 0.993;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = 1 - t;
    ctx.shadowColor = "#53d6ff";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return particle.age < particle.life;
  });
}

function updateProjectiles(delta) {
  projectiles = projectiles.filter((ball) => {
    ball.age += delta;
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 16) ball.trail.shift();
    ball.x += ball.vx * (delta / 16.67);
    ball.y += ball.vy * (delta / 16.67);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ball.trail.forEach((point, index) => {
      const alpha = index / ball.trail.length;
      ctx.fillStyle = `rgba(83,214,255,${alpha * 0.22})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, ball.radius * alpha * 0.75, 0, Math.PI * 2);
      ctx.fill();
    });

    const gradient = ctx.createRadialGradient(ball.x, ball.y, 2, ball.x, ball.y, ball.radius * 2.2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.24, "rgba(132,239,255,0.94)");
    gradient.addColorStop(1, "rgba(255,104,66,0)");
    ctx.fillStyle = gradient;
    ctx.shadowColor = "#53d6ff";
    ctx.shadowBlur = 28;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const inBounds = ball.x > -160 && ball.x < window.innerWidth + 160 && ball.y > -160 && ball.y < window.innerHeight + 160;
    return ball.age < ball.life && inBounds;
  });
}

function updateShockwaves(delta) {
  shockwaves = shockwaves.filter((wave) => {
    wave.age += delta;
    const t = clamp(wave.age / wave.life, 0, 1);
    const radius = wave.maxRadius * t;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = wave.weak ? `rgba(83,214,255,${0.18 * (1 - t)})` : `rgba(255,255,255,${0.62 * (1 - t)})`;
    ctx.lineWidth = wave.weak ? 2 : 5;
    ctx.beginPath();
    ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return wave.age < wave.life;
  });
}

function updateDebug(hands, pose, barrier) {
  values.mode.textContent = mode;
  values.leftHand.textContent = hands.left.state;
  values.rightHand.textContent = hands.right.state;
  values.leftAngle.textContent = pose ? `${Math.round(pose.leftAngle)}deg` : "--";
  values.rightAngle.textContent = pose ? `${Math.round(pose.rightAngle)}deg` : "--";
  values.barrier.textContent = barrier ? "true" : "false";
  statusText.textContent = mode;
}

async function loadModels() {
  if (handLandmarker && poseLandmarker) return;

  statusText.textContent = "loading";
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const sharedOptions = {
    runningMode: "VIDEO"
  };

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    ...sharedOptions,
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
      delegate: "GPU"
    }
  }).catch(() =>
    HandLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      numHands: 2,
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" }
    })
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    ...sharedOptions,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate: "GPU"
    }
  }).catch(() =>
    PoseLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      numPoses: 1,
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "CPU" }
    })
  );
}

async function startCamera() {
  startButton.disabled = true;
  try {
    await loadModels();
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
    statusText.textContent = "idle";
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    statusText.textContent = "camera error";
    startButton.disabled = false;
  }
}

let lastFrameAt = performance.now();

function frame(now) {
  if (!isRunning) return;
  resizeCanvas();
  const delta = clamp(now - lastFrameAt, 1, 48);
  lastFrameAt = now;

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const shakeActive = now < shakeUntil;
  ctx.save();
  if (shakeActive) {
    const fade = (shakeUntil - now) / 260;
    ctx.translate((Math.random() - 0.5) * shakeMagnitude * fade, (Math.random() - 0.5) * shakeMagnitude * fade);
  } else {
    shakeMagnitude = 0;
  }

  let pose = lastPose;
  let hands = lastHands;
  let technique = lastTechnique;

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    pose = readPose(poseLandmarker.detectForVideo(video, now));
    hands = readHands(handLandmarker.detectForVideo(video, now), pose);
    technique = updateTechniqueState(pose, hands, now);
    lastPose = pose;
    lastHands = hands;
    lastTechnique = technique;
  }

  drawAura(pose, now);
  drawBarrier(pose, now);
  updateParticles(delta);
  updateProjectiles(delta);
  updateShockwaves(delta);
  drawRecognition(pose, hands);
  ctx.restore();

  updateDebug(hands, pose, technique.barrier);
  requestAnimationFrame(frame);
}

startButton.addEventListener("click", startCamera);
panelButton.addEventListener("click", () => {
  const willOpen = hudBody.hidden;
  hudBody.hidden = !willOpen;
  panelButton.textContent = willOpen ? "HIDE" : "PANEL";
});
window.addEventListener("resize", resizeCanvas);
window.addEventListener("pagehide", () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

resizeCanvas();
