const OPEN_CV_URL = "https://docs.opencv.org/4.x/opencv.js";
const WARPED_BOARD_SIZE = 450;

let openCvPromise = null;
let openCvStatus = "idle";
const statusListeners = new Set();

function notifyStatus(status) {
  openCvStatus = status;
  for (const listener of statusListeners) {
    listener(status);
  }
}

function sortCorners(points) {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));

  return {
    topLeft: bySum[0],
    bottomRight: bySum[3],
    topRight: byDiff[0],
    bottomLeft: byDiff[3]
  };
}

function contourToPoints(contour) {
  const points = [];
  for (let index = 0; index < contour.data32S.length; index += 2) {
    points.push({
      x: contour.data32S[index],
      y: contour.data32S[index + 1]
    });
  }
  return points;
}

function findLargestQuadrilateral(contours, cv) {
  let bestContour = null;
  let bestArea = 0;

  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index);
    const perimeter = cv.arcLength(contour, true);
    const approximation = new cv.Mat();

    try {
      cv.approxPolyDP(contour, approximation, perimeter * 0.02, true);
      const area = cv.contourArea(approximation);
      const isQuadrilateral = approximation.rows === 4;
      const isConvex = cv.isContourConvex(approximation);

      if (isQuadrilateral && isConvex && area > bestArea) {
        if (bestContour) {
          bestContour.delete();
        }
        bestContour = approximation.clone();
        bestArea = area;
      }
    } finally {
      approximation.delete();
      contour.delete();
    }
  }

  return bestContour;
}

function drawGridOverlay(context, size) {
  context.save();
  context.strokeStyle = "rgba(24, 88, 116, 0.78)";
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
  context.strokeStyle = "rgba(24, 88, 116, 0.88)";
  context.strokeRect(0, 0, size, size);
  context.restore();
}

function attachListener(listener) {
  if (!listener) {
    return () => {};
  }
  statusListeners.add(listener);
  listener(openCvStatus);
  return () => statusListeners.delete(listener);
}

function loadOpenCvScript(resolve, reject) {
  if (window.cv && typeof window.cv.getBuildInformation === "function") {
    notifyStatus("ready");
    resolve(window.cv);
    return;
  }

  const existing = document.querySelector('script[data-opencv-loader="true"]');
  if (existing) {
    notifyStatus("fetching-script");
    existing.addEventListener("load", () => {
      if (window.cv && typeof window.cv.getBuildInformation === "function") {
        notifyStatus("ready");
        resolve(window.cv);
      } else if (window.cv) {
        notifyStatus("initializing-runtime");
        window.cv.onRuntimeInitialized = () => {
          notifyStatus("ready");
          resolve(window.cv);
        };
      } else {
        notifyStatus("error");
        reject(new Error("OpenCV.js の読み込みに失敗しました。"));
      }
    }, { once: true });
    existing.addEventListener("error", () => {
      notifyStatus("error");
      reject(new Error("OpenCV.js の読み込みに失敗しました。"));
    }, { once: true });
    return;
  }

  notifyStatus("fetching-script");
  const script = document.createElement("script");
  script.async = true;
  script.type = "text/javascript";
  script.dataset.opencvLoader = "true";
  script.src = OPEN_CV_URL;
  script.onload = () => {
    if (!window.cv) {
      notifyStatus("error");
      reject(new Error("OpenCV.js の読み込みに失敗しました。"));
      return;
    }

    if (typeof window.cv.getBuildInformation === "function") {
      notifyStatus("ready");
      resolve(window.cv);
      return;
    }

    notifyStatus("initializing-runtime");
    window.cv.onRuntimeInitialized = () => {
      notifyStatus("ready");
      resolve(window.cv);
    };
  };
  script.onerror = () => {
    notifyStatus("error");
    reject(new Error("OpenCV.js の読み込みに失敗しました。"));
  };

  document.head.appendChild(script);
}

export function ensureOpenCvReady(onStatus) {
  const detach = attachListener(onStatus);

  if (!openCvPromise) {
    openCvPromise = new Promise((resolve, reject) => {
      loadOpenCvScript(resolve, reject);
    }).finally(() => {
      detach();
    });
  } else {
    openCvPromise = openCvPromise.finally(() => {
      detach();
    });
  }

  return openCvPromise;
}

export async function detectSudokuBoard(sourceCanvas, outputCanvas) {
  const cv = await ensureOpenCvReady();
  const source = cv.imread(sourceCanvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const thresholded = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let largestQuadrilateral = null;
  let warped = null;
  let sourcePoints = null;
  let destinationPoints = null;
  let transform = null;

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0, 0, cv.BORDER_DEFAULT);
    cv.adaptiveThreshold(
      blurred,
      thresholded,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      11,
      2
    );

    cv.findContours(
      thresholded,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    largestQuadrilateral = findLargestQuadrilateral(contours, cv);
    if (!largestQuadrilateral) {
      throw new Error("盤面を検出できませんでした。");
    }

    const points = contourToPoints(largestQuadrilateral);
    const ordered = sortCorners(points);

    sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered.topLeft.x, ordered.topLeft.y,
      ordered.topRight.x, ordered.topRight.y,
      ordered.bottomRight.x, ordered.bottomRight.y,
      ordered.bottomLeft.x, ordered.bottomLeft.y
    ]);

    destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      WARPED_BOARD_SIZE, 0,
      WARPED_BOARD_SIZE, WARPED_BOARD_SIZE,
      0, WARPED_BOARD_SIZE
    ]);

    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    warped = new cv.Mat();
    cv.warpPerspective(
      source,
      warped,
      transform,
      new cv.Size(WARPED_BOARD_SIZE, WARPED_BOARD_SIZE),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );

    outputCanvas.width = WARPED_BOARD_SIZE;
    outputCanvas.height = WARPED_BOARD_SIZE;
    cv.imshow(outputCanvas, warped);

    const context = outputCanvas.getContext("2d");
    drawGridOverlay(context, WARPED_BOARD_SIZE);

    return {
      size: WARPED_BOARD_SIZE,
      corners: ordered
    };
  } finally {
    source.delete();
    gray.delete();
    blurred.delete();
    thresholded.delete();
    contours.delete();
    hierarchy.delete();
    largestQuadrilateral?.delete();
    warped?.delete();
    sourcePoints?.delete();
    destinationPoints?.delete();
    transform?.delete();
  }
}
