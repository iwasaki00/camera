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

const VERSION = "0.1.0 — SOMETHING BEHIND YOU";

// 実機で体感を調整する値は、このオブジェクトだけに集約する。
const CONFIG = Object.freeze({
  peripheralZonePercent: 18,
  peripheralEnterAngle: 46,
  peripheralExitAngle: 58,
  spottedAngle: 15,
  fastTurnThreshold: 46,
  minimumApproachSpeed: 14,
  escapeDuration: 180,
  minStalkDelay: 2200,
  maxStalkDelay: 5200,
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

const debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";
document.body.classList.toggle("debug-enabled", debugEnabled);
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
  playHud: document.querySelector("#playHud"),
  playHint: document.querySelector("#playHint"),
  message: document.querySelector("#message"),
  messageTitle: document.querySelector("#messageTitle"),
  messageBody: document.querySelector("#messageBody"),
  retryButton: document.querySelector("#retryButton"),
  debugPanel: document.querySelector("#debugPanel"),
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
  debugProximity: document.querySelector("#debugProximity")
};

if (Object.values(elements).some((element) => !element)) {
  throw new Error("SOMETHING BEHIND YOU: required DOM element is missing.");
}

const runtime = {
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

function randomStalkDelay() {
  return CONFIG.minStalkDelay
    + Math.random() * (CONFIG.maxStalkDelay - CONFIG.minStalkDelay);
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
    runtime.stalkAvailableAt = now + randomStalkDelay();
    runtime.orientationPermission = "active";
    window.clearTimeout(runtime.sensorTimeoutId);
    elements.playHint.textContent = "ゆっくり周囲を見回してください";
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

async function startCamera() {
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

    runtime.stream = stream;
    elements.camera.srcObject = stream;
    await elements.camera.play();
    runtime.cameraPermission = "granted";
    return { ok: true };
  } catch (error) {
    runtime.cameraPermission = error?.name === "NotAllowedError" ? "denied" : "failed";
    return { ok: false, message: cameraFailureMessage(error) };
  }
}

function stopCamera() {
  runtime.stream?.getTracks().forEach((track) => track.stop());
  runtime.stream = null;
  elements.camera.srcObject = null;
}

function beginSensorTimeout() {
  window.clearTimeout(runtime.sensorTimeoutId);
  runtime.sensorTimeoutId = window.setTimeout(() => {
    if (!runtime.started || runtime.initialYaw !== null) return;
    runtime.orientationPermission = "no-data";
    elements.playHint.textContent = "方向センサーを取得できません";
    showMessage(
      "方向センサーを取得できません",
      "Safariの「モーションと画面の向きのアクセス」を有効にして、ページを再読み込みしてください。"
    );
  }, CONFIG.orientationTimeout);
}

async function startExperience() {
  if (runtime.starting) return;

  runtime.starting = true;
  elements.startButton.disabled = true;
  hideMessage();
  setStartStatus("使用許可を確認しています…");

  // requestPermissionはタップの同期処理内で呼び出す必要があるため、先に全て開始する。
  const orientationRequest = requestOrientationPermission();
  const motionRequest = requestMotionPermission();
  const cameraRequest = startCamera();

  const [orientationStatus, , cameraResult] = await Promise.all([
    orientationRequest,
    motionRequest,
    cameraRequest
  ]);

  if (!cameraResult.ok) {
    stopCamera();
    setStartStatus(cameraResult.message, true);
    elements.startButton.disabled = false;
    runtime.starting = false;
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
    return;
  }

  runtime.started = true;
  runtime.starting = false;
  runtime.initialYaw = null;
  runtime.relativeYaw = null;
  runtime.entityYaw = null;
  runtime.angleDiff = null;
  runtime.turnSpeed = 0;
  setState(STATES.HIDDEN);

  elements.game.classList.add("is-running");
  elements.startScreen.classList.add("is-hidden");
  elements.playHud.setAttribute("aria-hidden", "false");
  elements.startButton.disabled = false;
  elements.playHint.textContent = "方向を測定しています…";
  beginSensorTimeout();
}

function enterPeripheral() {
  runtime.detectedSide = sideFromDifference(runtime.angleDiff, runtime.detectedSide || "RIGHT");
  runtime.previousAbsDiff = Math.abs(runtime.angleDiff);
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
  const translate = direction * (94 - reveal * 28);
  const rotation = direction * (2.8 - reveal * 1.6);
  const scale = 0.97 + reveal * 0.06;

  elements.entity.dataset.side = side;
  elements.entity.classList.add("is-visible");
  elements.entity.style.opacity = String(0.43 + reveal * 0.42);
  elements.entity.style.transform = `translate3d(${translate}%, -50%, 0) rotate(${rotation}deg) scale(${scale})`;
}

function hideEntity() {
  elements.entity.classList.remove("is-visible", "is-escaping");
  elements.entity.style.opacity = "0";
}

function beginEscape() {
  if (runtime.state !== STATES.PERIPHERAL) return;

  setState(STATES.SPOTTED);
  const side = runtime.detectedSide || "RIGHT";
  const direction = side === "RIGHT" ? 1 : -1;

  window.requestAnimationFrame(() => {
    setState(STATES.ESCAPE);
    elements.entity.classList.add("is-escaping");
    elements.entity.style.opacity = "0.08";
    elements.entity.style.transform = `translate3d(${direction * 175}%, -52%, 0) rotate(${direction * 11}deg) scale(.82)`;

    window.clearTimeout(runtime.escapeTimeoutId);
    runtime.escapeTimeoutId = window.setTimeout(relocateEntity, CONFIG.escapeDuration + 70);
  });
}

function relocateEntity() {
  setState(STATES.RELOCATE);
  hideEntity();

  const current = Number.isFinite(runtime.relativeYaw) ? runtime.relativeYaw : 0;
  runtime.entityYaw = chooseRelocatedYaw(current, CONFIG.relocateMinimumAngle);
  runtime.angleDiff = signedAngleDifference(runtime.entityYaw, current);
  runtime.detectedSide = null;
  runtime.stalkAvailableAt = performance.now() + randomStalkDelay();

  window.requestAnimationFrame(() => setState(STATES.STALKING));
}

function updateGame(now, elapsedMs) {
  if (!runtime.started || runtime.initialYaw === null || runtime.angleDiff === null) return;

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
      runtime.stalkAvailableAt = now + 450;
      setState(STATES.STALKING);
      return;
    }

    renderPeripheral();

    const turnedQuickly = Math.abs(runtime.turnSpeed) >= CONFIG.fastTurnThreshold;
    const movingTowardEntity = runtime.approachSpeed >= CONFIG.minimumApproachSpeed;
    if (absoluteDifference <= CONFIG.spottedAngle && turnedQuickly && movingTowardEntity) {
      beginEscape();
    }
  }
}

function updateDebug(now) {
  if (!debugEnabled || now - runtime.debugUpdatedAt < CONFIG.debugRefreshInterval) return;
  runtime.debugUpdatedAt = now;

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

window.addEventListener("deviceorientation", handleOrientation, true);
elements.startButton.addEventListener("click", startExperience);
elements.retryButton.addEventListener("click", () => {
  hideMessage();
  if (runtime.started && runtime.initialYaw === null) {
    runtime.started = false;
    elements.game.classList.remove("is-running");
    elements.startScreen.classList.remove("is-hidden");
    stopCamera();
  }
  startExperience();
});

window.addEventListener("pagehide", () => {
  window.clearTimeout(runtime.sensorTimeoutId);
  window.clearTimeout(runtime.escapeTimeoutId);
  stopCamera();
});

if (debugEnabled) {
  elements.debugPanel.setAttribute("aria-hidden", "false");
  console.info(`Version ${VERSION}`, CONFIG);
}

window.requestAnimationFrame(frame);
