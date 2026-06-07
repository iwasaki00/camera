import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const INDEX_TIP = 8;
const PALM_ANCHORS = [0, 5, 9, 13, 17, 8];
const MAX_PARTICLES = 360;
const PALM_OPEN_DELAY_MS = 300;
const DIRECTIONS = {
  NONE: "NONE",
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  FORWARD: "FORWARD",
  BACK: "BACK"
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mirrorPoint(point, width, height) {
  return {
    x: width - point.x * width,
    y: point.y * height
  };
}

function averageLandmark(landmarks, indexes, width, height) {
  const total = indexes.reduce(
    (acc, index) => {
      const point = mirrorPoint(landmarks[index], width, height);
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: total.x / indexes.length,
    y: total.y / indexes.length
  };
}

function getHandScale(landmarks) {
  const palmWidth = distance(landmarks[5], landmarks[17]);
  const palmLength = distance(landmarks[0], landmarks[9]);
  return Math.max(palmWidth, palmLength);
}

function getHandPoints(landmarks, width, height) {
  return {
    indexTip: mirrorPoint(landmarks[INDEX_TIP], width, height),
    wrist: mirrorPoint(landmarks[WRIST], width, height),
    palmCenter: averageLandmark(landmarks, PALM_ANCHORS, width, height),
    handScale: getHandScale(landmarks)
  };
}

function isCastingPose(landmarks) {
  const handScale = getHandScale(landmarks);
  const palmOpen = distance(landmarks[4], landmarks[20]) > handScale * 1.45;
  const indexAwayFromWrist = distance(landmarks[INDEX_TIP], landmarks[WRIST]) > handScale * 1.15;
  return handScale > 0.17 && palmOpen && indexAwayFromWrist;
}

function isFingerExtended(landmarks, tipIndex, pipIndex) {
  return distance(landmarks[tipIndex], landmarks[WRIST]) > distance(landmarks[pipIndex], landmarks[WRIST]) * 1.08;
}

function isThumbExtended(landmarks, handednessLabel) {
  const tip = landmarks[4];
  const ip = landmarks[3];
  const handScale = getHandScale(landmarks);
  const xDelta = tip.x - ip.x;
  const farFromWrist = distance(tip, landmarks[WRIST]) > distance(ip, landmarks[WRIST]) * 1.04;

  // パー判定: 親指はIP関節より外側にあるかを見る。ラベルが曖昧な時は横方向の開きで補完する。
  const outward =
    handednessLabel === "Left"
      ? xDelta > handScale * 0.12
      : handednessLabel === "Right"
        ? xDelta < -handScale * 0.12
        : Math.abs(xDelta) > handScale * 0.16;

  return farFromWrist && outward;
}

function isPalmOpenPose(landmarks, handednessLabel) {
  const extendedCount = [
    isThumbExtended(landmarks, handednessLabel),
    isFingerExtended(landmarks, 8, 6),
    isFingerExtended(landmarks, 12, 10),
    isFingerExtended(landmarks, 16, 14),
    isFingerExtended(landmarks, 20, 18)
  ].filter(Boolean).length;

  return extendedCount >= 4;
}

function getPalmDirection(hand, previousHand, width, height) {
  if (!hand || !previousHand) {
    return DIRECTIONS.NONE;
  }

  const dx = hand.palmCenter.x - previousHand.palmCenter.x;
  const dy = hand.palmCenter.y - previousHand.palmCenter.y;
  const scaleDelta = hand.handScale - previousHand.handScale;
  const moveThreshold = Math.max(12, Math.min(width, height) * 0.028);
  const scaleThreshold = 0.025;

  // 既存方向判定: 前後は手の見かけサイズ変化で判定する。
  if (Math.abs(scaleDelta) > scaleThreshold) {
    return scaleDelta > 0 ? DIRECTIONS.FORWARD : DIRECTIONS.BACK;
  }

  // 既存方向判定: 上下左右はCanvas上の手のひら中心座標の変化で判定する。
  if (Math.abs(dx) < moveThreshold && Math.abs(dy) < moveThreshold) {
    return DIRECTIONS.NONE;
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT;
  }

  return dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP;
}

function getDirectionVector(direction) {
  switch (direction) {
    case DIRECTIONS.UP:
      return { x: 0, y: -1 };
    case DIRECTIONS.DOWN:
      return { x: 0, y: 1 };
    case DIRECTIONS.LEFT:
      return { x: -1, y: -0.12 };
    case DIRECTIONS.RIGHT:
      return { x: 1, y: -0.12 };
    case DIRECTIONS.FORWARD:
      return { x: 0, y: -0.42 };
    case DIRECTIONS.BACK:
      return { x: 0, y: 0.34 };
    default:
      return { x: 0, y: -0.5 };
  }
}

function createBlizzardParticle(origin, now, direction, forceAmount) {
  const vector = getDirectionVector(direction);
  const baseAngle = Math.atan2(vector.y, vector.x);
  const spread = direction === DIRECTIONS.FORWARD || direction === DIRECTIONS.NONE ? 1.25 : 0.88;
  const angle = baseAngle + (Math.random() - 0.5) * spread;
  const force = 1.2 + (forceAmount / 100) * 5.2;
  const speed = force * (0.75 + Math.random() * 1.25);
  const typeRoll = Math.random();
  const type = typeRoll > 0.9 ? "crystal" : typeRoll > 0.48 ? "line" : "dot";
  const colors = ["#ffffff", "#dff8ff", "#9ee7ff", "#b9dcff"];
  const size = type === "crystal" ? 5 + Math.random() * 7 : 1.4 + Math.random() * 4.8;

  return {
    x: origin.x + (Math.random() - 0.5) * 30,
    y: origin.y + (Math.random() - 0.5) * 26,
    px: origin.x,
    py: origin.y,
    vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.6,
    vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 1.2,
    size,
    type,
    life: 1,
    bornAt: now,
    ttl: type === "crystal" ? 620 + Math.random() * 360 : 420 + Math.random() * 420,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.16,
    color: colors[Math.floor(Math.random() * colors.length)]
  };
}

function drawCrystal(ctx, particle) {
  ctx.save();
  ctx.translate(particle.x, particle.y);
  ctx.rotate(particle.rotation);
  ctx.strokeStyle = particle.color;
  ctx.lineWidth = Math.max(0.8, particle.size * 0.11);

  for (let i = 0; i < 6; i += 1) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -particle.size);
    ctx.moveTo(0, -particle.size * 0.58);
    ctx.lineTo(-particle.size * 0.2, -particle.size * 0.78);
    ctx.moveTo(0, -particle.size * 0.58);
    ctx.lineTo(particle.size * 0.2, -particle.size * 0.78);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBlizzardParticle(ctx, particle) {
  ctx.save();
  ctx.globalAlpha = particle.life;

  if (particle.type === "crystal") {
    drawCrystal(ctx, particle);
  } else if (particle.type === "line") {
    ctx.strokeStyle = particle.color;
    ctx.lineWidth = Math.max(1, particle.size * 0.42);
    ctx.beginPath();
    ctx.moveTo(particle.px, particle.py);
    ctx.lineTo(particle.x, particle.y);
    ctx.stroke();
  } else {
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHandDebug(ctx, hand, isCasting) {
  const { indexTip, wrist, palmCenter, label } = hand;
  ctx.save();
  ctx.font = "700 13px sans-serif";
  ctx.lineWidth = 2;
  ctx.strokeStyle = isCasting ? "#9ee7ff" : "rgba(255,255,255,0.78)";
  ctx.fillStyle = isCasting ? "#dff8ff" : "#ffffff";

  ctx.beginPath();
  ctx.moveTo(wrist.x, wrist.y);
  ctx.lineTo(palmCenter.x, palmCenter.y);
  ctx.lineTo(indexTip.x, indexTip.y);
  ctx.stroke();

  [
    ["Index", indexTip],
    ["Palm", palmCenter],
    ["Wrist", wrist]
  ].forEach(([name, point]) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, name === "Palm" ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(name, point.x + 10, point.y - 8);
  });

  ctx.font = "700 16px sans-serif";
  ctx.fillText(`${label} ${isCasting ? "CASTING" : "READY"}`, palmCenter.x + 12, palmCenter.y + 22);
  ctx.restore();
}

function drawHud(ctx, direction, isPalmOpen) {
  ctx.save();
  ctx.font = "700 18px sans-serif";
  ctx.fillStyle = "rgba(3, 7, 13, 0.66)";
  ctx.fillRect(12, 12, 250, 68);
  ctx.fillStyle = direction === DIRECTIONS.NONE ? "#ffffff" : "#9ee7ff";
  ctx.fillText(`Direction: ${direction}`, 24, 38);
  ctx.fillStyle = isPalmOpen ? "#9ee7ff" : "#ffffff";
  ctx.fillText(`Palm: ${isPalmOpen ? "OPEN" : "CLOSED"}`, 24, 66);
  ctx.restore();
}

export default function IceMagicApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(0);
  const handLandmarkerRef = useRef(null);
  const particlesRef = useRef([]);
  const castHoldRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const handsRef = useRef([]);
  const previousPalmRef = useRef(null);
  const currentPalmDirectionRef = useRef(DIRECTIONS.NONE);
  const blizzardAmountRef = useRef(40);
  const blizzardForceRef = useRef(60);
  const particleSpawnCarryRef = useRef(0);
  const palmOpenStartedAtRef = useRef(0);
  const isPalmOpenRef = useRef(false);
  const isBlizzardActiveRef = useRef(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [statusText, setStatusText] = useState("カメラを起動してください");
  const [statusState, setStatusState] = useState("waiting");
  const [isCasting, setIsCasting] = useState(false);
  const [isPalmOpen, setIsPalmOpen] = useState(false);
  const [handCount, setHandCount] = useState(0);
  const [currentPalmDirection, setCurrentPalmDirection] = useState(DIRECTIONS.NONE);
  const [blizzardAmount, setBlizzardAmount] = useState(40);
  const [blizzardForce, setBlizzardForce] = useState(60);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const debugEnabledRef = useRef(debugEnabled);
  const lastUiRef = useRef({
    statusText: "カメラを起動してください",
    statusState: "waiting",
    isCasting: false,
    isPalmOpen: false,
    handCount: 0,
    currentPalmDirection: DIRECTIONS.NONE
  });

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
  }, [debugEnabled]);

  useEffect(() => {
    blizzardAmountRef.current = blizzardAmount;
  }, [blizzardAmount]);

  useEffect(() => {
    blizzardForceRef.current = blizzardForce;
  }, [blizzardForce]);

  async function ensureHandLandmarker() {
    if (handLandmarkerRef.current) {
      return handLandmarkerRef.current;
    }

    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    const options = {
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45
    };
    let landmarker;

    try {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: "GPU"
        }
      });
    } catch (error) {
      console.warn("[ice-magic] GPU delegate failed; retrying with CPU", error);
      landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: "CPU"
        }
      });
    }

    handLandmarkerRef.current = landmarker;
    return landmarker;
  }

  async function startCamera() {
    try {
      setStatusState("waiting");
      setStatusText("手認識モデルを読み込み中");
      const landmarker = await ensureHandLandmarker();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      const video = videoRef.current;
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();

      streamRef.current = stream;
      setCameraActive(true);
      setStatusState("waiting");
      setStatusText("手をカメラに向けてください");
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => renderFrame(landmarker));
    } catch (error) {
      console.error("[ice-magic] start failed", error);
      setStatusState("error");
      setStatusText("カメラまたは手認識を開始できませんでした");
    }
  }

  function stopCamera() {
    cancelAnimationFrame(animationFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    previousPalmRef.current = null;
    currentPalmDirectionRef.current = DIRECTIONS.NONE;
    particleSpawnCarryRef.current = 0;
    palmOpenStartedAtRef.current = 0;
    isPalmOpenRef.current = false;
    isBlizzardActiveRef.current = false;
    setCameraActive(false);
    setIsCasting(false);
    setIsPalmOpen(false);
    setHandCount(0);
    setCurrentPalmDirection(DIRECTIONS.NONE);
    setStatusState("waiting");
    setStatusText("カメラを起動してください");
    lastUiRef.current = {
      statusText: "カメラを起動してください",
      statusState: "waiting",
      isCasting: false,
      isPalmOpen: false,
      handCount: 0,
      currentPalmDirection: DIRECTIONS.NONE
    };
  }

  function updateUi(next) {
    const previous = lastUiRef.current;
    if (previous.statusText !== next.statusText) {
      setStatusText(next.statusText);
    }
    if (previous.statusState !== next.statusState) {
      setStatusState(next.statusState);
    }
    if (previous.isCasting !== next.isCasting) {
      setIsCasting(next.isCasting);
    }
    if (previous.isPalmOpen !== next.isPalmOpen) {
      setIsPalmOpen(next.isPalmOpen);
    }
    if (previous.handCount !== next.handCount) {
      setHandCount(next.handCount);
    }
    if (previous.currentPalmDirection !== next.currentPalmDirection) {
      setCurrentPalmDirection(next.currentPalmDirection);
    }
    lastUiRef.current = next;
  }

  function updateBlizzardState(rawPalmOpen, now) {
    isPalmOpenRef.current = rawPalmOpen;

    // パーは0.3秒以上続いた時だけ吹雪開始。閉じたら即停止する。
    if (!rawPalmOpen) {
      palmOpenStartedAtRef.current = 0;
      isBlizzardActiveRef.current = false;
      particleSpawnCarryRef.current = 0;
      return;
    }

    if (palmOpenStartedAtRef.current === 0) {
      palmOpenStartedAtRef.current = now;
    }

    isBlizzardActiveRef.current = now - palmOpenStartedAtRef.current >= PALM_OPEN_DELAY_MS;
  }

  function updateParticles(ctx, now, emittingHand, direction) {
    const amount = blizzardAmountRef.current;
    const force = blizzardForceRef.current;

    // 吹雪化: パー継続中だけ新規粒子を大量発生させる。既存粒子は自然減衰させる。
    if (isBlizzardActiveRef.current && emittingHand && amount > 0) {
      const emitDirection = direction === DIRECTIONS.NONE ? DIRECTIONS.FORWARD : direction;
      const spawnRate = 3 + (amount / 100) * 18;
      particleSpawnCarryRef.current += spawnRate;
      const spawnCount = Math.min(Math.floor(particleSpawnCarryRef.current), 24);
      particleSpawnCarryRef.current -= spawnCount;

      for (let i = 0; i < spawnCount; i += 1) {
        particlesRef.current.push(createBlizzardParticle(emittingHand.palmCenter, now, emitDirection, force));
      }
    } else {
      particleSpawnCarryRef.current = 0;
    }

    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES);
    }

    particlesRef.current = particlesRef.current.filter((particle) => {
      const age = now - particle.bornAt;
      particle.life = clamp(1 - age / particle.ttl, 0, 1);
      particle.px = particle.x;
      particle.py = particle.y;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.992;
      particle.vy = particle.vy * 0.992 + 0.006;
      particle.rotation += particle.spin;
      drawBlizzardParticle(ctx, particle);
      return particle.life > 0;
    });
  }

  function getPrimaryHand(hands) {
    return hands.reduce((largest, hand) => {
      if (!largest || hand.handScale > largest.handScale) {
        return hand;
      }
      return largest;
    }, null);
  }

  function renderFrame(landmarker) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;

    if (!video || !canvas || !frame || !streamRef.current) {
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
      animationFrameRef.current = requestAnimationFrame(() => renderFrame(landmarker));
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    const now = performance.now();
    let hands = handsRef.current;

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      hands = (result.landmarks || []).map((landmarks, index) => {
        const category = result.handedness?.[index]?.[0];
        const points = getHandPoints(landmarks, canvas.width, canvas.height);
        return {
          ...points,
          landmarks,
          label: category?.categoryName || `Hand ${index + 1}`,
          score: category?.score || 0,
          rawCasting: isCastingPose(landmarks),
          palmOpen: isPalmOpenPose(landmarks, category?.categoryName)
        };
      });
      handsRef.current = hands;

      const primaryHand = getPrimaryHand(hands);
      currentPalmDirectionRef.current = getPalmDirection(primaryHand, previousPalmRef.current, canvas.width, canvas.height);
      previousPalmRef.current = primaryHand
        ? {
            palmCenter: primaryHand.palmCenter,
            handScale: primaryHand.handScale
          }
        : null;
      updateBlizzardState(Boolean(primaryHand?.palmOpen), now);
    }

    const hasCastingPose = hands.some((hand) => hand.rawCasting);
    castHoldRef.current = hasCastingPose
      ? Math.min(castHoldRef.current + 1, 4)
      : Math.max(castHoldRef.current - 1, 0);
    const casting = castHoldRef.current >= 2;
    const primaryHand = getPrimaryHand(hands);

    updateParticles(ctx, now, primaryHand, currentPalmDirectionRef.current);
    drawHud(ctx, currentPalmDirectionRef.current, isPalmOpenRef.current);

    if (debugEnabledRef.current) {
      hands.forEach((hand) => drawHandDebug(ctx, hand, casting));
    }

    const nextStatus =
      hands.length === 0
        ? { statusState: "waiting", statusText: "手を画面内に入れてください" }
        : isBlizzardActiveRef.current
          ? { statusState: "detecting", statusText: "手のひらから吹雪を噴射中" }
          : isPalmOpenRef.current
            ? { statusState: "waiting", statusText: "パーを維持すると吹雪が出ます" }
            : { statusState: "waiting", statusText: "手のひらをパーに開いてください" };

    updateUi({
      ...nextStatus,
      isCasting: casting,
      isPalmOpen: isPalmOpenRef.current,
      handCount: hands.length,
      currentPalmDirection: currentPalmDirectionRef.current
    });

    animationFrameRef.current = requestAnimationFrame(() => renderFrame(landmarker));
  }

  function takeScreenshot() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `ice-magic-ar-${Date.now()}.png`;
    link.click();
  }

  useEffect(() => {
    return () => {
      stopCamera();
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
    };
  }, []);

  return (
    <main className="app-shell ice-app">
      <section className="hero-card ice-hero">
        <p className="eyebrow">ICE MAGIC AR</p>
        <h1>氷の魔法ポーズAR</h1>
        <p className="lead">
          手のひらをパーに開いて0.3秒維持すると、手のひら中心から大量の吹雪が噴き出します。
          閉じると新しい吹雪は即停止し、残った粒子だけ自然に消えます。
        </p>

        <div className="action-row">
          <button className="primary-button" type="button" onClick={startCamera}>
            カメラ起動
          </button>
          <button className="secondary-button" type="button" onClick={stopCamera}>
            停止
          </button>
          <button className="secondary-button" type="button" onClick={takeScreenshot}>
            スクリーンショット
          </button>
          <a className="secondary-link" href="../">
            メニューへ
          </a>
          <p className={`status-pill status-pill--${statusState}`}>{statusText}</p>
        </div>
      </section>

      <section className="viewer-card">
        <div ref={frameRef} className="canvas-frame ice-frame">
          <canvas ref={canvasRef} aria-label="氷の魔法ポーズARのプレビュー" />
          <video ref={videoRef} playsInline muted />
          {!cameraActive && <div className="canvas-placeholder">前面カメラで起動</div>}
        </div>

        <div className="info-panel ice-info">
          <div>
            <p className="info-label">Hands</p>
            <p className="info-value">{handCount} / 2</p>
          </div>
          <div>
            <p className="info-label">Palm</p>
            <p className="info-value">{isPalmOpen ? "OPEN" : "CLOSED"}</p>
          </div>
          <div>
            <p className="info-label">Casting</p>
            <p className="info-value">{isCasting ? "true" : "false"}</p>
          </div>
          <div>
            <p className="info-label">Direction</p>
            <p className="info-value">{currentPalmDirection}</p>
          </div>
        </div>

        <div className="settings-panel">
          <label className="slider-row">
            <span>吹雪の量</span>
            <strong>{blizzardAmount}</strong>
          </label>
          <input
            className="slider-input"
            type="range"
            min="0"
            max="100"
            step="1"
            value={blizzardAmount}
            onChange={(event) => setBlizzardAmount(Number(event.target.value))}
          />

          <label className="slider-row">
            <span>吹雪の勢い</span>
            <strong>{blizzardForce}</strong>
          </label>
          <input
            className="slider-input"
            type="range"
            min="0"
            max="100"
            step="1"
            value={blizzardForce}
            onChange={(event) => setBlizzardForce(Number(event.target.value))}
          />

          <label className="toggle-row">
            <span>座標デバッグ表示</span>
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(event) => setDebugEnabled(event.target.checked)}
            />
          </label>
        </div>
      </section>

      <section className="notes-card">
        <h2>検出内容</h2>
        <ul>
          <li>左右の手を最大2つまで認識</li>
          <li>4本以上の指が伸びていればパーとして判定</li>
          <li>パーが0.3秒以上続いたときだけ吹雪を開始</li>
          <li>既存の方向判定を吹雪の噴射方向に利用</li>
          <li>粒子数を最大{MAX_PARTICLES}個に制限</li>
        </ul>
      </section>
    </main>
  );
}
