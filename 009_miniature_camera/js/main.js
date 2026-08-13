import { CameraController } from "./camera.js";
import { MiniatureRenderer } from "./renderer.js";
import { CanvasRecorder, supportedMimeType } from "./recorder.js";
import { CONTROL_DEFS, DEFAULTS, PRESETS } from "./presets.js";

const $ = (selector) => document.querySelector(selector);
const els = {
  video: $("#sourceVideo"), canvas: $("#previewCanvas"), viewport: $("#viewport"),
  empty: $("#emptyState"), start: $("#startButton"), shutter: $("#shutterButton"),
  photoMode: $("#photoMode"), videoMode: $("#videoMode"), flip: $("#flipButton"),
  settings: $("#settingsButton"), sheet: $("#settingsSheet"), backdrop: $("#sheetBackdrop"), closeSettings: $("#closeSettings"),
  preset: $("#presetSelect"), guide: $("#focusGuide"), guideButton: $("#guideButton"), enhanceButton: $("#enhanceButton"),
  sliders: $("#sliders"), quality: $("#qualitySelect"), audio: $("#audioToggle"), debug: $("#debugToggle"), debugPanel: $("#debugPanel"),
  resetAll: $("#resetAll"), recStatus: $("#recStatus"), recTime: $("#recTime"), toast: $("#toast"),
  dialog: $("#reviewDialog"), photoReview: $("#photoReview"), videoReview: $("#videoReview"), reviewLabel: $("#reviewLabel"),
  speedRow: $("#speedRow"), saveHelp: $("#saveHelp"), save: $("#saveButton"), download: $("#downloadLink"), retake: $("#retakeButton"), closeReview: $("#closeReview"),
};

let params = { ...DEFAULTS };
let mode = "photo";
let recording = false;
let recordingStarted = 0;
let timerId;
let objectUrl = "";
let reviewBlob = null;
let reviewFilename = "";
let currentFps = 0;
let enhance = true;
let toastTimer;
const camera = new CameraController(els.video);
const renderer = new MiniatureRenderer(els.video, els.canvas, (fps) => { currentFps = fps; updateDebug(); });
const recorder = new CanvasRecorder(els.canvas);

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
  };
  return !window.isSecureContext && location.hostname !== "localhost" ? "カメラの利用にはHTTPS接続が必要です。" : (messages[name] || "カメラを開始できませんでした。端末の設定を確認してください。");
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

function syncUI() {
  renderer.setParams(params, enhance);
  els.guide.style.setProperty("--focus-pos", `${params.position}%`);
  els.guide.style.setProperty("--focus-width", `${params.width}%`);
  els.guide.style.setProperty("--focus-angle", `${params.angle}deg`);
  CONTROL_DEFS.forEach((def) => {
    const input = $(`#control-${def.key}`), output = input?.nextElementSibling;
    if (input) input.value = params[def.key];
    if (output) output.value = `${params[def.key]}${def.unit}`;
  });
  updateDebug();
}

async function startCamera() {
  els.start.disabled = true;
  els.start.textContent = "起動中…";
  try {
    await camera.start({ quality: els.quality.value });
    renderer.start();
    els.empty.hidden = true;
    els.shutter.disabled = false;
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
  const photo = next === "photo";
  els.photoMode.classList.toggle("is-active", photo);
  els.videoMode.classList.toggle("is-active", !photo);
  els.photoMode.setAttribute("aria-selected", photo);
  els.videoMode.setAttribute("aria-selected", !photo);
  els.shutter.classList.toggle("is-video", !photo);
  els.shutter.setAttribute("aria-label", photo ? "写真を撮影" : "動画を録画");
}

function closeObjectUrl() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
  reviewBlob = null;
  reviewFilename = "";
  els.photoReview.removeAttribute("src");
  els.videoReview.pause();
  els.videoReview.removeAttribute("src");
  els.videoReview.load();
}

function showReview(blob, type) {
  closeObjectUrl();
  objectUrl = URL.createObjectURL(blob);
  const photo = type === "photo";
  els.photoReview.hidden = !photo;
  els.videoReview.hidden = photo;
  els.speedRow.hidden = photo;
  els.reviewLabel.textContent = photo ? "PHOTO PREVIEW" : "VIDEO PREVIEW";
  if (photo) els.photoReview.src = objectUrl; else els.videoReview.src = objectUrl;
  const ext = photo ? "jpg" : (blob.type.includes("mp4") ? "mp4" : "webm");
  reviewBlob = blob;
  reviewFilename = `miniature-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  els.download.href = objectUrl;
  els.download.download = reviewFilename;
  els.save.textContent = "保存・共有";
  els.saveHelp.textContent = photo
    ? "iPhoneでは「保存・共有」を押し、共有メニューの「画像を保存」を選ぶと写真アプリに入ります。"
    : "iPhoneでは「保存・共有」を押し、共有メニューの「ビデオを保存」を選ぶと写真アプリに入ります。";
  els.speedRow.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.speed === "1"));
  els.videoReview.playbackRate = 1;
  els.dialog.showModal();
}

async function saveReview() {
  if (!reviewBlob || !reviewFilename) return;
  const file = new File([reviewBlob], reviewFilename, { type: reviewBlob.type || "application/octet-stream" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Miniature Camera" });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  els.download.click();
  showToast("ダウンロードに保存しました。Safariのダウンロード一覧を確認してください。", 5000);
}

function takePhoto() {
  els.guide.classList.add("is-hidden");
  els.canvas.toBlob((blob) => {
    if (!blob) return showToast("写真を保存用に準備できませんでした。");
    showReview(blob, "photo");
  }, "image/jpeg", .92);
  setTimeout(() => els.guide.classList.toggle("is-hidden", els.guideButton.getAttribute("aria-pressed") !== "true"), 80);
}

async function startRecording() {
  if (!recorder.supported) return showToast(friendlyError(new Error("RECORDING_UNSUPPORTED")), 5000);
  let audioStream = null;
  if (els.audio.checked) {
    try { audioStream = await camera.setAudio(true); }
    catch (error) { els.audio.checked = false; showToast(friendlyError(error, "audio"), 5000); }
  }
  try {
    recorder.start(audioStream, camera.settings.frameRate || 30);
    recording = true;
    recordingStarted = Date.now();
    els.recStatus.hidden = false;
    els.shutter.classList.add("is-recording");
    els.shutter.setAttribute("aria-label", "録画を停止");
    els.guide.classList.add("is-hidden");
    timerId = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStarted) / 1000);
      els.recTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }, 250);
  } catch (error) { showToast(friendlyError(error), 5000); }
}

async function stopRecording() {
  clearInterval(timerId);
  try {
    const blob = await recorder.stop();
    camera.stopAudio();
    recording = false;
    els.recStatus.hidden = true;
    els.shutter.classList.remove("is-recording");
    els.shutter.setAttribute("aria-label", "動画を録画");
    els.guide.classList.toggle("is-hidden", els.guideButton.getAttribute("aria-pressed") !== "true");
    showReview(blob, "video");
    updateDebug(blob.size);
  } catch {
    camera.stopAudio();
    recording = false;
    els.recStatus.hidden = true;
    els.shutter.classList.remove("is-recording");
    showToast("録画データを作成できませんでした。空き容量を確認してください。");
  }
}

function openSettings(open) {
  els.sheet.classList.toggle("is-open", open);
  els.sheet.setAttribute("aria-hidden", !open);
  els.settings.setAttribute("aria-expanded", open);
  els.backdrop.hidden = !open;
}

function updateDebug(blobSize = null) {
  if (!els.debug.checked) return;
  const s = camera.settings;
  const data = [
    `Browser: ${navigator.userAgent}`,
    `Camera: ${camera.facingMode}`,
    `Video: ${s.width || 0}×${s.height || 0} @ ${s.frameRate || "?"}fps`,
    `Render FPS: ${currentFps}`,
    `Canvas: ${els.canvas.width}×${els.canvas.height}`,
    `Renderer: ${renderer.mode}`,
    `MediaRecorder: ${window.MediaRecorder ? "yes" : "no"}`,
    `MIME: ${supportedMimeType() || "none"}`,
    `Audio track: ${camera.audioStream?.getAudioTracks().length || 0}`,
    `Video track: ${camera.stream?.getVideoTracks().length || 0}`,
    `Last Blob: ${blobSize == null ? "-" : `${(blobSize / 1024 / 1024).toFixed(2)} MB`}`,
  ];
  els.debugPanel.textContent = data.join("\n");
}

renderControls();
syncUI();
els.start.addEventListener("click", startCamera);
els.photoMode.addEventListener("click", () => setMode("photo"));
els.videoMode.addEventListener("click", () => setMode("video"));
els.shutter.addEventListener("click", () => mode === "photo" ? takePhoto() : (recording ? stopRecording() : startRecording()));
els.flip.addEventListener("click", async () => { if (!camera.stream || recording) return; els.flip.disabled = true; try { await camera.flip(); showToast(camera.facingMode === "user" ? "前面カメラ" : "背面カメラ"); } catch (e) { showToast(friendlyError(e)); } finally { els.flip.disabled = false; } });
els.settings.addEventListener("click", () => openSettings(true));
els.closeSettings.addEventListener("click", () => openSettings(false));
els.backdrop.addEventListener("click", () => openSettings(false));
els.sliders.addEventListener("input", (event) => { const key = event.target.dataset.key; if (!key) return; params[key] = Number(event.target.value); els.preset.value = "standard"; syncUI(); });
els.sliders.addEventListener("click", (event) => { const key = event.target.dataset.reset; if (!key) return; params[key] = DEFAULTS[key]; syncUI(); });
els.preset.addEventListener("change", () => { params = { ...PRESETS[els.preset.value] }; syncUI(); });
els.resetAll.addEventListener("click", () => { params = { ...DEFAULTS }; els.preset.value = "standard"; enhance = true; els.enhanceButton.setAttribute("aria-pressed", "true"); els.enhanceButton.querySelector("b").textContent = "ON"; syncUI(); });
els.guideButton.addEventListener("click", () => { const on = els.guideButton.getAttribute("aria-pressed") !== "true"; els.guideButton.setAttribute("aria-pressed", on); els.guideButton.querySelector("b").textContent = on ? "ON" : "OFF"; els.guide.classList.toggle("is-hidden", !on); });
els.enhanceButton.addEventListener("click", () => { enhance = !enhance; els.enhanceButton.setAttribute("aria-pressed", enhance); els.enhanceButton.querySelector("b").textContent = enhance ? "ON" : "OFF"; syncUI(); });
els.quality.addEventListener("change", async () => { if (!camera.stream) return; try { await camera.start({ quality: els.quality.value }); showToast("画質を変更しました"); } catch (e) { showToast(friendlyError(e)); } });
els.audio.addEventListener("change", () => { if (!els.audio.checked) camera.stopAudio(); });
els.debug.addEventListener("change", () => { els.debugPanel.hidden = !els.debug.checked; updateDebug(); });
els.retake.addEventListener("click", () => { els.dialog.close(); closeObjectUrl(); });
els.closeReview.addEventListener("click", () => { els.dialog.close(); closeObjectUrl(); });
els.save.addEventListener("click", saveReview);
els.speedRow.addEventListener("click", (event) => { const speed = Number(event.target.dataset.speed); if (!speed) return; els.videoReview.playbackRate = speed; els.speedRow.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === event.target)); });

let dragY = null, pinchStart = null;
const activePointers = new Set();
els.canvas.addEventListener("pointerdown", (event) => {
  activePointers.add(event.pointerId);
  dragY = activePointers.size === 1 ? event.clientY : null;
  els.canvas.setPointerCapture(event.pointerId);
});
els.canvas.addEventListener("pointermove", (event) => { if (dragY == null || activePointers.size !== 1) return; const rect = els.canvas.getBoundingClientRect(); params.position = Math.max(15, Math.min(85, params.position + (event.clientY - dragY) / rect.height * 100)); dragY = event.clientY; syncUI(); });
function releasePointer(event) { activePointers.delete(event.pointerId); dragY = null; }
els.canvas.addEventListener("pointerup", releasePointer);
els.canvas.addEventListener("pointercancel", releasePointer);
els.canvas.addEventListener("touchstart", (event) => { if (event.touches.length === 2) pinchStart = { distance: Math.abs(event.touches[0].clientY - event.touches[1].clientY), width: params.width }; }, { passive: true });
els.canvas.addEventListener("touchmove", (event) => { if (event.touches.length === 2 && pinchStart) { const d = Math.abs(event.touches[0].clientY - event.touches[1].clientY); params.width = Math.max(8, Math.min(55, pinchStart.width * d / Math.max(1, pinchStart.distance))); syncUI(); } }, { passive: true });
els.canvas.addEventListener("touchend", () => { pinchStart = null; }, { passive: true });

document.addEventListener("visibilitychange", () => { if (document.hidden) renderer.pause(); else if (camera.stream) renderer.start(); });
window.addEventListener("pagehide", () => { renderer.destroy(); camera.stop(); closeObjectUrl(); });
