import { applyFaceOffsets, emptyFaceEffects, specialConfig } from "./faceEffects";
import type { FaceEffects } from "./faceEffects";
import type { RenderQuality } from "./performance";
/** Immutable camera source -> local patches -> output -> drawing overlays. */
export const EFFECT_VERSION = "0.2.0-feather";
export type PartId = "brows" | "eyes" | "ears" | "cheeks" | "nose" | "mouth" | "head" | "jaw";
export type FeatureType = "nose" | "eyes" | "mouth" | "brows";
export type Point = { x: number; y: number };
export type Landmark = Point;
export type PartConfig = { size: number; distance: number; scaleX: number; scaleY: number; opacity: number };
export type EffectState = Record<PartId, PartConfig>;
export type TransformOptions = {
  scaleX: number; scaleY: number; uniformScale: number;
  influenceRadius: Point;
  featherRadius: number; // Fraction of elliptical radius.
  centerWeight: number;
  center: Point;
  translation: Point;
  opacity: number;
  skewY?: number;
};
export type FeatureRegion = { center: Point; width: number; height: number };
// Explicit overlap policy: details blend over larger features.
export const FEATURE_ORDER: readonly FeatureType[] = ["nose", "mouth", "eyes", "brows"];
export const RENDER_SETTINGS = { maxFrameDimension: 720, patchResolution: 1, patchGrid: 10 };
const INDEXES: Record<FeatureType, number[][]> = {
  nose: [[6, 1, 2, 98, 327, 168, 197]],
  eyes: [[33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382]],
  mouth: [[61, 291, 13, 14, 78, 308, 0, 17]],
  brows: [[46, 53, 52, 65, 55, 70, 63, 105, 66, 107], [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]]
};
const LANDMARK_IDS = Object.values(INDEXES).flat(2);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const amplify = (v: number, amount: number) => clamp(1 + (v - 1) * amount, 0.2, 3.2);
const mirror = (p: Point, w: number, h: number): Point => ({ x: (1 - p.x) * w, y: p.y * h });
export function getFeatureRegion(landmarks: readonly Landmark[], featureType: FeatureType,
  options: { width: number; height: number; pairIndex?: number }): FeatureRegion | null {
  const points = INDEXES[featureType][options.pairIndex ?? 0]?.map(i => landmarks[i]);
  if (!points?.length || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const mapped = points.map(p => mirror(p, options.width, options.height));
  const xs = mapped.map(p => p.x), ys = mapped.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: Math.max(4, maxX - minX), height: Math.max(4, maxY - minY) };
}
export function sliderToTransformOptions(config: PartConfig, region: FeatureRegion,
  faceCenter: Point, feature: FeatureType, frameWidth: number): TransformOptions {
  const uniformScale = amplify(config.size, 1.6);
  const scaleX = amplify(config.scaleX, 1.75), scaleY = amplify(config.scaleY, 1.75);
  const sx = clamp(uniformScale * scaleX, 0.35, 2.8), sy = clamp(uniformScale * scaleY, 0.35, 2.8);
  const padding = Math.max(4, frameWidth * (feature === "brows" ? 0.012 : 0.018));
  const halfX = region.width / 2 + padding, halfY = region.height / 2 + padding;
  const dx = region.center.x - faceCenter.x, dy = region.center.y - faceCenter.y;
  const norm = Math.hypot(dx, dy) || 1;
  const shift = (feature === "eyes" || feature === "brows")
    ? config.distance * Math.max(region.width + padding * 2, region.height + padding * 2) * 1.85 : 0;
  const translation = { x: dx / norm * shift, y: dy / norm * shift * 0.28 };
  const strength = Math.max(Math.abs(sx - 1), Math.abs(sy - 1));
  return { scaleX: sx / uniformScale, scaleY: sy / uniformScale, uniformScale, center: region.center, translation,
    influenceRadius: {
      x: halfX * (1.65 + Math.min(strength, 3) * 0.22) * Math.max(1, sx) + Math.abs(translation.x),
      y: halfY * (1.65 + Math.min(strength, 3) * 0.22) * Math.max(1, sy) + Math.abs(translation.y)
    }, featherRadius: 0.28, centerWeight: 1,
    opacity: clamp(1 + (config.opacity - 1) * 1.25, 0.1, 1.6) };
}
/** Limit capture to nearby skin; do not pull a lip into a nose or a brow into an eye. */
export function getFeatureMaskRange(region: FeatureRegion, options: TransformOptions,
  feature: FeatureType, neighbors: Partial<Record<FeatureType, FeatureRegion[]>>): Point {
  const eyePair = neighbors.eyes;
  const eyeGap = eyePair?.length === 2 ? Math.abs(eyePair[0].center.x - eyePair[1].center.x) : 0;
  const other = feature === "nose" ? neighbors.mouth?.[0]
    : feature === "mouth" ? neighbors.nose?.[0]
    : neighbors[feature === "eyes" ? "brows" : "eyes"]?.reduce((closest, candidate) =>
      Math.abs(candidate.center.x - region.center.x) < Math.abs(closest.center.x - region.center.x) ? candidate : closest);
  const gapY = other ? Math.abs(other.center.y - region.center.y) : 0;
  const capX = eyeGap > 8 ? eyeGap * (feature === "mouth" ? 0.8 : feature === "nose" ? 0.5 : 0.48) : Infinity;
  const capY = gapY > 8 ? Math.max(region.height * 0.6,
    gapY * (feature === "nose" ? 0.7 : feature === "mouth" ? 0.65 : 0.65)) : Infinity;
  return { x: Math.min(options.influenceRadius.x, capX), y: Math.min(options.influenceRadius.y, capY) };
}
export function buildFeatherMask(ctx: CanvasRenderingContext2D, width: number, height: number,
  options: { featherRadius: number; centerWeight: number }): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(width / 2, height / 2);
  const feather = clamp(options.featherRadius, 0.05, 1), weight = clamp(options.centerWeight, 0, 1);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const color = (alpha: number) => "rgba(255,255,255," + alpha + ")";
  gradient.addColorStop(0, color(weight)); gradient.addColorStop(1 - feather, color(weight));
  for (const t of [0.25, 0.5, 0.75, 1]) {
    gradient.addColorStop(1 - feather + feather * t, color(weight * (1 - t * t * (3 - 2 * t))));
  }
  ctx.fillStyle = gradient; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
}
type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
function surface(): Surface {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D を初期化できませんでした。");
  return { canvas, ctx };
}
export function createFeatureRenderer() {
  const patches = new Map<string, Surface>();
  let activeQuality: Pick<RenderQuality, "patchResolution" | "patchGrid"> = RENDER_SETTINGS;
  const metrics = { warpMs: 0, compositeMs: 0, transformedParts: 0 };
  let geometryKey = "";
  let cachedRegions: Partial<Record<FeatureType, FeatureRegion[]>> = {};
  const defaultEffects = emptyFaceEffects();
  const masks = new Map<string, HTMLCanvasElement>();
  function mask(width: number, height: number, options: TransformOptions) {
    const key = [width, height, options.featherRadius, options.centerWeight].join(":");
    const existing = masks.get(key);
    if (existing) return existing;
    const next = surface(); next.canvas.width = width; next.canvas.height = height;
    buildFeatherMask(next.ctx, width, height, options);
    if (masks.size >= 24) masks.delete(masks.keys().next().value!);
    masks.set(key, next.canvas); return next.canvas;
  }
  function transformFeatureRegion(sourceCtx: CanvasRenderingContext2D, destCtx: CanvasRenderingContext2D,
    _region: FeatureRegion, options: TransformOptions): void {
    if (sourceCtx.canvas === destCtx.canvas) throw new Error("変形ソースと出力canvasは分離してください。");
    const begin = performance.now();
    const sx = options.scaleX * options.uniformScale, sy = options.scaleY * options.uniformScale;
    if (sx === 1 && sy === 1 && options.translation.x === 0 && options.translation.y === 0 && options.opacity === 1 && !options.skewY) return;
    metrics.transformedParts++;
    const rx = options.influenceRadius.x, ry = options.influenceRadius.y;
    const cx = options.center.x, cy = options.center.y;
    const left = Math.max(0, cx - rx), top = Math.max(0, cy - ry);
    const right = Math.min(sourceCtx.canvas.width, cx + rx), bottom = Math.min(sourceCtx.canvas.height, cy + ry);
    if (right <= left || bottom <= top) return;
    const resolution = clamp(activeQuality.patchResolution, 0.25, 1);
    const w = Math.max(32, Math.ceil((right - left) * resolution / 32) * 32);
    const h = Math.max(32, Math.ceil((bottom - top) * resolution / 32) * 32);
    const patchKey = w + ":" + h;
    let patch = patches.get(patchKey);
    if (!patch) {
      patch = surface(); patch.canvas.width = w; patch.canvas.height = h;
      if (patches.size >= 12) patches.delete(patches.keys().next().value!);
      patches.set(patchKey, patch);
    }
    const ctx = patch.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(sourceCtx.canvas, left, top, right - left, bottom - top, 0, 0, w, h);
    ctx.save();
    ctx.scale(w / (right - left), h / (bottom - top)); ctx.translate(-left, -top);
    // A small resampling grid inside the cut-out keeps adjacent samples connected.
    // All triangles read the camera source; no output pixel is ever a source.
    // This is a Canvas-only patch backend, replaceable by a future face mesh/GPU.
    const hasGeometry = sx !== 1 || sy !== 1 || options.translation.x !== 0 || options.translation.y !== 0 || !!options.skewY;
    const grid = Math.round(clamp(activeQuality.patchGrid, 8, 24));
    const core = 0.32;
    const inverseX = Math.min(0.92 / core, 1 / sx), inverseY = Math.min(0.92 / core, 1 / sy);
    const exponentX = Math.log(core * inverseX) / Math.log(core);
    const exponentY = Math.log(core * inverseY) / Math.log(core);
    const samples: { dest: Point; source: Point }[] = [];
    if (hasGeometry) for (let y = 0; y <= grid; y++) {
      for (let x = 0; x <= grid; x++) {
        const dx = left + (right - left) * x / grid - cx;
        const dy = top + (bottom - top) * y / grid - cy;
        const radius = Math.min(1, Math.hypot(dx / rx, dy / ry));
        const sampleX = radius <= core ? inverseX : Math.pow(radius, exponentX - 1);
        const sampleY = radius <= core ? inverseY : Math.pow(radius, exponentY - 1);
        const t = Math.max(0, (radius - core) / (1 - core));
        const falloff = 1 - t * t * (3 - 2 * t);
        samples.push({ dest: { x: cx + dx, y: cy + dy }, source: {
          x: clamp(cx + (dx - options.translation.x * falloff) * sampleX, 0, sourceCtx.canvas.width),
          y: clamp(cy + (dy - options.translation.y * falloff - (options.skewY ?? 0) * dx * falloff) * sampleY, 0, sourceCtx.canvas.height)
        } });
      }
    }
    function triangle(a: typeof samples[number], b: typeof samples[number], c: typeof samples[number]) {
      const ux = b.source.x - a.source.x, uy = b.source.y - a.source.y;
      const vx = c.source.x - a.source.x, vy = c.source.y - a.source.y;
      const det = ux * vy - uy * vx;
      if (Math.abs(det) < 0.0001) return;
      const dux = b.dest.x - a.dest.x, duy = b.dest.y - a.dest.y;
      const dvx = c.dest.x - a.dest.x, dvy = c.dest.y - a.dest.y;
      const m11 = (dux * vy - dvx * uy) / det, m12 = (duy * vy - dvy * uy) / det;
      const m21 = (dvx * ux - dux * vx) / det, m22 = (dvy * ux - duy * vx) / det;
      ctx.save(); ctx.beginPath();
      // Slight clip overlap fills antialias cracks between shared triangle edges.
      const mx = (a.dest.x + b.dest.x + c.dest.x) / 3, my = (a.dest.y + b.dest.y + c.dest.y) / 3;
      for (const [i, p] of [a.dest, b.dest, c.dest].entries()) {
        const dx = p.x - mx, dy = p.y - my, length = Math.hypot(dx, dy) || 1;
        const px = p.x + dx / length * 0.45, py = p.y + dy / length * 0.45;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.clip();
      ctx.transform(m11, m12, m21, m22,
        a.dest.x - m11 * a.source.x - m21 * a.source.y,
        a.dest.y - m12 * a.source.x - m22 * a.source.y);
      ctx.drawImage(sourceCtx.canvas, 0, 0); ctx.restore();
    }
    if (hasGeometry) for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const i = y * (grid + 1) + x;
        const vertices = [samples[i], samples[i + 1], samples[i + grid + 1], samples[i + grid + 2]];
        if (vertices.every(p => Math.abs(p.source.x - p.dest.x) + Math.abs(p.source.y - p.dest.y) < 0.01)) continue;
        triangle(samples[i], samples[i + 1], samples[i + grid + 1]);
        triangle(samples[i + 1], samples[i + grid + 2], samples[i + grid + 1]);
      }
    }
    ctx.restore();
    const maskW = Math.max(8, Math.ceil(rx * 2 * resolution / 8) * 8);
    const maskH = Math.max(8, Math.ceil(ry * 2 * resolution / 8) * 8);
    const cachedMask = mask(Math.min(512, maskW), Math.min(512, maskH), options);
    ctx.save(); ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(cachedMask, (cx - rx - left) * w / (right - left), (cy - ry - top) * h / (bottom - top),
      rx * 2 * w / (right - left), ry * 2 * h / (bottom - top)); ctx.restore();
    metrics.warpMs += performance.now() - begin;
    const compositeStart = performance.now();
    destCtx.save(); destCtx.globalAlpha = Math.min(1, options.opacity);
    const contrast = Math.max(0.25, 1 + (options.opacity - 1) * 0.85);
    const brightness = Math.max(0.65, 1 + (options.opacity - 1) * 0.12);
    // Geometry and alpha work even on Safari versions without Canvas filter.
    if ("filter" in destCtx) destCtx.filter = "contrast(" + contrast + ") brightness(" + brightness + ")";
    destCtx.drawImage(patch.canvas, left, top, right - left, bottom - top); destCtx.restore();
    metrics.compositeMs += performance.now() - compositeStart;
  }
  function renderFeatureEffects(baseFrame: HTMLCanvasElement, destCtx: CanvasRenderingContext2D,
    landmarks: readonly Landmark[] | undefined, effectState: EffectState,
    drawOverlays?: (ctx: CanvasRenderingContext2D, landmarks: readonly Landmark[]) => void,
    frameOptions?: { effects?: FaceEffects; quality?: RenderQuality }): void {
    metrics.warpMs = metrics.compositeMs = metrics.transformedParts = 0;
    activeQuality = frameOptions?.quality ?? RENDER_SETTINGS;
    const effects = frameOptions?.effects ?? defaultEffects;
    const compositionStart = performance.now();
    if (baseFrame === destCtx.canvas) throw new Error("元フレームを出力先に使うことはできません。");
    const sourceCtx = baseFrame.getContext("2d"); if (!sourceCtx) return;
    destCtx.save(); destCtx.setTransform(1, 0, 0, 1, 0, 0);
    destCtx.globalAlpha = 1; destCtx.globalCompositeOperation = "source-over";
    if ("filter" in destCtx) destCtx.filter = "none";
    destCtx.clearRect(0, 0, destCtx.canvas.width, destCtx.canvas.height); destCtx.drawImage(baseFrame, 0, 0);
    metrics.compositeMs += performance.now() - compositionStart;
    const neutral = FEATURE_ORDER.every(id => { const c = effectState[id]; return c.size === 1 && c.scaleX === 1 && c.scaleY === 1 && c.distance === 0 && c.opacity === 1; }) &&
      (effects.placement.mode === "none" || effects.placement.strength === 0) && Object.values(effects.special).every(v => v === 0);
    if (neutral && !drawOverlays) { destCtx.restore(); return; }
    if (landmarks?.[1] && landmarks[168]) {
      const nose = mirror(landmarks[1], baseFrame.width, baseFrame.height);
      const brow = mirror(landmarks[168], baseFrame.width, baseFrame.height);
      const faceCenter = { x: (nose.x + brow.x) / 2, y: (nose.y + brow.y) / 2 };
      // Cache only geometry, never transformed pixels. Quantization is subpixel.
      const key = baseFrame.width + ":" + baseFrame.height + ":" + LANDMARK_IDS.map(i =>
        landmarks[i] ? Math.round(landmarks[i].x * baseFrame.width * 2) + "," + Math.round(landmarks[i].y * baseFrame.height * 2) : "missing").join(";");
      if (key !== geometryKey) {
        geometryKey = key; cachedRegions = {};
        for (const feature of FEATURE_ORDER) {
          cachedRegions[feature] = INDEXES[feature].map((_, pairIndex) => getFeatureRegion(landmarks, feature,
            { width: baseFrame.width, height: baseFrame.height, pairIndex })).filter((r): r is FeatureRegion => r !== null);
        }
      }
      const regions = cachedRegions;
      const eyes = regions.eyes ?? [], mouth = regions.mouth?.[0];
      const arrangementCenter = { x: eyes.length === 2 ? (eyes[0].center.x + eyes[1].center.x) / 2 : faceCenter.x,
        y: eyes.length && mouth ? (eyes[0].center.y + mouth.center.y) / 2 : faceCenter.y };
      const lower = effects.special.lowerFace + effects.special.imbalance * 0.45;
      if (Math.abs(lower) > 0.001 && mouth && landmarks[152]) {
        const chin = mirror(landmarks[152], baseFrame.width, baseFrame.height);
        const jawPoints = [148, 176, 149, 150, 377, 400, 378].filter(i => landmarks[i]).map(i => mirror(landmarks[i], baseFrame.width, baseFrame.height));
        const width = Math.max(mouth.width * 1.5, ...jawPoints.map(p => Math.abs(p.x - arrangementCenter.x) * 2));
        const center = { x: arrangementCenter.x, y: mouth.center.y + (chin.y - mouth.center.y) * 0.55 };
        const region = { center, width, height: Math.max(12, chin.y - mouth.center.y) };
        const options: TransformOptions = { center, scaleX: clamp(1 + lower * 0.23, 0.78, 1.3), scaleY: clamp(1 + lower * 0.18, 0.8, 1.24), uniformScale: 1,
          influenceRadius: { x: width * 0.55, y: region.height * 0.85 }, featherRadius: 0.4, centerWeight: 1,
          translation: { x: 0, y: region.height * 0.05 * lower }, opacity: 1 };
        transformFeatureRegion(sourceCtx, destCtx, region, options);
      }
      const browTargets: { center: Point; width: number; height: number }[] = [];
      for (const feature of FEATURE_ORDER) {
        const config = specialConfig(effectState, feature, effects);
        for (const region of regions[feature] ?? []) {
          const options = sliderToTransformOptions(config, region, faceCenter, feature, baseFrame.width);
          options.influenceRadius = getFeatureMaskRange(region, options, feature, regions);
          applyFaceOffsets(feature, region, arrangementCenter, options, effects);
          transformFeatureRegion(sourceCtx, destCtx, region, options);
          if (feature === "brows") browTargets.push({ center: { x: region.center.x + options.translation.x, y: region.center.y + options.translation.y },
            width: region.width * options.uniformScale * options.scaleX, height: region.height * options.uniformScale * options.scaleY });
        }
      }
      const overlayStart = performance.now();
      const connected = effects.special.connectedBrows;
      if (connected > 0 && browTargets.length === 2) {
        const [left, right] = browTargets.sort((a, b) => a.center.x - b.center.x);
        destCtx.save(); destCtx.strokeStyle = "#2a201c"; destCtx.lineCap = "round";
        destCtx.globalAlpha = connected * 0.9;
        destCtx.lineWidth = Math.max(2, Math.min(left.height, right.height) * (0.45 + connected * 0.5));
        destCtx.shadowColor = "#2a201c"; destCtx.shadowBlur = baseFrame.width * 0.002;
        destCtx.beginPath(); destCtx.moveTo(left.center.x + left.width * 0.28, left.center.y);
        destCtx.quadraticCurveTo((left.center.x + right.center.x) / 2, (left.center.y + right.center.y) / 2 - left.height * 0.1,
          right.center.x - right.width * 0.28, right.center.y); destCtx.stroke(); destCtx.restore();
      }
      drawOverlays?.(destCtx, landmarks);
      metrics.compositeMs += performance.now() - overlayStart;
    }
    destCtx.restore();
  }
  return { renderFeatureEffects, transformFeatureRegion, metrics, clearCache: () => { masks.clear(); patches.clear(); geometryKey = ""; cachedRegions = {}; } };
}
