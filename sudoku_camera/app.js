import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { recognizeSingleDigit } from "./ocr.js";
import { createEmptyBoard, drawCellCrop, extractSquareBoard, splitBoardIntoCells } from "./gridOcr.js";
import { solveSudoku } from "./sudokuSolver.js";

const GRID_SIZE = 9;
const MIN_CROP_SIZE = 120;
const HANDLE_RADIUS = 28;
const EDGE_THRESHOLD = 26;

const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const cropButton = document.getElementById("cropButton");
const runOcrButton = document.getElementById("runOcrButton");
const solveButton = document.getElementById("solveButton");
const clearButton = document.getElementById("clearButton");
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
  const width = 720;
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
    "撮影画像がここに表示されます",
    "カメラ開始後に撮影してください"
  );
  drawPlaceholder(
    croppedCanvas,
    "切り出し画像がここに表示されます",
    "この範囲を確定すると更新されます",
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
    "切り出し画像がここに表示されます",
    "この範囲を確定すると更新されます",
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

function readBoardFromInputs() {
  return resultInputs.map((row) =>
    row.map((input) => {
      const value = Number(input.value);
      return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 0;
    })
  );
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

  const point = getCanvasPoint(event, cropOverlayCanvas);
  const mode = getDragMode(point);
  if (!mode) {
    return;
  }

  event.preventDefault();
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
  setStatus("カメラを起動しています...");

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setStatus("カメラを起動しました。撮影できます。");
  } catch (error) {
    console.error("[app] start camera failed", error);
    setStatus(error instanceof Error ? error.message : "カメラの起動に失敗しました。");
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
    setStatus("撮影しました。枠を調整して「この範囲を確定」を押してください。");
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : "撮影に失敗しました。");
  }
}

function handleApplyCrop() {
  if (!hasCapturedImage || !cropRect) {
    setStatus("先に撮影してください。");
    return;
  }

  extractSquareBoard(captureCanvas, croppedCanvas, cropRect);
  hasCroppedBoard = true;
  runOcrButton.disabled = false;
  resetResultGrid();
  resetDebugGrid();
  setStatus("切り出しを確定しました。次は「9×9分割OCR実行」を押してください。");
}

async function handleRunGridOcr() {
  if (!hasCroppedBoard) {
    setStatus("先に「この範囲を確定」を押してください。");
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
      setStatus(`${index + 1} / 81 マス処理中`);

      const { digit } = await recognizeSingleDigit(debugItem.canvas);
      const normalized = digit || "";
      board[cell.row][cell.col] = normalized;
      debugItem.value.textContent = normalized || "0";
      resultInputs[cell.row][cell.col].value = normalized;
    }

    writeBoardToInputs(board);
    setStatus("OCRが完了しました。必要なら数値を手修正してから「解く」を押してください。");
  } catch (error) {
    console.error("[app] grid OCR failed", error);
    setStatus(error instanceof Error ? error.message : "OCRの実行に失敗しました。");
  } finally {
    runOcrButton.disabled = false;
  }
}

function handleSolve() {
  const board = readBoardFromInputs();
  const solvedBoard = solveSudoku(board);

  if (!solvedBoard) {
    setStatus("この盤面は解けません。入力値を見直してください。");
    return;
  }

  writeBoardToInputs(solvedBoard.map((row) => row.map((value) => (value === 0 ? "" : String(value)))));
  setStatus("盤面を解きました。");
}

function handleClear() {
  hasCapturedImage = false;
  hasCroppedBoard = false;
  cropRect = null;
  dragState = null;
  captureButton.disabled = true;
  cropButton.disabled = true;
  runOcrButton.disabled = true;
  drawInitialPlaceholders();
  setStatus("クリアしました。もう一度カメラ開始から試してください。");
}

buildResultGrid();
buildDebugGrid();
drawInitialPlaceholders();
updateInnerCropLabel();

startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
cropButton.addEventListener("click", handleApplyCrop);
runOcrButton.addEventListener("click", handleRunGridOcr);
solveButton.addEventListener("click", handleSolve);
clearButton.addEventListener("click", handleClear);
innerCropRange.addEventListener("input", () => {
  updateInnerCropLabel();
  if (hasCroppedBoard) {
    resetResultGrid();
    resetDebugGrid();
    setStatus("外周カット率を変更しました。再度「9×9分割OCR実行」を押してください。");
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

window.addEventListener("beforeunload", () => {
  stopCamera(cameraPreview);
});
