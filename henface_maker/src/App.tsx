import { useEffect, useMemo, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const BUILD_UPDATED_AT = "2026-05-23 21:12:00 +09:00";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type PartId = "brows" | "eyes" | "ears" | "cheeks" | "nose" | "mouth" | "head" | "jaw";
type AccidentType = "light" | "major" | "alien" | "horror" | "gag" | "handsome";

type PartConfig = {
  size: number;
  distance: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};

type EffectState = Record<PartId, PartConfig>;
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type PartDefinition = {
  id: PartId;
  label: string;
  pair: boolean;
  supportsDistance: boolean;
  supportsScaleXY: boolean;
};

type Diagnosis = {
  level: number;
  label: string;
  stars: string;
};

const PART_DEFS: PartDefinition[] = [
  { id: "brows", label: "眉", pair: true, supportsDistance: true, supportsScaleXY: false },
  { id: "eyes", label: "目", pair: true, supportsDistance: true, supportsScaleXY: false },
  { id: "ears", label: "耳", pair: true, supportsDistance: true, supportsScaleXY: false },
  { id: "cheeks", label: "頬", pair: true, supportsDistance: true, supportsScaleXY: false },
  { id: "nose", label: "鼻", pair: false, supportsDistance: false, supportsScaleXY: true },
  { id: "mouth", label: "口", pair: false, supportsDistance: false, supportsScaleXY: true },
  { id: "head", label: "頭", pair: false, supportsDistance: false, supportsScaleXY: true },
  { id: "jaw", label: "顎", pair: false, supportsDistance: false, supportsScaleXY: true }
];

const PART_IDS = PART_DEFS.map((part) => part.id);

const DEFAULT_PART: PartConfig = {
  size: 1,
  distance: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1
};

const ANALYSIS_MESSAGES = [
  "解析中…",
  "顔面再構築中…",
  "危険な顔を生成しています…",
  "パーツ事故率を調整中…"
];

const DIAGNOSIS_CLASSES = [
  "寝不足の宇宙人",
  "無表情なのに圧が強い人",
  "深夜テンションの天才",
  "休日に寝坊した俳優",
  "妙に整った珍生物",
  "ちょっと寄りすぎたイケメン"
];

const PART_INDEXES: Record<PartId, number[][]> = {
  brows: [
    [70, 63, 105, 66, 107, 55],
    [336, 296, 334, 293, 300, 285]
  ],
  eyes: [
    [33, 133, 159, 145, 158, 153, 160, 144],
    [362, 263, 386, 374, 387, 373, 385, 380]
  ],
  ears: [
    [127, 234, 93, 132, 58],
    [356, 454, 323, 361, 288]
  ],
  cheeks: [
    [116, 117, 118, 50, 101, 205],
    [345, 346, 347, 280, 330, 425]
  ],
  nose: [[6, 1, 2, 98, 327, 168, 197]],
  mouth: [[61, 291, 13, 14, 78, 308, 0, 17]],
  head: [[10, 67, 109, 338, 297, 103, 332]],
  jaw: [[152, 148, 176, 149, 150, 377, 400, 378]]
};

const PRESETS: Record<"surprise" | "alien" | "uncle", Partial<EffectState>> = {
  surprise: {
    eyes: { ...DEFAULT_PART, size: 1.45, distance: 0.08, opacity: 1.15 },
    brows: { ...DEFAULT_PART, size: 1.18, distance: 0.05, opacity: 1.08 },
    mouth: { ...DEFAULT_PART, size: 1.2, scaleX: 0.82, scaleY: 1.45, opacity: 1.1 },
    jaw: { ...DEFAULT_PART, size: 1.12, scaleX: 1.05, scaleY: 1.24, opacity: 1 }
  },
  alien: {
    eyes: { ...DEFAULT_PART, size: 1.72, distance: 0.11, opacity: 1.22 },
    head: { ...DEFAULT_PART, size: 1.24, scaleX: 1.1, scaleY: 1.42, opacity: 1.08 },
    nose: { ...DEFAULT_PART, size: 0.74, scaleX: 0.72, scaleY: 0.82, opacity: 0.82 },
    jaw: { ...DEFAULT_PART, size: 0.82, scaleX: 0.84, scaleY: 0.8, opacity: 0.92 }
  },
  uncle: {
    brows: { ...DEFAULT_PART, size: 1.16, distance: -0.04, opacity: 1.25 },
    cheeks: { ...DEFAULT_PART, size: 1.26, distance: -0.03, opacity: 1.05 },
    nose: { ...DEFAULT_PART, size: 1.14, scaleX: 1.16, scaleY: 1.08, opacity: 1.08 },
    mouth: { ...DEFAULT_PART, size: 1.08, scaleX: 1.15, scaleY: 0.86, opacity: 1.08 }
  }
};

function createDefaultState(): EffectState {
  return {
    brows: { ...DEFAULT_PART },
    eyes: { ...DEFAULT_PART },
    ears: { ...DEFAULT_PART },
    cheeks: { ...DEFAULT_PART },
    nose: { ...DEFAULT_PART },
    mouth: { ...DEFAULT_PART },
    head: { ...DEFAULT_PART },
    jaw: { ...DEFAULT_PART }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let next = Math.imul(t ^ (t >>> 15), t | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function mirrorPoint(point: { x: number; y: number }, width: number, height: number): Point {
  return {
    x: width - point.x * width,
    y: point.y * height
  };
}

function boundsFromIndexes(
  landmarks: { x: number; y: number }[],
  indexes: number[],
  width: number,
  height: number,
  padding = 16
): Rect {
  const points = indexes.map((index) => mirrorPoint(landmarks[index], width, height));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.max(0, Math.min(...xs) - padding);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxX = Math.min(width, Math.max(...xs) + padding);
  const maxY = Math.min(height, Math.max(...ys) + padding);
  return {
    x: minX,
    y: minY,
    width: Math.max(8, maxX - minX),
    height: Math.max(8, maxY - minY)
  };
}

function getFaceCenter(landmarks: { x: number; y: number }[], width: number, height: number): Point {
  const nose = mirrorPoint(landmarks[1], width, height);
  const brow = mirrorPoint(landmarks[168], width, height);
  return {
    x: (nose.x + brow.x) / 2,
    y: (nose.y + brow.y) / 2
  };
}

function drawMirroredVideo(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number
): void {
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

function applyPartFilter(ctx: CanvasRenderingContext2D, opacity: number): void {
  const contrast = 1 + (opacity - 1) * 0.85;
  const brightness = 1 + (opacity - 1) * 0.12;
  ctx.filter = `contrast(${Math.max(0.25, contrast)}) brightness(${Math.max(0.65, brightness)})`;
}

function drawTransformedPart(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  rect: Rect,
  config: PartConfig,
  faceCenter: Point,
  pairDirection = 0
): void {
  const partCenter = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
  const vectorX = partCenter.x - faceCenter.x;
  const vectorY = partCenter.y - faceCenter.y;
  const norm = Math.hypot(vectorX, vectorY) || 1;
  const shiftBase = config.distance * Math.max(rect.width, rect.height);
  const shiftX = pairDirection === 0 ? 0 : (vectorX / norm) * shiftBase;
  const shiftY = pairDirection === 0 ? 0 : (vectorY / norm) * shiftBase * 0.28;

  ctx.save();
  ctx.globalAlpha = clamp(config.opacity, 0.15, 1.5);
  applyPartFilter(ctx, config.opacity);
  ctx.translate(partCenter.x + shiftX, partCenter.y + shiftY);
  ctx.scale(config.size * config.scaleX, config.size * config.scaleY);
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    -rect.width / 2,
    -rect.height / 2,
    rect.width,
    rect.height
  );
  ctx.restore();
}

function drawPartSet(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  landmarks: { x: number; y: number }[],
  width: number,
  height: number,
  partId: PartId,
  config: PartConfig
): void {
  const definitions = PART_INDEXES[partId];
  const faceCenter = getFaceCenter(landmarks, width, height);
  const padding = partId === "head" ? 28 : partId === "jaw" ? 22 : 16;

  definitions.forEach((indexes, index) => {
    const rect = boundsFromIndexes(landmarks, indexes, width, height, padding);
    const pairDirection = definitions.length === 2 ? (index === 0 ? -1 : 1) : 0;
    drawTransformedPart(ctx, source, rect, config, faceCenter, pairDirection);
  });
}

function setPart(state: EffectState, partId: PartId, patch: Partial<PartConfig>): EffectState {
  return {
    ...state,
    [partId]: {
      ...state[partId],
      ...patch
    }
  };
}

function resetPart(state: EffectState, partId: PartId): EffectState {
  return setPart(state, partId, DEFAULT_PART);
}

function applyPreset(name: keyof typeof PRESETS): EffectState {
  const next = createDefaultState();
  const preset = PRESETS[name];
  let merged = next;
  (Object.keys(preset) as PartId[]).forEach((partId) => {
    merged = setPart(merged, partId, preset[partId] ?? {});
  });
  return merged;
}

function buildStars(level: number): string {
  const count = clamp(Math.round(level / 20), 1, 5);
  return "★".repeat(count).padEnd(5, "☆");
}

function buildDiagnosis(level: number, label: string): string {
  return `顔面事故レベル: ${level} / 分類: ${label} / 危険度: ${buildStars(level)}`;
}

function buildAccidentState(accidentType: AccidentType, accidentRate: number, seed: number): {
  state: EffectState;
  diagnosis: Diagnosis;
} {
  const random = mulberry32(seed);
  const severity = accidentRate / 100;
  let next = createDefaultState();

  const ranges: Record<AccidentType, { min: number; max: number }> = {
    light: { min: 0.88, max: 1.18 },
    major: { min: 0.62, max: 1.68 },
    alien: { min: 0.54, max: 1.92 },
    horror: { min: 0.42, max: 1.88 },
    gag: { min: 0.36, max: 2.08 },
    handsome: { min: 0.92, max: 1.2 }
  };

  const range = ranges[accidentType];
  PART_DEFS.forEach((part) => {
    const size = lerp(1, range.min + (range.max - range.min) * random(), severity);
    const scaleX = lerp(1, range.min + (range.max - range.min) * random(), severity);
    const scaleY = lerp(1, range.min + (range.max - range.min) * random(), severity);
    const opacity = clamp(0.5 + random() * (0.9 + severity * 0.55), 0.25, 1.5);
    const distance = part.supportsDistance ? (random() * 2 - 1) * 0.28 * severity : 0;

    next = setPart(next, part.id, {
      size: clamp(size, 0.35, 2.2),
      distance,
      scaleX: clamp(scaleX, 0.35, 2.2),
      scaleY: clamp(scaleY, 0.35, 2.2),
      opacity
    });
  });

  const level = Math.round(22 + severity * 72 + random() * 10);
  const label = DIAGNOSIS_CLASSES[Math.floor(random() * DIAGNOSIS_CLASSES.length)];

  return {
    state: next,
    diagnosis: {
      level,
      label,
      stars: buildStars(level)
    }
  };
}

const PRESET_DIAGNOSIS: Record<keyof typeof PRESETS, string> = {
  surprise: buildDiagnosis(42, "びっくり顔"),
  alien: buildDiagnosis(79, "宇宙人顔"),
  uncle: buildDiagnosis(51, "おじさん顔")
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState("待機中");
  const [message, setMessage] = useState("前面カメラで起動して、顔のパーツをリアルタイムに変形できます。");
  const [error, setError] = useState("");
  const [activePart, setActivePart] = useState<PartId>("eyes");
  const [effectState, setEffectState] = useState<EffectState>(createDefaultState);
  const [accidentType, setAccidentType] = useState<AccidentType>("light");
  const [accidentRate, setAccidentRate] = useState(65);
  const [diagnosis, setDiagnosis] = useState(buildDiagnosis(32, "調整前の素顔"));
  const [loadingOverlay, setLoadingOverlay] = useState("");

  const activePartDef = useMemo(
    () => PART_DEFS.find((item) => item.id === activePart) ?? PART_DEFS[0],
    [activePart]
  );

  function getSourceCanvas(): HTMLCanvasElement {
    if (!sourceCanvasRef.current) {
      sourceCanvasRef.current = document.createElement("canvas");
    }
    return sourceCanvasRef.current;
  }

  async function ensureLandmarker(): Promise<FaceLandmarker> {
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

  function stopCamera(): void {
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    lastVideoTimeRef.current = -1;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }

  function renderLoop(): void {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sourceCanvas = getSourceCanvas();
    const landmarker = faceLandmarkerRef.current;

    if (!video || !canvas || !landmarker || !streamRef.current) {
      return;
    }

    const ctx = canvas.getContext("2d");
    const sourceCtx = sourceCanvas.getContext("2d");
    if (!ctx || !sourceCtx) {
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      sourceCanvas.width = video.videoWidth;
      sourceCanvas.height = video.videoHeight;
    }

    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    drawMirroredVideo(sourceCtx, video, sourceCanvas.width, sourceCanvas.height);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    if (video.currentTime === lastVideoTimeRef.current) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    lastVideoTimeRef.current = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());
    const landmarks = result.faceLandmarks?.[0];

    if (!landmarks) {
      setStatus("待機中");
      setMessage("顔を画面の中央に寄せると、パーツ変形を反映します。");
      setError("");
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    PART_IDS.forEach((partId) => {
      drawPartSet(ctx, sourceCanvas, landmarks, canvas.width, canvas.height, partId, effectState[partId]);
    });

    setStatus("顔を検出中");
    setMessage("下のパネルからパーツごとの大きさ、距離、縦横、濃さを調整できます。");
    setError("");
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }

  async function startCamera(): Promise<void> {
    stopCamera();
    setStatus("起動中");
    setMessage("カメラと顔認識モデルを起動しています。");
    setError("");

    try {
      await ensureLandmarker();

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではカメラ API が使えません。");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 960 }
        }
      });

      const video = videoRef.current;
      if (!video) {
        throw new Error("video 要素を初期化できませんでした。");
      }

      getSourceCanvas();
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      renderLoop();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setStatus("エラー");
      setMessage("カメラの起動に失敗しました。");
      setError(detail);
      stopCamera();
    }
  }

  function takeScreenshot(): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `henface-maker-${Date.now()}.png`;
    link.click();
  }

  function updatePart(partId: PartId, patch: Partial<PartConfig>): void {
    setEffectState((current) => setPart(current, partId, patch));
  }

  function resetCurrentPart(): void {
    setEffectState((current) => resetPart(current, activePart));
  }

  function resetAll(): void {
    setEffectState(createDefaultState());
    setDiagnosis(buildDiagnosis(32, "調整前の素顔"));
  }

  function randomizeFace(): void {
    const random = mulberry32(Date.now() ^ Math.floor(Math.random() * 1000000));
    let next = createDefaultState();

    PART_DEFS.forEach((part) => {
      next = setPart(next, part.id, {
        size: clamp(0.7 + random() * 0.9, 0.45, 1.8),
        distance: part.supportsDistance ? random() * 0.32 - 0.16 : 0,
        scaleX: clamp(0.7 + random() * 0.9, 0.45, 1.8),
        scaleY: clamp(0.7 + random() * 0.9, 0.45, 1.8),
        opacity: clamp(0.55 + random() * 0.75, 0.3, 1.45)
      });
    });

    const level = Math.round(35 + random() * 40);
    setEffectState(next);
    setDiagnosis(buildDiagnosis(level, "ランダム事故顔"));
  }

  function applyNamedPreset(name: keyof typeof PRESETS): void {
    setEffectState(applyPreset(name));
    setDiagnosis(PRESET_DIAGNOSIS[name]);
  }

  function runAccident(): void {
    const seed = Date.now() ^ ((accidentRate + 1) * 7919) ^ Math.floor(Math.random() * 1000000);
    setLoadingOverlay(ANALYSIS_MESSAGES[seed % ANALYSIS_MESSAGES.length]);

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      const result = buildAccidentState(accidentType, accidentRate, seed);
      setEffectState(result.state);
      setDiagnosis(buildDiagnosis(result.diagnosis.level, result.diagnosis.label));
      setLoadingOverlay("");
      timeoutRef.current = null;
    }, 500);
  }

  useEffect(() => {
    return () => {
      stopCamera();
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
    };
  }, []);

  return (
    <main className="henface-app">
      <section className="hero-card">
        <p className="eyebrow">HENFACE MAKER</p>
        <h1>変顔メーカー</h1>
        <p className="updated-at">更新日時: {BUILD_UPDATED_AT}</p>
        <p className="lead">
          iPhone Safari を前提にした、顔パーツ変形アプリです。前面カメラで 1 人の顔を検出し、
          眉、目、耳、頬、鼻、口、頭、顎をリアルタイムに拡大縮小、移動、縦横変形できます。
        </p>

        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={startCamera}>
            カメラ起動
          </button>
          <button className="secondary-button" type="button" onClick={takeScreenshot}>
            スクリーンショット
          </button>
          <p className={`status-pill status-pill--${status === "エラー" ? "error" : status === "待機中" ? "waiting" : "detecting"}`}>
            {status}
          </p>
        </div>
      </section>

      <section className="viewer-card">
        <div className="preview-frame">
          <canvas ref={canvasRef} aria-label="変顔メーカーのプレビュー" />
          <video ref={videoRef} playsInline muted />
          {!cameraActive && <div className="placeholder">前面カメラで起動</div>}
          {loadingOverlay ? <div className="loading-overlay">{loadingOverlay}</div> : null}
        </div>

        <div className="summary-bar">
          <div>
            <p className="summary-label">メッセージ</p>
            <p className="summary-value">{message}</p>
          </div>
          <div>
            <p className="summary-label">診断</p>
            <p className="summary-value">{diagnosis}</p>
          </div>
        </div>

        {error ? <p className="error-box">{error}</p> : null}
      </section>

      <section className="controls-card">
        <div className="tab-row">
          {PART_DEFS.map((part) => (
            <button
              key={part.id}
              className={`tab-button ${activePart === part.id ? "is-active" : ""}`}
              type="button"
              onClick={() => setActivePart(part.id)}
            >
              {part.label}
            </button>
          ))}
        </div>

        <div className="control-grid">
          <label className="slider-row">
            <span>大きくする / 小さくする</span>
            <strong>{Math.round(effectState[activePart].size * 100)}%</strong>
          </label>
          <input
            className="slider-input"
            type="range"
            min="40"
            max="180"
            step="5"
            value={Math.round(effectState[activePart].size * 100)}
            onChange={(event) => updatePart(activePart, { size: Number(event.target.value) / 100 })}
          />

          {activePartDef.supportsDistance ? (
            <>
              <label className="slider-row">
                <span>離す / 近づける</span>
                <strong>{Math.round(effectState[activePart].distance * 100)}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="-25"
                max="25"
                step="1"
                value={Math.round(effectState[activePart].distance * 100)}
                onChange={(event) => updatePart(activePart, { distance: Number(event.target.value) / 100 })}
              />
            </>
          ) : (
            <>
              <label className="slider-row">
                <span>縦に伸ばす / 縦に縮める</span>
                <strong>{Math.round(effectState[activePart].scaleY * 100)}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="40"
                max="180"
                step="5"
                value={Math.round(effectState[activePart].scaleY * 100)}
                onChange={(event) => updatePart(activePart, { scaleY: Number(event.target.value) / 100 })}
              />
            </>
          )}

          <label className="slider-row">
            <span>{activePartDef.supportsScaleXY ? "横に伸ばす / 横に縮める" : "濃くする / 薄くする"}</span>
            <strong>
              {Math.round(
                (activePartDef.supportsScaleXY ? effectState[activePart].scaleX : effectState[activePart].opacity) * 100
              )}
              %
            </strong>
          </label>
          <input
            className="slider-input"
            type="range"
            min={activePartDef.supportsScaleXY ? "40" : "20"}
            max={activePartDef.supportsScaleXY ? "180" : "150"}
            step="5"
            value={Math.round(
              (activePartDef.supportsScaleXY ? effectState[activePart].scaleX : effectState[activePart].opacity) * 100
            )}
            onChange={(event) =>
              updatePart(
                activePart,
                activePartDef.supportsScaleXY
                  ? { scaleX: Number(event.target.value) / 100 }
                  : { opacity: Number(event.target.value) / 100 }
              )
            }
          />

          {activePartDef.supportsScaleXY ? (
            <>
              <label className="slider-row">
                <span>濃くする / 薄くする</span>
                <strong>{Math.round(effectState[activePart].opacity * 100)}%</strong>
              </label>
              <input
                className="slider-input"
                type="range"
                min="20"
                max="150"
                step="5"
                value={Math.round(effectState[activePart].opacity * 100)}
                onChange={(event) => updatePart(activePart, { opacity: Number(event.target.value) / 100 })}
              />
            </>
          ) : null}
        </div>

        <div className="button-row">
          <button className="minor-button" type="button" onClick={resetCurrentPart}>
            このパーツをリセット
          </button>
          <button className="minor-button" type="button" onClick={resetAll}>
            全部リセット
          </button>
          <button className="minor-button" type="button" onClick={randomizeFace}>
            ランダム変顔
          </button>
        </div>

        <div className="preset-row">
          <button className="minor-button" type="button" onClick={() => applyNamedPreset("surprise")}>
            びっくり顔
          </button>
          <button className="minor-button" type="button" onClick={() => applyNamedPreset("alien")}>
            宇宙人顔
          </button>
          <button className="minor-button" type="button" onClick={() => applyNamedPreset("uncle")}>
            おじさん顔
          </button>
        </div>

        <div className="accident-box">
          <div className="accident-head">
            <h2>🎲 ランダム事故</h2>
            <select
              className="select-input"
              value={accidentType}
              onChange={(event) => setAccidentType(event.target.value as AccidentType)}
            >
              <option value="light">軽い事故</option>
              <option value="major">大事故</option>
              <option value="alien">宇宙人事故</option>
              <option value="horror">ホラー事故</option>
              <option value="gag">ギャグ事故</option>
              <option value="handsome">イケメン事故</option>
            </select>
          </div>

          <label className="slider-row">
            <span>事故率</span>
            <strong>{accidentRate}%</strong>
          </label>
          <input
            className="slider-input"
            type="range"
            min="0"
            max="100"
            step="1"
            value={accidentRate}
            onChange={(event) => setAccidentRate(Number(event.target.value))}
          />

          <button className="primary-button accident-button" type="button" onClick={runAccident}>
            🎲 ランダム事故
          </button>
        </div>
      </section>
    </main>
  );
}
