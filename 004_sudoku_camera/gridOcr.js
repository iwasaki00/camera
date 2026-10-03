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

  return {
    x: offsetX,
    y: offsetY,
    size: squareSize
  };
}

export function splitBoardIntoCells(boardCanvas, innerCropRate) {
  const cellWidth = boardCanvas.width / GRID_SIZE;
  const cellHeight = boardCanvas.height / GRID_SIZE;
  const cells = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const originalX = Math.round(col * cellWidth);
      const originalY = Math.round(row * cellHeight);
      const originalRight = Math.round((col + 1) * cellWidth);
      const originalBottom = Math.round((row + 1) * cellHeight);
      const originalWidth = originalRight - originalX;
      const originalHeight = originalBottom - originalY;
      const marginX = originalWidth * innerCropRate;
      const marginY = originalHeight * innerCropRate;
      const innerX = clamp(Math.round(originalX + marginX), 0, boardCanvas.width);
      const innerY = clamp(Math.round(originalY + marginY), 0, boardCanvas.height);
      const innerRight = clamp(Math.round(originalRight - marginX), 0, boardCanvas.width);
      const innerBottom = clamp(Math.round(originalBottom - marginY), 0, boardCanvas.height);
      const width = Math.max(1, innerRight - innerX);
      const height = Math.max(1, innerBottom - innerY);

      cells.push({
        row,
        col,
        originalX,
        originalY,
        originalWidth,
        originalHeight,
        sourceX: innerX,
        sourceY: innerY,
        sourceWidth: width,
        sourceHeight: height
      });
    }
  }

  return cells;
}

export function drawOriginalCell(boardCanvas, cell, outputCanvas) {
  return drawCanvasRegion(
    boardCanvas,
    outputCanvas,
    cell.originalX,
    cell.originalY,
    cell.originalWidth,
    cell.originalHeight
  );
}

function drawCanvasRegion(sourceCanvas, outputCanvas, x, y, width, height) {
  outputCanvas.width = width;
  outputCanvas.height = height;

  const context = outputCanvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return outputCanvas;
}

export function drawCellCrop(boardCanvas, cell, outputCanvas) {
  return drawCanvasRegion(
    boardCanvas,
    outputCanvas,
    cell.sourceX,
    cell.sourceY,
    cell.sourceWidth,
    cell.sourceHeight
  );
}

export function createEmptyBoard() {
  return Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => ""));
}
