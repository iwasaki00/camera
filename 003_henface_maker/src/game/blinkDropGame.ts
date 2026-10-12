import type { Landmark, Point } from "../featureRenderer";
import type { GameMode, ChallengeRun } from "./faceChallenge";

export const BLINK_DROP_PARTS = ["rightEye", "leftEye", "nose", "mouth"] as const;
export type BlinkDropPart = typeof BLINK_DROP_PARTS[number];
export const BLINK_DROP_DIFFICULTIES = ["EASY", "NORMAL", "HARD", "CHAOS", "MONSTER"] as const;
export type BlinkDropDifficulty = typeof BLINK_DROP_DIFFICULTIES[number];
export const DIFFICULTY_MODES = {
  EASY: { durationMs: 5000, sway: 0, rotation: 0, scale: 0, description: "ゆっくり垂直落下" },
  NORMAL: { durationMs: 2400, sway: 0, rotation: 0, scale: 0, description: "従来の垂直落下" },
  HARD: { durationMs: 2000, sway: 0, rotation: 0, scale: 0, description: "高速垂直落下" },
  CHAOS: { durationMs: 2500, sway: 0.10, rotation: 0, scale: 0, description: "高速落下＋左右に揺れる" },
  MONSTER: { durationMs: 1500, sway: 0.16, rotation: Math.PI * 25 / 180, scale: 0.2, description: "高速落下＋左右移動・回転・サイズ変化" }
} as const;
export type FallingState = {
  progress: number;
  verticalOffset: number; // Existing per-part drop-height units.
  horizontalOffset: number; // Fraction of the tracked face width.
  rotation: number; // Radians relative to the face.
  scale: number;
  elapsedTime: number; // Active milliseconds, excluding pauses.
  difficulty: BlinkDropDifficulty;
};
export type FixedPartTransform = Pick<FallingState, "horizontalOffset" | "rotation" | "scale"> & { partType: BlinkDropPart };
export type BlinkDropPhase = "ready" | "countdown" | "playing" | "fixing" | "paused" | "completed" | "error";

export const BLINK_DROP_LABELS: Record<BlinkDropPart, string> = {
  rightEye: "右目と眉", leftEye: "左目と眉", nose: "鼻", mouth: "口"
};

export type BlinkDropSession = {
  gameMode: GameMode;
  challenge?: ChallengeRun;
  phase: BlinkDropPhase;
  difficulty: BlinkDropDifficulty;
  currentIndex: number;
  fixedOffsets: Array<number | null>;
  fixedPositions: Array<Point | null>; // Target center in face-local units (eye separation = 1).
  fixedBrowOffsets: Array<Point | null>;
  fixedTransforms: Array<FixedPartTransform | null>;
  partStartedAt: number;
  pauseStartedAt: number;
  countdownStartedAt: number;
  fixingStartedAt: number;
  pausedPhase?: "countdown" | "playing" | "fixing";
  error?: string;
};

const START_OFFSET = -6;
const END_OFFSET = 2;

export function createBlinkDropSession(phase: BlinkDropPhase = "ready", difficulty: BlinkDropDifficulty = "NORMAL"): BlinkDropSession {
  return { phase, difficulty, gameMode: "free", currentIndex: 0, fixedOffsets: [null, null, null, null], fixedPositions: [null, null, null, null],
    fixedTransforms: [null, null, null, null],
    fixedBrowOffsets: [null, null, null, null], partStartedAt: 0, pauseStartedAt: 0, countdownStartedAt: 0, fixingStartedAt: 0 };
}

export function startBlinkDropCountdown(now = performance.now(), difficulty: BlinkDropDifficulty = "NORMAL"): BlinkDropSession {
  return { ...createBlinkDropSession("countdown", difficulty), countdownStartedAt: now };
}

export function countdownLabel(session: BlinkDropSession, now: number): string {
  const at = session.phase === "paused" ? session.pauseStartedAt : now;
  const remaining = Math.ceil((3000 - Math.max(0, at - session.countdownStartedAt)) / 1000);
  return remaining > 0 ? String(remaining) : "START!";
}

export function beginBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  return { ...session, phase: "playing", partStartedAt: now, pauseStartedAt: 0 };
}

export function fallingStateAt(session: BlinkDropSession, now: number): FallingState {
  const fixed = session.phase === "fixing" || session.phase === "completed" ||
    (session.phase === "paused" && session.pausedPhase === "fixing");
  const sampleAt = fixed ? session.fixingStartedAt : session.phase === "paused" ? session.pauseStartedAt : now;
  const elapsed = Math.max(0, sampleAt - session.partStartedAt);
  const mode = DIFFICULTY_MODES[session.difficulty];
  const progress = (elapsed % mode.durationMs) / mode.durationMs;
  const angle = progress * Math.PI * 2;
  return { progress, verticalOffset: START_OFFSET + (END_OFFSET - START_OFFSET) * progress,
    horizontalOffset: mode.sway ? mode.sway * Math.sin(angle * 2) : 0,
    rotation: mode.rotation ? mode.rotation * Math.sin(angle) : 0,
    scale: mode.scale ? 1 + mode.scale * Math.cos(angle) : 1, elapsedTime: elapsed, difficulty: session.difficulty };
}

export function fallingOffsetAt(session: BlinkDropSession, now: number): number {
  return fallingStateAt(session, now).verticalOffset;
}

export function catchBlinkDropPart(session: BlinkDropSession, now: number, position?: Point, browOffset?: Point): BlinkDropSession {
  if (session.phase !== "playing") return session;
  const motion = fallingStateAt(session, now);
  const fixedOffsets = session.fixedOffsets.slice();
  fixedOffsets[session.currentIndex] = motion.verticalOffset;
  const fixedPositions = session.fixedPositions.slice();
  fixedPositions[session.currentIndex] = position ?? null;
  const fixedBrowOffsets = session.fixedBrowOffsets.slice(); fixedBrowOffsets[session.currentIndex] = browOffset ?? null;
  const fixedTransforms = session.fixedTransforms.slice();
  fixedTransforms[session.currentIndex] = { partType: BLINK_DROP_PARTS[session.currentIndex],
    horizontalOffset: motion.horizontalOffset, rotation: motion.rotation, scale: motion.scale };
  return { ...session, phase: "fixing", fixingStartedAt: now, fixedOffsets, fixedPositions, fixedBrowOffsets, fixedTransforms };
}

export function advanceBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  if (session.phase !== "fixing") return session;
  if (session.currentIndex >= BLINK_DROP_PARTS.length - 1) return { ...session, phase: "completed" };
  return { ...session, phase: "playing", currentIndex: session.currentIndex + 1, partStartedAt: now };
}

export function pauseBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  return session.phase === "playing" || session.phase === "countdown" || session.phase === "fixing"
    ? { ...session, phase: "paused", pausedPhase: session.phase, pauseStartedAt: now } : session;
}

export function resumeBlinkDrop(session: BlinkDropSession, now: number): BlinkDropSession {
  if (session.phase !== "paused") return session;
  const elapsed = Math.max(0, now - session.pauseStartedAt);
  return { ...session, phase: session.pausedPhase ?? "playing", pausedPhase: undefined,
    partStartedAt: session.partStartedAt + elapsed, countdownStartedAt: session.countdownStartedAt + elapsed,
    fixingStartedAt: session.fixingStartedAt + elapsed, pauseStartedAt: 0 };
}

export function blinkDropScore(session: BlinkDropSession): { accuracy: number; funny: number; title: string } {
  const values = session.fixedOffsets.flatMap((offset, index) => {
    if (offset === null) return [];
    const transform = session.fixedTransforms[index];
    // Keep vertical-only scores exact; add bounded face-relative errors for the new modes.
    if (!transform || (transform.horizontalOffset === 0 && transform.rotation === 0 && transform.scale === 1)) return [Math.abs(offset)];
    return [Math.hypot(offset, transform.horizontalOffset * 6, transform.rotation / (Math.PI / 4), (transform.scale - 1) * 4)];
  });
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

export type BlinkState = "OPEN" | "CLOSING" | "CLOSED" | "WAIT_REOPEN" | "COOLDOWN";
export type BlinkSensitivity = "low" | "normal" | "high";
const SENSITIVITY = {
  low: { close: 0.64, reopen: 0.84, rapid: 0.55 },
  normal: { close: 0.74, reopen: 0.82, rapid: 0.62 },
  high: { close: 0.79, reopen: 0.84, rapid: 0.67 }
};
const COOLDOWN_MS = 240;

export class BlinkDetector {
  private baselineLeft = 0;
  private baselineRight = 0;
  private calibration: Array<{ left: number; right: number; at: number }> = [];
  private history: Array<{ left: number; right: number; at: number }> = [];
  private state: BlinkState = "WAIT_REOPEN";
  private lastClosedAt = -Infinity;
  private lastSampleAt = -Infinity;
  private openFrames = 0;
  private closedFrames = 0;
  private sensitivity: BlinkSensitivity = "normal";
  readonly debug = { left: 0, right: 0, baselineLeft: 0, baselineRight: 0,
    closeLeft: 0, closeRight: 0, reopenLeft: 0, reopenRight: 0, armed: false,
    count: 0, state: "WAIT_REOPEN" as BlinkState, result: "calibrating", face: false,
    calibrated: false, lastDetectedAt: -1, ms: 0 };

  reset(): void {
    this.baselineLeft = 0; this.baselineRight = 0; this.calibration = []; this.history = [];
    this.lastClosedAt = -Infinity; this.lastSampleAt = -Infinity; this.requireReopen();
    Object.assign(this.debug, { left: 0, right: 0, baselineLeft: 0, baselineRight: 0, closeLeft: 0, closeRight: 0,
      reopenLeft: 0, reopenRight: 0, count: 0, result: "calibrating", face: false, calibrated: false, lastDetectedAt: -1, ms: 0 });
  }

  setSensitivity(value: BlinkSensitivity): void { this.sensitivity = value; this.requireReopen(); this.thresholds(); }
  requireReopen(): void {
    this.state = "WAIT_REOPEN"; this.openFrames = 0; this.closedFrames = 0; this.history = [];
    this.debug.state = this.state; this.debug.armed = false;
  }
  get ready(): boolean { return this.state === "OPEN" && this.debug.face && this.debug.calibrated; }

  private thresholds(): void {
    const t = SENSITIVITY[this.sensitivity];
    Object.assign(this.debug, { baselineLeft: this.baselineLeft, baselineRight: this.baselineRight,
      closeLeft: this.baselineLeft * t.close, closeRight: this.baselineRight * t.close,
      reopenLeft: this.baselineLeft * t.reopen, reopenRight: this.baselineRight * t.reopen });
  }

  private calibrate(side: "left" | "right"): number {
    const sorted = this.calibration.map(v => v[side]).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const tolerance = Math.max(0.025, deviations[Math.floor(deviations.length / 2)] * 3);
    const valid = sorted.filter(v => v >= median * 0.72 && Math.abs(v - median) <= tolerance);
    return valid.length >= 6 ? valid[Math.floor(valid.length * 0.6)] : 0;
  }

  update(landmarks: readonly Landmark[] | undefined, now: number, allowEvent = true): boolean {
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
        if (this.calibration.length > 32) this.calibration.shift();
        if (this.calibration.length >= 12 && now - this.calibration[0].at >= 400) {
          this.baselineLeft = this.calibrate("left"); this.baselineRight = this.calibrate("right");
          this.debug.calibrated = this.baselineLeft >= 0.08 && this.baselineRight >= 0.08;
        }
        this.debug.result = "calibrating: eyes open";
      } else if (left > this.baselineLeft * 1.6 || right > this.baselineRight * 1.6) {
        this.requireReopen(); this.debug.result = "unstable geometry";
      } else {
        if (now - this.lastSampleAt > 220) this.requireReopen();
        const l = left / this.baselineLeft, r = right / this.baselineRight, t = SENSITIVITY[this.sensitivity];
        const bothOpen = l >= t.reopen && r >= t.reopen;
        const bothClosed = l < t.close && r < t.close;
        const previousOpen = this.history.some(v => now - v.at <= 250 && v.left >= t.reopen && v.right >= t.reopen);
        if (this.state === "CLOSED") this.state = "WAIT_REOPEN";
        if (this.state === "WAIT_REOPEN") {
          this.openFrames = bothOpen ? this.openFrames + 1 : 0;
          this.debug.result = bothOpen ? "confirming reopen" : "await bilateral reopen";
          if (this.openFrames >= 2) {
            this.state = now - this.lastClosedAt >= COOLDOWN_MS ? "OPEN" : "COOLDOWN";
            this.debug.result = this.state === "OPEN" ? "ready" : "reopened: cooldown";
          }
        } else if (this.state === "COOLDOWN") {
          // Reopen is latched before the deadline; no second calibration/rearm gate.
          if (!bothOpen) { this.state = "WAIT_REOPEN"; this.openFrames = 0; this.debug.result = "closure during cooldown"; }
          else if (now - this.lastClosedAt >= COOLDOWN_MS) { this.state = "OPEN"; this.debug.result = "ready"; }
        } else if (this.state === "OPEN" || this.state === "CLOSING") {
          if (bothOpen) {
            this.state = "OPEN"; this.closedFrames = 0; this.debug.result = "ready";
            const stable = l >= 0.94 && r >= 0.94 && l < 1.15 && r < 1.15 &&
              this.history.length >= 2 && this.history.slice(-2).every(v => Math.abs(v.left - l) < 0.06 && Math.abs(v.right - r) < 0.06);
            if (stable) {
              this.baselineLeft = this.baselineLeft * 0.995 + left * 0.005;
              this.baselineRight = this.baselineRight * 0.995 + right * 0.005;
            }
          } else {
            this.state = "CLOSING"; this.closedFrames = bothClosed ? this.closedFrames + 1 : 0;
            const rapid = bothClosed && previousOpen && l < t.rapid && r < t.rapid;
            this.debug.result = bothClosed ? "confirming closure" : "partial / asymmetric";
            if (rapid || this.closedFrames >= 2) {
              this.state = "CLOSED"; this.lastClosedAt = now; this.openFrames = 0; this.closedFrames = 0;
              this.debug.result = allowEvent ? "blink" : "suppressed: game not accepting";
              if (allowEvent) { this.debug.count++; this.debug.lastDetectedAt = now; detected = true; }
            }
          }
        }
        this.history.push({ left: l, right: r, at: now }); if (this.history.length > 4) this.history.shift();
      }
    }
    this.lastSampleAt = now; this.thresholds();
    this.debug.state = this.state; this.debug.armed = this.ready;
    this.debug.ms = performance.now() - started;
    return detected;
  }
}
