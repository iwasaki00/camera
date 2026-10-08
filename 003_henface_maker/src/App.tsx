import { useEffect, useMemo, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { createFeatureRenderer, RENDER_SETTINGS } from "./featureRenderer";
import type { EffectState, Landmark, PartConfig, PartId } from "./featureRenderer";

import PartSliders from "./PartSliders";
import { APP_VERSION, readLayout, saveLayout, randomizeParts } from "./uiSettings";
import type { Layout, RandomStrength } from "./uiSettings";
import type { FeatureType } from "./featureRenderer";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type AccidentType = "light" | "major" | "alien" | "horror" | "gag" | "handsome";


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

const ACTIVE_PART_IDS: FeatureType[] = ["brows", "eyes", "nose", "mouth"];
const ACTIVE_PART_DEFS = PART_DEFS.filter((part) => ACTIVE_PART_IDS.includes(part.id as FeatureType));

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
  const frameRef = useRef<HTMLDivElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ReturnType<typeof createFeatureRenderer> | null>(null);
  const lastLandmarksRef = useRef<Landmark[] | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastRenderedStateRef = useRef<EffectState | null>(null);
  const effectStateRef = useRef<EffectState>(createDefaultState());

  const [layout, setLayout] = useState<Layout>(readLayout);
  const [randomStrength, setRandomStrength] = useState<RandomStrength>("normal");
  const trackingRef = useRef<boolean | null>(null);
  const lastDrawAtRef = useRef(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState("待機中");
  const [message, setMessage] = useState("前面カメラで起動して、顔のパーツをリアルタイムに変形できます。");
  const [error, setError] = useState("");
  const [activePart, setActivePart] = useState<FeatureType>("mouth");
  const [effectState, setEffectState] = useState<EffectState>(createDefaultState);
  const [accidentType, setAccidentType] = useState<AccidentType>("light");
  const [accidentRate, setAccidentRate] = useState(65);
  const [diagnosis, setDiagnosis] = useState(buildDiagnosis(32, "調整前の素顔"));
  const [loadingOverlay, setLoadingOverlay] = useState("");

  const activePartDef = useMemo(
    () => ACTIVE_PART_DEFS.find((item) => item.id === activePart) ?? ACTIVE_PART_DEFS[0],
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
    trackingRef.current = null;
    lastDrawAtRef.current = 0;
    lastLandmarksRef.current = undefined;
    lastRenderedStateRef.current = null;
    rendererRef.current?.clearCache();

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
    const frame = frameRef.current;
    const sourceCanvas = getSourceCanvas();
    const landmarker = faceLandmarkerRef.current;

    if (!video || !canvas || !frame || !landmarker || !streamRef.current) {
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

    // Cap camera work at 30fps; parameter changes still render on the next RAF.
    const now = performance.now();
    if (lastRenderedStateRef.current === effectStateRef.current && now - lastDrawAtRef.current < 1000 / 30) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    lastDrawAtRef.current = now;
    const frameScale = Math.min(1, RENDER_SETTINGS.maxFrameDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * frameScale));
    const height = Math.max(1, Math.round(video.videoHeight * frameScale));
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) {
      canvas.width = sourceCanvas.width = width;
      canvas.height = sourceCanvas.height = height;
      frame.style.aspectRatio = width + " / " + height;
      rendererRef.current?.clearCache();
    }
    if (!resized && video.currentTime === lastVideoTimeRef.current && lastRenderedStateRef.current === effectStateRef.current) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    // Capture once. Every patch reads this immutable mirrored camera frame.
    // On repeated requestAnimationFrame callbacks keep both frame and landmarks;
    // still redraw so slider changes apply without a flash of the unprocessed video.
    if (resized || video.currentTime !== lastVideoTimeRef.current) {
      sourceCtx.clearRect(0, 0, width, height);
      drawMirroredVideo(sourceCtx, video, width, height);
      lastVideoTimeRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      lastLandmarksRef.current = result.faceLandmarks?.[0];
    }
    if (!rendererRef.current) rendererRef.current = createFeatureRenderer();
    const landmarks = lastLandmarksRef.current;
    rendererRef.current.renderFeatureEffects(sourceCanvas, ctx, landmarks, effectStateRef.current);
    lastRenderedStateRef.current = effectStateRef.current;
    const tracking = !!landmarks;
    if (trackingRef.current !== tracking) {
      trackingRef.current = tracking;
      setStatus(tracking ? "顔を検出中" : "待機中");
      setMessage(tracking ? "映像を見ながらパーツを調整できます。" : "顔を画面の中央に寄せてください。");
      setError("");
    }
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

  function randomizeActivePart(): void {
    setEffectState(current => randomizeParts(current, [activePart], randomStrength));
    setDiagnosis(activePartDef.label + "をランダム（" + randomStrength + "）");
  }
  function randomizeFace(): void {
    setEffectState(current => randomizeParts(current, ACTIVE_PART_IDS, randomStrength));
    setDiagnosis("全パーツをランダム（" + randomStrength + "）");
  }
  useEffect(() => { saveLayout(layout); }, [layout]);

  function applyNamedPreset(name: keyof typeof PRESETS): void {
    setEffectState(applyPreset(name));
    setDiagnosis(PRESET_DIAGNOSIS[name]);
  }

  function runAccident(): void {
    const seed = Date.now() ^ ((accidentRate + 1) * 7919) ^ Math.floor(Math.random() * 1000000);
    setLoadingOverlay(ANALYSIS_MESSAGES[(seed >>> 0) % ANALYSIS_MESSAGES.length]);

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
    effectStateRef.current = effectState;
  }, [effectState]);

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
    <main className={"henface-app layout-" + layout}>
      <header className="app-header">
        <div><h1>変顔メーカー</h1><p className="app-subtitle">顔エフェクトカメラ</p></div>
        <label className="layout-picker">レイアウト
          <select aria-label="レイアウト" value={layout} onChange={event => setLayout(event.target.value as Layout)}>
            <option value="standard">standard</option><option value="compact">compact</option><option value="edge-controls">edge-controls</option>
          </select>
        </label>
      </header>
      <div className="camera-toolbar">
        <button className="primary-button" type="button" disabled={status === "起動中"} onClick={cameraActive ? () => { stopCamera(); setStatus("待機中"); setMessage("カメラを停止しました。"); } : startCamera}>
          {status === "起動中" ? "起動中…" : cameraActive ? "カメラ停止" : "カメラ起動"}
        </button>
        <button className="secondary-button" type="button" disabled={!cameraActive} onClick={takeScreenshot}>写真を保存</button>
        <span className="camera-status" role="status">{status}</span>
      </div>
      <div className="camera-workspace">
        <section className="viewer-card" aria-label="カメラ映像">
          <div ref={frameRef} className="preview-frame">
            <canvas ref={canvasRef} aria-label="変顔メーカーのプレビュー" />
            <video ref={videoRef} playsInline muted />
            {!cameraActive && <div className="placeholder">カメラを起動して遊ぼう</div>}
            {loadingOverlay && <div className="loading-overlay">{loadingOverlay}</div>}
          </div>
        </section>
        <section className="controls-card" aria-label="顔パーツ調整">
          <div className="tab-row" aria-label="パーツ選択">
            {ACTIVE_PART_DEFS.map(part => <button key={part.id} type="button" aria-pressed={activePart === part.id}
              className={"tab-button " + (activePart === part.id ? "is-active" : "")} onClick={() => setActivePart(part.id as FeatureType)}>{part.label}</button>)}
          </div>
          <PartSliders config={effectState[activePart]} paired={activePartDef.supportsDistance} layout={layout}
            update={patch => updatePart(activePart, patch)} />
          <div className="main-actions">
            <button className="minor-button" type="button" aria-label="このパーツをリセット" onClick={resetCurrentPart}><span>このパーツ</span>リセット</button>
            <button className="minor-button" type="button" aria-label="全部リセット" onClick={resetAll}><span>全部</span>リセット</button>
            <button className="secondary-button" type="button" aria-label="選択パーツをランダム" onClick={randomizeActivePart}><span>選択パーツ</span>ランダム</button>
            <button className="primary-button" type="button" aria-label="全パーツをランダム" onClick={randomizeFace}><span>全パーツ</span>ランダム</button>
          </div>
          <label className="strength-picker">ランダム強度
            <select aria-label="ランダム強度" value={randomStrength} onChange={event => setRandomStrength(event.target.value as RandomStrength)}>
              <option value="weak">weak · 自然</option><option value="normal">normal · 変顔</option><option value="wild">wild · 大胆</option>
            </select>
          </label>
          <p className="diagnosis" aria-live="polite">{diagnosis}</p>
        </section>
      </div>
      {error && <p className="error-box" role="alert">{error}</p>}
      <details className="extra-tools"><summary>プリセット・その他</summary>
        <p>{message}</p>
        <div className="preset-row">
          <button type="button" className="minor-button" onClick={() => applyNamedPreset("surprise")}>びっくり顔</button>
          <button type="button" className="minor-button" onClick={() => applyNamedPreset("alien")}>宇宙人顔</button>
          <button type="button" className="minor-button" onClick={() => applyNamedPreset("uncle")}>おじさん顔</button>
        </div>
        <div className="accident-box">
          <label>ランダム事故<select aria-label="ランダム事故の種類" value={accidentType} onChange={event => setAccidentType(event.target.value as AccidentType)}>
            <option value="light">軽い事故</option><option value="major">大事故</option><option value="alien">宇宙人事故</option>
            <option value="horror">ホラー事故</option><option value="gag">ギャグ事故</option><option value="handsome">イケメン事故</option>
          </select></label>
          <label className="slider-field"><span>事故率<output>{accidentRate}%</output></span><input aria-label="事故率" type="range" min="0" max="100" value={accidentRate} onChange={event => setAccidentRate(Number(event.target.value))} /></label>
          <button className="secondary-button" type="button" onClick={runAccident}>ランダム事故を実行</button>
        </div>
        <small>バージョン {APP_VERSION}</small>
      </details>
    </main>
  );
}
