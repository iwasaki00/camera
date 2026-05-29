import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { runOcrFromCanvas } from "./ocr.js";

const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const runOcrButton = document.getElementById("runOcrButton");
const cameraPreview = document.getElementById("cameraPreview");
const captureCanvas = document.getElementById("captureCanvas");
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
  captureCanvas.width = width;
  captureCanvas.height = height;

  const context = captureCanvas.getContext("2d");
  context.fillStyle = "#efe4d5";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#7b6856";
  context.textAlign = "center";
  context.font = "bold 28px sans-serif";
  context.fillText("Captured image preview", width / 2, height / 2 - 10);
  context.font = "20px sans-serif";
  context.fillText("Capture after starting camera", width / 2, height / 2 + 28);
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  setStatus("Starting camera...");

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setStatus("Camera started. Point it at a Sudoku puzzle and capture.");
  } catch (error) {
    console.error("[app] failed to start camera", error);
    setStatus(error instanceof Error ? error.message : "Failed to start camera.");
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    const imageDataUrl = captureFrame(cameraPreview, captureCanvas);
    hasCapturedImage = true;
    runOcrButton.disabled = false;
    rawOcrResult.textContent = "Not run yet.";
    digitsOnlyResult.textContent = "Not run yet.";
    console.log("[app] captured image data url length", imageDataUrl.length);
    setStatus("Image captured. Run OCR next.");
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : "Failed to capture image.");
  }
}

async function handleRunOcr() {
  if (!hasCapturedImage) {
    setStatus("Capture an image first.");
    return;
  }

  runOcrButton.disabled = true;
  setStatus("Running OCR. This may take a few seconds.");

  try {
    const { rawText, digitsOnly } = await runOcrFromCanvas(captureCanvas);
    rawOcrResult.textContent = rawText.trim() || "(no text recognized)";
    digitsOnlyResult.textContent = digitsOnly || "(no digits found)";
    setStatus("OCR complete. Check the results below.");
  } catch (error) {
    console.error("[app] OCR failed", error);
    rawOcrResult.textContent = "(OCR failed)";
    digitsOnlyResult.textContent = "(OCR failed)";
    setStatus(error instanceof Error ? error.message : "OCR failed.");
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
