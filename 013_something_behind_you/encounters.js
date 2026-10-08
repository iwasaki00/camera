export const ENCOUNTER_CONFIG = Object.freeze({
  weights: { PEEK: 50, PASS: 30, FLY_BY: 15, CLOSE_CALL: 5 },
  minEncounterDelay: 3000,
  maxEncounterDelay: 11000,
  cooldownMin: 1800,
  cooldownMax: 4200,
  quietChance: 0.2,
  quietExtraDelay: 8000,
  consecutiveLimit: 2,
  peekMaxDuration: 6500,
  peekArmingTimeout: 16000,
  peekThresholds: [36, 24],
  peekSizes: [0.96, 1, 1.04],
  peekTranslations: [91, 79, 67],
  passDuration: 280,
  passSpeed: 1,
  flyByDuration: 340,
  flyByScale: [2.3, 0.18],
  closeCallDuration: 160,
  closeCallSize: 2.8
});

// 時刻を引数として受け取り、タイマーを増やさず1件ずつ管理する。
export class EncounterDirector {
  constructor(config = ENCOUNTER_CONFIG, random = Math.random) {
    this.config = config;
    this.random = random;
    this.reset();
  }

  reset() {
    this.state = "IDLE";
    this.currentEncounter = null;
    this.previousEncounter = null;
    this.consecutive = 0;
    this.deadline = null;
    this.eventStartedAt = null;
    this.armedAt = null;
  }

  between(min, max) { return min + this.random() * (max - min); }

  choose() {
    const entries = Object.entries(this.config.weights).filter(([type, weight]) =>
      weight > 0 && !(type === this.previousEncounter &&
        (type === "CLOSE_CALL" || this.consecutive >= this.config.consecutiveLimit)));
    let draw = this.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [type, weight] of entries) {
      draw -= weight;
      if (draw < 0) return type;
    }
    return entries.at(-1)?.[0] || "PEEK";
  }

  update(now) {
    if (this.state === "IDLE") {
      this.state = "ARMING";
      this.deadline = now + this.between(this.config.minEncounterDelay, this.config.maxEncounterDelay)
        + (this.random() < this.config.quietChance ? this.config.quietExtraDelay : 0);
      this.armedAt = null;
    }
    if (this.state === "COOLDOWN" && now >= this.deadline) {
      this.state = "IDLE";
      return null;
    }
    if (this.state === "ARMING" && now >= this.deadline && !this.currentEncounter) {
      this.currentEncounter = this.choose();
      this.armedAt = now;
      return this.currentEncounter;
    }
    return null;
  }

  force(type, now) {
    if (!(type in this.config.weights) || this.state === "EVENT" || this.currentEncounter) return false;
    this.state = "ARMING";
    this.currentEncounter = type;
    this.armedAt = now;
    return true;
  }

  begin(now) {
    if (!this.currentEncounter || this.state !== "ARMING") return false;
    this.state = "EVENT";
    this.eventStartedAt = now;
    return true;
  }

  finish(now) {
    if (!this.currentEncounter) return;
    this.consecutive = this.previousEncounter === this.currentEncounter ? this.consecutive + 1 : 1;
    this.previousEncounter = this.currentEncounter;
    this.currentEncounter = null;
    this.eventStartedAt = null;
    this.state = "COOLDOWN";
    this.deadline = now + this.between(this.config.cooldownMin, this.config.cooldownMax);
  }
}
