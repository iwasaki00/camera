// 距離・接近・段階別演出の実機調整値。
export const STALKER_CONFIG = Object.freeze({
  initialDistance: 85,
  minimumDistance: 5,
  maximumDistance: 100,
  lookingAngle: 35,
  notLookingGraceMs: 1200,
  spottedRetreatDistance: 15,
  maxDeltaMs: 100,
  profiles: {
    FAR: { minimum: 75, preset: 85, approachRate: 0.67,
      weights: { PEEK: 65, PASS: 25, FLY_BY: 8, CLOSE_CALL: 2 },
      minEncounterDelay: 5000, maxEncounterDelay: 13000,
      peekScale: 0.86, peekOutside: 85, passScale: 0.7, flyByScale: 0.8, closeCallScale: 0.78 },
    MID: { minimum: 45, preset: 60, approachRate: 0.87,
      weights: { PEEK: 50, PASS: 30, FLY_BY: 15, CLOSE_CALL: 5 },
      minEncounterDelay: 4000, maxEncounterDelay: 10000,
      peekScale: 1, peekOutside: 70, passScale: 1, flyByScale: 1, closeCallScale: 1 },
    NEAR: { minimum: 20, preset: 35, approachRate: 1.25,
      weights: { PEEK: 40, PASS: 30, FLY_BY: 20, CLOSE_CALL: 10 },
      minEncounterDelay: 3000, maxEncounterDelay: 8000,
      peekScale: 1.12, peekOutside: 55, passScale: 1.18, flyByScale: 1.15, closeCallScale: 1.12 },
    DANGER: { minimum: 5, preset: 10, approachRate: 1.67,
      weights: { PEEK: 30, PASS: 25, FLY_BY: 25, CLOSE_CALL: 20 },
      minEncounterDelay: 2500, maxEncounterDelay: 6000,
      peekScale: 1.24, peekOutside: 42, passScale: 1.35, flyByScale: 1.3, closeCallScale: 1.25 }
  }
});

export class Stalker {
  constructor(config = STALKER_CONFIG) {
    this.config = config;
    this.reset();
  }

  get distanceState() {
    return Object.keys(this.config.profiles).find(name => this.distance >= this.config.profiles[name].minimum) || "DANGER";
  }
  get profile() { return this.config.profiles[this.distanceState]; }
  get nextThreshold() { return this.profile.minimum; }
  get inGrace() { return !this.paused && this.looking === false && this.notLookingMs < this.config.notLookingGraceMs; }
  get approachRate() {
    return !this.paused && this.looking === false && !this.inGrace && this.distance > this.config.minimumDistance
      ? this.profile.approachRate : 0;
  }

  reset() { this.setDistance(this.config.initialDistance); }
  setDistance(value) {
    if (!Number.isFinite(value)) return;
    this.distance = Math.min(this.config.maximumDistance, Math.max(this.config.minimumDistance, value));
    this.pause();
  }
  setRange(name) {
    if (!this.config.profiles[name]) return false;
    this.setDistance(this.config.profiles[name].preset);
    return true;
  }
  pause() {
    this.paused = true;
    this.looking = null;
    this.notLookingMs = 0;
  }
  retreat() {
    this.distance = Math.min(this.config.maximumDistance, this.distance + this.config.spottedRetreatDistance);
    this.notLookingMs = 0;
  }

  update(elapsedMs, angleDiff, active) {
    if (!active || !Number.isFinite(angleDiff) || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      this.pause();
      return;
    }
    const dt = Math.min(elapsedMs, this.config.maxDeltaMs);
    this.paused = false;
    this.looking = Math.abs(angleDiff) <= this.config.lookingAngle;
    if (this.looking) { this.notLookingMs = 0; return; }
    const previous = this.notLookingMs;
    this.notLookingMs += dt;
    let seconds = Math.max(0, this.notLookingMs - Math.max(previous, this.config.notLookingGraceMs)) / 1000;
    // 境界を越えるフレームも段階ごとの速度で積分する。
    while (seconds > 0 && this.distance > this.config.minimumDistance) {
      const profile = this.profile;
      const boundary = profile.minimum;
      const toBoundary = (this.distance - boundary) / profile.approachRate;
      if (toBoundary >= seconds || this.distanceState === "DANGER") {
        this.distance = Math.max(this.config.minimumDistance, this.distance - seconds * profile.approachRate);
        break;
      }
      seconds -= toBoundary;
      this.distance = boundary - 1e-9;
    }
  }
}
