import EffectControls, { CategoryTabs } from "./EffectControls";
import type { Category } from "./EffectControls";
import { emptyFaceEffects, randomFaceEffects, applyFacePreset, FACE_PRESETS } from "./faceEffects";
import type { FaceEffects, FacePreset } from "./faceEffects";
import { advanceFrameClock, FrameMetrics, LandmarkSmoother, QUALITY_PROFILES } from "./performance";
import type { Quality } from "./performance";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { createFeatureRenderer } from "./featureRenderer";
import type { EffectState, Landmark, PartConfig, PartId } from "./featureRenderer";
import BlinkDropHud from "./game/BlinkDropHud";
import { BlinkDetector, advanceBlinkDrop, beginBlinkDrop, catchBlinkDropPart, createBlinkDropSession,
  pauseBlinkDrop, resumeBlinkDrop, startBlinkDropCountdown } from "./game/blinkDropGame";
import type { BlinkDropSession } from "./game/blinkDropGame";
import { createBlinkDropRenderer } from "./game/blinkDropRenderer";
import type { BlinkDropDebugMode } from "./game/blinkDropRenderer";

import PartSliders from "./PartSliders";
import { APP_VERSION, readLayout, readRandomStrength, readSettingsOpen, saveLayout, saveRandomStrength, saveSettingsOpen, randomizeParts } from "./uiSettings";
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
  const gameRendererRef = useRef<ReturnType<typeof createBlinkDropRenderer> | null>(null);
  const lastLandmarksRef = useRef<Landmark[] | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastRenderedStateRef = useRef<EffectState | null>(null);
  const lastGameSessionRef = useRef<BlinkDropSession | null>(null);
  const lastAppModeRef = useRef("");
  const effectStateRef = useRef<EffectState>(createDefaultState());
  const appModeRef = useRef<"camera" | "blink-drop">("camera");
  const gameSessionRef = useRef<BlinkDropSession>(createBlinkDropSession());
  const blinkDetectorRef = useRef(new BlinkDetector());
  const gameTimerRef = useRef<number | null>(null);
  const finalFrameRef = useRef<HTMLCanvasElement | null>(null);
  const gameDebugModeRef = useRef<BlinkDropDebugMode>("normal");
  const [gameDebugMode, setGameDebugMode] = useState<BlinkDropDebugMode>("normal");
  const [resultSnapshot, setResultSnapshot] = useState<string | undefined>();

  const [category, setCategory] = useState<Category>("parts");
  const [faceEffects, setFaceEffects] = useState<FaceEffects>(emptyFaceEffects);
  const faceEffectsRef = useRef(faceEffects);
  const lastExtrasRef = useRef<FaceEffects | null>(null);
  const [quality, setQuality] = useState<Quality>("auto");
  const qualityRef = useRef(quality);
  const lastQualityRef = useRef("");
  const smootherRef = useRef(new LandmarkSmoother());
  const metricsRef = useRef(new FrameMetrics());
  const lastDetectionRef = useRef(-Infinity);
  const [includeExtras, setIncludeExtras] = useState(false);
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).get("debug") === "1");
  const debugRef = useRef(debug);
  const debugPanelRef = useRef<HTMLPreElement | null>(null);
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [appMode, setAppMode] = useState<"camera" | "blink-drop">("camera");
  const [gameSession, setGameSession] = useState<BlinkDropSession>(createBlinkDropSession);
  const [settingsOpen, setSettingsOpen] = useState(readSettingsOpen);
  const [randomStrength, setRandomStrength] = useState<RandomStrength>(readRandomStrength);
  const trackingRef = useRef<boolean | null>(null);
  const lastDrawAtRef = useRef(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [faceTracked, setFaceTracked] = useState(false);
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
    lastExtrasRef.current = null;
    lastQualityRef.current = "";
    lastDetectionRef.current = -Infinity;
    smootherRef.current.reset(); metricsRef.current.reset();
    if (debugPanelRef.current) debugPanelRef.current.textContent = "カメラ起動後に1秒間隔で計測します。";
    trackingRef.current = null;
    lastDrawAtRef.current = 0;
    lastLandmarksRef.current = undefined;
    lastRenderedStateRef.current = null;
    lastGameSessionRef.current = null;
    rendererRef.current?.clearCache();
    gameRendererRef.current?.clearCache();
    blinkDetectorRef.current.reset();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setFaceTracked(false);
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

    const now = performance.now();
    // Completed has its own immutable result frame; skip capture, detection and live rendering.
    if (appModeRef.current === "blink-drop" && gameSessionRef.current.phase === "completed" && finalFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(renderLoop); return;
    }
    const level = qualityRef.current === "auto" ? metricsRef.current.autoLevel : qualityRef.current;
    const profile = QUALITY_PROFILES[level];
    const detectInterval = now < smootherRef.current.fastUntil ? Math.min(profile.detectInterval, 65) : profile.detectInterval;
    const gameActive = appModeRef.current === "blink-drop";
    const settingsChanged = lastRenderedStateRef.current !== effectStateRef.current || lastExtrasRef.current !== faceEffectsRef.current ||
      lastQualityRef.current !== level || lastGameSessionRef.current !== gameSessionRef.current || lastAppModeRef.current !== appModeRef.current;
    if (!settingsChanged && now - lastDrawAtRef.current < 1000 / profile.fps - 1) {
      animationFrameRef.current = requestAnimationFrame(renderLoop); return;
    }
    const frameScale = Math.min(1, profile.maxFrameDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * frameScale)), height = Math.max(1, Math.round(video.videoHeight * frameScale));
    const resized = canvas.width !== width || canvas.height !== height;
    const newFrame = video.currentTime !== lastVideoTimeRef.current;
    if (!newFrame && !settingsChanged && !resized) { animationFrameRef.current = requestAnimationFrame(renderLoop); return; }
    lastDrawAtRef.current = advanceFrameClock(lastDrawAtRef.current, now, profile.fps, settingsChanged);
    if (resized) {
      canvas.width = sourceCanvas.width = width; canvas.height = sourceCanvas.height = height;
      frame.style.aspectRatio = width + " / " + height;
      rendererRef.current?.clearCache();
    }
    const captureStart = performance.now();
    if (newFrame || resized) {
      sourceCtx.clearRect(0, 0, width, height); drawMirroredVideo(sourceCtx, video, width, height);
      lastVideoTimeRef.current = video.currentTime;
    }
    const captureMs = performance.now() - captureStart;
    let detectMs: number | undefined;
    if (newFrame && (now - lastDetectionRef.current >= detectInterval)) {
      const detectStart = performance.now();
      const result = landmarker.detectForVideo(video, now);
      detectMs = performance.now() - detectStart;
      lastDetectionRef.current = now;
      lastLandmarksRef.current = result.faceLandmarks?.[0];
      smootherRef.current.update(lastLandmarksRef.current, now);
      if (gameActive && gameSessionRef.current.phase === "playing" &&
        (gameDebugModeRef.current === "normal" || gameDebugModeRef.current === "parts-only") && blinkDetectorRef.current.update(lastLandmarksRef.current, now)) {
        const next = catchBlinkDropPart(gameSessionRef.current, now);
        gameSessionRef.current = next; setGameSession(next);
      }
    }
    const landmarks = smootherRef.current.sample(now);
    if (!rendererRef.current) rendererRef.current = createFeatureRenderer();
    if (!gameRendererRef.current) gameRendererRef.current = createBlinkDropRenderer();
    if (gameActive) gameRendererRef.current.render(sourceCanvas, ctx, landmarks, gameSessionRef.current, now, gameDebugModeRef.current);
    else rendererRef.current.renderFeatureEffects(sourceCanvas, ctx, landmarks, effectStateRef.current, undefined,
      { effects: faceEffectsRef.current, quality: profile });
    // Keep a normal final face if tracking disappears during the last catch animation.
    if (gameActive && landmarks && gameSessionRef.current.phase === "fixing" && gameSessionRef.current.currentIndex === 3 && !finalFrameRef.current) {
      finalFrameRef.current = gameRendererRef.current.captureResult(sourceCanvas, landmarks,
        { ...gameSessionRef.current, phase: "completed" }, now);
    }
    lastRenderedStateRef.current = effectStateRef.current;
    lastGameSessionRef.current = gameSessionRef.current; lastAppModeRef.current = appModeRef.current;
    lastExtrasRef.current = faceEffectsRef.current; lastQualityRef.current = level;
    const timings = gameActive ? gameRendererRef.current.metrics : rendererRef.current.metrics;
    if (metricsRef.current.record(now, detectMs, timings.warpMs, timings.compositeMs + captureMs, performance.now() - now)
      && debugRef.current && debugPanelRef.current) {
      const m = metricsRef.current.latest;
      debugPanelRef.current.textContent = "FPS " + m.fps.toFixed(1) + " / " + level + " / " + width + "×" + height +
        "\n顔検出 " + m.detectMs.toFixed(1) + "ms（更新時） 変形 " + m.warpMs.toFixed(1) + "ms 合成 " + m.compositeMs.toFixed(1) +
        "ms\n全処理 " + m.totalMs.toFixed(1) + "ms/frame / 格子 " + profile.patchGrid + " / 検出間隔 " + detectInterval + "ms";
    }
    const tracking = !!landmarks;
    if (trackingRef.current !== tracking) {
      trackingRef.current = tracking;
      setFaceTracked(tracking);
      setStatus(tracking ? "顔を検出中" : "待機中");
      setMessage(tracking ? "映像を見ながらパーツを調整できます。" : "顔を画面の中央に寄せてください。");
      setError("");
    }
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }

  async function startCamera(): Promise<boolean> {
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
          frameRate: { ideal: 30, max: 30 },
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
      return true;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setStatus("エラー");
      setMessage("カメラの起動に失敗しました。");
      setError(detail);
      stopCamera();
      return false;
    }
  }

  function takeScreenshot(): void {
    const canvas = appModeRef.current === "blink-drop" && gameSessionRef.current.phase === "completed"
      ? finalFrameRef.current : canvasRef.current;
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
    setFaceEffects(emptyFaceEffects());
    setDiagnosis(buildDiagnosis(32, "調整前の素顔"));
  }

  function randomizeActivePart(): void {
    setEffectState(current => randomizeParts(current, [activePart], randomStrength));
    setDiagnosis(activePartDef.label + "をランダム（" + randomStrength + "）");
  }
  function randomizeFace(): void {
    setEffectState(current => randomizeParts(current, ACTIVE_PART_IDS, randomStrength));
    if (includeExtras) setFaceEffects(randomFaceEffects(randomStrength));
    setDiagnosis((includeExtras ? "パーツ＋配置＋特殊" : "全パーツ") + "をランダム（" + randomStrength + "）");
  }
  useEffect(() => { saveLayout(layout); }, [layout]);
  useEffect(() => { saveRandomStrength(randomStrength); }, [randomStrength]);
  useEffect(() => { saveSettingsOpen(settingsOpen); }, [settingsOpen]);

  function applyNewPreset(name: FacePreset): void {
    const result = applyFacePreset(effectState, name);
    setEffectState(result.parts); setFaceEffects(result.effects); setDiagnosis(FACE_PRESETS[name]);
  }
  useEffect(() => { faceEffectsRef.current = faceEffects; }, [faceEffects]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  useEffect(() => { gameDebugModeRef.current = debug ? gameDebugMode : "normal"; }, [debug, gameDebugMode]);

  function applyNamedPreset(name: keyof typeof PRESETS): void {
    setEffectState(applyPreset(name));
    setFaceEffects(emptyFaceEffects());
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
      setFaceEffects(emptyFaceEffects());
      setDiagnosis(buildDiagnosis(result.diagnosis.level, result.diagnosis.label));
      setLoadingOverlay("");
      timeoutRef.current = null;
    }, 500);
  }

  function updateGame(next: BlinkDropSession): void {
    if (next.phase === "completed" && gameSessionRef.current.phase !== "completed") {
      const output = canvasRef.current, base = sourceCanvasRef.current;
      if (output) {
        const now = performance.now();
        const landmarks = smootherRef.current.sample(now) ?? lastLandmarksRef.current;
        const canCapture = base && landmarks && gameRendererRef.current;
        const finalFrame = canCapture
          ? gameRendererRef.current!.captureResult(base!, landmarks!, next, now)
          : finalFrameRef.current ?? document.createElement("canvas");
        const needsCopy = !canCapture && !finalFrameRef.current;
        if (needsCopy) {
          finalFrame.width = output.width; finalFrame.height = output.height;
        }
        const ctx = finalFrame.getContext("2d");
        if (ctx) {
          if (needsCopy) ctx.drawImage(output, 0, 0);
          finalFrameRef.current = finalFrame;
          setResultSnapshot(finalFrame.toDataURL("image/png"));
          output.getContext("2d")?.drawImage(finalFrame, 0, 0);
        }
      }
    } else if (next.phase === "ready" || next.phase === "countdown" || next.phase === "error") {
      finalFrameRef.current = null; setResultSnapshot(undefined);
    }
    gameSessionRef.current = next;
    setGameSession(next);
  }

  function enterBlinkDrop(): void {
    blinkDetectorRef.current.reset();
    updateGame(createBlinkDropSession());
    appModeRef.current = "blink-drop";
    setAppMode("blink-drop");
  }

  function exitBlinkDrop(): void {
    if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
    gameTimerRef.current = null;
    blinkDetectorRef.current.reset();
    updateGame(createBlinkDropSession());
    appModeRef.current = "camera";
    setAppMode("camera");
  }

  async function startBlinkDrop(): Promise<void> {
    if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
    blinkDetectorRef.current.reset();
    const available = cameraActive || await startCamera();
    if (!available) {
      updateGame({ ...createBlinkDropSession("error"), error: "カメラを起動できませんでした。" });
      return;
    }
    updateGame(startBlinkDropCountdown());
  }

  function pauseGame(): void { updateGame(pauseBlinkDrop(gameSessionRef.current, performance.now())); }
  function resumeGame(): void { blinkDetectorRef.current.reset(); updateGame(resumeBlinkDrop(gameSessionRef.current, performance.now())); }

  useEffect(() => {
    effectStateRef.current = effectState;
  }, [effectState]);

  useEffect(() => { appModeRef.current = appMode; }, [appMode]);
  useEffect(() => {
    gameSessionRef.current = gameSession;
    if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
    gameTimerRef.current = null;
    if (gameSession.phase === "countdown") {
      gameTimerRef.current = window.setTimeout(() => {
        blinkDetectorRef.current.reset(); updateGame(beginBlinkDrop(gameSessionRef.current, performance.now()));
      }, 3000);
    } else if (gameSession.phase === "fixing") {
      gameTimerRef.current = window.setTimeout(() => updateGame(advanceBlinkDrop(gameSessionRef.current, performance.now())), 450);
    }
    return () => { if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current); gameTimerRef.current = null; };
  }, [gameSession]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
    };
  }, []);

  return (
    <main className={"henface-app layout-" + layout + " mode-" + appMode} data-category={category} data-settings={settingsOpen ? "open" : "closed"}>
      <header className="app-header">
        <div><h1>{appMode === "blink-drop" ? "瞬きキャッチ" : "変顔メーカー"}</h1><p className="app-subtitle">{appMode === "blink-drop" ? "顔パーツ落下ゲーム" : "顔エフェクトカメラ"}</p></div>
        {appMode === "blink-drop" ? <button className="minor-button game-header-exit" type="button" onClick={exitBlinkDrop}>通常へ戻る</button> : <label className="layout-picker">レイアウト
          <select aria-label="レイアウト" value={layout} onChange={event => setLayout(event.target.value as Layout)}>
            <option value="standard">standard</option><option value="compact">compact</option><option value="edge-controls">edge-controls</option><option value="simple">simple</option>
          </select>
        </label>}
      </header>
      {appMode === "blink-drop" && debug && <div className="game-debug-tools">
        <label>開発表示<select aria-label="ゲームデバッグ表示" value={gameDebugMode} onChange={e => {
          const mode = e.target.value as BlinkDropDebugMode; gameDebugModeRef.current = mode; setGameDebugMode(mode);
          if (mode === "original" || mode === "blank-face" || mode === "bounds") {
            if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
            gameTimerRef.current = null;
            blinkDetectorRef.current.reset(); updateGame(createBlinkDropSession());
          }
        }} disabled={gameSession.phase === "completed"}>
          <option value="normal">normal · ゲーム</option><option value="parts-only">parts-only · パーツのみ</option>
          <option value="original">original · 元映像</option><option value="blank-face">blank-face · 消去後</option>
          <option value="bounds">bounds · 抽出範囲</option>
        </select></label>
        <small>{gameSession.phase} · {gameSession.currentIndex + 1}/4 · {faceTracked ? "顔検出中" : "顔未検出"}</small>
        <button type="button" disabled={status === "起動中" || cameraActive || gameSession.phase === "completed"} onClick={() => { void startCamera(); }}>カメラ確認</button>
        {gameDebugMode === "parts-only" && gameSession.phase === "ready" && <button type="button" onClick={() => { void startBlinkDrop(); }}>ゲームスタート</button>}
        <small>元映像・消去後・範囲表示は進行をリセットして確認</small>
        <button type="button" onClick={() => setDebug(false)}>デバッグOFF</button>
      </div>}
      {appMode === "camera" && <div className="camera-toolbar">
        <button className="primary-button" type="button" disabled={status === "起動中"} onClick={cameraActive ? () => { stopCamera(); setStatus("待機中"); setMessage("カメラを停止しました。"); } : startCamera}>
          {status === "起動中" ? "起動中…" : cameraActive ? "カメラ停止" : "カメラ起動"}
        </button>
        <button className="secondary-button" type="button" disabled={!cameraActive} onClick={takeScreenshot}>写真を保存</button>
        <span className="camera-status" role="status">{status}</span>
      </div>}
      <div className="camera-workspace">
        <section className="viewer-card" aria-label="カメラ映像">
          <div ref={frameRef} className="preview-frame">
            <canvas ref={canvasRef} aria-label="変顔メーカーのプレビュー" />
            <video ref={videoRef} playsInline muted />
            {!cameraActive && <div className="placeholder">{appMode === "blink-drop" ? "スタートでカメラを起動します" : "カメラを起動して遊ぼう"}</div>}
            {loadingOverlay && <div className="loading-overlay">{loadingOverlay}</div>}
            {appMode === "camera" && <button className="game-entry-button" type="button" onClick={enterBlinkDrop}><span aria-hidden="true">👁</span> 瞬きキャッチ</button>}
            {appMode === "camera" && layout === "simple" && <button className="simple-random-button" type="button" aria-label="全パーツをランダム" onClick={randomizeFace}>
              <span aria-hidden="true">🎲</span> ランダム
            </button>}
            {appMode === "blink-drop" && (!(debug && gameDebugMode !== "normal") || gameSession.phase === "completed" ||
              ((gameDebugMode === "parts-only") && gameSession.phase !== "ready")) &&
              <BlinkDropHud session={gameSession} cameraActive={cameraActive} tracking={faceTracked} resultSnapshot={resultSnapshot}
                start={startBlinkDrop} pause={pauseGame} resume={resumeGame} restart={startBlinkDrop} exit={exitBlinkDrop} save={takeScreenshot} />}
          </div>
        </section>
        <button className="settings-toggle" type="button" hidden={appMode === "blink-drop" || layout === "simple"} aria-expanded={settingsOpen} aria-controls="effect-settings"
          onClick={() => setSettingsOpen(open => !open)}>
          <span aria-hidden="true">{settingsOpen ? "⌄" : "⌃"}</span>{settingsOpen ? "設定を閉じる" : "編集設定を開く"}
        </button>
        <section id="effect-settings" className="controls-card" aria-label="顔パーツ調整" hidden={appMode === "blink-drop" || layout === "simple" || !settingsOpen}>
          <CategoryTabs value={category} change={setCategory} />
          <div className="category-content">
          {category === "parts" ? <>
          <div className="tab-row" aria-label="パーツ選択">
            {ACTIVE_PART_DEFS.map(part => <button key={part.id} type="button" aria-pressed={activePart === part.id}
              className={"tab-button " + (activePart === part.id ? "is-active" : "")} onClick={() => setActivePart(part.id as FeatureType)}>{part.label}</button>)}
          </div>
          <PartSliders config={effectState[activePart]} paired={activePartDef.supportsDistance} layout={layout}
            update={patch => updatePart(activePart, patch)} />
          </> : <EffectControls category={category} effects={faceEffects} update={setFaceEffects} preset={applyNewPreset} />}
          </div>
          <div className="main-actions">
            <button className="minor-button" type="button" aria-label="このパーツをリセット" onClick={resetCurrentPart}><span>このパーツ</span>リセット</button>
            <button className="minor-button" type="button" aria-label="全部リセット" onClick={resetAll}><span>全部</span>リセット</button>
            <button className="secondary-button" type="button" aria-label="選択パーツをランダム" onClick={randomizeActivePart}><span>選択パーツ</span>ランダム</button>
            <button className="primary-button" type="button" aria-label="全パーツをランダム" onClick={randomizeFace}><span>全パーツ</span>ランダム</button>
          </div>
          <label className="strength-picker">ランダム強度
            <select aria-label="ランダム強度" value={randomStrength} onChange={event => setRandomStrength(event.target.value as RandomStrength)}>
              <option value="weak">weak · 少し</option><option value="normal">normal · 変顔</option><option value="wild">wild · 大胆</option>
              <option value="chaos">chaos · 強い誇張</option><option value="monster">monster · 最大級</option>
            </select>
          </label>
          <p className="diagnosis" aria-live="polite">{diagnosis}</p>
        </section>
      </div>
      {debug && appMode === "camera" && layout !== "simple" && <pre ref={debugPanelRef} className="debug-panel" aria-label="処理時間計測">カメラ起動後に1秒間隔で計測します。</pre>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <details className="extra-tools" hidden={appMode === "blink-drop" || layout === "simple"}><summary>品質・ランダム設定・その他</summary>
        <p>{message}</p>
        <label className="strength-picker">品質<select aria-label="品質" value={quality} onChange={e => setQuality(e.target.value as Quality)}>
          <option value="auto">auto · 自動</option><option value="speed">speed · 速度</option><option value="balanced">balanced · 標準</option><option value="quality">quality · 高画質</option>
        </select></label>
        <label className="checkbox-option"><input type="checkbox" checked={includeExtras} onChange={e => setIncludeExtras(e.target.checked)} />全パーツランダムに配置・特殊も含める</label>
        <label className="checkbox-option"><input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} />処理時間を表示（開発用）</label>
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
