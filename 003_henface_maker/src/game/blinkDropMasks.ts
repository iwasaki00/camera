import type { Point } from "../featureRenderer";

export function convexHull(points: Point[]): Point[] {
  const sorted = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (input: Point[]) => {
    const out: Point[] = [];
    for (const p of input) { while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); }
    return out;
  };
  const lower = half(sorted), upper = half([...sorted].reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Curved lens/band outline. There are no straight, visible crop edges. */
export function roundedBand(center: Point, width: number, height: number): Point[] {
  return Array.from({ length: 24 }, (_, i) => {
    const angle = i * Math.PI / 12, c = Math.cos(angle), s = Math.sin(angle);
    return { x: center.x + Math.sign(c) * Math.sqrt(Math.abs(c)) * width / 2,
      y: center.y + Math.sign(s) * Math.sqrt(Math.abs(s)) * height / 2 };
  });
}

/** Opaque landmark core, feathered outward only. Never fades the feature itself. */
export function paintContourMask(ctx: CanvasRenderingContext2D, width: number, height: number,
  contour: Point[], feather: number): void {
  ctx.clearRect(0, 0, width, height);
  if (contour.length < 3) return;
  const points = contour.map(p => ({ x: p.x * width, y: p.y * height }));
  const path = new Path2D();
  const last = points[points.length - 1], first = points[0];
  path.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  points.forEach((p, i) => {
    const next = points[(i + 1) % points.length];
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  });
  path.closePath();
  ctx.save(); ctx.lineJoin = "round"; ctx.strokeStyle = "white";
  for (const [radius, alpha] of [[1, 0.08], [0.75, 0.18], [0.5, 0.32], [0.25, 0.55]]) {
    ctx.globalAlpha = alpha; ctx.lineWidth = Math.max(1, feather * radius * 2); ctx.stroke(path);
  }
  ctx.globalAlpha = 1; ctx.fillStyle = "white"; ctx.fill(path); ctx.restore();
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
