function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function isDigitInRange(value) {
  return Number.isInteger(value) && value >= 0 && value <= 9;
}

export function normalizeBoard(board) {
  if (!Array.isArray(board) || board.length !== 9) {
    throw new Error("盤面は9x9である必要があります。");
  }

  return board.map((row) => {
    if (!Array.isArray(row) || row.length !== 9) {
      throw new Error("盤面は9x9である必要があります。");
    }

    return row.map((value) => {
      const normalized = Number(value) || 0;
      if (!isDigitInRange(normalized)) {
        throw new Error("盤面には0から9の数字だけを入れてください。");
      }
      return normalized;
    });
  });
}

export function isPlacementValid(board, row, col, value) {
  for (let index = 0; index < 9; index += 1) {
    if (board[row][index] === value && index !== col) {
      return false;
    }
    if (board[index][col] === value && index !== row) {
      return false;
    }
  }

  const boxRowStart = Math.floor(row / 3) * 3;
  const boxColStart = Math.floor(col / 3) * 3;

  for (let r = boxRowStart; r < boxRowStart + 3; r += 1) {
    for (let c = boxColStart; c < boxColStart + 3; c += 1) {
      if (board[r][c] === value && (r !== row || c !== col)) {
        return false;
      }
    }
  }

  return true;
}

export function isBoardValid(board) {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const value = board[row][col];
      if (value !== 0 && !isPlacementValid(board, row, col, value)) {
        return false;
      }
    }
  }

  return true;
}

function findEmptyCell(board) {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (board[row][col] === 0) {
        return [row, col];
      }
    }
  }

  return null;
}

function solveRecursive(board) {
  const emptyCell = findEmptyCell(board);
  if (!emptyCell) {
    return true;
  }

  const [row, col] = emptyCell;
  for (let value = 1; value <= 9; value += 1) {
    if (!isPlacementValid(board, row, col, value)) {
      continue;
    }

    board[row][col] = value;
    if (solveRecursive(board)) {
      return true;
    }
    board[row][col] = 0;
  }

  return false;
}

export function solveSudoku(inputBoard) {
  const normalizedBoard = normalizeBoard(inputBoard);
  if (!isBoardValid(normalizedBoard)) {
    return null;
  }

  const workingBoard = cloneBoard(normalizedBoard);
  return solveRecursive(workingBoard) ? workingBoard : null;
}
