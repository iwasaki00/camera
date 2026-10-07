export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDegrees(value) {
  if (!Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}

export function signedAngleDifference(target, current) {
  if (!Number.isFinite(target) || !Number.isFinite(current)) return null;
  return ((target - current + 540) % 360) - 180;
}

export function relativeHeading(current, initial) {
  return signedAngleDifference(current, initial);
}

export function turnSpeed(current, previous, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const delta = signedAngleDifference(current, previous);
  return delta === null ? 0 : delta * 1000 / elapsedMs;
}

export function sideFromDifference(angleDifference, fallback = "RIGHT") {
  if (!Number.isFinite(angleDifference) || angleDifference === 0) return fallback;
  return angleDifference > 0 ? "RIGHT" : "LEFT";
}

export function peripheralReveal(angleDifference, enterAngle, spottedAngle) {
  if (!Number.isFinite(angleDifference)) return 0;
  const distance = Math.abs(angleDifference);
  const range = Math.max(1, enterAngle - spottedAngle);
  return clamp((enterAngle - distance) / range, 0, 1);
}

export function chooseRelocatedYaw(currentYaw, minimumSeparation, random = Math.random) {
  const safeCurrent = Number.isFinite(currentYaw) ? currentYaw : 0;
  const separation = minimumSeparation + random() * (180 - minimumSeparation);
  const direction = random() < 0.5 ? -1 : 1;
  return normalizeDegrees(safeCurrent + separation * direction);
}
