import { buildFeatherMask, getFeatureRegion } from "../featureRenderer";
import type { FeatureRegion, Landmark, Point } from "../featureRenderer";
import { BLINK_DROP_PARTS, fallingOffsetAt } from "./blinkDropGame";
import type { BlinkDropPart, BlinkDropSession } from "./blinkDropGame";
import { convexHull, paintContourMask, pointInPolygon, roundedBand } from "./blinkDropMasks";

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
export type RegionKind = BlinkDropPart | "rightBrow" | "leftBrow";
type PartRegion = FeatureRegion & { kind: RegionKind; dropHeight: number; contour: Point[] };
type FacePose = { center: Point; scale: number; angle: number };
const REGION_ORDER: RegionKind[] = ["rightEye", "leftEye", "rightBrow", "leftBrow", "nose", "mouth"];
type Box = { x: number; y: number; width: number; height: number };
type Target = { center: Point; width: number; height: number };
export type BlinkDropDebugMode = "normal" | "parts-only" | "original" | "blank-face" | "bounds" | "blink-test";
const BROW_IDS = [[46, 53, 52, 65, 55, 70, 63, 105, 66, 107], [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]];
const EYE_IDS = [[33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382]];
const FACE_OVAL_IDS = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const PART_COLORS: Record<RegionKind, string> = { rightEye: "#ff9a88", leftEye: "#99e2fa", rightBrow: "#ffc96b", leftBrow: "#5be2dd", nose: "#c5a0ff", mouth: "#a7ffb6" };
const activePhases = new Set(["countdown", "playing", "fixing", "paused", "completed"]);
const BLANK_FACE = {
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
  const skinField = createSurface(), skinLayer = createSurface(), skinBlend = createSurface();
  let glassesMargin = 1;
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

  function getMask(width: number, height: number, featherRadius: number): HTMLCanvasElement {
    const key = "smooth:" + width + ":" + height + ":" + featherRadius;
    const cached = masks.get(key); if (cached) return cached;
    const item = createSurface(); item.canvas.width = width; item.canvas.height = height;
    buildFeatherMask(item.ctx, width, height, { featherRadius, centerWeight: 1 });
    if (masks.size >= 48) masks.delete(masks.keys().next().value!);
    masks.set(key, item.canvas); return item.canvas;
  }
  function contourMask(width: number, height: number, contour: Point[]): HTMLCanvasElement {
    // Quantize geometry as well as size; the cached pixels and key describe the same mask.
    const points = contour.map(p => ({ x: Math.round(p.x * 40) / 40, y: Math.round(p.y * 40) / 40 }));
    const key = `contour:${width}:${height}:` + points.map(p => `${p.x},${p.y}`).join(";");
    const cached = masks.get(key); if (cached) return cached;
    const mask = createSurface(); mask.canvas.width = width; mask.canvas.height = height;
    paintContourMask(mask.ctx, width, height, points, Math.max(2, Math.min(width, height) * 0.085));
    if (masks.size >= 48) masks.delete(masks.keys().next().value!);
    masks.set(key, mask.canvas); return mask.canvas;
  }

  function featherCopy(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    sourceBox: Box, target: Target, contour: Point[]): void {
    const sx = Math.max(0, sourceBox.x), sy = Math.max(0, sourceBox.y);
    const sw = Math.min(source.canvas.width, sourceBox.x + sourceBox.width) - sx;
    const sh = Math.min(source.canvas.height, sourceBox.y + sourceBox.height) - sy;
    if (sw <= 0 || sh <= 0) return;
    const surface = getSurface(target.width, target.height), ctx = surface.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    ctx.drawImage(source.canvas, sx, sy, sw, sh, (sx - sourceBox.x) / sourceBox.width * surface.canvas.width,
      (sy - sourceBox.y) / sourceBox.height * surface.canvas.height, sw / sourceBox.width * surface.canvas.width, sh / sourceBox.height * surface.canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(contourMask(surface.canvas.width, surface.canvas.height, contour), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    dest.save(); dest.globalAlpha = 1;
    dest.drawImage(surface.canvas, target.center.x - target.width / 2, target.center.y - target.height / 2, target.width, target.height);
    dest.restore();
  }

  const skinSample = createSurface();
  skinSample.canvas.width = skinSample.canvas.height = 1;
  let skinBox: Box | null = null;

  /** One continuous skin field for all erasures. Donors must be inside the
   * face outline and outside every original feature, including lens margins.
   * Four local averages yield a spatial blend, not stretched rectangular strips.
   * No ImageData readback or per-frame canvas allocation is needed. */
  function buildSkinField(source: CanvasRenderingContext2D, parts: Record<RegionKind, PartRegion>, outline: Point[], pose: FacePose): boolean {
    const left = parts.leftEye, right = parts.rightEye, mouth = parts.mouth, nose = parts.nose;
    const gap = right.center.x - left.center.x;
    const top = Math.min(parts.leftBrow.center.y - parts.leftBrow.height, parts.rightBrow.center.y - parts.rightBrow.height) - gap * 0.22;
    const bottom = mouth.center.y + mouth.height * 1.9;
    skinBox = { x: left.center.x - left.width * 0.7, y: top, width: gap + (left.width + right.width) * 0.7, height: bottom - top };
    const safe = (box: Box) => {
      const corners = [{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x,y:box.y+box.height},{x:box.x+box.width,y:box.y+box.height}];
      if (!corners.every(p => p.x >= 0 && p.y >= 0 && p.x < source.canvas.width && p.y < source.canvas.height && pointInPolygon(p, outline))) return false;
      const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
      if (!corners.every(p => {
        const x = pose.center.x + c * (p.x - pose.center.x) - s * (p.y - pose.center.y);
        const y = pose.center.y + s * (p.x - pose.center.x) + c * (p.y - pose.center.y);
        return x >= 0 && y >= 0 && x < source.canvas.width && y < source.canvas.height;
      })) return false;
      return REGION_ORDER.every(kind => {
        const r = parts[kind], pad = 4;
        return box.x + box.width < r.center.x - r.width / 2 - pad || box.x > r.center.x + r.width / 2 + pad ||
          box.y + box.height < r.center.y - r.height / 2 - pad || box.y > r.center.y + r.height / 2 + pad;
      });
    };
    const donor = (side: number, upper: boolean): Box | undefined => {
      const xs = upper ? [side * gap * 0.5, side * gap * 0.38] : [side * gap * 0.65, side * gap * 0.72, side * gap * 0.55];
      const ys = upper ? [top + gap * 0.08, top, top - gap * 0.08] : [nose.center.y + nose.height * 0.15, nose.center.y, mouth.center.y - mouth.height * 1.6];
      for (const y of ys) for (const dx of xs) {
        const box = { x: (left.center.x + right.center.x) / 2 + dx - gap * 0.045, y: y - gap * 0.025, width: Math.max(3, gap * 0.09), height: Math.max(3, gap * 0.05) };
        if (safe(box)) return box;
      }
    };
    const donors = [donor(-1, true), donor(-1, false), donor(1, true), donor(1, false)];
    const fallback = donors.find(Boolean); if (!fallback) { skinBox = null; return false; }
    const w = 48, h = 64;
    for (const surface of [skinField, skinLayer, skinBlend]) {
      if (surface.canvas.width !== w || surface.canvas.height !== h) { surface.canvas.width = w; surface.canvas.height = h; }
      surface.ctx.globalAlpha = 1; surface.ctx.globalCompositeOperation = "source-over"; surface.ctx.clearRect(0, 0, w, h);
    }
    const sample = (box: Box, ctx: CanvasRenderingContext2D) => {
      skinSample.ctx.clearRect(0, 0, 1, 1);
      skinSample.ctx.drawImage(source.canvas, box.x, box.y, box.width, box.height, 0, 0, 1, 1);
      ctx.drawImage(skinSample.canvas, 0, 0, w, h);
    };
    const blendGradient = (ctx: CanvasRenderingContext2D, horizontal: boolean) => {
      const gradient = ctx.createLinearGradient(0, 0, horizontal ? w : 0, horizontal ? 0 : h);
      gradient.addColorStop(0, "rgba(255,255,255,0)"); gradient.addColorStop(1, "white");
      ctx.globalCompositeOperation = "destination-in"; ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = "source-over";
    };
    for (let side = 0; side < 2; side++) {
      const ctx = side === 0 ? skinField.ctx : skinLayer.ctx;
      sample(donors[side * 2] ?? fallback, ctx);
      skinBlend.ctx.clearRect(0, 0, w, h);
      sample(donors[side * 2 + 1] ?? fallback, skinBlend.ctx);
      blendGradient(skinBlend.ctx, false); ctx.drawImage(skinBlend.canvas, 0, 0);
    }
    blendGradient(skinLayer.ctx, true); skinField.ctx.drawImage(skinLayer.canvas, 0, 0);
    return true;
  }

  /** Erasure has its own mask and an opaque reconstructed core, independent of
   * the extracted part mask. Every overlap samples the same continuous field. */
  function interpolateRegion(dest: CanvasRenderingContext2D, target: Target): void {
    if (!skinBox) return;
    const surface = getSurface(target.width, target.height), ctx = surface.ctx;
    const w = surface.canvas.width, h = surface.canvas.height;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, w, h);
    const sx = (target.center.x - target.width / 2 - skinBox.x) / skinBox.width * skinField.canvas.width;
    const sy = (target.center.y - target.height / 2 - skinBox.y) / skinBox.height * skinField.canvas.height;
    ctx.drawImage(skinField.canvas, sx, sy, target.width / skinBox.width * skinField.canvas.width,
      target.height / skinBox.height * skinField.canvas.height, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    const contour = roundedBand({ x: 0.5, y: 0.5 }, 0.84, 0.84);
    ctx.drawImage(contourMask(w, h, contour), 0, 0); ctx.globalCompositeOperation = "source-over";
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
    const outline = convexHull(FACE_OVAL_IDS.map(i => local[i]).filter(Boolean).map(p => ({ x: (1 - p.x) * width, y: p.y * height })));
    // Reject incomplete outlines (also useful with synthetic/partial landmarks).
    const validOutline = outline.length >= 8 && Math.max(...outline.map(p => p.x)) - Math.min(...outline.map(p => p.x)) > pose.scale * 1.6 &&
      Math.max(...outline.map(p => p.y)) - Math.min(...outline.map(p => p.y)) > pose.scale * 2;
    const skinOutline = validOutline ? outline : Array.from({ length: 32 }, (_, i) => ({
      x: pose.center.x + Math.cos(i * Math.PI / 16) * pose.scale * 0.95,
      y: pose.center.y + pose.scale * 0.6 + Math.sin(i * Math.PI / 16) * pose.scale * 1.6 }));
    return parts ? { pose, parts, skinOutline, eraseOutline: validOutline ? outline : null } : null;
  }

  function regions(landmarks: readonly Landmark[], width: number, height: number): Record<RegionKind, PartRegion> | null {
    const eyeA = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 0 });
    const eyeB = getFeatureRegion(landmarks, "eyes", { width, height, pairIndex: 1 });
    const nose = getFeatureRegion(landmarks, "nose", { width, height });
    const mouth = getFeatureRegion(landmarks, "mouth", { width, height });
    if (!eyeA || !eyeB || !nose || !mouth) return null;
    const landmarkContour = (ids: number[], region: FeatureRegion, expand: number) => convexHull(ids.map(i => landmarks[i])
      .filter(Boolean).map(p => ({ x: region.center.x + ((1 - p.x) * width - region.center.x) * expand,
        y: region.center.y + (p.y * height - region.center.y) * expand })));
    const pairs = [eyeA, eyeB].map((eye, pairIndex) => {
      const brow = getFeatureRegion(landmarks, "brows", { width, height, pairIndex }) ?? eye;
      // Lens margin excludes the brow; the brow gets its own compact mask.
      const browBottom = brow.center.y + brow.height / 2 + eye.width * 0.06;
      const top = Math.max(browBottom, eye.center.y - Math.max(eye.height * 0.9, eye.width * 0.36) * glassesMargin);
      const bottom = eye.center.y + Math.max(eye.height * 0.9, eye.width * 0.46) * glassesMargin;
      const dropHeight = eye.width * 0.42; // Stable even while eyelids close.
      const eyeRegion = { ...eye, center: { x: eye.center.x, y: (top + bottom) / 2 }, width: eye.width * (1 + 0.68 * glassesMargin), height: bottom - top, dropHeight };
      const browRegion = { ...brow, width: brow.width * 1.22, height: Math.max(brow.height * 1.8, eye.width * 0.23), dropHeight };
      return { eye: { ...eyeRegion, contour: convexHull([...landmarkContour(EYE_IDS[pairIndex], eye, 1.12),
          ...roundedBand(eyeRegion.center, eyeRegion.width * 0.94, eyeRegion.height * 0.98)]) },
        brow: { ...browRegion, contour: landmarkContour(BROW_IDS[pairIndex], brow, 1.25) } };
    }).sort((a, b) => a.eye.center.x - b.eye.center.x);
    return { leftEye: { ...pairs[0].eye, kind: "leftEye" }, rightEye: { ...pairs[1].eye, kind: "rightEye" },
      leftBrow: { ...pairs[0].brow, kind: "leftBrow" }, rightBrow: { ...pairs[1].brow, kind: "rightBrow" },
      nose: { ...nose, kind: "nose", dropHeight: nose.height, contour: landmarkContour([6, 1, 2, 98, 327, 168, 197], nose, 1.28) },
      mouth: { ...mouth, kind: "mouth", dropHeight: mouth.height, contour: landmarkContour([61, 291, 13, 14, 78, 308, 0, 17], mouth, 1.28) } };
  }

  function hideEyeRegion(dest: CanvasRenderingContext2D, region: PartRegion): void {
    interpolateRegion(dest, { center: region.center, width: region.width * 1.24, height: region.height * 1.42 });
  }

  function hideBrowRegion(dest: CanvasRenderingContext2D, brow: PartRegion): void {
    interpolateRegion(dest, { center: brow.center, width: brow.width * 1.3, height: brow.height * 1.6 });
  }

  function hideNoseBand(dest: CanvasRenderingContext2D, nose: PartRegion, leftEye: PartRegion, rightEye: PartRegion, mouth: PartRegion): void {
    const top = (leftEye.center.y + rightEye.center.y) / 2 - (leftEye.height + rightEye.height) * 0.4;
    const bottom = mouth.center.y - mouth.height * 0.2;
    interpolateRegion(dest, { center: { x: nose.center.x, y: (top + bottom) / 2 },
      width: Math.max(nose.width * BLANK_FACE.noseWidth, (rightEye.center.x - leftEye.center.x) * BLANK_FACE.noseEyeGapWidth),
      height: Math.max(nose.height * 1.8, bottom - top) });
  }

  function hideMouthBand(dest: CanvasRenderingContext2D, mouth: PartRegion): void {
    interpolateRegion(dest, { center: mouth.center, width: mouth.width * BLANK_FACE.mouthWidth, height: mouth.height * BLANK_FACE.mouthHeight });
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
    parts: Record<RegionKind, PartRegion>, outline: Point[], eraseOutline: Point[] | null, pose: FacePose): void {
    if (!buildSkinField(source, parts, outline, pose)) return;
    dest.save();
    if (eraseOutline) {
      dest.beginPath(); eraseOutline.forEach((p, i) => i ? dest.lineTo(p.x, p.y) : dest.moveTo(p.x, p.y)); dest.closePath(); dest.clip();
    }
    hideBrowRegion(dest, parts.leftBrow); hideBrowRegion(dest, parts.rightBrow);
    hideEyeRegion(dest, parts.leftEye); hideEyeRegion(dest, parts.rightEye);
    hideNoseBand(dest, parts.nose, parts.leftEye, parts.rightEye, parts.mouth);
    hideMouthBand(dest, parts.mouth);
    smoothFaceCenter(dest, parts);
    dest.restore();
  }

  function drawPart(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: PartRegion, shift: Point): void {
    const padX = region.width * 0.18, padY = region.height * 0.35;
    const width = region.width + padX * 2, height = region.height + padY * 2;
    const box = { x: region.center.x - width / 2, y: region.center.y - height / 2, width, height };
    featherCopy(source, dest,
      box, { center: { x: region.center.x + shift.x, y: region.center.y + shift.y }, width, height },
      region.contour.map(p => ({ x: (p.x - box.x) / width, y: (p.y - box.y) / height })));
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
    if (!landmarks || debugMode === "original" || debugMode === "blink-test" || (debugMode === "normal" && !activePhases.has(session.phase))) { dest.restore(); metrics.compositeMs = performance.now() - started; return false; }
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
    if (debugMode !== "parts-only" && debugMode !== "bounds") renderBlankFace(source, output, partRegions, g.skinOutline, g.eraseOutline, pose);
    const preview = debugMode === "blank-face" || debugMode === "bounds";
    if (!preview) session.fixedOffsets.forEach((offset, index) => { if (offset !== null) drawTurn(source, output, partRegions, pose, index, offset, session.fixedPositions[index], session.fixedBrowOffsets[index]); });
    if (!preview && (session.phase === "playing" || (session.phase === "paused" && (!session.pausedPhase || session.pausedPhase === "playing")))) {
      drawTurn(source, output, partRegions, pose, session.currentIndex, fallingOffsetAt(session, now));
    }
    if (debugMode === "parts-only" && !activePhases.has(session.phase)) {
      for (const part of REGION_ORDER) drawPart(source, output, partRegions[part], { x: 0, y: 0 });
    }
    if (debugMode === "bounds") {
      for (const part of REGION_ORDER) {
        const region = partRegions[part];
        const width = region.width * 1.36, height = region.height * 1.7;
        output.strokeStyle = PART_COLORS[part]; output.fillStyle = PART_COLORS[part]; output.lineWidth = 2;
        output.strokeRect(region.center.x - width / 2, region.center.y - height / 2, width, height);
        output.beginPath(); region.contour.forEach((p, i) => i ? output.lineTo(p.x, p.y) : output.moveTo(p.x, p.y)); output.closePath(); output.stroke();
        output.font = "12px sans-serif"; output.fillText(part, region.center.x - width / 2, region.center.y - height / 2 - 4);
      }
    }
    metrics.warpMs = performance.now() - started;
    const compositeStart = performance.now();
    dest.translate(pose.center.x, pose.center.y); dest.rotate(pose.angle); dest.translate(-pose.center.x, -pose.center.y);
    dest.drawImage(alignedOutput.canvas, 0, 0);
    dest.restore(); metrics.transformedParts = 6; metrics.compositeMs = performance.now() - compositeStart; return true;
  }

  // One-off capture for export/verification; the live renderer never retains it.
  function captureFrame(base: HTMLCanvasElement, landmarks: readonly Landmark[], session: BlinkDropSession, now: number): HTMLCanvasElement {
    const frame = createSurface();
    frame.canvas.width = base.width; frame.canvas.height = base.height;
    render(base, frame.ctx, landmarks, session, now, "normal");
    return frame.canvas;
  }

  return { render, captureFrame, getRegions: regions, getGeometry: geometry, turnPosition, turnBrowOffset, metrics,
    setGlassesMargin: (value: number) => { glassesMargin = Math.max(0.8, Math.min(1.3, value)); masks.clear(); },
    clearCache: () => { patches.clear(); masks.clear(); lastTrackedAt = -Infinity; } };
}
