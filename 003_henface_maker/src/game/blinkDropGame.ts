import type { Landmark } from "../featureRenderer";

export const BLINK_DROP_PARTS = ["rightEyeSet", "leftEyeSet", "nose", "mouth"] as const;
export type BlinkDropPart = typeof BLINK_DROP_PARTS[number];
export type BlinkDropPhase = "ready" | "countdown" | "playing" | "fixing" | "paused" | "completed" | "error";

export const BLINK_DROP_LABELS: Record<BlinkDropPart, string> = {
  rightEyeSet: "右目セット", leftEyeSet: "左目セット", nose: "鼻", mouth: "口"
};

export type BlinkDropSession = {
  phase: BlinkDropPhase;
  currentIndex: number;
  fixedOffsets: Array<number | null>;
  partStartedAt: number;
  pauseStartedAt: number;
  error?: string;
};

const DROP_DURATION_MS = 2400;
const START_OFFSET = -6;
const END_OFFSET = 2;

export function createBlinkDropSession(phase: BlinkDropPhase = "ready"): BlinkDropSession {
  return { phase, currentIndex: 0, fixedOffsets: [null, null, null, null], partStartedAt: 0, pauseStartedAt: 0 };
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

export function catchBlinkDropPart(session: BlinkDropSession, now: number): BlinkDropSession {
  if (session.phase !== "playing") return session;
  const fixedOffsets = session.fixedOffsets.slice();
  fixedOffsets[session.currentIndex] = fallingOffsetAt(session, now);
  return { ...session, phase: "fixing", fixedOffsets };
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
  if (points.some(point => !point)) return null;
  const width = distance(landmarks[horizontal[0]], landmarks[horizontal[1]]);
  if (width < 0.0001) return null;
  return verticals.reduce((sum, [top, bottom]) => sum + distance(landmarks[top], landmarks[bottom]), 0) / verticals.length / width;
}

export class BlinkDetector {
  private baselineLeft = 0;
  private baselineRight = 0;
  private samples = 0;
  private armed = false;
  private lastBlinkAt = -Infinity;

  reset(): void {
    this.baselineLeft = 0; this.baselineRight = 0; this.samples = 0; this.armed = false; this.lastBlinkAt = -Infinity;
  }

  update(landmarks: readonly Landmark[] | undefined, now: number): boolean {
    if (!landmarks) return false;
    const left = eyeRatio(landmarks, [362, 263], [[386, 374], [385, 380]]);
    const right = eyeRatio(landmarks, [33, 133], [[159, 145], [158, 153]]);
    if (left === null || right === null) return false;
    if (this.samples < 4) {
      this.baselineLeft = this.samples ? this.baselineLeft * 0.7 + left * 0.3 : left;
      this.baselineRight = this.samples ? this.baselineRight * 0.7 + right * 0.3 : right;
      this.samples++;
      this.armed = this.samples >= 4;
      return false;
    }
    const bothClosed = left < this.baselineLeft * 0.58 && right < this.baselineRight * 0.58;
    const bothOpen = left > this.baselineLeft * 0.76 && right > this.baselineRight * 0.76;
    if (bothOpen) {
      this.armed = true;
      this.baselineLeft = this.baselineLeft * 0.96 + left * 0.04;
      this.baselineRight = this.baselineRight * 0.96 + right * 0.04;
    }
    if (bothClosed && this.armed && now - this.lastBlinkAt >= 550) {
      this.armed = false; this.lastBlinkAt = now; return true;
    }
    return false;
  }
}
