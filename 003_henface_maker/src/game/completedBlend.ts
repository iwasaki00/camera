import type { Point } from "../featureRenderer";
import { pointInPolygon } from "./blinkDropMasks";

export const COMPLETED_BLEND = {
  minFeather: 1.5, maxFeather: 22, ringBlend: .28, downsample: .5,
  colorStrength: .28, maxColorDelta: 12, saturationBlend: .08,
  colorIntervalMs: 120, colorSmoothing: .25, maxCache: 24
} as const;
export type BlendRegion = { kind: string; center: Point; width: number; height: number; contour: Point[] };
type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
const surface = (width: number, height: number): Surface => {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("完成顔のブレンドCanvasを初期化できませんでした。");
  return { canvas, ctx };
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function completedFeather(region: BlendRegion, faceScale = region.width): number {
  const fraction = region.kind.includes("Brow") ? .038 : region.kind.includes("Eye") ? .055 : region.kind === "nose" ? .05 : .045;
  return clamp(faceScale * fraction, COMPLETED_BLEND.minFeather, COMPLETED_BLEND.maxFeather);
}
const pathFor = (width: number, height: number, contour: Point[]): Path2D => {
  const points = contour.map(p => ({ x: p.x * width, y: p.y * height }));
  const path = new Path2D(), first = points[0], last = points[points.length - 1];
  path.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  points.forEach((p, i) => { const next = points[(i + 1) % points.length]; path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2); });
  path.closePath(); return path;
};
/** Smooth outward feather, an opaque original core, and a separate edge-only
 * treatment mask. Core erasure here creates the ring, never erases the part. */
export function paintCompletedMasks(mask: CanvasRenderingContext2D, ring: CanvasRenderingContext2D,
  core: CanvasRenderingContext2D, width: number, height: number, contour: Point[], feather: number): void {
  for (const ctx of [mask, ring, core]) { ctx.clearRect(0, 0, width, height); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; }
  if (contour.length < 3) return;
  const path = pathFor(width, height, contour);
  mask.save(); mask.strokeStyle = "white"; mask.lineJoin = "round";
  let accumulated = 0;
  for (let i = 23; i >= 1; i--) {
    // A linear outward ramp avoids concentrating opacity change in the
    // middle of a narrow ring. 24 strokes smooth the former four steps.
    const t = i / 24, coverage = 1 - t;
    mask.globalAlpha = (coverage - accumulated) / (1 - accumulated);
    mask.lineWidth = feather * t * 2; mask.stroke(path); accumulated = coverage;
  }
  mask.globalAlpha = 1; mask.fillStyle = "white"; mask.fill(path); mask.restore();
  ring.drawImage(mask.canvas, 0, 0);
  core.fillStyle = "white"; core.fill(path);
  // Keep the entire landmark contour intact: color/low-pass treatment acts
  // only outside it, including the opaque glasses/brow/lip edge pixels.
  ring.globalCompositeOperation = "destination-out"; ring.drawImage(core.canvas, 0, 0); ring.globalCompositeOperation = "source-over";
}

/** Lazily allocated reusable buffers. Playing/fixing never call this renderer.
 * Color references come from the erased foundation before any part is pasted.
 * Tiny readbacks are throttled; no full-frame/part ImageData processing. */
export function createCompletedBlender() {
  const buffers = new Map<string, { patch: Surface; ring: Surface; small: Surface }>();
  const masks = new Map<string, { mask: Surface; ring: Surface }>();
  const colors = new Map<string, { delta: number[]; source: number[]; target: number[] }>();
  let foundation: Surface | undefined, samples: Surface | undefined;
  let outline: Point[] = [], regions: BlendRegion[] = [], refreshColors = false, lastColorAt = -Infinity, faceScale = 1;
  const metrics = { ms: 0, parts: 0, colorReads: 0, colorCorrectedParts: 0 };
  const trimCache = <T,>(cache: Map<string, T>) => { if (cache.size >= COMPLETED_BLEND.maxCache) cache.delete(cache.keys().next().value!); };
  function beginFrame(dest: CanvasRenderingContext2D, faceOutline: Point[], parts: BlendRegion[], now: number, scale?: number): void {
    metrics.ms = 0; metrics.parts = 0; metrics.colorReads = 0; metrics.colorCorrectedParts = 0;
    const started = performance.now(); outline = faceOutline; regions = parts;
    faceScale = scale ?? Math.max(1, ...parts.map(p => p.width));
    if (now < lastColorAt || now - lastColorAt > 450) colors.clear();
    refreshColors = now < lastColorAt || now - lastColorAt >= COMPLETED_BLEND.colorIntervalMs;
    if (!foundation || foundation.canvas.width !== dest.canvas.width || foundation.canvas.height !== dest.canvas.height) {
      foundation = surface(dest.canvas.width, dest.canvas.height); refreshColors = true; colors.clear();
    }
    if (refreshColors) {
      foundation.ctx.clearRect(0, 0, foundation.canvas.width, foundation.canvas.height);
      foundation.ctx.drawImage(dest.canvas, 0, 0); lastColorAt = now;
    }
    metrics.ms += performance.now() - started;
  }
  function sampleColor(source: CanvasRenderingContext2D, region: BlendRegion, mapPoint: (p: Point) => Point, feather: number): void {
    if (!foundation) return;
    samples ??= surface(16, 1);
    const ctx = samples.ctx; ctx.clearRect(0, 0, 16, 1);
    const rx = Math.max(...region.contour.map(p => Math.abs(p.x - region.center.x))) + feather * 2 + 3;
    const ry = Math.max(...region.contour.map(p => Math.abs(p.y - region.center.y))) + feather * 2 + 3;
    let count = 0;
    const safe = (p: Point) => p.x >= 2 && p.y >= 2 && p.x < source.canvas.width - 2 && p.y < source.canvas.height - 2 &&
      [-2, 2].every(dx => [-2, 2].every(dy => pointInPolygon({ x: p.x + dx, y: p.y + dy }, outline)));
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, p = { x: region.center.x + Math.cos(angle) * rx, y: region.center.y + Math.sin(angle) * ry }, q = mapPoint(p);
      if (!safe(p) || !safe(q) || regions.some(r => pointInPolygon(p, r.contour))) continue;
      ctx.drawImage(source.canvas, p.x - 1.5, p.y - 1.5, 3, 3, count, 0, 1, 1);
      ctx.drawImage(foundation.canvas, q.x - 1.5, q.y - 1.5, 3, 3, count + 8, 0, 1, 1); count++;
    }
    if (!count) { colors.delete(region.kind); return; }
    let data: Uint8ClampedArray;
    try { data = ctx.getImageData(0, 0, 16, 1).data; metrics.colorReads++; }
    catch { colors.delete(region.kind); return; } // Feather-only fallback if readback is unavailable.
    const sums = [0, 0, 0], targets = [0, 0, 0]; let valid = 0;
    const skinLike = (i: number) => data[i + 3] > 250 && data[i] + data[i + 1] + data[i + 2] > 100 &&
      data[i] >= data[i + 1] * .85 && data[i] >= data[i + 2] * .85;
    for (let i = 0; i < count; i++) {
      const a = i * 4, b = (i + 8) * 4;
      if (!skinLike(a) || !skinLike(b)) continue;
      for (let c = 0; c < 3; c++) { sums[c] += data[a + c]; targets[c] += data[b + c]; } valid++;
    }
    if (valid < 2) { colors.delete(region.kind); return; }
    const from = sums.map(v => v / valid), to = targets.map(v => v / valid), previous = colors.get(region.kind);
    const delta = from.map((v, i) => {
      const wanted = clamp((to[i] - v) * COMPLETED_BLEND.colorStrength, -COMPLETED_BLEND.maxColorDelta, COMPLETED_BLEND.maxColorDelta);
      return previous ? previous.delta[i] + (wanted - previous.delta[i]) * COMPLETED_BLEND.colorSmoothing : wanted;
    });
    colors.set(region.kind, { delta, source: from, target: to });
  }
  function draw(source: CanvasRenderingContext2D, dest: CanvasRenderingContext2D, region: BlendRegion,
    shift: Point, mapPoint: (p: Point) => Point): void {
    if (region.contour.length < 3) return;
    const started = performance.now(), feather = Math.round(completedFeather(region, faceScale) * 2) / 2, guard = feather + 2;
    const x = Math.min(region.center.x - region.width * .68, ...region.contour.map(p => p.x - guard));
    const y = Math.min(region.center.y - region.height * .85, ...region.contour.map(p => p.y - guard));
    const right = Math.max(region.center.x + region.width * .68, ...region.contour.map(p => p.x + guard));
    const bottom = Math.max(region.center.y + region.height * .85, ...region.contour.map(p => p.y + guard));
    const width = right - x, height = bottom - y, w = Math.ceil(width / 8) * 8, h = Math.ceil(height / 8) * 8, key = w + ":" + h;
    let scratch = buffers.get(key);
    if (!scratch) {
      trimCache(buffers); scratch = { patch: surface(w, h), ring: surface(w, h), small: surface(Math.max(8, Math.ceil(w * COMPLETED_BLEND.downsample)), Math.max(8, Math.ceil(h * COMPLETED_BLEND.downsample))) };
      buffers.set(key, scratch);
    }
    const contour = region.contour.map(p => ({ x: Math.round((p.x - x) / width * 80) / 80, y: Math.round((p.y - y) / height * 80) / 80 }));
    const maskKey = key + ":" + feather.toFixed(1) + ":" + contour.map(p => p.x + "," + p.y).join(";");
    let shape = masks.get(maskKey);
    if (!shape) {
      trimCache(masks); shape = { mask: surface(w, h), ring: surface(w, h) }; const core = surface(w, h);
      paintCompletedMasks(shape.mask.ctx, shape.ring.ctx, core.ctx, w, h, contour, feather * Math.max(w / width, h / height));
      masks.set(maskKey, shape);
    }
    const ctx = scratch.patch.ctx; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.clearRect(0, 0, w, h);
    const sx = Math.max(0, x), sy = Math.max(0, y), sw = Math.min(source.canvas.width, right) - sx, sh = Math.min(source.canvas.height, bottom) - sy;
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(source.canvas, sx, sy, sw, sh, (sx - x) / width * w, (sy - y) / height * h, sw / width * w, sh / height * h);
    if (refreshColors) sampleColor(source, region, mapPoint, feather);
    const small = scratch.small, edge = scratch.ring.ctx;
    small.ctx.clearRect(0, 0, small.canvas.width, small.canvas.height); small.ctx.drawImage(scratch.patch.canvas, 0, 0, small.canvas.width, small.canvas.height);
    edge.globalCompositeOperation = "source-over"; edge.globalAlpha = 1; edge.clearRect(0, 0, w, h); edge.drawImage(small.canvas, 0, 0, w, h);
    const color = colors.get(region.kind);
    if (color) {
      metrics.colorCorrectedParts++;
      // Bounded, skin-referenced color changes on the ring only. Original
      // feature cores never pass through these blends or the low-pass copy.
      const dark = color.delta.map((d, i) => Math.round(255 * (1 + Math.min(0, d) / Math.max(32, color.source[i]))));
      edge.globalCompositeOperation = "multiply";
      if (edge.globalCompositeOperation === "multiply") { edge.fillStyle = `rgb(${dark.join(",")})`; edge.fillRect(0, 0, w, h); }
      const light = color.delta.map((d, i) => Math.round(255 * Math.max(0, d) / Math.max(32, 255 - color.source[i])));
      edge.globalCompositeOperation = "screen";
      if (edge.globalCompositeOperation === "screen") { edge.fillStyle = `rgb(${light.join(",")})`; edge.fillRect(0, 0, w, h); }
      edge.globalCompositeOperation = "saturation";
      if (edge.globalCompositeOperation === "saturation") {
        edge.globalAlpha = COMPLETED_BLEND.saturationBlend;
        edge.fillStyle = `rgb(${color.target.map(Math.round).join(",")})`; edge.fillRect(0, 0, w, h); edge.globalAlpha = 1;
      }
    }
    edge.globalCompositeOperation = "destination-in"; edge.drawImage(scratch.patch.canvas, 0, 0); edge.drawImage(shape.ring.canvas, 0, 0);
    edge.globalCompositeOperation = "source-over";
    ctx.globalAlpha = COMPLETED_BLEND.ringBlend; ctx.drawImage(scratch.ring.canvas, 0, 0); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(shape.mask.canvas, 0, 0); ctx.globalCompositeOperation = "source-over";
    dest.drawImage(scratch.patch.canvas, x + shift.x, y + shift.y, width, height);
    metrics.parts++; metrics.ms += performance.now() - started;
  }
  return { beginFrame, draw, metrics, clearCache: () => { buffers.clear(); masks.clear(); colors.clear(); foundation = undefined; samples = undefined; lastColorAt = -Infinity; } };
}
