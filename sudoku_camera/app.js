import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { recognizeSingleDigit } from "./ocr.js";
import { createEmptyBoard, drawBoardGridOverlay, drawCellCrop, splitBoardIntoCells } from "./gridOcr.js";

const GRID_SIZE = 9;
const BOARD_SIZE = 900;
const HANDLE_RADIUS = 34;

const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const correctBoardButton = document.getElementById("correctBoardButton");
const runOcrButton = document.getElementById("runOcrButton");
const cameraPreview = document.getElementById("cameraPreview");
const captureCanvas = document.getElementById("captureCanvas");
const cornerOverlayCanvas = document.getElementById("cornerOverlayCanvas");
const correctedCanvas = document.getElementById("correctedCanvas");
const gridOverlayCanvas = document.getElementById("gridOverlayCanvas");
const innerCropRange = document.getElementById("innerCropRange");
const innerCropValue = document.getElementById("innerCropValue");
const statusMessage = document.getElementById("statusMessage");
const resultGrid = document.getElementById("resultGrid");
const debugGrid = document.getElementById("debugGrid");

let cvReadyPromise = null;
let hasCapturedImage = false;
let hasCorrectedBoard = false;
let cornerPoints = [];
let activeCornerIndex = -1;
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

function waitForOpenCv() {
  if (window.cv && typeof window.cv.getPerspectiveTransform === "function") {
    return Promise.resolve(window.cv);
  }

  if (!cvReadyPromise) {
    cvReadyPromise = new Promise((resolve, reject) => {
      const startedAt = Date.now();

      const poll = () => {
        if (window.cv && typeof window.cv.getPerspectiveTransform === "function") {
          console.log("[opencv] ready");
          resolve(window.cv);
          return;
        }

        if (Date.now() - startedAt > 15000) {
          reject(new Error("OpenCV.js \u306e\u8aad\u307f\u8fbc\u307f\u304c\u5b8c\u4e86\u3057\u307e\u305b\u3093\u3002"));
          return;
        }

        window.setTimeout(poll, 120);
      };

      poll();
    });
  }

  return cvReadyPromise;
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
  const width = square ? BOARD_SIZE : 720;
  const height = square ? BOARD_SIZE : 960;
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
    correctedCanvas,
    t("\u56db\u9685\u88dc\u6b63\u5f8c\u306e\u76e4\u9762\u304c\u3053\u3053\u306b\u51fa\u307e\u3059"),
    t("\u300c\u56db\u9685\u88dc\u6b63\u300d\u3092\u62bc\u3059\u3068\u66f4\u65b0\u3055\u308c\u307e\u3059"),
    true
  );
  cornerOverlayCanvas.width = captureCanvas.width;
  cornerOverlayCanvas.height = captureCanvas.height;
  cornerOverlayCanvas.style.pointerEvents = "none";
  cornerOverlayCanvas.getContext("2d").clearRect(0, 0, cornerOverlayCanvas.width, cornerOverlayCanvas.height);
  gridOverlayCanvas.width = BOARD_SIZE;
  gridOverlayCanvas.height = BOARD_SIZE;
  gridOverlayCanvas.style.pointerEvents = "none";
  gridOverlayCanvas.getContext("2d").clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
  resetResultGrid();
  resetDebugGrid();
}

function createDefaultCornerPoints() {
  const insetX = captureCanvas.width * 0.18;
  const insetY = captureCanvas.height * 0.18;
  const width = captureCanvas.width - insetX * 2;
  const height = captureCanvas.height - insetY * 2;

  return [
    { x: insetX, y: insetY, label: "LT" },
    { x: insetX + width, y: insetY, label: "RT" },
    { x: insetX + width, y: insetY + height, label: "RB" },
    { x: insetX, y: insetY + height, label: "LB" }
  ];
}

function drawCornerOverlay() {
  const context = cornerOverlayCanvas.getContext("2d");
  context.clearRect(0, 0, cornerOverlayCanvas.width, cornerOverlayCanvas.height);

  if (!cornerPoints.length) {
    return;
  }

  context.fillStyle = "rgba(17, 12, 8, 0.42)";
  context.fillRect(0, 0, cornerOverlayCanvas.width, cornerOverlayCanvas.height);

  context.save();
  context.beginPath();
  context.moveTo(cornerPoints[0].x, cornerPoints[0].y);
  for (let index = 1; index < cornerPoints.length; index += 1) {
    context.lineTo(cornerPoints[index].x, cornerPoints[index].y);
  }
  context.closePath();
  context.clip();
  context.clearRect(0, 0, cornerOverlayCanvas.width, cornerOverlayCanvas.height);
  context.restore();

  context.beginPath();
  context.moveTo(cornerPoints[0].x, cornerPoints[0].y);
  for (let index = 1; index < cornerPoints.length; index += 1) {
    context.lineTo(cornerPoints[index].x, cornerPoints[index].y);
  }
  context.closePath();
  context.strokeStyle = "#fff7ef";
  context.lineWidth = 4;
  context.stroke();

  for (let index = 0; index < cornerPoints.length; index += 1) {
    const point = cornerPoints[index];
    context.beginPath();
    context.fillStyle = index === activeCornerIndex ? "#f79f62" : "#b85c38";
    context.strokeStyle = "#fff8f2";
    context.lineWidth = 4;
    context.arc(point.x, point.y, 18, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = "#fff8f2";
    context.font = "bold 16px sans-serif";
    context.textAlign = "center";
    context.fillText(point.label, point.x, point.y + 5);
  }
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

function pickCornerIndex(point) {
  for (let index = 0; index < cornerPoints.length; index += 1) {
    const corner = cornerPoints[index];
    if (Math.hypot(point.x - corner.x, point.y - corner.y) <= HANDLE_RADIUS) {
      return index;
    }
  }
  return -1;
}

function resetOutputsAfterCornerEdit() {
  hasCorrectedBoard = false;
  runOcrButton.disabled = true;
  drawPlaceholder(
    correctedCanvas,
    t("\u56db\u9685\u88dc\u6b63\u5f8c\u306e\u76e4\u9762\u304c\u3053\u3053\u306b\u51fa\u307e\u3059"),
    t("\u518d\u5ea6\u300c\u56db\u9685\u88dc\u6b63\u300d\u3092\u62bc\u3059\u3068\u66f4\u65b0\u3055\u308c\u307e\u3059"),
    true
  );
  gridOverlayCanvas.getContext("2d").clearRect(0, 0, gridOverlayCanvas.width, gridOverlayCanvas.height);
  resetResultGrid();
  resetDebugGrid();
}

function handleCornerPointerDown(event) {
  if (!cornerPoints.length) {
    return;
  }

  if (event.type === "mousedown" && Date.now() - lastTouchTimestamp < 700) {
    return;
  }
  if (event.type === "touchstart") {
    lastTouchTimestamp = Date.now();
  }

  event.preventDefault();
  const point = getCanvasPoint(event, cornerOverlayCanvas);
  const pickedIndex = pickCornerIndex(point);
  if (pickedIndex === -1) {
    return;
  }

  activeCornerIndex = pickedIndex;
  drawCornerOverlay();
}

function handleCornerPointerMove(event) {
  if (activeCornerIndex === -1 || !cornerPoints.length) {
    return;
  }

  if (event.type === "mousemove" && Date.now() - lastTouchTimestamp < 700) {
    return;
  }
  if (event.type === "touchmove") {
    lastTouchTimestamp = Date.now();
  }

  event.preventDefault();
  const point = getCanvasPoint(event, cornerOverlayCanvas);
  cornerPoints[activeCornerIndex] = {
    ...cornerPoints[activeCornerIndex],
    x: clamp(point.x, 0, cornerOverlayCanvas.width),
    y: clamp(point.y, 0, cornerOverlayCanvas.height)
  };
  drawCornerOverlay();
}

function finishCornerDrag(event) {
  if (activeCornerIndex === -1) {
    return;
  }

  if (event.type === "mouseup" && Date.now() - lastTouchTimestamp < 700) {
    return;
  }
  if (event.type === "touchend") {
    lastTouchTimestamp = Date.now();
  }

  event.preventDefault();
  activeCornerIndex = -1;
  drawCornerOverlay();
  resetOutputsAfterCornerEdit();
}

function writeBoardToInputs(board) {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      resultInputs[row][col].value = board[row][col];
    }
  }
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  setStatus(t("\u30ab\u30e1\u30e9\u3092\u8d77\u52d5\u3057\u3066\u3044\u307e\u3059..."));

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setStatus(t("\u30ab\u30e1\u30e9\u3092\u8d77\u52d5\u3057\u307e\u3057\u305f\u3002\u64ae\u5f71\u306f\u3059\u3050\u306b\u3067\u304d\u307e\u3059\u3002OpenCV.js \u306f\u80cc\u666f\u3067\u8aad\u307f\u8fbc\u307f\u307e\u3059\u3002"));
    waitForOpenCv()
      .then(() => {
        setStatus(t("\u30ab\u30e1\u30e9\u3068 OpenCV.js \u306e\u6e96\u5099\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u30ca\u30f3\u30d7\u30ec\u554f\u984c\u3092\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
      })
      .catch((error) => {
        console.error("[app] opencv background load failed", error);
        setStatus(error instanceof Error ? error.message : t("OpenCV.js \u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
      });
  } catch (error) {
    console.error("[app] failed to initialize camera/opencv", error);
    setStatus(error instanceof Error ? error.message : t("\u521d\u671f\u5316\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    captureFrame(cameraPreview, captureCanvas);
    cornerOverlayCanvas.width = captureCanvas.width;
    cornerOverlayCanvas.height = captureCanvas.height;
    cornerOverlayCanvas.style.pointerEvents = "auto";
    hasCapturedImage = true;
    correctBoardButton.disabled = false;
    cornerPoints = createDefaultCornerPoints();
    activeCornerIndex = -1;
    drawCornerOverlay();
    resetOutputsAfterCornerEdit();
    setStatus(t("\u64ae\u5f71\u3057\u307e\u3057\u305f\u30024\u3064\u306e\u70b9\u3092\u76e4\u9762\u306e\u56db\u9685\u306b\u5408\u308f\u305b\u3066\u300c\u56db\u9685\u88dc\u6b63\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : t("\u64ae\u5f71\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  }
}

async function handleCorrectBoard() {
  if (!hasCapturedImage || cornerPoints.length !== 4) {
    setStatus(t("\u5148\u306b\u64ae\u5f71\u3057\u3066\u56db\u9685\u3092\u8868\u793a\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
    return;
  }

  correctBoardButton.disabled = true;
  setStatus(t("\u56db\u9685\u88dc\u6b63\u3092\u5b9f\u884c\u3057\u3066\u3044\u307e\u3059..."));

  let src = null;
  let dst = null;
  let srcTri = null;
  let dstTri = null;
  let transform = null;
  let sourceMat = null;

  try {
    const cv = await waitForOpenCv();
    sourceMat = cv.imread(captureCanvas);
    src = new cv.Mat(4, 1, cv.CV_32FC2);
    dst = new cv.Mat(BOARD_SIZE, BOARD_SIZE, cv.CV_8UC4);

    src.data32F.set([
      cornerPoints[0].x, cornerPoints[0].y,
      cornerPoints[1].x, cornerPoints[1].y,
      cornerPoints[2].x, cornerPoints[2].y,
      cornerPoints[3].x, cornerPoints[3].y
    ]);

    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      BOARD_SIZE - 1, 0,
      BOARD_SIZE - 1, BOARD_SIZE - 1,
      0, BOARD_SIZE - 1
    ]);

    transform = cv.getPerspectiveTransform(src, dstTri);
    cv.warpPerspective(
      sourceMat,
      dst,
      transform,
      new cv.Size(BOARD_SIZE, BOARD_SIZE),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar()
    );

    cv.imshow(correctedCanvas, dst);
    gridOverlayCanvas.width = BOARD_SIZE;
    gridOverlayCanvas.height = BOARD_SIZE;
    drawBoardGridOverlay(gridOverlayCanvas);
    hasCorrectedBoard = true;
    runOcrButton.disabled = false;
    resetResultGrid();
    resetDebugGrid();
    setStatus(t("\u56db\u9685\u88dc\u6b63\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u5916\u5468\u30ab\u30c3\u30c8\u7387\u3092\u78ba\u8a8d\u3057\u3066\u300c9\u00d79\u5206\u5272OCR\u5b9f\u884c\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  } catch (error) {
    console.error("[app] perspective correction failed", error);
    setStatus(error instanceof Error ? error.message : t("\u56db\u9685\u88dc\u6b63\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002"));
  } finally {
    correctBoardButton.disabled = false;
    if (src) {
      src.delete();
    }
    if (dst) {
      dst.delete();
    }
    if (srcTri) {
      srcTri.delete();
    }
    if (dstTri) {
      dstTri.delete();
    }
    if (transform) {
      transform.delete();
    }
    if (sourceMat) {
      sourceMat.delete();
    }
  }
}

async function handleRunGridOcr() {
  if (!hasCorrectedBoard) {
    setStatus(t("\u5148\u306b\u300c\u56db\u9685\u88dc\u6b63\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
    return;
  }

  runOcrButton.disabled = true;
  const board = createEmptyBoard();
  const cells = splitBoardIntoCells(correctedCanvas, Number(innerCropRange.value) / 100);

  try {
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const debugItem = debugCanvases[index];
      drawCellCrop(correctedCanvas, cell, debugItem.canvas);
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
correctBoardButton.addEventListener("click", handleCorrectBoard);
runOcrButton.addEventListener("click", handleRunGridOcr);
innerCropRange.addEventListener("input", () => {
  updateInnerCropLabel();
  if (hasCorrectedBoard) {
    resetResultGrid();
    resetDebugGrid();
    setStatus(t("\u5916\u5468\u30ab\u30c3\u30c8\u7387\u3092\u5909\u66f4\u3057\u307e\u3057\u305f\u3002\u518d\u5ea6\u300c9\u00d79\u5206\u5272OCR\u5b9f\u884c\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002"));
  }
});
cornerOverlayCanvas.addEventListener("pointerdown", handleCornerPointerDown);
cornerOverlayCanvas.addEventListener("pointermove", handleCornerPointerMove);
cornerOverlayCanvas.addEventListener("pointerup", finishCornerDrag);
cornerOverlayCanvas.addEventListener("pointercancel", finishCornerDrag);
cornerOverlayCanvas.addEventListener("touchstart", handleCornerPointerDown, { passive: false });
cornerOverlayCanvas.addEventListener("touchmove", handleCornerPointerMove, { passive: false });
cornerOverlayCanvas.addEventListener("touchend", finishCornerDrag, { passive: false });
cornerOverlayCanvas.addEventListener("mousedown", handleCornerPointerDown);
window.addEventListener("mousemove", handleCornerPointerMove);
window.addEventListener("mouseup", finishCornerDrag);

window.addEventListener("beforeunload", () => {
  stopCamera(cameraPreview);
});
