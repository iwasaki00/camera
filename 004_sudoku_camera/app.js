import { captureGuideArea, hasLiveCameraStream, startCamera, stopCamera } from "./camera.js";

const cameraSection = document.getElementById("cameraSection");
const resultSection = document.getElementById("resultSection");
const cameraStage = document.getElementById("cameraStage");
const cameraPreview = document.getElementById("cameraPreview");
const cameraGuide = document.getElementById("cameraGuide");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const cameraState = document.getElementById("cameraState");
const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const retakeButton = document.getElementById("retakeButton");
const croppedCanvas = document.getElementById("croppedCanvas");
const statusMessage = document.getElementById("statusMessage");

function setStatus(message) {
  statusMessage.textContent = message;
  console.log("[app] status", message);
}

function setCameraActive(active) {
  cameraPlaceholder.hidden = active;
  cameraState.textContent = active ? "起動中" : "未起動";
  cameraState.classList.toggle("active", active);
  startCameraButton.textContent = active ? "カメラを再起動" : "カメラ開始";
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  captureButton.disabled = true;
  setStatus("カメラを起動しています…");

  try {
    await startCamera(cameraPreview);
    captureButton.disabled = false;
    setCameraActive(true);
    setStatus("盤面をガイドに合わせて「読み取り」を押してください。");
  } catch (error) {
    console.error("[app] start camera failed", error);
    setCameraActive(false);
    setStatus(error instanceof Error ? error.message : "カメラの起動に失敗しました。");
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    captureGuideArea(cameraPreview, cameraGuide, croppedCanvas, 900);
    cameraSection.hidden = true;
    resultSection.hidden = false;
    setStatus("切り出し結果を確認してください。ずれている場合は「再撮影」で戻れます。");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("[app] capture failed", error);
    setStatus(error instanceof Error ? error.message : "画像の切り出しに失敗しました。");
  }
}

function handleRetake() {
  resultSection.hidden = true;
  cameraSection.hidden = false;

  const streamIsLive = hasLiveCameraStream(cameraPreview);
  setCameraActive(streamIsLive);
  captureButton.disabled = !streamIsLive;
  setStatus(
    streamIsLive
      ? "カメラは起動したままです。盤面を合わせ直して「読み取り」を押してください。"
      : "カメラが停止しています。「カメラ開始」を押してください。"
  );
  cameraStage.scrollIntoView({ behavior: "smooth", block: "center" });
}

startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
retakeButton.addEventListener("click", handleRetake);

window.addEventListener("pagehide", () => {
  stopCamera(cameraPreview);
});
