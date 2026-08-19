import { SAMPLE_COUNT, MODE_LABELS, VISIBILITY } from "./config.js";
import { CameraController } from "./camera.js";
import { PoseDetector } from "./pose.js";
import { averageFrames } from "./utils.js";
import { analyzePose } from "./analysis.js";
import { Renderer } from "./draw.js";
import { deleteRecord, getRecords, saveRecord } from "./storage.js";
import { renderCompare, renderHistory, renderResult } from "./ui.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const video = $("#camera");
const uploadedImage = $("#uploadedImage");
const imageInput = $("#imageInput");
const stage = $("#stage");
const camera = new CameraController(video);
const pose = new PoseDetector();
const renderer = new Renderer($("#overlay"), video);

let mode = "front";
let landmarks = [];
let frames = [];
let running = false;
let fileMode = false;
let imageObjectUrl = null;
let lastTick = performance.now();
let frameCount = 0;
let current = null;

function setStatus(text, live = false) {
  $("#statusText").textContent = text;
  $("#statusPill").classList.toggle("live", live);
}

function setInstruction(text) {
  $("#instructionText").textContent = text;
}

function poseReady(points) {
  return points.length === 33
    && [0, 11, 12, 23, 24, 25, 26, 27, 28]
      .every((index) => (points[index].visibility ?? 0) > VISIBILITY);
}

async function ensureDetector() {
  if (!pose.landmarker) await pose.init();
}

function showCameraSource() {
  fileMode = false;
  uploadedImage.hidden = true;
  video.hidden = false;
  renderer.setSource(video);
  $("#resetButton").innerHTML = "<span>↺</span>再解析";
}

async function start() {
  try {
    $("#startCamera").disabled = true;
    setStatus("AIを準備中…");
    setInstruction("カメラの使用を許可してください");
    await Promise.all([camera.start(), ensureDetector()]);
    await pose.prepareVideo();
    showCameraSource();
    running = true;
    $("#emptyState").classList.add("hidden");
    $("#guide").classList.add("visible");
    $("#flipCamera").disabled = false;
    $("#analyzeButton").disabled = false;
    $("#resetButton").disabled = false;
    setStatus("検出中", true);
    loop();
  } catch (error) {
    setStatus("開始できません");
    setInstruction(
      location.protocol !== "https:" && location.hostname !== "localhost"
        ? "カメラにはHTTPS環境が必要です"
        : error.name === "NotAllowedError"
          ? "設定からカメラの使用を許可してください"
          : error.message,
    );
    $("#startCamera").disabled = false;
  }
}

function loop(now = performance.now()) {
  if (!running || fileMode) return;
  const detected = pose.detect(video, now);
  if (detected) {
    frameCount += 1;
    landmarks = detected;
    const ready = poseReady(detected);
    frames = ready ? [...frames.slice(-(SAMPLE_COUNT - 1)), detected] : [];
    setStatus(ready ? "姿勢を検出" : "全身を確認中", true);
    setInstruction(
      ready
        ? "姿勢を止めて「解析」をタップ"
        : "少し後ろに下がり、全身を映してください",
    );
    $("#debugDetected").textContent = ready ? "検出" : "未検出";
    $("#debugPoints").textContent = detected
      .filter((point) => (point.visibility ?? 0) > VISIBILITY).length;
  }
  renderer.draw(landmarks);
  if (now - lastTick > 1000) {
    $("#debugFps").textContent = Math.round(frameCount * 1000 / (now - lastTick));
    frameCount = 0;
    lastTick = now;
  }
  requestAnimationFrame(loop);
}

function presentAnalysis(points) {
  current = analyzePose(points, mode);
  renderer.result = current;
  renderer.draw(points);
  $("#scoreValue").textContent = current.score;
  $("#scoreComment").textContent = current.comment;
  renderResult($("#resultList"), current);
  if (!$("#resultDialog").open) $("#resultDialog").showModal();
  setStatus(fileMode ? "画像の解析完了" : "解析完了", true);
  setInstruction("結果を確認できます");
}

function analyze() {
  if (fileMode) {
    if (!poseReady(landmarks)) {
      setInstruction("全身が写った画像を選び直してください");
      return;
    }
    presentAnalysis(landmarks);
    return;
  }
  if (frames.length < Math.min(5, SAMPLE_COUNT)) {
    setInstruction("姿勢を止めたまま、もう一度タップしてください");
    return;
  }
  presentAnalysis(averageFrames(frames));
}

async function loadImage(file) {
  if (!file) return;
  imageInput.value = "";
  if (!file.type.startsWith("image/")) {
    setInstruction("画像ファイルを選択してください");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setInstruction("20MB以下の画像を選択してください");
    return;
  }

  running = false;
  fileMode = true;
  frames = [];
  landmarks = [];
  current = null;
  renderer.result = null;
  $("#resetButton").disabled = false;
  $("#resetButton").innerHTML = "<span>◉</span>カメラ";
  stage.classList.add("image-loading");
  setStatus("画像を読み込み中…", true);
  setInstruction("AIモデルを準備しています");

  try {
    await ensureDetector();
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = URL.createObjectURL(file);
    uploadedImage.src = imageObjectUrl;
    uploadedImage.hidden = false;
    video.hidden = true;
    await uploadedImage.decode();

    renderer.setSource(uploadedImage);
    $("#emptyState").classList.add("hidden");
    $("#guide").classList.remove("visible");
    $("#flipCamera").disabled = true;
    $("#resetButton").disabled = false;
    $("#resetButton").innerHTML = "<span>◉</span>カメラ";
    setStatus("画像を解析中…", true);
    setInstruction("全身の関節位置を検出しています");

    landmarks = await pose.detectImage(uploadedImage);
    $("#debugDetected").textContent = poseReady(landmarks) ? "検出" : "未検出";
    $("#debugFps").textContent = "静止画";
    $("#debugPoints").textContent = landmarks
      .filter((point) => (point.visibility ?? 0) > VISIBILITY).length;

    if (!poseReady(landmarks)) {
      renderer.draw(landmarks);
      $("#analyzeButton").disabled = true;
      setStatus("全身を検出できませんでした");
      setInstruction("頭から足先まで写った明るい画像を選び直してください");
      return;
    }

    $("#analyzeButton").disabled = false;
    presentAnalysis(landmarks);
  } catch (error) {
    setStatus("画像を解析できませんでした");
    setInstruction(error.message || "別の画像を選択してください");
  } finally {
    stage.classList.remove("image-loading");
  }
}

function chooseImage() {
  imageInput.click();
}

async function reset() {
  frames = [];
  current = null;
  renderer.result = null;

  if (fileMode) {
    landmarks = [];
    showCameraSource();
    if (camera.stream) {
      await pose.prepareVideo();
      $("#guide").classList.add("visible");
      $("#flipCamera").disabled = false;
      $("#analyzeButton").disabled = false;
      running = true;
      setStatus("検出中", true);
      setInstruction("姿勢を止めて「解析」をタップ");
      loop();
    } else {
      $("#emptyState").classList.remove("hidden");
      $("#analyzeButton").disabled = true;
      $("#resetButton").disabled = true;
      setStatus("カメラ未起動");
      setInstruction("カメラを開始するか、画像を選択してください");
    }
    renderer.draw([]);
    return;
  }

  setStatus("検出中", true);
  setInstruction("姿勢を止めて「解析」をタップ");
}

function loadHistory() {
  const records = getRecords();
  renderHistory($("#historyList"), records);
  $("#comparePanel").hidden = true;
  $("#historyDialog").showModal();
}

$("#startCamera").addEventListener("click", start);
$("#imageButton").addEventListener("click", chooseImage);
$("#imageButtonTop").addEventListener("click", chooseImage);
$("#imageButtonStart").addEventListener("click", chooseImage);
imageInput.addEventListener("change", () => loadImage(imageInput.files?.[0]));

$("#flipCamera").addEventListener("click", async () => {
  if (fileMode) return;
  running = false;
  await camera.flip();
  running = true;
  loop();
});
$("#analyzeButton").addEventListener("click", analyze);
$("#resetButton").addEventListener("click", reset);

$$('[data-mode]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-mode]').forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  mode = button.dataset.mode;
  frames = [];
  current = null;
  renderer.result = null;
  if (fileMode && poseReady(landmarks)) {
    renderer.draw(landmarks);
    setInstruction(`${MODE_LABELS[mode]}として「解析」をタップしてください`);
  } else {
    setInstruction(`${MODE_LABELS[mode]}をカメラへ向けてください`);
  }
}));

$$('[data-toggle]').forEach((button) => button.addEventListener("click", () => {
  button.classList.toggle("active");
  renderer.flags[button.dataset.toggle] = button.classList.contains("active");
  renderer.draw(landmarks);
}));

$("#debugToggle").addEventListener("click", () => {
  $("#debug").hidden = !$("#debug").hidden;
});
$("#historyButton").addEventListener("click", loadHistory);
$$('[data-close]').forEach((button) => button.addEventListener("click", () => {
  $(button.dataset.close === "result" ? "#resultDialog" : "#historyDialog").close();
}));

$("#saveButton").addEventListener("click", () => {
  if (!current) return;
  const saved = saveRecord({
    ...current,
    source: fileMode ? "image" : "camera",
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    date: new Date().toISOString(),
  });
  $("#saveButton").textContent = saved ? "保存しました" : "保存できませんでした";
  setTimeout(() => { $("#saveButton").textContent = "結果を保存"; }, 1300);
});

$("#historyList").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    event.preventDefault();
    renderHistory($("#historyList"), deleteRecord(deleteButton.dataset.delete));
    return;
  }
  const ids = $$('[data-compare]:checked').map((item) => item.dataset.compare);
  if (ids.length > 2) {
    event.target.checked = false;
    return;
  }
  if (ids.length === 2) {
    const records = getRecords()
      .filter((record) => ids.includes(record.id))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    renderCompare($("#compareTable"), records);
    $("#comparePanel").hidden = false;
  } else {
    $("#comparePanel").hidden = true;
  }
});

window.addEventListener("pagehide", () => {
  camera.stop();
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
});
