export const DEFAULTS = Object.freeze({
  degree: 55,
  blur: 15,
  position: 50,
  centerX: 50,
  centerY: 50,
  width: 24,
  angle: 0,
  saturation: 120,
  contrast: 113,
  brightness: 102,
  temperature: 0,
  shadows: 0,
  highlights: 0,
  shape: "horizontal",
  zoom: 1,
});

const preset = (values) => ({ ...DEFAULTS, ...values });

export const PRESETS = Object.freeze({
  natural: preset({ degree: 25, blur: 7, width: 34, saturation: 106, contrast: 104, brightness: 102 }),
  standard: preset({}),
  vivid: preset({ degree: 78, blur: 20, width: 18, saturation: 138, contrast: 124, brightness: 103, shadows: -8, highlights: 5 }),
  city: preset({ degree: 70, blur: 18, position: 46, centerY: 46, width: 19, angle: -4, saturation: 130, contrast: 120, brightness: 104, temperature: 3 }),
  train: preset({ degree: 72, blur: 18, position: 53, centerY: 53, width: 17, angle: 7, saturation: 126, contrast: 120, brightness: 101, temperature: 2 }),
  night: preset({ degree: 48, blur: 11, width: 27, saturation: 122, contrast: 116, brightness: 94, temperature: -7, shadows: 10, highlights: -8 }),
  retro: preset({ degree: 62, blur: 15, width: 23, saturation: 103, contrast: 118, brightness: 99, temperature: 12, shadows: 8, highlights: -5 }),
  toy: preset({ degree: 82, blur: 21, width: 18, saturation: 145, contrast: 128, brightness: 103, temperature: 6, shadows: -12, highlights: 8 }),
  soft: preset({ degree: 20, blur: 6, width: 36, saturation: 108, contrast: 104, brightness: 104, highlights: -3 }),
});

export const RECOMMENDATIONS = Object.freeze({
  city: { preset: "vivid", shape: "horizontal", position: 48, width: 19, angle: 0 },
  train: { preset: "train", shape: "horizontal", position: 54, width: 17, angle: 8 },
  highrise: { preset: "vivid", shape: "horizontal", position: 47, width: 14, angle: 0 },
  night: { preset: "night", shape: "horizontal", position: 52, width: 28, angle: 0 },
  crowd: { preset: "city", shape: "horizontal", position: 50, width: 20, angle: 0, stopMotion: "medium" },
});

export const CONTROL_DEFS = [
  { key: "blur", label: "ぼかし", min: 0, max: 28, step: 1, unit: "" },
  { key: "position", label: "ピント位置", min: 10, max: 90, step: 1, unit: "%" },
  { key: "width", label: "ピント幅", min: 8, max: 60, step: 1, unit: "%" },
  { key: "angle", label: "角度", min: -90, max: 90, step: 1, unit: "°" },
  { key: "saturation", label: "彩度", min: 70, max: 160, step: 1, unit: "%" },
  { key: "contrast", label: "コントラスト", min: 70, max: 150, step: 1, unit: "%" },
  { key: "brightness", label: "明るさ", min: 70, max: 140, step: 1, unit: "%" },
  { key: "temperature", label: "色温度", min: -20, max: 20, step: 1, unit: "" },
  { key: "shadows", label: "シャドウ", min: -20, max: 20, step: 1, unit: "" },
  { key: "highlights", label: "ハイライト", min: -20, max: 20, step: 1, unit: "" },
];

export function applyDegree(current, degree) {
  const t = Math.max(0, Math.min(100, degree)) / 100;
  return {
    ...current,
    degree,
    blur: Math.round(4 + t * 22),
    width: Math.round(40 - t * 25),
    saturation: Math.round(104 + t * 34),
    contrast: Math.round(102 + t * 24),
    brightness: Math.round(101 + t * 3),
    shadows: Math.round(-10 * t),
    highlights: Math.round(6 * t),
  };
}
