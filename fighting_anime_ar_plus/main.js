const MEDIAPIPE_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const startButton = document.querySelector("#startButton");
const cameraButton = document.querySelector("#cameraButton");
const panelButton = document.querySelector("#panelButton");
const hudBody = document.querySelector("#hudBody");
const statusText = document.querySelector("#statusText");

const values = {
  poseCount: document.querySelector("#poseCountValue"),
  p1State: document.querySelector("#p1StateValue"),
  p2State: document.querySelector("#p2StateValue"),
  p1Hands: document.querySelector("#p1HandsValue"),
  p2Hands: document.querySelector("#p2HandsValue"),
  camera: document.querySelector("#cameraValue")
};

const hpMeters = {
  p1: document.querySelector("#p1Hp"),
  p2: document.querySelector("#p2Hp")
};

const controls = {
  effectAmount: document.querySelector("#effectAmount"),
  auraPower: document.querySelector("#auraPower"),
  ballSpeed: document.querySelector("#ballSpeed"),
  sensitivity: document.querySelector("#sensitivity"),
  shakePower: document.querySelector("#shakePower")
};

const POSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24
};

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

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];

let mediaPipeTasks;
let handLandmarker;
let poseLandmarker;
let stream;
let isRunning = false;
let frameRequest = 0;
let facingMode = "user";
let lastVideoTime = -1;
let lastFrameAt = performance.now();
let shakeUntil = 0;
let shakeMagnitude = 0;
let particles = [];
let projectiles = [];
let shockwaves = [];
let poseCount = 0;

const players = [
  createPlayer("p1", "P1", "#55ddff", "#ffffff"),
  createPlayer("p2", "P2", "#ff6148", "#ffd069")
];

function createPlayer(id, label, color, altColor) {
  return {
    id,
    label,
    color,
    altColor,
    hp: 100,
    pose: null,
    hands: emptyHands(),
    previousHands: { left: "unknown", right: "unknown" },
    previousPose: null,
    chargeFrames: 0,
    barrierFrames: 0,
    mode: "lost",
    cooldownUntil: { left: 0, right: 0 },
    nextBarrierWaveAt: 0,
    hitFlashUntil: 0
  };
}

function emptyHands() {
  return {
    left: { state: "unknown", landmarks: null, wrist: null },
    right: { state: "unknown", landmarks: null, wrist: null }
  };
}

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

function average(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function controlValue(name) {
  return Number(controls[name].value) / 100;
}

function isFrontCamera() {
  return facingMode === "user";
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
    x: (isFrontCamera() ? 1 - landmark.x : landmark.x) * window.innerWidth,
    y: landmark.y * window.innerHeight,
    z: landmark.z ?? 0,
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

function readPoseData(results) {
  poseCount = results.landmarks?.length || 0;
  return (results.landmarks || [])
    .map((landmarks) => {
      const points = landmarks.map(toScreenPoint);
      const pose = {};
      Object.entries(POSE).forEach(([name, index]) => {
        pose[name] = points[index];
      });
      pose.points = points;
      pose.center = average([pose.leftShoulder, pose.rightShoulder, pose.leftHip, pose.rightHip]);
      pose.chest = average([pose.leftShoulder, pose.rightShoulder]);
      pose.bodyWidth = Math.max(distance(pose.leftShoulder, pose.rightShoulder), 70);
      pose.leftAngle = angleDegrees(pose.leftShoulder, pose.leftElbow, pose.leftWrist);
      pose.rightAngle = angleDegrees(pose.rightShoulder, pose.rightElbow, pose.rightWrist);
      pose.visible =
        pose.leftShoulder.visibility > 0.35 &&
        pose.rightShoulder.visibility > 0.35 &&
        pose.leftHip.visibility > 0.25 &&
        pose.rightHip.visibility > 0.25;
      return pose;
    })
    .filter((pose) => pose.visible)
    .sort((a, b) => a.center.x - b.center.x)
    .slice(0, 2);
}

function readHandCandidates(results) {
  return (results.landmarks || []).map((landmarks) => {
    const points = landmarks.map(toScreenPoint);
    return {
      landmarks: points,
      wrist: points[0],
      state: classifyHand(points)
    };
  });
}

function assignHandsToPlayers(handCandidates) {
  const candidates = [...handCandidates];
  players.forEach((player) => {
    player.hands = emptyHands();
    if (!player.pose) return;

    for (const side of ["left", "right"]) {
      const wrist = player.pose[`${side}Wrist`];
      let bestIndex = -1;
      let bestDistance = Infinity;
      candidates.forEach((hand, index) => {
        const d = distance(hand.wrist, wrist);
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0 && bestDistance < Math.min(window.innerWidth, window.innerHeight) * 0.28) {
        player.hands[side] = candidates.splice(bestIndex, 1)[0];
      }
    }
  });
}

function isArmDown(pose, side) {
  const wrist = pose[`${side}Wrist`];
  const elbow = pose[`${side}Elbow`];
  const shoulder = pose[`${side}Shoulder`];
  const slack = 10 + (1 - controlValue("sensitivity")) * 28;
  return wrist.y > elbow.y - slack && wrist.y > shoulder.y + slack;
}

function isBarrierPose(pose) {
  const sensitivity = controlValue("sensitivity");
  const wristsNear = distance(pose.leftWrist, pose.rightWrist) < pose.bodyWidth * (1.35 + (1 - sensitivity) * 0.5);
  const nearChest =
    Math.abs(pose.leftWrist.x - pose.chest.x) < pose.bodyWidth * 1.35 &&
    Math.abs(pose.rightWrist.x - pose.chest.x) < pose.bodyWidth * 1.35 &&
    Math.abs(pose.leftWrist.y - pose.chest.y) < pose.bodyWidth * 1.7 &&
    Math.abs(pose.rightWrist.y - pose.chest.y) < pose.bodyWidth * 1.7;
  const crossed = pose.leftWrist.x > pose.rightWrist.x + pose.bodyWidth * 0.04;
  return wristsNear && nearChest && (crossed || controlValue("sensitivity") < 0.55);
}

function setShake(amount, now, duration = 240) {
  shakeMagnitude = Math.max(shakeMagnitude, amount * controlValue("shakePower"));
  shakeUntil = Math.max(shakeUntil, now + duration);
}

function opponentOf(player) {
  return players.find((candidate) => candidate !== player);
}

function spawnProjectile(player, side, now, kind = "blast") {
  if (!player.pose) return;
  const target = opponentOf(player);
  const wrist = player.pose[`${side}Wrist`];
  const shoulder = player.pose[`${side}Shoulder`];
  const fallbackDirection = normalize({ x: wrist.x - shoulder.x, y: wrist.y - shoulder.y });
  const targetPoint = target?.pose?.chest;
  const direction = targetPoint ? normalize({ x: targetPoint.x - wrist.x, y: targetPoint.y - wrist.y }) : fallbackDirection;
  const speed = (kind === "punch" ? 11 : 8) * controlValue("ballSpeed");
  const radius = (kind === "punch" ? 22 : 16) + 8 * controlValue("effectAmount");

  projectiles.push({
    ownerId: player.id,
    kind,
    color: player.color,
    x: wrist.x,
    y: wrist.y,
    vx: direction.x * speed,
    vy: direction.y * speed,
    radius,
    damage: kind === "punch" ? 14 : 10,
    age: 0,
    life: 1500,
    trail: []
  });
  shockwaves.push({ x: wrist.x, y: wrist.y, age: 0, life: 360, maxRadius: radius * 4, color: player.color });
  setShake(kind === "punch" ? 12 : 8, now, 210);
}

function detectPunch(player, side, now) {
  if (!player.pose || !player.previousPose || player.hands[side].state !== "fist") return;
  if (now < player.cooldownUntil[side]) return;

  const wrist = player.pose[`${side}Wrist`];
  const elbow = player.pose[`${side}Elbow`];
  const shoulder = player.pose[`${side}Shoulder`];
  const previousWrist = player.previousPose[`${side}Wrist`];
  const previousShoulder = player.previousPose[`${side}Shoulder`];
  const reachDelta = distance(shoulder, wrist) - distance(previousShoulder, previousWrist);
  const speed = distance(wrist, previousWrist);
  const armReady = angleDegrees(shoulder, elbow, wrist) > 118;
  const thrust = reachDelta > player.pose.bodyWidth * 0.11 || speed > player.pose.bodyWidth * 0.18;

  if (armReady && thrust) {
    spawnProjectile(player, side, now, "punch");
    player.cooldownUntil[side] = now + 680;
  }
}

function updatePlayerTechnique(player, now) {
  if (!player.pose) {
    player.mode = "lost";
    player.chargeFrames = 0;
    player.barrierFrames = 0;
    player.previousHands = { left: "unknown", right: "unknown" };
    return;
  }

  const leftHand = player.hands.left.state;
  const rightHand = player.hands.right.state;
  const charge =
    isArmDown(player.pose, "left") &&
    isArmDown(player.pose, "right") &&
    leftHand === "fist" &&
    rightHand === "fist";
  const barrier = isBarrierPose(player.pose);

  player.chargeFrames = charge ? player.chargeFrames + 1 : 0;
  player.barrierFrames = barrier ? player.barrierFrames + 1 : 0;

  for (const side of ["left", "right"]) {
    if (player.previousHands[side] === "fist" && player.hands[side].state === "open") {
      spawnProjectile(player, side, now, "blast");
    }
    detectPunch(player, side, now);
  }

  if (player.barrierFrames >= 3) {
    player.mode = "barrier";
  } else if (player.chargeFrames >= 4) {
    player.mode = "charge";
    setShake(1.7, now, 120);
    spawnChargeParticles(player);
  } else {
    player.mode = "ready";
  }

  player.previousHands = { left: leftHand, right: rightHand };
}

function spawnChargeParticles(player) {
  const pose = player.pose;
  const count = Math.ceil(2 + controlValue("effectAmount") * 4);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = pose.bodyWidth * (0.7 + Math.random() * 1.1);
    particles.push({
      x: pose.center.x + Math.cos(angle) * radius,
      y: pose.center.y + Math.sin(angle) * radius * 1.25,
      target: pose.center,
      color: Math.random() > 0.28 ? player.color : "#ffffff",
      size: 2 + Math.random() * 4,
      age: 0,
      life: 440 + Math.random() * 420
    });
  }
}

function updateHits(now) {
  projectiles = projectiles.filter((projectile) => {
    const target = players.find((player) => player.id !== projectile.ownerId);
    if (!target?.pose) return true;

    const hitRadius = target.pose.bodyWidth * 0.8;
    if (distance(projectile, target.pose.chest) > hitRadius) return true;

    if (target.mode === "barrier") {
      projectile.ownerId = target.id;
      projectile.vx *= -0.85;
      projectile.vy *= -0.85;
      projectile.age = 0;
      projectile.color = target.color;
      shockwaves.push({ x: projectile.x, y: projectile.y, age: 0, life: 420, maxRadius: target.pose.bodyWidth * 1.2, color: target.color });
      setShake(10, now, 220);
      return true;
    }

    target.hp = clamp(target.hp - projectile.damage, 0, 100);
    target.hitFlashUntil = now + 260;
    shockwaves.push({ x: projectile.x, y: projectile.y, age: 0, life: 460, maxRadius: target.pose.bodyWidth * 1.35, color: projectile.color });
    setShake(18, now, 260);
    if (target.hp <= 0) {
      target.hp = 100;
      opponentOf(target).hp = 100;
      statusText.textContent = `${opponentOf(target).label} win`;
    }
    return false;
  });
}

function drawLine(a, b, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawRecognition(player, now) {
  if (!player.pose) return;
  const pose = player.pose;
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalAlpha = now < player.hitFlashUntil ? 1 : 0.82;
  POSE_CONNECTIONS.forEach(([a, b]) => drawLine(pose.points[a], pose.points[b], player.color, 3));
  [POSE.leftShoulder, POSE.rightShoulder, POSE.leftElbow, POSE.rightElbow, POSE.leftWrist, POSE.rightWrist, POSE.leftHip, POSE.rightHip].forEach((index) => {
    const point = pose.points[index];
    ctx.fillStyle = player.altColor;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  for (const hand of [player.hands.left, player.hands.right]) {
    if (!hand.landmarks) continue;
    HAND_CONNECTIONS.forEach(([a, b]) => drawLine(hand.landmarks[a], hand.landmarks[b], "rgba(255,255,255,0.58)", 2));
    hand.landmarks.forEach((point) => {
      ctx.fillStyle = hand.state === "fist" ? "#ff6148" : hand.state === "open" ? "#7df1d7" : "#ffffff";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

function drawAura(player, now) {
  if (player.mode !== "charge" || !player.pose) return;
  const pose = player.pose;
  const intensity = clamp(player.chargeFrames / 24, 0.3, 1.7) * controlValue("auraPower");
  const radius = pose.bodyWidth * (1.2 + intensity * 0.32);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i += 1) {
    const pulse = Math.sin(now * 0.006 + i) * 0.04;
    const r = radius * (0.8 + i * 0.07 + pulse);
    const gradient = ctx.createRadialGradient(pose.center.x, pose.center.y, r * 0.12, pose.center.x, pose.center.y, r);
    gradient.addColorStop(0, "rgba(255,255,255,0.08)");
    gradient.addColorStop(0.45, hexToRgba(player.color, 0.12 * intensity));
    gradient.addColorStop(1, hexToRgba(player.color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(pose.center.x, pose.center.y + pose.bodyWidth * 0.12, r, r * 1.38, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBarrier(player, now) {
  if (player.mode !== "barrier" || !player.pose) return;
  const center = average([player.pose.leftWrist, player.pose.rightWrist]);
  const radius = player.pose.bodyWidth * 0.9;

  if (now >= player.nextBarrierWaveAt) {
    shockwaves.push({ x: center.x, y: center.y, age: 0, life: 440, maxRadius: radius * 1.25, color: player.color, weak: true });
    player.nextBarrierWaveAt = now + 180;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const gradient = ctx.createRadialGradient(center.x, center.y, radius * 0.1, center.x, center.y, radius);
  gradient.addColorStop(0, "rgba(255,255,255,0.18)");
  gradient.addColorStop(0.55, hexToRgba(player.color, 0.18));
  gradient.addColorStop(1, hexToRgba(player.color, 0.02));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  drawHexagon(center, radius * 0.88, now * 0.0008, hexToRgba(player.color, 0.72), 3);
  drawHexagon(center, radius * 1.03, -now * 0.001, "rgba(255,255,255,0.34)", 2);
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
    particle.x += (particle.target.x - particle.x) * 0.04;
    particle.y += (particle.target.y - particle.y) * 0.04;
    particle.size *= 0.992;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
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
      ctx.fillStyle = hexToRgba(ball.color, alpha * 0.24);
      ctx.beginPath();
      ctx.arc(point.x, point.y, ball.radius * alpha * 0.75, 0, Math.PI * 2);
      ctx.fill();
    });

    const gradient = ctx.createRadialGradient(ball.x, ball.y, 2, ball.x, ball.y, ball.radius * 2.2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.26, hexToRgba(ball.color, 0.96));
    gradient.addColorStop(1, hexToRgba(ball.color, 0));
    ctx.fillStyle = gradient;
    ctx.shadowColor = ball.color;
    ctx.shadowBlur = ball.kind === "punch" ? 36 : 26;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const inBounds = ball.x > -180 && ball.x < window.innerWidth + 180 && ball.y > -180 && ball.y < window.innerHeight + 180;
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
    ctx.strokeStyle = wave.weak ? hexToRgba(wave.color, 0.18 * (1 - t)) : hexToRgba(wave.color, 0.62 * (1 - t));
    ctx.lineWidth = wave.weak ? 2 : 5;
    ctx.beginPath();
    ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return wave.age < wave.life;
  });
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function updateDebug() {
  values.poseCount.textContent = String(poseCount);
  values.p1State.textContent = players[0].mode;
  values.p2State.textContent = players[1].mode;
  values.p1Hands.textContent = `${players[0].hands.left.state}/${players[0].hands.right.state}`;
  values.p2Hands.textContent = `${players[1].hands.left.state}/${players[1].hands.right.state}`;
  values.camera.textContent = isFrontCamera() ? "front" : "back";
  hpMeters.p1.value = players[0].hp;
  hpMeters.p2.value = players[1].hp;

  if (players.every((player) => player.pose)) {
    statusText.textContent = "fight";
  } else if (players.some((player) => player.pose)) {
    statusText.textContent = "need P2";
  } else if (isRunning) {
    statusText.textContent = "searching";
  }
}

async function loadModels() {
  if (handLandmarker && poseLandmarker) return;

  statusText.textContent = "loading";
  mediaPipeTasks ||= await import(MEDIAPIPE_MODULE_URL);
  const { FilesetResolver, HandLandmarker, PoseLandmarker } = mediaPipeTasks;
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const sharedOptions = { runningMode: "VIDEO" };

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    ...sharedOptions,
    numHands: 4,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.45,
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" }
  }).catch(() =>
    HandLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      numHands: 4,
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" }
    })
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    ...sharedOptions,
    numPoses: 2,
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" }
  }).catch(() =>
    PoseLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      numPoses: 2,
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "CPU" }
    })
  );
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
}

async function startCamera() {
  isRunning = false;
  if (frameRequest) {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }
  startButton.disabled = true;
  cameraButton.disabled = true;
  try {
    await loadModels();
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    video.srcObject = stream;
    video.classList.toggle("is-front", isFrontCamera());
    await video.play();
    isRunning = true;
    lastVideoTime = -1;
    lastFrameAt = performance.now();
    startButton.textContent = "RESET";
    statusText.textContent = "searching";
    frameRequest = requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    statusText.textContent = "camera error";
  } finally {
    startButton.disabled = false;
    cameraButton.disabled = false;
  }
}

async function switchCamera() {
  facingMode = isFrontCamera() ? "environment" : "user";
  values.camera.textContent = isFrontCamera() ? "front" : "back";
  if (isRunning) {
    await startCamera();
  } else {
    video.classList.toggle("is-front", isFrontCamera());
  }
}

function resetRound() {
  players.forEach((player) => {
    player.hp = 100;
    player.previousPose = null;
    player.previousHands = { left: "unknown", right: "unknown" };
    player.cooldownUntil = { left: 0, right: 0 };
    player.nextBarrierWaveAt = 0;
  });
  particles = [];
  projectiles = [];
  shockwaves = [];
}

function frame(now) {
  if (!isRunning) return;
  resizeCanvas();
  const delta = clamp(now - lastFrameAt, 1, 48);
  lastFrameAt = now;

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.save();
  if (now < shakeUntil) {
    const fade = (shakeUntil - now) / 260;
    ctx.translate((Math.random() - 0.5) * shakeMagnitude * fade, (Math.random() - 0.5) * shakeMagnitude * fade);
  } else {
    shakeMagnitude = 0;
  }

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const poses = readPoseData(poseLandmarker.detectForVideo(video, now));
    const hands = readHandCandidates(handLandmarker.detectForVideo(video, now));

    players.forEach((player, index) => {
      player.previousPose = player.pose;
      player.pose = poses[index] || null;
    });

    assignHandsToPlayers(hands);
    players.forEach((player) => updatePlayerTechnique(player, now));
    updateHits(now);
  }

  players.forEach((player) => drawAura(player, now));
  players.forEach((player) => drawBarrier(player, now));
  updateParticles(delta);
  updateProjectiles(delta);
  updateShockwaves(delta);
  players.forEach((player) => drawRecognition(player, now));
  ctx.restore();

  updateDebug();
  frameRequest = requestAnimationFrame(frame);
}

startButton.addEventListener("click", () => {
  resetRound();
  startCamera();
});

cameraButton.addEventListener("click", switchCamera);

panelButton.addEventListener("click", () => {
  const willOpen = hudBody.hidden;
  hudBody.hidden = !willOpen;
  panelButton.classList.toggle("is-active", willOpen);
  panelButton.setAttribute("aria-expanded", String(willOpen));
  panelButton.textContent = willOpen ? "HIDE" : "DEBUG";
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
window.addEventListener("pagehide", stopCamera);

video.classList.add("is-front");
resizeCanvas();
