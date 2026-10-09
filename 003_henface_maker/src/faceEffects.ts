import type { EffectState, FeatureType, FeatureRegion, Point, TransformOptions } from "./featureRenderer";
import type { RandomStrength } from "./uiSettings";
export const PLACEMENTS = {
  none: "なし", gather: "中央集合", spread: "外側拡散", compress: "上下圧縮", expand: "上下拡張",
  close: "左右接近", separate: "左右分離", up: "上寄せ", down: "下寄せ"
} as const;
export type PlacementMode = keyof typeof PLACEMENTS;
export const SPECIALS = { thickBrows: "極太眉", connectedBrows: "つながり眉", crossedEyes: "寄り目", flatNose: "潰れ鼻", crookedMouth: "歪み口", lowerFace: "下顔面拡大", imbalance: "上下面アンバランス" } as const;
export type SpecialKey = keyof typeof SPECIALS;
export type FaceEffects = {
  placement: { mode: PlacementMode; strength: number; horizontal: number; vertical: number };
  special: Record<SpecialKey, number>;
};
export const emptyFaceEffects = (): FaceEffects => ({ placement: { mode: "none", strength: 0.5, horizontal: 1, vertical: 1 },
  special: { thickBrows: 0, connectedBrows: 0, crossedEyes: 0, flatNose: 0, crookedMouth: 0, lowerFace: 0, imbalance: 0 } });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function specialConfig(state: EffectState, feature: FeatureType, effects: FaceEffects) {
  const s = effects.special, c = { ...state[feature] };
  // Thick brows are rendered later from the original brow texture. Stretching this
  // region would also stretch forehead skin and creates the pasted-on look.
  if (feature === "nose") { c.scaleX *= 1 + s.flatNose * 0.35; c.scaleY *= 1 - s.flatNose * 0.4; }
  if (feature === "eyes" || feature === "brows") c.size *= 1 - s.imbalance * 0.12;
  if (feature === "mouth") { c.scaleX *= 1 + s.lowerFace * 0.15 + s.imbalance * 0.12; c.scaleY *= 1 + s.imbalance * 0.12; }
  return c;
}
export function placementOffset(feature: FeatureType, region: FeatureRegion, center: Point, effects: FaceEffects): Point {
  const p = effects.placement, amount = clamp(p.strength, 0, 1);
  const dx = region.center.x - center.x, dy = region.center.y - center.y;
  let x = 0, y = 0;
  if (p.mode === "gather" || p.mode === "spread") { const sign = p.mode === "gather" ? -1 : 1; x = dx * 0.24 * amount * sign; y = dy * 0.22 * amount * sign; }
  if (p.mode === "compress" || p.mode === "expand") y = dy * 0.28 * amount * (p.mode === "compress" ? -1 : 1);
  if ((feature === "eyes" || feature === "brows") && (p.mode === "close" || p.mode === "separate")) x = dx * 0.28 * amount * (p.mode === "close" ? -1 : 1);
  if (p.mode === "up" || p.mode === "down") y = region.height * 0.28 * amount * (p.mode === "up" ? -1 : 1);
  x *= p.horizontal; y *= p.vertical;
  if (feature === "eyes") x -= dx * 0.24 * effects.special.crossedEyes;
  if (feature === "mouth") x += region.width * 0.06 * effects.special.crookedMouth;
  return { x: x || 0, y: y || 0 };
}
export function applyFaceOffsets(feature: FeatureType, region: FeatureRegion, center: Point, options: TransformOptions, effects: FaceEffects): void {
  const delta = placementOffset(feature, region, center, effects);
  options.translation.x = clamp(options.translation.x + delta.x, -options.influenceRadius.x * 0.28, options.influenceRadius.x * 0.28);
  options.translation.y = clamp(options.translation.y + delta.y, -options.influenceRadius.y * 0.28, options.influenceRadius.y * 0.28);
  if (feature === "mouth") options.skewY = effects.special.crookedMouth * 0.28;
}
export const FACE_PRESETS = {
  monster: "極太眉モンスター", alien: "宇宙人顔", fish: "魚顔", villain: "悪役顔"
} as const;
export type FacePreset = keyof typeof FACE_PRESETS;
export function applyFacePreset(state: EffectState, name: FacePreset): { parts: EffectState; effects: FaceEffects } {
  const parts = { ...state }, effects = emptyFaceEffects();
  for (const id of ["eyes", "nose", "mouth", "brows"] as const) parts[id] = { size: 1, scaleX: 1, scaleY: 1, opacity: 1, distance: 0 };
  if (name === "monster") { Object.assign(effects.special, { thickBrows: 0.85, connectedBrows: 0.9, crossedEyes: 0.6, flatNose: 0.8, crookedMouth: 0.6, lowerFace: 0.65 }); }
  if (name === "alien") { effects.placement.mode = "gather"; effects.placement.strength = 0.65; effects.special.crossedEyes = 0.35; effects.special.lowerFace = -0.65; parts.eyes.size = 1.3; }
  if (name === "fish") { effects.placement.mode = "spread"; effects.placement.strength = 0.6; parts.mouth.size = 0.7; parts.mouth.scaleX = 0.85; effects.special.lowerFace = 0.6; }
  if (name === "villain") { effects.special.thickBrows = 0.65; effects.special.flatNose = 0.3; effects.special.crookedMouth = 0.8; parts.nose.scaleY = 1.15; }
  return { parts, effects };
}
export function randomFaceEffects(strength: RandomStrength, random: () => number = Math.random): FaceEffects {
  const limitByStrength: Record<RandomStrength, number> = { weak: 0.2, normal: 0.45, wild: 0.75, chaos: 0.92, monster: 1 };
  const chanceByStrength: Record<RandomStrength, number> = { weak: 0.3, normal: 0.4, wild: 0.48, chaos: 0.58, monster: 0.68 };
  const effects = emptyFaceEffects(), limit = limitByStrength[strength], chance = chanceByStrength[strength];
  const modes = Object.keys(PLACEMENTS) as PlacementMode[];
  effects.placement.mode = modes[Math.min(modes.length - 1, Math.floor(random() * modes.length))];
  effects.placement.strength = random() * limit;
  // Sparse special combinations keep strong random faces coherent and inexpensive.
  for (const key of Object.keys(SPECIALS) as SpecialKey[]) effects.special[key] = random() < chance ? random() * limit : 0;
  if (effects.placement.mode === "close" || effects.placement.mode === "gather") effects.special.crossedEyes *= 0.4;
  if (effects.special.lowerFace > 0.3) effects.special.imbalance *= 0.4;
  return effects;
}
