import type { Landmark } from "../featureRenderer";
import type { BlinkDetector } from "./blinkDropGame";

export type FaceTrigger = "BLINK" | "EYES_WIDE" | "MOUTH_OPEN" | "TAP";
export type FaceTriggerSettings = { blink: boolean; eyesWide: boolean; mouthOpen: boolean };
export const FACE_TRIGGER_OPTIONS = [
  { key: "blink", label: "瞬き" }, { key: "eyesWide", label: "目を大きく開ける" },
  { key: "mouthOpen", label: "口を大きく開ける" }
] as const;
const SETTINGS_KEY = "henface.face-triggers";
export const defaultFaceTriggers = (): FaceTriggerSettings => ({ blink: true, eyesWide: true, mouthOpen: true });
export function readFaceTriggers(): FaceTriggerSettings {
  const defaults = defaultFaceTriggers();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (saved && typeof saved === "object") for (const { key } of FACE_TRIGGER_OPTIONS) {
      if (typeof saved[key] === "boolean") defaults[key] = saved[key];
    }
  } catch { /* Unavailable storage or malformed values use the defaults. */ }
  return defaults;
}
export function saveFaceTriggers(settings: FaceTriggerSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session still works. */ }
}

// Ratios are independent of face size. Only outer thresholds are configurable;
// confirmation time and hysteresis remain in a conservative range.
export const FACE_TRIGGER_LIMITS = {
  eyesWide: 1.30, eyesNeutral: 1.12, mouthOpen: .55, mouthDelta: .35,
  mouthNeutral: .28, mouthNeutralDelta: .08, holdMs: 120, neutralMs: 80,
  cooldownMs: 450, tapDebounceMs: 650, maxSampleGapMs: 220
} as const;
type ExpressionState = "WAIT_NEUTRAL" | "ARMED" | "CONFIRMING" | "ACTIVE";
class ExpressionLatch {
  state: ExpressionState = "WAIT_NEUTRAL";
  count = 0;
  private since = -1;
  private samples = 0;
  private isNeutral = false;
  reset(): void { this.count = 0; this.disarm(); }
  disarm(): void { this.state = "WAIT_NEUTRAL"; this.since = -1; this.samples = 0; this.isNeutral = false; }
  update(valid: boolean, neutral: boolean, active: boolean, now: number, enabled: boolean): boolean {
    if (!valid) { this.disarm(); return false; }
    this.isNeutral = neutral;
    if (this.state === "WAIT_NEUTRAL" || this.state === "ACTIVE") {
      if (!neutral) { this.since = -1; this.samples = 0; return false; }
      if (this.since < 0) this.since = now;
      if (++this.samples >= 2 && now - this.since >= FACE_TRIGGER_LIMITS.neutralMs) {
        this.state = "ARMED"; this.since = -1; this.samples = 0;
      }
    } else if (active) {
      if (this.state !== "CONFIRMING") { this.state = "CONFIRMING"; this.since = now; this.samples = 0; }
      if (++this.samples >= 3 && now - this.since >= FACE_TRIGGER_LIMITS.holdMs) {
        this.state = "ACTIVE"; this.since = -1; this.samples = 0;
        if (enabled) { this.count++; return true; }
      }
    } else { this.state = "ARMED"; this.since = -1; this.samples = 0; }
    return false;
  }
  get neutral(): boolean { return this.state === "ARMED" && this.isNeutral; }
}

const length = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
export function mouthOpeningRatio(lm?: Landmark[]): number | undefined {
  if (!lm) return undefined;
  const points = [lm[61], lm[291], lm[13], lm[14]];
  if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return undefined;
  const [a, b, top, bottom] = points;
  const width = length(a, b);
  if (width < .015 || width > .5) return undefined;
  const ratio = length(top, bottom) / width;
  // Reject displaced lip geometry (e.g. reflection / a lost face landmark).
  const centerGap = Math.hypot((a.x + b.x - top.x - bottom.x) / 2, (a.y + b.y - top.y - bottom.y) / 2) / width;
  return ratio <= 1.2 && centerGap < .45 ? ratio : undefined;
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Owns expression latches and acceptance, never game state or drawing.
 * The existing BlinkDetector is used unchanged, including its calibration.
 * update consumes every sample even when gameplay does not accept events.
 */
export class FaceTriggerManager {
  readonly eyes = new ExpressionLatch();
  readonly mouth = new ExpressionLatch();
  readonly debug = { mouthRatio: 0, mouthBaseline: 0, mouthCalibrated: false,
    mouthThreshold: .55, mouthReset: .28, lastTrigger: "none" as FaceTrigger | "none",
    rejection: "準備中", ms: 0, face: false, accepted: 0 };
  thresholds = { eyesWide: Number(FACE_TRIGGER_LIMITS.eyesWide), mouthOpen: Number(FACE_TRIGGER_LIMITS.mouthOpen) };
  settings = defaultFaceTriggers();
  private mouthSamples: number[] = [];
  private mouthCalibrationStarted = -1;
  private lastSample = -Infinity;
  private lastAccept = -Infinity;
  private lastTap = -Infinity;
  private waiting = new Set<Exclude<FaceTrigger, "TAP">>();
  constructor(private readonly blink: BlinkDetector) {}
  reset(settings = this.settings): void {
    this.settings = { ...settings };
    this.eyes.reset(); this.mouth.reset(); this.blink.reset();
    this.mouthSamples.length = 0; this.mouthCalibrationStarted = -1;
    this.lastSample = this.lastAccept = this.lastTap = -Infinity; this.waiting.clear();
    Object.assign(this.debug, { mouthRatio: 0, mouthBaseline: 0, mouthCalibrated: false,
      mouthThreshold: this.thresholds.mouthOpen, mouthReset: FACE_TRIGGER_LIMITS.mouthNeutral,
      lastTrigger: "none", rejection: "準備中", ms: 0, face: false, accepted: 0 });
  }
  setThresholds(eyesWide: number, mouthOpen: number): void {
    this.thresholds.eyesWide = Math.min(1.5, Math.max(1.2, eyesWide));
    this.thresholds.mouthOpen = Math.min(.75, Math.max(.5, mouthOpen));
    this.requireNeutral();
  }
  requireNeutral(): void {
    this.blink.requireReopen(); this.eyes.disarm(); this.mouth.disarm();
    // Each detector now needs its own neutral sample. Do not make an
    // uncalibrated/disabled mouth block an otherwise valid blink.
    this.debug.face = false;
  }
  private neutral(trigger: Exclude<FaceTrigger, "TAP">): boolean {
    return trigger === "BLINK" ? this.blink.ready : trigger === "EYES_WIDE" ? this.eyes.neutral : this.mouth.neutral;
  }
  get armed(): boolean {
    const detectorReady = (this.settings.blink && this.blink.ready) ||
      (this.settings.eyesWide && this.eyes.neutral) || (this.settings.mouthOpen && this.mouth.neutral);
    return this.debug.face && detectorReady && this.waiting.size === 0 && this.lastSample - this.lastAccept >= FACE_TRIGGER_LIMITS.cooldownMs;
  }
  update(lm: Landmark[] | undefined, now: number, accepting: boolean, blinkOnly = false): FaceTrigger | undefined {
    const start = performance.now();
    const blinkHit = this.blink.update(lm, now, accepting && this.settings.blink);
    const d = this.blink.debug;
    const gap = now - this.lastSample > FACE_TRIGGER_LIMITS.maxSampleGapMs;
    if (gap) { this.eyes.disarm(); this.mouth.disarm(); }
    this.lastSample = now; this.debug.face = d.face;
    const l = d.left / (d.baselineLeft || 1), r = d.right / (d.baselineRight || 1);
    const eyeValid = d.face && d.calibrated && l <= 2 && r <= 2 && Math.abs(l - r) < .45;
    const eyeHit = this.eyes.update(eyeValid, l >= .84 && r >= .84 && l <= FACE_TRIGGER_LIMITS.eyesNeutral && r <= FACE_TRIGGER_LIMITS.eyesNeutral,
      l >= this.thresholds.eyesWide && r >= this.thresholds.eyesWide, now, accepting && this.settings.eyesWide && !blinkOnly);
    const mouthRatio = mouthOpeningRatio(lm);
    const validMouth = d.face && mouthRatio !== undefined && (!d.calibrated || eyeValid);
    this.debug.mouthRatio = mouthRatio ?? 0;
    if (!validMouth || gap) {
      this.mouthSamples.length = 0; this.mouthCalibrationStarted = -1;
    }
    if (validMouth && !this.debug.mouthCalibrated && mouthRatio <= .30) {
      if (this.mouthCalibrationStarted < 0) this.mouthCalibrationStarted = now;
      this.mouthSamples.push(mouthRatio);
      if (this.mouthSamples.length > 32) this.mouthSamples.shift();
      if (this.mouthSamples.length >= 12 && now - this.mouthCalibrationStarted >= 400) {
        const m = median(this.mouthSamples), mad = median(this.mouthSamples.map(v => Math.abs(v - m)));
        const trimmed = this.mouthSamples.filter(v => Math.abs(v - m) <= Math.max(.025, mad * 3));
        if (trimmed.length >= 8) { this.debug.mouthBaseline = median(trimmed); this.debug.mouthCalibrated = true; }
      }
    }
    this.debug.mouthThreshold = Math.max(this.thresholds.mouthOpen, this.debug.mouthBaseline + FACE_TRIGGER_LIMITS.mouthDelta);
    this.debug.mouthReset = Math.max(FACE_TRIGGER_LIMITS.mouthNeutral, this.debug.mouthBaseline + FACE_TRIGGER_LIMITS.mouthNeutralDelta);
    const mouthHit = this.mouth.update(validMouth && this.debug.mouthCalibrated, validMouth && mouthRatio <= this.debug.mouthReset,
      validMouth && mouthRatio >= this.debug.mouthThreshold, now, accepting && this.settings.mouthOpen && !blinkOnly);
    for (const trigger of this.waiting) if (this.neutral(trigger)) this.waiting.delete(trigger);
    const trigger = blinkHit ? "BLINK" : eyeHit ? "EYES_WIDE" : mouthHit ? "MOUTH_OPEN" : undefined;
    if (trigger) this.debug.lastTrigger = trigger;
    this.debug.ms = performance.now() - start;
    if (!accepting) { this.debug.rejection = "進行外 / 確定中 / 一時停止"; return; }
    // The existing 10-blink measurement uses the detector's own 240ms
    // cooldown, not gameplay's 450ms fixing/acceptance window.
    if (blinkOnly) return blinkHit ? "BLINK" : undefined;
    if (trigger && this.canFix(trigger, "playing", now)) return trigger;
  }
  canFix(trigger: FaceTrigger, phase: string, now: number): boolean {
    const reason = phase !== "playing" ? "プレイ中以外 / 確定中" :
      !this.debug.face || now - this.lastSample > FACE_TRIGGER_LIMITS.maxSampleGapMs ? "顔未検出 / 検出が古い" :
      trigger === "TAP" ? (now - this.lastTap < FACE_TRIGGER_LIMITS.tapDebounceMs ? "タップ連打待機" : "") :
      (trigger === "BLINK" && !this.settings.blink) || (trigger === "EYES_WIDE" && !this.settings.eyesWide) || (trigger === "MOUTH_OPEN" && !this.settings.mouthOpen) ? "操作OFF" :
      this.waiting.size ? "表情のニュートラル復帰待ち: " + [...this.waiting].join(", ") :
      now - this.lastAccept < FACE_TRIGGER_LIMITS.cooldownMs ? "共通クールダウン" : "";
    this.debug.rejection = reason || "受付可";
    return !reason;
  }
  accept(trigger: FaceTrigger, now: number): void {
    this.lastAccept = now; this.debug.lastTrigger = trigger; this.debug.accepted++;
    this.debug.rejection = "固定 / ニュートラル復帰待ち";
    if (trigger === "TAP") { this.lastTap = now; this.blink.requireReopen(); }
    // Include concurrent expressions so a held expression cannot catch the
    // next turn, but never wait for unrelated or disabled detectors.
    if (this.settings.blink && (trigger === "BLINK" || this.blink.debug.state === "CLOSED" || this.blink.debug.state === "CLOSING")) this.waiting.add("BLINK");
    if (this.settings.eyesWide && (trigger === "EYES_WIDE" || this.eyes.state === "ACTIVE" || this.eyes.state === "CONFIRMING")) this.waiting.add("EYES_WIDE");
    if (this.settings.mouthOpen && (trigger === "MOUTH_OPEN" || this.mouth.state === "ACTIVE" || this.mouth.state === "CONFIRMING")) this.waiting.add("MOUTH_OPEN");
  }
}
