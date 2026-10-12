import type { Point } from "../featureRenderer";
import type { BlendRegion } from "./completedBlend";
import { pointInPolygon } from "./blinkDropMasks";

export const SKIN_RECONSTRUCTION = { width: 48, height: 64, intervalMs: 90, smoothingMs: 160,
  patchFraction: .08, insetFraction: .04, textureStrength: .12, maxTexture: 1.5, maxWeights: 4 } as const;
type Box = { x: number; y: number; width: number; height: number };
type Pose = { center: Point; scale: number; angle: number };
type Node = { x: number; y: number; color: number[]; texture: number[] };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// A small regularized plane preserves the direction of illumination; inverse
// distance weights add the remaining local shading without column stretching.
function solve(matrix: number[][], rhs: number[]): number[] {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < 3; i++) {
    let pivot = i; for (let j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const divisor = a[i][i] || 1e-6; for (let k = i; k < 4; k++) a[i][k] /= divisor;
    for (let j = 0; j < 3; j++) if (j !== i) { const factor = a[j][i]; for (let k = i; k < 4; k++) a[j][k] -= factor * a[i][k]; }
  }
  return a.map(row => row[3]);
}
export function skinWeights(nodes: Array<{ x: number; y: number }>, width: number, height: number): Float32Array {
  const weights = new Float32Array(width * height * nodes.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height, offset = (y * width + x) * nodes.length;
    let sum = 0;
    nodes.forEach((p, i) => { const w = 1 / ((u - p.x) ** 2 + (v - p.y) ** 2 + .035); weights[offset + i] = w; sum += w; });
    for (let i = 0; i < nodes.length; i++) weights[offset + i] /= sum;
  }
  return weights;
}
export function fillSkinField(data: Uint8ClampedArray, width: number, height: number, nodes: Node[], weights: Float32Array): void {
  const basis = nodes.map(p => [1, p.x - .5, p.y - .5]);
  const matrix = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => basis.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? .0001 : 0)));
  const planes = [0, 1, 2].map(c => solve(matrix, [0, 1, 2].map(i => basis.reduce((s, row, j) => s + row[i] * nodes[j].color[c], 0))));
  const residual = nodes.map((p, i) => planes.map((plane, c) => p.color[c] - basis[i].reduce((s, v, j) => s + v * plane[j], 0)));
  const limits = [0, 1, 2].map(c => [Math.min(...nodes.map(p => p.color[c])) - 20, Math.max(...nodes.map(p => p.color[c])) + 20]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * nodes.length, pixel = (y * width + x) * 4;
    let texture = 0;
    for (let i = 0; i < nodes.length; i++) texture += weights[offset + i] * (nodes[i].texture[((y + i) % 4) * 4 + (x + i) % 4] ?? 0);
    texture = clamp(texture * SKIN_RECONSTRUCTION.textureStrength, -SKIN_RECONSTRUCTION.maxTexture, SKIN_RECONSTRUCTION.maxTexture);
    for (let c = 0; c < 3; c++) {
      const plane = planes[c]; let value = plane[0] + ((x + .5) / width - .5) * plane[1] + ((y + .5) / height - .5) * plane[2];
      for (let i = 0; i < nodes.length; i++) value += weights[offset + i] * residual[i][c];
      data[pixel + c] = clamp(value + texture, Math.max(0, limits[c][0]), Math.min(255, limits[c][1]));
    }
    data[pixel + 3] = 255;
  }
}

export function createSkinReconstruction() {
  let sampler: HTMLCanvasElement | undefined, sampleCtx: CanvasRenderingContext2D | null = null, image: ImageData | undefined;
  let lastUpdate = -Infinity, initialized = false;
  const history = new Map<number, { position: Point; color: number[] }>();
  const cache = new Map<string, Float32Array>();
  const metrics = { samples: 0, readbacks: 0, updates: 0, weightCaches: 0 };
  let sampleBoxes: Box[] = [];
  function build(source: CanvasRenderingContext2D, field: CanvasRenderingContext2D, box: Box,
    parts: Record<string, BlendRegion>, outline: Point[], pose: Pose, now: number): boolean {
    metrics.readbacks = 0; metrics.updates = 0;
    if (initialized && now >= lastUpdate && now - lastUpdate < SKIN_RECONSTRUCTION.intervalMs) return true;
    const elapsed = now - lastUpdate;
    if (elapsed > 450 || elapsed < 0) history.clear();
    const scale = pose.scale, mid = pose.center, browTop = Math.min(parts.leftBrow.center.y - parts.leftBrow.height / 2, parts.rightBrow.center.y - parts.rightBrow.height / 2);
    const noseY = parts.nose.center.y, mouth = parts.mouth, edge = Math.max(3, scale * SKIN_RECONSTRUCTION.patchFraction), inset = scale * SKIN_RECONSTRUCTION.insetFraction;
    const candidates: Point[][] = [
      ...[-.42, 0, .42].map(x => [.25, .35, .18].map(y => ({ x: mid.x + x * scale, y: browTop - y * scale }))),
      ...[-1, 1].map(side => [1.08, 1.0, 1.16].map(x => ({ x: mid.x + side * x * scale, y: mid.y + scale * .16 }))),
      ...[-1, 1].flatMap(side => [[.7, .78, .62].map(x => ({ x: mid.x + side * x * scale, y: noseY - scale * .16 })),
        [.7, .78, .62].map(x => ({ x: mid.x + side * x * scale, y: mouth.center.y - scale * .45 }))]),
      ...[-.28, .28].map(x => [.20, .28, .12].map(y => ({ x: mid.x + x * scale, y: mouth.center.y + mouth.height / 2 + y * scale })))
    ];
    const safe = (p: Point) => {
      const h = edge / 2, corners = [-h - inset, h + inset].flatMap(dx => [-h - inset, h + inset].map(dy => ({ x: p.x + dx, y: p.y + dy })));
      if (!corners.every(q => pointInPolygon(q, outline))) return false;
      const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
      if (!corners.every(q => { const x = mid.x + c * (q.x - mid.x) - s * (q.y - mid.y), y = mid.y + s * (q.x - mid.x) + c * (q.y - mid.y); return x >= 0 && y >= 0 && x < source.canvas.width && y < source.canvas.height; })) return false;
      return Object.values(parts).every(r => p.x + h < r.center.x - r.width / 2 - inset || p.x - h > r.center.x + r.width / 2 + inset || p.y + h < r.center.y - r.height / 2 - inset || p.y - h > r.center.y + r.height / 2 + inset);
    };
    const selected: Array<{ id: number; point: Point }> = [];
    candidates.forEach((list, id) => {
      const prior = history.get(id), normalized = prior ? { x: mid.x + prior.position.x * scale, y: mid.y + prior.position.y * scale } : undefined;
      const desired = list.find(safe); if (!desired) return;
      const point = normalized ? { x: normalized.x + (desired.x - normalized.x) * .35, y: normalized.y + (desired.y - normalized.y) * .35 } : desired;
      selected.push({ id, point: safe(point) ? point : desired });
    });
    if (selected.length < 3) return initialized;
    if (!sampler) {
      sampler = document.createElement("canvas"); sampler.width = 4; sampler.height = 44;
      sampleCtx = sampler.getContext("2d", { willReadFrequently: true });
    }
    if (!sampleCtx) return false;
    sampleCtx.clearRect(0, 0, 4, 44);
    selected.forEach(({ point }, i) => sampleCtx!.drawImage(source.canvas, point.x - edge / 2, point.y - edge / 2, edge, edge, 0, i * 4, 4, 4));
    let pixels: Uint8ClampedArray;
    try { pixels = sampleCtx.getImageData(0, 0, 4, selected.length * 4).data; metrics.readbacks = 1; } catch { return initialized; }
    const sampled = selected.flatMap(({ id, point }, i) => {
      const color = [0, 0, 0]; const texture: number[] = []; let alpha = 0;
      for (let j = 0; j < 16; j++) { const o = (i * 16 + j) * 4; for (let c = 0; c < 3; c++) color[c] += pixels[o + c] / 16; alpha += pixels[o + 3] / 16; texture.push(.299 * pixels[o] + .587 * pixels[o + 1] + .114 * pixels[o + 2]); }
      const luma = texture.reduce((s, v) => s + v, 0) / 16;
      if (alpha < 250 || luma < 12 || color[0] < color[1] * .7 || color[0] < color[2] * .7) return [];
      return [{ id, point, color, luma, texture: texture.map(v => v - luma) }];
    });
    if (sampled.length < 3) return initialized;
    const typical = median(sampled.map(p => p.luma));
    const valid = sampled.filter(p => p.luma >= typical * .55 && p.luma <= typical * 1.65 + 15);
    if (valid.length < 3) return initialized;
    const blend = history.size ? 1 - Math.exp(-Math.min(180, Math.max(0, elapsed)) / SKIN_RECONSTRUCTION.smoothingMs) : 1;
    const nodes = valid.map(p => {
      const prior = history.get(p.id), color = p.color.map((v, c) => prior ? prior.color[c] + (v - prior.color[c]) * blend : v);
      history.set(p.id, { position: { x: (p.point.x - mid.x) / scale, y: (p.point.y - mid.y) / scale }, color });
      return { x: (p.point.x - box.x) / box.width, y: (p.point.y - box.y) / box.height, color, texture: p.texture };
    });
    const key = nodes.map(p => Math.round(p.x * 32) + "," + Math.round(p.y * 32)).join(";");
    let weights = cache.get(key);
    if (!weights) { if (cache.size >= SKIN_RECONSTRUCTION.maxWeights) cache.delete(cache.keys().next().value!); weights = skinWeights(nodes, SKIN_RECONSTRUCTION.width, SKIN_RECONSTRUCTION.height); cache.set(key, weights); }
    if (field.canvas.width !== SKIN_RECONSTRUCTION.width || field.canvas.height !== SKIN_RECONSTRUCTION.height) { field.canvas.width = SKIN_RECONSTRUCTION.width; field.canvas.height = SKIN_RECONSTRUCTION.height; }
    image ??= field.createImageData(SKIN_RECONSTRUCTION.width, SKIN_RECONSTRUCTION.height);
    fillSkinField(image.data, image.width, image.height, nodes, weights); field.putImageData(image, 0, 0);
    sampleBoxes = valid.map(p => ({ x: p.point.x - edge / 2, y: p.point.y - edge / 2, width: edge, height: edge }));
    metrics.samples = valid.length; metrics.updates = 1; metrics.weightCaches = cache.size;
    lastUpdate = now; initialized = true; return true;
  }
  return { build, metrics, getSamples: () => sampleBoxes, clear: () => {
    initialized = false; lastUpdate = -Infinity; history.clear(); cache.clear(); sampleBoxes = [];
    metrics.samples = 0; metrics.readbacks = 0; metrics.updates = 0; metrics.weightCaches = 0;
  } };
}
