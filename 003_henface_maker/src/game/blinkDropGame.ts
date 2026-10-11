import type { Landmark, Point } from "../featureRenderer";

export const BLINK_DROP_PARTS = ["rightEye", "leftEye", "nose", "mouth"] as const;
export type BlinkDropPart = typeof BLINK_DROP_PARTS[number];
export type BlinkDropPhase = "ready" | "countdown" | "playing" | "fixing" | "paused" | "completed" | "error";

export const BLINK_DROP_LABELS: Record<BlinkDropPart, string> = {
  rightEye: "右目と眉", leftEye: "左目と眉", nose: "鼻", mouth: "口"
};

export type BlinkDropSession = {
  phase: BlinkDropPhase;
  currentIndex: number;
  fixedOffsets: Array<number | null>;
  fixedPositions: Array<Point | null>; // Target center in face-local units (eye separation = 1).
  fixedBrowOffsets: Array<Point | null>;
  partStartedAt: number;
  pauseStartedAt: number;
  error?: string;
};

const DROP_DURATION_MS = 2400;
const START_OFFSET = -6;
const END_OFFSET = 2;

export function createBlinkDropSession(phase: BlinkDropPhase = "ready"): BlinkDropSession {
  return { phase, currentIndex: 0, fixedOffsets: [null, null, null, null], fixedPositions: [null, null, null, null],
    fixedBrowOffsets: [null, null, null, null], partStartedAt: 0, pauseStartedAt: 0 };
}

export function startBlinkDropCountdown(): BlinkDropSession {
  return createBlinkDropSession("countdown");
}

export function beginBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  return { ...session, phase: "playing", partStartedAt: now, pauseStartedAt: 0 };
}

export function fallingOffsetAt(session: BlinkDropSession, now: number): number {
  const sampleAt = session.phase === "paused" && session.pauseStartedAt ? session.pauseStartedAt : now;
  const elapsed = Math.max(0, sampleAt - session.partStartedAt);
  const progress = (elapsed % DROP_DURATION_MS) / DROP_DURATION_MS;
  return START_OFFSET + (END_OFFSET - START_OFFSET) * progress;
}

export function catchBlinkDropPart(session: BlinkDropSession, now: number, position?: Point, browOffset?: Point): BlinkDropSession {
  if (session.phase !== "playing") return session;
  const fixedOffsets = session.fixedOffsets.slice();
  fixedOffsets[session.currentIndex] = fallingOffsetAt(session, now);
  const fixedPositions = session.fixedPositions.slice();
  fixedPositions[session.currentIndex] = position ?? null;
  const fixedBrowOffsets = session.fixedBrowOffsets.slice(); fixedBrowOffsets[session.currentIndex] = browOffset ?? null;
  return { ...session, phase: "fixing", fixedOffsets, fixedPositions, fixedBrowOffsets };
}

export function advanceBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  if (session.phase !== "fixing") return session;
  if (session.currentIndex >= BLINK_DROP_PARTS.length - 1) return { ...session, phase: "completed" };
  return { ...session, phase: "playing", currentIndex: session.currentIndex + 1, partStartedAt: now };
}

export function pauseBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  return session.phase === "playing" ? { ...session, phase: "paused", pauseStartedAt: now } : session;
}

export function resumeBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  if (session.phase !== "paused") return session;
  return { ...session, phase: "playing", partStartedAt: session.partStartedAt + now - session.pauseStartedAt, pauseStartedAt: 0 };
}

export function blinkDropScore(session: BlinkDropSession): { accuracy: number; funny: number; title: string } {
  const values = session.fixedOffsets.filter((value): value is number => value !== null);
  const average = values.length ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length : 0;
  const accuracy = Math.max(0, Math.round(100 - average / 6 * 100));
  const funny = Math.min(100, Math.round(average / 5 * 100));
  const title = funny > 72 ? "顔面崩壊王！" : funny > 42 ? "変顔名人！" : accuracy > 75 ? "かなり惜しい！" : "すごい変顔！";
  return { accuracy, funny, title };
}

const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
function eyeRatio(landmarks: readonly Landmark[], horizontal: [number, number], verticals: Array<[number, number]>): number | null {
  const points = [...horizontal, ...verticals.flat()].map(index => landmarks[index]);
  if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const width = distance(landmarks[horizontal[0]], landmarks[horizontal[1]]);
  if (width < 0.003 || width > 0.4) return null;
  const values = verticals.map(([top, bottom]) => distance(landmarks[top], landmarks[bottom]) / width);
  if (Math.max(...values) > 0.85 || Math.abs(values[0] - values[1]) > 0.22) return null;
  return (values[0] + values[1]) / 2;
}

export class BlinkDetector {
  private baselineLeft = 0;
  private baselineRight = 0;
  private calibration: Array<{ left: number; right: number; at: number }> = [];
  private history: Array<{ left: number; right: number; at: number }> = [];
  private armed = false;
  private lastBlinkAt = -Infinity;
  private openFrames = 0;
  private lastOpenAt = -Infinity;
  private closedFrames = 0;
  readonly debug = { left: 0, right: 0, baselineLeft: 0, baselineRight: 0,
    closeLeft: 0, closeRight: 0, reopenLeft: 0, reopenRight: 0,
    count: 0, state: "open", result: "calibrating", face: false, calibrated: false, ms: 0 };

  reset(): void {
    this.baselineLeft = 0; this.baselineRight = 0; this.calibration = []; this.history = [];
    this.lastBlinkAt = -Infinity; this.lastOpenAt = -Infinity; this.requireReopen();
    Object.assign(this.debug, { left: 0, right: 0, baselineLeft: 0, baselineRight: 0, closeLeft: 0, closeRight: 0,
      reopenLeft: 0, reopenRight: 0, count: 0, state: "open", result: "calibrating", face: false, calibrated: false, ms: 0 });
  }

  requireReopen(): void { this.armed = false; this.openFrames = 0; this.closedFrames = 0; this.history = []; }
  get ready(): boolean { return this.armed && this.debug.face && this.debug.state === "open"; }

  update(landmarks: readonly Landmark[] | undefined, now: number): boolean {
    const started = performance.now();
    const left = landmarks ? eyeRatio(landmarks, [362, 263], [[386, 374], [385, 380]]) : null;
    const right = landmarks ? eyeRatio(landmarks, [33, 133], [[159, 145], [158, 153]]) : null;
    this.debug.face = left !== null && right !== null;
    let detected = false;
    if (left === null || right === null) {
      this.requireReopen(); this.calibration = []; this.debug.result = "invalid / no-face";
    } else {
      this.debug.left = left; this.debug.right = right;
      if (!this.debug.calibrated) {
        this.calibration.push({ left, right, at: now });
        if (this.calibration.length > 24) this.calibration.shift();
        if (this.calibration.length >= 8 && now - this.calibration[0].at >= 400) {
          const percentile = (side: "left" | "right") => this.calibration.map(v => v[side]).sort((a, b) => a - b)[Math.floor(this.calibration.length * 0.8)];
          this.baselineLeft = percentile("left"); this.baselineRight = percentile("right");
          // A camera started with closed eyes must not calibrate a near-zero baseline.
          this.debug.calibrated = this.baselineLeft >= 0.08 && this.baselineRight >= 0.08;
        }
        this.debug.result = "calibrating: eyes open";
      } else if (left > this.baselineLeft * 1.8 || right > this.baselineRight * 1.8) {
        this.requireReopen(); this.debug.result = "unstable geometry";
      } else {
        if (this.history.length && now - this.history[this.history.length - 1].at > 200) this.requireReopen();
        const l = left / this.baselineLeft, r = right / this.baselineRight;
        const bothOpen = l >= 0.86 && r >= 0.86;
        const bothClosed = l < 0.72 && r < 0.72;
        const previousOpen = this.history.some(v => now - v.at <= 250 && v.left >= 0.86 && v.right >= 0.86);
        if (bothOpen) {
          this.openFrames++; this.closedFrames = 0;
          this.debug.state = this.armed ? "open" : "reopening";
          if (this.openFrames >= 2 && now - this.lastBlinkAt >= 550) { this.armed = true; this.lastOpenAt = now; this.debug.state = "open"; }
          this.debug.result = this.armed ? "ready" : "await reopen / cooldown";
          this.baselineLeft = this.baselineLeft * 0.995 + left * 0.005;
          this.baselineRight = this.baselineRight * 0.995 + right * 0.005;
        } else if (bothClosed) {
          this.openFrames = 0; this.closedFrames++; this.debug.state = this.closedFrames > 1 ? "closed" : "closing";
          const rapid = previousOpen && l < 0.6 && r < 0.6;
          if (this.armed && now - this.lastOpenAt <= 350 && (rapid || this.closedFrames >= 2) && now - this.lastBlinkAt >= 550) {
            this.armed = false; this.lastBlinkAt = now; this.debug.count++; detected = true; this.debug.state = "closed";
          }
          this.debug.result = detected ? "blink" : "closed: no repeat";
        } else {
          this.openFrames = 0; this.closedFrames = 0; this.debug.state = "closing";
          this.debug.result = "partial / asymmetric: wait";
        }
        this.history.push({ left: l, right: r, at: now }); if (this.history.length > 4) this.history.shift();
      }
      Object.assign(this.debug, { baselineLeft: this.baselineLeft, baselineRight: this.baselineRight,
        closeLeft: this.baselineLeft * 0.72, closeRight: this.baselineRight * 0.72,
        reopenLeft: this.baselineLeft * 0.86, reopenRight: this.baselineRight * 0.86 });
    }
    this.debug.ms = performance.now() - started;
    return detected;
  }
}
