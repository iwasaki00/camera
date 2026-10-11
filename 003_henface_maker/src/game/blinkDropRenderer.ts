import { buildFeatherMask, getFeatureRegion } from "../featureRenderer";
import type { FeatureRegion, Landmark, Point } from "../featureRenderer";
import { BLINK_DROP_PARTS, fallingOffsetAt } from "./blinkDropGame";
import type { BlinkDropPart, BlinkDropSession } from "./blinkDropGame";

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
export type RegionKind = BlinkDropPart | "rightBrow" | "leftBrow";
type PartRegion = FeatureRegion & { kind: RegionKind; dropHeight: number };
type FacePose = { center: Point; scale: number; angle: number };
const REGION_ORDER: RegionKind[] = ["rightEye", "leftEye", "rightBrow", "leftBrow", "nose", "mouth"];
type Box = { x: number; y: number; width: number; height: number };
type Target = { center: Point; width: number; height: number };
type Sample = { box: Box; opacity: number };
export type BlinkDropDebugMode = "normal" | "parts-only" | "original" | "blank-face" | "bounds";
const PART_COLORS: Record<RegionKind, string> = { rightEye: "#ff9a88", leftEye: "#99e2fa", rightBrow: "#ffc96b", leftBrow: "#5be2dd", nose: "#c5a0ff", mouth: "#a7ffb6" };
const activePhases = new Set(["countdown", "playing", "fixing", "paused", "completed"]);
const BLANK_FACE = {
  bandFeather: 0.1,
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
  const alignedSource = createSurface(), alignedOutput = createSurface();
  let lastTrackedAt = -Infinity;
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

  function getMask(width: number, height: number, featherRadius = 0.42, band = false): HTMLCanvasElement {
    const key = width + ":" + height + ":" + featherRadius + ":" + band;
    const cached = masks.get(key);
    if (cached) return cached;
    const item = createSurface(); item.canvas.width = width; item.canvas.height = height;
    if (band) {
      // Fully opaque rectangular core, with soft corners/edges only. An ellipse
      // attenuates brow and glasses pixels well inside their bounding rectangle.
      const edge = (length: number, vertical: boolean) => {
        const g = item.ctx.createLinearGradient(0, 0, vertical ? 0 : length, vertical ? length : 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(featherRadius, "white");
        g.addColorStop(1 - featherRadius, "white");
        g.addColorStop(1, "rgba(255,255,255,0)");
        return g;
      };
      item.ctx.fillStyle = edge(width, false); item.ctx.fillRect(0, 0, width, height);
      item.ctx.globalCompositeOperation = "destination-in";
      item.ctx.fillStyle = edge(height, true); item.ctx.fillRect(0, 0, width, height);
      item.ctx.globalCompositeOperation = "source-over";
    } else buildFeatherMask(item.ctx, width, height, { featherRadius, centerWeight: 1 });
    if (masks.size >= 16) masks.delete(masks.keys().next().value!);
    masks.set(key, item.canvas); return item.canvas;
  }

  function featherCopy(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    sourceBox: Box, target: Target, band = false): void {
    const sw = Math.max(2, Math.min(source.canvas.width - Math.max(0, sourceBox.x), sourceBox.width));
    const sh = Math.max(2, Math.min(source.canvas.height - Math.max(0, sourceBox.y), sourceBox.height));
    const sx = Math.max(0, Math.min(source.canvas.width - sw, sourceBox.x));
    const sy = Math.max(0, Math.min(source.canvas.height - sh, sourceBox.y));
    const surface = getSurface(target.width, target.height), ctx = surface.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    ctx.drawImage(source.canvas, sx, sy, sw, sh, 0, 0, surface.canvas.width, surface.canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(getMask(surface.canvas.width, surface.canvas.height, band ? BLANK_FACE.bandFeather : 0.42, band), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    dest.save(); dest.globalAlpha = 1;
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
    ctx.drawImage(getMask(width, height, featherRadius, true), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    dest.drawImage(surface.canvas, target.center.x - target.width / 2, target.center.y - target.height / 2, target.width, target.height);
  }

  function geometry(landmarks: readonly Landmark[], width: number, height: number) {
    const a = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 0 });
    const b = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 1 });
    if (!a || !b) return null;
    const [left, right] = [a, b].sort((x, y) => x.center.x - y.center.x);
    const pose: FacePose = { center: { x: (left.center.x + right.center.x) / 2, y: (left.center.y + right.center.y) / 2 },
      scale: Math.hypot(right.center.x - left.center.x, right.center.y - left.center.y),
      angle: Math.atan2(right.center.y - left.center.y, right.center.x - left.center.x) };
    if (pose.scale < 8) return null;
    const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
    const local = landmarks.map(p => {
      const dx = (1 - p.x) * width - pose.center.x, dy = p.y * height - pose.center.y;
      return { x: 1 - (pose.center.x + c * dx + s * dy) / width, y: (pose.center.y - s * dx + c * dy) / height };
    });
    const parts = regions(local, width, height);
    return parts ? { pose, parts } : null;
  }

  function regions(landmarks: readonly Landmark[], width: number, height: number): Record<RegionKind, PartRegion> | null {
    const eyeA = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 0 });
    const eyeB = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 1 });
    const nose = getFeatureRegion(landmarks, "nose", { width, height });
    const mouth = getFeatureRegion(landmarks, "mouth", { width, height });
    if (!eyeA || !eyeB || !nose || !mouth) return null;
    const pairs = [eyeA, eyeB].map((eye, pairIndex) => {
      const brow = getFeatureRegion(landmarks, "brows", { width, height, pairIndex }) ?? eye;
      // Lens margin excludes the brow; the brow gets its own compact mask.
      const browBottom = brow.center.y + brow.height / 2 + eye.width * 0.06;
      const top = Math.max(browBottom, eye.center.y - Math.max(eye.height * 0.9, eye.width * 0.36));
      const bottom = eye.center.y + Math.max(eye.height * 0.9, eye.width * 0.46);
      const dropHeight = eye.width * 0.42; // Stable even while eyelids close.
      return { eye: { ...eye, center: { x: eye.center.x, y: (top + bottom) / 2 }, width: eye.width * 1.68, height: bottom - top, dropHeight },
        brow: { ...brow, width: brow.width * 1.22, height: Math.max(brow.height * 1.8, eye.width * 0.23), dropHeight } };
    }).sort((a, b) => a.eye.center.x - b.eye.center.x);
    return { leftEye: { ...pairs[0].eye, kind: "leftEye" }, rightEye: { ...pairs[1].eye, kind: "rightEye" },
      leftBrow: { ...pairs[0].brow, kind: "leftBrow" }, rightBrow: { ...pairs[1].brow, kind: "rightBrow" },
      nose: { ...nose, kind: "nose", dropHeight: nose.height }, mouth: { ...mouth, kind: "mouth", dropHeight: mouth.height } };
  }

  function hideEyeRegion(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: PartRegion): void {
    const target: Target = { center: region.center, width: region.width * 1.12, height: region.height * 1.22 };
    const strip = Math.max(4, region.height * 0.16);
    const left = target.center.x - target.width / 2, top = target.center.y - target.height / 2;
    const templeX = region.center.x < source.canvas.width / 2 ? left - strip : left + target.width;
    interpolateRegion(source, dest, target, [
      { box: { x: target.center.x - region.width * 0.25, y: top + target.height, width: region.width * 0.5, height: strip }, opacity: 1 },
      { box: { x: target.center.x - region.width * 0.25, y: top + target.height, width: region.width * 0.5, height: strip }, opacity: 0.5 },
      { box: { x: templeX, y: top + target.height * 0.65, width: strip, height: strip }, opacity: 0.12 }
    ], BLANK_FACE.bandFeather);
  }

  function hideBrowRegion(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, brow: PartRegion): void {
    const target = { center: brow.center, width: brow.width * 1.1, height: brow.height * 1.25 };
    const strip = Math.max(4, brow.height * 0.3);
    interpolateRegion(source, dest, target, [
      { box: { x: brow.center.x - brow.width / 2, y: brow.center.y - target.height / 2 - strip, width: brow.width, height: strip }, opacity: 1 }
    ], BLANK_FACE.bandFeather);
  }

  function hideNoseBand(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    nose: PartRegion, leftEye: PartRegion, rightEye: PartRegion, mouth: PartRegion): void {
    const eyeY = (leftEye.center.y + rightEye.center.y) / 2;
    const eyeHeight = (leftEye.height + rightEye.height) / 2;
    const top = eyeY - eyeHeight * 0.85;
    const bottom = mouth.center.y - mouth.height * 0.22;
    const eyeGap = Math.abs(leftEye.center.x - rightEye.center.x);
    const target: Target = { center: { x: nose.center.x, y: (top + bottom) / 2 },
      width: Math.max(nose.width * BLANK_FACE.noseWidth, eyeGap * BLANK_FACE.noseEyeGapWidth), height: Math.max(nose.height * 1.8, bottom - top) };
    const sideOffset = target.width * 0.62;
    const cheekWidth = Math.max(4, eyeGap * 0.18);
    const cheekTop = Math.max(top, leftEye.center.y + leftEye.height / 2 + 8, rightEye.center.y + rightEye.height / 2 + 8);
    const thinHeight = Math.max(4, nose.height * 0.24);
    interpolateRegion(source, dest, target, [
      { box: { x: target.center.x - sideOffset - cheekWidth / 2, y: cheekTop, width: cheekWidth, height: Math.max(4, bottom - cheekTop) }, opacity: 1 },
      { box: { x: target.center.x + sideOffset - cheekWidth / 2, y: cheekTop, width: cheekWidth, height: Math.max(4, bottom - cheekTop) }, opacity: 0.5 },
      { box: { x: target.center.x - nose.width * 0.22, y: mouth.center.y - mouth.height * 1.05, width: nose.width * 0.44, height: thinHeight }, opacity: 0.08 }
    ], BLANK_FACE.bandFeather);
  }

  function hideMouthBand(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, mouth: PartRegion): void {
    const target: Target = { center: mouth.center, width: mouth.width * BLANK_FACE.mouthWidth, height: mouth.height * BLANK_FACE.mouthHeight };
    const sideOffset = target.width * 0.7;
    const stripHeight = Math.max(4, mouth.height * 0.36);
    interpolateRegion(source, dest, target, [
      { box: { x: target.center.x - mouth.width / 2, y: mouth.center.y - mouth.height * 1.12, width: mouth.width, height: stripHeight }, opacity: 1 },
      { box: { x: target.center.x - mouth.width / 2, y: mouth.center.y + mouth.height * 1.05, width: mouth.width, height: stripHeight }, opacity: 0.5 },
      { box: { x: target.center.x - sideOffset, y: mouth.center.y, width: stripHeight, height: stripHeight }, opacity: 0.12 },
      { box: { x: target.center.x + sideOffset - stripHeight, y: mouth.center.y, width: stripHeight, height: stripHeight }, opacity: 0.12 }
    ], BLANK_FACE.bandFeather);
  }

  function smoothFaceCenter(dest: CanvasRenderingContext2D, parts: Record<RegionKind, PartRegion>): void {
    const eyes = [parts.leftEye, parts.rightEye];
    const left = Math.min(...eyes.map(eye => eye.center.x - eye.width * 0.5));
    const right = Math.max(...eyes.map(eye => eye.center.x + eye.width * 0.5));
    const top = Math.min(parts.leftBrow.center.y - parts.leftBrow.height / 2, parts.rightBrow.center.y - parts.rightBrow.height / 2);
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
    parts: Record<RegionKind, PartRegion>): void {
    hideBrowRegion(source, dest, parts.leftBrow); hideBrowRegion(source, dest, parts.rightBrow);
    hideEyeRegion(source, dest, parts.leftEye);
    hideEyeRegion(source, dest, parts.rightEye);
    hideNoseBand(source, dest, parts.nose, parts.leftEye, parts.rightEye, parts.mouth);
    hideMouthBand(source, dest, parts.mouth);
    smoothFaceCenter(dest, parts);
  }

  function drawPart(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: PartRegion, shift: Point): void {
    const compact = region.kind.includes("Eye") || region.kind.includes("Brow");
    const padX = region.width * (compact ? 0 : 0.18), padY = region.height * (compact ? 0 : 0.35);
    const width = region.width + padX * 2, height = region.height + padY * 2;
    featherCopy(source, dest,
      { x: region.center.x - width / 2, y: region.center.y - height / 2, width, height },
      { center: { x: region.center.x + shift.x, y: region.center.y + shift.y }, width, height }, compact);
  }

  function turnPosition(landmarks: readonly Landmark[], width: number, height: number, index: number, offset: number): Point | undefined {
    const g = geometry(landmarks, width, height);
    if (!g) return undefined;
    const part = g.parts[BLINK_DROP_PARTS[index]];
    return { x: (part.center.x - g.pose.center.x) / g.pose.scale,
      y: (part.center.y - g.pose.center.y + offset * part.dropHeight) / g.pose.scale };
  }

  function turnBrowOffset(landmarks: readonly Landmark[], width: number, height: number, index: number): Point | undefined {
    if (index > 1) return undefined;
    const g = geometry(landmarks, width, height); if (!g) return undefined;
    const eye = g.parts[BLINK_DROP_PARTS[index]], brow = g.parts[index === 0 ? "rightBrow" : "leftBrow"];
    return { x: (brow.center.x - eye.center.x) / g.pose.scale, y: (brow.center.y - eye.center.y) / g.pose.scale };
  }

  function drawTurn(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, parts: Record<RegionKind, PartRegion>,
    pose: FacePose, index: number, offset: number, position?: Point | null, browOffset?: Point | null): void {
    const kind = BLINK_DROP_PARTS[index];
    const shift = position ? { x: pose.center.x + position.x * pose.scale - parts[kind].center.x,
      y: pose.center.y + position.y * pose.scale - parts[kind].center.y } : { x: 0, y: offset * parts[kind].dropHeight };
    drawPart(source, dest, parts[kind], shift);
    if (index < 2) {
      const brow = parts[index === 0 ? "rightBrow" : "leftBrow"];
      const browShift = position && browOffset ? {
        x: pose.center.x + (position.x + browOffset.x) * pose.scale - brow.center.x,
        y: pose.center.y + (position.y + browOffset.y) * pose.scale - brow.center.y } : shift;
      drawPart(source, dest, brow, browShift);
    }
  }

  function render(base: HTMLCanvasElement, dest: CanvasRenderingContext2D, landmarks: readonly Landmark[] | undefined,
    session: BlinkDropSession, now: number, debugMode: BlinkDropDebugMode = "normal"): boolean {
    const started = performance.now(); metrics.warpMs = 0; metrics.transformedParts = 0;
    const g = landmarks ? geometry(landmarks, base.width, base.height) : null;
    if (!g && activePhases.has(session.phase) && now - lastTrackedAt < 180) { metrics.compositeMs = performance.now() - started; return false; }
    dest.save(); dest.setTransform(1, 0, 0, 1, 0, 0); dest.globalAlpha = 1; dest.globalCompositeOperation = "source-over";
    dest.clearRect(0, 0, dest.canvas.width, dest.canvas.height);
    if (debugMode === "parts-only") { dest.fillStyle = "#11151d"; dest.fillRect(0, 0, dest.canvas.width, dest.canvas.height); }
    else dest.drawImage(base, 0, 0, dest.canvas.width, dest.canvas.height);
    if (!landmarks || debugMode === "original" || (debugMode === "normal" && !activePhases.has(session.phase))) { dest.restore(); metrics.compositeMs = performance.now() - started; return false; }
    if (!g) { dest.restore(); metrics.compositeMs = performance.now() - started; return false; }
    lastTrackedAt = now;
    const { pose, parts: partRegions } = g;
    for (const surface of [alignedSource, alignedOutput]) {
      if (surface.canvas.width !== base.width || surface.canvas.height !== base.height) { surface.canvas.width = base.width; surface.canvas.height = base.height; }
      surface.ctx.setTransform(1, 0, 0, 1, 0, 0); surface.ctx.clearRect(0, 0, base.width, base.height);
    }
    const source = alignedSource.ctx, output = alignedOutput.ctx;
    source.translate(pose.center.x, pose.center.y); source.rotate(-pose.angle); source.translate(-pose.center.x, -pose.center.y);
    source.drawImage(base, 0, 0); source.setTransform(1, 0, 0, 1, 0, 0);
    if (debugMode !== "parts-only") output.drawImage(alignedSource.canvas, 0, 0);
    if (debugMode !== "parts-only" && debugMode !== "bounds") renderBlankFace(source, output, partRegions);
    const preview = debugMode === "blank-face" || debugMode === "bounds";
    if (!preview) session.fixedOffsets.forEach((offset, index) => { if (offset !== null) drawTurn(source, output, partRegions, pose, index, offset, session.fixedPositions[index], session.fixedBrowOffsets[index]); });
    if (!preview && (session.phase === "playing" || session.phase === "paused")) {
      drawTurn(source, output, partRegions, pose, session.currentIndex, fallingOffsetAt(session, now));
    }
    if (debugMode === "parts-only" && !activePhases.has(session.phase)) {
      for (const part of REGION_ORDER) drawPart(source, output, partRegions[part], { x: 0, y: 0 });
    }
    if (debugMode === "bounds") {
      for (const part of REGION_ORDER) {
        const region = partRegions[part], compact = part.includes("Eye") || part.includes("Brow");
        const width = region.width * (compact ? 1 : 1.36), height = region.height * (compact ? 1 : 1.7);
        output.strokeStyle = PART_COLORS[part]; output.fillStyle = PART_COLORS[part]; output.lineWidth = 2;
        output.strokeRect(region.center.x - width / 2, region.center.y - height / 2, width, height);
        output.font = "12px sans-serif"; output.fillText(part, region.center.x - width / 2, region.center.y - height / 2 - 4);
      }
    }
    dest.translate(pose.center.x, pose.center.y); dest.rotate(pose.angle); dest.translate(-pose.center.x, -pose.center.y);
    dest.drawImage(alignedOutput.canvas, 0, 0);
    dest.restore(); metrics.transformedParts = 6; metrics.compositeMs = performance.now() - started; return true;
  }

  // One-off capture for export/verification; the live renderer never retains it.
  function captureFrame(base: HTMLCanvasElement, landmarks: readonly Landmark[], session: BlinkDropSession, now: number): HTMLCanvasElement {
    const frame = createSurface();
    frame.canvas.width = base.width; frame.canvas.height = base.height;
    render(base, frame.ctx, landmarks, session, now, "normal");
    return frame.canvas;
  }

  return { render, captureFrame, getRegions: regions, getGeometry: geometry, turnPosition, turnBrowOffset, metrics,
    clearCache: () => { patches.clear(); masks.clear(); lastTrackedAt = -Infinity; } };
}
