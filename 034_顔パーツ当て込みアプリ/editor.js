import { clamp } from './renderer.js';

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
  constructor(target, { getBox, change, enabled, color, rotation = true, outsideTap }) {
    Object.assign(this, { target, getBox, change, enabled, color, rotation, outsideTap });
    this.overlay = document.createElement('canvas'); this.overlay.className = 'touch-editor';
    this.overlay.dataset.editor = target.id;
    this.overlay.setAttribute('aria-hidden', 'true'); target.parentElement.append(this.overlay);
    this.overlay.addEventListener('pointerdown', event => {
      if (!this.enabled() || this.drag || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const point = this.point(event), box = this.getBox(this.size);
      if (!box) return;
      const action = hitTest(point, box, this.rotation);
      if (!action) { this.outsideTap?.(point, this.size); return; }
      event.preventDefault();
      this.drag = { id: event.pointerId, from: point, box: { ...box }, action, size: { ...this.size } };
      this.overlay.setPointerCapture(event.pointerId); this.draw();
    });
    this.overlay.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      event.preventDefault();
      this.change(dragBox(this.drag.box, this.drag.from, this.point(event), this.drag.action, this.drag.size), this.drag.size, this.drag);
    });
    const end = event => { if (this.drag?.id === event.pointerId) { this.cancel(); this.draw(); } };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.overlay.addEventListener(type, end);
    new ResizeObserver(() => { this.cancel(); this.draw(); }).observe(target);
  }
  point(event) { const rect = this.overlay.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  cancel() {
    const id = this.drag?.id; this.drag = null;
    if (id !== undefined && this.overlay.hasPointerCapture(id)) this.overlay.releasePointerCapture(id);
  }
  draw() {
    const rect = this.target.getBoundingClientRect(), parent = this.target.parentElement.getBoundingClientRect();
    this.size = { width: rect.width, height: rect.height };
    Object.assign(this.overlay.style, { left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (this.overlay.width !== w || this.overlay.height !== h) { this.overlay.width = w; this.overlay.height = h; }
    const c = this.overlay.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, rect.width, rect.height);
    const active = this.enabled(); this.overlay.style.pointerEvents = active ? 'auto' : 'none';
    if (!active) { this.cancel(); return; }
    const box = this.getBox(this.size); if (!box) return;
    c.save(); c.translate(box.x, box.y); c.rotate(box.angle);
    c.strokeStyle = this.color; c.lineWidth = this.drag ? 3 : 2;
    c.fillStyle = this.drag ? this.color + '30' : this.color + '12';
    c.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
    c.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
    if (this.rotation) { c.beginPath(); c.moveTo(0, -box.height / 2); c.lineTo(0, -box.height / 2 - 30); c.stroke(); }
    c.restore();
    for (const point of handles(box, this.rotation)) {
      c.beginPath(); c.arc(point.x, point.y, point.type === 'rotate' ? 8 : 6, 0, Math.PI * 2);
      c.fillStyle = this.color; c.fill(); c.strokeStyle = '#173631'; c.lineWidth = 2; c.stroke();
    }
  }
}
