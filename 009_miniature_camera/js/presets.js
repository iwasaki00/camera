export const DEFAULTS = Object.freeze({
  blur: 14, position: 50, width: 24, angle: 0,
  saturation: 118, contrast: 112, brightness: 102,
});

export const PRESETS = Object.freeze({
  standard: { ...DEFAULTS },
  vivid: { blur: 19, position: 50, width: 20, angle: 0, saturation: 136, contrast: 122, brightness: 103 },
  city: { blur: 17, position: 46, width: 18, angle: -5, saturation: 128, contrast: 119, brightness: 104 },
  train: { blur: 16, position: 53, width: 17, angle: 8, saturation: 124, contrast: 117, brightness: 101 },
  soft: { blur: 8, position: 50, width: 30, angle: 0, saturation: 108, contrast: 105, brightness: 103 },
});

export const CONTROL_DEFS = [
  { key: "blur", label: "ぼかし", min: 0, max: 28, step: 1, unit: "" },
  { key: "position", label: "ピント位置", min: 15, max: 85, step: 1, unit: "%" },
  { key: "width", label: "ピント幅", min: 8, max: 55, step: 1, unit: "%" },
  { key: "angle", label: "角度", min: -45, max: 45, step: 1, unit: "°" },
  { key: "saturation", label: "彩度", min: 70, max: 160, step: 1, unit: "%" },
  { key: "contrast", label: "コントラスト", min: 70, max: 150, step: 1, unit: "%" },
  { key: "brightness", label: "明るさ", min: 70, max: 140, step: 1, unit: "%" },
];
