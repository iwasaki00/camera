import { buildFeatherMask, getFeatureRegion } from "../featureRenderer";
import type { FeatureRegion, Landmark, Point } from "../featureRenderer";
import { BLINK_DROP_PARTS, fallingOffsetAt } from "./blinkDropGame";
import type { BlinkDropPart, BlinkDropSession } from "./blinkDropGame";

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
type PartRegion = FeatureRegion & { kind: BlinkDropPart };
const activePhases = new Set(["countdown", "playing", "fixing", "paused", "completed"]);

function createSurface(): Surface {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ゲーム描画用Canvasを初期化できませんでした。");
  return { canvas, ctx };
}

export function createBlinkDropRenderer() {
  const patches = new Map<string, Surface>();
  const masks = new Map<string, HTMLCanvasElement>();
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

  function getMask(width: number, height: number): HTMLCanvasElement {
    const key = width + ":" + height;
    const cached = masks.get(key);
    if (cached) return cached;
    const item = createSurface(); item.canvas.width = width; item.canvas.height = height;
    buildFeatherMask(item.ctx, width, height, { featherRadius: 0.42, centerWeight: 1 });
    if (masks.size >= 16) masks.delete(masks.keys().next().value!);
    masks.set(key, item.canvas); return item.canvas;
  }

  function featherCopy(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D,
    sourceBox: { x: number; y: number; width: number; height: number }, target: { center: Point; width: number; height: number }, opacity = 1): void {
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

  function hidePart(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: PartRegion): void {
    const eye = region.kind === "leftEye" || region.kind === "rightEye";
    const targetWidth = region.width * (eye ? 1.42 : region.kind === "mouth" ? 1.3 : 1.2);
    const targetHeight = region.height * (eye ? 2.25 : region.kind === "mouth" ? 2.1 : 1.22);
    const sourceCenter = region.kind === "nose"
      ? { x: region.center.x - region.width * 1.18, y: region.center.y }
      : { x: region.center.x, y: region.center.y - region.height * (eye ? 2.3 : 2) };
    featherCopy(source, dest,
      { x: sourceCenter.x - targetWidth / 2, y: sourceCenter.y - targetHeight / 2, width: targetWidth, height: targetHeight },
      { center: region.center, width: targetWidth, height: targetHeight });
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
    for (const part of BLINK_DROP_PARTS) hidePart(source, dest, partRegions[part]);
    session.fixedOffsets.forEach((offset, index) => { if (offset !== null) drawPart(source, dest, partRegions[BLINK_DROP_PARTS[index]], offset); });
    if (session.phase === "playing" || session.phase === "paused") {
      drawPart(source, dest, partRegions[BLINK_DROP_PARTS[session.currentIndex]], fallingOffsetAt(session, now));
    }
    dest.restore(); metrics.transformedParts = 4; metrics.compositeMs = performance.now() - started; return true;
  }

  return { render, metrics, clearCache: () => { patches.clear(); masks.clear(); } };
}
