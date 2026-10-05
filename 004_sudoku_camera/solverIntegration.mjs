import { solveSudoku } from "./sudokuSolver.js";

const DUPLICATE_ISSUES = new Set([
  "duplicate-row",
  "duplicate-column",
  "duplicate-block"
]);

function normalizedValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 9 ? number : 0;
}

export function createOriginalPuzzle(cells) {
  if (!Array.isArray(cells) || cells.length !== 81) {
    throw new Error("Solverには81セルが必要です。");
  }
  return cells.map((cell) => normalizedValue(cell?.value ?? cell));
}

export function toSolverBoard(values) {
  const puzzle = createOriginalPuzzle(values);
  return Array.from({ length: 9 }, (_, row) => puzzle.slice(row * 9, row * 9 + 9));
}

export function getSolveGate(issuesByCell) {
  const issues = Array.isArray(issuesByCell) ? issuesByCell.flat() : [];
  if (issues.some((issue) => DUPLICATE_ISSUES.has(issue))) return "blocked";
  if (issues.includes("low-confidence")) return "confirm";
  return "ready";
}

function isCompleteGroup(values) {
  return values.length === 9
    && values.every((value) => Number.isInteger(value) && value >= 1 && value <= 9)
    && new Set(values).size === 9;
}

export function validateSolvedGrid(solution, originalPuzzle) {
  if (!Array.isArray(solution) || solution.length !== 81) {
    return { valid: false, reason: "解答が81セルではありません。" };
  }
  if (!Array.isArray(originalPuzzle) || originalPuzzle.length !== 81) {
    return { valid: false, reason: "元問題が81セルではありません。" };
  }

  for (let row = 0; row < 9; row += 1) {
    if (!isCompleteGroup(solution.slice(row * 9, row * 9 + 9))) {
      return { valid: false, reason: `${row + 1}行目が不正です。` };
    }
  }

  for (let col = 0; col < 9; col += 1) {
    const values = Array.from({ length: 9 }, (_, row) => solution[row * 9 + col]);
    if (!isCompleteGroup(values)) return { valid: false, reason: `${col + 1}列目が不正です。` };
  }

  for (let blockRow = 0; blockRow < 3; blockRow += 1) {
    for (let blockCol = 0; blockCol < 3; blockCol += 1) {
      const values = [];
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          values.push(solution[(blockRow * 3 + row) * 9 + blockCol * 3 + col]);
        }
      }
      if (!isCompleteGroup(values)) return { valid: false, reason: "3×3ブロックが不正です。" };
    }
  }

  for (let index = 0; index < 81; index += 1) {
    const clue = normalizedValue(originalPuzzle[index]);
    if (clue !== 0 && solution[index] !== clue) {
      return { valid: false, reason: "問題数字が解答で変更されています。" };
    }
  }

  return { valid: true, reason: "" };
}

export function solvePuzzle(values) {
  const originalPuzzle = createOriginalPuzzle(values);
  const startedAt = performance.now();
  // The existing solver returns one solution. Uniqueness is not checked in this phase.
  const solvedBoard = solveSudoku(toSolverBoard(originalPuzzle));
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;

  if (!solvedBoard) return { status: "unsolved", originalPuzzle, solution: null, elapsedMs };

  const solution = solvedBoard.flat();
  const verification = validateSolvedGrid(solution, originalPuzzle);
  if (!verification.valid) {
    return {
      status: "invalid-solution",
      originalPuzzle,
      solution: null,
      elapsedMs,
      reason: verification.reason
    };
  }

  return { status: "solved", originalPuzzle, solution, elapsedMs };
}

