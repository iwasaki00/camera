import { clamp, normalizeDegrees, signedAngleDifference } from "./logic.js";

export const PRESENCE_CONFIG = Object.freeze({
  initialVolume: 0.55,
  maximumGain: 0.12,
  maxPan: 0.7,
  behindGain: 0.75,
  behindCutoff: 1200,
  yawOffset: 15,
  lookingChance: 0.35,
  quietChance: 0.25,
  quietExtraMs: 7000,
  cooldownMin: 1800,
  cooldownMax: 3500,
  breathCooldownMs: 12000,
  baitChance: 0.3,
  baitDurationMs: 3200,
  baitMinDelayMs: 250,
  baitAngle: 46,
  profiles: {
    FAR: { weights: { RUSTLE: 70, FOOTSTEP: 20, TAP: 10, BREATH: 0 }, delay: [8000, 18000] },
    MID: { weights: { RUSTLE: 50, FOOTSTEP: 30, TAP: 18, BREATH: 2 }, delay: [6000, 14000] },
    NEAR: { weights: { RUSTLE: 35, FOOTSTEP: 35, TAP: 20, BREATH: 10 }, delay: [4000, 10000] },
    DANGER: { weights: { RUSTLE: 25, FOOTSTEP: 30, TAP: 20, BREATH: 25 }, delay: [3000, 8000] }
  },
  sounds: {
    RUSTLE: { duration: 220, attack: 0.012, peak: 0.65, frequency: 1600 },
    FOOTSTEP: { duration: 180, attack: 0.008, peak: 0.75, frequency: 90 },
    TAP: { duration: 120, attack: 0.005, peak: 0.55, frequency: 340 },
    BREATH: { duration: 700, attack: 0.09, peak: 0.45, frequency: 650 }
  }
});

export function presenceSpatial(angle, distance, config = PRESENCE_CONFIG) {
  if (!Number.isFinite(angle) || !Number.isFinite(distance)) return null;
  const diff = signedAngleDifference(angle, 0);
  const absolute = Math.abs(diff);
  const direction = absolute >= 125 ? "BEHIND" : absolute <= 35 ? "FRONT" : diff < 0 ? "LEFT" : "RIGHT";
  const proximity = clamp((100 - distance) / 95, 0, 1);
  return {
    direction,
    pan: clamp(Math.sin(diff * Math.PI / 180) * config.maxPan, -config.maxPan, config.maxPan),
    gain: (0.12 + proximity * 0.88) * (direction === "BEHIND" ? config.behindGain : 1),
    cutoff: direction === "BEHIND" ? config.behindCutoff : 2600 + proximity * 2200
  };
}

// 映像Directorを操作せず、再生候補と短命の誘導候補だけを返す。
export class PresenceDirector {
  constructor(config = PRESENCE_CONFIG, random = Math.random) {
    this.config = config;
    this.random = random;
    this.reset();
  }
  reset() {
    this.state = "IDLE";
    this.currentPresence = null;
    this.previousPresence = null;
    this.consecutive = 0;
    this.deadline = null;
    this.endAt = null;
    this.lastBreathAt = -Infinity;
    this.lastEvent = null;
    this.range = null;
    this.bait = null;
  }
  pause() {
    this.state = "IDLE";
    this.currentPresence = null;
    this.deadline = null;
    this.endAt = null;
    this.bait = null;
  }
  between(min, max) { return min + this.random() * (max - min); }
  wait(now, range) {
    this.range = range;
    const profile = this.config.profiles[range];
    this.state = "WAITING";
    this.deadline = now + this.between(...profile.delay)
      + (this.random() < this.config.quietChance ? this.config.quietExtraMs : 0);
  }
  choose(now, range) {
    const entries = Object.entries(this.config.profiles[range].weights).filter(([type, weight]) => weight > 0
      && !(type === this.previousPresence && (type === "BREATH" || this.consecutive >= 2))
      && !(type === "BREATH" && now - this.lastBreathAt < this.config.breathCooldownMs));
    let value = this.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [type, weight] of entries) { value -= weight; if (value < 0) return type; }
    return "RUSTLE";
  }
  update(now, input) {
    if (!input.active) { this.pause(); return null; }
    this.expireBait(now, input.entityYaw);
    if (this.state === "PLAYING") {
      if (now >= this.endAt) {
        this.currentPresence = null;
        this.state = "COOLDOWN";
        this.deadline = now + this.between(this.config.cooldownMin, this.config.cooldownMax);
      }
      return null;
    }
    if (this.state === "COOLDOWN") {
      if (now >= this.deadline) this.wait(now, input.range);
      return null;
    }
    if (this.state === "IDLE" || this.range !== input.range) this.wait(now, input.range);
    if (now < this.deadline) return null;
    // 強い映像の間は音を貯めず、次の静かな待機へ送る。
    if (input.strongEncounter || (input.looking && this.random() >= this.config.lookingChance)) {
      this.wait(now, input.range);
      return null;
    }
    return { type: this.choose(now, input.range),
      yaw: normalizeDegrees(input.entityYaw + this.between(-this.config.yawOffset, this.config.yawOffset)) };
  }
  played(event, now, input, allowBait = true) {
    this.bait = null;
    this.currentPresence = event.type;
    this.consecutive = this.previousPresence === event.type ? this.consecutive + 1 : 1;
    this.previousPresence = event.type;
    this.lastEvent = event;
    if (event.type === "BREATH") this.lastBreathAt = now;
    this.state = "PLAYING";
    this.endAt = now + this.config.sounds[event.type].duration;
    if (allowBait && Math.abs(signedAngleDifference(input.entityYaw, input.relativeYaw)) > this.config.baitAngle
      && this.random() < this.config.baitChance) {
      this.bait = { entityYaw: input.entityYaw, soundYaw: event.yaw, readyAt: now + this.config.baitMinDelayMs,
        expiresAt: now + this.config.baitDurationMs };
    }
  }
  expireBait(now, entityYaw) {
    if (this.bait && (now >= this.bait.expiresAt || !Number.isFinite(entityYaw)
      || Math.abs(signedAngleDifference(entityYaw, this.bait.entityYaw)) > 0.01)) this.bait = null;
  }
  consumeBait(now, input) {
    this.expireBait(now, input.entityYaw);
    if (!this.bait || !input.active || !input.canPeek || now < this.bait.readyAt) return false;
    if (Math.abs(signedAngleDifference(this.bait.soundYaw, input.relativeYaw)) > this.config.baitAngle
      || Math.abs(signedAngleDifference(input.entityYaw, input.relativeYaw)) > this.config.baitAngle) return false;
    this.bait = null;
    return true;
  }
}
