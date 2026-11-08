import { clamp } from './renderer.js?v=0.4.1';
import { toContent, toScreen, zoomAt, midpoint, distance } from './viewport.js?v=0.4.1';

export const rotate = (p, angle) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
export function handles(box, rotation = true) {
  const points = corners.map(([sx, sy]) => ({ ...rotate({ x: sx * box.width / 2, y: sy * box.height / 2 }, box.angle), sx, sy, type: 'resize' }));
  if (rotation) points.push({ ...rotate({ x: 0, y: -box.height / 2 - 30 }, box.angle), type: 'rotate' });
  return points.map(p => ({ ...p, x: p.x + box.x, y: p.y + box.y }));
}
export function hitTest(point, box, rotation = true) {
  const local = rotate({ x: point.x - box.x, y: point.y - box.y }, -box.angle);
  // Reserve the center for moving even when small crop handles have overlapping hit areas.
  if (Math.abs(local.x) < box.width / 4 && Math.abs(local.y) < box.height / 4) return { type: 'move' };
  // Prefer the closest handle where finger-sized hit areas overlap.
  const candidates = handles(box, rotation).map(p => ({ ...p, distance: Math.hypot(p.x - point.x, p.y - point.y) })).sort((a, b) => a.distance - b.distance);
  if (candidates[0].distance <= 22) return candidates[0];
  return Math.abs(local.x) <= box.width / 2 && Math.abs(local.y) <= box.height / 2 ? { type: 'move' } : null;
}
export function dragBox(start, from, to, action, bounds) {
  if (action.type === 'move') return { ...start, x: clamp(start.x + to.x - from.x, 0, bounds.width), y: clamp(start.y + to.y - from.y, 0, bounds.height) };
  if (action.type === 'rotate') {
    const delta = Math.atan2(to.y - start.y, to.x - start.x) - Math.atan2(from.y - start.y, from.x - start.x);
    const angle = Math.atan2(Math.sin(start.angle + delta), Math.cos(start.angle + delta));
    return { ...start, angle };
  }
  const delta = rotate({ x: to.x - from.x, y: to.y - from.y }, -start.angle);
  const width = clamp(start.width + action.sx * delta.x, bounds.width * .01, bounds.width);
  const height = clamp(start.height + action.sy * delta.y, bounds.height * .01, bounds.height);
  const shift = rotate({ x: action.sx * (width - start.width) / 2, y: action.sy * (height - start.height) / 2 }, start.angle);
  return { ...start, x: clamp(start.x + shift.x, 0, bounds.width), y: clamp(start.y + shift.y, 0, bounds.height), width, height };
}

export function sourceFromBox(box, bounds, aspect) {
  // Source crop keeps the destination aspect ratio. Project a corner drag onto that diagonal.
  const width = (box.width + box.height / aspect) / (1 + 1 / (aspect * aspect));
  const zoom = clamp(bounds.width * .6 / Math.max(1, width), 1, 6);
  const actualWidth = Math.min(bounds.width * .6 / zoom, bounds.height * aspect);
  const actualHeight = actualWidth / aspect;
  return { zoom, x: clamp(box.x, actualWidth / 2, bounds.width - actualWidth / 2) / bounds.width,
    y: clamp(box.y, actualHeight / 2, bounds.height - actualHeight / 2) / bounds.height };
}

// Overlay uses CSS pixels, keeping handles finger-sized at any image resolution.
export class TouchEditor {
  constructor(target, { getBox, change, enabled, editable = () => true, color, rotation = true, viewport, mode = () => 'edit', snapshot, restore }) {
    Object.assign(this, { target, getBox, change, enabled, editable, color, rotation, viewport, mode, snapshot, restore });
    this.pointers = new Map();
    this.overlay = document.createElement('canvas'); this.overlay.className = 'touch-editor';
    this.overlay.dataset.editor = target.id;
    this.overlay.setAttribute('aria-hidden', 'true'); target.parentElement.append(this.overlay);
    this.overlay.addEventListener('pointerdown', event => this.down(event));
    this.overlay.addEventListener('pointermove', event => {
      if (!this.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.pointers.set(event.pointerId, this.point(event));
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const scale = clamp(this.pinch.view.scale * distance(a, b) / this.pinch.distance, this.viewport.min, this.viewport.max);
        this.viewport.set(zoomAt(this.pinch.view, this.pinch.origin, this.pinch.center, midpoint(a, b), scale));
      } else if (!this.blocked && this.pan) {
        const point = this.point(event);
        this.viewport.set({ ...this.pan.view, x: this.pan.view.x + point.x - this.pan.from.x, y: this.pan.view.y + point.y - this.pan.from.y });
      } else if (!this.blocked && this.drag?.id === event.pointerId) {
        const point = toContent(this.point(event), this.viewport.view, this.viewport.geometry().origin);
        this.change(dragBox(this.drag.box, this.drag.from, point, this.drag.action, this.drag.size), this.drag.size, this.drag);
      }
    });
    const end = event => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.delete(event.pointerId); this.drag = this.pan = this.pinch = null;
      this.blocked = this.pointers.size > 0;
      if (this.overlay.hasPointerCapture(event.pointerId)) this.overlay.releasePointerCapture(event.pointerId);
      this.draw();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.overlay.addEventListener(type, end);
    new ResizeObserver(() => { this.cancel(); this.draw(); }).observe(target);
  }
  down(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const point = this.point(event); this.pointers.set(event.pointerId, point); this.overlay.setPointerCapture(event.pointerId);
    if (this.pointers.size === 2 && !this.blocked) {
      // The first finger may have moved slightly before the second arrived.
      // Switching to a pinch must not leave that accidental edit in the model.
      if (this.drag && this.restore) this.restore(this.drag.snapshot);
      const [a, b] = [...this.pointers.values()]; this.drag = this.pan = null;
      this.pinch = { view: { ...this.viewport.view }, origin: this.viewport.geometry().origin, center: midpoint(a, b), distance: Math.max(1, distance(a, b)) };
      return;
    }
    if (this.pointers.size > 1 || this.blocked) { this.drag = this.pan = this.pinch = null; this.blocked = true; return; }
    if (this.mode() === 'pan') { this.pan = { from: point, view: { ...this.viewport.view } }; return; }
    if (this.mode() !== 'edit' || !this.enabled() || !this.editable()) return;
    const box = this.getBox(this.size); if (!box) return;
    const screen = this.screenBox(box), action = hitTest(point, screen, this.rotation);
    // Empty-space taps do not mutate coordinates: the next finger may start a pinch.
    if (!action) return;
    this.drag = { id: event.pointerId, from: toContent(point, this.viewport.view, this.viewport.geometry().origin), box: { ...box }, action, size: { ...this.size }, snapshot: this.snapshot?.() };
    this.draw();
  }
  point(event) { const rect = this.overlay.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  screenBox(box) {
    const center = toScreen(box, this.viewport.view, this.viewport.geometry().origin);
    return { ...box, ...center, width: box.width * this.viewport.view.scale, height: box.height * this.viewport.view.scale };
  }
  cancel() {
    const ids = [...this.pointers.keys()]; this.pointers.clear(); this.drag = this.pan = this.pinch = null; this.blocked = false;
    for (const id of ids) if (this.overlay.hasPointerCapture(id)) this.overlay.releasePointerCapture(id);
  }
  draw() {
    const { width, height, surface } = this.viewport.geometry();
    this.size = { width, height };
    Object.assign(this.overlay.style, { left: '0px', top: '0px', width: `${surface.width}px`, height: `${surface.height}px` });
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(surface.width * dpr), h = Math.round(surface.height * dpr);
    if (this.overlay.width !== w || this.overlay.height !== h) { this.overlay.width = w; this.overlay.height = h; }
    const c = this.overlay.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, surface.width, surface.height);
    if (!this.enabled() || this.mode() === 'view') return;
    const contentBox = this.getBox(this.size); if (!contentBox) return;
    const box = this.screenBox(contentBox);
    c.save(); c.translate(box.x, box.y); c.rotate(box.angle);
    c.strokeStyle = this.color; c.lineWidth = this.drag ? 3 : 2;
    c.fillStyle = this.drag ? this.color + '30' : this.color + '12';
    c.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
    c.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
    if (this.rotation && this.editable()) { c.beginPath(); c.moveTo(0, -box.height / 2); c.lineTo(0, -box.height / 2 - 30); c.stroke(); }
    c.restore();
    if(!this.editable())return;
    for (const point of handles(box, this.rotation)) {
      c.beginPath(); c.arc(point.x, point.y, point.type === 'rotate' ? 8 : 6, 0, Math.PI * 2);
      c.fillStyle = this.color; c.fill(); c.strokeStyle = '#173631'; c.lineWidth = 2; c.stroke();
    }
  }
}
