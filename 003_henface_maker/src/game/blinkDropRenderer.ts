import { buildFeatherMask, getFeatureRegion } from "../featureRenderer";
import type { FeatureRegion, Landmark, Point } from "../featureRenderer";
import { BLINK_DROP_PARTS, fallingOffsetAt } from "./blinkDropGame";
import type { BlinkDropPart, BlinkDropSession } from "./blinkDropGame";

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
type PartRegion = FeatureRegion & { kind: BlinkDropPart };
type Box = { x: number; y: number; width: number; height: number };
type Target = { center: Point; width: number; height: number };
type Sample = { box: Box; opacity: number };
const activePhases = new Set(["countdown", "playing", "fixing", "paused", "completed"]);
const BLANK_FACE = {
  eyeWidth: 1.82, eyeHeight: 3.4, eyeSampleOffset: 0.88,
  noseWidth: 2.6, noseEyeGapWidth: 0.84,
  mouthWidth: 1.86, mouthHeight: 3.3,
  centerSmoothScale: 0.34, centerSmoothOpacity: 0.22
} as const;

function createSurface(): Surface {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ゲーム描画用Canvasを初期化できませんでした。");
  return { canvas, ctx };
}

export function createBlinkDropRenderer() {
  const patches = new Map<string, Surface>();
  const masks = new Map<string, HTMLCanvasElement>();
  const smoothSmall = createSurface(), smoothLarge = createSurface();
  const metrics = { warpMs: 0, compositeMs: 0, transformedParts: 0 };

  function getSurface(width: number, height: number): Surface {
    const w = Math.max(24, Math.ceil(width / 8) * 8), h = Math.max(24, Math.ceil(height / 8) * 8), key = w + ":" + h;
    let item = patches.get(key);
    if (!item) {
      item = createSurface(); item.canvas.width = w; item.canvas.height = h;
      if (patches.size >= 16) patches.delete(patches.keys().next().value!);
      patches.set(key, item);
    }
    return item;
  }

  function getMask(width: number, height: number, featherRadius = 0.42): HTMLCanvasElement {
    const key = width + ":" + height + ":" + featherRadius;
    const cached = masks.get(key);
    if (cached) return cached;
    const item = createSurface(); item.canvas.width = width; item.canvas.height = height;
    buildFeatherMask(item.ctx, width, height, { featherRadius, centerWeight: 1 });
    if (masks.size >= 16) masks.delete(masks.keys().next().value!);
    masks.set(key, item.canvas); return item.canvas;
  }

  function featherCopy(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    sourceBox: Box, target: Target, opacity = 1): void {
    const sw = Math.max(2, Math.min(source.canvas.width - Math.max(0, sourceBox.x), sourceBox.width));
    const sh = Math.max(2, Math.min(source.canvas.height - Math.max(0, sourceBox.y), sourceBox.height));
    const sx = Math.max(0, Math.min(source.canvas.width - sw, sourceBox.x));
    const sy = Math.max(0, Math.min(source.canvas.height - sh, sourceBox.y));
    const surface = getSurface(target.width, target.height), ctx = surface.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    ctx.drawImage(source.canvas, sx, sy, sw, sh, 0, 0, surface.canvas.width, surface.canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(getMask(surface.canvas.width, surface.canvas.height), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    dest.save(); dest.globalAlpha = opacity;
    dest.drawImage(surface.canvas, target.center.x - target.width / 2, target.center.y - target.height / 2, target.width, target.height);
    dest.restore();
  }

  function drawSample(source: CanvasRenderingContext2D, targetCtx: CanvasRenderingContext2D,
    box: Box, width: number, height: number, opacity: number): void {
    const sx = Math.max(0, Math.min(source.canvas.width - 2, box.x));
    const sy = Math.max(0, Math.min(source.canvas.height - 2, box.y));
    const sw = Math.max(2, Math.min(source.canvas.width - sx, box.width));
    const sh = Math.max(2, Math.min(source.canvas.height - sy, box.height));
    targetCtx.globalAlpha = opacity;
    targetCtx.drawImage(source.canvas, sx, sy, sw, sh, 0, 0, width, height);
  }

  /** Blend skin from several sides before applying one soft band mask. */
  function interpolateRegion(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    target: Target, samples: Sample[], featherRadius: number): void {
    const surface = getSurface(target.width, target.height), ctx = surface.ctx;
    const width = surface.canvas.width, height = surface.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    samples.forEach((sample, index) => drawSample(source, ctx, sample.box, width, height, index === 0 ? 1 : sample.opacity));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(getMask(width, height, featherRadius), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    dest.drawImage(surface.canvas, target.center.x - target.width / 2, target.center.y - target.height / 2, target.width, target.height);
  }

  function regions(landmarks: readonly Landmark[], width: number, height: number): Record<BlinkDropPart, PartRegion> | null {
    const eyeA = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 0 });
    const eyeB = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 1 });
    const nose = getFeatureRegion(landmarks, "nose", { width, height });
    const mouth = getFeatureRegion(landmarks, "mouth", { width, height });
    if (!eyeA || !eyeB || !nose || !mouth) return null;
    const eyes = [eyeA, eyeB].sort((a, b) => a.center.x - b.center.x);
    return { leftEye: { ...eyes[0], kind: "leftEye" }, rightEye: { ...eyes[1], kind: "rightEye" },
      nose: { ...nose, kind: "nose" }, mouth: { ...mouth, kind: "mouth" } };
  }

  function hideEyeRegion(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: PartRegion): void {
    const target: Target = { center: region.center, width: region.width * BLANK_FACE.eyeWidth, height: region.height * BLANK_FACE.eyeHeight };
    const offset = target.height * BLANK_FACE.eyeSampleOffset;
    interpolateRegion(source, dest, target, [
      { box: { x: target.center.x - target.width / 2, y: target.center.y - offset - target.height / 2, width: target.width, height: target.height }, opacity: 1 },
      { box: { x: target.center.x - target.width / 2, y: target.center.y + offset - target.height / 2, width: target.width, height: target.height }, opacity: 0.48 }
    ], 0.46);
  }

  function hideNoseBand(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    nose: PartRegion, leftEye: PartRegion, rightEye: PartRegion, mouth: PartRegion): void {
    const eyeY = (leftEye.center.y + rightEye.center.y) / 2;
    const eyeHeight = (leftEye.height + rightEye.height) / 2;
    const top = eyeY + eyeHeight * 0.12;
    const bottom = mouth.center.y - mouth.height * 0.22;
    const eyeGap = Math.abs(leftEye.center.x - rightEye.center.x);
    const target: Target = { center: { x: nose.center.x, y: (top + bottom) / 2 },
      width: Math.max(nose.width * BLANK_FACE.noseWidth, eyeGap * BLANK_FACE.noseEyeGapWidth), height: Math.max(nose.height * 1.8, bottom - top) };
    const sideOffset = target.width * 1.08;
    const thinHeight = Math.max(4, nose.height * 0.24);
    interpolateRegion(source, dest, target, [
      { box: { x: target.center.x - sideOffset - target.width / 2, y: target.center.y - target.height / 2, width: target.width, height: target.height }, opacity: 1 },
      { box: { x: target.center.x + sideOffset - target.width / 2, y: target.center.y - target.height / 2, width: target.width, height: target.height }, opacity: 0.52 },
      { box: { x: target.center.x - target.width / 2, y: top - thinHeight, width: target.width, height: thinHeight }, opacity: 0.18 },
      { box: { x: target.center.x - target.width / 2, y: bottom, width: target.width, height: thinHeight }, opacity: 0.14 }
    ], 0.4);
  }

  function hideMouthBand(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, mouth: PartRegion): void {
    const target: Target = { center: mouth.center, width: mouth.width * BLANK_FACE.mouthWidth, height: mouth.height * BLANK_FACE.mouthHeight };
    const sideOffset = target.width * 0.7;
    const stripHeight = Math.max(4, mouth.height * 0.36);
    interpolateRegion(source, dest, target, [
      { box: { x: target.center.x - sideOffset - target.width / 2, y: target.center.y - target.height / 2, width: target.width, height: target.height }, opacity: 1 },
      { box: { x: target.center.x + sideOffset - target.width / 2, y: target.center.y - target.height / 2, width: target.width, height: target.height }, opacity: 0.5 },
      { box: { x: target.center.x - target.width / 2, y: mouth.center.y - mouth.height * 1.45, width: target.width, height: stripHeight }, opacity: 0.34 },
      { box: { x: target.center.x - target.width / 2, y: mouth.center.y + mouth.height * 1.05, width: target.width, height: stripHeight }, opacity: 0.3 }
    ], 0.4);
  }

  function smoothFaceCenter(dest: CanvasRenderingContext2D, parts: Record<BlinkDropPart, PartRegion>): void {
    const eyes = [parts.leftEye, parts.rightEye];
    const left = Math.min(...eyes.map(eye => eye.center.x - eye.width * 0.7));
    const right = Math.max(...eyes.map(eye => eye.center.x + eye.width * 0.7));
    const top = Math.min(...eyes.map(eye => eye.center.y - eye.height * 0.9));
    const bottom = parts.mouth.center.y + parts.mouth.height * 1.15;
    const width = Math.max(16, Math.round(right - left)), height = Math.max(16, Math.round(bottom - top));
    const smallWidth = Math.max(8, Math.round(width * BLANK_FACE.centerSmoothScale));
    const smallHeight = Math.max(8, Math.round(height * BLANK_FACE.centerSmoothScale));
    if (smoothSmall.canvas.width !== smallWidth || smoothSmall.canvas.height !== smallHeight) {
      smoothSmall.canvas.width = smallWidth; smoothSmall.canvas.height = smallHeight;
    }
    if (smoothLarge.canvas.width !== width || smoothLarge.canvas.height !== height) {
      smoothLarge.canvas.width = width; smoothLarge.canvas.height = height;
    }
    smoothSmall.ctx.clearRect(0, 0, smallWidth, smallHeight);
    smoothSmall.ctx.drawImage(dest.canvas, left, top, width, height, 0, 0, smallWidth, smallHeight);
    smoothLarge.ctx.clearRect(0, 0, width, height);
    smoothLarge.ctx.imageSmoothingEnabled = true;
    smoothLarge.ctx.drawImage(smoothSmall.canvas, 0, 0, smallWidth, smallHeight, 0, 0, width, height);
    smoothLarge.ctx.globalCompositeOperation = "destination-in";
    smoothLarge.ctx.drawImage(getMask(width, height, 0.64), 0, 0);
    smoothLarge.ctx.globalCompositeOperation = "source-over";
    dest.save(); dest.globalAlpha = BLANK_FACE.centerSmoothOpacity;
    dest.drawImage(smoothLarge.canvas, left, top, width, height); dest.restore();
  }

  function renderBlankFace(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    parts: Record<BlinkDropPart, PartRegion>): void {
    hideEyeRegion(source, dest, parts.leftEye);
    hideEyeRegion(source, dest, parts.rightEye);
    hideNoseBand(source, dest, parts.nose, parts.leftEye, parts.rightEye, parts.mouth);
    hideMouthBand(source, dest, parts.mouth);
    smoothFaceCenter(dest, parts);
  }

  function drawPart(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: PartRegion, offset: number): void {
    const padX = region.width * 0.18, padY = region.height * 0.35;
    const width = region.width + padX * 2, height = region.height + padY * 2;
    featherCopy(source, dest,
      { x: region.center.x - width / 2, y: region.center.y - height / 2, width, height },
      { center: { x: region.center.x, y: region.center.y + offset * region.height }, width, height });
  }

  function render(base: HTMLCanvasElement, dest: CanvasRenderingContext2D, landmarks: readonly Landmark[] | undefined,
    session: BlinkDropSession, now: number): boolean {
    const started = performance.now(); metrics.warpMs = 0; metrics.transformedParts = 0;
    dest.save(); dest.setTransform(1, 0, 0, 1, 0, 0); dest.globalAlpha = 1; dest.globalCompositeOperation = "source-over";
    dest.clearRect(0, 0, dest.canvas.width, dest.canvas.height); dest.drawImage(base, 0, 0, dest.canvas.width, dest.canvas.height);
    if (!landmarks || !activePhases.has(session.phase)) { dest.restore(); metrics.compositeMs = performance.now() - started; return false; }
    const source = base.getContext("2d"), partRegions = regions(landmarks, base.width, base.height);
    if (!source || !partRegions) { dest.restore(); metrics.compositeMs = performance.now() - started; return false; }
    renderBlankFace(source, dest, partRegions);
    session.fixedOffsets.forEach((offset, index) => { if (offset !== null) drawPart(source, dest, partRegions[BLINK_DROP_PARTS[index]], offset); });
    if (session.phase === "playing" || session.phase === "paused") {
      drawPart(source, dest, partRegions[BLINK_DROP_PARTS[session.currentIndex]], fallingOffsetAt(session, now));
    }
    dest.restore(); metrics.transformedParts = 4; metrics.compositeMs = performance.now() - started; return true;
  }

  return { render, metrics, clearCache: () => { patches.clear(); masks.clear(); } };
}
