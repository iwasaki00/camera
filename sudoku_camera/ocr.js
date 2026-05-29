let workerPromise = null;

async function getWorker() {
  if (!window.Tesseract) {
    throw new Error("\u30e9\u30a4\u30d6\u30e9\u30ea Tesseract.js \u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }

  if (!workerPromise) {
    workerPromise = (async () => {
      console.log("[ocr] creating worker");
      const worker = await window.Tesseract.createWorker("eng", 1, {
        logger(message) {
          console.log("[ocr][progress]", message);
        }
      });

      await worker.setParameters({
        tessedit_char_whitelist: "0123456789"
      });

      console.log("[ocr] worker ready");
      return worker;
    })();
  }

  return workerPromise;
}

function getDigitsOnlyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[^0-9]/g, ""))
    .filter((line) => line.length > 0)
    .join("\n");
}

function preprocessForOcr(sourceCanvas, outputCanvas) {
  outputCanvas.width = sourceCanvas.width;
  outputCanvas.height = sourceCanvas.height;

  const sourceContext = sourceCanvas.getContext("2d");
  const outputContext = outputCanvas.getContext("2d");
  const imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const { data } = imageData;

  let total = 0;

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    total += gray;
  }

  const pixelCount = data.length / 4;
  const average = pixelCount > 0 ? total / pixelCount : 128;
  const threshold = Math.max(90, Math.min(190, average * 0.92));
  const contrast = 1.45;

  console.log("[ocr] preprocess settings", { average, threshold, contrast });

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    const binary = contrasted >= threshold ? 255 : 0;
    data[index] = binary;
    data[index + 1] = binary;
    data[index + 2] = binary;
    data[index + 3] = 255;
  }

  outputContext.putImageData(imageData, 0, 0);
  return outputCanvas;
}

export async function runOcrFromCanvas(sourceCanvas, processedCanvas) {
  const worker = await getWorker();
  const targetCanvas = preprocessForOcr(sourceCanvas, processedCanvas);

  console.log("[ocr] starting OCR", {
    width: targetCanvas.width,
    height: targetCanvas.height
  });

  const result = await worker.recognize(targetCanvas);
  const rawText = result.data.text || "";
  const digitsOnly = getDigitsOnlyLines(rawText);

  console.log("[ocr] raw text", rawText);
  console.log("[ocr] digits only", digitsOnly);

  return {
    rawText,
    digitsOnly
  };
}
