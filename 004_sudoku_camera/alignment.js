export const ALIGNMENT_LIMITS = Object.freeze({
  maxOffset: 100,
  minScale: 0.9,
  maxScale: 1.2,
  translateStep: 8,
  scaleStep: 0.02
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createDefaultAlignment() {
  return { x: 0, y: 0, scale: 1 };
}

export function updateAlignment(current, action) {
  const next = { ...current };
  const { maxOffset, minScale, maxScale, translateStep, scaleStep } = ALIGNMENT_LIMITS;

  if (action === "up") next.y -= translateStep;
  if (action === "down") next.y += translateStep;
  if (action === "left") next.x -= translateStep;
  if (action === "right") next.x += translateStep;
  if (action === "zoomIn") next.scale += scaleStep;
  if (action === "zoomOut") next.scale -= scaleStep;

  next.x = clamp(next.x, -maxOffset, maxOffset);
  next.y = clamp(next.y, -maxOffset, maxOffset);
  next.scale = Math.round(clamp(next.scale, minScale, maxScale) * 100) / 100;
  return next;
}

export function renderAlignedSquare(sourceCanvas, outputCanvas, alignment) {
  const size = sourceCanvas.width;
  outputCanvas.width = size;
  outputCanvas.height = size;

  const context = outputCanvas.getContext("2d");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.translate(size / 2 + alignment.x, size / 2 + alignment.y);
  context.scale(alignment.scale, alignment.scale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, -size / 2, -size / 2, size, size);
  context.restore();

  console.log("[alignment] working image regenerated", {
    width: outputCanvas.width,
    height: outputCanvas.height,
    ...alignment
  });
}
