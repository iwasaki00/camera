import { solveSudoku } from "./sudokuSolver.js";
import { initializeCamera, captureBoardImage } from "./camera.js";
import { recognizeSudokuGrid, extractSudokuDigits } from "./ocr.js";

const GRID_SIZE = 9;

const sudokuGrid = document.getElementById("sudokuGrid");
const sudokuForm = document.getElementById("sudokuForm");
const clearButton = document.getElementById("clearButton");
const message = document.getElementById("message");
const boardState = document.getElementById("boardState");

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

function initializeStubs() {
  initializeCamera();
  captureBoardImage();
  recognizeSudokuGrid();
  extractSudokuDigits();
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
initializeStubs();

sudokuForm.addEventListener("submit", handleSolve);
clearButton.addEventListener("click", clearBoard);
