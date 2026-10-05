import { captureGuideArea, hasLiveCameraStream, startCamera, stopCamera } from "./camera.js";
import { drawCellCrop, drawOriginalCell, splitBoardIntoCells } from "./gridOcr.js";
import { recognizeSingleDigit, setOcrPageSegmentationMode, setOcrProgressListener } from "./ocr.js";
import { isClearlyBlankCell, OCR_INPUT_SIZE, prepareBenchmarkOcrImages, prepareFinalOcrImages, prepareOcrImages } from "./ocrImage.js?v=0.5.2";
import { createDefaultAlignment, renderAlignedSquare, updateAlignment } from "./alignment.js";
import { isSupportedImageFile, loadImageBlobIntoCanvas } from "./imageInput.js";
import { runFinalCandidate, runOcrTuning, tuningConfigLabel } from "./tuning.js?v=0.5.2";
import { validateSudokuGrid } from "./validation.mjs";
import { getSolveGate, solvePuzzle } from "./solverIntegration.mjs";
import {
  BENCHMARK_METHODS,
  buildBenchmarkReport,
  evaluateBenchmarkMethod,
  formatAccuracy,
  selectBestBenchmarkMethod
} from "./benchmark.js";

const cameraSection = document.getElementById("cameraSection");
const resultSection = document.getElementById("resultSection");
const cameraStage = document.getElementById("cameraStage");
const cameraPreview = document.getElementById("cameraPreview");
const cameraGuide = document.getElementById("cameraGuide");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const cameraTapHint = document.getElementById("cameraTapHint");
const cameraState = document.getElementById("cameraState");
const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const retakeButton = document.getElementById("retakeButton");
const croppedCanvas = document.getElementById("croppedCanvas");
const statusMessage = document.getElementById("statusMessage");
const testImageInput = document.getElementById("testImageInput");
const loadSampleButton = document.getElementById("loadSampleButton");
const loadSample02Button = document.getElementById("loadSample02Button");
const testImageDropZone = document.getElementById("testImageDropZone");
const testImageInfo = document.getElementById("testImageInfo");
const inputSourceValue = document.getElementById("inputSourceValue");
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
const resetAlignmentButton = document.getElementById("resetAlignmentButton");
const alignmentButtons = Array.from(document.querySelectorAll("[data-align-action]"));
const alignmentXValue = document.getElementById("alignmentXValue");
const alignmentYValue = document.getElementById("alignmentYValue");
const alignmentZoomValue = document.getElementById("alignmentZoomValue");
const alignmentRotationValue = document.getElementById("alignmentRotationValue");
const fullPreprocessOnButton = document.getElementById("fullPreprocessOnButton");
const fullPreprocessOffButton = document.getElementById("fullPreprocessOffButton");
const runFullOcrButton = document.getElementById("runFullOcrButton");
const fullOcrStateBadge = document.getElementById("fullOcrStateBadge");
const fullOcrProgressText = document.getElementById("fullOcrProgressText");
const fullOcrPercent = document.getElementById("fullOcrPercent");
const fullOcrProgressBar = document.getElementById("fullOcrProgressBar");
const fullOcrCurrentCell = document.getElementById("fullOcrCurrentCell");
const fullOcrNotice = document.getElementById("fullOcrNotice");
const ocrConditionSummary = document.getElementById("ocrConditionSummary");
const validationSummary = document.getElementById("validationSummary");
const ocrResultBoard = document.getElementById("ocrResultBoard");
const solveButton = document.getElementById("solveButton");
const solverMessage = document.getElementById("solverMessage");
const solutionSection = document.getElementById("solutionSection");
const solutionBoard = document.getElementById("solutionBoard");
const solveTime = document.getElementById("solveTime");
const backToPuzzleButton = document.getElementById("backToPuzzleButton");
const solveConfirmModal = document.getElementById("solveConfirmModal");
const solveConfirmMessage = document.getElementById("solveConfirmMessage");
const confirmSolveButton = document.getElementById("confirmSolveButton");
const reviewPuzzleButton = document.getElementById("reviewPuzzleButton");
const miniKeypad = document.getElementById("miniKeypad");
const miniKeypadLabel = document.getElementById("miniKeypadLabel");
const miniKeypadCurrent = document.getElementById("miniKeypadCurrent");
const miniKeypadIssues = document.getElementById("miniKeypadIssues");
const closeMiniKeypadButton = document.getElementById("closeMiniKeypadButton");
const miniKeypadValueButtons = Array.from(document.querySelectorAll("[data-keypad-value]"));
const benchmarkStateBadge = document.getElementById("benchmarkStateBadge");
const copyOcrToTruthButton = document.getElementById("copyOcrToTruthButton");
const runBenchmarkButton = document.getElementById("runBenchmarkButton");
const benchmarkTruthBoard = document.getElementById("benchmarkTruthBoard");
const benchmarkCurrentMethod = document.getElementById("benchmarkCurrentMethod");
const benchmarkPercent = document.getElementById("benchmarkPercent");
const benchmarkMethodProgress = document.getElementById("benchmarkMethodProgress");
const benchmarkProgressBar = document.getElementById("benchmarkProgressBar");
const benchmarkTotalProgress = document.getElementById("benchmarkTotalProgress");
const benchmarkMessage = document.getElementById("benchmarkMessage");
const benchmarkConditions = document.getElementById("benchmarkConditions");
const benchmarkResultsSection = document.getElementById("benchmarkResults");
const copyBenchmarkButton = document.getElementById("copyBenchmarkButton");
const benchmarkSummaryBody = document.getElementById("benchmarkSummaryBody");
const benchmarkComparisonBoard = document.getElementById("benchmarkComparisonBoard");
const benchmarkErrorLists = document.getElementById("benchmarkErrorLists");
const benchmarkModal = document.getElementById("benchmarkModal");
const benchmarkModalLabel = document.getElementById("benchmarkModalLabel");
const closeBenchmarkModalButton = document.getElementById("closeBenchmarkModalButton");
const benchmarkCellResults = document.getElementById("benchmarkCellResults");
const benchmarkMethodSwitcher = document.getElementById("benchmarkMethodSwitcher");
const benchmarkOriginalCanvas = document.getElementById("benchmarkOriginalCanvas");
const benchmarkInnerCanvas = document.getElementById("benchmarkInnerCanvas");
const benchmarkScaledCanvas = document.getElementById("benchmarkScaledCanvas");
const benchmarkInputCanvas = document.getElementById("benchmarkInputCanvas");
const benchmarkImageDescription = document.getElementById("benchmarkImageDescription");
const tuningStateBadge = document.getElementById("tuningStateBadge");
const runTuningButton = document.getElementById("runTuningButton");
const runFinalCandidateButton = document.getElementById("runFinalCandidateButton");
const tuningProgressText = document.getElementById("tuningProgressText");
const tuningProgressBar = document.getElementById("tuningProgressBar");
const tuningResultsSection = document.getElementById("tuningResults");
const tuningBest = document.getElementById("tuningBest");
const tuningSummaryBody = document.getElementById("tuningSummaryBody");
const tuningAnalysis = document.getElementById("tuningAnalysis");

const capturedSourceCanvas = document.createElement("canvas");
const batchCellCanvas = document.createElement("canvas");
const batchScaledCanvas = document.createElement("canvas");
const batchInputCanvas = document.createElement("canvas");
const benchmarkCellCanvas = document.createElement("canvas");
const benchmarkWorkScaledCanvas = document.createElement("canvas");
const benchmarkWorkInputCanvas = document.createElement("canvas");

let cells = [];
let cellViews = [];
let selectedCellIndex = null;
let modalReturnTarget = null;
let preprocessEnabled = true;
let historyEntries = 0;
let alignment = createDefaultAlignment();
let alignmentRevision = 0;
let fullOcrRevision = null;
let fullOcrResults = Array.from({ length: 81 }, () => null);
let ocrResultInputs = [];
let ocrResultCells = [];
let keypadCellIndex = null;
let keypadAnchor = null;
let originalPuzzle = null;
let solvedGrid = null;
let isFullOcrRunning = false;
let isCaptureInProgress = false;
let isBenchmarkRunning = false;
let isImageLoading = false;
let isTuningRunning = false;
let benchmarkTruth = Array.from({ length: 81 }, () => 0);
let benchmarkTruthInputs = [];
let benchmarkResults = {};
let benchmarkConditionsSnapshot = null;
let benchmarkSelectedCell = null;
let benchmarkSelectedMethod = "current";

function setStatus(message) {
  statusMessage.textContent = message;
  console.log("[app] status", message);
}

function setCameraActive(active) {
  cameraPlaceholder.hidden = active;
  cameraState.textContent = active ? "起動中" : "未起動";
  cameraState.classList.toggle("active", active);
  startCameraButton.textContent = active ? "カメラを再起動" : "カメラ開始";
  const captureReady = active && !isCaptureInProgress;
  captureButton.disabled = !captureReady;
  cameraTapHint.hidden = !captureReady;
  cameraStage.setAttribute("aria-disabled", String(!captureReady));
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

function sanitizeOcrInput(value) {
  return String(value || "").replace(/[^1-9]/g, "").slice(0, 1);
}

function buildOcrResultBoard() {
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < 81; index += 1) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const label = `R${row + 1}C${col + 1}`;
    const cell = document.createElement("div");
    cell.className = "ocrResultCell";
    cell.dataset.cellIndex = String(index);

    const input = document.createElement("button");
    input.type = "button";
    input.className = "resultValueButton";
    input.dataset.cellIndex = String(index);
    input.setAttribute("aria-label", `${label} OCR結果を修正`);

    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "resultDetailButton";
    detailButton.textContent = "詳細";
    detailButton.dataset.cellIndex = String(index);
    detailButton.setAttribute("aria-label", `${label}のOCR詳細を表示`);

    cell.append(input, detailButton);
    fragment.appendChild(cell);
    ocrResultInputs.push(input);
    ocrResultCells.push(cell);
  }

  ocrResultBoard.appendChild(fragment);
}

function positionMiniKeypad() {
  if (miniKeypad.hidden || !(keypadAnchor instanceof HTMLElement)) return;

  const viewportPadding = 8;
  const anchorRect = keypadAnchor.getBoundingClientRect();
  const keypadRect = miniKeypad.getBoundingClientRect();
  const gap = 8;
  let left = anchorRect.left + (anchorRect.width - keypadRect.width) / 2;
  let top = anchorRect.bottom + gap;

  if (top + keypadRect.height > window.innerHeight - viewportPadding) {
    top = anchorRect.top - keypadRect.height - gap;
  }

  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - keypadRect.width - viewportPadding));
  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - keypadRect.height - viewportPadding));
  miniKeypad.style.left = `${Math.round(left)}px`;
  miniKeypad.style.top = `${Math.round(top)}px`;
  miniKeypad.style.visibility = "visible";
}

function refreshMiniKeypad() {
  if (keypadCellIndex === null) return;
  const metadata = fullOcrResults[keypadCellIndex];
  const value = metadata?.value || 0;
  miniKeypadLabel.textContent = `R${Math.floor(keypadCellIndex / 9) + 1}C${keypadCellIndex % 9 + 1}`;
  miniKeypadCurrent.textContent = `現在：${value || "空欄"}`;
  const issueLabels = (metadata?.validationIssues || []).map(validationIssueLabel);
  miniKeypadIssues.textContent = issueLabels.length > 0 ? `要確認：${issueLabels.join(" / ")}` : "";
  miniKeypadIssues.hidden = issueLabels.length === 0;
  for (const button of miniKeypadValueButtons) {
    const buttonValue = Number(button.dataset.keypadValue);
    button.classList.toggle("current", buttonValue === value);
    button.setAttribute("aria-pressed", String(buttonValue === value));
  }
}

function closeMiniKeypad({ restoreFocus = false } = {}) {
  if (keypadCellIndex !== null) ocrResultCells[keypadCellIndex]?.classList.remove("selectedForEdit");
  const returnTarget = keypadAnchor;
  keypadCellIndex = null;
  keypadAnchor = null;
  miniKeypad.hidden = true;
  miniKeypad.style.visibility = "hidden";
  if (restoreFocus && returnTarget instanceof HTMLElement) returnTarget.focus({ preventScroll: true });
}

function openMiniKeypad(index, anchor) {
  if (isFullOcrRunning || !fullOcrResults[index] || fullOcrRevision !== alignmentRevision) return;
  if (keypadCellIndex !== null && keypadCellIndex !== index) {
    ocrResultCells[keypadCellIndex]?.classList.remove("selectedForEdit");
  }
  keypadCellIndex = index;
  keypadAnchor = anchor;
  ocrResultCells[index]?.classList.add("selectedForEdit");
  miniKeypad.hidden = false;
  miniKeypad.style.visibility = "hidden";
  refreshMiniKeypad();
  positionMiniKeypad();
}

function applyManualOcrValue(value) {
  if (keypadCellIndex === null) return;
  const metadata = fullOcrResults[keypadCellIndex];
  if (!metadata || fullOcrRevision !== alignmentRevision) {
    closeMiniKeypad();
    return;
  }
  metadata.value = value;
  metadata.manuallyEdited = true;
  clearSolverResult({ message: "問題を修正しました。現在の盤面でもう一度解けます。" });
  validateFullOcrResults();
  closeMiniKeypad({ restoreFocus: true });
}

function benchmarkValueLabel(value) {
  return value ? String(value) : ".";
}

function buildBenchmarkUi() {
  const truthFragment = document.createDocumentFragment();
  const comparisonFragment = document.createDocumentFragment();

  for (let index = 0; index < 81; index += 1) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const label = `R${row + 1}C${col + 1}`;

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.maxLength = 1;
    input.autocomplete = "off";
    input.className = "benchmarkTruthCell";
    input.setAttribute("aria-label", `${label} 正解`);
    input.addEventListener("input", () => {
      input.value = sanitizeOcrInput(input.value);
      benchmarkTruth[index] = input.value ? Number(input.value) : 0;
      invalidateBenchmarkResults("正解盤面を変更しました。Benchmarkを再実行してください。");
    });
    benchmarkTruthInputs.push(input);
    truthFragment.appendChild(input);

    const comparison = document.createElement("button");
    comparison.type = "button";
    comparison.className = "benchmarkComparisonCell";
    comparison.dataset.cellIndex = String(index);
    comparison.setAttribute("aria-label", `${label} Benchmark比較詳細`);
    comparisonFragment.appendChild(comparison);
  }

  benchmarkTruthBoard.appendChild(truthFragment);
  benchmarkComparisonBoard.appendChild(comparisonFragment);

  for (const method of BENCHMARK_METHODS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.dataset.benchmarkMethod = method.id;
    button.textContent = method.label;
    button.addEventListener("click", () => {
      benchmarkSelectedMethod = method.id;
      renderBenchmarkModalImages();
    });
    benchmarkMethodSwitcher.appendChild(button);
  }

  renderBenchmarkComparisonBoard();
}

function resetBenchmarkProgress() {
  benchmarkCurrentMethod.textContent = "方式：-";
  benchmarkMethodProgress.textContent = "方式内：0 / 81";
  benchmarkTotalProgress.textContent = "全体：0 / 324";
  benchmarkPercent.textContent = "0%";
  benchmarkProgressBar.value = 0;
}

function clearBenchmarkResults(message, badgeText = "未実行") {
  benchmarkResults = {};
  benchmarkConditionsSnapshot = null;
  benchmarkStateBadge.textContent = badgeText;
  benchmarkStateBadge.classList.remove("active", "success", "warning");
  if (badgeText === "要再実行") benchmarkStateBadge.classList.add("warning");
  benchmarkMessage.textContent = message;
  benchmarkMessage.classList.toggle("stale", badgeText === "要再実行");
  benchmarkConditions.hidden = true;
  benchmarkConditions.textContent = "";
  benchmarkResultsSection.hidden = true;
  benchmarkSummaryBody.replaceChildren();
  benchmarkErrorLists.replaceChildren();
  resetBenchmarkProgress();
  renderBenchmarkComparisonBoard();
}

function clearTuningResults() {
  tuningStateBadge.textContent = "未実行";
  tuningStateBadge.classList.remove("active", "success", "warning");
  tuningProgressText.textContent = "チューニングはまだ実行していません。";
  tuningProgressBar.value = 0;
  tuningResultsSection.hidden = true;
  tuningSummaryBody.replaceChildren();
  tuningBest.textContent = "";
  tuningAnalysis.textContent = "";
}

function invalidateBenchmarkResults(message = "画像条件を変更しました。Benchmarkを再実行してください。") {
  if (isBenchmarkRunning) return;
  const hadResults = Object.keys(benchmarkResults).length > 0;
  clearBenchmarkResults(message, hadResults ? "要再実行" : "未実行");
}

function handleCopyOcrToTruth() {
  if (isBenchmarkRunning) return;
  benchmarkTruth = fullOcrResults.map((result) => result?.value || 0);
  benchmarkTruthInputs.forEach((input, index) => {
    input.value = benchmarkTruth[index] ? String(benchmarkTruth[index]) : "";
  });
  clearBenchmarkResults("通常OCR結果をコピーしました。誤認識セルを修正してから実行してください。", "未実行");
}

function clearBenchmarkTruth() {
  benchmarkTruth = Array.from({ length: 81 }, () => 0);
  for (const input of benchmarkTruthInputs) input.value = "";
}

function setBenchmarkTruth(values) {
  if (!Array.isArray(values) || values.length !== 81) {
    throw new Error("正解JSONは0～9の値を81個含む必要があります。");
  }

  benchmarkTruth = values.map((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 9) {
      throw new Error("正解JSONには0～9の整数だけを指定してください。");
    }
    return number;
  });
  benchmarkTruthInputs.forEach((input, index) => {
    input.value = benchmarkTruth[index] ? String(benchmarkTruth[index]) : "";
  });
}

function renderBenchmarkComparisonBoard() {
  const buttons = benchmarkComparisonBoard.querySelectorAll(".benchmarkComparisonCell");
  buttons.forEach((button, index) => {
    const lines = [{ label: "正", value: benchmarkTruth[index] }];
    let hasError = false;
    BENCHMARK_METHODS.forEach((method, methodIndex) => {
      const value = benchmarkResults[method.id]?.cells[index]?.value ?? 0;
      lines.push({ label: String.fromCharCode(65 + methodIndex), value });
      if (benchmarkResults[method.id] && value !== benchmarkTruth[index]) hasError = true;
    });
    button.replaceChildren();
    for (const line of lines) {
      const span = document.createElement("span");
      const prefix = document.createElement(line.label === "正" ? "strong" : "b");
      prefix.textContent = `${line.label}:`;
      span.append(prefix, benchmarkValueLabel(line.value));
      button.appendChild(span);
    }
    button.classList.toggle("hasError", hasError);
  });
}

function formatBenchmarkTime(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function renderBenchmarkResults() {
  const best = selectBestBenchmarkMethod(benchmarkResults);
  benchmarkSummaryBody.replaceChildren();

  for (const method of BENCHMARK_METHODS) {
    const result = benchmarkResults[method.id];
    if (!result) continue;
    const row = document.createElement("tr");
    if (best?.id === method.id) row.classList.add("bestMethod");
    const methodCell = document.createElement("th");
    methodCell.scope = "row";
    methodCell.textContent = method.label;
    if (best?.id === method.id) {
      const badge = document.createElement("span");
      badge.className = "bestBadge";
      badge.textContent = "BEST";
      methodCell.appendChild(badge);
    }
    const digit = document.createElement("td");
    digit.className = "digitAccuracy";
    digit.textContent = `${result.metrics.digitCorrect}/${result.metrics.digitCells} ${formatAccuracy(result.metrics.digitAccuracy)}`;
    const blank = document.createElement("td");
    blank.textContent = `${result.metrics.blankCorrect}/${result.metrics.blankCells} ${formatAccuracy(result.metrics.blankAccuracy)}`;
    const total = document.createElement("td");
    total.textContent = `${result.metrics.totalCorrect}/81 ${formatAccuracy(result.metrics.totalAccuracy)}`;
    const time = document.createElement("td");
    time.textContent = formatBenchmarkTime(result.metrics.elapsedMs);
    row.append(methodCell, digit, blank, total, time);
    benchmarkSummaryBody.appendChild(row);
  }

  benchmarkErrorLists.replaceChildren();
  for (const method of BENCHMARK_METHODS) {
    const result = benchmarkResults[method.id];
    if (!result) continue;
    const group = document.createElement("details");
    group.className = "benchmarkErrorGroup";
    const summary = document.createElement("summary");
    summary.textContent = `${method.label} — ${result.metrics.errors.length}件（数字誤認識 ${result.metrics.digitMisrecognized} / 未認識 ${result.metrics.digitUnrecognized} / 空欄→数字 ${result.metrics.blankFalsePositive}）`;
    const items = document.createElement("div");
    items.className = "benchmarkErrorItems";
    if (!result.metrics.errors.length) {
      const empty = document.createElement("p");
      empty.className = "panelCopy";
      empty.textContent = "誤認識はありません。";
      items.appendChild(empty);
    }
    for (const error of result.metrics.errors) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "benchmarkErrorItem";
      button.dataset.cellIndex = String(error.index);
      button.dataset.benchmarkMethod = method.id;
      for (const text of [
        `R${Math.floor(error.index / 9) + 1}C${error.index % 9 + 1}`,
        `正解 ${benchmarkValueLabel(error.expected)}`,
        `認識 ${benchmarkValueLabel(error.actual)}`,
        `conf ${Number.isFinite(error.confidence) ? error.confidence.toFixed(1) : "-"}`
      ]) {
        const span = document.createElement("span");
        span.textContent = text;
        button.appendChild(span);
      }
      items.appendChild(button);
    }
    group.append(summary, items);
    benchmarkErrorLists.appendChild(group);
  }

  renderBenchmarkComparisonBoard();
  benchmarkResultsSection.hidden = false;
}

function updateOcrResultCell(index) {
  const metadata = fullOcrResults[index];
  const input = ocrResultInputs[index];
  const cell = ocrResultCells[index];
  const currentValue = metadata?.value || 0;
  const originalValue = metadata?.ocrValue || 0;
  input.textContent = currentValue ? String(currentValue) : "";
  input.dataset.value = String(currentValue);
  input.dataset.ocrValue = String(originalValue);
  input.dataset.manuallyEdited = String(Boolean(metadata?.manuallyEdited));
  input.setAttribute("aria-disabled", String(!metadata || fullOcrRevision !== alignmentRevision));
  const validationIssues = metadata?.validationIssues || [];
  cell.classList.remove("lowConfidence", "manuallyEdited", "needsReview");

  if (validationIssues.includes("low-confidence")) {
    cell.classList.add("lowConfidence");
  }
  if (validationIssues.length > 0) cell.classList.add("needsReview");
  if (metadata?.manuallyEdited) cell.classList.add("manuallyEdited");

  const confidenceLabel = metadata && Number.isFinite(metadata.confidence)
    ? metadata.confidence.toFixed(1)
    : "-";
  const issueTitle = validationIssues.length > 0
    ? ` / 要確認: ${validationIssues.map(validationIssueLabel).join(", ")}`
    : "";
  cell.title = `${Math.floor(index / 9) + 1}行${index % 9 + 1}列 / confidence ${confidenceLabel}${issueTitle}`;
  input.setAttribute("aria-label", `R${Math.floor(index / 9) + 1}C${index % 9 + 1} OCR結果 ${currentValue || "空欄"} を修正`);
}

function renderOcrResultBoard() {
  for (let index = 0; index < 81; index += 1) updateOcrResultCell(index);
}

function validationIssueLabel(issue) {
  return {
    "low-confidence": "低confidence",
    "duplicate-row": "行重複",
    "duplicate-column": "列重複",
    "duplicate-block": "3×3重複"
  }[issue] || issue;
}

function resetValidationSummary() {
  validationSummary.textContent = "検証待ち";
  validationSummary.classList.remove("clear", "warning");
}

function validateFullOcrResults() {
  const issuesByCell = validateSudokuGrid(fullOcrResults);
  fullOcrResults.forEach((metadata, index) => {
    if (metadata) metadata.validationIssues = issuesByCell[index];
  });
  renderOcrResultBoard();

  const issueCount = issuesByCell.filter((issues) => issues.length > 0).length;
  validationSummary.textContent = issueCount === 0 ? "✓ 要確認なし" : `要確認 ${issueCount}件`;
  validationSummary.classList.toggle("clear", issueCount === 0);
  validationSummary.classList.toggle("warning", issueCount > 0);
  refreshMiniKeypad();
  return issuesByCell;
}

function closeSolveConfirm() {
  solveConfirmModal.hidden = true;
}

function clearSolverResult({ disableSolve = false, message = "" } = {}) {
  originalPuzzle = null;
  solvedGrid = null;
  solutionBoard.replaceChildren();
  solutionSection.hidden = true;
  solveTime.textContent = "Solve Time: -";
  closeSolveConfirm();
  if (disableSolve) solveButton.disabled = true;
  if (message) solverMessage.textContent = message;
  solverMessage.classList.remove("error", "success");
}

function renderSolutionBoard() {
  const fragment = document.createDocumentFragment();
  solvedGrid.forEach((value, index) => {
    const cell = document.createElement("div");
    const isGiven = originalPuzzle[index] !== 0;
    cell.className = `solutionCell ${isGiven ? "given" : "solved"}`;
    cell.textContent = String(value);
    cell.setAttribute(
      "aria-label",
      `R${Math.floor(index / 9) + 1}C${index % 9 + 1} ${value} ${isGiven ? "問題数字" : "Solver数字"}`
    );
    fragment.appendChild(cell);
  });
  solutionBoard.replaceChildren(fragment);
}

function executeSolver() {
  closeSolveConfirm();
  clearSolverResult();
  let result;
  try {
    result = solvePuzzle(fullOcrResults);
  } catch (error) {
    console.error("[solver] failed", error);
    solverMessage.textContent = "Solver実行中にエラーが発生しました。問題数字を確認してください。";
    solverMessage.classList.add("error");
    solveButton.disabled = false;
    return;
  }
  originalPuzzle = result.originalPuzzle;

  if (result.status !== "solved") {
    solverMessage.textContent = result.status === "invalid-solution"
      ? `Solver結果を検証できませんでした。${result.reason || "問題数字を確認してください。"}`
      : "この盤面では解答を見つけられませんでした。問題数字を確認してください。";
    solverMessage.classList.add("error");
    solveButton.disabled = false;
    return;
  }

  solvedGrid = result.solution;
  renderSolutionBoard();
  solveTime.textContent = `Solve Time: ${result.elapsedMs} ms`;
  solutionSection.hidden = false;
  solverMessage.textContent = "解答を表示しました。";
  solverMessage.classList.add("success");
  solveButton.disabled = false;
  requestAnimationFrame(() => solutionSection.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function handleSolveRequest() {
  closeMiniKeypad();
  if (fullOcrRevision !== alignmentRevision || fullOcrResults.some((result) => !result)) {
    solverMessage.textContent = "先に全セルOCRを実行してください。";
    solverMessage.classList.add("error");
    return;
  }

  const issuesByCell = validateFullOcrResults();
  const gate = getSolveGate(issuesByCell);
  if (gate === "blocked") {
    solverMessage.textContent = "盤面に矛盾があります。オレンジ色のセルを確認してください。";
    solverMessage.classList.add("error");
    ocrResultBoard.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (gate === "confirm") {
    const count = issuesByCell.filter((issues) => issues.includes("low-confidence")).length;
    solveConfirmMessage.textContent = `要確認セルが${count}件あります。このまま解きますか？`;
    solveConfirmModal.hidden = false;
    confirmSolveButton.focus({ preventScroll: true });
    return;
  }

  executeSolver();
}

function handleReviewPuzzle() {
  closeSolveConfirm();
  ocrResultBoard.scrollIntoView({ behavior: "smooth", block: "center" });
}

function handleBackToPuzzle() {
  solutionSection.hidden = true;
  ocrResultBoard.scrollIntoView({ behavior: "smooth", block: "center" });
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
  showStoredOcrResult(index);
}

function showStoredOcrResult(index) {
  const stored = fullOcrResults[index];
  if (!stored || fullOcrRevision !== alignmentRevision) return;

  ocrRawResult.textContent = JSON.stringify(stored.rawText || "");
  ocrNormalizedResult.textContent = stored.value ? String(stored.value) : "空欄";
  ocrNormalizedResult.dataset.status = stored.value ? "digit" : "empty";
  ocrConfidence.textContent = formatConfidence(stored.confidence);
  ocrElapsedTime.textContent = Number.isFinite(stored.elapsedMs) ? `${stored.elapsedMs}ms` : "-";
  ocrProgress.textContent = stored.manuallyEdited
    ? `一括OCR後に手修正された結果です（OCR元値：${stored.ocrValue || "空欄"}／現在値：${stored.value || "空欄"}）。`
    : "一括OCRで取得した結果です。必要ならこのセルだけ再OCRできます。";
}

function prepareSelectedCellOcrImages() {
  if (preprocessEnabled) prepareFinalOcrImages(modalInnerCanvas, ocrScaledCanvas, ocrInputCanvas);
  else prepareOcrImages(modalInnerCanvas, ocrScaledCanvas, ocrInputCanvas, false);
  preprocessDescription.textContent = preprocessEnabled
    ? `A：外周除外 → B：白余白12.5%で${OCR_INPUT_SIZE}px配置 → C：グレースケール・コントラスト・Otsu二値化`
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
  const changed = preprocessEnabled !== enabled;
  preprocessEnabled = enabled;
  preprocessOnButton.classList.toggle("active", enabled);
  preprocessOffButton.classList.toggle("active", !enabled);
  preprocessOnButton.setAttribute("aria-pressed", String(enabled));
  preprocessOffButton.setAttribute("aria-pressed", String(!enabled));
  fullPreprocessOnButton.classList.toggle("active", enabled);
  fullPreprocessOffButton.classList.toggle("active", !enabled);
  fullPreprocessOnButton.setAttribute("aria-pressed", String(enabled));
  fullPreprocessOffButton.setAttribute("aria-pressed", String(!enabled));

  if (selectedCellIndex !== null) {
    prepareSelectedCellOcrImages();
    resetOcrResult();
  }
  if (changed) {
    alignmentRevision += 1;
    invalidateFullOcrResults("前処理を変更しました。再OCRしてください。");
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

function clearFullOcrResults(message, badgeText = "未実行") {
  closeMiniKeypad();
  clearSolverResult({ disableSolve: true, message: "OCR完了後に解けます。" });
  fullOcrRevision = null;
  fullOcrResults = Array.from({ length: 81 }, () => null);
  renderOcrResultBoard();
  fullOcrStateBadge.textContent = badgeText;
  fullOcrStateBadge.classList.remove("success", "active", "warning");
  if (badgeText === "要再OCR") fullOcrStateBadge.classList.add("warning");
  fullOcrProgressBar.value = 0;
  fullOcrPercent.textContent = "0%";
  fullOcrCurrentCell.textContent = "現在：-";
  fullOcrProgressText.textContent = message;
  fullOcrNotice.textContent = message;
  fullOcrNotice.classList.toggle("stale", badgeText === "要再OCR");
  ocrConditionSummary.hidden = true;
  ocrConditionSummary.textContent = "";
  resetValidationSummary();
}

function invalidateFullOcrResults(message = "画像調整後、再OCRしてください。") {
  clearFullOcrResults(message, "要再OCR");
}

function copyCapturedImageToSource() {
  capturedSourceCanvas.width = croppedCanvas.width;
  capturedSourceCanvas.height = croppedCanvas.height;
  const context = capturedSourceCanvas.getContext("2d");
  context.clearRect(0, 0, capturedSourceCanvas.width, capturedSourceCanvas.height);
  context.drawImage(croppedCanvas, 0, 0);
}

function activatePreparedBoard({ sourceLabel, imageInfo, truth = null }) {
  closeCellModal();
  closeBenchmarkModal();
  copyCapturedImageToSource();
  alignment = createDefaultAlignment();
  alignmentRevision += 1;
  clearOcrHistory();
  regenerateFromAlignment();
  clearFullOcrResults("画像を確認・調整してから全セルOCRを実行してください。", "未実行");

  if (truth) setBenchmarkTruth(truth);
  else clearBenchmarkTruth();
  clearBenchmarkResults(
    truth
      ? "サンプル正解盤面を設定しました。Benchmarkを実行できます。"
      : "正解盤面を設定してBenchmarkを実行してください。",
    "未実行"
  );
  clearTuningResults();

  inputSourceValue.textContent = sourceLabel;
  testImageInfo.textContent = imageInfo;
  cameraSection.hidden = true;
  resultSection.hidden = false;
}

function formatSignedPixels(value) {
  return `${value >= 0 ? "+" : ""}${value}px`;
}

function formatRotation(value) {
  if (value === 0) return "0.0°";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function updateAlignmentDisplay() {
  alignmentXValue.textContent = formatSignedPixels(alignment.x);
  alignmentYValue.textContent = formatSignedPixels(alignment.y);
  alignmentZoomValue.textContent = `${Math.round(alignment.scale * 100)}%`;
  alignmentRotationValue.textContent = formatRotation(alignment.rotation);
}

function regenerateFromAlignment() {
  renderAlignedSquare(capturedSourceCanvas, croppedCanvas, alignment);
  renderCellImages();
  updateAlignmentDisplay();
}

function applyAlignmentAction(action) {
  if (isFullOcrRunning || !capturedSourceCanvas.width) return;
  const next = action === "reset" ? createDefaultAlignment() : updateAlignment(alignment, action);
  if (
    next.x === alignment.x
    && next.y === alignment.y
    && next.scale === alignment.scale
    && next.rotation === alignment.rotation
  ) return;

  alignment = next;
  alignmentRevision += 1;
  regenerateFromAlignment();
  clearOcrHistory();
  invalidateFullOcrResults("画像調整後、再OCRしてください。");
  invalidateBenchmarkResults("画像調整後、Benchmarkを再実行してください。");
  setStatus("画像位置を調整しました。81セルを再生成したため、全セルOCRを再実行してください。");
}

function setFullOcrControlsDisabled(disabled) {
  isFullOcrRunning = disabled;
  runFullOcrButton.disabled = disabled;
  fullPreprocessOnButton.disabled = disabled;
  fullPreprocessOffButton.disabled = disabled;
  preprocessOnButton.disabled = disabled;
  preprocessOffButton.disabled = disabled;
  runSingleOcrButton.disabled = disabled;
  innerCropRange.disabled = disabled;
  resetAlignmentButton.disabled = disabled;
  retakeButton.disabled = disabled;
  for (const button of alignmentButtons) button.disabled = disabled;
  setTestInputControlsDisabled(disabled);
  runTuningButton.disabled = disabled;
  runFinalCandidateButton.disabled = disabled;
}

function setTestInputControlsDisabled(disabled) {
  testImageInput.disabled = disabled;
  loadSampleButton.disabled = disabled;
  loadSample02Button.disabled = disabled;
  testImageInput.closest(".filePickerButton")?.classList.toggle("isDisabled", disabled);
  testImageDropZone.setAttribute("aria-disabled", String(disabled));
}

function setBenchmarkControlsDisabled(disabled) {
  isBenchmarkRunning = disabled;
  setFullOcrControlsDisabled(disabled);
  copyOcrToTruthButton.disabled = disabled;
  runBenchmarkButton.disabled = disabled;
  copyBenchmarkButton.disabled = disabled;
  for (const input of benchmarkTruthInputs) input.disabled = disabled;
}

function benchmarkConditionsText(conditions) {
  return `X: ${formatSignedPixels(conditions.x)} / Y: ${formatSignedPixels(conditions.y)} / Zoom: ${Math.round(conditions.scale * 100)}% / Rotation: ${formatRotation(conditions.rotation)} / Outer Crop: ${conditions.outerCrop}% / OCR Size: ${OCR_INPUT_SIZE}px / PSM: SINGLE_CHAR`;
}

async function handleRunBenchmark() {
  if (isBenchmarkRunning || isFullOcrRunning || cells.length !== 81) return;
  if (!benchmarkTruth.some((value) => value > 0)) {
    benchmarkStateBadge.textContent = "正解未設定";
    benchmarkStateBadge.classList.add("warning");
    benchmarkMessage.textContent = "正解盤面に少なくとも1つ数字を設定してください。";
    return;
  }

  closeCellModal();
  closeBenchmarkModal();
  regenerateFromAlignment();
  const truthSnapshot = [...benchmarkTruth];
  const revisionAtStart = alignmentRevision;
  const conditions = {
    x: alignment.x,
    y: alignment.y,
    scale: alignment.scale,
    rotation: alignment.rotation,
    outerCrop: Number(innerCropRange.value)
  };

  benchmarkResults = {};
  benchmarkConditionsSnapshot = null;
  benchmarkResultsSection.hidden = true;
  benchmarkStateBadge.textContent = "実行中";
  benchmarkStateBadge.classList.remove("success", "warning");
  benchmarkStateBadge.classList.add("active");
  benchmarkMessage.classList.remove("stale");
  benchmarkMessage.textContent = "4方式を順番に処理しています。画面を閉じずにお待ちください。";
  resetBenchmarkProgress();
  setBenchmarkControlsDisabled(true);
  setOcrProgressListener(null);
  let totalCompleted = 0;

  try {
    await setOcrPageSegmentationMode("10");
    for (const method of BENCHMARK_METHODS) {
      const methodCells = [];
      let methodElapsedMs = 0;
      benchmarkCurrentMethod.textContent = `方式：${method.label}`;

      for (let index = 0; index < 81; index += 1) {
        benchmarkMethodProgress.textContent = `方式内：${index} / 81　現在 R${Math.floor(index / 9) + 1}C${index % 9 + 1}`;
        drawCellCrop(croppedCanvas, cells[index], benchmarkCellCanvas);
        prepareBenchmarkOcrImages(
          benchmarkCellCanvas,
          benchmarkWorkScaledCanvas,
          benchmarkWorkInputCanvas,
          method.id
        );
        const result = await recognizeSingleDigit(benchmarkWorkInputCanvas);
        methodElapsedMs += result.elapsedMs;
        methodCells.push({
          value: result.digit ? Number(result.digit) : 0,
          rawText: result.rawText,
          confidence: result.confidence,
          elapsedMs: result.elapsedMs,
          status: result.status
        });

        totalCompleted += 1;
        const methodCompleted = index + 1;
        const percent = Math.round((totalCompleted / 324) * 100);
        benchmarkMethodProgress.textContent = `方式内：${methodCompleted} / 81`;
        benchmarkTotalProgress.textContent = `全体：${totalCompleted} / 324`;
        benchmarkPercent.textContent = `${percent}%`;
        benchmarkProgressBar.value = totalCompleted;
      }

      benchmarkResults[method.id] = {
        id: method.id,
        label: method.label,
        cells: methodCells,
        metrics: evaluateBenchmarkMethod(truthSnapshot, methodCells, methodElapsedMs)
      };
    }

    if (alignmentRevision !== revisionAtStart) {
      throw new Error("Benchmark中に画像条件が変更されました。再実行してください。");
    }

    benchmarkConditionsSnapshot = conditions;
    benchmarkStateBadge.textContent = "完了";
    benchmarkStateBadge.classList.remove("active", "warning");
    benchmarkStateBadge.classList.add("success");
    benchmarkCurrentMethod.textContent = "方式：完了";
    benchmarkMethodProgress.textContent = "方式内：81 / 81";
    benchmarkMessage.textContent = "Benchmarkが完了しました。数字セル正解率を優先して比較してください。";
    benchmarkConditions.textContent = benchmarkConditionsText(conditions);
    benchmarkConditions.hidden = false;
    renderBenchmarkResults();
    setStatus("OCR Benchmarkが完了しました。結果をコピーして比較できます。");
  } catch (error) {
    console.error("[benchmark] failed", error);
    benchmarkResults = {};
    benchmarkConditionsSnapshot = null;
    benchmarkStateBadge.textContent = "エラー";
    benchmarkStateBadge.classList.remove("active", "success");
    benchmarkStateBadge.classList.add("warning");
    benchmarkMessage.textContent = error instanceof Error ? error.message : "Benchmarkに失敗しました。";
    benchmarkResultsSection.hidden = true;
  } finally {
    setOcrProgressListener(null);
    setBenchmarkControlsDisabled(false);
  }
}

let benchmarkModalReturnTarget = null;

function renderBenchmarkModalImages() {
  if (benchmarkSelectedCell === null || !benchmarkResults[benchmarkSelectedMethod]) return;
  const cell = cells[benchmarkSelectedCell];
  if (!cell) return;

  drawOriginalCell(croppedCanvas, cell, benchmarkOriginalCanvas);
  drawCellCrop(croppedCanvas, cell, benchmarkInnerCanvas);
  prepareBenchmarkOcrImages(
    benchmarkInnerCanvas,
    benchmarkScaledCanvas,
    benchmarkInputCanvas,
    benchmarkSelectedMethod
  );

  for (const button of benchmarkMethodSwitcher.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.benchmarkMethod === benchmarkSelectedMethod);
  }

  const descriptions = {
    raw: "RAW：拡大のみ。前処理なし。",
    current: "CURRENT：グレースケール → コントラスト1.35 → 平均輝度二値化。",
    grayscale: "GRAYSCALE：グレースケールのみ。二値化なし。",
    contrast: "CONTRAST：グレースケール → コントラスト1.35。二値化なし。"
  };
  benchmarkImageDescription.textContent = descriptions[benchmarkSelectedMethod];
}

function openBenchmarkModal(index, methodId, returnTarget) {
  if (!benchmarkResults[methodId] || !cells[index]) return;
  benchmarkSelectedCell = index;
  benchmarkSelectedMethod = methodId;
  benchmarkModalReturnTarget = returnTarget;
  benchmarkModalLabel.textContent = `R${Math.floor(index / 9) + 1}C${index % 9 + 1}`;
  const lines = [`正解：${benchmarkValueLabel(benchmarkTruth[index])}`];
  for (const method of BENCHMARK_METHODS) {
    const result = benchmarkResults[method.id]?.cells[index];
    lines.push(`${method.label}：${benchmarkValueLabel(result?.value || 0)} / confidence ${Number.isFinite(result?.confidence) ? result.confidence.toFixed(1) : "-"}`);
  }
  benchmarkCellResults.textContent = lines.join("\n");
  renderBenchmarkModalImages();
  benchmarkModal.hidden = false;
  closeBenchmarkModalButton.focus({ preventScroll: true });
}

function closeBenchmarkModal() {
  if (benchmarkModal.hidden) return;
  benchmarkModal.hidden = true;
  benchmarkSelectedCell = null;
  if (benchmarkModalReturnTarget instanceof HTMLElement) {
    benchmarkModalReturnTarget.focus({ preventScroll: true });
  }
  benchmarkModalReturnTarget = null;
}

function buildBenchmarkCopyText() {
  return buildBenchmarkReport(benchmarkResults, {
    ...benchmarkConditionsSnapshot,
    ocrSize: OCR_INPUT_SIZE,
    psm: "SINGLE_CHAR"
  });
}

async function handleCopyBenchmark() {
  if (!benchmarkConditionsSnapshot || !Object.keys(benchmarkResults).length) return;
  const text = buildBenchmarkCopyText();
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    copied = document.execCommand("copy");
    textarea.remove();
  }
  benchmarkMessage.textContent = copied
    ? "Benchmark結果をクリップボードへコピーしました。"
    : "クリップボードへコピーできませんでした。HTTPS環境で再度お試しください。";
}

async function handleRunFullOcr() {
  if (isFullOcrRunning || cells.length !== 81) return;

  closeMiniKeypad();
  closeCellModal();
  clearSolverResult({ disableSolve: true, message: "OCR完了後に解けます。" });
  regenerateFromAlignment();
  const revisionAtStart = alignmentRevision;
  const preprocessAtStart = preprocessEnabled;
  const ocrConditions = {
    x: alignment.x,
    y: alignment.y,
    scale: alignment.scale,
    rotation: alignment.rotation,
    outerCrop: Number(innerCropRange.value),
    preprocess: preprocessAtStart
  };
  fullOcrResults = Array.from({ length: 81 }, () => null);
  renderOcrResultBoard();
  setFullOcrControlsDisabled(true);
  fullOcrStateBadge.textContent = "OCR中";
  fullOcrStateBadge.classList.remove("success", "warning");
  fullOcrStateBadge.classList.add("active");
  fullOcrNotice.classList.remove("stale");
  fullOcrNotice.textContent = "81セルを順番にOCRしています。画面を閉じずにお待ちください。";
  fullOcrProgressBar.value = 0;
  fullOcrPercent.textContent = "0%";
  const batchStartedAt = performance.now();
  let currentIndex = 0;

  setOcrProgressListener((message) => {
    const workerPercent = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
    fullOcrProgressText.textContent = `${currentIndex} / 81　${message.status || "OCR処理中"}${workerPercent}`;
  });

  try {
    await setOcrPageSegmentationMode("8");
    for (let index = 0; index < cells.length; index += 1) {
      currentIndex = index + 1;
      const cell = cells[index];
      const label = getCellLabel(cell);
      fullOcrCurrentCell.textContent = `現在：${label}`;
      fullOcrProgressText.textContent = `OCR中… ${index} / 81`;

      drawCellCrop(croppedCanvas, cell, batchCellCanvas);
      let result;
      if (isClearlyBlankCell(batchCellCanvas)) {
        result = { digit: "", rawText: "", confidence: null, elapsedMs: 0, status: "empty", display: "空欄" };
      } else {
        if (preprocessAtStart) prepareFinalOcrImages(batchCellCanvas, batchScaledCanvas, batchInputCanvas);
        else prepareOcrImages(batchCellCanvas, batchScaledCanvas, batchInputCanvas, false);
        result = await recognizeSingleDigit(batchInputCanvas);
      }
      const recognizedValue = result.digit ? Number(result.digit) : 0;
      fullOcrResults[index] = {
        ocrValue: recognizedValue,
        value: recognizedValue,
        rawText: result.rawText,
        confidence: result.confidence,
        elapsedMs: result.elapsedMs,
        status: result.status,
        manuallyEdited: false,
        validationIssues: []
      };
      updateOcrResultCell(index);

      const completed = index + 1;
      const percent = Math.round((completed / 81) * 100);
      fullOcrProgressBar.value = completed;
      fullOcrPercent.textContent = `${percent}%`;
      fullOcrProgressText.textContent = `OCR中… ${completed} / 81`;
    }

    if (alignmentRevision !== revisionAtStart) {
      invalidateFullOcrResults("画像状態が変わりました。再OCRしてください。");
      return;
    }

    fullOcrRevision = revisionAtStart;
    validateFullOcrResults();
    solveButton.disabled = false;
    solverMessage.textContent = "OCR結果を確認して「解く」を押してください。";
    solverMessage.classList.remove("error", "success");
    const totalElapsed = Math.round(performance.now() - batchStartedAt);
    fullOcrStateBadge.textContent = "完了";
    fullOcrStateBadge.classList.remove("active", "warning");
    fullOcrStateBadge.classList.add("success");
    fullOcrProgressText.textContent = `OCR完了　81 / 81（${totalElapsed}ms）`;
    fullOcrCurrentCell.textContent = "現在：完了";
    fullOcrNotice.textContent = "OCR結果を確認し、必要なセルを手修正してください。";
    ocrConditionSummary.textContent = `OCR条件 — X: ${formatSignedPixels(ocrConditions.x)} / Y: ${formatSignedPixels(ocrConditions.y)} / Zoom: ${Math.round(ocrConditions.scale * 100)}% / Rotation: ${formatRotation(ocrConditions.rotation)} / Outer Crop: ${ocrConditions.outerCrop}% / Preprocess: ${ocrConditions.preprocess ? "Otsu + Padding 12.5%" : "OFF"} / PSM: SINGLE_WORD / Blank Detection: ON`;
    ocrConditionSummary.hidden = false;
    setStatus("81セルOCRが完了しました。低confidenceセルを確認し、必要なら手修正してください。");
  } catch (error) {
    console.error("[ocr] full grid OCR failed", error);
    fullOcrRevision = null;
    fullOcrStateBadge.textContent = "エラー";
    fullOcrStateBadge.classList.remove("active", "success");
    fullOcrStateBadge.classList.add("warning");
    const message = error instanceof Error ? error.message : "全セルOCRに失敗しました。";
    fullOcrProgressText.textContent = message;
    fullOcrNotice.textContent = "途中結果は参考表示です。問題を確認して再OCRしてください。";
    setStatus(message);
    solveButton.disabled = true;
  } finally {
    setOcrProgressListener(null);
    setFullOcrControlsDisabled(false);
  }
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
    await setOcrPageSegmentationMode("8");
    const result = isClearlyBlankCell(modalInnerCanvas)
      ? { digit: "", rawText: "", confidence: null, elapsedMs: 0, status: "empty", display: "空欄" }
      : await recognizeSingleDigit(ocrSnapshot);
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

function handleOcrResultDetail(event) {
  const button = event.target.closest(".resultDetailButton");
  if (button) {
    if (isFullOcrRunning) return;
    closeMiniKeypad();
    openCellModal(Number(button.dataset.cellIndex), button);
    return;
  }

  const cell = event.target.closest(".ocrResultCell");
  if (!cell) return;
  openMiniKeypad(Number(cell.dataset.cellIndex), cell.querySelector(".resultValueButton") || cell);
}

function handleInnerCropChange() {
  if (isFullOcrRunning) return;
  alignmentRevision += 1;
  renderCellImages();
  clearOcrHistory();
  invalidateFullOcrResults("外周除外率を変更しました。再OCRしてください。");
  invalidateBenchmarkResults("外周除外率を変更しました。Benchmarkを再実行してください。");
}

function renderTuningResults(tuningResult, sourceLabel) {
  tuningSummaryBody.replaceChildren();
  for (const result of tuningResult.results) {
    const row = document.createElement("tr");
    const values = [
      result.id,
      tuningConfigLabel(result.config),
      `${result.metrics.digitCorrect}/${result.metrics.digitCells} ${formatAccuracy(result.metrics.digitAccuracy)}`,
      `${result.metrics.blankCorrect}/${result.metrics.blankCells} ${formatAccuracy(result.metrics.blankAccuracy)}`,
      `${result.metrics.totalCorrect}/81 ${formatAccuracy(result.metrics.totalAccuracy)}`,
      `${(result.metrics.elapsedMs / 1000).toFixed(1)}s`
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    if (result === tuningResult.best) row.classList.add("bestRow");
    tuningSummaryBody.appendChild(row);
  }

  const best = tuningResult.best;
  const digitLines = Object.entries(best.analysis.perDigit)
    .map(([digit, counts]) => `${digit}: ${counts.correct}/${counts.total}`)
    .join(" / ");
  const errorLines = best.metrics.errors
    .filter((error) => error.expected > 0)
    .map((error) => `R${Math.floor(error.index / 9) + 1}C${error.index % 9 + 1}: ${error.expected} → ${error.actual || "空欄"}`);
  const failures = best.analysis.failures;

  tuningBest.textContent = `FINAL CANDIDATE (${sourceLabel}) — ${tuningConfigLabel(best.config)} / Digit ${formatAccuracy(best.metrics.digitAccuracy)} / Blank ${formatAccuracy(best.metrics.blankAccuracy)} / Overall ${formatAccuracy(best.metrics.totalAccuracy)}`;
  tuningAnalysis.textContent = [
    `数字別: ${digitLines}`,
    `数字→空欄: ${failures.empty}`,
    `別数字: ${failures.wrong}`,
    `複数文字: ${failures.multiple}`,
    `低confidence誤り: ${failures.lowConfidence}`,
    `高confidence誤り: ${failures.highConfidenceWrong}`,
    "誤認識:",
    ...(errorLines.length ? errorLines : ["なし"])
  ].join("\n");
  tuningResultsSection.hidden = false;
}

async function handleRunTuning() {
  if (isTuningRunning || isFullOcrRunning || isBenchmarkRunning || cells.length !== 81) return;
  if (!benchmarkTruth.some(Number)) {
    tuningStateBadge.textContent = "正解未設定";
    tuningStateBadge.classList.add("warning");
    tuningProgressText.textContent = "正解盤面を設定してから実行してください。";
    return;
  }

  isTuningRunning = true;
  setFullOcrControlsDisabled(true);
  for (const input of benchmarkTruthInputs) input.disabled = true;
  setOcrProgressListener(null);
  tuningStateBadge.textContent = "実行中";
  tuningStateBadge.classList.remove("success", "warning");
  tuningStateBadge.classList.add("active");
  tuningProgressBar.value = 0;
  tuningResultsSection.hidden = true;
  let completed = 0;
  const sourceLabel = inputSourceValue.textContent;

  try {
    const result = await runOcrTuning(croppedCanvas, [...benchmarkTruth], ({ config, cell }) => {
      completed += 1;
      tuningProgressBar.value = completed;
      tuningProgressText.textContent = `${config.id} — ${cell}/81　全体 ${completed}/${tuningProgressBar.max}`;
    });
    renderTuningResults(result, sourceLabel);
    tuningStateBadge.textContent = "完了";
    tuningStateBadge.classList.remove("active");
    tuningStateBadge.classList.add("success");
    tuningProgressText.textContent = `比較完了 — ${result.results.length}条件 / ${completed}セルOCR`;
    setStatus("OCR TUNINGが完了しました。数字正解率を最優先して結果を確認してください。");
  } catch (error) {
    console.error("[tuning] failed", error);
    tuningStateBadge.textContent = "エラー";
    tuningStateBadge.classList.remove("active", "success");
    tuningStateBadge.classList.add("warning");
    tuningProgressText.textContent = error instanceof Error ? error.message : "OCR TUNINGに失敗しました。";
  } finally {
    isTuningRunning = false;
    setFullOcrControlsDisabled(false);
    for (const input of benchmarkTruthInputs) input.disabled = false;
  }
}

async function handleRunFinalCandidate() {
  if (isTuningRunning || isFullOcrRunning || isBenchmarkRunning || cells.length !== 81) return;
  if (!benchmarkTruth.some(Number)) {
    tuningProgressText.textContent = "正解盤面を設定してから実行してください。";
    return;
  }

  isTuningRunning = true;
  setFullOcrControlsDisabled(true);
  for (const input of benchmarkTruthInputs) input.disabled = true;
  setOcrProgressListener(null);
  tuningStateBadge.textContent = "FINAL検証中";
  tuningStateBadge.classList.remove("success", "warning");
  tuningStateBadge.classList.add("active");
  tuningProgressBar.max = 81;
  tuningProgressBar.value = 0;
  tuningResultsSection.hidden = true;
  const sourceLabel = inputSourceValue.textContent;

  try {
    const result = await runFinalCandidate(croppedCanvas, [...benchmarkTruth], ({ cell }) => {
      tuningProgressBar.value = cell;
      tuningProgressText.textContent = `FINAL候補 — ${cell}/81`;
    });
    renderTuningResults({ results: [result], best: result }, sourceLabel);
    tuningStateBadge.textContent = "FINAL検証完了";
    tuningStateBadge.classList.remove("active");
    tuningStateBadge.classList.add("success");
    tuningProgressText.textContent = "FINAL候補の81セル検証が完了しました。";
  } catch (error) {
    console.error("[tuning] final candidate failed", error);
    tuningStateBadge.textContent = "エラー";
    tuningStateBadge.classList.remove("active", "success");
    tuningStateBadge.classList.add("warning");
    tuningProgressText.textContent = error instanceof Error ? error.message : "FINAL候補の検証に失敗しました。";
  } finally {
    tuningProgressBar.max = 2187;
    isTuningRunning = false;
    setFullOcrControlsDisabled(false);
    for (const input of benchmarkTruthInputs) input.disabled = false;
  }
}

async function loadBoardImage(blob, { sourceLabel, displayName, truth = null }) {
  if (isImageLoading || isFullOcrRunning || isBenchmarkRunning) return;
  if (!isSupportedImageFile(blob)) {
    throw new Error("PNG / JPEG / WebP画像を選択してください。");
  }

  isImageLoading = true;
  setTestInputControlsDisabled(true);
  setStatus(`${displayName} を読み込んでいます…`);

  try {
    const metadata = await loadImageBlobIntoCanvas(blob, croppedCanvas, 900);
    activatePreparedBoard({
      sourceLabel,
      imageInfo: `${displayName} / 元画像 ${metadata.width}×${metadata.height}px / 入力 900×900px`,
      truth
    });
    setStatus("画像を読み込みました。位置を確認し、「全セルOCR」またはBenchmarkを実行してください。");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    isImageLoading = false;
    setTestInputControlsDisabled(false);
  }
}

async function handleTestImageFile(file) {
  if (!file) return;
  try {
    await loadBoardImage(file, {
      sourceLabel: `FILE — ${file.name}`,
      displayName: file.name
    });
  } catch (error) {
    console.error("[image-input] file load failed", error);
    const message = error instanceof Error ? error.message : "画像ファイルの読み込みに失敗しました。";
    testImageInfo.textContent = message;
    setStatus(message);
  }
}

async function handleLoadSample(sampleName = "sudoku-sample-01") {
  if (isImageLoading || isFullOcrRunning || isBenchmarkRunning) return;
  isImageLoading = true;
  setTestInputControlsDisabled(true);
  setStatus(`${sampleName}と正解JSONを読み込んでいます…`);

  try {
    const imageResponse = await fetch(`./test-images/${sampleName}.png`);
    if (!imageResponse.ok) throw new Error("サンプル画像を取得できませんでした。");
    const imageBlob = await imageResponse.blob();

    const truthResponse = await fetch(`./test-images/${sampleName}.json`);
    if (!truthResponse.ok) throw new Error("サンプル正解JSONを取得できませんでした。");
    const truthJson = await truthResponse.json();
    const truth = Array.isArray(truthJson) ? truthJson : truthJson.grid;

    const metadata = await loadImageBlobIntoCanvas(imageBlob, croppedCanvas, 900);
    activatePreparedBoard({
      sourceLabel: `SAMPLE — ${sampleName}`,
      imageInfo: `${sampleName}.png / 元画像 ${metadata.width}×${metadata.height}px / 入力 900×900px`,
      truth
    });
    setStatus(`${sampleName}を読み込み、Benchmark正解盤面を自動設定しました。`);
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("[image-input] sample load failed", error);
    const message = error instanceof Error ? error.message : `${sampleName}の読み込みに失敗しました。`;
    testImageInfo.textContent = message;
    setStatus(message);
  } finally {
    isImageLoading = false;
    setTestInputControlsDisabled(false);
  }
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  isCaptureInProgress = false;
  setCameraActive(false);
  setStatus("カメラを起動しています…");

  try {
    await startCamera(cameraPreview);
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
  if (
    isCaptureInProgress
    || isImageLoading
    || captureButton.disabled
    || !hasLiveCameraStream(cameraPreview)
  ) return;

  isCaptureInProgress = true;
  captureButton.disabled = true;
  cameraTapHint.hidden = true;
  cameraStage.setAttribute("aria-disabled", "true");
  cameraStage.classList.add("capturing");
  let captureCompleted = false;

  try {
    captureGuideArea(cameraPreview, cameraGuide, croppedCanvas, 900);
    activatePreparedBoard({
      sourceLabel: "CAMERA",
      imageInfo: "カメラ撮影 / 入力 900×900px"
    });
    captureCompleted = true;
    setStatus("画像を微調整し、「全セルOCR」を実行してください。");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : "画像の切り出しに失敗しました。");
  } finally {
    cameraStage.classList.remove("capturing");
    if (!captureCompleted) {
      isCaptureInProgress = false;
      setCameraActive(hasLiveCameraStream(cameraPreview));
    }
  }
}

function handleRetake() {
  clearSolverResult({ disableSolve: true, message: "OCR完了後に解けます。" });
  closeMiniKeypad();
  closeCellModal();
  resultSection.hidden = true;
  cameraSection.hidden = false;
  isCaptureInProgress = false;

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
buildOcrResultBoard();
buildBenchmarkUi();
updateAlignmentDisplay();
clearFullOcrResults("画像を撮影してから全セルOCRを実行してください。", "未実行");
clearBenchmarkResults("正解盤面を設定してBenchmarkを実行してください。", "未実行");
clearTuningResults();

testImageInput.addEventListener("click", () => {
  testImageInput.value = "";
});
testImageInput.addEventListener("change", async () => {
  const [file] = testImageInput.files;
  await handleTestImageFile(file);
  testImageInput.value = "";
});
loadSampleButton.addEventListener("click", () => handleLoadSample("sudoku-sample-01"));
loadSample02Button.addEventListener("click", () => handleLoadSample("sudoku-sample-02"));
testImageDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!isImageLoading && !isFullOcrRunning && !isBenchmarkRunning) {
    testImageDropZone.classList.add("isDragging");
  }
});
testImageDropZone.addEventListener("dragleave", () => {
  testImageDropZone.classList.remove("isDragging");
});
testImageDropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  testImageDropZone.classList.remove("isDragging");
  if (isImageLoading || isFullOcrRunning || isBenchmarkRunning) return;
  await handleTestImageFile(event.dataTransfer?.files?.[0]);
});
testImageDropZone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (!testImageInput.disabled) testImageInput.click();
});
startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
cameraStage.addEventListener("click", handleCapture);
cameraStage.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  handleCapture();
});
retakeButton.addEventListener("click", handleRetake);
innerCropRange.addEventListener("input", handleInnerCropChange);
listViewButton.addEventListener("click", () => setCellView("list"));
boardViewButton.addEventListener("click", () => setCellView("board"));
cellList.addEventListener("click", handleCellSelection);
boardGrid.addEventListener("click", handleCellSelection);
ocrResultBoard.addEventListener("click", handleOcrResultDetail);
closeModalButton.addEventListener("click", closeCellModal);
preprocessOnButton.addEventListener("click", () => setPreprocessing(true));
preprocessOffButton.addEventListener("click", () => setPreprocessing(false));
fullPreprocessOnButton.addEventListener("click", () => setPreprocessing(true));
fullPreprocessOffButton.addEventListener("click", () => setPreprocessing(false));
runSingleOcrButton.addEventListener("click", handleRunSingleOcr);
runFullOcrButton.addEventListener("click", handleRunFullOcr);
solveButton.addEventListener("click", handleSolveRequest);
confirmSolveButton.addEventListener("click", executeSolver);
reviewPuzzleButton.addEventListener("click", handleReviewPuzzle);
backToPuzzleButton.addEventListener("click", handleBackToPuzzle);
solveConfirmModal.addEventListener("click", (event) => {
  if (event.target === solveConfirmModal) handleReviewPuzzle();
});
copyOcrToTruthButton.addEventListener("click", handleCopyOcrToTruth);
runBenchmarkButton.addEventListener("click", handleRunBenchmark);
runTuningButton.addEventListener("click", handleRunTuning);
runFinalCandidateButton.addEventListener("click", handleRunFinalCandidate);
copyBenchmarkButton.addEventListener("click", handleCopyBenchmark);
benchmarkComparisonBoard.addEventListener("click", (event) => {
  const target = event.target.closest(".benchmarkComparisonCell");
  if (!target || isBenchmarkRunning) return;
  openBenchmarkModal(Number(target.dataset.cellIndex), "current", target);
});
benchmarkErrorLists.addEventListener("click", (event) => {
  const target = event.target.closest(".benchmarkErrorItem");
  if (!target || isBenchmarkRunning) return;
  openBenchmarkModal(Number(target.dataset.cellIndex), target.dataset.benchmarkMethod, target);
});
closeBenchmarkModalButton.addEventListener("click", closeBenchmarkModal);
benchmarkModal.addEventListener("click", (event) => {
  if (event.target === benchmarkModal) closeBenchmarkModal();
});
resetAlignmentButton.addEventListener("click", () => applyAlignmentAction("reset"));
for (const button of alignmentButtons) {
  button.addEventListener("click", () => applyAlignmentAction(button.dataset.alignAction));
}
cellModal.addEventListener("click", (event) => {
  if (event.target === cellModal) closeCellModal();
});
document.addEventListener("keydown", (event) => {
  if (keypadCellIndex !== null) {
    const typingTarget = event.target instanceof HTMLElement
      && (event.target.matches("input, textarea, select") || event.target.isContentEditable);
    if (!typingTarget && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      applyManualOcrValue(Number(event.key));
      return;
    }
    if (!typingTarget && (event.key === "0" || event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      applyManualOcrValue(0);
      return;
    }
  }
  if (event.key === "Escape") {
    closeMiniKeypad({ restoreFocus: true });
    closeSolveConfirm();
    closeCellModal();
    closeBenchmarkModal();
  }
});

miniKeypad.addEventListener("click", (event) => {
  const valueButton = event.target.closest("[data-keypad-value]");
  if (valueButton) applyManualOcrValue(Number(valueButton.dataset.keypadValue));
});
closeMiniKeypadButton.addEventListener("click", () => closeMiniKeypad({ restoreFocus: true }));
document.addEventListener("pointerdown", (event) => {
  if (miniKeypad.hidden || miniKeypad.contains(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".ocrResultCell")) return;
  closeMiniKeypad();
});
window.addEventListener("resize", positionMiniKeypad);
window.addEventListener("scroll", positionMiniKeypad, { passive: true });

window.addEventListener("pagehide", () => {
  stopCamera(cameraPreview);
});
