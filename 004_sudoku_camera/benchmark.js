export const BENCHMARK_METHODS = Object.freeze([
  Object.freeze({ id: "raw", label: "RAW" }),
  Object.freeze({ id: "current", label: "CURRENT" }),
  Object.freeze({ id: "grayscale", label: "GRAYSCALE" }),
  Object.freeze({ id: "contrast", label: "CONTRAST" })
]);

function accuracy(correct, total) {
  return total > 0 ? (correct / total) * 100 : null;
}

export function evaluateBenchmarkMethod(truth, results, elapsedMs) {
  let digitCells = 0;
  let digitCorrect = 0;
  let digitMisrecognized = 0;
  let digitUnrecognized = 0;
  let blankCells = 0;
  let blankCorrect = 0;
  let blankFalsePositive = 0;
  const errors = [];

  for (let index = 0; index < 81; index += 1) {
    const expected = Number(truth[index]) || 0;
    const result = results[index] || {};
    const actual = Number(result.value) || 0;

    if (expected > 0) {
      digitCells += 1;
      if (actual === expected) digitCorrect += 1;
      else if (actual === 0) digitUnrecognized += 1;
      else digitMisrecognized += 1;
    } else {
      blankCells += 1;
      if (actual === 0) blankCorrect += 1;
      else blankFalsePositive += 1;
    }

    if (actual !== expected) {
      errors.push({
        index,
        expected,
        actual,
        confidence: Number.isFinite(result.confidence) ? result.confidence : null
      });
    }
  }

  const totalCorrect = digitCorrect + blankCorrect;
  return {
    digitCells,
    digitCorrect,
    digitMisrecognized,
    digitUnrecognized,
    digitAccuracy: accuracy(digitCorrect, digitCells),
    blankCells,
    blankCorrect,
    blankFalsePositive,
    blankAccuracy: accuracy(blankCorrect, blankCells),
    totalCorrect,
    totalAccuracy: accuracy(totalCorrect, 81),
    elapsedMs,
    errors
  };
}

function sortableAccuracy(value) {
  return Number.isFinite(value) ? value : -1;
}

export function selectBestBenchmarkMethod(methodResults) {
  const completed = BENCHMARK_METHODS
    .map((method) => methodResults[method.id])
    .filter(Boolean);

  if (!completed.length) return null;

  return [...completed].sort((left, right) => (
    sortableAccuracy(right.metrics.digitAccuracy) - sortableAccuracy(left.metrics.digitAccuracy)
    || sortableAccuracy(right.metrics.blankAccuracy) - sortableAccuracy(left.metrics.blankAccuracy)
    || sortableAccuracy(right.metrics.totalAccuracy) - sortableAccuracy(left.metrics.totalAccuracy)
    || left.metrics.elapsedMs - right.metrics.elapsedMs
  ))[0];
}

export function formatAccuracy(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}

function reportValue(value) {
  return value ? String(value) : ".";
}

export function buildBenchmarkReport(methodResults, conditions, version = "v1.0.0") {
  const best = selectBestBenchmarkMethod(methodResults);
  const lines = [
    "OCR BENCHMARK",
    `Version: ${version}`,
    "",
    "Conditions:",
    `X=${conditions.x}px`,
    `Y=${conditions.y}px`,
    `Zoom=${Math.round(conditions.scale * 100)}%`,
    `Rotation=${conditions.rotation.toFixed(1)}deg`,
    `OuterCrop=${conditions.outerCrop}%`,
    `OCRSize=${conditions.ocrSize}px`,
    `PSM=${conditions.psm}`
  ];

  for (const method of BENCHMARK_METHODS) {
    const result = methodResults[method.id];
    const errors = result.metrics.errors || [];
    lines.push(
      "",
      method.label,
      `Digit Accuracy: ${result.metrics.digitCorrect}/${result.metrics.digitCells} (${formatAccuracy(result.metrics.digitAccuracy)})`,
      `Digit Misrecognized: ${result.metrics.digitMisrecognized}`,
      `Digit Unrecognized: ${result.metrics.digitUnrecognized}`,
      `Blank Accuracy: ${result.metrics.blankCorrect}/${result.metrics.blankCells} (${formatAccuracy(result.metrics.blankAccuracy)})`,
      `Blank False Positive: ${result.metrics.blankFalsePositive}`,
      `Overall Accuracy: ${result.metrics.totalCorrect}/81 (${formatAccuracy(result.metrics.totalAccuracy)})`,
      `OCR Time: ${(result.metrics.elapsedMs / 1000).toFixed(1)}s`,
      "Errors:"
    );
    if (!errors.length) lines.push("none");
    for (const error of errors) {
      lines.push(
        `R${Math.floor(error.index / 9) + 1}C${error.index % 9 + 1} expected=${reportValue(error.expected)} actual=${reportValue(error.actual)} confidence=${Number.isFinite(error.confidence) ? error.confidence.toFixed(1) : "-"}`
      );
    }
  }

  lines.push("", `BEST: ${best?.label || "-"}`);
  return lines.join("\n");
}
