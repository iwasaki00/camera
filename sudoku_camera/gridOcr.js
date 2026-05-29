const GRID_SIZE = 9;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

export function drawBoardGridOverlay(canvas) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 247, 239, 0.95)";

  for (let index = 0; index <= GRID_SIZE; index += 1) {
    const position = (canvas.width / GRID_SIZE) * index;
    context.beginPath();
    context.lineWidth = index % 3 === 0 ? 3 : 1.25;
    context.moveTo(position, 0);
    context.lineTo(position, canvas.height);
    context.stroke();

    context.beginPath();
    context.lineWidth = index % 3 === 0 ? 3 : 1.25;
    context.moveTo(0, position);
    context.lineTo(canvas.width, position);
    context.stroke();
  }
}
