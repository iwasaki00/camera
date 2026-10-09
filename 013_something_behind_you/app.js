import {
  clamp,
  normalizeDegrees,
  signedAngleDifference,
  relativeHeading,
  turnSpeed,
  sideFromDifference,
  peripheralReveal,
  chooseRelocatedYaw
} from "./logic.js";

import { EncounterDirector, ENCOUNTER_CONFIG } from "./encounters.js";
import { Stalker, STALKER_CONFIG } from "./stalker.js";
import { PresenceDirector, PRESENCE_CONFIG } from "./presence.js";
import { PresenceAudio } from "./audio.js";

const VERSION = "1.0.0 — PRESENCE EXPERIENCE";
const director = new EncounterDirector();
const stalker = new Stalker();
const presence = new PresenceDirector();
const audio = new PresenceAudio(window.AudioContext || window.webkitAudioContext);
let audioSession = 0;
let startGeneration = 0;
let encounterPausedAt = null;
director.setProfile(stalker.profile);
const encounterView = {
  element: document.querySelector("#encounterVisual"),
  debug: document.querySelector("#debugEncounter"),
  buttons: [...document.querySelectorAll("[data-test-encounter]")],
  animation: null,
  endAt: null,
  peekLevel: 0,
  passDirection: "—",
  flyByDirection: "—",
  escapeStartedAt: null,
  profile: null
};

// 実機で体感を調整する値は、このオブジェクトだけに集約する。
const CONFIG = Object.freeze({
  peripheralZonePercent: 18,
  peripheralEnterAngle: 46,
  peripheralExitAngle: 58,
  spottedAngle: 15,
  fastTurnThreshold: 46,
  minimumApproachSpeed: 14,
  escapeDuration: 180,
  relocateMinimumAngle: 78,
  entitySizeVw: 54,
  orientationTimeout: 3500,
  sensorSmoothing: 0.38,
  speedSmoothing: 0.35,
  debugRefreshInterval: 100
});

const STATES = Object.freeze({
  HIDDEN: "HIDDEN",
  STALKING: "STALKING",
  PERIPHERAL: "PERIPHERAL",
  SPOTTED: "SPOTTED",
  ESCAPE: "ESCAPE",
  RELOCATE: "RELOCATE"
});

let debugEnabled = false;
document.documentElement.style.setProperty("--escape-duration", `${CONFIG.escapeDuration}ms`);
document.documentElement.style.setProperty("--entity-size", `${CONFIG.entitySizeVw}vw`);
document.documentElement.style.setProperty("--peripheral-zone", `${CONFIG.peripheralZonePercent}%`);

const elements = {
  game: document.querySelector("#game"),
  camera: document.querySelector("#camera"),
  entity: document.querySelector("#entity"),
  startScreen: document.querySelector("#startScreen"),
  startButton: document.querySelector("#startButton"),
  startStatus: document.querySelector("#startStatus"),
  stopButton: document.querySelector("#stopButton"),
  message: document.querySelector("#message"),
  messageTitle: document.querySelector("#messageTitle"),
  messageBody: document.querySelector("#messageBody"),
  retryButton: document.querySelector("#retryButton"),
  debugPanel: document.querySelector("#debugPanel"),
  debugToggle: document.querySelector("#debugToggle"),
  debugGuides: document.querySelector("#debugGuides"),
  debugTests: document.querySelector("#debugTests"),
  debugCurrentYaw: document.querySelector("#debugCurrentYaw"),
  debugInitialYaw: document.querySelector("#debugInitialYaw"),
  debugRelativeYaw: document.querySelector("#debugRelativeYaw"),
  debugEntityYaw: document.querySelector("#debugEntityYaw"),
  debugAngleDiff: document.querySelector("#debugAngleDiff"),
  debugTurnSpeed: document.querySelector("#debugTurnSpeed"),
  debugState: document.querySelector("#debugState"),
  debugSide: document.querySelector("#debugSide"),
  debugCamera: document.querySelector("#debugCamera"),
  debugOrientation: document.querySelector("#debugOrientation"),
  debugMotion: document.querySelector("#debugMotion"),
  debugProximity: document.querySelector("#debugProximity"),
  debugDistance: document.querySelector("#debugDistance"),
  debugPresence: document.querySelector("#debugPresence"),
  soundToggle: document.querySelector("#soundToggle"),
  debugApp: document.querySelector("#debugApp")
};

if (Object.values(elements).some((element) => !element)) {
  throw new Error("SOMETHING BEHIND YOU: required DOM element is missing.");
}

const runtime = {
  appState: "READY",
  started: false,
  starting: false,
  state: STATES.HIDDEN,
  cameraPermission: "idle",
  orientationPermission: "idle",
  motionPermission: "idle",
  stream: null,
  initialYaw: null,
  currentYaw: null,
  previousYaw: null,
  relativeYaw: null,
  entityYaw: null,
  angleDiff: null,
  previousAbsDiff: null,
  turnSpeed: 0,
  approachSpeed: 0,
  detectedSide: null,
  lastOrientationAt: 0,
  stalkAvailableAt: Infinity,
  debugUpdatedAt: 0,
  sensorTimeoutId: 0,
  escapeTimeoutId: 0
};

function setState(nextState) {
  runtime.state = nextState;
  if (nextState !== STATES.PERIPHERAL) runtime.previousAbsDiff = null;
}

function setStartStatus(message, isError = false) {
  elements.startStatus.textContent = message;
  elements.startStatus.classList.toggle("is-error", isError);
}

function showMessage(title, body, allowRetry = true) {
  elements.messageTitle.textContent = title;
  elements.messageBody.textContent = body;
  elements.retryButton.hidden = !allowRetry;
  elements.message.hidden = false;
}

function hideMessage() {
  elements.message.hidden = true;
}

function readableAngle(value, suffix = "°") {
  return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "—";
}

function orientationYaw(event) {
  if (Number.isFinite(event.webkitCompassHeading)) {
    return normalizeDegrees(event.webkitCompassHeading);
  }

  if (Number.isFinite(event.alpha)) {
    // alphaの回転方向を、右旋回が正になるコンパス方位へ合わせる。
    return normalizeDegrees(360 - event.alpha);
  }

  return null;
}

function handleOrientation(event) {
  if (!runtime.started || document.hidden) return;
  const rawYaw = orientationYaw(event);
  if (rawYaw === null) return;

  const now = performance.now();
  const elapsed = runtime.lastOrientationAt ? now - runtime.lastOrientationAt : 0;
  runtime.lastOrientationAt = now;

  if (runtime.currentYaw === null || elapsed > 1000) {
    runtime.currentYaw = rawYaw;
    runtime.previousYaw = rawYaw;
    runtime.turnSpeed = 0;
  } else {
    const smoothingDelta = signedAngleDifference(rawYaw, runtime.currentYaw);
    runtime.previousYaw = runtime.currentYaw;
    runtime.currentYaw = normalizeDegrees(
      runtime.currentYaw + smoothingDelta * CONFIG.sensorSmoothing
    );

    const instantSpeed = turnSpeed(runtime.currentYaw, runtime.previousYaw, elapsed);
    runtime.turnSpeed += (instantSpeed - runtime.turnSpeed) * CONFIG.speedSmoothing;
  }

  if (!runtime.started) return;

  if (runtime.initialYaw === null) {
    runtime.initialYaw = runtime.currentYaw;
    runtime.relativeYaw = 0;
    runtime.entityYaw = chooseRelocatedYaw(0, CONFIG.relocateMinimumAngle);
    runtime.stalkAvailableAt = now;
    runtime.angleDiff = signedAngleDifference(runtime.entityYaw, 0);
    director.reset();
    runtime.orientationPermission = "active";
    window.clearTimeout(runtime.sensorTimeoutId);
    hideMessage();
    return;
  }

  runtime.relativeYaw = relativeHeading(runtime.currentYaw, runtime.initialYaw);
  runtime.angleDiff = signedAngleDifference(runtime.entityYaw, runtime.relativeYaw);
}

function requestPermissionFrom(api) {
  if (!api || typeof api.requestPermission !== "function") {
    return Promise.resolve("not-required");
  }

  try {
    return Promise.resolve(api.requestPermission()).catch(() => "denied");
  } catch {
    return Promise.resolve("denied");
  }
}

function requestOrientationPermission() {
  if (!("DeviceOrientationEvent" in window)) {
    runtime.orientationPermission = "unsupported";
    return Promise.resolve("unsupported");
  }

  runtime.orientationPermission = "requesting";
  return requestPermissionFrom(window.DeviceOrientationEvent).then((result) => {
    runtime.orientationPermission = result === "granted" || result === "not-required"
      ? "listening"
      : result;
    return runtime.orientationPermission;
  });
}

function requestMotionPermission() {
  if (!("DeviceMotionEvent" in window)) {
    runtime.motionPermission = "unsupported";
    return Promise.resolve("unsupported");
  }

  runtime.motionPermission = "requesting";
  return requestPermissionFrom(window.DeviceMotionEvent).then((result) => {
    runtime.motionPermission = result === "granted" || result === "not-required"
      ? "granted"
      : result;
    return runtime.motionPermission;
  });
}

function cameraFailureMessage(error) {
  if (!window.isSecureContext) {
    return "カメラにはHTTPSのページが必要です。GitHub PagesなどのHTTPS環境で開いてください。";
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return "このブラウザはカメラ起動に対応していません。iPhoneのSafariで開いてください。";
  }

  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "カメラの使用が許可されませんでした。SafariのWebサイト設定でカメラを許可してください。";
  }

  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    return "利用できる背面カメラが見つかりませんでした。";
  }

  return "カメラ映像を取得できませんでした。ほかのアプリがカメラを使用していないか確認してください。";
}

async function startCamera(generation) {
  runtime.cameraPermission = "requesting";

  if (!navigator.mediaDevices?.getUserMedia) {
    runtime.cameraPermission = "unsupported";
    return { ok: false, message: cameraFailureMessage() };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    if (generation !== startGeneration) {
      stream.getTracks().forEach(track => track.stop());
      return { ok: false };
    }
    runtime.stream = stream;
    elements.camera.srcObject = stream;
    await elements.camera.play();
    if (generation !== startGeneration) return { ok: false };
    runtime.cameraPermission = "granted";
    return { ok: true };
  } catch (error) {
    if (generation !== startGeneration) return { ok: false };
    runtime.cameraPermission = error?.name === "NotAllowedError" ? "denied" : "failed";
    return { ok: false, message: cameraFailureMessage(error) };
  }
}

function stopCamera() {
  stalker.pause();
  stopPresence();
  runtime.stream?.getTracks().forEach((track) => track.stop());
  runtime.stream = null;
  elements.camera.srcObject = null;
}

function beginSensorTimeout() {
  window.clearTimeout(runtime.sensorTimeoutId);
  runtime.sensorTimeoutId = window.setTimeout(() => {
    if (!runtime.started || runtime.initialYaw !== null) return;
    runtime.orientationPermission = "no-data";
    showMessage(
      "方向センサーを取得できません",
      "Safariの「モーションと画面の向きのアクセス」を有効にして、ページを再読み込みしてください。"
    );
  }, CONFIG.orientationTimeout);
}

async function startExperience() {
  if (runtime.starting || runtime.started) return;

  const generation = ++startGeneration;
  stopCamera();
  runtime.started = false;
  runtime.appState = "STARTING";
  encounterPausedAt = null;
  elements.game.classList.remove("is-running");
  elements.startScreen.classList.remove("is-hidden");
  elements.stopButton.hidden = false;
  presence.reset();
  audio.lastSpatial = null;
  // resumeは権限ダイアログを待つ前、STARTのユーザー操作内で開始する。
  void audio.unlock();
  runtime.starting = true;
  elements.startButton.disabled = true;
  hideMessage();
  setStartStatus("使用許可を確認しています…");

  // requestPermissionはタップの同期処理内で呼び出す必要があるため、先に全て開始する。
  const orientationRequest = requestOrientationPermission();
  const motionRequest = requestMotionPermission();
  const cameraRequest = startCamera(generation);

  const [orientationStatus, , cameraResult] = await Promise.all([
    orientationRequest,
    motionRequest,
    cameraRequest
  ]);

  if (generation !== startGeneration) {
    return;
  }

  if (!cameraResult.ok) {
    stopCamera();
    setStartStatus(cameraResult.message, true);
    elements.startButton.disabled = false;
    runtime.starting = false;
    runtime.appState = "READY";
    elements.stopButton.hidden = true;
    return;
  }

  if (orientationStatus === "denied" || orientationStatus === "unsupported") {
    stopCamera();
    const message = orientationStatus === "unsupported"
      ? "このブラウザでは方向センサーを利用できません。iPhoneのSafariで開いてください。"
      : "方向センサーの使用が許可されませんでした。Safariの設定を確認してください。";
    setStartStatus(message, true);
    elements.startButton.disabled = false;
    runtime.starting = false;
    runtime.appState = "READY";
    elements.stopButton.hidden = true;
    return;
  }

  runtime.started = true;
  runtime.appState = "RUNNING";
  runtime.starting = false;
  runtime.initialYaw = null;
  runtime.relativeYaw = null;
  runtime.entityYaw = null;
  runtime.angleDiff = null;
  runtime.turnSpeed = 0;
  runtime.currentYaw = null;
  runtime.previousYaw = null;
  runtime.previousAbsDiff = null;
  runtime.approachSpeed = 0;
  runtime.detectedSide = null;
  runtime.lastOrientationAt = -Infinity;
  encounterView.escapeStartedAt = null;
  encounterView.peekLevel = 0;
  encounterView.profile = null;
  stalker.reset();
  director.reset();
  director.setProfile(stalker.profile);
  cleanupEncounterVisual();
  setState(STATES.HIDDEN);

  elements.game.classList.add("is-running");
  elements.startScreen.classList.add("is-hidden");
  window.addEventListener("deviceorientation", handleOrientation, true);
  elements.startButton.disabled = false;
  beginSensorTimeout();
}

function enterPeripheral() {
  runtime.detectedSide = sideFromDifference(runtime.angleDiff, runtime.detectedSide || "RIGHT");
  runtime.previousAbsDiff = Math.abs(runtime.angleDiff);
  runtime.approachSpeed = 0;
  director.begin(performance.now());
  setState(STATES.PERIPHERAL);
}

function renderPeripheral() {
  const reveal = peripheralReveal(
    runtime.angleDiff,
    CONFIG.peripheralEnterAngle,
    CONFIG.spottedAngle
  );
  const side = runtime.detectedSide || "RIGHT";
  const direction = side === "RIGHT" ? 1 : -1;
  const level = Math.abs(runtime.angleDiff) > ENCOUNTER_CONFIG.peekThresholds[0] ? 1
    : Math.abs(runtime.angleDiff) > ENCOUNTER_CONFIG.peekThresholds[1] ? 2 : 3;
  encounterView.peekLevel = level;
  const profile = encounterView.profile || stalker.profile;
  const baseOutside = ENCOUNTER_CONFIG.peekTranslations.at(-1);
  const translate = direction * Math.min(97, profile.peekOutside
    + ENCOUNTER_CONFIG.peekTranslations[level - 1] - baseOutside - reveal * 2);
  const rotation = direction * (2.8 - reveal * 1.6);
  const scale = ENCOUNTER_CONFIG.peekSizes[level - 1] * profile.peekScale;

  elements.entity.dataset.side = side;
  elements.entity.classList.add("is-visible");
  elements.entity.style.opacity = String(0.43 + reveal * 0.42);
  elements.entity.style.transform = `translate3d(${translate}%, -50%, 0) rotate(${rotation}deg) scale(${scale})`;
}

function hideEntity() {
  elements.entity.classList.remove("is-visible", "is-escaping");
  elements.entity.style.opacity = "0";
}

function beginEscape(discovered = false) {
  const generation = startGeneration;
  if (runtime.state !== STATES.PERIPHERAL) return;

  setState(STATES.SPOTTED);
  const side = runtime.detectedSide || "RIGHT";
  const direction = side === "RIGHT" ? 1 : -1;

  window.requestAnimationFrame(() => {
    if (generation !== startGeneration || document.hidden || runtime.appState !== "RUNNING" || runtime.state !== STATES.SPOTTED || director.currentEncounter !== "PEEK") return;
    setState(STATES.ESCAPE);
    stalker.retreat();
    director.setProfile(stalker.profile, performance.now());
    elements.entity.classList.add("is-escaping");
    elements.entity.style.opacity = "0.08";
    elements.entity.style.transform = `translate3d(${direction * 175}%, -52%, 0) rotate(${direction * 11}deg) scale(.82)`;

    encounterView.escapeStartedAt = performance.now();
  });
}

function relocateEntity() {
  const generation = startGeneration;
  stalker.afterEncounter(director.currentEncounter);
  presence.bait = null;
  setState(STATES.RELOCATE);
  hideEntity();

  const current = Number.isFinite(runtime.relativeYaw) ? runtime.relativeYaw : 0;
  runtime.entityYaw = chooseRelocatedYaw(current, CONFIG.relocateMinimumAngle);
  runtime.angleDiff = signedAngleDifference(runtime.entityYaw, current);
  runtime.detectedSide = null;
  runtime.stalkAvailableAt = performance.now();
  encounterView.peekLevel = 0;
  encounterView.escapeStartedAt = null;
  director.finish(performance.now());

  window.requestAnimationFrame(() => {
    if (generation === startGeneration && !document.hidden && runtime.appState === "RUNNING" && runtime.state === STATES.RELOCATE) setState(STATES.STALKING);
  });
}

function cleanupEncounterVisual() {
  encounterView.animation?.cancel();
  encounterView.animation = null;
  encounterView.endAt = null;
  encounterView.element.className = "encounter-visual";
  encounterView.passDirection = "—";
  encounterView.flyByDirection = "—";
}

function prepareEncounter(type, now, forced = false) {
  hideEntity();
  cleanupEncounterVisual();
  encounterView.peekLevel = 0;
  const profile = stalker.profile;
  encounterView.profile = profile;
  setState(STATES.STALKING);
  if (type === "PEEK") {
    if (forced) {
      runtime.entityYaw = normalizeDegrees(runtime.relativeYaw + 40);
      runtime.angleDiff = signedAngleDifference(runtime.entityYaw, runtime.relativeYaw);
    }
    runtime.stalkAvailableAt = now;
    return;
  }
  director.begin(now);
  const sign = Math.random() < 0.5 ? -1 : 1;
  const side = sign > 0 ? "RIGHT" : "LEFT";
  runtime.detectedSide = side;
  encounterView.element.className = `encounter-visual is-active effect-${type.toLowerCase()}`;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let duration;
  let frames;
  if (type === "PASS") {
    duration = ENCOUNTER_CONFIG.passDuration / ENCOUNTER_CONFIG.passSpeed;
    encounterView.passDirection = `${side} → OUT`;
    frames = [
      { transform: `translate3d(${sign * 65}vw, 10vh, 0) rotate(${sign * 25}deg) scale(${.8 * profile.passScale})`, opacity: 0 },
      { offset: .35, transform: `translate3d(${sign * 38}vw, -5vh, 0) rotate(${sign * -12}deg) scale(${1.1 * profile.passScale})`, opacity: .72 },
      { transform: `translate3d(${sign * 80}vw, -43vh, 0) rotate(${sign * -28}deg) scale(${.65 * profile.passScale})`, opacity: .15 }
    ];
  } else if (type === "FLY_BY") {
    duration = ENCOUNTER_CONFIG.flyByDuration;
    encounterView.flyByDirection = `${side} → DIAGONAL AWAY`;
    frames = [
      { transform: `translate3d(${sign * 50}vw, 55vh, 0) rotate(${sign * 40}deg) scale(${ENCOUNTER_CONFIG.flyByScale[0] * profile.flyByScale})`, opacity: .8 },
      { offset: .3, opacity: .68 },
      { transform: `translate3d(${-sign * 70}vw, -55vh, 0) rotate(${sign * -30}deg) scale(${ENCOUNTER_CONFIG.flyByScale[1]})`, opacity: .12 }
    ];
  } else {
    duration = ENCOUNTER_CONFIG.closeCallDuration;
    frames = [
      { transform: `translate3d(${sign * 85}vw, 8vh, 0) scale(${ENCOUNTER_CONFIG.closeCallSize * profile.closeCallScale})`, opacity: .8 },
      { offset: .45, transform: `translate3d(${sign * 64}vw, 6vh, 0) scale(${ENCOUNTER_CONFIG.closeCallSize * profile.closeCallScale})`, opacity: .87 },
      { transform: `translate3d(${sign * 155}vw, -8vh, 0) scale(${ENCOUNTER_CONFIG.closeCallSize * .9 * profile.closeCallScale})`, opacity: .15 }
    ];
  }
  encounterView.element.style.filter = reduced ? "none" : `blur(${type === "FLY_BY" ? 3 : 1.5}px)`;
  encounterView.animation = encounterView.element.animate(frames, { duration, easing: "linear", fill: "both" });
  encounterView.endAt = now + duration;
}

for (const button of encounterView.buttons) {
  button.addEventListener("click", () => {
    if (!debugEnabled || runtime.appState !== "RUNNING" || !runtime.started || runtime.initialYaw === null || document.hidden) return;
    const now = performance.now();
    const type = button.dataset.testEncounter;
    if (director.force(type, now)) prepareEncounter(type, now, true);
  });
}

document.addEventListener("visibilitychange", () => {
  stalker.pause();
  stopPresence();
  previousFrameAt = performance.now();
  if (!document.hidden) return;
  runtime.lastOrientationAt = -Infinity;
  cleanupEncounterVisual();
  hideEntity();
  director.finish(performance.now());
  if (encounterPausedAt === null) encounterPausedAt = performance.now();
  if (runtime.appState === "RUNNING") setState(STATES.STALKING);
  encounterView.escapeStartedAt = null;
});

function updateGame(now, elapsedMs) {
  const progressActive = runtime.appState === "RUNNING" && runtime.started && runtime.initialYaw !== null
    && hasLiveCamera()
    && !document.hidden
    && now - runtime.lastOrientationAt <= CONFIG.orientationTimeout;
  const distanceActive = progressActive && runtime.motionPermission === "granted";
  stalker.update(elapsedMs, runtime.angleDiff, distanceActive);
  if (runtime.appState !== "RUNNING") return;
  director.setProfile(stalker.profile, now);
  updatePresence(now, distanceActive);
  if (!runtime.started || runtime.initialYaw === null || runtime.angleDiff === null) return;

  if (!progressActive) {
    if (encounterPausedAt === null) encounterPausedAt = now;
    hideEntity();
    cleanupEncounterVisual();
    director.finish(now);
    setState(STATES.STALKING);
    if (now - runtime.lastOrientationAt > CONFIG.orientationTimeout) {
      runtime.orientationPermission = "no-data";
    }
    return;
  }
  if (encounterPausedAt !== null) {
    if (director.deadline !== null) director.deadline += Math.max(0, now - encounterPausedAt);
    encounterPausedAt = null;
  }
  runtime.orientationPermission = "active";
  const selected = director.update(now);
  if (selected) prepareEncounter(selected, now);
  if (director.currentEncounter !== "PEEK") {
    if (director.state === "EVENT" && now >= encounterView.endAt) {
      cleanupEncounterVisual();
      relocateEntity();
    }
    return;
  }
  if (runtime.state === STATES.ESCAPE) {
    if (now - encounterView.escapeStartedAt >= CONFIG.escapeDuration + 70) relocateEntity();
    return;
  }
  if (director.state === "ARMING" && now - director.armedAt > ENCOUNTER_CONFIG.peekArmingTimeout) {
    relocateEntity();
    return;
  }
  if (director.state === "EVENT" && runtime.state === STATES.PERIPHERAL
      && now - director.eventStartedAt >= ENCOUNTER_CONFIG.peekMaxDuration) {
    beginEscape();
    return;
  }

  const absoluteDifference = Math.abs(runtime.angleDiff);

  if (runtime.state === STATES.HIDDEN && now >= runtime.stalkAvailableAt) {
    setState(STATES.STALKING);
  }

  if (runtime.state === STATES.STALKING) {
    hideEntity();
    if (now >= runtime.stalkAvailableAt && absoluteDifference <= CONFIG.peripheralEnterAngle) {
      enterPeripheral();
    }
    return;
  }

  if (runtime.state === STATES.PERIPHERAL) {
    if (Number.isFinite(runtime.previousAbsDiff) && elapsedMs > 0) {
      const instantApproach = (runtime.previousAbsDiff - absoluteDifference) * 1000 / elapsedMs;
      runtime.approachSpeed += (instantApproach - runtime.approachSpeed) * CONFIG.speedSmoothing;
    }
    runtime.previousAbsDiff = absoluteDifference;

    if (absoluteDifference > CONFIG.peripheralExitAngle) {
      hideEntity();
      relocateEntity();
      return;
    }

    renderPeripheral();

    const turnedQuickly = Math.abs(runtime.turnSpeed) >= CONFIG.fastTurnThreshold;
    const movingTowardEntity = runtime.approachSpeed >= CONFIG.minimumApproachSpeed;
    if (absoluteDifference <= CONFIG.spottedAngle && turnedQuickly && movingTowardEntity) {
      beginEscape(true);
    }
  }
}

function updateDebug(now) {
  updateSoundButton();
  if (!debugEnabled || now - runtime.debugUpdatedAt < CONFIG.debugRefreshInterval) return;
  runtime.debugUpdatedAt = now;
  elements.debugApp.textContent = `APP ${runtime.appState}\nCYCLE ${(stalker.cycleMs / 1000).toFixed(1)}s\nDANGER ${(stalker.dangerMs / 1000).toFixed(1)}s`;

  elements.debugCurrentYaw.textContent = readableAngle(runtime.currentYaw);
  elements.debugInitialYaw.textContent = readableAngle(runtime.initialYaw);
  elements.debugRelativeYaw.textContent = readableAngle(runtime.relativeYaw);
  elements.debugEntityYaw.textContent = readableAngle(runtime.entityYaw);
  elements.debugAngleDiff.textContent = readableAngle(runtime.angleDiff);
  elements.debugTurnSpeed.textContent = readableAngle(runtime.turnSpeed, "°/s");
  elements.debugState.textContent = runtime.state;
  elements.debugSide.textContent = runtime.detectedSide || "—";
  elements.debugCamera.textContent = runtime.cameraPermission;
  elements.debugOrientation.textContent = runtime.orientationPermission;
  elements.debugMotion.textContent = runtime.motionPermission;
  const profile = stalker.profile;
  elements.debugDistance.textContent = [
    `DISTANCE   ${stalker.distance.toFixed(1)}`,
    `RANGE      ${stalker.distanceState}`,
    `VISIBILITY ${stalker.paused ? "PAUSED" : stalker.looking ? "LOOKING" : "NOT_LOOKING"}`,
    `NOT LOOKING ${(stalker.notLookingMs / 1000).toFixed(1)}s`,
    `GRACE      ${stalker.inGrace ? "YES" : "NO"}`,
    `APPROACH   ${stalker.approachRate.toFixed(2)} / sec`,
    `NEXT THRESHOLD ${stalker.nextThreshold}`,
    `WEIGHTS P/P/F/C ${Object.values(profile.weights).join("/")}`,
    `DELAY ${(profile.minEncounterDelay / 1000).toFixed(1)}–${(profile.maxEncounterDelay / 1000).toFixed(1)}s`
  ].join("\n");
  const spatial = audio.lastSpatial;
  elements.debugPresence.textContent = [
    `AUDIO ENABLED ${audio.enabled}`,
    `CONTEXT ${audio.state}`,
    `PRESENCE ${presence.state}`,
    `CURRENT ${presence.currentPresence || "—"}`,
    `PREVIOUS ${presence.previousPresence || "—"}`,
    `DIRECTION ${spatial?.direction || "—"}`,
    `PAN ${spatial ? spatial.pan.toFixed(2) : "—"}`,
    `EFFECTIVE GAIN ${spatial ? spatial.effectiveVolume.toFixed(4) : "—"}`,
    `NEXT ${presence.state === "WAITING" ? Math.max(0, presence.deadline - now).toFixed(0) + " ms" : "—"}`,
    `BAIT ${Boolean(presence.bait)}`,
    `BAIT REMAIN ${presence.bait ? Math.max(0, presence.bait.expiresAt - now).toFixed(0) + " ms" : "—"}`,
    audio.error
  ].filter(Boolean).join("\n");
  const remaining = director.currentEncounter ? "waiting for view"
    : `${Math.max(0, (director.deadline ?? now) - now).toFixed(0)} ms`;
  encounterView.debug.textContent = [
    `DIRECTOR  ${director.state}`,
    `CURRENT   ${director.currentEncounter || "—"}`,
    `PREVIOUS  ${director.previousEncounter || "—"}`,
    `NEXT      ${remaining}`,
    `EVENT TIME ${director.eventStartedAt === null ? "—" : Math.max(0, now - director.eventStartedAt).toFixed(0) + " ms"}`,
    `PEEK LEVEL ${encounterView.peekLevel}`,
    `PASS      ${encounterView.passDirection}`,
    `FLY_BY    ${encounterView.flyByDirection}`,
    `CLOSE_CALL ${director.currentEncounter === "CLOSE_CALL" && director.state === "EVENT"}`
  ].join("\n");
  for (const button of encounterView.buttons) {
    button.disabled = runtime.appState !== "RUNNING" || !runtime.started || runtime.initialYaw === null || document.hidden
      || director.state === "EVENT" || Boolean(director.currentEncounter);
  }
  for (const button of document.querySelectorAll("[data-test-audio], [data-test-direction]")) {
    button.disabled = runtime.appState !== "RUNNING" || !runtime.started || runtime.initialYaw === null || !audio.enabled || !audio.Context
      || document.hidden || presence.state === "PLAYING" || strongEncounter();
  }
  for (const button of document.querySelectorAll("[data-set-distance]")) {
    button.disabled = runtime.appState === "STARTING";
  }

  const proximity = runtime.angleDiff === null
    ? 0
    : clamp(1 - Math.abs(runtime.angleDiff) / 180, 0, 1);
  elements.debugProximity.style.width = `${(proximity * 100).toFixed(1)}%`;
}

let previousFrameAt = performance.now();
function frame(now) {
  const elapsed = clamp(now - previousFrameAt, 1, 100);
  previousFrameAt = now;
  updateGame(now, elapsed);
  updateDebug(now);
  window.requestAnimationFrame(frame);
}

elements.startButton.addEventListener("click", startExperience);
elements.stopButton.addEventListener("click", stopExperience);
elements.retryButton.addEventListener("click", () => {
  hideMessage();
  if (runtime.started) stopExperience();
  startExperience();
});

window.addEventListener("pagehide", stopExperience);

function stopExperience() {
  startGeneration++;
  runtime.appState = "STOPPED";
  runtime.started = false;
  runtime.starting = false;
  window.removeEventListener("deviceorientation", handleOrientation, true);
  stalker.pause();
  window.clearTimeout(runtime.sensorTimeoutId);
  window.clearTimeout(runtime.escapeTimeoutId);
  cleanupEncounterVisual();
  hideEntity();
  director.reset();
  setState(STATES.HIDDEN);
  runtime.initialYaw = null;
  runtime.currentYaw = null;
  runtime.relativeYaw = null;
  runtime.angleDiff = null;
  runtime.lastOrientationAt = -Infinity;
  encounterView.escapeStartedAt = null;
  encounterView.peekLevel = 0;
  encounterPausedAt = null;
  elements.game.classList.remove("is-running");
  elements.startScreen.classList.remove("is-hidden");
  stopCamera();
  runtime.cameraPermission = "stopped";
  elements.stopButton.hidden = true;
  elements.startButton.disabled = false;
  hideMessage();
  setStartStatus("STARTで再開できます");
  runtime.debugUpdatedAt = -Infinity;
  updateDebug(performance.now());
}

function stopPresence() {
  audioSession++;
  audio.stop();
  presence.pause();
}

function strongEncounter() {
  return ["PASS", "FLY_BY", "CLOSE_CALL"].includes(director.currentEncounter);
}

function hasLiveCamera() {
  return runtime.cameraPermission === "granted" && Boolean(runtime.stream) && runtime.stream.active !== false
    && runtime.stream.getTracks().some(track => track.kind !== "audio" && track.readyState !== "ended" && !track.muted);
}

function updateSoundButton() {
  elements.soundToggle.textContent = !audio.Context ? "NO AUDIO"
    : !audio.enabled ? "SOUND OFF" : runtime.started && !audio.ready ? "SOUND RETRY" : "SOUND ON";
  elements.soundToggle.disabled = !audio.Context;
  elements.soundToggle.setAttribute("aria-pressed", String(audio.enabled && Boolean(audio.Context)));
}

function updatePresence(now, active) {
  const input = { active: active && runtime.appState === "RUNNING" && audio.ready, range: stalker.distanceState,
    looking: Math.abs(runtime.angleDiff) <= STALKER_CONFIG.lookingAngle,
    relativeYaw: runtime.relativeYaw, entityYaw: runtime.entityYaw, strongEncounter: strongEncounter() };
  const event = presence.update(now, input);
  if (!input.active) { audio.stop(); return; }
  if (event) {
    if (audio.play(event, runtime.relativeYaw, stalker.distance)) presence.played(event, now, input);
    else presence.wait(now, input.range);
  }
  if (audio.voice && presence.lastEvent) audio.spatial(presence.lastEvent, runtime.relativeYaw, stalker.distance);
  const canPeek = !director.currentEncounter && ["IDLE", "ARMING"].includes(director.state)
    && !(director.previousEncounter === "PEEK" && director.consecutive >= ENCOUNTER_CONFIG.consecutiveLimit);
  if (presence.consumeBait(now, { ...input, canPeek }) && director.force("PEEK", now)) {
    // entityYawを変更せず、聞こえた実際の存在方位でPEEKを開始する。
    prepareEncounter("PEEK", now);
  }
}

elements.soundToggle.addEventListener("click", async () => {
  if (!audio.Context) return;
  const retry = audio.enabled && runtime.started && !audio.ready;
  if (!retry) audio.setEnabled(!audio.enabled);
  stopPresence();
  if (audio.enabled && runtime.started && !document.hidden) await audio.unlock();
  updateSoundButton();
  runtime.debugUpdatedAt = -Infinity;
  updateDebug(performance.now());
});

async function testPresence(type, direction) {
  if (!debugEnabled || runtime.appState !== "RUNNING" || !runtime.started || runtime.initialYaw === null || !audio.enabled
    || document.hidden || strongEncounter() || presence.state === "PLAYING") return;
  const session = audioSession;
  await audio.unlock();
  if (session !== audioSession || !debugEnabled || runtime.appState !== "RUNNING" || !runtime.started || !audio.ready || document.hidden
    || strongEncounter() || presence.state === "PLAYING") return;
  const offsets = { LEFT: -90, RIGHT: 90, BEHIND: 180, FRONT: 0 };
  const event = { type, yaw: direction ? normalizeDegrees(runtime.relativeYaw + offsets[direction]) : runtime.entityYaw };
  if (audio.play(event, runtime.relativeYaw, stalker.distance)) {
    presence.played(event, performance.now(), { entityYaw: runtime.entityYaw, relativeYaw: runtime.relativeYaw }, !direction);
    runtime.debugUpdatedAt = -Infinity;
    updateDebug(performance.now());
  }
}
for (const button of document.querySelectorAll("[data-test-audio]")) {
  button.addEventListener("click", () => testPresence(button.dataset.testAudio));
}
for (const button of document.querySelectorAll("[data-test-direction]")) {
  button.addEventListener("click", () => testPresence("RUSTLE", button.dataset.testDirection));
}

function setDebugEnabled(enabled) {
  debugEnabled = enabled;
  document.body.classList.toggle("debug-enabled", enabled);
  elements.debugPanel.hidden = !enabled;
  elements.debugTests.hidden = !enabled;
  elements.debugGuides.hidden = !enabled;
  elements.debugPanel.setAttribute("aria-hidden", String(!enabled));
  elements.debugToggle.setAttribute("aria-pressed", String(enabled));
  elements.debugToggle.textContent = enabled ? "DEBUG ON" : "DEBUG";
  if (enabled) {
    runtime.debugUpdatedAt = -Infinity;
    updateDebug(performance.now());
  }
}

elements.debugToggle.addEventListener("click", () => setDebugEnabled(!debugEnabled));
for (const button of document.querySelectorAll("[data-set-distance]")) {
  button.addEventListener("click", () => {
    if (!debugEnabled || runtime.appState === "STARTING" || !stalker.setRange(button.dataset.setDistance)) return;
    director.setProfile(stalker.profile, performance.now());
    runtime.debugUpdatedAt = -Infinity;
    updateDebug(performance.now());
  });
}
setDebugEnabled(false);
window.requestAnimationFrame(frame);
