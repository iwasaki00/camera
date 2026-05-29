const GRID_SIZE = 9;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function extractSquareBoard(sourceCanvas, outputCanvas, sourceRect) {
  const squareSize = Math.round(Math.min(sourceRect.width, sourceRect.height));
  const offsetX = Math.round(sourceRect.x + (sourceRect.width - squareSize) / 2);
  const offsetY = Math.round(sourceRect.y + (sourceRect.height - squareSize) / 2);

  outputCanvas.width = squareSize;
  outputCanvas.height = squareSize;

  const context = outputCanvas.getContext("2d");
  context.clearRect(0, 0, squareSize, squareSize);
  context.drawImage(
    sourceCanvas,
    offsetX,
    offsetY,
    squareSize,
    squareSize,
    0,
    0,
    squareSize,
    squareSize
  );

  console.log("[grid-ocr] square board extracted", {
    offsetX,
    offsetY,
    squareSize
  });

  return {
    x: offsetX,
    y: offsetY,
    size: squareSize
  };
}

export function splitBoardIntoCells(boardCanvas, innerCropRate) {
  const cellSize = boardCanvas.width / GRID_SIZE;
  const margin = cellSize * innerCropRate;
  const cells = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const baseX = col * cellSize;
      const baseY = row * cellSize;
      const innerX = clamp(Math.round(baseX + margin), 0, boardCanvas.width);
      const innerY = clamp(Math.round(baseY + margin), 0, boardCanvas.height);
      const innerRight = clamp(Math.round(baseX + cellSize - margin), 0, boardCanvas.width);
      const innerBottom = clamp(Math.round(baseY + cellSize - margin), 0, boardCanvas.height);
      const width = Math.max(1, innerRight - innerX);
      const height = Math.max(1, innerBottom - innerY);

      cells.push({
        row,
        col,
        sourceX: innerX,
        sourceY: innerY,
        sourceWidth: width,
        sourceHeight: height
      });
    }
  }

  console.log("[grid-ocr] cells prepared", {
    cellSize,
    innerCropRate,
    margin
  });

  return cells;
}

export function drawCellCrop(boardCanvas, cell, outputCanvas) {
  outputCanvas.width = cell.sourceWidth;
  outputCanvas.height = cell.sourceHeight;

  const context = outputCanvas.getContext("2d");
  context.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  context.drawImage(
    boardCanvas,
    cell.sourceX,
    cell.sourceY,
    cell.sourceWidth,
    cell.sourceHeight,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height
  );

  return outputCanvas;
}

export function createEmptyBoard() {
  return Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => ""));
}
