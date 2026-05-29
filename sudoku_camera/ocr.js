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

function getBinaryImageData(sourceCanvas) {
  const sourceContext = sourceCanvas.getContext("2d");
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

  console.log("[ocr] binarize settings", { average, threshold, contrast });

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    const binary = contrasted >= threshold ? 255 : 0;
    data[index] = binary;
    data[index + 1] = binary;
    data[index + 2] = binary;
    data[index + 3] = 255;
  }

  return imageData;
}

function drawImageDataToCanvas(imageData, outputCanvas) {
  outputCanvas.width = imageData.width;
  outputCanvas.height = imageData.height;
  const outputContext = outputCanvas.getContext("2d");
  outputContext.putImageData(imageData, 0, 0);
  return outputCanvas;
}

function getBlackPixelCountAt(data, width, x, y) {
  const index = (y * width + x) * 4;
  return data[index] === 0 ? 1 : 0;
}

function paintColumnWhite(data, width, height, columnIndex) {
  for (let row = 0; row < height; row += 1) {
    const index = (row * width + columnIndex) * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
}

function paintRowWhite(data, width, rowIndex) {
  for (let column = 0; column < width; column += 1) {
    const index = (rowIndex * width + column) * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
}

export function preprocessToBinaryCanvas(sourceCanvas, outputCanvas) {
  const binaryImageData = getBinaryImageData(sourceCanvas);
  return drawImageDataToCanvas(binaryImageData, outputCanvas);
}

export function removeGridLinesFromCanvas(sourceCanvas, outputCanvas, options) {
  const imageData = getBinaryImageData(sourceCanvas);
  const { data, width, height } = imageData;
  const verticalThreshold = options.verticalThreshold ?? 0.85;
  const horizontalThreshold = options.horizontalThreshold ?? 0.85;
  const eraseRadius = options.eraseRadius ?? 2;
  const verticalLimit = Math.ceil(height * verticalThreshold);
  const horizontalLimit = Math.ceil(width * horizontalThreshold);

  console.log("[ocr] line removal settings", {
    width,
    height,
    verticalThreshold,
    horizontalThreshold,
    eraseRadius,
    verticalLimit,
    horizontalLimit
  });

  const verticalCandidates = [];
  for (let column = 0; column < width; column += 1) {
    let blackCount = 0;
    for (let row = 0; row < height; row += 1) {
      blackCount += getBlackPixelCountAt(data, width, column, row);
    }
    if (blackCount >= verticalLimit) {
      verticalCandidates.push(column);
    }
  }

  for (const column of verticalCandidates) {
    const start = Math.max(0, column - eraseRadius);
    const end = Math.min(width - 1, column + eraseRadius);
    for (let targetColumn = start; targetColumn <= end; targetColumn += 1) {
      paintColumnWhite(data, width, height, targetColumn);
    }
  }

  const horizontalCandidates = [];
  for (let row = 0; row < height; row += 1) {
    let blackCount = 0;
    for (let column = 0; column < width; column += 1) {
      blackCount += getBlackPixelCountAt(data, width, column, row);
    }
    if (blackCount >= horizontalLimit) {
      horizontalCandidates.push(row);
    }
  }

  for (const row of horizontalCandidates) {
    const start = Math.max(0, row - eraseRadius);
    const end = Math.min(height - 1, row + eraseRadius);
    for (let targetRow = start; targetRow <= end; targetRow += 1) {
      paintRowWhite(data, width, targetRow);
    }
  }

  console.log("[ocr] line removal result", {
    verticalCandidates: verticalCandidates.length,
    horizontalCandidates: horizontalCandidates.length
  });

  return drawImageDataToCanvas(imageData, outputCanvas);
}

export async function runOcrFromCanvas(sourceCanvas) {
  const worker = await getWorker();

  console.log("[ocr] starting OCR", {
    width: sourceCanvas.width,
    height: sourceCanvas.height
  });

  const result = await worker.recognize(sourceCanvas);
  const rawText = result.data.text || "";
  const digitsOnly = getDigitsOnlyLines(rawText);

  console.log("[ocr] raw text", rawText);
  console.log("[ocr] digits only", digitsOnly);

  return {
    rawText,
    digitsOnly
  };
}
