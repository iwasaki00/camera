import type { Landmark } from "./featureRenderer";
export type Quality = "auto" | "speed" | "balanced" | "quality";
export const QUALITY_PROFILES = {
  speed: { maxFrameDimension: 540, patchResolution: 0.8, patchGrid: 8, detectInterval: 120, fps: 24 },
  balanced: { maxFrameDimension: 720, patchResolution: 1, patchGrid: 10, detectInterval: 90, fps: 30 },
  quality: { maxFrameDimension: 960, patchResolution: 1, patchGrid: 14, detectInterval: 65, fps: 30 }
};
export type RenderQuality = typeof QUALITY_PROFILES.balanced;
export class LandmarkSmoother {
  fastUntil = 0;
  private current?: Landmark[];
  private target?: readonly Landmark[];
  private time = 0;
  reset() { this.fastUntil = 0; this.current = undefined; this.target = undefined; this.time = 0; }
  update(points: readonly Landmark[] | undefined, now: number) {
    if (!points) { this.reset(); return; }
    if (this.target?.[1] && points[1] && Math.hypot(points[1].x - this.target[1].x, points[1].y - this.target[1].y) > 0.018) this.fastUntil = now + 400;
    const jump = this.current?.[1] && Math.hypot(points[1].x - this.current[1].x, points[1].y - this.current[1].y) > 0.14;
    this.target = points;
    if (!this.current || this.current.length !== points.length || jump) { this.current = points.map(p => ({ x: p.x, y: p.y })); this.time = now; }
  }
  sample(now: number): Landmark[] | undefined {
    if (!this.current || !this.target) return undefined;
    const alpha = 1 - Math.exp(-Math.max(0, now - this.time) / 40);
    this.time = now;
    for (let i = 0; i < this.current.length; i++) { const c = this.current[i], t = this.target[i]; c.x += (t.x - c.x) * alpha; c.y += (t.y - c.y) * alpha; }
    return this.current;
  }
}
export class FrameMetrics {
  private start = 0; private frames = 0; private detection = 0; private detections = 0;
  private warp = 0; private composite = 0; private total = 0;
  private slowWindows = 0; private fastWindows = 0;
  autoLevel: "speed" | "balanced" = "balanced";
  latest = { fps: 0, detectMs: 0, warpMs: 0, compositeMs: 0, totalMs: 0 };
  reset() { this.latest = { fps: 0, detectMs: 0, warpMs: 0, compositeMs: 0, totalMs: 0 }; this.start = 0; this.frames = this.detection = this.detections = this.warp = this.composite = this.total = 0; this.slowWindows = this.fastWindows = 0; this.autoLevel = "balanced"; }
  record(now: number, detectMs: number | undefined, warpMs: number, compositeMs: number, totalMs: number): boolean {
    if (!this.start) this.start = now;
    this.frames++; this.warp += warpMs; this.composite += compositeMs; this.total += totalMs;
    if (detectMs !== undefined) { this.detections++; this.detection += detectMs; }
    if (now - this.start < 1000) return false;
    this.latest = { fps: this.frames * 1000 / (now - this.start), detectMs: this.detections ? this.detection / this.detections : 0,
      warpMs: this.warp / this.frames, compositeMs: this.composite / this.frames, totalMs: this.total / this.frames };
    const slow = this.latest.totalMs > 27 || this.latest.fps < 22;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    this.fastWindows = !slow && this.latest.totalMs < 14 && this.latest.fps > 23 ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= 2) this.autoLevel = "speed";
    if (this.fastWindows >= 5) this.autoLevel = "balanced";
    this.start = now; this.frames = this.detection = this.detections = this.warp = this.composite = this.total = 0;
    return true;
  }
}

/** Carry the frame deadline forward; 24fps must alternate RAF intervals, not settle at 20fps. */
export function advanceFrameClock(previous: number, now: number, fps: number, changed: boolean): number {
  return changed || previous === 0 ? now : Math.max(previous + 1000 / fps, now - 1000 / fps);
}
