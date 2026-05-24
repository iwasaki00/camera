const OUTPUT_SIZE = 450;
const HANDLE_RADIUS = 22;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distanceSquared(point, x, y) {
  const dx = point.x - x;
  const dy = point.y - y;
  return dx * dx + dy * dy;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < size; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) {
        pivotRow = row;
      }
    }

    if (Math.abs(augmented[pivotRow][col]) < 1e-8) {
      throw new Error("変換行列を計算できませんでした。四隅の位置を調整してください。");
    }

    [augmented[col], augmented[pivotRow]] = [augmented[pivotRow], augmented[col]];

    const pivot = augmented[col][col];
    for (let current = col; current <= size; current += 1) {
      augmented[col][current] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === col) {
        continue;
      }

      const factor = augmented[row][col];
      for (let current = col; current <= size; current += 1) {
        augmented[row][current] -= factor * augmented[col][current];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function buildHomography(sourcePoints, destinationPoints) {
  const matrix = [];
  const vector = [];

  for (let index = 0; index < 4; index += 1) {
    const src = sourcePoints[index];
    const dst = destinationPoints[index];

    matrix.push([src.x, src.y, 1, 0, 0, 0, -dst.x * src.x, -dst.x * src.y]);
    vector.push(dst.x);
    matrix.push([0, 0, 0, src.x, src.y, 1, -dst.y * src.x, -dst.y * src.y]);
    vector.push(dst.y);
  }

  const solution = solveLinearSystem(matrix, vector);
  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1]
  ];
}

function invert3x3(matrix) {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i]
  ] = matrix;

  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(determinant) < 1e-8) {
    throw new Error("補正に必要な逆行列を計算できませんでした。四隅を調整してください。");
  }

  const inverseDeterminant = 1 / determinant;

  return [
    [(e * i - f * h) * inverseDeterminant, (c * h - b * i) * inverseDeterminant, (b * f - c * e) * inverseDeterminant],
    [(f * g - d * i) * inverseDeterminant, (a * i - c * g) * inverseDeterminant, (c * d - a * f) * inverseDeterminant],
    [(d * h - e * g) * inverseDeterminant, (b * g - a * h) * inverseDeterminant, (a * e - b * d) * inverseDeterminant]
  ];
}

function applyHomography(matrix, x, y) {
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  };
}

function bilinearSample(imageData, x, y) {
  const { width, height, data } = imageData;
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;

  const topLeftIndex = (y0 * width + x0) * 4;
  const topRightIndex = (y0 * width + x1) * 4;
  const bottomLeftIndex = (y1 * width + x0) * 4;
  const bottomRightIndex = (y1 * width + x1) * 4;

  const rgba = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = data[topLeftIndex + channel] * (1 - tx) + data[topRightIndex + channel] * tx;
    const bottom = data[bottomLeftIndex + channel] * (1 - tx) + data[bottomRightIndex + channel] * tx;
    rgba[channel] = top * (1 - ty) + bottom * ty;
  }

  return rgba;
}

function drawGridOverlay(context, size) {
  context.save();
  context.strokeStyle = "rgba(24, 88, 116, 0.82)";
  context.lineCap = "square";

  for (let index = 1; index < 9; index += 1) {
    const position = (size / 9) * index;

    context.beginPath();
    context.lineWidth = index % 3 === 0 ? 3 : 1;
    context.moveTo(position, 0);
    context.lineTo(position, size);
    context.stroke();

    context.beginPath();
    context.lineWidth = index % 3 === 0 ? 3 : 1;
    context.moveTo(0, position);
    context.lineTo(size, position);
    context.stroke();
  }

  context.lineWidth = 4;
  context.strokeStyle = "rgba(24, 88, 116, 0.92)";
  context.strokeRect(0, 0, size, size);
  context.restore();
}

export function createDefaultCorners(width, height) {
  const insetX = width * 0.14;
  const insetY = height * 0.14;
  return [
    { x: insetX, y: insetY },
    { x: width - insetX, y: insetY },
    { x: width - insetX, y: height - insetY },
    { x: insetX, y: height - insetY }
  ];
}

export function drawCornerEditor({ imageCanvas, overlayCanvas, corners, activeIndex }) {
  overlayCanvas.width = imageCanvas.width;
  overlayCanvas.height = imageCanvas.height;

  const context = overlayCanvas.getContext("2d");
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  context.save();
  context.fillStyle = "rgba(18, 15, 13, 0.14)";
  context.strokeStyle = "rgba(201, 88, 46, 0.95)";
  context.lineWidth = 3;

  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index += 1) {
    context.lineTo(corners[index].x, corners[index].y);
  }
  context.closePath();
  context.fill();
  context.stroke();

  for (let index = 0; index < corners.length; index += 1) {
    const point = corners[index];
    context.beginPath();
    context.fillStyle = index === activeIndex ? "#1f556f" : "#f8f3ed";
    context.strokeStyle = "#c9582e";
    context.lineWidth = 4;
    context.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.restore();
}

export function pickCornerIndex(corners, x, y) {
  let pickedIndex = -1;
  let pickedDistance = HANDLE_RADIUS * HANDLE_RADIUS * 2.2;

  for (let index = 0; index < corners.length; index += 1) {
    const currentDistance = distanceSquared(corners[index], x, y);
    if (currentDistance < pickedDistance) {
      pickedDistance = currentDistance;
      pickedIndex = index;
    }
  }

  return pickedIndex;
}

export function moveCorner(corners, index, x, y, width, height) {
  corners[index].x = clamp(x, 0, width);
  corners[index].y = clamp(y, 0, height);
}

export function warpBoardFromCorners(sourceCanvas, corners, outputCanvas) {
  if (!sourceCanvas.width || !sourceCanvas.height || corners.length !== 4) {
    throw new Error("撮影画像または四隅情報が不足しています。");
  }

  const sourcePoints = [
    corners[0],
    corners[1],
    corners[2],
    corners[3]
  ];
  const destinationPoints = [
    { x: 0, y: 0 },
    { x: OUTPUT_SIZE - 1, y: 0 },
    { x: OUTPUT_SIZE - 1, y: OUTPUT_SIZE - 1 },
    { x: 0, y: OUTPUT_SIZE - 1 }
  ];

  const homography = buildHomography(sourcePoints, destinationPoints);
  const inverseHomography = invert3x3(homography);
  const sourceContext = sourceCanvas.getContext("2d");
  const sourceImageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  outputCanvas.width = OUTPUT_SIZE;
  outputCanvas.height = OUTPUT_SIZE;
  const outputContext = outputCanvas.getContext("2d");
  const outputImageData = outputContext.createImageData(OUTPUT_SIZE, OUTPUT_SIZE);

  for (let y = 0; y < OUTPUT_SIZE; y += 1) {
    for (let x = 0; x < OUTPUT_SIZE; x += 1) {
      const sourcePoint = applyHomography(inverseHomography, x, y);
      const rgba = bilinearSample(sourceImageData, sourcePoint.x, sourcePoint.y);
      const index = (y * OUTPUT_SIZE + x) * 4;
      outputImageData.data[index] = rgba[0];
      outputImageData.data[index + 1] = rgba[1];
      outputImageData.data[index + 2] = rgba[2];
      outputImageData.data[index + 3] = rgba[3];
    }
  }

  outputContext.putImageData(outputImageData, 0, 0);
  drawGridOverlay(outputContext, OUTPUT_SIZE);
}
