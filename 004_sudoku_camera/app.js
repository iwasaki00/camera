import { captureGuideArea, hasLiveCameraStream, startCamera, stopCamera } from "./camera.js";
import { drawCellCrop, drawOriginalCell, splitBoardIntoCells } from "./gridOcr.js";
import { recognizeSingleDigit, setOcrProgressListener } from "./ocr.js";
import { OCR_INPUT_SIZE, prepareOcrImages } from "./ocrImage.js";

const cameraSection = document.getElementById("cameraSection");
const resultSection = document.getElementById("resultSection");
const cameraStage = document.getElementById("cameraStage");
const cameraPreview = document.getElementById("cameraPreview");
const cameraGuide = document.getElementById("cameraGuide");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const cameraState = document.getElementById("cameraState");
const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const retakeButton = document.getElementById("retakeButton");
const croppedCanvas = document.getElementById("croppedCanvas");
const statusMessage = document.getElementById("statusMessage");
const innerCropRange = document.getElementById("innerCropRange");
const innerCropValue = document.getElementById("innerCropValue");
const listViewButton = document.getElementById("listViewButton");
const boardViewButton = document.getElementById("boardViewButton");
const cellViewHelp = document.getElementById("cellViewHelp");
const cellList = document.getElementById("cellList");
const boardGrid = document.getElementById("boardGrid");
const cellCountBadge = document.getElementById("cellCountBadge");
const cellModal = document.getElementById("cellModal");
const modalCellLabel = document.getElementById("modalCellLabel");
const modalOriginalCanvas = document.getElementById("modalOriginalCanvas");
const modalInnerCanvas = document.getElementById("modalInnerCanvas");
const modalCropInfo = document.getElementById("modalCropInfo");
const closeModalButton = document.getElementById("closeModalButton");
const preprocessOnButton = document.getElementById("preprocessOnButton");
const preprocessOffButton = document.getElementById("preprocessOffButton");
const preprocessDescription = document.getElementById("preprocessDescription");
const ocrScaledCanvas = document.getElementById("ocrScaledCanvas");
const ocrInputCanvas = document.getElementById("ocrInputCanvas");
const runSingleOcrButton = document.getElementById("runSingleOcrButton");
const ocrProgress = document.getElementById("ocrProgress");
const ocrRawResult = document.getElementById("ocrRawResult");
const ocrNormalizedResult = document.getElementById("ocrNormalizedResult");
const ocrConfidence = document.getElementById("ocrConfidence");
const ocrElapsedTime = document.getElementById("ocrElapsedTime");
const ocrHistory = document.getElementById("ocrHistory");
const historyCount = document.getElementById("historyCount");
const emptyHistoryMessage = document.getElementById("emptyHistoryMessage");

let cells = [];
let cellViews = [];
let selectedCellIndex = null;
let modalReturnTarget = null;
let preprocessEnabled = true;
let historyEntries = 0;

function setStatus(message) {
  statusMessage.textContent = message;
  console.log("[app] status", message);
}

function setCameraActive(active) {
  cameraPlaceholder.hidden = active;
  cameraState.textContent = active ? "起動中" : "未起動";
  cameraState.classList.toggle("active", active);
  startCameraButton.textContent = active ? "カメラを再起動" : "カメラ開始";
}

function getCellLabel(cell) {
  return `R${cell.row + 1}C${cell.col + 1}`;
}

function createCanvas(className, label) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.setAttribute("aria-label", label);
  return canvas;
}

function buildCellViews() {
  const fragment = document.createDocumentFragment();
  const boardFragment = document.createDocumentFragment();

  for (let index = 0; index < 81; index += 1) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const label = `R${row + 1}C${col + 1}`;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "cellCard";
    card.dataset.cellIndex = String(index);
    card.setAttribute("aria-label", `${label}を拡大表示`);

    const cardHeader = document.createElement("span");
    cardHeader.className = "cellCardHeader";
    const cardLabel = document.createElement("strong");
    cardLabel.textContent = label;
    const dimensions = document.createElement("span");
    dimensions.className = "cellDimensions";
    cardHeader.append(cardLabel, dimensions);

    const comparison = document.createElement("span");
    comparison.className = "cellComparison";
    const originalGroup = document.createElement("span");
    originalGroup.className = "cellImageGroup";
    const originalCaption = document.createElement("span");
    originalCaption.textContent = "元セル";
    const originalCanvas = createCanvas("cellCanvas", `${label} 元セル`);
    originalGroup.append(originalCaption, originalCanvas);

    const innerGroup = document.createElement("span");
    innerGroup.className = "cellImageGroup";
    const innerCaption = document.createElement("span");
    innerCaption.textContent = "OCR対象";
    const innerCanvas = createCanvas("cellCanvas", `${label} OCR対象セル`);
    innerGroup.append(innerCaption, innerCanvas);
    comparison.append(originalGroup, innerGroup);
    card.append(cardHeader, comparison);
    fragment.appendChild(card);

    const boardCell = document.createElement("button");
    boardCell.type = "button";
    boardCell.className = "boardCell";
    boardCell.dataset.cellIndex = String(index);
    boardCell.setAttribute("aria-label", `${label}を拡大表示`);
    const boardCanvas = createCanvas("boardCellCanvas", `${label} 元セル`);
    const boardLabel = document.createElement("span");
    boardLabel.textContent = label;
    boardCell.append(boardCanvas, boardLabel);
    boardFragment.appendChild(boardCell);

    cellViews.push({ originalCanvas, innerCanvas, boardCanvas, dimensions });
  }

  cellList.appendChild(fragment);
  boardGrid.appendChild(boardFragment);
}

function renderModalCell(index) {
  const cell = cells[index];
  if (!cell) return;

  modalCellLabel.textContent = getCellLabel(cell);
  drawOriginalCell(croppedCanvas, cell, modalOriginalCanvas);
  drawCellCrop(croppedCanvas, cell, modalInnerCanvas);
  modalCropInfo.textContent = `元セル ${cell.originalWidth}×${cell.originalHeight}px ／ OCR対象 ${cell.sourceWidth}×${cell.sourceHeight}px ／ 外周 ${innerCropRange.value}% 除外`;
  prepareSelectedCellOcrImages();
  resetOcrResult();
}

function prepareSelectedCellOcrImages() {
  prepareOcrImages(modalInnerCanvas, ocrScaledCanvas, ocrInputCanvas, preprocessEnabled);
  preprocessDescription.textContent = preprocessEnabled
    ? `A：外周除外 → B：${OCR_INPUT_SIZE}px拡大 → C：グレースケール・コントラスト調整・二値化`
    : `A：外周除外 → B：${OCR_INPUT_SIZE}px拡大 → C：前処理なし（Bと同じ画像）`;
}

function resetOcrResult() {
  ocrProgress.textContent = "OCRはまだ実行していません。";
  ocrRawResult.textContent = "未実行";
  ocrNormalizedResult.textContent = "未実行";
  ocrNormalizedResult.dataset.status = "idle";
  ocrConfidence.textContent = "-";
  ocrElapsedTime.textContent = "-";
}

function setPreprocessing(enabled) {
  preprocessEnabled = enabled;
  preprocessOnButton.classList.toggle("active", enabled);
  preprocessOffButton.classList.toggle("active", !enabled);
  preprocessOnButton.setAttribute("aria-pressed", String(enabled));
  preprocessOffButton.setAttribute("aria-pressed", String(!enabled));

  if (selectedCellIndex !== null) {
    prepareSelectedCellOcrImages();
    resetOcrResult();
  }
}

function formatConfidence(confidence) {
  return confidence === null ? "-" : confidence.toFixed(1);
}

function addOcrHistoryEntry(cellLabel, result, usedPreprocessing) {
  historyEntries += 1;
  const item = document.createElement("li");
  item.className = "ocrHistoryItem";

  const cell = document.createElement("strong");
  cell.textContent = cellLabel;
  const normalized = document.createElement("span");
  normalized.textContent = result.display;
  normalized.dataset.status = result.status;
  const confidence = document.createElement("span");
  confidence.textContent = `confidence ${formatConfidence(result.confidence)}`;
  const elapsed = document.createElement("span");
  elapsed.textContent = `${result.elapsedMs}ms`;
  const preprocessing = document.createElement("span");
  preprocessing.className = "historyPreprocess";
  preprocessing.textContent = usedPreprocessing ? "前処理あり" : "前処理なし";

  item.append(cell, normalized, confidence, elapsed, preprocessing);
  ocrHistory.prepend(item);
  historyCount.textContent = `${historyEntries}件`;
  emptyHistoryMessage.hidden = true;
}

function clearOcrHistory() {
  ocrHistory.replaceChildren();
  historyEntries = 0;
  historyCount.textContent = "0件";
  emptyHistoryMessage.hidden = false;
}

async function handleRunSingleOcr() {
  const cell = cells[selectedCellIndex];
  if (!cell) return;

  const cellIndex = selectedCellIndex;
  const cellLabel = getCellLabel(cell);
  const usedPreprocessing = preprocessEnabled;
  const ocrSnapshot = document.createElement("canvas");
  ocrSnapshot.width = ocrInputCanvas.width;
  ocrSnapshot.height = ocrInputCanvas.height;
  ocrSnapshot.getContext("2d").drawImage(ocrInputCanvas, 0, 0);
  runSingleOcrButton.disabled = true;
  preprocessOnButton.disabled = true;
  preprocessOffButton.disabled = true;
  ocrProgress.textContent = "Tesseract.jsを準備しています…";
  setOcrProgressListener((message) => {
    const percent = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
    ocrProgress.textContent = `${message.status || "OCR処理中"}${percent}`;
  });

  try {
    const result = await recognizeSingleDigit(ocrSnapshot);
    if (selectedCellIndex === cellIndex) {
      ocrRawResult.textContent = JSON.stringify(result.rawText);
      ocrNormalizedResult.textContent = result.display;
      ocrNormalizedResult.dataset.status = result.status;
      ocrConfidence.textContent = formatConfidence(result.confidence);
      ocrElapsedTime.textContent = `${result.elapsedMs}ms`;
      ocrProgress.textContent = "1セルOCRが完了しました。";
    }
    addOcrHistoryEntry(cellLabel, result, usedPreprocessing);
  } catch (error) {
    console.error("[ocr] single cell OCR failed", error);
    ocrProgress.textContent = error instanceof Error ? error.message : "OCRの実行に失敗しました。";
  } finally {
    setOcrProgressListener(null);
    runSingleOcrButton.disabled = false;
    preprocessOnButton.disabled = false;
    preprocessOffButton.disabled = false;
  }
}

function renderCellImages() {
  const cropRate = Number(innerCropRange.value) / 100;
  cells = splitBoardIntoCells(croppedCanvas, cropRate);
  innerCropValue.value = `${innerCropRange.value}%`;
  innerCropValue.textContent = `${innerCropRange.value}%`;
  cellCountBadge.textContent = `${cells.length}セル`;

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const view = cellViews[index];
    drawOriginalCell(croppedCanvas, cell, view.originalCanvas);
    drawCellCrop(croppedCanvas, cell, view.innerCanvas);
    drawOriginalCell(croppedCanvas, cell, view.boardCanvas);
    view.dimensions.textContent = `${cell.originalWidth}×${cell.originalHeight} → ${cell.sourceWidth}×${cell.sourceHeight}px`;
  }

  if (selectedCellIndex !== null && !cellModal.hidden) {
    renderModalCell(selectedCellIndex);
  }

  console.log("[cells] generated", {
    count: cells.length,
    boardWidth: croppedCanvas.width,
    boardHeight: croppedCanvas.height,
    cellWidth: croppedCanvas.width / 9,
    cellHeight: croppedCanvas.height / 9,
    cropRate,
    firstCell: cells[0],
    lastCell: cells[cells.length - 1]
  });
}

function setCellView(mode) {
  const showList = mode === "list";
  cellList.hidden = !showList;
  boardGrid.hidden = showList;
  listViewButton.classList.toggle("active", showList);
  boardViewButton.classList.toggle("active", !showList);
  listViewButton.setAttribute("aria-pressed", String(showList));
  boardViewButton.setAttribute("aria-pressed", String(!showList));
  cellViewHelp.textContent = showList
    ? "元セルとOCR対象セルを並べて表示しています。セルをタップすると拡大できます。"
    : "実際の盤面と同じ9×9配置です。セルをタップすると元セルとOCR対象セルを拡大できます。";
}

function openCellModal(index, returnTarget) {
  if (!cells[index]) return;
  selectedCellIndex = index;
  modalReturnTarget = returnTarget;
  renderModalCell(index);
  cellModal.hidden = false;
  closeModalButton.focus({ preventScroll: true });
}

function closeCellModal() {
  if (cellModal.hidden) return;
  cellModal.hidden = true;
  selectedCellIndex = null;
  if (modalReturnTarget instanceof HTMLElement) {
    modalReturnTarget.focus({ preventScroll: true });
  }
  modalReturnTarget = null;
}

function handleCellSelection(event) {
  const target = event.target.closest("[data-cell-index]");
  if (!target) return;
  openCellModal(Number(target.dataset.cellIndex), target);
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  captureButton.disabled = true;
  setStatus("カメラを起動しています…");

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setCameraActive(true);
    setStatus("盤面をガイドに合わせて「読み取り」を押してください。");
  } catch (error) {
    console.error("[app] start camera failed", error);
    setCameraActive(false);
    setStatus(error instanceof Error ? error.message : "カメラの起動に失敗しました。");
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    captureGuideArea(cameraPreview, cameraGuide, croppedCanvas, 900);
    clearOcrHistory();
    renderCellImages();
    cameraSection.hidden = true;
    resultSection.hidden = false;
    setStatus("切り出し結果を確認してください。ずれている場合は「再撮影」で戻れます。");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : "画像の切り出しに失敗しました。");
  }
}

function handleRetake() {
  closeCellModal();
  resultSection.hidden = true;
  cameraSection.hidden = false;

  const streamIsLive = hasLiveCameraStream(cameraPreview);
  setCameraActive(streamIsLive);
  captureButton.disabled = !streamIsLive;
  setStatus(
    streamIsLive
      ? "カメラは起動したままです。盤面を合わせ直して「読み取り」を押してください。"
      : "カメラが停止しています。「カメラ開始」を押してください。"
  );
  cameraStage.scrollIntoView({ behavior: "smooth", block: "center" });
}

buildCellViews();

startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
retakeButton.addEventListener("click", handleRetake);
innerCropRange.addEventListener("input", renderCellImages);
listViewButton.addEventListener("click", () => setCellView("list"));
boardViewButton.addEventListener("click", () => setCellView("board"));
cellList.addEventListener("click", handleCellSelection);
boardGrid.addEventListener("click", handleCellSelection);
closeModalButton.addEventListener("click", closeCellModal);
preprocessOnButton.addEventListener("click", () => setPreprocessing(true));
preprocessOffButton.addEventListener("click", () => setPreprocessing(false));
runSingleOcrButton.addEventListener("click", handleRunSingleOcr);
cellModal.addEventListener("click", (event) => {
  if (event.target === cellModal) closeCellModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCellModal();
});

window.addEventListener("pagehide", () => {
  stopCamera(cameraPreview);
});
