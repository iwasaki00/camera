let workerPromise = null;
let progressListener = null;

async function getWorker() {
  if (!window.Tesseract) {
    throw new Error("Tesseract.js の読み込みに失敗しました。");
  }

  if (!workerPromise) {
    workerPromise = (async () => {
      console.log("[ocr] creating single-char worker");
      const worker = await window.Tesseract.createWorker("eng", 1, {
        logger(message) {
          console.log("[ocr][progress]", message);
          if (progressListener) progressListener(message);
        }
      });

      await worker.setParameters({
        tessedit_char_whitelist: "123456789",
        tessedit_pageseg_mode: "10"
      });

      console.log("[ocr] worker ready");
      return worker;
    })();
  }

  return workerPromise;
}

export function classifySingleDigit(text) {
  const compactText = String(text || "").replace(/\s/g, "");

  if (!compactText) {
    return { status: "empty", display: "空欄", digit: "" };
  }
  if (compactText.length > 1) {
    return { status: "multiple", display: "複数文字検出", digit: "" };
  }
  if (/^[1-9]$/.test(compactText)) {
    return { status: "digit", display: compactText, digit: compactText };
  }
  return { status: "empty", display: "空欄", digit: "" };
}

export function setOcrProgressListener(listener) {
  progressListener = typeof listener === "function" ? listener : null;
}

export async function recognizeSingleDigit(canvasElement) {
  const worker = await getWorker();
  const startedAt = performance.now();
  const result = await worker.recognize(canvasElement);
  const elapsedMs = Math.round(performance.now() - startedAt);
  const rawText = result.data.text || "";
  const classification = classifySingleDigit(rawText);
  const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : null;

  console.log("[ocr] cell result", {
    rawText,
    classification,
    confidence,
    elapsedMs,
    width: canvasElement.width,
    height: canvasElement.height
  });

  return {
    rawText,
    ...classification,
    confidence,
    elapsedMs
  };
}
