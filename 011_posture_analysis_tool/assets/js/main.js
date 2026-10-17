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

const pendingUrls = new Set();
function releaseUrls() {
  for (const url of pendingUrls) URL.revokeObjectURL(url);
  pendingUrls.clear();
}
let mode = "front";
let landmarks = [];
let frames = [];
let running = false;
let fileMode = false;
let imageLoading = false;
let cameraStarting = false;
let inputVersion = 0;
let analysisVersion = 0;
let rafId = null;
let loopVersion = 0;
let lastTick = performance.now();
let frameCount = 0;
let current = null;
let currentSource = null;
let savedCurrent = false;

function setStatus(text, live = false) {
  $("#statusText").textContent = text;
  $("#statusPill").classList.toggle("live", live);
}
function setInstruction(text) { $("#instructionText").textContent = text; }

function poseReady(points) {
  return points.length === 33 && points.every((point) => point
    && Number.isFinite(point.x) && Number.isFinite(point.y))
    && [0, 11, 12, 23, 24, 25, 26, 27, 28]
      .every((index) => (points[index].visibility ?? 0) > VISIBILITY);
}

function updateControls() {
  $("#startCamera").disabled = cameraStarting;
  $("#flipCamera").disabled = !running || fileMode || cameraStarting;
  $("#analyzeButton").disabled = imageLoading || cameraStarting || document.hidden
    || !poseReady(landmarks) || (!fileMode && (!running || frames.length < SAMPLE_COUNT));
  $("#resetButton").disabled = cameraStarting || (!fileMode && !running);
}

function clearResult() {
  analysisVersion += 1;
  current = null;
  currentSource = null;
  savedCurrent = false;
  renderer.result = null;
  $("#saveButton").disabled = true;
  $("#saveButton").textContent = "結果を保存";
  $("#resultDialog").close();
}

function clearTracking() {
  frames = [];
  landmarks = [];
  pose.resetVideo();
  frameCount = 0;
  lastTick = performance.now();
  $("#debugDetected").textContent = "未検出";
  $("#debugPoints").textContent = "0";
  $("#debugFps").textContent = "—";
  renderer.draw([]);
}

function stopLoop() {
  running = false;
  loopVersion += 1;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

function beginInput() {
  inputVersion += 1;
  releaseUrls();
  stopLoop();
  camera.stop();
  cameraStarting = false;
  imageLoading = false;
  stage.classList.remove("image-loading");
  clearResult();
  clearTracking();
  $("#guide").classList.remove("visible");
  return inputVersion;
}

function showCameraSource() {
  fileMode = false;
  uploadedImage.hidden = true;
  uploadedImage.removeAttribute("src");
  video.hidden = false;
  renderer.setSource(video);
  $("#resetButton").innerHTML = "<span>↺</span>再解析";
}

async function start(facing = camera.facing) {
  if (cameraStarting || document.hidden) return;
  const version = beginInput();
  showCameraSource();
  cameraStarting = true;
  updateControls();
  setStatus("AIを準備中…");
  setInstruction("カメラの使用を許可してください");
  try {
    await Promise.all([camera.start(facing), pose.init()]);
    if (version !== inputVersion || document.hidden) return;
    await pose.prepareVideo();
    if (version !== inputVersion || document.hidden) return;
    cameraStarting = false;
    running = true;
    $("#emptyState").classList.add("hidden");
    $("#guide").classList.add("visible");
    setStatus("検出中", true);
    updateControls();
    const token = ++loopVersion;
    rafId = requestAnimationFrame((now) => loop(now, token));
  } catch (error) {
    if (version !== inputVersion) return;
    camera.stop();
    stopLoop();
    cameraStarting = false;
    $("#emptyState").classList.remove("hidden");
    setStatus("開始できません");
    setInstruction(
      location.protocol !== "https:" && location.hostname !== "localhost"
        ? "カメラにはHTTPS環境が必要です"
        : error.name === "NotAllowedError"
          ? "設定からカメラの使用を許可してください"
          : error.message,
    );
    updateControls();
  }
}

function loop(now, token) {
  if (token !== loopVersion || !running || fileMode || document.hidden) return;
  rafId = null;
  try {
    const detected = pose.detect(video, now);
    if (detected) {
      frameCount += 1;
      landmarks = detected;
      const ready = poseReady(detected);
      frames = ready ? [...frames.slice(-(SAMPLE_COUNT - 1)), detected] : [];
      setStatus(ready ? "姿勢を検出" : "全身を確認中", true);
      setInstruction(ready ? "姿勢を止めて「解析」をタップ" : "少し後ろに下がり、全身を映してください");
      $("#debugDetected").textContent = ready ? "検出" : "未検出";
      $("#debugPoints").textContent = detected.filter((point) => (point.visibility ?? 0) > VISIBILITY).length;
      updateControls();
    }
    renderer.draw(landmarks);
    if (now - lastTick > 1000) {
      $("#debugFps").textContent = Math.round(frameCount * 1000 / (now - lastTick));
      frameCount = 0;
      lastTick = now;
    }
  } catch (error) {
    suspend();
    setStatus("姿勢検出を停止しました");
    setInstruction(error.message || "カメラを再開してください");
    return;
  }
  if (token === loopVersion && running && !fileMode && !document.hidden) {
    rafId = requestAnimationFrame((time) => loop(time, token));
  }
}

function presentAnalysis(points, snapshot = {
  input: inputVersion, analysis: analysisVersion, mode, source: fileMode ? "image" : "camera",
}) {
  const fixedPoints = points.map((point) => ({ ...point }));
  if (!poseReady(fixedPoints) || document.hidden) return;
  const result = analyzePose(fixedPoints, snapshot.mode);
  if (snapshot.input !== inputVersion || snapshot.analysis !== analysisVersion) return;
  current = result;
  currentSource = snapshot.source;
  savedCurrent = false;
  $("#saveButton").disabled = false;
  $("#saveButton").textContent = "結果を保存";
  renderer.result = result;
  renderer.draw(fixedPoints);
  $("#scoreValue").textContent = result.score;
  $("#scoreComment").textContent = result.comment;
  renderResult($("#resultList"), result);
  if (!$("#resultDialog").open) $("#resultDialog").showModal();
  setStatus(snapshot.source === "image" ? "画像の解析完了" : "解析完了");
  setInstruction("結果を確認できます");
}

function analyze() {
  if (imageLoading || cameraStarting || document.hidden || !poseReady(landmarks)) return;
  if (fileMode) {
    presentAnalysis(landmarks);
  } else if (running && frames.length === SAMPLE_COUNT) {
    presentAnalysis(averageFrames(frames));
  } else {
    setInstruction("姿勢を止めたまま、もう一度タップしてください");
  }
}

async function loadImage(file) {
  if (!file || document.hidden) return;
  imageInput.value = "";
  if (!file.type.startsWith("image/")) {
    setInstruction("画像ファイルを選択してください");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setInstruction("20MB以下の画像を選択してください");
    return;
  }
  const version = beginInput();
  const snapshot = { input: version, analysis: analysisVersion, mode, source: "image" };
  fileMode = true;
  imageLoading = true;
  uploadedImage.hidden = true;
  video.hidden = true;
  uploadedImage.removeAttribute("src");
  $("#emptyState").classList.add("hidden");
  $("#resetButton").innerHTML = "<span>◉</span>カメラ";
  stage.classList.add("image-loading");
  updateControls();
  setStatus("画像を読み込み中…");
  setInstruction("AIモデルを準備しています");
  let url;
  const valid = () => version === inputVersion && !document.hidden;
  try {
    // Each request decodes its own image; a stale decode cannot replace the preview.
    const image = new Image();
    url = URL.createObjectURL(file);
    pendingUrls.add(url);
    image.src = url;
    await image.decode();
    if (!valid()) return;
    await pose.init();
    if (!valid()) return;
    setStatus("画像を解析中…");
    const detected = await pose.detectImage(image, valid);
    if (!valid()) return;
    uploadedImage.src = url;
    await uploadedImage.decode();
    if (!valid()) return;
    uploadedImage.hidden = false;
    renderer.setSource(uploadedImage);
    landmarks = detected;
    imageLoading = false;
    $("#debugDetected").textContent = poseReady(landmarks) ? "検出" : "未検出";
    $("#debugFps").textContent = "静止画";
    $("#debugPoints").textContent = landmarks.filter((point) => (point.visibility ?? 0) > VISIBILITY).length;
    renderer.draw(landmarks);
    if (!poseReady(landmarks)) {
      setStatus("全身を検出できませんでした");
      setInstruction("頭から足先まで写った明るい画像を選び直してください");
    } else if (snapshot.analysis === analysisVersion) {
      presentAnalysis(landmarks, snapshot);
    } else {
      setStatus("画像の検出完了");
      setInstruction(`${MODE_LABELS[mode]}として「解析」をタップしてください`);
    }
  } catch (error) {
    if (!valid()) return;
    setStatus("画像を解析できませんでした");
    setInstruction(error.message || "別の画像を選択してください");
  } finally {
    if (url) {
      URL.revokeObjectURL(url);
      pendingUrls.delete(url);
    }
    if (version === inputVersion) {
      imageLoading = false;
      stage.classList.remove("image-loading");
      updateControls();
    }
  }
}

function reset() {
  if (fileMode) { void start(); return; }
  clearResult();
  clearTracking();
  updateControls();
  setStatus("検出中", true);
  setInstruction("姿勢を止めて「解析」をタップ");
}

function loadHistory() {
  renderHistory($("#historyList"), getRecords());
  $("#historyMessage").textContent = "";
  $("#comparePanel").hidden = true;
  $("#compareTable").replaceChildren();
  if (!$("#historyDialog").open) $("#historyDialog").showModal();
}

$("#startCamera").addEventListener("click", () => { void start(); });
for (const id of ["#imageButton", "#imageButtonTop", "#imageButtonStart"]) {
  $(id).addEventListener("click", () => imageInput.click());
}
imageInput.addEventListener("change", () => { void loadImage(imageInput.files?.[0]); });
$("#flipCamera").addEventListener("click", () => {
  if (!fileMode && running && !cameraStarting) {
    void start(camera.facing === "environment" ? "user" : "environment");
  }
});
$("#analyzeButton").addEventListener("click", analyze);
$("#resetButton").addEventListener("click", reset);

$$("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  $$("[data-mode]").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  mode = button.dataset.mode;
  frames = [];
  clearResult();
  if (!fileMode) landmarks = [];
  renderer.draw(landmarks);
  updateControls();
  setInstruction(fileMode
    ? `${MODE_LABELS[mode]}として「解析」をタップしてください`
    : `${MODE_LABELS[mode]}をカメラへ向けてください`);
}));
$$("[data-toggle]").forEach((button) => button.addEventListener("click", () => {
  button.classList.toggle("active");
  renderer.flags[button.dataset.toggle] = button.classList.contains("active");
  renderer.draw(landmarks);
}));
$("#debugToggle").addEventListener("click", () => { $("#debug").hidden = !$("#debug").hidden; });
$("#historyButton").addEventListener("click", loadHistory);
$$("[data-close]").forEach((button) => button.addEventListener("click", () => {
  $(button.dataset.close === "result" ? "#resultDialog" : "#historyDialog").close();
}));

$("#saveButton").addEventListener("click", () => {
  if (!current || savedCurrent) return;
  $("#saveButton").disabled = true;
  const saved = saveRecord({
    ...current,
    source: currentSource,
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    date: new Date().toISOString(),
  });
  savedCurrent = Boolean(saved);
  $("#saveButton").disabled = savedCurrent;
  $("#saveButton").textContent = saved ? "保存しました" : "保存できませんでした（再試行）";
});

$("#historyList").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    event.preventDefault();
    const records = deleteRecord(deleteButton.dataset.delete);
    if (!records) {
      $("#historyMessage").textContent = "削除できませんでした。もう一度お試しください。";
      return;
    }
    $("#historyMessage").textContent = "削除しました";
    renderHistory($("#historyList"), records);
    $("#comparePanel").hidden = true;
    $("#compareTable").replaceChildren();
    return;
  }
});
$("#historyList").addEventListener("change", (event) => {
  const ids = $$("[data-compare]:checked").map((item) => item.dataset.compare);
  if (ids.length > 2) { event.target.checked = false; return; }
  $("#comparePanel").hidden = true;
  $("#compareTable").replaceChildren();
  if (ids.length === 2) {
    const records = getRecords().filter((record) => ids.includes(record.id))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    if (records.length === 2) {
      renderCompare($("#compareTable"), records);
      $("#comparePanel").hidden = false;
    }
  }
});

function suspend() {
  inputVersion += 1;
  releaseUrls();
  stopLoop();
  camera.stop();
  cameraStarting = false;
  if (!fileMode) {
    // Saved/analysed results remain available; only live tracking is discarded.
    clearTracking();
    $("#emptyState").classList.remove("hidden");
    $("#guide").classList.remove("visible");
    setStatus("カメラ停止中");
    setInstruction("「カメラを開始」で再開できます");
  } else if (imageLoading) {
    imageLoading = false;
    stage.classList.remove("image-loading");
    setStatus("画像の読み込みを中断しました");
    setInstruction("画像を選び直すか、カメラに戻ってください");
  }
  updateControls();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspend();
  else updateControls();
});
window.addEventListener("pagehide", () => { suspend(); pose.close(); });
