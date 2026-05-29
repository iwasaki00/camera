import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { recognizeSingleDigit } from "./ocr.js";
import { createEmptyBoard, drawCellCrop, extractSquareBoard, splitBoardIntoCells } from "./gridOcr.js";

const GRID_SIZE = 9;
const MIN_CROP_SIZE = 120;
const HANDLE_RADIUS = 28;
const EDGE_THRESHOLD = 26;

const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const cropButton = document.getElementById("cropButton");
const runOcrButton = document.getElementById("runOcrButton");
const cameraPreview = document.getElementById("cameraPreview");
const captureCanvas = document.getElementById("captureCanvas");
const cropOverlayCanvas = document.getElementById("cropOverlayCanvas");
const croppedCanvas = document.getElementById("croppedCanvas");
const innerCropRange = document.getElementById("innerCropRange");
const innerCropValue = document.getElementById("innerCropValue");
const statusMessage = document.getElementById("statusMessage");
const resultGrid = document.getElementById("resultGrid");
const debugGrid = document.getElementById("debugGrid");

let hasCapturedImage = false;
let hasCroppedBoard = false;
let cropRect = null;
let dragState = null;
let lastTouchTimestamp = 0;
let resultInputs = [];
let debugCanvases = [];

function t(text) {
  return text;
}

function setStatus(message) {
  statusMessage.textContent = message;
  console.log("[app] status", message);
}

function updateInnerCropLabel() {
  innerCropValue.textContent = `${innerCropRange.value}%`;
}

function sanitizeCellValue(value) {
  return value.replace(/[^1-9]/g, "").slice(0, 1);
}

function buildResultGrid() {
  const inputs = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowInputs = [];
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = 1;
      input.autocomplete = "off";
      input.className = "cellInput";
      input.setAttribute("aria-label", `${row + 1} ${col + 1}`);
      if ((col + 1) % 3 === 0 && col !== GRID_SIZE - 1) {
        input.classList.add("boxRight");
      }
      if ((row + 1) % 3 === 0 && row !== GRID_SIZE - 1) {
        input.classList.add("boxBottom");
      }
      input.addEventListener("input", () => {
        input.value = sanitizeCellValue(input.value);
      });
      resultGrid.appendChild(input);
      rowInputs.push(input);
    }
    inputs.push(rowInputs);
  }

  resultInputs = inputs;
}

function buildDebugGrid() {
  const canvases = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const card = document.createElement("div");
      card.className = "debugCard";

      const header = document.createElement("div");
      header.className = "debugCardHeader";

      const label = document.createElement("span");
      label.textContent = `R${row + 1} C${col + 1}`;

      const value = document.createElement("span");
      value.className = "debugValue";
      value.textContent = "-";

      const canvas = document.createElement("canvas");
      canvas.className = "debugCanvas";
      canvas.width = 64;
      canvas.height = 64;

      header.append(label, value);
      card.append(header, canvas);
      debugGrid.appendChild(card);

      canvases.push({
        row,
        col,
        canvas,
        value
      });
    }
  }

  debugCanvases = canvases;
}

function drawPlaceholder(canvas, title, subtitle, square = false) {
  const width = square ? 720 : 720;
  const height = square ? 720 : 960;
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

function resetResultGrid() {
  for (const row of resultInputs) {
    for (const input of row) {
      input.value = "";
    }
  }
}

function resetDebugGrid() {
  for (const item of debugCanvases) {
    item.canvas.width = 64;
    item.canvas.height = 64;
    const context = item.canvas.getContext("2d");
    context.fillStyle = "#f4ede4";
    context.fillRect(0, 0, item.canvas.width, item.canvas.height);
    item.value.textContent = "-";
  }
}

function drawInitialPlaceholders() {
  drawPlaceholder(
    captureCanvas,
    t("\u64ae\u5f71\u753b\u50cf\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059"),
    t("\u30ab\u30e1\u30e9\u958b\u59cb\u5f8c\u306b\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044")
  );
  drawPlaceholder(
    croppedCanvas,
    t("\u78ba\u5b9a\u5f8c\u306e\u6b63\u65b9\u5f62\u76e4\u9762\u304c\u3053\u3053\u306b\u51fa\u307e\u3059"),
    t("\u300c\u3053\u306e\u7bc4\u56f2\u3092\u78ba\u5b9a\u300d\u3092\u62bc\u3059\u3068\u66f4\u65b0\u3055\u308c\u307e\u3059"),
    true
  );
  cropOverlayCanvas.width = captureCanvas.width;
  cropOverlayCanvas.height = captureCanvas.height;
  cropOverlayCanvas.style.pointerEvents = "none";
  cropOverlayCanvas.getContext("2d").clearRect(0, 0, cropOverlayCanvas.width, cropOverlayCanvas.height);
  resetResultGrid();
  resetDebugGrid();
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
}

function resetOutputsAfterCropEdit() {
  hasCroppedBoard = false;
  runOcrButton.disabled = true;
  drawPlaceholder(
    croppedCanvas,
    t("\u78ba\u5b9a\u5f8c\u306e\u6b63\u65b9\u5f62\u76e4\u9762\u304c\u3053\u3053\u306b\u51fa\u307e\u3059"),
    t("\u7bc4\u56f2\u3092\u78ba\u5b9a\u3059\u308b\u3068\u66f4\u65b0\u3055\u308c\u307e\u3059"),
    true
  );
  resetResultGrid();
  resetDebugGrid();
}

function writeBoardToInputs(board) {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      resultInputs[row][col].value = board[row][col];
    }
  }
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
    return;
  }

  dragState = {
    mode,
    startPoint: point,
    startRect: { ...cropRect }
  };
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
  dragState = null;
  resetOutputsAfterCropEdit();
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
    captureFrame(cameraPreview, captureCanvas);
    cropOverlayCanvas.width = captureCanvas.width;
    cropOverlayCanvas.height = captureCanvas.height;
    cropOverlayCanvas.style.pointerEvents = "auto";
    hasCapturedImage = true;
    cropButton.disabled = false;
    initializeCropRect();
    drawCropOverlay();
    resetOutputsAfterCropEdit();
    setStatus(t("\u64ae\u5f71\u3057\u307e\u3057\u305f\u3002\u67a0\u3092\u8abf\u6574\u3057\u3066\u300c\u3053\u306e\u7bc4\u56f2\u3092\u78ba\u5b9a\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : t("\u64ae\u5f71\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  }
}

function handleApplyCrop() {
  if (!hasCapturedImage || !cropRect) {
    setStatus(t("\u5148\u306b\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
    return;
  }

  extractSquareBoard(captureCanvas, croppedCanvas, cropRect);
  hasCroppedBoard = true;
  runOcrButton.disabled = false;
  resetResultGrid();
  resetDebugGrid();
  setStatus(t("\u6b63\u65b9\u5f62\u76e4\u9762\u3092\u78ba\u5b9a\u3057\u307e\u3057\u305f\u3002\u6b21\u306f\u5916\u5468\u30ab\u30c3\u30c8\u7387\u3092\u78ba\u8a8d\u3057\u3001\u300c9\u00d79\u5206\u5272OCR\u5b9f\u884c\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
}

async function handleRunGridOcr() {
  if (!hasCroppedBoard) {
    setStatus(t("\u5148\u306b\u300c\u3053\u306e\u7bc4\u56f2\u3092\u78ba\u5b9a\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
    return;
  }

  runOcrButton.disabled = true;
  const board = createEmptyBoard();
  const cells = splitBoardIntoCells(croppedCanvas, Number(innerCropRange.value) / 100);

  try {
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const debugItem = debugCanvases[index];
      drawCellCrop(croppedCanvas, cell, debugItem.canvas);
      setStatus(`${index + 1} / 81 \u30de\u30b9\u51e6\u7406\u4e2d`);

      const { digit } = await recognizeSingleDigit(debugItem.canvas);
      const normalized = digit || "";
      board[cell.row][cell.col] = normalized;
      debugItem.value.textContent = normalized || "0";
      resultInputs[cell.row][cell.col].value = normalized;
    }

    writeBoardToInputs(board);
    setStatus(t("81\u30de\u30b9\u306eOCR\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u7d50\u679c\u30929\u00d79\u5165\u529b\u6b04\u3067\u624b\u4fee\u6b63\u3067\u304d\u307e\u3059\u3002"));
  } catch (error) {
    console.error("[app] grid OCR failed", error);
    setStatus(error instanceof Error ? error.message : t("OCR\u306e\u5b9f\u884c\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  } finally {
    runOcrButton.disabled = false;
  }
}

buildResultGrid();
buildDebugGrid();
drawInitialPlaceholders();
updateInnerCropLabel();

startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
cropButton.addEventListener("click", handleApplyCrop);
runOcrButton.addEventListener("click", handleRunGridOcr);
innerCropRange.addEventListener("input", () => {
  updateInnerCropLabel();
  if (hasCroppedBoard) {
    resetResultGrid();
    resetDebugGrid();
    setStatus(t("\u5916\u5468\u30ab\u30c3\u30c8\u7387\u3092\u5909\u66f4\u3057\u307e\u3057\u305f\u3002\u518d\u5ea6\u300c9\u00d79\u5206\u5272OCR\u5b9f\u884c\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  }
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
