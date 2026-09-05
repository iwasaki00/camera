import { CameraController } from "./js/camera.js";
import { AudioEngine, SOUND_LABELS } from "./js/audio.js";
import { ActionDetector } from "./js/actionDetector.js";
import { FaceMode, FACE_THRESHOLDS } from "./js/faceMode.js";
import { BodyMode, BODY_THRESHOLDS } from "./js/bodyMode.js";
import { ACTIONS, PRESETS, SOUND_OPTIONS, createDefaultSensitivities, loadSettings, saveSettings, scaledThreshold } from "./js/settings.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  start: $("#startScreen"), play: $("#playScreen"), video: $("#camera"), canvas: $("#overlay"),
  startButton: $("#startButton"), startStatus: $("#startStatus"), backButton: $("#backButton"),
  settingsButton: $("#settingsButton"), settings: $("#settingsDialog"), trackingText: $("#trackingText"),
  trackingDot: $("#trackingDot"), modeLabel: $("#modeLabel"), modeHint: $("#modeHint"),
  lastSound: $("#lastSound"), lastAction: $("#lastAction"), lastIntensity: $("#lastIntensity"), noteBurst: $("#noteBurst"),
  gestureStrip: $("#gestureStrip"), debugToggle: $("#debugToggle"), debugPanel: $("#debugPanel"),
  debugRecognition: $("#debugRecognition"), debugFps: $("#debugFps"), debugScores: $("#debugScores"), debugLog: $("#debugLog"),
  preset: $("#presetSelect"), sensitivityList: $("#sensitivityList"), resetSensitivity: $("#resetSensitivityButton"),
  cooldown: $("#cooldownRange"), cooldownValue: $("#cooldownValue"), volume: $("#volumeRange"),
  volumeValue: $("#volumeValue"), assignments: $("#assignmentList"),
};

const camera = new CameraController(ui.video);
const audio = new AudioEngine();
const detector = new ActionDetector();
let settings = loadSettings();
let mode = "face";
let recognizer = null;
let running = false;
let animationId = 0;
let lastVideoTime = -1;
let lastInferenceAt = 0;
let fpsFrames = 0;
let fpsStartedAt = performance.now();
let currentFps = 0;
let modeGeneration = 0;
let actionStates = {};

function setTracking(text, state = "") {
  ui.trackingText.textContent = text;
  ui.trackingDot.className = state;
  if (!ui.debugPanel.hidden) ui.debugRecognition.textContent = `認識データ · ${text}`;
}

function resizeCanvas() {
  const rect = ui.canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (ui.canvas.width !== width || ui.canvas.height !== height) {
    ui.canvas.width = width;
    ui.canvas.height = height;
  }
}

function renderGestureStrip() {
  const currentKeys = [...ui.gestureStrip.children].map((item) => item.dataset.action).join(",");
  const nextKeys = ACTIONS[mode].map(([key]) => key).join(",");
  if (currentKeys !== nextKeys) {
    ui.gestureStrip.replaceChildren(...ACTIONS[mode].map(([key, label]) => {
      const item = document.createElement("span");
      item.className = "gesture-chip"; item.dataset.action = key; item.textContent = label;
      return item;
    }));
  }
  [...ui.gestureStrip.children].forEach((item) => item.classList.toggle("active", actionStates[item.dataset.action]?.phase === "active"));
}

function renderDebug(scores = {}, thresholds = {}, motion = {}) {
  const currentKeys = [...ui.debugScores.children].map((item) => item.dataset.action).join(",");
  const nextKeys = ACTIONS[mode].map(([key]) => key).join(",");
  if (currentKeys !== nextKeys) {
    ui.debugScores.replaceChildren(...ACTIONS[mode].map(([key, label]) => {
      const row = document.createElement("div");
      row.className = "debug-score"; row.dataset.action = key;
      const name = document.createElement("span"); name.textContent = label;
      const value = document.createElement("b");
      row.append(name, value);
      if (mode === "body") {
        const motionValue = document.createElement("small");
        motionValue.className = "debug-motion";
        row.append(motionValue);
      }
      return row;
    }));
  }
  [...ui.debugScores.children].forEach((row) => {
    const key = row.dataset.action;
    const state = actionStates[key] || { phase: "inactive" };
    row.classList.toggle("on", state.phase === "active");
    row.querySelector("b").textContent = `${(scores[key] || 0).toFixed(2)} / ${(thresholds[key] || 0).toFixed(2)} · ${state.phase}`;
    const motionValue = row.querySelector(".debug-motion");
    if (motionValue) {
      const values = motion[key] || { speed: 0, volume: 0.25 };
      motionValue.textContent = `SPD ${values.speed.toFixed(2)}  ·  VOL ${values.volume.toFixed(2)}`;
    }
  });
}

function triggerSound(actionKey, motion = null) {
  const sound = settings.assignments[mode][actionKey];
  const speed = mode === "body" ? motion?.speed || 0 : 0;
  const intensity = mode === "body" ? motion?.volume ?? 0.25 : 1;
  audio.play(sound, intensity);
  const label = ACTIONS[mode].find(([key]) => key === actionKey)?.[1] || actionKey;
  ui.lastSound.textContent = SOUND_LABELS[sound] || sound;
  ui.lastAction.textContent = label;
  ui.lastIntensity.textContent = mode === "body" ? `強さ ${Math.round(intensity * 100)}%` : "固定音量";
  ui.debugLog.textContent = `発音ログ: ${new Date().toLocaleTimeString("ja-JP")} / ${label} → ${SOUND_LABELS[sound]} / velocity ${speed.toFixed(2)} / volume ${intensity.toFixed(2)}`;
  const chip = ui.gestureStrip.querySelector(`[data-action="${actionKey}"]`);
  if (chip) {
    chip.style.setProperty("--hit-glow", `${Math.round(5 + 14 * intensity)}px`);
    chip.style.setProperty("--hit-alpha", (0.16 + 0.48 * intensity).toFixed(2));
    chip.classList.remove("hit");
    void chip.offsetWidth;
    chip.classList.add("hit");
  }
  ui.noteBurst.classList.remove("play");
  void ui.noteBurst.offsetWidth;
  ui.noteBurst.classList.add("play");
  if (navigator.vibrate) navigator.vibrate(18);
}

async function switchMode(nextMode) {
  if (!running || (nextMode === mode && recognizer)) return;
  const generation = ++modeGeneration;
  mode = nextMode;
  recognizer?.close();
  recognizer = null;
  detector.reset();
  actionStates = {};
  ui.canvas.getContext("2d").clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  $$("[data-play-mode]").forEach((button) => button.classList.toggle("active", button.dataset.playMode === mode));
  ui.modeLabel.textContent = mode === "face" ? "顔モード" : "体モード";
  ui.modeHint.textContent = mode === "face" ? "顔を画面の中央へ" : "全身が映る位置へ";
  renderGestureStrip();
  renderAssignments();
  setTracking(`${mode === "face" ? "顔" : "体"}モデルを準備中…`);
  try {
    const next = mode === "face" ? new FaceMode() : new BodyMode();
    await next.init();
    if (!running || generation !== modeGeneration) { next.close(); return; }
    recognizer = next;
    lastVideoTime = -1;
    setTracking("認識を待っています", "ready");
  } catch (error) {
    console.error(error);
    setTracking("モデルを読み込めません", "error");
  }
}

function processResult(result, now) {
  const bases = mode === "face" ? FACE_THRESHOLDS : BODY_THRESHOLDS;
  const thresholds = Object.fromEntries(Object.entries(bases).map(([key, value]) => [
    key,
    scaledThreshold(value, settings.sensitivities[mode][key]),
  ]));
  const scores = { ...result.scores };
  // 両手の現在の個別感度を尊重しつつ、成立時はCrashだけを優先する。
  if (mode === "body" && scores.bothHands >= thresholds.bothHands) {
    scores.leftHand = 0;
    scores.rightHand = 0;
  }
  if (result.detected) {
    setTracking(mode === "face" ? "顔を認識中" : "体を認識中", "ready");
    for (const [key] of ACTIONS[mode]) {
      const status = detector.update(key, scores[key] || 0, thresholds[key], now);
      status.speed = result.motion?.[key]?.speed || 0;
      status.volume = result.motion?.[key]?.volume ?? (mode === "body" ? 0.25 : 1);
      actionStates[key] = status;
      if (status.triggered) triggerSound(key, result.motion?.[key]);
    }
  } else {
    setTracking(mode === "face" ? "顔を探しています" : "全身を探しています");
  }
  renderGestureStrip();
  if (!ui.debugPanel.hidden) renderDebug(scores, thresholds, result.motion);
}

function renderFrame(now) {
  if (!running) return;
  animationId = requestAnimationFrame(renderFrame);
  // iPhoneでの発熱を抑えるため、推論は最大24fpsに制限する。
  if (!recognizer || ui.video.readyState < 2 || ui.video.currentTime === lastVideoTime || now - lastInferenceAt < 41) return;
  lastInferenceAt = now;
  lastVideoTime = ui.video.currentTime;
  resizeCanvas();
  const ctx = ui.canvas.getContext("2d");
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  const scale = Math.max(ui.canvas.width / ui.video.videoWidth, ui.canvas.height / ui.video.videoHeight);
  ctx.videoMap = {
    width: ui.video.videoWidth * scale,
    height: ui.video.videoHeight * scale,
    x: (ui.canvas.width - ui.video.videoWidth * scale) / 2,
    y: (ui.canvas.height - ui.video.videoHeight * scale) / 2,
  };
  try {
    const result = recognizer.detect(ui.video, now);
    recognizer.draw(ctx, result.landmarks);
    processResult(result, now);
  } catch (error) {
    console.error(error);
    setTracking("認識処理でエラー", "error");
  }
  fpsFrames++;
  if (now - fpsStartedAt >= 1000) {
    currentFps = Math.round(fpsFrames * 1000 / (now - fpsStartedAt));
    if (!ui.debugPanel.hidden) ui.debugFps.textContent = `${currentFps} FPS / ${mode === "face" ? "FACE" : "POSE"}`;
    fpsFrames = 0; fpsStartedAt = now;
  }
}

async function startApp() {
  ui.startButton.disabled = true;
  ui.startStatus.classList.remove("error");
  ui.startStatus.textContent = "カメラと音を準備しています…";
  mode = $("input[name='startMode']:checked").value;
  try {
    // 音声アンロックを最初のユーザー操作の同期チェーン内で実行する。
    await audio.unlock();
    audio.setVolume(settings.volume / 100);
    await camera.start();
    running = true;
    ui.start.classList.remove("active");
    ui.play.classList.add("active");
    renderGestureStrip();
    renderSettings();
    requestAnimationFrame(renderFrame);
    await switchMode(mode);
  } catch (error) {
    console.error(error);
    camera.stop();
    running = false;
    ui.startStatus.textContent = error.name === "NotAllowedError" ? "カメラが許可されていません。Safariの設定を確認してください。" : `開始できません: ${error.message}`;
    ui.startStatus.classList.add("error");
  } finally {
    ui.startButton.disabled = false;
  }
}

function stopApp() {
  running = false;
  ++modeGeneration;
  cancelAnimationFrame(animationId);
  recognizer?.close(); recognizer = null;
  camera.stop(); detector.reset();
  ui.play.classList.remove("active");
  ui.start.classList.add("active");
  ui.startStatus.textContent = "もう一度タップすると再開できます";
}

function renderAssignments() {
  if (!settings.assignments[mode]) settings.assignments[mode] = { ...PRESETS.drum[mode] };
  ui.assignments.replaceChildren(...ACTIONS[mode].map(([key, label]) => {
    const row = document.createElement("div");
    row.className = "assignment-row";
    const name = document.createElement("span"); name.textContent = label;
    const select = document.createElement("select"); select.setAttribute("aria-label", `${label}の音`);
    SOUND_OPTIONS.forEach((sound) => select.add(new Option(SOUND_LABELS[sound], sound)));
    select.value = settings.assignments[mode][key];
    select.addEventListener("change", () => { settings.assignments[mode][key] = select.value; settings.preset = "custom"; saveSettings(settings); });
    const preview = document.createElement("button"); preview.type = "button"; preview.textContent = "♪"; preview.setAttribute("aria-label", `${label}の音を試聴`);
    preview.addEventListener("click", () => audio.play(select.value));
    row.append(name, select, preview);
    return row;
  }));
}

function renderSettings() {
  ui.preset.value = ["drum", "piano", "effect"].includes(settings.preset) ? settings.preset : "drum";
  ui.cooldown.value = settings.cooldown; ui.cooldownValue.textContent = `${settings.cooldown} ms`;
  ui.volume.value = settings.volume; ui.volumeValue.textContent = `${settings.volume}%`;
  detector.setCooldown(settings.cooldown);
  renderSensitivityControls();
  renderAssignments();
}

function renderSensitivityControls() {
  ui.sensitivityList.replaceChildren(...["face", "body"].map((selectedMode) => {
    const group = document.createElement("details");
    group.className = "sensitivity-group";
    group.open = selectedMode === mode;
    const summary = document.createElement("summary");
    summary.textContent = selectedMode === "face" ? "顔モード" : "体モード";
    const items = document.createElement("div");
    items.className = "sensitivity-items";

    ACTIONS[selectedMode].forEach(([key, label]) => {
      const row = document.createElement("label");
      row.className = "action-sensitivity";
      const heading = document.createElement("span");
      const name = document.createElement("b"); name.textContent = label;
      const value = document.createElement("output"); value.textContent = `感度 ${settings.sensitivities[selectedMode][key]}`;
      const slider = document.createElement("input");
      slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "1";
      slider.value = settings.sensitivities[selectedMode][key];
      slider.setAttribute("aria-label", `${label}の感度`);
      slider.addEventListener("input", () => {
        settings.sensitivities[selectedMode][key] = Number(slider.value);
        value.textContent = `感度 ${slider.value}`;
      });
      slider.addEventListener("change", () => saveSettings(settings));
      heading.append(name, value); row.append(heading, slider); items.append(row);
    });
    group.append(summary, items);
    return group;
  }));
}

ui.startButton.addEventListener("click", startApp);
ui.backButton.addEventListener("click", stopApp);
ui.settingsButton.addEventListener("click", () => { renderSettings(); ui.settings.showModal(); });
ui.debugToggle.addEventListener("click", () => {
  ui.debugPanel.hidden = !ui.debugPanel.hidden;
  ui.debugToggle.setAttribute("aria-pressed", String(!ui.debugPanel.hidden));
  ui.debugToggle.querySelector("b").textContent = ui.debugPanel.hidden ? "OFF" : "ON";
  if (!ui.debugPanel.hidden) ui.debugRecognition.textContent = `認識データ · ${ui.trackingText.textContent}`;
});

$$('.mode-card input').forEach((input) => input.addEventListener("change", () => {
  $$(".mode-card").forEach((card) => card.classList.toggle("selected", card.contains(input) && input.checked));
}));
$$('[data-play-mode]').forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.playMode)));

ui.preset.addEventListener("change", () => {
  settings.preset = ui.preset.value;
  settings.assignments = JSON.parse(JSON.stringify(PRESETS[settings.preset]));
  saveSettings(settings); renderAssignments();
});
ui.resetSensitivity.addEventListener("click", () => {
  if (!window.confirm("顔・体すべての感度を初期値に戻しますか？")) return;
  settings.sensitivities = createDefaultSensitivities();
  saveSettings(settings);
  renderSensitivityControls();
});
ui.cooldown.addEventListener("input", () => { settings.cooldown = Number(ui.cooldown.value); ui.cooldownValue.textContent = `${settings.cooldown} ms`; detector.setCooldown(settings.cooldown); saveSettings(settings); });
ui.volume.addEventListener("input", () => { settings.volume = Number(ui.volume.value); ui.volumeValue.textContent = `${settings.volume}%`; audio.setVolume(settings.volume / 100); saveSettings(settings); });

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pagehide", () => { if (running) stopApp(); });
renderSettings();
