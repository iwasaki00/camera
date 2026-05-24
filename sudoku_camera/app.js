import { solveSudoku } from "./sudokuSolver.js";
import { initializeCamera, captureBoardImage, shutdownCamera } from "./camera.js";
import { detectSudokuBoard, ensureOpenCvReady } from "./imageProcessor.js";

const GRID_SIZE = 9;

const sudokuGrid = document.getElementById("sudokuGrid");
const sudokuForm = document.getElementById("sudokuForm");
const clearButton = document.getElementById("clearButton");
const message = document.getElementById("message");
const boardState = document.getElementById("boardState");
const startCameraButton = document.getElementById("startCameraButton");
const captureButton = document.getElementById("captureButton");
const detectBoardButton = document.getElementById("detectBoardButton");
const cameraPreview = document.getElementById("cameraPreview");
const capturedCanvas = document.getElementById("capturedCanvas");
const detectedBoardCanvas = document.getElementById("detectedBoardCanvas");
const cameraMessage = document.getElementById("cameraMessage");
const cameraState = document.getElementById("cameraState");

const cells = [];

function setMessage(text, tone = "") {
  message.textContent = text;
  message.classList.remove("is-error", "is-success");
  if (tone) {
    message.classList.add(tone);
  }
}

function setBoardState(text) {
  boardState.textContent = text;
}

function setCameraMessage(text, tone = "") {
  cameraMessage.textContent = text;
  cameraMessage.classList.remove("is-error", "is-success");
  if (tone) {
    cameraMessage.classList.add(tone);
  }
}

function setCameraState(text) {
  cameraState.textContent = text;
}

function sanitizeCellValue(value) {
  return value.replace(/[^1-9]/g, "").slice(0, 1);
}

function updateCellStyle(input, { solved = false } = {}) {
  const hasValue = input.value !== "";
  input.classList.toggle("is-filled", hasValue);
  input.classList.toggle("is-solved", hasValue && solved);
}

function buildGrid() {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowCells = [];

    for (let col = 0; col < GRID_SIZE; col += 1) {
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.enterKeyHint = "next";
      input.maxLength = 1;
      input.className = "cell";
      input.setAttribute("aria-label", `${row + 1}行${col + 1}列`);
      input.dataset.row = String(row);
      input.dataset.col = String(col);

      if ((col + 1) % 3 === 0 && col !== GRID_SIZE - 1) {
        input.classList.add("box-right");
      }
      if ((row + 1) % 3 === 0 && row !== GRID_SIZE - 1) {
        input.classList.add("box-bottom");
      }

      input.addEventListener("input", () => {
        input.value = sanitizeCellValue(input.value);
        updateCellStyle(input);
        setBoardState("入力中");
        setMessage("数字を入力して「解く」を押してください。");
      });

      input.addEventListener("keydown", (event) => {
        const rowIndex = Number(input.dataset.row);
        const colIndex = Number(input.dataset.col);
        const keyToOffset = {
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1]
        };

        if (event.key in keyToOffset) {
          event.preventDefault();
          const [rowOffset, colOffset] = keyToOffset[event.key];
          const nextRow = rowIndex + rowOffset;
          const nextCol = colIndex + colOffset;
          if (nextRow >= 0 && nextRow < GRID_SIZE && nextCol >= 0 && nextCol < GRID_SIZE) {
            cells[nextRow][nextCol].focus();
          }
        }
      });

      sudokuGrid.appendChild(input);
      rowCells.push(input);
    }

    cells.push(rowCells);
  }
}

function readBoardFromInputs() {
  return cells.map((row) =>
    row.map((input) => {
      const value = Number(input.value);
      return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 0;
    })
  );
}

function writeBoardToInputs(board, originalBoard) {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const input = cells[row][col];
      const value = board[row][col];
      input.value = value === 0 ? "" : String(value);
      const isSolvedValue = originalBoard[row][col] === 0 && value !== 0;
      updateCellStyle(input, { solved: isSolvedValue });
    }
  }
}

function clearBoard() {
  for (const row of cells) {
    for (const input of row) {
      input.value = "";
      updateCellStyle(input);
    }
  }

  setBoardState("入力待ち");
  setMessage("盤面をクリアしました。");
}

function drawPlaceholder(canvas, title, subtitle, ratio = 1) {
  const width = 900;
  const height = Math.round(width / ratio);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#f3e4d7";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#866655";
  context.textAlign = "center";
  context.font = "bold 34px 'Hiragino Sans', 'Yu Gothic', sans-serif";
  context.fillText(title, width / 2, height / 2 - 18);
  context.font = "24px 'Hiragino Sans', 'Yu Gothic', sans-serif";
  context.fillText(subtitle, width / 2, height / 2 + 30);
  canvas.classList.add("is-empty");
}

function initializeCanvasPlaceholders() {
  drawPlaceholder(
    capturedCanvas,
    "撮影画像はここに表示されます",
    "カメラ起動後に「撮影」を押してください"
  );
  drawPlaceholder(
    detectedBoardCanvas,
    "補正後の盤面はここに表示されます",
    "撮影後に「盤面検出」を押してください"
  );
}

async function handleStartCamera() {
  startCameraButton.disabled = true;
  setCameraState("起動中");
  setCameraMessage("カメラを起動しています。初回は権限許可が必要です。");

  try {
    await initializeCamera(cameraPreview);
    captureButton.disabled = false;
    setCameraState("プレビュー中");
    setCameraMessage("カメラ映像を表示しています。「撮影」で静止画を取得できます。");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "カメラを起動できませんでした。";
    setCameraState("利用不可");
    setCameraMessage(errorMessage, "is-error");
  } finally {
    startCameraButton.disabled = false;
  }
}

function handleCapture() {
  try {
    captureBoardImage(cameraPreview, capturedCanvas);
    capturedCanvas.classList.remove("is-empty");
    detectBoardButton.disabled = false;
    setCameraState("撮影完了");
    setCameraMessage("撮影画像を表示しました。続けて「盤面検出」を実行できます。", "is-success");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "撮影に失敗しました。";
    setCameraState("撮影失敗");
    setCameraMessage(errorMessage, "is-error");
  }
}

async function handleDetectBoard() {
  detectBoardButton.disabled = true;
  setCameraState("検出準備中");
  setCameraMessage("盤面検出エンジンを読み込んでいます。初回は少し時間がかかります。");

  try {
    await ensureOpenCvReady();
    setCameraState("検出中");
    setCameraMessage("盤面の外枠を検出しています。");
    await detectSudokuBoard(capturedCanvas, detectedBoardCanvas);
    detectedBoardCanvas.classList.remove("is-empty");
    setCameraState("検出完了");
    setCameraMessage("盤面を検出し、正方形に補正しました。", "is-success");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "盤面を検出できませんでした";
    setCameraState("検出失敗");
    setCameraMessage(errorMessage, "is-error");
  } finally {
    detectBoardButton.disabled = false;
  }
}

function handleSolve(event) {
  event.preventDefault();

  const inputBoard = readBoardFromInputs();
  const solvedBoard = solveSudoku(inputBoard);

  if (!solvedBoard) {
    setBoardState("解答不可");
    setMessage("この盤面は解けません。入力値の矛盾を確認してください。", "is-error");
    return;
  }

  writeBoardToInputs(solvedBoard, inputBoard);
  setBoardState("解答完了");
  setMessage("解答を表示しました。青色の数字が自動で埋めたマスです。", "is-success");
}

buildGrid();
initializeCanvasPlaceholders();

sudokuForm.addEventListener("submit", handleSolve);
clearButton.addEventListener("click", clearBoard);
startCameraButton.addEventListener("click", handleStartCamera);
captureButton.addEventListener("click", handleCapture);
detectBoardButton.addEventListener("click", handleDetectBoard);

window.addEventListener("beforeunload", () => {
  shutdownCamera(cameraPreview);
});
