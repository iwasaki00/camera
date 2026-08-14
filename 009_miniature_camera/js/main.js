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
let recordingKind = "";
let recordingStarted = 0;
let timerId;
let objectUrl = "";
let sourceObjectUrl = "";
let reviewBlob = null;
let reviewFilename = "";
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
    TIMELAPSE_TOO_SHORT: "タイムラプスが短すぎます。数秒撮影してから停止してください。",
  };
  return !window.isSecureContext && location.hostname !== "localhost" ? "カメラの利用にはHTTPS接続が必要です。" : (messages[name] || "処理を完了できませんでした。端末の設定を確認してください。");
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        params, preset: els.preset.value, grid: els.gridSelect.value, audio: els.audio.checked,
        quality: els.quality.value, gesture: els.gesture.value, stopMotion: els.stopMotion.value,
        timelapseFactor: els.timelapseFactor.value, enhance,
      }));
    } catch { /* Private browsing or full storage: settings remain session-only. */ }
  }, 120);
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

async function startCamera() {
  els.start.disabled = true;
  els.start.textContent = "起動中…";
  try {
    releaseLibrarySource();
    await camera.start({ quality: els.quality.value });
    sourceMode = "camera";
    renderer.setSource(els.video);
    renderer.start();
    els.empty.hidden = true;
    els.shutter.disabled = false;
    els.flip.disabled = false;
    els.sourcePlay.hidden = true;
    els.libraryButton.textContent = "ライブラリから開く";
    await configureZoom();
    updateDebug();
  } catch (error) {
    showToast(friendlyError(error), 5500);
    els.start.disabled = false;
    els.start.textContent = "もう一度試す";
  }
}

function setMode(next) {
  if (recording) return;
  mode = next;
  const buttons = { photo: els.photoMode, video: els.videoMode, timelapse: els.timelapseMode };
  Object.entries(buttons).forEach(([key, button]) => {
    const active = key === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active);
  });
  els.shutter.classList.toggle("is-video", next !== "photo");
  els.shutter.setAttribute("aria-label", next === "photo" ? "写真を撮影" : next === "video" ? "動画を録画" : "タイムラプスを撮影");
}

function closeObjectUrl() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = ""; reviewBlob = null; reviewFilename = "";
  els.photoReview.removeAttribute("src");
  els.videoReview.pause(); els.videoReview.removeAttribute("src"); els.videoReview.load();
}

function showReview(blob, type) {
  closeObjectUrl();
  objectUrl = URL.createObjectURL(blob);
  const photo = type === "photo";
  els.photoReview.hidden = !photo; els.videoReview.hidden = photo; els.speedRow.hidden = photo;
  els.reviewLabel.textContent = photo ? "PHOTO PREVIEW" : type === "timelapse" ? "TIMELAPSE PREVIEW" : "VIDEO PREVIEW";
  if (photo) els.photoReview.src = objectUrl; else els.videoReview.src = objectUrl;
  const ext = photo ? "jpg" : (blob.type.includes("mp4") ? "mp4" : "webm");
  reviewBlob = blob;
  reviewFilename = `miniature-${type}-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  els.speedRow.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.speed === "1"));
  els.videoReview.playbackRate = 1;
  els.dialog.showModal();
}

async function shareReview() {
  if (!reviewBlob || !reviewFilename) return;
  const file = new File([reviewBlob], reviewFilename, { type: (reviewBlob.type || "application/octet-stream").split(";")[0] });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Miniature Camera" }); return; }
    catch (error) { if (error?.name === "AbortError") return; }
  }
  showToast("このブラウザでは撮影ファイルの共有メニューを利用できません。", 5000);
}

function takePhoto() {
  els.canvas.toBlob((blob) => blob ? showReview(blob, "photo") : showToast("写真を保存用に準備できませんでした。"), "image/jpeg", .92);
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
  if (!recorder.supported) return showToast(friendlyError(new Error("RECORDING_UNSUPPORTED")), 5000);
  if (sourceMode === "library-video" && els.video.paused) await els.video.play().catch(() => {});
  let audioStream = null;
  if (els.audio.checked && sourceMode === "camera") {
    try { audioStream = await camera.setAudio(true); }
    catch (error) { els.audio.checked = false; showToast(friendlyError(error, "audio"), 5000); }
  }
  try {
    recorder.start(audioStream, camera.settings.frameRate || 30);
    recordingStarted = Date.now(); setRecordingUI(true, "video");
    timerId = setInterval(() => { els.recTime.textContent = formatTime((Date.now() - recordingStarted) / 1000); }, 250);
  } catch (error) { showToast(friendlyError(error), 5000); }
}

async function stopRecording() {
  clearInterval(timerId);
  setRecordingUI(false);
  els.shutter.disabled = true;
  try {
    const blob = await recorder.stop();
    camera.stopAudio(); showReview(blob, "video"); updateDebug(blob.size);
  } catch {
    camera.stopAudio();
    showToast("録画データを作成できませんでした。空き容量を確認してください。");
  } finally { els.shutter.disabled = false; }
}

async function startTimelapse() {
  if (!timelapseRecorder.supported) return showToast(friendlyError(new Error("TIMELAPSE_UNSUPPORTED")), 5000);
  try {
    if (sourceMode === "library-video" && els.video.paused) await els.video.play().catch(() => {});
    const factor = Number(els.timelapseFactor.value);
    timelapseRecorder.start(factor);
    recordingStarted = Date.now(); setRecordingUI(true, "timelapse");
    els.timelapseTitle.textContent = `TIMELAPSE ×${factor}`;
    timerId = setInterval(() => {
      const elapsed = (Date.now() - recordingStarted) / 1000;
      els.recTime.textContent = formatTime(elapsed);
      els.timelapseElapsed.textContent = formatTime(elapsed);
      els.timelapseOutput.textContent = formatTime(timelapseRecorder.outputSeconds);
    }, 250);
  } catch (error) { showToast(friendlyError(error), 5000); }
}

async function stopTimelapse() {
  clearInterval(timerId);
  els.timelapseTitle.textContent = "動画を生成中…";
  els.shutter.disabled = true;
  try {
    const blob = await timelapseRecorder.stop();
    setRecordingUI(false); showReview(blob, "timelapse"); updateDebug(blob.size);
  } catch (error) { setRecordingUI(false); showToast(friendlyError(error), 5000); }
  finally { els.shutter.disabled = false; }
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
  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = "";
  if (!els.video.srcObject) { els.video.pause(); els.video.removeAttribute("src"); els.video.load(); }
}

async function openLibraryFile(file) {
  if (!file) return;
  camera.stopVideo(); releaseLibrarySource();
  sourceObjectUrl = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    const image = new Image();
    image.onload = () => {
      sourceMode = "library-image"; renderer.setSource(image); renderer.start();
      els.empty.hidden = true; els.shutter.disabled = false; els.flip.disabled = true; els.sourcePlay.hidden = true;
      els.libraryButton.textContent = "カメラに戻る";
      setMode("photo"); configureZoom(); showToast("写真を読み込みました。加工後は撮影ボタンで確定します。");
    };
    image.onerror = () => showToast("この画像を読み込めませんでした。");
    image.src = sourceObjectUrl;
  } else if (file.type.startsWith("video/")) {
    els.video.srcObject = null; els.video.src = sourceObjectUrl; els.video.loop = false; els.video.muted = true;
    try {
      await els.video.play(); sourceMode = "library-video"; renderer.setSource(els.video); renderer.start();
      els.empty.hidden = true; els.shutter.disabled = !recorder.supported; els.flip.disabled = true; els.sourcePlay.hidden = false;
      els.libraryButton.textContent = "カメラに戻る";
      els.sourcePlay.textContent = "一時停止"; setMode("video"); configureZoom();
      showToast(recorder.supported ? "動画を読み込みました。録画ボタンで加工済み動画を書き出せます。" : "加工プレビューのみ利用できます。動画書き出しは非対応です。", 5500);
    } catch { showToast("この動画を再生できませんでした。"); }
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

els.start.addEventListener("click", startCamera);
els.photoMode.addEventListener("click", () => setMode("photo"));
els.videoMode.addEventListener("click", () => setMode("video"));
els.timelapseMode.addEventListener("click", () => setMode("timelapse"));
els.shutter.addEventListener("click", () => {
  if (mode === "photo") takePhoto();
  else if (mode === "video") recording ? stopRecording() : startRecording();
  else recording ? stopTimelapse() : startTimelapse();
});
els.flip.addEventListener("click", async () => { if (sourceMode !== "camera" || recording) return; els.flip.disabled = true; try { await camera.flip(); renderer.setSource(els.video); await configureZoom(); showToast(camera.facingMode === "user" ? "前面カメラ" : "背面カメラ"); } catch (e) { showToast(friendlyError(e)); } finally { els.flip.disabled = false; } });
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
els.quality.addEventListener("change", async () => { scheduleSave(); if (sourceMode !== "camera" || !camera.stream || recording) return; try { await camera.start({ quality: els.quality.value }); renderer.setSource(els.video); configureZoom(); showToast("画質を変更しました"); } catch (e) { showToast(friendlyError(e)); } });
els.audio.addEventListener("change", () => { if (!els.audio.checked) camera.stopAudio(); scheduleSave(); });
els.debug.addEventListener("change", () => { els.debugPanel.hidden = !els.debug.checked; updateDebug(); });
els.zoom.addEventListener("input", async () => { const value = Number(els.zoom.value); currentZoom = value; if (zoomNative && sourceMode === "camera") { await camera.setZoom(value).catch(() => { zoomNative = false; }); params.zoom = zoomNative ? 1 : value; els.zoomOutput.value = `${value.toFixed(1)}x`; } else { params.zoom = value; syncUI(); } scheduleSave(); });
els.levelButton.addEventListener("click", () => levelEnabled ? disableLevel() : enableLevel());
els.compare.addEventListener("pointerdown", (event) => { event.preventDefault(); renderer.setCompare(true); els.compare.classList.add("is-comparing"); });
["pointerup", "pointercancel", "pointerleave"].forEach((name) => els.compare.addEventListener(name, () => { renderer.setCompare(false); els.compare.classList.remove("is-comparing"); }));
els.libraryButton.addEventListener("click", () => sourceMode === "camera" ? els.libraryInput.click() : startCamera());
els.libraryInput.addEventListener("change", () => { openLibraryFile(els.libraryInput.files?.[0]); els.libraryInput.value = ""; });
els.sourcePlay.addEventListener("click", async () => { if (sourceMode !== "library-video") return; if (els.video.paused) { await els.video.play(); els.sourcePlay.textContent = "一時停止"; } else { els.video.pause(); els.sourcePlay.textContent = "再生"; } });
els.video.addEventListener("ended", () => { if (sourceMode === "library-video") els.sourcePlay.textContent = "最初から再生"; if (recording && recordingKind === "video") stopRecording(); else if (recording && recordingKind === "timelapse") stopTimelapse(); });
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
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

els.canvas.addEventListener("pointerdown", (event) => {
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
  const wasTap = tapState?.id === event.pointerId && !tapState.moved && pointers.size === 1;
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
els.canvas.addEventListener("pointerup", releasePointer); els.canvas.addEventListener("pointercancel", releasePointer);

window.addEventListener("resize", () => syncUI({ persist: false }));
document.addEventListener("visibilitychange", () => { if (document.hidden) renderer.pause(); else if (sourceMode !== "camera" || camera.stream) renderer.start(); });
window.addEventListener("pagehide", () => { renderer.destroy(); camera.stop(); closeObjectUrl(); releaseLibrarySource(); disableLevel(); });
