let workerPromise = null;

async function getWorker() {
  if (!window.Tesseract) {
    throw new Error("Tesseract.js failed to load.");
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

export async function runOcrFromCanvas(canvasElement) {
  const worker = await getWorker();

  console.log("[ocr] starting OCR", {
    width: canvasElement.width,
    height: canvasElement.height
  });

  const result = await worker.recognize(canvasElement);
  const rawText = result.data.text || "";
  const digitsOnly = getDigitsOnlyLines(rawText);

  console.log("[ocr] raw text", rawText);
  console.log("[ocr] digits only", digitsOnly);

  return {
    rawText,
    digitsOnly
  };
}
