import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const INDEX_TIP = 8;
const PALM_ANCHORS = [0, 5, 9, 13, 17, 8];
const MAX_PARTICLES = 140;
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

function getPalmDirection(hand, previousHand, width, height) {
  if (!hand || !previousHand) {
    return DIRECTIONS.NONE;
  }

  const dx = hand.palmCenter.x - previousHand.palmCenter.x;
  const dy = hand.palmCenter.y - previousHand.palmCenter.y;
  const scaleDelta = hand.handScale - previousHand.handScale;
  const moveThreshold = Math.max(12, Math.min(width, height) * 0.028);
  const scaleThreshold = 0.025;

  // 追加仕様: 前後は手の見かけサイズ変化で判定する。
  if (Math.abs(scaleDelta) > scaleThreshold) {
    return scaleDelta > 0 ? DIRECTIONS.FORWARD : DIRECTIONS.BACK;
  }

  // 追加仕様: 上下左右はCanvas上の手のひら中心座標の変化で判定する。
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
      return { x: 0, y: -1, sizeScale: 1 };
    case DIRECTIONS.DOWN:
      return { x: 0, y: 1, sizeScale: 1 };
    case DIRECTIONS.LEFT:
      return { x: -1, y: 0, sizeScale: 1 };
    case DIRECTIONS.RIGHT:
      return { x: 1, y: 0, sizeScale: 1 };
    case DIRECTIONS.FORWARD:
      return { x: 0, y: -0.25, sizeScale: 1.45 };
    case DIRECTIONS.BACK:
      return { x: 0, y: 0.2, sizeScale: 0.72 };
    default:
      return { x: 0, y: -1, sizeScale: 1 };
  }
}

function createParticle(origin, now, direction) {
  const vector = getDirectionVector(direction);
  const angle = Math.atan2(vector.y, vector.x) + (Math.random() - 0.5) * 0.75;
  const speed = 1 + Math.random() * 2.2;

  return {
    x: origin.x + (Math.random() - 0.5) * 22,
    y: origin.y + (Math.random() - 0.5) * 22,
    vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 0.5,
    vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 0.5,
    size: (5 + Math.random() * 9) * vector.sizeScale,
    life: 1,
    bornAt: now,
    ttl: 680 + Math.random() * 520,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.08,
    color: Math.random() > 0.35 ? "#dff8ff" : "#9ee7ff"
  };
}

function drawSnowCrystal(ctx, particle) {
  ctx.save();
  ctx.translate(particle.x, particle.y);
  ctx.rotate(particle.rotation);
  ctx.globalAlpha = particle.life;
  ctx.strokeStyle = particle.color;
  ctx.lineWidth = particle.size * 0.12;

  for (let i = 0; i < 6; i += 1) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -particle.size);
    ctx.moveTo(0, -particle.size * 0.62);
    ctx.lineTo(-particle.size * 0.22, -particle.size * 0.82);
    ctx.moveTo(0, -particle.size * 0.62);
    ctx.lineTo(particle.size * 0.22, -particle.size * 0.82);
    ctx.stroke();
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

function drawDirectionLabel(ctx, direction) {
  ctx.save();
  ctx.font = "700 18px sans-serif";
  ctx.fillStyle = "rgba(3, 7, 13, 0.64)";
  ctx.fillRect(12, 12, 230, 38);
  ctx.fillStyle = direction === DIRECTIONS.NONE ? "#ffffff" : "#9ee7ff";
  ctx.fillText(`Direction: ${direction}`, 24, 37);
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
  const snowAmountRef = useRef(40);
  const particleSpawnCarryRef = useRef(0);

  const [cameraActive, setCameraActive] = useState(false);
  const [statusText, setStatusText] = useState("カメラを起動してください");
  const [statusState, setStatusState] = useState("waiting");
  const [isCasting, setIsCasting] = useState(false);
  const [handCount, setHandCount] = useState(0);
  const [currentPalmDirection, setCurrentPalmDirection] = useState(DIRECTIONS.NONE);
  const [snowAmount, setSnowAmount] = useState(40);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const debugEnabledRef = useRef(debugEnabled);
  const lastUiRef = useRef({
    statusText: "カメラを起動してください",
    statusState: "waiting",
    isCasting: false,
    handCount: 0,
    currentPalmDirection: DIRECTIONS.NONE
  });

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
  }, [debugEnabled]);

  useEffect(() => {
    snowAmountRef.current = snowAmount;
  }, [snowAmount]);

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
    setCameraActive(false);
    setIsCasting(false);
    setHandCount(0);
    setCurrentPalmDirection(DIRECTIONS.NONE);
    setStatusState("waiting");
    setStatusText("カメラを起動してください");
    lastUiRef.current = {
      statusText: "カメラを起動してください",
      statusState: "waiting",
      isCasting: false,
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
    if (previous.handCount !== next.handCount) {
      setHandCount(next.handCount);
    }
    if (previous.currentPalmDirection !== next.currentPalmDirection) {
      setCurrentPalmDirection(next.currentPalmDirection);
    }
    lastUiRef.current = next;
  }

  function updateParticles(ctx, now, emittingHand, direction) {
    const snowAmountValue = snowAmountRef.current;

    // 追加仕様: DirectionがNONE以外の時だけ、手のひら中心から雪を発生させる。
    if (emittingHand && direction !== DIRECTIONS.NONE && snowAmountValue > 0) {
      const spawnRate = snowAmountValue / 25;
      particleSpawnCarryRef.current += spawnRate;
      const spawnCount = Math.min(Math.floor(particleSpawnCarryRef.current), 6);
      particleSpawnCarryRef.current -= spawnCount;

      for (let i = 0; i < spawnCount && particlesRef.current.length < MAX_PARTICLES; i += 1) {
        particlesRef.current.push(createParticle(emittingHand.palmCenter, now, direction));
      }
    } else {
      particleSpawnCarryRef.current = 0;
    }

    particlesRef.current = particlesRef.current.filter((particle) => {
      const age = now - particle.bornAt;
      particle.life = clamp(1 - age / particle.ttl, 0, 1);
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.01;
      particle.rotation += particle.spin;
      drawSnowCrystal(ctx, particle);
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
        const points = getHandPoints(landmarks, canvas.width, canvas.height);
        const category = result.handedness?.[index]?.[0];
        return {
          ...points,
          landmarks,
          label: category?.categoryName || `Hand ${index + 1}`,
          score: category?.score || 0,
          rawCasting: isCastingPose(landmarks)
        };
      });
      handsRef.current = hands;

      // 追加仕様: 左右2手がある場合も、見かけサイズが大きい手を方向判定の基準にする。
      const primaryHand = getPrimaryHand(hands);
      currentPalmDirectionRef.current = getPalmDirection(primaryHand, previousPalmRef.current, canvas.width, canvas.height);
      previousPalmRef.current = primaryHand
        ? {
            palmCenter: primaryHand.palmCenter,
            handScale: primaryHand.handScale
          }
        : null;
    }

    const hasCastingPose = hands.some((hand) => hand.rawCasting);
    castHoldRef.current = hasCastingPose
      ? Math.min(castHoldRef.current + 1, 4)
      : Math.max(castHoldRef.current - 1, 0);
    const casting = castHoldRef.current >= 2;

    const primaryHand = getPrimaryHand(hands);
    updateParticles(ctx, now, primaryHand, currentPalmDirectionRef.current);
    drawDirectionLabel(ctx, currentPalmDirectionRef.current);

    if (debugEnabledRef.current) {
      hands.forEach((hand) => drawHandDebug(ctx, hand, casting));
    }

    const nextStatus =
      hands.length === 0
        ? { statusState: "waiting", statusText: "手を画面内に入れてください" }
        : currentPalmDirectionRef.current !== DIRECTIONS.NONE
          ? { statusState: "detecting", statusText: "手のひらから雪を発生中" }
          : casting
            ? { statusState: "detecting", statusText: "氷の魔法ポーズを検出中" }
            : { statusState: "waiting", statusText: "手のひらを上下左右または前後に動かしてください" };

    updateUi({
      ...nextStatus,
      isCasting: casting,
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
          手のひらを上下左右、または前後に動かすと、手のひら中心から雪の結晶が吹き出します。
          第一段階として安定した手認識と軽量なCanvas演出を優先しています。
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
            <span>雪の量</span>
            <strong>{snowAmount}</strong>
          </label>
          <input
            className="slider-input"
            type="range"
            min="0"
            max="100"
            step="1"
            value={snowAmount}
            onChange={(event) => setSnowAmount(Number(event.target.value))}
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
          <li>手首、各指の付け根、人差し指先から手のひら中心を推定</li>
          <li>上下左右はCanvas座標の変化、前後は手のサイズ変化で判定</li>
          <li>DirectionがNONE以外の時だけ、手のひら中心から雪を発生</li>
          <li>粒子数を最大{MAX_PARTICLES}個に制限</li>
        </ul>
      </section>
    </main>
  );
}
