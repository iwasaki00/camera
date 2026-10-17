import { CameraController } from "./camera.js";
import { MiniatureRenderer } from "./renderer.js";
import { CanvasRecorder, TimeLapseRecorder, supportedMimeType } from "./recorder.js";
import { CONTROL_DEFS, DEFAULTS, PRESETS, RECOMMENDATIONS, applyDegree } from "./presets.js";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "miniature-camera-settings-v2";
const els = {
  video: $("#sourceVideo"), canvas: $("#previewCanvas"), viewport: $("#viewport"),
  empty: $("#emptyState"), start: $("#startButton"), shutter: $("#shutterButton"),
  photoMode: $("#photoMode"), videoMode: $("#videoMode"), timelapseMode: $("#timelapseMode"), flip: $("#flipButton"),
  settings: $("#settingsButton"), sheet: $("#settingsSheet"), backdrop: $("#sheetBackdrop"), closeSettings: $("#closeSettings"),
  preset: $("#presetSelect"), guide: $("#focusGuide"), guideButton: $("#guideButton"), enhanceButton: $("#enhanceButton"),
  degree: $("#degreeControl"), compare: $("#compareButton"), grid: $("#compositionGrid"), gridSelect: $("#gridSelect"),
  shape: $("#shapeSelect"), gesture: $("#gestureSelect"), zoom: $("#zoomControl"), zoomOutput: $("#zoomOutput"), zoomSetting: $("#zoomSetting"),
  stopMotion: $("#stopMotionSelect"), timelapseFactor: $("#timelapseFactor"), recommend: $("#recommendSelect"),
  level: $("#level"), levelLine: $("#levelLine"), levelButton: $("#levelButton"),
  libraryButton: $("#libraryButton"), libraryInput: $("#libraryInput"), sourcePlay: $("#sourcePlayButton"),
  sliders: $("#sliders"), quality: $("#qualitySelect"), audio: $("#audioToggle"), debug: $("#debugToggle"), debugPanel: $("#debugPanel"),
  resetAll: $("#resetAll"), recStatus: $("#recStatus"), recTime: $("#recTime"), toast: $("#toast"),
  timelapseStatus: $("#timelapseStatus"), timelapseTitle: $("#timelapseTitle"), timelapseElapsed: $("#timelapseElapsed"), timelapseOutput: $("#timelapseOutput"),
  dialog: $("#reviewDialog"), photoReview: $("#photoReview"), videoReview: $("#videoReview"), reviewLabel: $("#reviewLabel"),
  speedRow: $("#speedRow"), share: $("#shareButton"), retake: $("#retakeButton"), closeReview: $("#closeReview"),
};

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

const saved = readSaved();
let params = { ...DEFAULTS, ...(saved.params || {}) };
let mode = "photo";
let sourceMode = "camera";
let recording = false;
let captureState = "idle";
let sourceBusy = false;
let sourceGeneration = 0;
let sessionGeneration = 0;
let sourceReady = false;
let pendingReview = null;
let suspensionNotice = "";
let photoBusy = false;
let photoTimer;
let photoGeneration = 0;
let focusAnimation = 0;
let recordingKind = "";
let recordingStarted = 0;
let timerId;
let objectUrl = "";
let sourceObjectUrl = "";
let reviewBlob = null;
let reviewFilename = "";
let reviewType = "photo";
let currentFps = 0;
let enhance = saved.enhance ?? true;
let toastTimer;
let saveTimer;
let zoomNative = false;
let currentZoom = params.zoom || 1;
let lowFpsCount = 0;
let levelEnabled = false;

const camera = new CameraController(els.video);
const renderer = new MiniatureRenderer(els.video, els.canvas, handleRendererStats);
const recorder = new CanvasRecorder(els.canvas);
const timelapseRecorder = new TimeLapseRecorder(els.canvas);

function showToast(message, duration = 3000) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), duration);
}

function friendlyError(error, context = "camera") {
  const name = error?.message && /^[A-Z_]+$/.test(error.message) ? error.message : (error?.name || error?.message);
  const messages = {
    NotAllowedError: context === "audio" ? "マイクの使用が許可されませんでした。設定から権限を確認してください。" : "カメラの使用が許可されませんでした。Safariの設定から権限を確認してください。",
    NotFoundError: "利用できるカメラが見つかりません。",
    NotReadableError: "カメラをほかのアプリが使用している可能性があります。",
    CAMERA_UNSUPPORTED: "このブラウザはカメラ撮影に対応していません。",
    RECORDING_UNSUPPORTED: "このブラウザでは加工済み動画録画に対応していません。写真撮影は利用できます。",
    TIMELAPSE_UNSUPPORTED: "このブラウザでは加工済みタイムラプス生成に対応していません。",
    RECORDING_FAILED: "録画データの作成に失敗しました。再度撮影してください。",
    TIMELAPSE_CAPTURE_FAILED: "フレーム取得に失敗しました。再度撮影してください。",
    TIMELAPSE_ENCODING_FAILED: "動画生成に失敗しました。再度撮影してください。",
    TIMELAPSE_INTERRUPTED: "タイムラプス生成を中断しました。再度撮影してください。",
    TIMELAPSE_TOO_SHORT: "タイムラプスが短すぎます。数秒撮影してから停止してください。",
  };
  return !window.isSecureContext && location.hostname !== "localhost" ? "カメラの利用にはHTTPS接続が必要です。" : (messages[name] || "処理を完了できませんでした。端末の設定を確認してください。");
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      params, preset: els.preset.value, grid: els.gridSelect.value, audio: els.audio.checked,
      quality: els.quality.value, gesture: els.gesture.value, stopMotion: els.stopMotion.value,
      timelapseFactor: els.timelapseFactor.value, enhance,
    }));
  } catch { /* Private browsing or full storage: settings remain session-only. */ }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 120);
}

function renderControls() {
  els.sliders.innerHTML = "";
  CONTROL_DEFS.forEach((def) => {
    const row = document.createElement("div");
    row.className = "slider-row";
    row.innerHTML = `<label for="control-${def.key}">${def.label}</label><input id="control-${def.key}" data-key="${def.key}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${params[def.key]}"><output>${params[def.key]}${def.unit}</output><button type="button" data-reset="${def.key}" aria-label="${def.label}をリセット">↺</button>`;
    els.sliders.append(row);
  });
}

function focusCenter() {
  if (params.shape === "vertical") return { x: params.position, y: params.centerY };
  if (params.shape === "circle" || params.shape === "ellipse") return { x: params.centerX, y: params.centerY };
  return { x: params.centerX, y: params.position };
}

function updatePositionFromAxis() {
  if (params.shape === "vertical") params.centerX = params.position;
  else if (params.shape === "horizontal") params.centerY = params.position;
}

function syncUI({ persist = true } = {}) {
  updatePositionFromAxis();
  renderer.setParams(params, enhance);
  const center = focusCenter();
  const rect = els.viewport.getBoundingClientRect();
  els.guide.style.setProperty("--focus-x", `${center.x}%`);
  els.guide.style.setProperty("--focus-y", `${center.y}%`);
  els.guide.style.setProperty("--focus-size", `${Math.max(34, rect.height * params.width / 100)}px`);
  els.guide.style.setProperty("--focus-angle", `${params.angle}deg`);
  els.guide.classList.remove("shape-horizontal", "shape-vertical", "shape-circle", "shape-ellipse");
  els.guide.classList.add(`shape-${params.shape}`);
  els.degree.value = params.degree;
  els.shape.value = params.shape;
  els.zoom.value = currentZoom;
  els.zoomOutput.value = `${Number(currentZoom).toFixed(1)}x`;
  CONTROL_DEFS.forEach((def) => {
    const input = $(`#control-${def.key}`), output = input?.nextElementSibling;
    if (input) input.value = params[def.key];
    if (output) output.value = `${params[def.key]}${def.unit}`;
  });
  updateDebug();
  if (persist) scheduleSave();
}

function applyGrid(value) {
  els.grid.className = "composition-grid";
  if (value !== "off") els.grid.classList.add(`grid-${value}`);
  scheduleSave();
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function handleRendererStats(fps) {
  currentFps = fps;
  const target = renderer.targetFps;
  if (!recording && fps > 0 && fps < target * .62) lowFpsCount++; else lowFpsCount = Math.max(0, lowFpsCount - 1);
  if (!recording && lowFpsCount >= 3 && renderer.resolutionScale > .61) {
    renderer.setResolutionScale(renderer.resolutionScale > .8 ? .75 : .6);
    lowFpsCount = 0;
    showToast("端末負荷を抑えるため処理解像度を調整しました。", 4500);
  }
  updateDebug();
}

async function configureZoom() {
  const capability = sourceMode === "camera" ? camera.capabilities.zoom : null;
  zoomNative = Boolean(capability && Number.isFinite(capability.min) && Number.isFinite(capability.max));
  if (zoomNative) {
    els.zoom.min = capability.min;
    els.zoom.max = capability.max;
    els.zoom.step = capability.step || .1;
    const current = camera.settings.zoom || Math.max(capability.min, Math.min(capability.max, currentZoom));
    currentZoom = current;
    params.zoom = 1;
    await camera.setZoom(current).catch(() => { zoomNative = false; });
  }
  if (!zoomNative) {
    els.zoom.min = 1; els.zoom.max = 3; els.zoom.step = .1;
    currentZoom = Math.max(1, Math.min(3, zoomNative ? 1 : (currentZoom || params.zoom || 1)));
    params.zoom = currentZoom;
  }
  els.zoomSetting.firstChild.textContent = zoomNative ? "カメラズーム " : "デジタルズーム ";
  syncUI();
}

function updateAvailability() {
  const busy = captureState !== "idle";
  const transition = captureState === "starting" || captureState === "stopping";
  els.start.disabled = sourceBusy || busy || photoBusy;
  els.flip.disabled = sourceBusy || busy || sourceMode !== "camera" || !sourceReady || photoBusy;
  for (const key of ["quality", "libraryButton", "libraryInput", "resetAll"]) els[key].disabled = sourceBusy || busy || photoBusy;
  for (const key of ["audio", "stopMotion", "recommend", "timelapseFactor", "sourcePlay"]) els[key].disabled = busy;
  els.photoMode.disabled = sourceBusy || busy;
  els.videoMode.disabled = sourceBusy || busy || !recorder.supported;
  els.timelapseMode.disabled = sourceBusy || busy || !timelapseRecorder.supported;
  els.shutter.disabled = sourceBusy || transition || photoBusy || !sourceReady || document.hidden ||
    (mode === "video" && !recorder.supported) || (mode === "timelapse" && !timelapseRecorder.supported);
  els.shutter.setAttribute("aria-busy", String(transition || photoBusy));
}

async function startCamera({ facingMode = camera.facingMode } = {}) {
  if (sourceBusy || photoBusy || captureState !== "idle" || document.hidden) return;
  const generation = ++sourceGeneration;
  sourceBusy = true; sourceReady = false;
  resetGestures(); renderer.pause();
  els.empty.hidden = false; els.start.textContent = "起動中…";
  updateAvailability();
  try {
    releaseLibrarySource(); sourceMode = "camera";
    await camera.start({ quality: els.quality.value, facingMode });
    if (generation !== sourceGeneration || document.hidden) return;
    renderer.setSource(els.video); renderer.start(); sourceReady = true;
    els.empty.hidden = true; els.sourcePlay.hidden = true;
    els.libraryButton.textContent = "ライブラリから開く";
    await configureZoom();
    if (generation !== sourceGeneration) return;
    showToast(camera.facingMode === "user" ? "前面カメラ" : "背面カメラ"); updateDebug();
  } catch (error) {
    if (generation === sourceGeneration) showToast(friendlyError(error), 5500);
  } finally {
    if (generation === sourceGeneration) {
      sourceBusy = false; els.start.textContent = "カメラを再開"; updateAvailability();
    }
  }
}

function setMode(next) {
  if (captureState !== "idle" || sourceBusy) return;
  mode = next;
  const buttons = { photo: els.photoMode, video: els.videoMode, timelapse: els.timelapseMode };
  Object.entries(buttons).forEach(([key, button]) => {
    const active = key === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active);
  });
  els.shutter.classList.toggle("is-video", next !== "photo");
  els.shutter.setAttribute("aria-label", next === "photo" ? "写真を撮影" : next === "video" ? "動画を録画" : "タイムラプスを撮影");
  updateAvailability();
}

function closeObjectUrl() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = ""; reviewBlob = null; reviewFilename = "";
  els.photoReview.removeAttribute("src");
  els.videoReview.pause(); els.videoReview.removeAttribute("src"); els.videoReview.load();
}

function showReview(blob, type) {
  if (!blob?.size) throw new Error("RECORDING_FAILED");
  if (document.hidden) { pendingReview = { blob, type }; return; }
  closeObjectUrl();
  objectUrl = URL.createObjectURL(blob);
  const photo = type === "photo";
  els.photoReview.hidden = !photo; els.videoReview.hidden = photo; els.speedRow.hidden = photo;
  els.reviewLabel.textContent = photo ? "PHOTO PREVIEW" : type === "timelapse" ? "TIMELAPSE PREVIEW" : "VIDEO PREVIEW";
  if (photo) els.photoReview.src = objectUrl; else els.videoReview.src = objectUrl;
  const ext = photo ? "jpg" : (blob.type.includes("mp4") ? "mp4" : "webm");
  reviewBlob = blob; reviewType = type;
  reviewFilename = `miniature-${type}-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  els.speedRow.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.speed === "1"));
  els.videoReview.playbackRate = 1;
  els.dialog.showModal();
}

async function shareReview() {
  if (!reviewBlob || !reviewFilename) return;
  const file = new File([reviewBlob], reviewFilename, { type: (reviewBlob.type || "application/octet-stream").split(";")[0] });
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Miniature Camera" }); return;
    }
  } catch (error) { if (error?.name === "AbortError") return; }
  showToast("ファイル共有を利用できません。「ファイルを保存」をお試しください。写真アプリへの保存を保証するものではありません。", 6500);
}

function downloadReview() {
  if (!reviewBlob || !objectUrl) return;
  const link = document.createElement("a");
  link.href = objectUrl; link.download = reviewFilename;
  document.body.append(link); link.click(); link.remove();
  showToast("保存先はブラウザの案内に従って選択してください。写真アプリへの保存は保証されません。", 5500);
}

function takePhoto() {
  if (photoBusy || captureState !== "idle" || sourceBusy || !sourceReady) return;
  const generation = sessionGeneration, photoRequest = ++photoGeneration;
  photoBusy = true; updateAvailability();
  photoTimer = setTimeout(() => { photoBusy = false; updateAvailability(); showToast("写真を作成できませんでした。再度お試しください。"); }, 5000);
  try {
    els.canvas.toBlob((blob) => {
      if (!photoBusy || photoRequest !== photoGeneration || generation !== sessionGeneration) return;
      clearTimeout(photoTimer);
      try { if (blob) showReview(blob, "photo"); else showToast("写真を保存用に準備できませんでした。"); }
      catch { showToast("写真を保存用に準備できませんでした。"); }
      finally { photoBusy = false; updateAvailability(); }
    }, "image/jpeg", .92);
  } catch { clearTimeout(photoTimer); photoBusy = false; updateAvailability(); showToast("写真を作成できませんでした。"); }
}

function setRecordingUI(active, kind = mode) {
  recording = active; recordingKind = active ? kind : "";
  els.recStatus.hidden = !active;
  els.shutter.classList.toggle("is-recording", active);
  els.shutter.setAttribute("aria-label", active ? "撮影を停止" : mode === "photo" ? "写真を撮影" : "撮影を開始");
  els.guide.classList.toggle("is-hidden", active || els.guideButton.getAttribute("aria-pressed") !== "true");
  els.timelapseStatus.hidden = !(active && kind === "timelapse");
}

async function startRecording() {
  if (captureState !== "idle" || sourceBusy || !sourceReady || document.hidden) return;
  if (!recorder.supported) return showToast(friendlyError(new Error("RECORDING_UNSUPPORTED")), 5000);
  const generation = sessionGeneration;
  captureState = "starting"; updateAvailability();
  try {
    if (sourceMode === "library-video" && els.video.paused) await els.video.play();
    let audioStream = null;
    if (els.audio.checked && sourceMode === "camera") {
      try { audioStream = await camera.setAudio(true); }
      catch (error) {
        if (generation !== sessionGeneration) return;
        els.audio.checked = false; showToast(friendlyError(error, "audio"), 5000); scheduleSave();
      }
    }
    if (generation !== sessionGeneration || document.hidden) return;
    recorder.start(audioStream, camera.settings.frameRate || 30);
    captureState = "recording";
    recordingStarted = Date.now(); setRecordingUI(true, "video"); els.recTime.textContent = "00:00";
    timerId = setInterval(() => { els.recTime.textContent = formatTime((Date.now() - recordingStarted) / 1000); }, 250);
  } catch (error) {
    if (generation === sessionGeneration) { captureState = "idle"; showToast(friendlyError(error), 5000); }
  } finally {
    if (generation === sessionGeneration) {
      if (captureState === "starting") captureState = "idle";
      if (captureState !== "recording") camera.stopAudio();
      updateAvailability();
    }
  }
}

async function stopRecording() {
  if (captureState !== "recording" || recordingKind !== "video") return;
  captureState = "stopping"; clearInterval(timerId);
  setRecordingUI(false); updateAvailability();
  try {
    const blob = await recorder.stop(); showReview(blob, "video"); updateDebug(blob.size);
  } catch { showToast("録画データを作成できませんでした。もう一度撮影してください。", 5500); }
  finally { camera.stopAudio(); captureState = "idle"; updateAvailability(); }
}

async function startTimelapse() {
  if (captureState !== "idle" || sourceBusy || !sourceReady || document.hidden) return;
  if (!timelapseRecorder.supported) return showToast(friendlyError(new Error("TIMELAPSE_UNSUPPORTED")), 5000);
  const generation = sessionGeneration;
  captureState = "starting"; updateAvailability();
  try {
    if (sourceMode === "library-video" && els.video.paused) await els.video.play();
    if (generation !== sessionGeneration || document.hidden) return;
    const factor = Number(els.timelapseFactor.value);
    timelapseRecorder.start(factor); captureState = "recording";
    recordingStarted = Date.now(); setRecordingUI(true, "timelapse"); els.recTime.textContent = "00:00";
    els.timelapseTitle.textContent = "TIMELAPSE ×" + factor;
    timerId = setInterval(() => {
      const elapsed = (Date.now() - recordingStarted) / 1000;
      els.recTime.textContent = formatTime(elapsed);
      els.timelapseElapsed.textContent = formatTime(elapsed);
      els.timelapseOutput.textContent = formatTime(timelapseRecorder.outputSeconds);
    }, 250);
  } catch (error) {
    if (generation === sessionGeneration) { captureState = "idle"; showToast(friendlyError(error), 5000); }
  } finally {
    if (generation === sessionGeneration) {
      if (captureState === "starting") captureState = "idle";
      updateAvailability();
    }
  }
}

async function stopTimelapse() {
  if (captureState !== "recording" || recordingKind !== "timelapse") return;
  captureState = "stopping"; clearInterval(timerId);
  els.timelapseTitle.textContent = "動画を生成中…"; updateAvailability();
  try {
    const blob = await timelapseRecorder.stop(); showReview(blob, "timelapse"); updateDebug(blob.size);
  } catch (error) { showToast(friendlyError(error), 5500); }
  finally { setRecordingUI(false); captureState = "idle"; updateAvailability(); }
}

function openSettings(open) {
  els.sheet.classList.toggle("is-open", open); els.sheet.setAttribute("aria-hidden", !open);
  els.settings.setAttribute("aria-expanded", open); els.backdrop.hidden = !open;
}

async function enableLevel() {
  if (!("DeviceOrientationEvent" in window)) return showToast("この端末では水平器を利用できません。");
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") throw new Error("ORIENTATION_DENIED");
    }
    if (!levelEnabled) window.addEventListener("deviceorientation", updateLevel);
    levelEnabled = true; els.level.hidden = false; els.levelButton.textContent = "水平器を無効にする";
  } catch { showToast("水平器の利用が許可されませんでした。Safariの設定を確認してください。", 5000); }
}

function updateLevel(event) {
  const tilt = Number.isFinite(event.gamma) ? Math.max(-45, Math.min(45, event.gamma)) : 0;
  els.levelLine.style.transform = `rotate(${tilt}deg)`;
  els.level.classList.toggle("is-level", Math.abs(tilt) < 1.5);
}

function disableLevel() {
  window.removeEventListener("deviceorientation", updateLevel); levelEnabled = false;
  els.level.hidden = true; els.levelButton.textContent = "水平器を有効にする";
}

function releaseLibrarySource() {
  if (!els.video.srcObject) { els.video.pause(); els.video.removeAttribute("src"); els.video.load(); }
  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = "";
}

async function openLibraryFile(file) {
  if (!file || photoBusy || sourceBusy || captureState !== "idle" || document.hidden) return;
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return showToast("写真または動画を選択してください。");
  const generation = ++sourceGeneration;
  sourceBusy = true; sourceReady = false;
  resetGestures(); renderer.pause(); camera.stop(); releaseLibrarySource();
  els.empty.hidden = false; updateAvailability();
  const finish = (ready) => {
    if (generation !== sourceGeneration) return;
    sourceBusy = false; sourceReady = ready; els.empty.hidden = ready;
    els.start.textContent = "カメラを再開"; updateAvailability();
  };
  sourceObjectUrl = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    const image = new Image();
    image.onload = () => {
      if (generation !== sourceGeneration) return;
      sourceBusy = false;
      sourceMode = "library-image"; renderer.setSource(image); renderer.start();
      els.empty.hidden = true; els.shutter.disabled = false; els.flip.disabled = true; els.sourcePlay.hidden = true;
      els.libraryButton.textContent = "カメラに戻る";
      setMode("photo"); configureZoom(); finish(true); showToast("写真を読み込みました。加工後は撮影ボタンで確定します。");
    };
    image.onerror = () => { if (generation !== sourceGeneration) return; releaseLibrarySource(); finish(false); showToast("この画像を読み込めませんでした。"); };
    image.src = sourceObjectUrl;
  } else if (file.type.startsWith("video/")) {
    els.video.srcObject = null; els.video.src = sourceObjectUrl; els.video.loop = false; els.video.muted = true;
    try {
      await els.video.play(); if (generation !== sourceGeneration) return; sourceBusy = false; sourceMode = "library-video"; renderer.setSource(els.video); renderer.start();
      els.empty.hidden = true; els.shutter.disabled = !recorder.supported; els.flip.disabled = true; els.sourcePlay.hidden = false;
      els.libraryButton.textContent = "カメラに戻る";
      els.sourcePlay.textContent = "一時停止"; setMode("video"); configureZoom(); finish(true);
      showToast(recorder.supported ? "動画を読み込みました。録画ボタンで加工済み動画を書き出せます。" : "加工プレビューのみ利用できます。動画書き出しは非対応です。", 5500);
    } catch { if (generation !== sourceGeneration) return; releaseLibrarySource(); finish(false); showToast("この動画を再生できませんでした。"); }
  } else showToast("対応している写真または動画を選んでください。");
}

function applyStopMotion(value) {
  const fps = { off: 30, weak: 15, medium: 10, strong: 6 }[value] || 30;
  renderer.setTargetFps(fps); scheduleSave();
}

function applyRecommendation(value) {
  const item = RECOMMENDATIONS[value];
  if (!item) return;
  params = { ...params, ...PRESETS[item.preset], ...item };
  delete params.preset; delete params.stopMotion;
  els.preset.value = item.preset;
  if (RECOMMENDATIONS[value].stopMotion) { els.stopMotion.value = RECOMMENDATIONS[value].stopMotion; applyStopMotion(els.stopMotion.value); }
  syncUI(); showToast("おすすめ設定を適用しました");
}

function resetSettings() {
  localStorage.removeItem(STORAGE_KEY);
  params = { ...DEFAULTS }; enhance = true;
  els.preset.value = "standard"; els.gridSelect.value = "off"; els.audio.checked = false;
  els.quality.value = "standard"; els.gesture.value = "focus"; els.stopMotion.value = "off"; els.timelapseFactor.value = "4";
  els.enhanceButton.setAttribute("aria-pressed", "true"); els.enhanceButton.querySelector("b").textContent = "ON";
  applyGrid("off"); applyStopMotion("off"); syncUI(); showToast("設定を初期化しました");
}

function updateDebug(blobSize = null) {
  if (!els.debug.checked) return;
  const s = camera.settings, caps = camera.capabilities;
  els.debugPanel.textContent = [
    `Browser: ${navigator.userAgent}`, `Source: ${sourceMode}`, `Camera: ${camera.facingMode}`,
    `Video: ${s.width || 0}×${s.height || 0} @ ${s.frameRate || "?"}fps`, `Render FPS: ${currentFps}/${renderer.targetFps}`,
    `Canvas: ${els.canvas.width}×${els.canvas.height} scale=${renderer.resolutionScale}`,
    `Renderer: ${renderer.mode}`, `Shape: ${params.shape}`, `Zoom: ${params.zoom} (${zoomNative ? "native" : "digital"})`,
    `Camera controls: zoom=${Boolean(caps.zoom)} focus=${Boolean(caps.focusMode)} exposure=${Boolean(caps.exposureMode)}`,
    `MediaRecorder: ${window.MediaRecorder ? "yes" : "no"}`, `MIME: ${supportedMimeType() || "none"}`,
    `Audio track: ${camera.audioStream?.getAudioTracks().length || 0}`, `Video track: ${camera.stream?.getVideoTracks().length || 0}`,
    `Last Blob: ${blobSize == null ? "-" : `${(blobSize / 1024 / 1024).toFixed(2)} MB`}`,
  ].join("\n");
}

renderControls();
els.preset.value = saved.preset in PRESETS ? saved.preset : "standard";
els.gridSelect.value = ["off", "thirds", "cross", "horizon"].includes(saved.grid) ? saved.grid : "off";
els.audio.checked = Boolean(saved.audio); els.quality.value = saved.quality || "standard";
els.gesture.value = saved.gesture || "focus"; els.stopMotion.value = saved.stopMotion || "off"; els.timelapseFactor.value = saved.timelapseFactor || "4";
els.enhanceButton.setAttribute("aria-pressed", enhance); els.enhanceButton.querySelector("b").textContent = enhance ? "ON" : "OFF";
applyGrid(els.gridSelect.value); applyStopMotion(els.stopMotion.value); syncUI({ persist: false });
els.videoMode.disabled = !recorder.supported;
els.videoMode.title = recorder.supported ? "" : "このブラウザでは加工済み動画録画に対応していません";
els.timelapseMode.disabled = !timelapseRecorder.supported;
els.timelapseMode.title = timelapseRecorder.supported ? "" : "このブラウザではタイムラプス生成に対応していません";

els.start.addEventListener("click", () => startCamera());
els.photoMode.addEventListener("click", () => setMode("photo"));
els.videoMode.addEventListener("click", () => setMode("video"));
els.timelapseMode.addEventListener("click", () => setMode("timelapse"));
els.shutter.addEventListener("click", () => {
  if (els.shutter.disabled) return;
  if (mode === "photo") takePhoto();
  else if (mode === "video") recording ? stopRecording() : startRecording();
  else recording ? stopTimelapse() : startTimelapse();
});
els.flip.addEventListener("click", () => startCamera({ facingMode: camera.facingMode === "environment" ? "user" : "environment" }));
els.settings.addEventListener("click", () => openSettings(true)); els.closeSettings.addEventListener("click", () => openSettings(false)); els.backdrop.addEventListener("click", () => openSettings(false));
els.degree.addEventListener("input", () => { params = applyDegree(params, Number(els.degree.value)); syncUI(); });
els.sliders.addEventListener("input", (event) => { const key = event.target.dataset.key; if (!key) return; params[key] = Number(event.target.value); if (key === "position") updatePositionFromAxis(); syncUI(); });
els.sliders.addEventListener("click", (event) => { const key = event.target.dataset.reset; if (!key) return; params[key] = DEFAULTS[key]; syncUI(); });
els.preset.addEventListener("change", () => { params = { ...PRESETS[els.preset.value], shape: params.shape, centerX: params.centerX, centerY: params.centerY }; syncUI(); });
els.shape.addEventListener("change", () => { params.shape = els.shape.value; params.position = params.shape === "vertical" ? params.centerX : params.centerY; syncUI(); });
els.gridSelect.addEventListener("change", () => applyGrid(els.gridSelect.value));
els.stopMotion.addEventListener("change", () => applyStopMotion(els.stopMotion.value));
els.timelapseFactor.addEventListener("change", scheduleSave);
els.recommend.addEventListener("change", () => applyRecommendation(els.recommend.value));
els.resetAll.addEventListener("click", resetSettings);
els.guideButton.addEventListener("click", () => { const on = els.guideButton.getAttribute("aria-pressed") !== "true"; els.guideButton.setAttribute("aria-pressed", on); els.guideButton.querySelector("b").textContent = on ? "ON" : "OFF"; els.guide.classList.toggle("is-hidden", !on); });
els.enhanceButton.addEventListener("click", () => { enhance = !enhance; els.enhanceButton.setAttribute("aria-pressed", enhance); els.enhanceButton.querySelector("b").textContent = enhance ? "ON" : "OFF"; syncUI(); });
els.quality.addEventListener("change", () => { scheduleSave(); if (sourceMode === "camera" && sourceReady) startCamera(); });
els.audio.addEventListener("change", () => { if (!els.audio.checked) camera.stopAudio(); scheduleSave(); });
els.debug.addEventListener("change", () => { els.debugPanel.hidden = !els.debug.checked; updateDebug(); });
els.zoom.addEventListener("input", async () => { const value = Number(els.zoom.value); currentZoom = value; if (zoomNative && sourceMode === "camera") { await camera.setZoom(value).catch(() => { zoomNative = false; }); params.zoom = zoomNative ? 1 : value; els.zoomOutput.value = `${value.toFixed(1)}x`; } else { params.zoom = value; syncUI(); } scheduleSave(); });
els.levelButton.addEventListener("click", () => levelEnabled ? disableLevel() : enableLevel());
els.compare.addEventListener("pointerdown", (event) => { event.preventDefault(); renderer.setCompare(true); els.compare.classList.add("is-comparing"); });
["pointerup", "pointercancel", "pointerleave"].forEach((name) => els.compare.addEventListener(name, () => { renderer.setCompare(false); els.compare.classList.remove("is-comparing"); }));
els.libraryButton.addEventListener("click", () => { if (sourceBusy || captureState !== "idle") return; sourceMode === "camera" ? els.libraryInput.click() : startCamera(); });
els.libraryInput.addEventListener("change", () => { openLibraryFile(els.libraryInput.files?.[0]); els.libraryInput.value = ""; });
els.sourcePlay.addEventListener("click", async () => { if (sourceMode !== "library-video") return; if (els.video.paused) { await els.video.play(); els.sourcePlay.textContent = "一時停止"; } else { els.video.pause(); els.sourcePlay.textContent = "再生"; } });
els.video.addEventListener("ended", () => { if (sourceMode === "library-video") els.sourcePlay.textContent = "最初から再生"; if (recording && recordingKind === "video") stopRecording(); else if (recording && recordingKind === "timelapse") stopTimelapse(); });
$("#downloadButton").addEventListener("click", downloadReview);
els.dialog.addEventListener("close", () => { if (!els.dialog.open) closeObjectUrl(); });
els.retake.addEventListener("click", () => { els.dialog.close(); closeObjectUrl(); }); els.closeReview.addEventListener("click", () => { els.dialog.close(); closeObjectUrl(); }); els.share.addEventListener("click", shareReview);
els.speedRow.addEventListener("click", (event) => { const speed = Number(event.target.dataset.speed); if (!speed) return; els.videoReview.playbackRate = speed; els.speedRow.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button === event.target)); });

const pointers = new Map();
let gestureStart = null;
let tapState = null;

function pointerDistance(items) { return Math.hypot(items[0].x - items[1].x, items[0].y - items[1].y); }
function pointerAngle(items) { return Math.atan2(items[1].y - items[0].y, items[1].x - items[0].x) * 180 / Math.PI; }

function animateFocus(targetX, targetY) {
  const fromX = params.centerX, fromY = params.centerY, started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 170), eased = 1 - Math.pow(1 - t, 3);
    params.centerX = fromX + (targetX - fromX) * eased; params.centerY = fromY + (targetY - fromY) * eased;
    params.position = params.shape === "vertical" ? params.centerX : params.centerY; syncUI();
    if (t < 1) focusAnimation = requestAnimationFrame(step);
  };
  cancelAnimationFrame(focusAnimation);
  focusAnimation = requestAnimationFrame(step);
}

els.canvas.addEventListener("pointerdown", (event) => {
  cancelAnimationFrame(focusAnimation);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  els.canvas.setPointerCapture(event.pointerId);
  if (pointers.size === 1) tapState = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, centerX: params.centerX, centerY: params.centerY };
  if (pointers.size === 2) {
    tapState = null;
    const items = [...pointers.values()];
    gestureStart = { distance: pointerDistance(items), angle: pointerAngle(items), width: params.width, focusAngle: params.angle, zoom: currentZoom };
  }
});

els.canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const rect = els.canvas.getBoundingClientRect();
  if (pointers.size === 2 && gestureStart) {
    const items = [...pointers.values()], ratio = pointerDistance(items) / Math.max(1, gestureStart.distance);
    if (els.gesture.value === "zoom") {
      const min = Number(els.zoom.min), max = Number(els.zoom.max), value = Math.max(min, Math.min(max, gestureStart.zoom * ratio));
      els.zoom.value = value; els.zoom.dispatchEvent(new Event("input"));
    } else {
      params.width = Math.max(8, Math.min(60, gestureStart.width * ratio));
      const rawDelta = pointerAngle(items) - gestureStart.angle;
      const angleDelta = ((rawDelta + 540) % 360) - 180;
      params.angle = Math.max(-90, Math.min(90, gestureStart.focusAngle + angleDelta));
      syncUI();
    }
    return;
  }
  if (pointers.size === 1 && tapState?.id === event.pointerId) {
    const dx = event.clientX - tapState.x, dy = event.clientY - tapState.y;
    if (Math.hypot(dx, dy) > 4) tapState.moved = true;
    if (tapState.moved) {
      if (params.shape === "vertical") params.centerX = Math.max(10, Math.min(90, tapState.centerX + dx / rect.width * 100));
      else if (params.shape === "horizontal") params.centerY = Math.max(10, Math.min(90, tapState.centerY + dy / rect.height * 100));
      else {
        params.centerX = Math.max(10, Math.min(90, tapState.centerX + dx / rect.width * 100));
        params.centerY = Math.max(10, Math.min(90, tapState.centerY + dy / rect.height * 100));
      }
      params.position = params.shape === "vertical" ? params.centerX : params.centerY; syncUI();
    }
  }
});

function releasePointer(event) {
  const wasTap = event.type === "pointerup" && tapState?.id === event.pointerId && !tapState.moved && pointers.size === 1;
  const rect = els.canvas.getBoundingClientRect();
  pointers.delete(event.pointerId);
  if (wasTap) {
    const x = Math.max(10, Math.min(90, (event.clientX - rect.left) / rect.width * 100));
    const y = Math.max(10, Math.min(90, (event.clientY - rect.top) / rect.height * 100));
    animateFocus(params.shape === "horizontal" ? params.centerX : x, params.shape === "vertical" ? params.centerY : y);
  }
  if (pointers.size < 2) gestureStart = null;
  if (!pointers.size) tapState = null;
}
els.canvas.addEventListener("pointerup", releasePointer);
els.canvas.addEventListener("pointercancel", resetGestures);
els.canvas.addEventListener("lostpointercapture", releasePointer);

function resetGestures() {
  const ids = [...pointers.keys()];
  pointers.clear(); gestureStart = null; tapState = null;
  cancelAnimationFrame(focusAnimation);
  for (const id of ids) if (els.canvas.hasPointerCapture(id)) els.canvas.releasePointerCapture(id);
  renderer.setCompare(false); els.compare.classList.remove("is-comparing");
}

window.addEventListener("resize", () => syncUI({ persist: false }));
function handleRecordingError(error) {
  clearInterval(timerId); camera.stopAudio();
  if (sourceMode === "camera" && !camera.stream?.active) {
    camera.stopVideo(); renderer.pause(); sourceReady = false;
    els.empty.hidden = false; els.start.textContent = "カメラを再開";
  }
  captureState = "idle"; setRecordingUI(false); updateAvailability();
  showToast(friendlyError(error), 5500);
}
recorder.onComplete = (blob) => {
  clearInterval(timerId); camera.stopAudio();
  captureState = "idle"; setRecordingUI(false); updateAvailability();
  try { showReview(blob, "video"); showToast("録画が終了しました。撮影結果を確認してください。", 5000); }
  catch { showToast("録画データを作成できませんでした。再度撮影してください。", 5000); }
};
recorder.onError = handleRecordingError;
timelapseRecorder.onError = handleRecordingError;

function suspend() {
  ++sessionGeneration; ++sourceGeneration;
  sourceBusy = false; photoBusy = false;
  resetGestures(); renderer.pause();
  if (captureState === "recording" && recordingKind === "video") {
    stopRecording();
    suspensionNotice = "画面の中断により録画を終了しました。取得できたデータを確認してください。";
  } else if (recordingKind === "timelapse" || timelapseRecorder.state !== "idle") {
    timelapseRecorder.cancel();
    if (captureState !== "stopping") captureState = "idle";
    setRecordingUI(false);
    suspensionNotice = "画面の中断によりタイムラプスを中止しました。もう一度撮影してください。";
  } else if (captureState === "starting") captureState = "idle";
  camera.stop();
  if (sourceMode !== "library-image") {
    sourceReady = false; els.video.pause();
    els.empty.hidden = false; els.start.textContent = "カメラを再開";
  }
  saveSettings();
  clearInterval(timerId); clearTimeout(saveTimer); clearTimeout(toastTimer); clearTimeout(photoTimer);
  updateAvailability();
}

function resume() {
  if (document.hidden) return;
  if (suspensionNotice) { showToast(suspensionNotice, 6500); suspensionNotice = ""; }
  if (sourceMode === "library-image" && sourceReady) renderer.start();
  if (pendingReview) {
    const { blob, type } = pendingReview; pendingReview = null;
    try { showReview(blob, type); } catch { showToast("撮影結果を表示できませんでした。"); }
  }
  updateAvailability();
}
document.addEventListener("visibilitychange", () => document.hidden ? suspend() : resume());
window.addEventListener("pagehide", () => {
  suspend(); releaseLibrarySource(); disableLevel();
  // Keep the Blob across the back/forward cache, release the detached media URL.
  if (reviewBlob) pendingReview = { blob: reviewBlob, type: reviewType };
  if (els.dialog.open) els.dialog.close();
  closeObjectUrl();
});
window.addEventListener("pageshow", resume);
updateAvailability();
