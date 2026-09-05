const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 正規化ランドマークの移動速度を、短い履歴だけで安定化して保持する。
export class MotionTracker {
  constructor({ smoothing = 0.3, minDeltaMs = 12, maxDeltaMs = 250, maxJump = 0.35, maxVelocity = 2.4 } = {}) {
    this.smoothing = smoothing;
    this.minDeltaMs = minDeltaMs;
    this.maxDeltaMs = maxDeltaMs;
    this.maxJump = maxJump;
    this.maxVelocity = maxVelocity;
    this.parts = new Map();
  }

  update(partName, x, y, timestamp, confidence = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || confidence < 0.45) {
      this.reset(partName);
      return 0;
    }

    const previous = this.parts.get(partName);
    if (!previous) {
      this.parts.set(partName, { x, y, timestamp, velocity: 0 });
      return 0;
    }

    const deltaMs = timestamp - previous.timestamp;
    const distance = Math.hypot(x - previous.x, y - previous.y);
    if (deltaMs < this.minDeltaMs) return previous.velocity;
    if (deltaMs > this.maxDeltaMs || distance > this.maxJump) {
      this.parts.set(partName, { x, y, timestamp, velocity: 0 });
      return 0;
    }

    const instantaneous = clamp(distance / (deltaMs / 1000), 0, this.maxVelocity);
    const velocity = previous.velocity * (1 - this.smoothing) + instantaneous * this.smoothing;
    this.parts.set(partName, { x, y, timestamp, velocity });
    return velocity;
  }

  getVelocity(partName) { return this.parts.get(partName)?.velocity || 0; }
  reset(partName) { partName ? this.parts.delete(partName) : this.parts.clear(); }
}

export const MOTION_VOLUME = Object.freeze({
  min: 0.25,
  max: 1,
  slowVelocity: 0.12,
  fastVelocity: 1.45,
});

export function velocityToVolume(velocity) {
  const range = MOTION_VOLUME.fastVelocity - MOTION_VOLUME.slowVelocity;
  const normalized = clamp((velocity - MOTION_VOLUME.slowVelocity) / range, 0, 1);
  // 中速域を広く感じられるよう、緩やかなカーブで音量へ変換する。
  const curved = Math.pow(normalized, 0.72);
  return clamp(MOTION_VOLUME.min + curved * (MOTION_VOLUME.max - MOTION_VOLUME.min), 0, 1);
}
