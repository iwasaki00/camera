let workerPromise = null;

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

function normalizeDigit(text) {
  const matched = (text || "").replace(/[^1-9]/g, "");
  return matched.slice(0, 1);
}

export async function recognizeSingleDigit(canvasElement) {
  const worker = await getWorker();
  const result = await worker.recognize(canvasElement);
  const rawText = result.data.text || "";
  const digit = normalizeDigit(rawText);

  console.log("[ocr] cell result", {
    rawText,
    digit,
    width: canvasElement.width,
    height: canvasElement.height
  });

  return {
    rawText,
    digit
  };
}
