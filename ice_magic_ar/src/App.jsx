import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const INDEX_TIP = 8;
const PALM_ANCHORS = [0, 5, 9, 13, 17];
const MAX_PARTICLES = 90;

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

function getHandPoints(landmarks, width, height) {
  return {
    indexTip: mirrorPoint(landmarks[INDEX_TIP], width, height),
    wrist: mirrorPoint(landmarks[WRIST], width, height),
    palmCenter: averageLandmark(landmarks, PALM_ANCHORS, width, height)
  };
}

function getHandScale(landmarks) {
  const palmWidth = distance(landmarks[5], landmarks[17]);
  const palmLength = distance(landmarks[0], landmarks[9]);
  return Math.max(palmWidth, palmLength);
}

function isCastingPose(landmarks) {
  const handScale = getHandScale(landmarks);
  const palmOpen = distance(landmarks[4], landmarks[20]) > handScale * 1.45;
  const indexAwayFromWrist = distance(landmarks[INDEX_TIP], landmarks[WRIST]) > handScale * 1.15;
  return handScale > 0.17 && palmOpen && indexAwayFromWrist;
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

function createParticle(origin, now) {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
  const speed = 0.7 + Math.random() * 1.8;

  return {
    x: origin.x + (Math.random() - 0.5) * 24,
    y: origin.y + (Math.random() - 0.5) * 24,
    vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 0.8,
    vy: Math.sin(angle) * speed - Math.random() * 0.9,
    size: 5 + Math.random() * 9,
    life: 1,
    bornAt: now,
    ttl: 700 + Math.random() * 550,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.08,
    color: Math.random() > 0.35 ? "#dff8ff" : "#9ee7ff"
  };
}

function drawHandDebug(ctx, hand, isCasting) {
  const { indexTip, wrist, palmCenter, label } = hand;
  ctx.save();
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

  const [cameraActive, setCameraActive] = useState(false);
  const [statusText, setStatusText] = useState("カメラを起動してください");
  const [statusState, setStatusState] = useState("waiting");
  const [isCasting, setIsCasting] = useState(false);
  const [handCount, setHandCount] = useState(0);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const debugEnabledRef = useRef(debugEnabled);
  const lastUiRef = useRef({
    statusText: "カメラを起動してください",
    statusState: "waiting",
    isCasting: false,
    handCount: 0
  });

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
  }, [debugEnabled]);

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
    setCameraActive(false);
    setIsCasting(false);
    setHandCount(0);
    setStatusState("waiting");
    setStatusText("カメラを起動してください");
    lastUiRef.current = {
      statusText: "カメラを起動してください",
      statusState: "waiting",
      isCasting: false,
      handCount: 0
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
    lastUiRef.current = next;
  }

  function updateParticles(ctx, now, castingHands) {
    if (castingHands.length > 0 && particlesRef.current.length < MAX_PARTICLES) {
      castingHands.forEach((hand) => {
        for (let i = 0; i < 2; i += 1) {
          particlesRef.current.push(createParticle(hand.indexTip, now));
        }
      });
    }

    particlesRef.current = particlesRef.current.filter((particle) => {
      const age = now - particle.bornAt;
      particle.life = clamp(1 - age / particle.ttl, 0, 1);
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.018;
      particle.rotation += particle.spin;
      drawSnowCrystal(ctx, particle);
      return particle.life > 0;
    });
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
    }

    const hasCastingPose = hands.some((hand) => hand.rawCasting);
    castHoldRef.current = hasCastingPose
      ? Math.min(castHoldRef.current + 1, 4)
      : Math.max(castHoldRef.current - 1, 0);
    const casting = castHoldRef.current >= 2;

    const castingHands = casting ? hands.filter((hand) => hand.rawCasting) : [];
    updateParticles(ctx, now, castingHands);

    if (debugEnabledRef.current) {
      ctx.font = "700 13px sans-serif";
      hands.forEach((hand) => drawHandDebug(ctx, hand, casting));
    }

    const nextStatus =
      hands.length === 0
        ? { statusState: "waiting", statusText: "手を画面内に入れてください" }
        : casting
          ? { statusState: "detecting", statusText: "氷の魔法を発動中" }
          : { statusState: "waiting", statusText: "手のひらをカメラに近づけてください" };

    updateUi({
      ...nextStatus,
      isCasting: casting,
      handCount: hands.length
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
          手を認識し、手のひらを前に出すポーズで雪の結晶パーティクルを出します。
          第一段階として、座標デバッグと軽量な演出を優先しています。
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
        </div>

        <div className="settings-panel">
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
          <li>人差し指先、手首、手のひら中心をCanvasに表示</li>
          <li>手のひらが大きく見える状態を、手を前に出したポーズとして判定</li>
          <li>粒子数を最大{MAX_PARTICLES}個に制限</li>
        </ul>
      </section>
    </main>
  );
}
