import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { runOcrFromCanvas } from "./ocr.js";

const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const runOcrButton = document.getElementById("runOcrButton");
const cameraPreview = document.getElementById("cameraPreview");
const captureCanvas = document.getElementById("captureCanvas");
const processedCanvas = document.getElementById("processedCanvas");
const statusMessage = document.getElementById("statusMessage");
const rawOcrResult = document.getElementById("rawOcrResult");
const digitsOnlyResult = document.getElementById("digitsOnlyResult");

let hasCapturedImage = false;

function setStatus(message) {
  statusMessage.textContent = message;
  console.log("[app] status", message);
}

function drawCanvasPlaceholder() {
  const width = 720;
  const height = 960;
  drawPlaceholder(
    captureCanvas,
    width,
    height,
    "撮影画像がここに表示されます",
    "カメラ開始後に撮影してください"
  );
  drawPlaceholder(
    processedCanvas,
    width,
    height,
    "OCR前処理画像がここに表示されます",
    "OCR実行時に自動で生成されます"
  );
}

function drawPlaceholder(canvas, width, height, title, subtitle) {
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#efe4d5";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#7b6856";
  context.textAlign = "center";
  context.font = "bold 28px sans-serif";
  context.fillText(title, width / 2, height / 2 - 10);
  context.font = "20px sans-serif";
  context.fillText(subtitle, width / 2, height / 2 + 28);
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  setStatus("カメラを起動しています...");

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setStatus("カメラを起動しました。ナンプレ問題を映して撮影してください。");
  } catch (error) {
    console.error("[app] カメラ起動失敗", error);
    setStatus(error instanceof Error ? error.message : "カメラの起動に失敗しました。");
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    const imageDataUrl = captureFrame(cameraPreview, captureCanvas);
    hasCapturedImage = true;
    runOcrButton.disabled = false;
    drawPlaceholder(
      processedCanvas,
      captureCanvas.width,
      captureCanvas.height,
      "OCR前処理画像がここに表示されます",
      "OCR実行時に白黒化とコントラスト調整を行います"
    );
    rawOcrResult.textContent = "まだ実行していません。";
    digitsOnlyResult.textContent = "まだ実行していません。";
    console.log("[app] captured image data url length", imageDataUrl.length);
    setStatus("撮影しました。続けてOCRを実行してください。");
  } catch (error) {
    console.error("[app] 撮影失敗", error);
    setStatus(error instanceof Error ? error.message : "撮影に失敗しました。");
  }
}

async function handleRunOcr() {
  if (!hasCapturedImage) {
    setStatus("先に撮影してください。");
    return;
  }

  runOcrButton.disabled = true;
  setStatus("OCRを実行しています。前処理後の画像で認識します。");

  try {
    const { rawText, digitsOnly } = await runOcrFromCanvas(captureCanvas, processedCanvas);
    rawOcrResult.textContent = rawText.trim() || "（認識文字なし）";
    digitsOnlyResult.textContent = digitsOnly || "（数字抽出なし）";
    setStatus("OCRが完了しました。結果を確認してください。");
  } catch (error) {
    console.error("[app] OCR失敗", error);
    rawOcrResult.textContent = "（OCR失敗）";
    digitsOnlyResult.textContent = "（OCR失敗）";
    setStatus(error instanceof Error ? error.message : "OCRの実行に失敗しました。");
  } finally {
    runOcrButton.disabled = false;
  }
}

drawCanvasPlaceholder();

startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
runOcrButton.addEventListener("click", handleRunOcr);

window.addEventListener("beforeunload", () => {
  stopCamera(cameraPreview);
});
