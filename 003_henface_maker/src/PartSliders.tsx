import type { PartConfig } from "./featureRenderer";
import type { Layout } from "./uiSettings";
type Props = { config: PartConfig; paired: boolean; layout: Layout; update: (patch: Partial<PartConfig>) => void };
function Slider({ name, field, config, update }: { name: string; field: keyof PartConfig; config: PartConfig; update: Props["update"] }) {
  const distance = field === "distance";
  return <label className="slider-field"><span>{name}<output>{Math.round(config[field] * 100)}%</output></span>
    <input type="range" aria-label={name} min={distance ? -25 : field === "opacity" ? 20 : 40}
      max={distance ? 25 : field === "opacity" ? 150 : 200} step={distance ? 1 : 5}
      value={Math.round(config[field] * 100)} onChange={event => update({ [field]: Number(event.target.value) / 100 })} />
  </label>;
}
export default function PartSliders({ config, paired, layout, update }: Props) {
  const secondary = <Slider name={paired ? "離す / 近づける" : "縦に伸ばす / 縮める"} field={paired ? "distance" : "scaleY"} config={config} update={update} />;
  const horizontal = !paired && <Slider name="横に伸ばす / 縮める" field="scaleX" config={config} update={update} />;
  return <div className="part-sliders">
    <Slider name="大きくする / 小さくする" field="size" config={config} update={update} />
    {layout !== "edge-controls" && secondary}
    {layout === "standard" && horizontal}
    <details className="slider-details"><summary>詳細を開く</summary>
      {layout === "edge-controls" && secondary}
      {layout !== "standard" && horizontal}
      <Slider name="濃くする / 薄くする" field="opacity" config={config} update={update} />
    </details>
  </div>;
}
