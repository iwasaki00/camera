import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const BUILD_UPDATED_AT = "2026-05-23 20:05:00 +09:00";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const FORMULAS = [
  "∂f/∂x",
  "E = mc²",
  "∫ f(x)dx",
  "Σ n=1..∞",
  "x² + y² = z²",
  "Δv / Δt",
  "sin θ",
  "lim x→∞",
  "A=[1 2;3 4]",
  "det(A)",
  "∇ · F = 0",
  "λ = h / p",
  "ω = 2πf",
  "P(A|B)",
  "e^(iπ)+1=0",
  "∮ E·dl = 0",
  "dx/dt = ax",
  "r = a(1-e²)",
  "cosh x",
  "φ = (1+√5)/2"
];

const LEFT_EYE = 33;
const RIGHT_EYE = 263;
const NOSE_TIP = 1;
const LEFT_BROW_INNER = 105;
const RIGHT_BROW_INNER = 334;
const UPPER_LIP = 13;
const LOWER_LIP = 14;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function mirrorPoint(point, width, height) {
  return {
    x: width - point.x * width,
    y: point.y * height
  };
}

function getFaceMetrics(landmarks, width, height) {
  const nose = mirrorPoint(landmarks[NOSE_TIP], width, height);
  const leftEye = mirrorPoint(landmarks[LEFT_EYE], width, height);
  const rightEye = mirrorPoint(landmarks[RIGHT_EYE], width, height);
  const browLeft = mirrorPoint(landmarks[LEFT_BROW_INNER], width, height);
  const browRight = mirrorPoint(landmarks[RIGHT_BROW_INNER], width, height);
  const upperLip = mirrorPoint(landmarks[UPPER_LIP], width, height);
  const lowerLip = mirrorPoint(landmarks[LOWER_LIP], width, height);

  const eyeDistance = distance(leftEye, rightEye);
  const mouthOpen = distance(upperLip, lowerLip) / Math.max(eyeDistance, 1);
  const browDistance = distance(browLeft, browRight) / Math.max(eyeDistance, 1);
  const thinking =
    mouthOpen < 0.055 ||
    browDistance < 0.88;

  return {
    nose,
    eyeDistance,
    mouthOpen,
    browDistance,
    thinking,
    intensity: thinking ? 1 : 0.45
  };
}

function drawMirroredVideo(ctx, source, width, height) {
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

function drawFormulaLayer(ctx, metrics, now) {
  const formulaCount = metrics.thinking ? 22 : 12;
  const baseRadius = metrics.eyeDistance * 0.85;
  const opacityBase = metrics.thinking ? 0.72 : 0.45;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.shadowColor = "rgba(255,255,255,0.12)";
  ctx.shadowBlur = 10;

  for (let index = 0; index < formulaCount; index += 1) {
    const formula = FORMULAS[index % FORMULAS.length];
    const ring = Math.floor(index / 6);
    const angle = (Math.PI * 2 * index) / formulaCount + now / 2600;
    const radius = baseRadius + ring * 42 + Math.sin(now / 900 + index) * 10;
    const x = metrics.nose.x + Math.cos(angle) * radius;
    const y = metrics.nose.y - metrics.eyeDistance * 0.08 + Math.sin(angle * 1.3) * radius * 0.28;
    const alpha = opacityBase * (0.65 + (Math.sin(now / 700 + index * 0.9) + 1) * 0.18);
    const fontSize = 18 + (index % 4) * 4 + ring * 2;

    ctx.globalAlpha = clamp(alpha, 0.18, 0.82);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 ${fontSize}px "Marker Felt", "Comic Sans MS", cursive`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(now / 2100 + index) * 0.08);
    ctx.strokeText(formula, 0, 0);
    ctx.fillText(formula, 0, 0);
    ctx.restore();
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

function drawGeniusOverlay(ctx, metrics, now) {
  drawFormulaLayer(ctx, metrics, now);

  const drift = Math.sin(now / 1600) * metrics.eyeDistance * 0.08;
  const pulse = 1 + Math.sin(now / 1400) * 0.04;

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

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(0);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const uiRef = useRef({
    status: "待機中",
    statusState: "idle",
    message: "前面カメラで天才風フィルターを開始できます。",
    error: "",
    thinking: false
  });

  const [statusText, setStatusText] = useState("待機中");
  const [statusState, setStatusState] = useState("idle");
  const [message, setMessage] = useState("前面カメラで天才風フィルターを開始できます。");
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);

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

  async function ensureLandmarker() {
    if (faceLandmarkerRef.current) {
      return faceLandmarkerRef.current;
    }

    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
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

    faceLandmarkerRef.current = landmarker;
    return landmarker;
  }

  function stopCamera() {
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    lastVideoTimeRef.current = -1;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }

  function renderLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = faceLandmarkerRef.current;

    if (!video || !canvas || !landmarker || !streamRef.current) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrameRef.current = window.requestAnimationFrame(renderLoop);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    drawMirroredVideo(ctx, video, canvas.width, canvas.height);

    if (video.currentTime === lastVideoTimeRef.current) {
      animationFrameRef.current = window.requestAnimationFrame(renderLoop);
      return;
    }

    lastVideoTimeRef.current = video.currentTime;
    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);
    const faceLandmarks = result.faceLandmarks?.[0];

    if (!faceLandmarks) {
      updateUi({
        status: "待機中",
        statusState: "waiting",
        message: "顔を正面に向けると数式と図形を重ねます。",
        error: "",
        thinking: false
      });
      animationFrameRef.current = window.requestAnimationFrame(renderLoop);
      return;
    }

    const metrics = getFaceMetrics(faceLandmarks, canvas.width, canvas.height);
    drawGeniusOverlay(ctx, metrics, now);
    updateUi({
      status: metrics.thinking ? "考え中モード" : "顔を検出中",
      statusState: "detecting",
      message: metrics.thinking
        ? "眉間の緊張や口の閉じ方を検出して式の量を増やしています。"
        : "通常モードで数式と幾何学オブジェクトを表示しています。",
      error: "",
      thinking: metrics.thinking
    });

    animationFrameRef.current = window.requestAnimationFrame(renderLoop);
  }

  async function startCamera() {
    stopCamera();
    updateUi({
      status: "起動準備中",
      statusState: "waiting",
      message: "カメラと顔認識モデルを準備しています。",
      error: "",
      thinking: false
    });

    try {
      await ensureLandmarker();

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではカメラ API を利用できません。");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 960 }
        }
      });

      streamRef.current = stream;
      if (!videoRef.current) {
        throw new Error("video 要素を初期化できませんでした。");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
      renderLoop();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      updateUi({
        status: "エラー",
        statusState: "error",
        message: "カメラの起動に失敗しました。",
        error: detail,
        thinking: false
      });
      stopCamera();
    }
  }

  function takeScreenshot() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `genius-filter-${Date.now()}.png`;
    link.click();
  }

  useEffect(() => {
    return () => {
      stopCamera();
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">GENIUS FILTER</p>
        <h1>考えている風フィルター</h1>
        <p className="updated-at">更新日時: {BUILD_UPDATED_AT}</p>
        <p className="lead">
          数式、幾何学オブジェクト、XYZ 軸、ベクトルを顔の周辺へ追従表示します。
          口を閉じるか眉間が寄ると、考え中モードで数式量を増やします。
        </p>

        <div className="action-row">
          <button className="primary-button" type="button" onClick={startCamera}>
            カメラ起動
          </button>
          <button className="secondary-button" type="button" onClick={takeScreenshot}>
            スクリーンショット
          </button>
          <p className={`status-pill status-pill--${statusState}`}>{statusText}</p>
        </div>
      </section>

      <section className="viewer-card">
        <div className="canvas-frame">
          <canvas ref={canvasRef} aria-label="考えている風フィルターのプレビュー" />
          <video ref={videoRef} playsInline muted />
          {!cameraActive && <div className="canvas-placeholder">前面カメラで起動</div>}
        </div>

        <div className="info-panel">
          <div>
            <p className="info-label">モード</p>
            <p className="info-value">{thinkingMode ? "考え中モード" : "通常モード"}</p>
          </div>
          <div>
            <p className="info-label">メッセージ</p>
            <p className="info-message">{message}</p>
          </div>
        </div>

        {error ? <p className="error-box">{error}</p> : null}
      </section>

      <section className="notes-card">
        <h2>機能</h2>
        <ul>
          <li>前面カメラと MediaPipe Face Landmarker によるリアルタイム顔追従</li>
          <li>白いチョーク風の数式オーバーレイ、フェード、揺れ、浮遊アニメーション</li>
          <li>球体ワイヤーフレーム、円錐断面、XYZ 軸、幾何学図形、ベクトル矢印</li>
          <li>Canvas 合成結果のスクリーンショット保存</li>
          <li>GitHub Pages 公開を想定した Vite 構成</li>
        </ul>
      </section>
    </main>
  );
}
