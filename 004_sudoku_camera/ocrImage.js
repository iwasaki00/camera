export const OCR_INPUT_SIZE = 240;

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
