import { clamp } from './renderer.js?v=0.9.1';

// All view transforms use CSS pixels; model coordinates remain unchanged.
export const toContent = (point, view, origin) => ({ x: (point.x - origin.x - view.x) / view.scale, y: (point.y - origin.y - view.y) / view.scale });
export const toScreen = (point, view, origin) => ({ x: origin.x + view.x + point.x * view.scale, y: origin.y + view.y + point.y * view.scale });
export function zoomAt(view, origin, from, to, scale) {
  const anchor = toContent(from, view, origin);
  return { scale, x: to.x - origin.x - anchor.x * scale, y: to.y - origin.y - anchor.y * scale };
}
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Viewport {
  constructor(target, { min = 1, max = 4, changed = () => {} } = {}) {
    Object.assign(this, { target, min, max, changed });
    this.view = { scale: 1, x: 0, y: 0 };
    target.style.transformOrigin = '0 0';
  }
  geometry() {
    const rect = this.target.getBoundingClientRect(), parent = this.target.parentElement.getBoundingClientRect();
    return { width: rect.width / this.view.scale, height: rect.height / this.view.scale,
      origin: { x: rect.left - parent.left - this.view.x, y: rect.top - parent.top - this.view.y },
      surface: { width: parent.width, height: parent.height } };
  }
  set(next, { preserveReturn = false } = {}) {
    if (!preserveReturn) this.returnView = null;
    this.view = { ...next, scale: clamp(next.scale, this.min, this.max) };
    this.target.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.scale})`;
    this.changed();
  }
  zoom(scale, center) {
    const { origin, surface } = this.geometry();
    const point = center || { x: surface.width / 2, y: surface.height / 2 };
    this.set(zoomAt(this.view, origin, point, point, clamp(scale, this.min, this.max)));
  }
  reset() { this.set({ scale: 1, x: 0, y: 0 }); }
  focus(box) {
    if (!box || ![box.x,box.y,box.width,box.height].every(Number.isFinite) || box.width<=0 || box.height<=0) return false;
    const {origin,surface}=this.geometry();
    if (!surface.width || !surface.height) return false;
    this.returnView ??= {...this.view};
    const angle=box.angle||0,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
    const width=c*box.width+s*box.height,height=s*box.width+c*box.height;
    const scale=clamp(Math.min(surface.width*.6/width,surface.height*.6/height),Math.max(1.5,this.min),this.max);
    this.set({scale,x:surface.width/2-origin.x-box.x*scale,y:surface.height/2-origin.y-box.y*scale},{preserveReturn:true});
    return true;
  }
  restore() { if(this.returnView)this.set(this.returnView); }
}
