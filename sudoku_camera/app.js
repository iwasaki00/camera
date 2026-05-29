import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { preprocessToBinaryCanvas, removeGridLinesFromCanvas, runOcrFromCanvas } from "./ocr.js";

const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const cropButton = document.getElementById("cropButton");
const runOcrButton = document.getElementById("runOcrButton");
const cameraPreview = document.getElementById("cameraPreview");
const captureCanvas = document.getElementById("captureCanvas");
const cropOverlayCanvas = document.getElementById("cropOverlayCanvas");
const croppedCanvas = document.getElementById("croppedCanvas");
const processedCanvas = document.getElementById("processedCanvas");
const lineRemovedCanvas = document.getElementById("lineRemovedCanvas");
const verticalThresholdRange = document.getElementById("verticalThresholdRange");
const horizontalThresholdRange = document.getElementById("horizontalThresholdRange");
const eraseRadiusRange = document.getElementById("eraseRadiusRange");
const verticalThresholdValue = document.getElementById("verticalThresholdValue");
const horizontalThresholdValue = document.getElementById("horizontalThresholdValue");
const eraseRadiusValue = document.getElementById("eraseRadiusValue");
const statusMessage = document.getElementById("statusMessage");
const rawOcrResult = document.getElementById("rawOcrResult");
const digitsOnlyResult = document.getElementById("digitsOnlyResult");

const MIN_CROP_SIZE = 120;
const HANDLE_RADIUS = 28;
const EDGE_THRESHOLD = 26;

let hasCapturedImage = false;
let hasCroppedImage = false;
let cropRect = null;
let dragState = null;
let lastTouchTimestamp = 0;
let hasLineRemovedPreview = false;

function t(text) {
  return text;
}

function setStatus(message) {
  statusMessage.textContent = message;
  console.log("[app] status", message);
}

function setResultPlaceholders() {
  rawOcrResult.textContent = t("\u307e\u3060\u5b9f\u884c\u3057\u3066\u3044\u307e\u305b\u3093\u3002");
  digitsOnlyResult.textContent = t("\u307e\u3060\u5b9f\u884c\u3057\u3066\u3044\u307e\u305b\u3093\u3002");
}

function updateSliderLabels() {
  verticalThresholdValue.textContent = `${verticalThresholdRange.value}%`;
  horizontalThresholdValue.textContent = `${horizontalThresholdRange.value}%`;
  eraseRadiusValue.textContent = `${eraseRadiusRange.value}px`;
}

function getLineRemovalSettings() {
  return {
    verticalThreshold: Number(verticalThresholdRange.value) / 100,
    horizontalThreshold: Number(horizontalThresholdRange.value) / 100,
    eraseRadius: Number(eraseRadiusRange.value)
  };
}

function drawPlaceholder(canvas, title, subtitle) {
  const width = 720;
  const height = 960;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#efe4d5";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#7b6856";
  context.textAlign = "center";
  context.font = "bold 28px sans-serif";
  context.fillText(title, width / 2, height / 2 - 10);
  context.font = "20px sans-serif";
  context.fillText(subtitle, width / 2, height / 2 + 28);
}

function drawInitialPlaceholders() {
  drawPlaceholder(
    captureCanvas,
    t("\u64ae\u5f71\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u30ab\u30e1\u30e9\u958b\u59cb\u5f8c\u306b\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044")
  );
  drawPlaceholder(
    croppedCanvas,
    t("\u5207\u308a\u51fa\u3057\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u300c\u3053\u306e\u7bc4\u56f2\u3067OCR\u300d\u3092\u62bc\u3059\u3068\u751f\u6210\u3055\u308c\u307e\u3059")
  );
  drawPlaceholder(
    processedCanvas,
    t("OCR\u524d\u51e6\u7406\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("OCR\u5b9f\u884c\u6642\u306b\u767d\u9ed2\u5316\u3055\u308c\u307e\u3059")
  );
  drawPlaceholder(
    lineRemovedCanvas,
    t("\u7f6b\u7dda\u9664\u53bb\u30d7\u30ec\u30d3\u30e5\u30fc\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u5207\u308a\u51fa\u3057\u5f8c\u306b\u300c\u7f6b\u7dda\u9664\u53bb\u3057\u3066OCR\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044")
  );
  cropOverlayCanvas.width = captureCanvas.width;
  cropOverlayCanvas.height = captureCanvas.height;
  cropOverlayCanvas.style.pointerEvents = "none";
  cropOverlayCanvas.getContext("2d").clearRect(0, 0, cropOverlayCanvas.width, cropOverlayCanvas.height);
}

function getClientPoint(event) {
  if (event.touches && event.touches.length > 0) {
    return {
      clientX: event.touches[0].clientX,
      clientY: event.touches[0].clientY
    };
  }

  if (event.changedTouches && event.changedTouches.length > 0) {
    return {
      clientX: event.changedTouches[0].clientX,
      clientY: event.changedTouches[0].clientY
    };
  }

  return {
    clientX: event.clientX,
    clientY: event.clientY
  };
}

function getCanvasPoint(event, canvas) {
  const clientPoint = getClientPoint(event);
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientPoint.clientX - rect.left) * scaleX,
    y: (clientPoint.clientY - rect.top) * scaleY
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function initializeCropRect() {
  const insetX = captureCanvas.width * 0.12;
  const insetY = captureCanvas.height * 0.12;
  cropRect = {
    x: insetX,
    y: insetY,
    width: captureCanvas.width - insetX * 2,
    height: captureCanvas.height - insetY * 2
  };
}

function getHandlePositions() {
  if (!cropRect) {
    return [];
  }

  const { x, y, width, height } = cropRect;
  const right = x + width;
  const bottom = y + height;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return [
    { mode: "nw", x, y },
    { mode: "n", x: centerX, y },
    { mode: "ne", x: right, y },
    { mode: "e", x: right, y: centerY },
    { mode: "se", x: right, y: bottom },
    { mode: "s", x: centerX, y: bottom },
    { mode: "sw", x, y: bottom },
    { mode: "w", x, y: centerY }
  ];
}

function getDragMode(point) {
  if (!cropRect) {
    return null;
  }

  for (const handle of getHandlePositions()) {
    const dx = point.x - handle.x;
    const dy = point.y - handle.y;
    if (Math.hypot(dx, dy) <= HANDLE_RADIUS) {
      return handle.mode;
    }
  }

  const left = cropRect.x;
  const right = cropRect.x + cropRect.width;
  const top = cropRect.y;
  const bottom = cropRect.y + cropRect.height;
  const insideX = point.x >= left && point.x <= right;
  const insideY = point.y >= top && point.y <= bottom;

  if (insideX && Math.abs(point.y - top) <= EDGE_THRESHOLD) {
    return "n";
  }
  if (insideX && Math.abs(point.y - bottom) <= EDGE_THRESHOLD) {
    return "s";
  }
  if (insideY && Math.abs(point.x - left) <= EDGE_THRESHOLD) {
    return "w";
  }
  if (insideY && Math.abs(point.x - right) <= EDGE_THRESHOLD) {
    return "e";
  }
  if (insideX && insideY) {
    return "move";
  }

  return null;
}

function drawCropOverlay() {
  const context = cropOverlayCanvas.getContext("2d");
  context.clearRect(0, 0, cropOverlayCanvas.width, cropOverlayCanvas.height);

  if (!cropRect) {
    return;
  }

  const { x, y, width, height } = cropRect;
  context.fillStyle = "rgba(17, 12, 8, 0.48)";
  context.fillRect(0, 0, cropOverlayCanvas.width, cropOverlayCanvas.height);
  context.clearRect(x, y, width, height);

  context.save();
  context.strokeStyle = "#fff7ef";
  context.lineWidth = 4;
  context.strokeRect(x, y, width, height);

  context.setLineDash([12, 10]);
  context.strokeStyle = "rgba(255, 247, 239, 0.85)";
  context.lineWidth = 2;
  context.strokeRect(x + 10, y + 10, Math.max(0, width - 20), Math.max(0, height - 20));
  context.restore();

  for (const handle of getHandlePositions()) {
    context.beginPath();
    context.fillStyle = "#b85c38";
    context.strokeStyle = "#fff8f2";
    context.lineWidth = 3;
    context.arc(handle.x, handle.y, 12, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  console.log("[app] crop overlay drawn", cropRect);
}

function resetCropOutputs() {
  hasCroppedImage = false;
  hasLineRemovedPreview = false;
  runOcrButton.disabled = true;
  drawPlaceholder(
    croppedCanvas,
    t("\u5207\u308a\u51fa\u3057\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u30c8\u30ea\u30df\u30f3\u30b0\u7bc4\u56f2\u3092\u78ba\u5b9a\u3059\u308b\u3068\u66f4\u65b0\u3055\u308c\u307e\u3059")
  );
  drawPlaceholder(
    processedCanvas,
    t("OCR\u524d\u51e6\u7406\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("OCR\u5b9f\u884c\u6642\u306b\u5207\u308a\u51fa\u3057\u753b\u50cf\u304b\u3089\u751f\u6210\u3055\u308c\u307e\u3059")
  );
  drawPlaceholder(
    lineRemovedCanvas,
    t("\u7f6b\u7dda\u9664\u53bb\u30d7\u30ec\u30d3\u30e5\u30fc\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u7f6b\u7dda\u9664\u53bb\u5f8c\u306eOCR\u5bfe\u8c61\u753b\u50cf\u304c\u3053\u3053\u306b\u51fa\u307e\u3059")
  );
  setResultPlaceholders();
}

function applyCrop() {
  if (!cropRect || !hasCapturedImage) {
    setStatus(t("\u5148\u306b\u64ae\u5f71\u3057\u3066\u30c8\u30ea\u30df\u30f3\u30b0\u7bc4\u56f2\u3092\u8868\u793a\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
    return;
  }

  const sourceX = Math.round(cropRect.x);
  const sourceY = Math.round(cropRect.y);
  const sourceWidth = Math.round(cropRect.width);
  const sourceHeight = Math.round(cropRect.height);

  croppedCanvas.width = sourceWidth;
  croppedCanvas.height = sourceHeight;

  const context = croppedCanvas.getContext("2d");
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(
    captureCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  console.log("[app] crop applied", { sourceX, sourceY, sourceWidth, sourceHeight });
  hasCroppedImage = true;
  hasLineRemovedPreview = false;
  runOcrButton.disabled = false;
  drawPlaceholder(
    processedCanvas,
    t("OCR\u524d\u51e6\u7406\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("OCR\u5b9f\u884c\u6642\u306b\u5207\u308a\u51fa\u3057\u753b\u50cf\u304b\u3089\u751f\u6210\u3055\u308c\u307e\u3059")
  );
  drawPlaceholder(
    lineRemovedCanvas,
    t("\u7f6b\u7dda\u9664\u53bb\u30d7\u30ec\u30d3\u30e5\u30fc\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u30b9\u30e9\u30a4\u30c0\u30fc\u8a2d\u5b9a\u5f8c\u306b\u300c\u7f6b\u7dda\u9664\u53bb\u3057\u3066OCR\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044")
  );
  setResultPlaceholders();
  setStatus(t("\u30c8\u30ea\u30df\u30f3\u30b0\u7bc4\u56f2\u3092\u78ba\u5b9a\u3057\u307e\u3057\u305f\u3002\u7f6b\u7dda\u9664\u53bb\u8a2d\u5b9a\u3092\u78ba\u8a8d\u3057\u3066\u304b\u3089OCR\u3092\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
}

function invalidateLineRemovalPreview() {
  if (!hasCroppedImage) {
    return;
  }

  hasLineRemovedPreview = false;
  setResultPlaceholders();
  drawPlaceholder(
    lineRemovedCanvas,
    t("\u7f6b\u7dda\u9664\u53bb\u30d7\u30ec\u30d3\u30e5\u30fc\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u30b9\u30e9\u30a4\u30c0\u30fc\u5024\u304c\u5909\u308f\u3063\u305f\u306e\u3067\u518d\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044")
  );
}

function buildLineRemovalPreview() {
  if (!hasCroppedImage) {
    throw new Error("\u5148\u306b\u5207\u308a\u51fa\u3057\u753b\u50cf\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
  }

  const settings = getLineRemovalSettings();
  preprocessToBinaryCanvas(croppedCanvas, processedCanvas);
  removeGridLinesFromCanvas(croppedCanvas, lineRemovedCanvas, settings);
  hasLineRemovedPreview = true;
  console.log("[app] line removal preview ready", settings);
}

function updateCropRect(mode, point) {
  if (!dragState || !cropRect) {
    return;
  }

  const maxWidth = captureCanvas.width;
  const maxHeight = captureCanvas.height;
  const start = dragState.startRect;
  const dx = point.x - dragState.startPoint.x;
  const dy = point.y - dragState.startPoint.y;

  let nextX = start.x;
  let nextY = start.y;
  let nextWidth = start.width;
  let nextHeight = start.height;

  if (mode === "move") {
    nextX = clamp(start.x + dx, 0, maxWidth - start.width);
    nextY = clamp(start.y + dy, 0, maxHeight - start.height);
  }

  if (mode.includes("e")) {
    nextWidth = clamp(start.width + dx, MIN_CROP_SIZE, maxWidth - start.x);
  }
  if (mode.includes("s")) {
    nextHeight = clamp(start.height + dy, MIN_CROP_SIZE, maxHeight - start.y);
  }
  if (mode.includes("w")) {
    const nextLeft = clamp(start.x + dx, 0, start.x + start.width - MIN_CROP_SIZE);
    nextWidth = start.width + (start.x - nextLeft);
    nextX = nextLeft;
  }
  if (mode.includes("n")) {
    const nextTop = clamp(start.y + dy, 0, start.y + start.height - MIN_CROP_SIZE);
    nextHeight = start.height + (start.y - nextTop);
    nextY = nextTop;
  }

  cropRect = {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  };

  drawCropOverlay();
}

function handleOverlayPointerDown(event) {
  if (!cropRect) {
    return;
  }

  if (event.type === "mousedown" && Date.now() - lastTouchTimestamp < 700) {
    return;
  }
  if (event.type === "touchstart") {
    lastTouchTimestamp = Date.now();
  }

  event.preventDefault();
  const point = getCanvasPoint(event, cropOverlayCanvas);
  const mode = getDragMode(point);
  if (!mode) {
    console.log("[app] no drag mode hit", point);
    return;
  }

  dragState = {
    mode,
    startPoint: point,
    startRect: { ...cropRect }
  };
  console.log("[app] crop drag start", dragState);
}

function handleOverlayPointerMove(event) {
  if (!dragState) {
    return;
  }

  if (event.type === "mousemove" && Date.now() - lastTouchTimestamp < 700) {
    return;
  }
  if (event.type === "touchmove") {
    lastTouchTimestamp = Date.now();
  }

  event.preventDefault();
  const point = getCanvasPoint(event, cropOverlayCanvas);
  updateCropRect(dragState.mode, point);
}

function finishOverlayDrag(event) {
  if (!dragState) {
    return;
  }

  if (event.type === "mouseup" && Date.now() - lastTouchTimestamp < 700) {
    return;
  }
  if (event.type === "touchend") {
    lastTouchTimestamp = Date.now();
  }

  event.preventDefault();
  console.log("[app] crop drag end", cropRect);
  dragState = null;
  resetCropOutputs();
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  setStatus(t("\u30ab\u30e1\u30e9\u3092\u8d77\u52d5\u3057\u3066\u3044\u307e\u3059..."));

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setStatus(t("\u30ab\u30e1\u30e9\u3092\u8d77\u52d5\u3057\u307e\u3057\u305f\u3002\u30ca\u30f3\u30d7\u30ec\u554f\u984c\u3092\u6620\u3057\u3066\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  } catch (error) {
    console.error("[app] failed to start camera", error);
    setStatus(error instanceof Error ? error.message : t("\u30ab\u30e1\u30e9\u306e\u8d77\u52d5\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    const imageDataUrl = captureFrame(cameraPreview, captureCanvas);
    cropOverlayCanvas.width = captureCanvas.width;
    cropOverlayCanvas.height = captureCanvas.height;
    cropOverlayCanvas.style.pointerEvents = "auto";
    hasCapturedImage = true;
    cropButton.disabled = false;
    initializeCropRect();
    drawCropOverlay();
    resetCropOutputs();
    console.log("[app] captured image data url length", imageDataUrl.length);
    setStatus(t("\u64ae\u5f71\u3057\u307e\u3057\u305f\u3002\u67a0\u3092\u52d5\u304b\u3057\u3066OCR\u5bfe\u8c61\u7bc4\u56f2\u3092\u8abf\u6574\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : t("\u64ae\u5f71\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  }
}

async function handleRunOcr() {
  if (!hasCroppedImage) {
    setStatus(t("\u5148\u306b\u300c\u3053\u306e\u7bc4\u56f2\u3067OCR\u300d\u3092\u62bc\u3057\u3066\u5207\u308a\u51fa\u3057\u753b\u50cf\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
    return;
  }

  runOcrButton.disabled = true;
  setStatus(t("\u7f6b\u7dda\u9664\u53bb\u3068OCR\u3092\u5b9f\u884c\u3057\u3066\u3044\u307e\u3059\u3002"));

  try {
    buildLineRemovalPreview();
    const { rawText, digitsOnly } = await runOcrFromCanvas(lineRemovedCanvas);
    rawOcrResult.textContent = rawText.trim() || t("\uff08\u8a8d\u8b58\u6587\u5b57\u306a\u3057\uff09");
    digitsOnlyResult.textContent = digitsOnly || t("\uff08\u6570\u5b57\u62bd\u51fa\u306a\u3057\uff09");
    setStatus(t("\u7f6b\u7dda\u9664\u53bb\u5f8c\u306e\u753b\u50cf\u3067OCR\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u7d50\u679c\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  } catch (error) {
    console.error("[app] OCR failed", error);
    rawOcrResult.textContent = t("\uff08OCR\u5931\u6557\uff09");
    digitsOnlyResult.textContent = t("\uff08OCR\u5931\u6557\uff09");
    setStatus(error instanceof Error ? error.message : t("OCR\u306e\u5b9f\u884c\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  } finally {
    runOcrButton.disabled = false;
  }
}

drawInitialPlaceholders();
setResultPlaceholders();
updateSliderLabels();

startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
cropButton.addEventListener("click", applyCrop);
runOcrButton.addEventListener("click", handleRunOcr);
verticalThresholdRange.addEventListener("input", () => {
  updateSliderLabels();
  invalidateLineRemovalPreview();
});
horizontalThresholdRange.addEventListener("input", () => {
  updateSliderLabels();
  invalidateLineRemovalPreview();
});
eraseRadiusRange.addEventListener("input", () => {
  updateSliderLabels();
  invalidateLineRemovalPreview();
});
cropOverlayCanvas.addEventListener("pointerdown", handleOverlayPointerDown);
cropOverlayCanvas.addEventListener("pointermove", handleOverlayPointerMove);
cropOverlayCanvas.addEventListener("pointerup", finishOverlayDrag);
cropOverlayCanvas.addEventListener("pointercancel", finishOverlayDrag);
cropOverlayCanvas.addEventListener("touchstart", handleOverlayPointerDown, { passive: false });
cropOverlayCanvas.addEventListener("touchmove", handleOverlayPointerMove, { passive: false });
cropOverlayCanvas.addEventListener("touchend", finishOverlayDrag, { passive: false });
cropOverlayCanvas.addEventListener("mousedown", handleOverlayPointerDown);
window.addEventListener("mousemove", handleOverlayPointerMove);
window.addEventListener("mouseup", finishOverlayDrag);
window.addEventListener("touchmove", handleOverlayPointerMove, { passive: false });
window.addEventListener("touchend", finishOverlayDrag, { passive: false });
window.addEventListener("touchcancel", finishOverlayDrag, { passive: false });

window.addEventListener("beforeunload", () => {
  stopCamera(cameraPreview);
});
