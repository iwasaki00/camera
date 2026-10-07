import { drawCellCrop, splitBoardIntoCells } from "./gridOcr.js";
import { recognizeSingleDigit, setOcrPageSegmentationMode } from "./ocr.js";
import { evaluateBenchmarkMethod } from "./benchmark.js";
import { analyzeCellInk } from "./ocrImage.js?v=1.0.0";

const PSM_LABELS = Object.freeze({ "10": "SINGLE_CHAR", "8": "SINGLE_WORD", "6": "SINGLE_BLOCK" });

export const FINAL_CANDIDATE_CONFIG = Object.freeze({
  id: "FINAL",
  preprocess: "otsu",
  psm: "8",
  size: 240,
  crop: 15,
  padding: 0.125,
  blankDetection: true
});

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 127;

  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = value;
    }
  }
  return bestThreshold;
}

function applyPixels(context, size, mode) {
  if (mode === "raw") return;
  const imageData = context.getImageData(0, 0, size, size);
  const pixels = imageData.data;
  const grayscale = new Uint8Array(size * size);
  const histogram = new Uint32Array(256);
  let total = 0;

  for (let offset = 0, index = 0; offset < pixels.length; offset += 4, index += 1) {
    const gray = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    const contrast = mode === "grayscale" ? 1 : 1.35;
    const adjusted = clampByte((gray - 128) * contrast + 128);
    grayscale[index] = adjusted;
    histogram[adjusted] += 1;
    total += adjusted;
  }

  let threshold = null;
  if (mode === "current") threshold = clampByte(total / grayscale.length);
  if (mode === "fixed150") threshold = 150;
  if (mode === "fixed180") threshold = 180;
  if (mode === "otsu") threshold = otsuThreshold(histogram, grayscale.length);

  for (let offset = 0, index = 0; offset < pixels.length; offset += 4, index += 1) {
    const output = threshold === null ? grayscale[index] : (grayscale[index] < threshold ? 0 : 255);
    pixels[offset] = output;
    pixels[offset + 1] = output;
    pixels[offset + 2] = output;
    pixels[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
}

function prepareTuningImage(sourceCanvas, outputCanvas, config) {
  const size = config.size;
  const padding = Math.round(size * config.padding);
  const contentSize = Math.max(1, size - padding * 2);
  outputCanvas.width = size;
  outputCanvas.height = size;
  const context = outputCanvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    sourceCanvas,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
    padding,
    padding,
    contentSize,
    contentSize
  );
  applyPixels(context, size, config.preprocess);
}

function compareResults(left, right) {
  return right.metrics.digitAccuracy - left.metrics.digitAccuracy
    || left.metrics.digitUnrecognized - right.metrics.digitUnrecognized
    || right.metrics.blankAccuracy - left.metrics.blankAccuracy
    || right.metrics.totalAccuracy - left.metrics.totalAccuracy
    || left.metrics.elapsedMs - right.metrics.elapsedMs;
}

function bestResult(results) {
  return [...results].sort(compareResults)[0];
}

function analyzeDigits(truth, cells) {
  const perDigit = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, { total: 0, correct: 0 }]));
  const failures = { empty: 0, wrong: 0, multiple: 0, lowConfidence: 0, highConfidenceWrong: 0 };
  truth.forEach((expected, index) => {
    if (!expected) return;
    const result = cells[index];
    perDigit[expected].total += 1;
    if (result.value === expected) perDigit[expected].correct += 1;
    else {
      if (!result.value) failures.empty += 1;
      else failures.wrong += 1;
      if (result.status === "multiple") failures.multiple += 1;
      if (Number.isFinite(result.confidence) && result.confidence < 70) failures.lowConfidence += 1;
      if (Number.isFinite(result.confidence) && result.confidence >= 70) failures.highConfidenceWrong += 1;
    }
  });
  return { perDigit, failures };
}

async function runOne(boardCanvas, truth, config, onProgress) {
  await setOcrPageSegmentationMode(config.psm);
  const cells = splitBoardIntoCells(boardCanvas, config.crop / 100);
  const cellCanvas = document.createElement("canvas");
  const inputCanvas = document.createElement("canvas");
  const outputs = [];
  const startedAt = performance.now();

  for (let index = 0; index < cells.length; index += 1) {
    drawCellCrop(boardCanvas, cells[index], cellCanvas);
    const ink = analyzeCellInk(cellCanvas);
    if (config.blankDetection && ink.ratio < 0.003) {
      outputs.push({ value: 0, rawText: "", confidence: null, elapsedMs: 0, status: "empty", skippedAsBlank: true });
    } else {
      prepareTuningImage(cellCanvas, inputCanvas, config);
      const result = await recognizeSingleDigit(inputCanvas);
      outputs.push({
        value: result.digit ? Number(result.digit) : 0,
        rawText: result.rawText,
        confidence: result.confidence,
        elapsedMs: result.elapsedMs,
        status: result.status,
        skippedAsBlank: false
      });
    }
    onProgress?.({ config, cell: index + 1 });
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  return {
    id: config.id,
    config,
    cells: outputs,
    metrics: evaluateBenchmarkMethod(truth, outputs, elapsedMs),
    analysis: analyzeDigits(truth, outputs)
  };
}

export async function runFinalCandidate(boardCanvas, truth, onProgress) {
  try {
    return await runOne(boardCanvas, truth, FINAL_CANDIDATE_CONFIG, onProgress);
  } finally {
    await setOcrPageSegmentationMode("10");
  }
}

function variants(base, field, values, prefix) {
  return values.map(({ value, label }) => ({ ...base, [field]: value, id: `${prefix}-${label}` }));
}

export async function runOcrTuning(boardCanvas, truth, onProgress) {
  if (!Array.isArray(truth) || truth.length !== 81 || !truth.some(Number)) {
    throw new Error("OCR TUNINGには81セルの正解盤面が必要です。");
  }

  const results = [];
  const base = { preprocess: "current", psm: "10", size: 240, crop: 20, padding: 0, blankDetection: false };
  const phases = [
    variants(base, "preprocess", [
      { value: "raw", label: "RAW" },
      { value: "current", label: "CURRENT" },
      { value: "grayscale", label: "GRAYSCALE" },
      { value: "contrast", label: "CONTRAST" }
    ], "A")
  ];

  try {
    for (const configs of phases) {
      for (const config of configs) results.push(await runOne(boardCanvas, truth, config, onProgress));
    }

    let best = bestResult(results);
    // Aの4方式は従来どおり全81セルをOCRする。以降は画像だけを使う
    // 保守的な空欄判定で明白な空欄を省き、数字条件の比較を高速化する。
    best = { ...best, config: { ...best.config, blankDetection: true } };
    const phaseDefinitions = [
      ["psm", [{ value: "10", label: "CHAR" }, { value: "8", label: "WORD" }, { value: "6", label: "BLOCK" }], "B"],
      ["size", [120, 180, 240, 320, 480].map((value) => ({ value, label: String(value) })), "C"],
      ["crop", [10, 15, 20, 25, 30].map((value) => ({ value, label: String(value) })), "D"],
      ["preprocess", [
        { value: "contrast", label: "NONE" },
        { value: "fixed150", label: "FIX150" },
        { value: "fixed180", label: "FIX180" },
        { value: "current", label: "MEAN" },
        { value: "otsu", label: "OTSU" }
      ], "E"],
      ["padding", [
        { value: 0, label: "P0" },
        { value: 0.125, label: "P12" },
        { value: 0.25, label: "P25" }
      ], "F"],
      ["blankDetection", [
        { value: false, label: "OFF" },
        { value: true, label: "ON" }
      ], "G"]
    ];

    for (const [field, values, prefix] of phaseDefinitions) {
      const configs = variants(best.config, field, values, prefix);
      const phaseResults = [];
      for (const config of configs) {
        const result = await runOne(boardCanvas, truth, config, onProgress);
        results.push(result);
        phaseResults.push(result);
      }
      best = bestResult(phaseResults);
    }

    return { results, best };
  } finally {
    await setOcrPageSegmentationMode("10");
  }
}

export function tuningConfigLabel(config) {
  return `${config.preprocess} / ${PSM_LABELS[config.psm]} / ${config.size}px / crop ${config.crop}% / padding ${Math.round(config.padding * 100)}% / blank ${config.blankDetection ? "ON" : "OFF"}`;
}
