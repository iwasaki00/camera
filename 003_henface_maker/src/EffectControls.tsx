import { useState } from "react";
import type { FaceEffects, FacePreset, PlacementMode, SpecialKey } from "./faceEffects";
import { FACE_PRESETS, PLACEMENTS, SPECIALS } from "./faceEffects";
export type Category = "parts" | "placement" | "special" | "presets";
export const CATEGORIES = { parts: "パーツ", placement: "配置", special: "特殊", presets: "プリセット" } as const;
export function CategoryTabs({ value, change }: { value: Category; change: (value: Category) => void }) {
  return <div className="tab-row category-tabs" aria-label="カテゴリ">{(Object.keys(CATEGORIES) as Category[]).map(key =>
    <button type="button" key={key} className={"tab-button " + (key === value ? "is-active" : "")} aria-pressed={key === value} onClick={() => change(key)}>{CATEGORIES[key]}</button>)}</div>;
}
export default function EffectControls({ category, effects, update, preset }: {
  category: Category; effects: FaceEffects; update: (effects: FaceEffects) => void; preset: (name: FacePreset) => void
}) {
  const [special, setSpecial] = useState<SpecialKey>("thickBrows");
  if (category === "presets") return <div className="face-presets">{(Object.keys(FACE_PRESETS) as FacePreset[]).map(key =>
    <button type="button" key={key} onClick={() => preset(key)}>{FACE_PRESETS[key]}</button>)}</div>;
  const placement = category === "placement";
  const value = placement ? effects.placement.strength : effects.special[special];
  return <div className="effect-controls">
    <div className="effect-choice">
      {placement ? <select aria-label="配置エフェクト" value={effects.placement.mode} onChange={e => update({ ...effects, placement: { ...effects.placement, mode: e.target.value as PlacementMode } })}>
        {(Object.keys(PLACEMENTS) as PlacementMode[]).map(key => <option key={key} value={key}>{PLACEMENTS[key]}</option>)}
      </select> : <select aria-label="特殊エフェクト" value={special} onChange={e => setSpecial(e.target.value as SpecialKey)}>
        {(Object.keys(SPECIALS) as SpecialKey[]).map(key => <option key={key} value={key}>{SPECIALS[key]}</option>)}
      </select>}
      <button type="button" aria-label={placement ? "配置をリセット" : "選択中の特殊エフェクトをリセット"} onClick={() => update(placement
        ? { ...effects, placement: { ...effects.placement, mode: "none", strength: 0.5 } }
        : { ...effects, special: { ...effects.special, [special]: 0 } })}>解除</button>
    </div>
    <label className="slider-field"><span>{placement ? "配置の強度" : SPECIALS[special]}<output>{Math.round(value * 100)}%</output></span>
      <input type="range" aria-label={placement ? "配置の強度" : SPECIALS[special] + "の強度"} min={!placement && special === "lowerFace" ? -100 : 0} max="100" step="5" value={Math.round(value * 100)}
        onChange={e => update(placement ? { ...effects, placement: { ...effects.placement, strength: Number(e.target.value) / 100 } }
          : { ...effects, special: { ...effects.special, [special]: Number(e.target.value) / 100 } })} />
    </label>
    {placement && <details className="slider-details"><summary>横・縦を個別に調整</summary>{(["horizontal", "vertical"] as const).map(axis =>
      <label className="slider-field" key={axis}><span>{axis === "horizontal" ? "横方向" : "縦方向"}<output>{Math.round(effects.placement[axis] * 100)}%</output></span>
        <input aria-label={axis === "horizontal" ? "配置の横方向" : "配置の縦方向"} type="range" min="0" max="100" step="5" value={Math.round(effects.placement[axis] * 100)}
          onChange={e => update({ ...effects, placement: { ...effects.placement, [axis]: Number(e.target.value) / 100 } })} /></label>)}</details>}
    {!placement && <p className="effect-note">{special === "lowerFace" ? "負の値で下顔面を細くできます。" : "各効果は重ねて使えます。全部リセットで解除。"}</p>}
  </div>;
}
