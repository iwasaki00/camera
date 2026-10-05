export const OCR_INPUT_SIZE = 240;
export const FINAL_OCR_PADDING_RATE = 0.125;
export const BLANK_INK_RATIO = 0.003;

export function prepareOcrImages(sourceCanvas, scaledCanvas, inputCanvas, preprocessEnabled) {
  const size = OCR_INPUT_SIZE;
  scaledCanvas.width = size;
  scaledCanvas.height = size;

  const scaledContext = scaledCanvas.getContext("2d", { willReadFrequently: true });
  scaledContext.clearRect(0, 0, size, size);
  scaledContext.imageSmoothingEnabled = true;
  scaledContext.imageSmoothingQuality = "high";
  scaledContext.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, size, size);

  inputCanvas.width = size;
  inputCanvas.height = size;
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  inputContext.clearRect(0, 0, size, size);
  inputContext.drawImage(scaledCanvas, 0, 0);

  if (preprocessEnabled) {
    applySimplePreprocessing(inputContext, size, size);
  }

  console.log("[ocr-image] prepared", {
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height,
    outputWidth: size,
    outputHeight: size,
    preprocessEnabled
  });
}

export function applySimplePreprocessing(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const grayscale = new Uint8Array(width * height);
  let grayscaleTotal = 0;

  for (let pixelIndex = 0, grayIndex = 0; pixelIndex < pixels.length; pixelIndex += 4, grayIndex += 1) {
    const value = Math.round(
      pixels[pixelIndex] * 0.299 +
      pixels[pixelIndex + 1] * 0.587 +
      pixels[pixelIndex + 2] * 0.114
    );
    const contrasted = Math.max(0, Math.min(255, Math.round((value - 128) * 1.35 + 128)));
    grayscale[grayIndex] = contrasted;
    grayscaleTotal += contrasted;
  }

  // 固定値に依存しすぎないよう、画像全体の平均輝度を二値化の基準にする。
  const threshold = Math.max(110, Math.min(205, Math.round(grayscaleTotal / grayscale.length)));

  for (let pixelIndex = 0, grayIndex = 0; pixelIndex < pixels.length; pixelIndex += 4, grayIndex += 1) {
    const binary = grayscale[grayIndex] < threshold ? 0 : 255;
    pixels[pixelIndex] = binary;
    pixels[pixelIndex + 1] = binary;
    pixels[pixelIndex + 2] = binary;
    pixels[pixelIndex + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return threshold;
}

export function analyzeCellInk(sourceCanvas) {
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
  let darkPixels = 0;
  const totalPixels = pixels.length / 4;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const gray = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
    if (gray < 160) darkPixels += 1;
  }
  return { darkPixels, ratio: darkPixels / totalPixels };
}

export function isClearlyBlankCell(sourceCanvas) {
  return analyzeCellInk(sourceCanvas).ratio < BLANK_INK_RATIO;
}

function calculateOtsuThreshold(histogram, totalPixels) {
  let weightedTotal = 0;
  for (let value = 0; value < 256; value += 1) weightedTotal += value * histogram[value];
  let backgroundCount = 0;
  let backgroundTotal = 0;
  let maximumVariance = -1;
  let threshold = 127;

  for (let value = 0; value < 256; value += 1) {
    backgroundCount += histogram[value];
    if (!backgroundCount) continue;
    const foregroundCount = totalPixels - backgroundCount;
    if (!foregroundCount) break;
    backgroundTotal += value * histogram[value];
    const backgroundMean = backgroundTotal / backgroundCount;
    const foregroundMean = (weightedTotal - backgroundTotal) / foregroundCount;
    const variance = backgroundCount * foregroundCount * (backgroundMean - foregroundMean) ** 2;
    if (variance > maximumVariance) {
      maximumVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function applyOtsuPreprocessing(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const grayscale = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);

  for (let offset = 0, index = 0; offset < pixels.length; offset += 4, index += 1) {
    const gray = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    const contrasted = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.35 + 128)));
    grayscale[index] = contrasted;
    histogram[contrasted] += 1;
  }

  const threshold = calculateOtsuThreshold(histogram, grayscale.length);
  for (let offset = 0, index = 0; offset < pixels.length; offset += 4, index += 1) {
    const binary = grayscale[index] < threshold ? 0 : 255;
    pixels[offset] = binary;
    pixels[offset + 1] = binary;
    pixels[offset + 2] = binary;
    pixels[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return threshold;
}

export function prepareFinalOcrImages(sourceCanvas, scaledCanvas, inputCanvas) {
  const size = OCR_INPUT_SIZE;
  const padding = Math.round(size * FINAL_OCR_PADDING_RATE);
  const contentSize = size - padding * 2;
  scaledCanvas.width = size;
  scaledCanvas.height = size;
  const scaledContext = scaledCanvas.getContext("2d", { willReadFrequently: true });
  scaledContext.fillStyle = "#ffffff";
  scaledContext.fillRect(0, 0, size, size);
  scaledContext.imageSmoothingEnabled = true;
  scaledContext.imageSmoothingQuality = "high";
  scaledContext.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, padding, padding, contentSize, contentSize);

  inputCanvas.width = size;
  inputCanvas.height = size;
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  inputContext.drawImage(scaledCanvas, 0, 0);
  return applyOtsuPreprocessing(inputContext, size, size);
}

export function prepareBenchmarkOcrImages(sourceCanvas, scaledCanvas, inputCanvas, mode) {
  if (mode === "raw") {
    prepareOcrImages(sourceCanvas, scaledCanvas, inputCanvas, false);
    return;
  }
  if (mode === "current") {
    prepareOcrImages(sourceCanvas, scaledCanvas, inputCanvas, true);
    return;
  }

  const size = OCR_INPUT_SIZE;
  scaledCanvas.width = size;
  scaledCanvas.height = size;
  const scaledContext = scaledCanvas.getContext("2d", { willReadFrequently: true });
  scaledContext.clearRect(0, 0, size, size);
  scaledContext.imageSmoothingEnabled = true;
  scaledContext.imageSmoothingQuality = "high";
  scaledContext.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, size, size);

  inputCanvas.width = size;
  inputCanvas.height = size;
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  inputContext.clearRect(0, 0, size, size);
  inputContext.drawImage(scaledCanvas, 0, 0);

  if (mode === "grayscale") applyGrayscale(inputContext, size, size, 1);
  if (mode === "contrast") applyGrayscale(inputContext, size, size, 1.35);
}

function applyGrayscale(context, width, height, contrast) {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const grayscale = Math.round(
      pixels[index] * 0.299
      + pixels[index + 1] * 0.587
      + pixels[index + 2] * 0.114
    );
    const adjusted = Math.max(0, Math.min(255, Math.round((grayscale - 128) * contrast + 128)));
    pixels[index] = adjusted;
    pixels[index + 1] = adjusted;
    pixels[index + 2] = adjusted;
    pixels[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
}
