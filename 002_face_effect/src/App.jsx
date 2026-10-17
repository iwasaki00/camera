import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const BUILD_UPDATED_AT = "2026-05-23 21:24:00 +09:00";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const EFFECTS = [
  { value: "genius", label: "天才風" },
  { value: "white-eye", label: "白目" },
  { value: "unibrow", label: "つながり眉" },
  { value: "eye-mask", label: "目隠し" },
  { value: "heart-eyes", label: "ハート目" },
  { value: "eye-mosaic", label: "モザイク" }
];

const FORMULAS = [
  "d/dx",
  "E = mc^2",
  "int f(x)dx",
  "Sigma n=1..inf",
  "x^2 + y^2 = z^2",
  "Delta v / Delta t",
  "sin theta",
  "lim x->inf",
  "A=[1 2;3 4]",
  "det(A)",
  "grad f",
  "lambda = h / p",
  "omega = 2pi f",
  "P(A|B)",
  "e^(i pi)+1=0",
  "oint E dl = 0",
  "dx/dt = ax",
  "r = a(1-e^2)",
  "cosh x",
  "phi = (1+sqrt5)/2"
];

const LEFT_EYE_INDEXES = [33, 133, 159, 145, 160, 144, 158, 153];
const RIGHT_EYE_INDEXES = [362, 263, 386, 374, 385, 380, 387, 373];
const LEFT_IRIS_INDEXES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDEXES = [473, 474, 475, 476, 477];
const LEFT_BROW_CURVE = [70, 63, 105];
const RIGHT_BROW_CURVE = [336, 296, 334];
const BROW_BRIDGE = [107, 9, 336];
const FOREHEAD_ANCHORS = [10, 67, 109, 338, 297];
const NOSE_TIP = 1;
const LEFT_EYE_CENTER = 33;
const RIGHT_EYE_CENTER = 263;
const LEFT_BROW_INNER = 105;
const RIGHT_BROW_INNER = 334;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeUprightAngle(angle) {
  if (angle > Math.PI / 2) {
    return angle - Math.PI;
  }
  if (angle < -Math.PI / 2) {
    return angle + Math.PI;
  }
  return angle;
}

function mirrorPoint(point, width, height) {
  return {
    x: width - point.x * width,
    y: point.y * height
  };
}

function averagePoint(landmarks, indexes) {
  const total = indexes.reduce(
    (acc, index) => {
      acc.x += landmarks[index].x;
      acc.y += landmarks[index].y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: total.x / indexes.length,
    y: total.y / indexes.length
  };
}

function getFaceBounds(landmarks) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

function getEyeGeometry(landmarks, eyeIndexes, irisIndexes, width, height) {
  const points = eyeIndexes.map((index) => landmarks[index]);
  const irisCenter = averagePoint(landmarks, irisIndexes);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const anchorWidth = distance(landmarks[eyeIndexes[0]], landmarks[eyeIndexes[1]]);
  const anchorHeight = distance(landmarks[eyeIndexes[2]], landmarks[eyeIndexes[3]]);

  const eyeWidth = Math.max((maxX - minX) * width * 1.75, anchorWidth * width * 1.45, 30);
  const eyeHeight = Math.max((maxY - minY) * height * 2.8, anchorHeight * height * 2.8, 18);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    x: width - centerX * width,
    y: centerY * height,
    width: eyeWidth,
    height: eyeHeight,
    pupilX: width - irisCenter.x * width,
    pupilY: irisCenter.y * height - eyeHeight * 0.12
  };
}

function getHeadGeometry(landmarks, width, height) {
  const bounds = getFaceBounds(landmarks);
  const foreheadCenter = mirrorPoint(averagePoint(landmarks, FOREHEAD_ANCHORS), width, height);

  return {
    centerX: width - ((bounds.minX + bounds.maxX) / 2) * width,
    topY: bounds.minY * height,
    width: (bounds.maxX - bounds.minX) * width,
    foreheadX: foreheadCenter.x,
    foreheadY: foreheadCenter.y
  };
}

function getFaceMetrics(landmarks, width, height) {
  const nose = mirrorPoint(landmarks[NOSE_TIP], width, height);
  const leftEye = mirrorPoint(landmarks[LEFT_EYE_CENTER], width, height);
  const rightEye = mirrorPoint(landmarks[RIGHT_EYE_CENTER], width, height);
  const browLeft = mirrorPoint(landmarks[LEFT_BROW_INNER], width, height);
  const browRight = mirrorPoint(landmarks[RIGHT_BROW_INNER], width, height);

  const eyeDistance = distance(leftEye, rightEye);
  const browDistance = distance(browLeft, browRight) / Math.max(eyeDistance, 1);
  const thinking = browDistance < 0.88;

  return {
    nose,
    eyeDistance,
    thinking
  };
}

function getEyeBandGeometry(landmarks, width, height, scale = 1) {
  const leftEye = getEyeGeometry(landmarks, LEFT_EYE_INDEXES, LEFT_IRIS_INDEXES, width, height);
  const rightEye = getEyeGeometry(landmarks, RIGHT_EYE_INDEXES, RIGHT_IRIS_INDEXES, width, height);
  const centerX = (leftEye.x + rightEye.x) / 2;
  const centerY = (leftEye.y + rightEye.y) / 2;
  const eyeDistance = distance(leftEye, rightEye);
  const averageEyeHeight = (leftEye.height + rightEye.height) / 2;
  const angle = normalizeUprightAngle(Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x));

  return {
    leftEye,
    rightEye,
    centerX,
    centerY,
    angle,
    width: Math.max(eyeDistance * 1.9, (leftEye.width + rightEye.width) * 1.25) * scale,
    height: Math.max(averageEyeHeight * 2.2, eyeDistance * 0.34) * scale,
    eyeDistance
  };
}

function drawMirroredVideo(ctx, source, width, height) {
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

function drawWhiteEyeOverlay(ctx, landmarks, width, height, settings, hidePupil = false, strokeScaleOverride = null) {
  const leftEye = getEyeGeometry(landmarks, LEFT_EYE_INDEXES, LEFT_IRIS_INDEXES, width, height);
  const rightEye = getEyeGeometry(landmarks, RIGHT_EYE_INDEXES, RIGHT_IRIS_INDEXES, width, height);
  const strokeScale = strokeScaleOverride ?? settings.strokeScale;

  [leftEye, rightEye].forEach((eye) => {
    const eyeWidth = eye.width * settings.scale;
    const eyeHeight = eye.height * settings.scale;

    ctx.save();
    ctx.translate(eye.x, eye.y);
    ctx.fillStyle = "rgba(255, 255, 255, 0.99)";
    ctx.beginPath();
    ctx.ellipse(0, 0, eyeWidth / 2, eyeHeight / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const strokeWidth = eyeHeight * strokeScale;
    if (strokeWidth > 0) {
      ctx.strokeStyle = "rgba(18, 12, 10, 0.92)";
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
    ctx.restore();

    if (hidePupil) {
      return;
    }

    const pupilRadius = eyeHeight * settings.pupilScale;
    if (pupilRadius <= 0) {
      return;
    }

    const pupilOffsetX = (eye.pupilX - eye.x) * 0.22;
    ctx.fillStyle = "#121212";
    ctx.beginPath();
    ctx.arc(eye.x + pupilOffsetX, eye.pupilY, pupilRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawUnibrowOverlay(ctx, landmarks, width, height, settings) {
  const left = LEFT_BROW_CURVE.map((index) => mirrorPoint(landmarks[index], width, height));
  const right = RIGHT_BROW_CURVE.map((index) => mirrorPoint(landmarks[index], width, height));
  const bridge = BROW_BRIDGE.map((index) => mirrorPoint(landmarks[index], width, height));
  const baseThickness = Math.max(distance(left[0], left[2]) * 0.18, 10);
  const browThickness = baseThickness * settings.thicknessScale;
  const lift = browThickness * settings.liftScale;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(34, 20, 12, 0.94)";
  ctx.shadowColor = "rgba(34, 20, 12, 0.24)";
  ctx.shadowBlur = browThickness * 0.5;

  ctx.lineWidth = browThickness;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  ctx.quadraticCurveTo(left[1].x, left[1].y - lift, left[2].x, left[2].y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(right[0].x, right[0].y);
  ctx.quadraticCurveTo(right[1].x, right[1].y - lift, right[2].x, right[2].y);
  ctx.stroke();

  ctx.lineWidth = browThickness * 0.92;
  ctx.beginPath();
  ctx.moveTo(left[2].x, left[2].y - browThickness * 0.1);
  ctx.quadraticCurveTo(bridge[1].x, bridge[1].y + browThickness * 0.5, right[0].x, right[0].y - browThickness * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawEyeMask(ctx, landmarks, width, height, settings) {
  const band = getEyeBandGeometry(landmarks, width, height, 1);
  const maskHeight = band.height * settings.thicknessScale;
  const maskWidth = band.width * settings.widthScale;

  ctx.save();
  ctx.translate(band.centerX, band.centerY);
  ctx.rotate(band.angle);
  ctx.fillStyle = "rgba(0, 0, 0, 0.94)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.34)";
  ctx.shadowBlur = maskHeight * 0.35;
  ctx.fillRect(-maskWidth / 2, -maskHeight / 2, maskWidth, maskHeight);

  if (settings.showText) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${Math.max(maskHeight * 0.42, 14)}px Arial, sans-serif`;
    ctx.fillText(settings.label, 0, 0);
  }

  ctx.restore();
}

function drawHeartPath(ctx, size) {
  const top = -size * 0.32;

  ctx.beginPath();
  ctx.moveTo(0, size * 0.38);
  ctx.bezierCurveTo(-size * 0.72, -size * 0.05, -size * 0.52, -size * 0.72, 0, top);
  ctx.bezierCurveTo(size * 0.52, -size * 0.72, size * 0.72, -size * 0.05, 0, size * 0.38);
  ctx.closePath();
}

function drawHeartEyes(ctx, landmarks, width, height, now, settings) {
  const band = getEyeBandGeometry(landmarks, width, height, 1);
  const bob = Math.sin(now / 360) * band.eyeDistance * 0.025;

  [band.leftEye, band.rightEye].forEach((eye) => {
    const size = Math.max(eye.width * 0.82, eye.height * 1.65, 24) * settings.scale;

    ctx.save();
    ctx.translate(eye.x, eye.y + bob);
    ctx.rotate(band.angle);
    ctx.globalAlpha = settings.alpha;
    ctx.fillStyle = "#ff4f8f";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = Math.max(size * 0.08, 2);
    ctx.shadowColor = "rgba(255, 79, 143, 0.38)";
    ctx.shadowBlur = size * 0.22;
    drawHeartPath(ctx, size);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

function drawEyeMosaic(ctx, source, landmarks, width, height, settings) {
  const band = getEyeBandGeometry(landmarks, width, height, settings.areaScale);
  const rectWidth = Math.min(width, band.width);
  const rectHeight = Math.min(height, band.height);
  const sourceX = clamp(band.centerX - rectWidth / 2, 0, width - rectWidth);
  const sourceY = clamp(band.centerY - rectHeight / 2, 0, height - rectHeight);
  const blockSize = Math.max(4, Math.round(settings.blockSize));
  const smallWidth = Math.max(8, Math.round(rectWidth / blockSize));
  const smallHeight = Math.max(6, Math.round(rectHeight / blockSize));

  if (!drawEyeMosaic.buffer) {
    drawEyeMosaic.buffer = document.createElement("canvas");
  }

  const buffer = drawEyeMosaic.buffer;
  buffer.width = smallWidth;
  buffer.height = smallHeight;

  const bufferCtx = buffer.getContext("2d");
  if (!bufferCtx) {
    return;
  }

  bufferCtx.imageSmoothingEnabled = true;
  bufferCtx.drawImage(source, sourceX, sourceY, rectWidth, rectHeight, 0, 0, smallWidth, smallHeight);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, smallWidth, smallHeight, sourceX, sourceY, rectWidth, rectHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = Math.max(2, rectHeight * 0.04);
  ctx.strokeRect(sourceX, sourceY, rectWidth, rectHeight);
  ctx.restore();
}

function getFormulaMotionOffset(mode, angle, drift, motionScale, radius) {
  switch (mode) {
    case "wave":
      return {
        x: Math.sin(drift * 1.6) * 10 * motionScale,
        y: Math.cos(drift * 1.2 + angle) * 18 * motionScale
      };
    case "scatter":
      return {
        x: Math.cos(drift * 0.9 + angle * 1.3) * radius * 0.08 * motionScale,
        y: Math.sin(drift * 1.4 - angle) * radius * 0.12 * motionScale
      };
    case "orbit":
    default:
      return {
        x: Math.sin(drift) * 18 * motionScale,
        y: Math.cos(drift * 1.2) * 14 * motionScale
      };
  }
}

function drawEquationOverlay(ctx, head, width, height, now, countMultiplier = 1, options = {}) {
  const speed = options.speed ?? 1;
  const motionScale = options.motionScale ?? 1;
  const motionMode = options.motionMode ?? "orbit";
  const maxRadius = Math.hypot(width, height) * 0.78;
  const total = Math.round(24 * countMultiplier);
  const spreadProgress = Math.min((now % 1800) / 1800, 1);

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255, 252, 245, 0.68)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
  ctx.shadowColor = "rgba(255, 255, 255, 0.15)";
  ctx.shadowBlur = 14;

  for (let index = 0; index < total; index += 1) {
    const formula = FORMULAS[index % FORMULAS.length];
    const lane = Math.floor(index / FORMULAS.length);
    const angle = ((Math.PI * 2) / total) * index + (now * speed) / 2400;
    const radiusBase = maxRadius * (0.16 + (index % 6) * 0.08);
    const radius = Math.min(maxRadius, (radiusBase * (0.48 + spreadProgress * 1.4) + lane * 24) * (0.88 + motionScale * 0.12));
    const drift = (now * speed) / 900 + index * 0.8;
    const motionOffset = getFormulaMotionOffset(motionMode, angle, drift, motionScale, radius);
    const x = head.foreheadX + Math.cos(angle) * radius + motionOffset.x;
    const y = head.foreheadY + Math.sin(angle) * radius * 0.82 + motionOffset.y;
    const alpha = 0.24 + ((Math.sin(drift * 1.4) + 1) / 2) * 0.38;
    const fontSize = 16 + (index % 4) * 4;

    ctx.globalAlpha = alpha;
    ctx.font = `700 ${fontSize}px "Marker Felt", "Comic Sans MS", cursive`;
    ctx.strokeText(formula, x, y);
    ctx.fillText(formula, x, y);
  }

  ctx.restore();
}

function drawWireSphere(ctx, centerX, centerY, radius, now) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(now / 5200);
  ctx.strokeStyle = "rgba(255,255,255,0.54)";
  ctx.lineWidth = 1.2;

  for (let index = 0; index < 4; index += 1) {
    const scaleY = lerp(1, 0.34, index / 3);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * scaleY, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (let index = -2; index <= 2; index += 1) {
    const x = (index / 2.4) * radius;
    const yRadius = Math.sqrt(Math.max(radius * radius - x * x, 0));
    ctx.beginPath();
    ctx.ellipse(x * 0.12, 0, yRadius * 0.16, yRadius, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawConeSection(ctx, centerX, centerY, scale, now) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(-0.26 + Math.sin(now / 1800) * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.56)";
  ctx.lineWidth = 1.3;

  ctx.beginPath();
  ctx.moveTo(-scale * 0.55, scale * 0.62);
  ctx.lineTo(0, -scale * 0.7);
  ctx.lineTo(scale * 0.55, scale * 0.62);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(0, scale * 0.62, scale * 0.55, scale * 0.18, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(0, scale * 0.08, scale * 0.25, scale * 0.08, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawAxes(ctx, centerX, centerY, scale, now) {
  const pulse = 1 + Math.sin(now / 1200) * 0.04;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(pulse, pulse);
  ctx.strokeStyle = "rgba(255,255,255,0.58)";
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.lineWidth = 1.3;
  ctx.font = `600 ${Math.max(scale * 0.18, 10)}px "Marker Felt", "Comic Sans MS", cursive`;

  const axes = [
    { label: "X", x: scale, y: 0 },
    { label: "Y", x: -scale * 0.42, y: -scale * 0.84 },
    { label: "Z", x: -scale * 0.72, y: scale * 0.42 }
  ];

  axes.forEach((axis) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(axis.x, axis.y);
    ctx.stroke();

    const angle = Math.atan2(axis.y, axis.x);
    ctx.beginPath();
    ctx.moveTo(axis.x, axis.y);
    ctx.lineTo(axis.x - Math.cos(angle - 0.35) * 10, axis.y - Math.sin(angle - 0.35) * 10);
    ctx.lineTo(axis.x - Math.cos(angle + 0.35) * 10, axis.y - Math.sin(angle + 0.35) * 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillText(axis.label, axis.x + 12, axis.y + 2);
  });

  ctx.restore();
}

function drawPolygonCluster(ctx, centerX, centerY, scale, now) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(now / 2800);
  ctx.strokeStyle = "rgba(255,255,255,0.52)";
  ctx.lineWidth = 1.2;

  for (let side = 3; side <= 6; side += 1) {
    const radius = scale * (0.22 + side * 0.08) * (1 + Math.sin(now / 1300 + side) * 0.04);
    ctx.beginPath();
    for (let index = 0; index <= side; index += 1) {
      const angle = (Math.PI * 2 * index) / side;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawVectorArrows(ctx, centerX, centerY, scale, now) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.strokeStyle = "rgba(255,255,255,0.56)";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 1.15;

  for (let index = 0; index < 4; index += 1) {
    const angle = now / 1600 + index * (Math.PI / 2);
    const length = scale * (0.42 + index * 0.08);
    const x = Math.cos(angle) * length;
    const y = Math.sin(angle) * length;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-10, 4);
    ctx.lineTo(-10, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawGeniusOverlay(ctx, metrics, head, width, height, now, settings) {
  const densityMultiplier = (metrics.thinking ? 1.15 : 0.7) * settings.formulaDensity;
  drawEquationOverlay(ctx, head, width, height, now, densityMultiplier, {
    speed: settings.formulaSpeed,
    motionScale: settings.motionScale,
    motionMode: settings.motionMode
  });

  const drift = Math.sin((now * settings.formulaSpeed) / 1600) * metrics.eyeDistance * 0.08 * settings.motionScale;
  const pulse = 1 + Math.sin((now * settings.formulaSpeed) / 1400) * 0.04 * settings.motionScale;

  drawWireSphere(
    ctx,
    metrics.nose.x + metrics.eyeDistance * 0.92,
    metrics.nose.y - metrics.eyeDistance * 0.72 + drift,
    metrics.eyeDistance * 0.34 * pulse,
    now
  );
  drawConeSection(
    ctx,
    metrics.nose.x - metrics.eyeDistance * 0.92,
    metrics.nose.y - metrics.eyeDistance * 0.2 - drift,
    metrics.eyeDistance * 0.42 * pulse,
    now
  );
  drawAxes(
    ctx,
    metrics.nose.x + metrics.eyeDistance * 0.08,
    metrics.nose.y - metrics.eyeDistance * 1.05,
    metrics.eyeDistance * 0.46,
    now
  );
  drawPolygonCluster(
    ctx,
    metrics.nose.x - metrics.eyeDistance * 0.68,
    metrics.nose.y + metrics.eyeDistance * 0.84,
    metrics.eyeDistance * 0.62,
    now
  );
  drawVectorArrows(
    ctx,
    metrics.nose.x + metrics.eyeDistance * 0.88,
    metrics.nose.y + metrics.eyeDistance * 0.72,
    metrics.eyeDistance * 0.44,
    now
  );
}

function describeEffect(effect, thinking) {
  switch (effect) {
    case "white-eye":
      return "白目エフェクトを表示しています。";
    case "unibrow":
      return "つながり眉エフェクトを表示しています。";
    case "eye-mask":
      return "目元に黒い目隠しバーを表示しています。";
    case "heart-eyes":
      return "両目にハート目エフェクトを表示しています。";
    case "eye-mosaic":
      return "目元周辺だけに軽量モザイクを表示しています。";
    case "genius":
    default:
      return thinking
        ? "考え中モードで数式と幾何学オブジェクトを増やしています。"
        : "天才風フィルターを表示しています。";
  }
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const animationFrameRef = useRef(0);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const modelPromiseRef = useRef(null);
  const mountedRef = useRef(false);
  const lifetimeRef = useRef(0);
  const cameraGenerationRef = useRef(0);
  // A stopped browser request still holds this lock until it settles.
  const startInFlightRef = useRef(false);
  const hasFrameRef = useRef(false);
  const screenshotInFlightRef = useRef(false);
  const downloadUrlsRef = useRef(new Map());
  const effectRef = useRef("genius");
  const settingsRef = useRef({
    whiteEye: {
      scale: 1,
      strokeScale: 0.07,
      pupilScale: 0.16
    },
    genius: {
      formulaDensity: 1,
      formulaSpeed: 1,
      motionScale: 1,
      motionMode: "orbit"
    },
    unibrow: {
      thicknessScale: 1,
      liftScale: 0.18
    },
    eyeMask: {
      thicknessScale: 1,
      widthScale: 1,
      showText: true,
      label: "ヒミツ！"
    },
    heartEyes: {
      scale: 1,
      alpha: 0.82
    },
    eyeMosaic: {
      blockSize: 10,
      areaScale: 1
    }
  });
  const uiRef = useRef({
    status: "待機中",
    statusState: "idle",
    message: "前面カメラでエフェクトを開始できます。",
    error: "",
    thinking: false
  });

  const [statusText, setStatusText] = useState("待機中");
  const [statusState, setStatusState] = useState("idle");
  const [message, setMessage] = useState("前面カメラでエフェクトを開始できます。");
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [savedImage, setSavedImage] = useState(null);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [effect, setEffect] = useState("genius");
  const [whiteEyeScale, setWhiteEyeScale] = useState(100);
  const [whiteEyeStroke, setWhiteEyeStroke] = useState(7);
  const [whiteEyePupil, setWhiteEyePupil] = useState(16);
  const [geniusFormulaDensity, setGeniusFormulaDensity] = useState(100);
  const [geniusFormulaSpeed, setGeniusFormulaSpeed] = useState(100);
  const [geniusMotionScale, setGeniusMotionScale] = useState(100);
  const [geniusMotionMode, setGeniusMotionMode] = useState("orbit");
  const [unibrowThickness, setUnibrowThickness] = useState(100);
  const [unibrowLift, setUnibrowLift] = useState(18);
  const [eyeMaskThickness, setEyeMaskThickness] = useState(100);
  const [eyeMaskWidth, setEyeMaskWidth] = useState(100);
  const [eyeMaskShowText, setEyeMaskShowText] = useState(true);
  const [eyeMosaicBlockSize, setEyeMosaicBlockSize] = useState(10);
  const [eyeMosaicAreaScale, setEyeMosaicAreaScale] = useState(100);
  const [heartEyeScale, setHeartEyeScale] = useState(100);
  const [heartEyeAlpha, setHeartEyeAlpha] = useState(82);

  function updateUi(next) {
    const current = uiRef.current;
    const merged = { ...current, ...next };
    uiRef.current = merged;

    if (merged.status !== current.status) {
      setStatusText(merged.status);
    }
    if (merged.statusState !== current.statusState) {
      setStatusState(merged.statusState);
    }
    if (merged.message !== current.message) {
      setMessage(merged.message);
    }
    if (merged.error !== current.error) {
      setError(merged.error);
    }
    if (merged.thinking !== current.thinking) {
      setThinkingMode(merged.thinking);
    }
  }

  function ensureLandmarker() {
    if (faceLandmarkerRef.current) {
      return Promise.resolve(faceLandmarkerRef.current);
    }
    if (modelPromiseRef.current) return modelPromiseRef.current;

    const lifetime = lifetimeRef.current;
    const isCurrent = () => mountedRef.current && lifetime === lifetimeRef.current;
    const pending = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      if (!isCurrent()) throw new Error("モデルの読み込みを中断しました。");
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false
      });

      if (!isCurrent()) {
        landmarker.close();
        throw new Error("モデルの読み込みを中断しました。");
      }
      faceLandmarkerRef.current = landmarker;
      return landmarker;
    })();
    modelPromiseRef.current = pending;
    const clearPending = () => {
      if (modelPromiseRef.current === pending) modelPromiseRef.current = null;
    };
    pending.then(clearPending, clearPending);
    return pending;
  }

  function stopCamera(showMessage = true) {
    cameraGenerationRef.current += 1;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    lastVideoTimeRef.current = -1;
    hasFrameRef.current = false;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (!mountedRef.current) return;
    setCameraActive(false);
    setFrameReady(false);
    if (showMessage) {
      updateUi({
        status: "停止中", statusState: "idle", thinking: false, error: "",
        message: "カメラを停止しました。起動ボタンで再開できます。"
      });
    }
  }

  function renderLoop(generation) {
    if (!mountedRef.current || generation !== cameraGenerationRef.current || document.hidden) return;
    animationFrameRef.current = 0;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    const landmarker = faceLandmarkerRef.current;

    if (!video || !canvas || !frame || !landmarker || !streamRef.current) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    try {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;
      // Preserve the composited image until a new video frame arrives.
      if (video.currentTime === lastVideoTimeRef.current) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        frame.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }

      drawMirroredVideo(ctx, video, canvas.width, canvas.height);
      if (!hasFrameRef.current) {
        hasFrameRef.current = true;
        setFrameReady(true);
      }

      lastVideoTimeRef.current = video.currentTime;
      const now = performance.now();
      let faceLandmarks;
      try {
        faceLandmarks = landmarker.detectForVideo(video, now).faceLandmarks?.[0];
      } catch {
        updateUi({
          status: "顔認識エラー", statusState: "error", thinking: false,
          message: "映像は表示しています。顔認識を再試行しています。",
          error: "顔認識処理に失敗しました。改善しない場合はカメラを停止して再開してください。"
        });
        return;
      }

      if (!faceLandmarks) {
        updateUi({
          status: "顔が見つかりません",
          statusState: "waiting",
          message: "明るい場所で顔を正面に向けてください。顔が戻るとエフェクトを再開します。",
          error: "",
          thinking: false
        });
        return;
      }

      const metrics = getFaceMetrics(faceLandmarks, canvas.width, canvas.height);
      const head = getHeadGeometry(faceLandmarks, canvas.width, canvas.height);
      const currentEffect = effectRef.current;
      const geniusSettings = settingsRef.current.genius;
      const whiteEyeSettings = settingsRef.current.whiteEye;
      const unibrowSettings = settingsRef.current.unibrow;
      const eyeMaskSettings = settingsRef.current.eyeMask;
      const heartEyesSettings = settingsRef.current.heartEyes;
      const eyeMosaicSettings = settingsRef.current.eyeMosaic;

      switch (currentEffect) {
        case "white-eye":
          drawWhiteEyeOverlay(ctx, faceLandmarks, canvas.width, canvas.height, whiteEyeSettings);
          break;
        case "unibrow":
          drawUnibrowOverlay(ctx, faceLandmarks, canvas.width, canvas.height, unibrowSettings);
          break;
        case "eye-mask":
          drawEyeMask(ctx, faceLandmarks, canvas.width, canvas.height, eyeMaskSettings);
          break;
        case "heart-eyes":
          drawHeartEyes(ctx, faceLandmarks, canvas.width, canvas.height, now, heartEyesSettings);
          break;
        case "eye-mosaic":
          drawEyeMosaic(ctx, canvas, faceLandmarks, canvas.width, canvas.height, eyeMosaicSettings);
          break;
        case "genius":
        default:
          drawGeniusOverlay(ctx, metrics, head, canvas.width, canvas.height, now, geniusSettings);
          break;
      }

      updateUi({
        status: metrics.thinking && currentEffect === "genius" ? "考え中モード" : "顔を検出中",
        statusState: "detecting",
        message: describeEffect(currentEffect, metrics.thinking),
        error: "",
        thinking: metrics.thinking
      });

    } catch {
      updateUi({
        status: "描画エラー", statusState: "error", thinking: false,
        message: "映像の描画を再試行しています。",
        error: "プレビューの描画に失敗しました。改善しない場合はカメラを再開してください。"
      });
    } finally {
      if (mountedRef.current && generation === cameraGenerationRef.current && streamRef.current && !document.hidden) {
        animationFrameRef.current = window.requestAnimationFrame(() => renderLoop(generation));
      }
    }
  }

  async function startCamera() {
    if (!mountedRef.current || document.hidden || startInFlightRef.current || streamRef.current) return;
    startInFlightRef.current = true;
    setCameraStarting(true);
    stopCamera(false);
    const generation = cameraGenerationRef.current;
    const lifetime = lifetimeRef.current;
    const isCurrent = () => mountedRef.current && generation === cameraGenerationRef.current && !document.hidden;
    let stage = "conditions";
    updateUi({
      status: "起動準備中",
      statusState: "waiting",
      message: "カメラと顔認識モデルを準備しています。",
      error: "",
      thinking: false
    });
    setCaptureError("");

    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("カメラを利用できません。HTTPS（開発時は localhost）と対応ブラウザをご確認ください。");
      }
      stage = "model";
      await ensureLandmarker();
      if (!isCurrent()) return;
      stage = "camera";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 960 }
        }
      });

      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      stage = "play";
      if (!videoRef.current) {
        throw new Error("video 要素を初期化できませんでした。");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (!isCurrent()) return;
      setCameraActive(true);
      renderLoop(generation);
    } catch (caught) {
      if (!isCurrent()) return;
      let detail;
      if (stage === "conditions") {
        detail = caught.message;
      } else if (stage === "model") {
        detail = "顔認識モデルの読み込みに失敗しました。通信環境をご確認のうえ、再度起動してください。";
      } else if (stage === "play") {
        detail = "カメラ映像の再生に失敗しました。カメラを再度起動してください。";
      } else {
        switch (caught?.name) {
          case "NotAllowedError":
          case "PermissionDeniedError":
            detail = "カメラの利用が許可されていません。Safariや端末のカメラ権限、サイトの利用制限をご確認ください。";
            break;
          case "NotFoundError":
          case "DevicesNotFoundError":
            detail = "利用できるカメラが見つかりません。接続や端末の設定をご確認ください。";
            break;
          case "NotReadableError":
          case "TrackStartError":
            detail = "カメラを読み取れません。別のアプリで使用中の可能性があります。ほかのカメラアプリを閉じて再試行してください。";
            break;
          default:
            detail = "カメラの起動に失敗しました。原因を特定できません。ブラウザや端末の設定を確認して再試行してください。";
        }
      }
      stopCamera(false);
      updateUi({
        status: "エラー",
        statusState: "error",
        message: "起動ボタンから再試行できます。",
        error: detail,
        thinking: false
      });
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current && lifetime === lifetimeRef.current) setCameraStarting(false);
    }
  }

  function releaseSavedImage() {
    setSavedImage(null);
  }

  async function takeScreenshot() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (screenshotInFlightRef.current) return;
    if (!streamRef.current || !hasFrameRef.current || !canvas?.width || !canvas?.height ||
        !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setCaptureError("保存できる映像がありません。カメラを起動し、プレビューを確認してください。");
      return;
    }
    screenshotInFlightRef.current = true;
    setSaving(true);
    setCaptureError("");
    const generation = cameraGenerationRef.current;
    const lifetime = lifetimeRef.current;
    let url;
    try {
      // toBlob snapshots the composited canvas at invocation time.
      const blob = await new Promise((resolve, reject) => {
        if (canvas.toBlob) {
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG生成失敗")), "image/png");
        } else {
          // Compatibility fallback; this does not make a network request.
          const data = atob(canvas.toDataURL("image/png").split(",")[1]);
          resolve(new Blob([Uint8Array.from(data, (char) => char.charCodeAt(0))], { type: "image/png" }));
        }
      });
      if (!mountedRef.current || generation !== cameraGenerationRef.current) return;
      url = URL.createObjectURL(blob);
      const name = `face-effect-${Date.now()}.png`;
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      // Allow the browser to consume the download before revoking its URL.
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrlsRef.current.delete(url);
      }, 60000);
      downloadUrlsRef.current.set(url, timer);
      setSavedImage({ url: URL.createObjectURL(blob), name });
    } catch {
      if (url) {
        window.clearTimeout(downloadUrlsRef.current.get(url));
        downloadUrlsRef.current.delete(url);
        URL.revokeObjectURL(url);
      }
      if (mountedRef.current && lifetime === lifetimeRef.current) {
        setCaptureError("スクリーンショットの生成・保存に失敗しました。映像を確認し、もう一度お試しください。");
      }
    } finally {
      screenshotInFlightRef.current = false;
      if (mountedRef.current && lifetime === lifetimeRef.current) setSaving(false);
    }
  }

  useEffect(() => {
    effectRef.current = effect;
  }, [effect]);

  useEffect(() => {
    settingsRef.current.genius = {
      formulaDensity: geniusFormulaDensity / 100,
      formulaSpeed: geniusFormulaSpeed / 100,
      motionScale: geniusMotionScale / 100,
      motionMode: geniusMotionMode
    };
  }, [geniusFormulaDensity, geniusFormulaSpeed, geniusMotionScale, geniusMotionMode]);

  useEffect(() => {
    settingsRef.current.whiteEye = {
      scale: whiteEyeScale / 100,
      strokeScale: whiteEyeStroke / 100,
      pupilScale: whiteEyePupil / 100
    };
  }, [whiteEyeScale, whiteEyeStroke, whiteEyePupil]);

  useEffect(() => {
    settingsRef.current.unibrow = {
      thicknessScale: unibrowThickness / 100,
      liftScale: unibrowLift / 100
    };
  }, [unibrowThickness, unibrowLift]);

  useEffect(() => {
    settingsRef.current.eyeMask = {
      thicknessScale: eyeMaskThickness / 100,
      widthScale: eyeMaskWidth / 100,
      showText: eyeMaskShowText,
      label: "ヒミツ！"
    };
  }, [eyeMaskThickness, eyeMaskWidth, eyeMaskShowText]);

  useEffect(() => {
    settingsRef.current.eyeMosaic = {
      blockSize: eyeMosaicBlockSize,
      areaScale: eyeMosaicAreaScale / 100
    };
  }, [eyeMosaicBlockSize, eyeMosaicAreaScale]);

  useEffect(() => {
    settingsRef.current.heartEyes = {
      scale: heartEyeScale / 100,
      alpha: heartEyeAlpha / 100
    };
  }, [heartEyeScale, heartEyeAlpha]);

  useEffect(() => {
    mountedRef.current = true;
    lifetimeRef.current += 1;
    const onVisibilityChange = () => {
      if (document.hidden) stopCamera();
    };
    const onPageHide = () => stopCamera();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      lifetimeRef.current += 1;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      stopCamera(false);
      modelPromiseRef.current = null;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
      for (const [url, timer] of downloadUrlsRef.current) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloadUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (savedImage) URL.revokeObjectURL(savedImage.url);
    };
  }, [savedImage]);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">FACE EFFECT</p>
        <h1>顔エフェクトカメラ</h1>
        <p className="updated-at">更新日時: {BUILD_UPDATED_AT}</p>
        <p className="lead">
          天才風、白目、つながり眉、目隠し、ハート目、モザイクを切り替えられます。
          iPhone Safari でも使いやすいように、エフェクト選択と調整をひとつの画面にまとめています。
        </p>
      </section>

      <section className="viewer-card">
        <div ref={frameRef} className="canvas-frame">
          <canvas ref={canvasRef} aria-label="顔エフェクトカメラのプレビュー" />
          <video ref={videoRef} playsInline muted />
          {!cameraActive && <div className="canvas-placeholder">前面カメラで起動</div>}
        </div>

        <div className="action-row" aria-label="撮影操作">
          <button className="primary-button" type="button" onClick={startCamera} disabled={cameraStarting || cameraActive}>
            {cameraStarting ? "起動処理中…" : "カメラ起動"}
          </button>
          <button className="secondary-button" type="button" onClick={() => stopCamera()} disabled={!cameraStarting && !cameraActive}>
            停止
          </button>
          <button className="secondary-button" type="button" onClick={takeScreenshot} disabled={!cameraActive || !frameReady || saving}>
            {saving ? "保存中…" : "スクリーンショット"}
          </button>
        </div>
        <p className={`status-pill status-pill--${statusState}`} role="status">{statusText}</p>
        {error ? <p className="error-box" role="alert">{error}</p> : null}
        {captureError ? <p className="error-box" role="alert">{captureError}</p> : null}
        {savedImage ? (
          <div className="save-help">
            <p>Safariで保存されない場合は「画像を開く」を押し、画像の長押しや共有メニューから保存してください。</p>
            <a href={savedImage.url} target="_blank" rel="noopener noreferrer">画像を開く</a>
            <button className="secondary-button" type="button" onClick={releaseSavedImage}>閉じる</button>
          </div>
        ) : null}

        <div className="info-panel">
          <div>
            <label className="info-label" htmlFor="effect-select">エフェクト</label>
            <select id="effect-select" className="effect-select" value={effect} onChange={(event) => setEffect(event.target.value)}>
              {EFFECTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="info-label">メッセージ</p>
            <p className="info-message">{message}</p>
          </div>
        </div>

        <div className="settings-panel" role="region" aria-label="エフェクトの詳細設定" tabIndex={0}>
          {effect === "genius" ? (
            <>
              <div className="settings-header">
                <h2>天才風の調整</h2>
                <p>式の量、スピード、動きの大きさ、動き方を変更できます。</p>
              </div>
              <label className="slider-row">
                <span>式の量</span>
                <strong>{geniusFormulaDensity}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="40"
                max="220"
                step="10"
                value={geniusFormulaDensity}
                onChange={(event) => setGeniusFormulaDensity(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>式のスピード</span>
                <strong>{geniusFormulaSpeed}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="20"
                max="220"
                step="10"
                value={geniusFormulaSpeed}
                onChange={(event) => setGeniusFormulaSpeed(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>式の動きの大きさ</span>
                <strong>{geniusMotionScale}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="20"
                max="220"
                step="10"
                value={geniusMotionScale}
                onChange={(event) => setGeniusMotionScale(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>式の動き方</span>
                <strong>
                  {geniusMotionMode === "orbit"
                    ? "周回"
                    : geniusMotionMode === "wave"
                      ? "波打ち"
                      : "拡散"}
                </strong>
              </label>
              <select
                className="effect-select"
                value={geniusMotionMode}
                onChange={(event) => setGeniusMotionMode(event.target.value)}
              >
                <option value="orbit">周回</option>
                <option value="wave">波打ち</option>
                <option value="scatter">拡散</option>
              </select>
            </>
          ) : effect === "white-eye" ? (
            <>
              <div className="settings-header">
                <h2>白目の調整</h2>
                <p>目の大きさ、枠線の太さ、黒い点の大きさを変更できます。</p>
              </div>
              <label className="slider-row">
                <span>目の大きさ</span>
                <strong>{whiteEyeScale}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="70"
                max="170"
                step="5"
                value={whiteEyeScale}
                onChange={(event) => setWhiteEyeScale(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>目の枠線の太さ</span>
                <strong>{whiteEyeStroke}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="0"
                max="14"
                step="1"
                value={whiteEyeStroke}
                onChange={(event) => setWhiteEyeStroke(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>黒い点の大きさ</span>
                <strong>{whiteEyePupil}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="0"
                max="28"
                step="1"
                value={whiteEyePupil}
                onChange={(event) => setWhiteEyePupil(Number(event.target.value))}
              />
            </>
          ) : effect === "unibrow" ? (
            <>
              <div className="settings-header">
                <h2>つながり眉の調整</h2>
                <p>眉の太さとアーチの持ち上げ量を変更できます。</p>
              </div>
              <label className="slider-row">
                <span>眉の太さ</span>
                <strong>{unibrowThickness}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="50"
                max="180"
                step="5"
                value={unibrowThickness}
                onChange={(event) => setUnibrowThickness(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>眉の持ち上げ量</span>
                <strong>{unibrowLift}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="0"
                max="40"
                step="2"
                value={unibrowLift}
                onChange={(event) => setUnibrowLift(Number(event.target.value))}
              />
            </>
          ) : effect === "eye-mask" ? (
            <>
              <div className="settings-header">
                <h2>目隠しの調整</h2>
                <p>両目をまとめて覆う黒帯の太さと文字表示を変更できます。</p>
              </div>
              <label className="slider-row">
                <span>バーの太さ</span>
                <strong>{eyeMaskThickness}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="65"
                max="150"
                step="5"
                value={eyeMaskThickness}
                onChange={(event) => setEyeMaskThickness(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>バーの長さ</span>
                <strong>{eyeMaskWidth}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="75"
                max="160"
                step="5"
                value={eyeMaskWidth}
                onChange={(event) => setEyeMaskWidth(Number(event.target.value))}
              />

              <label className="toggle-row">
                <span>ヒミツ！ 表示</span>
                <input
                  type="checkbox"
                  checked={eyeMaskShowText}
                  onChange={(event) => setEyeMaskShowText(event.target.checked)}
                />
              </label>
            </>
          ) : effect === "heart-eyes" ? (
            <>
              <div className="settings-header">
                <h2>ハート目の調整</h2>
                <p>目の位置に追従するハートの大きさと透明度を変更できます。</p>
              </div>
              <label className="slider-row">
                <span>ハートの大きさ</span>
                <strong>{heartEyeScale}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="70"
                max="170"
                step="5"
                value={heartEyeScale}
                onChange={(event) => setHeartEyeScale(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>透明度</span>
                <strong>{heartEyeAlpha}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="35"
                max="100"
                step="5"
                value={heartEyeAlpha}
                onChange={(event) => setHeartEyeAlpha(Number(event.target.value))}
              />
            </>
          ) : effect === "eye-mosaic" ? (
            <>
              <div className="settings-header">
                <h2>モザイクの調整</h2>
                <p>目元だけを低解像度にして戻す軽量モザイクの粗さと範囲を変更できます。</p>
              </div>
              <label className="slider-row">
                <span>モザイクの粗さ</span>
                <strong>{eyeMosaicBlockSize}</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="6"
                max="22"
                step="1"
                value={eyeMosaicBlockSize}
                onChange={(event) => setEyeMosaicBlockSize(Number(event.target.value))}
              />

              <label className="slider-row">
                <span>モザイク範囲</span>
                <strong>{eyeMosaicAreaScale}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="80"
                max="150"
                step="5"
                value={eyeMosaicAreaScale}
                onChange={(event) => setEyeMosaicAreaScale(Number(event.target.value))}
              />
            </>
          ) : (
            <div className="settings-header">
              <h2>{EFFECTS.find((item) => item.value === effect)?.label} の表示</h2>
              <p>
                {effect === "genius"
                  ? "数式と幾何学オブジェクトを顔の周囲へ追従表示します。"
                  : effect === "unibrow"
                    ? "眉を太くつなげて表示します。"
                    : effect === "eye-mask"
                      ? "両目をまとめて黒帯で隠します。"
                      : effect === "heart-eyes"
                        ? "両目にハートを重ねて表示します。"
                        : effect === "eye-mosaic"
                          ? "目元周辺だけにモザイクを表示します。"
                    : "白目を強調して表示します。"}
              </p>
            </div>
          )}
        </div>

      </section>

      <section className="notes-card">
        <h2>機能</h2>
        <ul>
          <li>前面カメラと MediaPipe Face Landmarker によるリアルタイム顔追従</li>
          <li>天才風、白目、つながり眉、目隠し、ハート目、モザイクを切り替え</li>
          <li>白目はサイズ、枠線、黒い点をスライダーで調整</li>
          <li>つながり眉は太さと持ち上げ量をスライダーで調整</li>
          <li>目隠し、ハート目、モザイクは目元のランドマークに追従</li>
          <li>Canvas 合成結果のスクリーンショット保存</li>
          <li>GitHub Pages 公開を想定した Vite 構成</li>
        </ul>
      </section>
    </main>
  );
}
