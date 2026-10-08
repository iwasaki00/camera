import type { EffectState, FeatureType, PartConfig } from "./featureRenderer";
export const APP_VERSION = "0.3.0-layouts";
export const LAYOUTS = ["standard", "compact", "edge-controls"] as const;
export type Layout = typeof LAYOUTS[number];
export type RandomStrength = "weak" | "normal" | "wild";
const KEY = "henface.layout";
export function readLayout(): Layout {
  try { const value = localStorage.getItem(KEY); return LAYOUTS.includes(value as Layout) ? value as Layout : "compact"; }
  catch { return "compact"; }
}
export function saveLayout(value: Layout): void { try { localStorage.setItem(KEY, value); } catch { /* Private mode can deny storage. */ } }
export const RANDOM_LIMITS = {
  weak: { min: 0.9, max: 1.15, axis: 0.1, distance: 0.04, opacity: 0.1 },
  normal: { min: 0.75, max: 1.4, axis: 0.18, distance: 0.1, opacity: 0.18 },
  wild: { min: 0.65, max: 1.65, axis: 0.3, distance: 0.18, opacity: 0.28 }
};
export function randomizeParts(state: EffectState, parts: readonly FeatureType[], strength: RandomStrength,
  random: () => number = Math.random): EffectState {
  const range = RANDOM_LIMITS[strength];
  const step = (n: number) => Math.round(n * 20) / 20;
  const around = (amount: number) => step(1 + (random() * 2 - 1) * amount);
  const next = { ...state };
  for (const part of parts) {
    const paired = part === "eyes" || part === "brows";
    const config: PartConfig = {
      size: step(range.min + random() * (range.max - range.min)),
      scaleX: paired ? 1 : around(range.axis), scaleY: paired ? 1 : around(range.axis),
      distance: paired ? Math.round((random() * 2 - 1) * range.distance * 100) / 100 : 0,
      opacity: around(range.opacity)
    };
    // Avoid stacking aggressive overall and axis expansion/shrinkage.
    if (!paired) {
      for (const axis of ["scaleX", "scaleY"] as const) {
        const effectiveSize = Math.max(0.2, 1 + (config.size - 1) * 1.6);
        const effectiveAxis = Math.max(0.2, 1 + (config[axis] - 1) * 1.75);
        if (effectiveSize * effectiveAxis < 0.4 || effectiveSize * effectiveAxis > 2.4) config[axis] = 1;
      }
    }
    next[part] = config;
  }
  return next;
}
