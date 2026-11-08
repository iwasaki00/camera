import { clamp } from './renderer.js?v=0.4.1';

export class Magnifier {
  constructor(parent, { id, label, color, getSource }) {
    Object.assign(this, { parent, getSource }); this.zoom = 3;
    this.window = document.createElement('div'); this.window.className = 'magnifier'; this.window.id = `${id}-magnifier`;
    this.window.style.borderColor = color;
    const header = document.createElement('div'); header.className = 'magnifier-heading';
    const grip = document.createElement('span'); grip.textContent = '口元'; grip.title = 'ドラッグで移動';
    const select = document.createElement('select'); select.setAttribute('aria-label', `${label}の拡大鏡倍率`);
    for (const zoom of [2, 3, 4, 5]) select.add(new Option(`${zoom}×`, zoom));
    select.value = '3'; select.addEventListener('change', () => { this.zoom = Number(select.value); this.draw(); });
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', `${label}の拡大鏡を閉じる`);
    close.addEventListener('click', () => { this.toggle.checked = false; this.draw(); });
    header.append(grip, select, close);
    Object.assign(this, { grip, select, close, label });
    this.canvas = document.createElement('canvas'); this.canvas.width = 256; this.canvas.height = 168;
    this.canvas.setAttribute('aria-label', `${label}の口元拡大表示`);
    this.window.append(header, this.canvas); parent.append(this.window);
    this.toggle = document.getElementById(`${id}-loupe`); this.toggle.addEventListener('change', () => this.draw());
    this.window.addEventListener('pointerdown', e => {
      if (e.target.closest('button,select') || this.drag || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.left, top: this.top };
      this.window.setPointerCapture(e.pointerId);
    });
    this.window.addEventListener('pointermove', e => {
      if (this.drag?.id !== e.pointerId) return;
      e.preventDefault(); this.place(this.drag.left + e.clientX - this.drag.x, this.drag.top + e.clientY - this.drag.y);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.window.addEventListener(event, e => {
      if (this.drag?.id === e.pointerId) { this.drag = null; if (this.window.hasPointerCapture(e.pointerId)) this.window.releasePointerCapture(e.pointerId); }
    });
    this.id = id;
  }
  reset() {
    const pointerId = this.drag?.id; this.drag = null;
    if (pointerId !== undefined && this.window.hasPointerCapture(pointerId)) this.window.releasePointerCapture(pointerId);
    this.zoom = 3; this.select.value = '3'; this.toggle.checked = true;
    this.left = undefined; this.top = undefined;
  }
  setLabel(partLabel) {
    this.grip.textContent = partLabel;
    this.canvas.setAttribute('aria-label', `${this.label}の${partLabel}拡大表示`);
    this.select.setAttribute('aria-label', `${this.label}の${partLabel}拡大鏡倍率`);
    this.close.setAttribute('aria-label', `${this.label}の拡大鏡を閉じる`);
  }
  place(left, top) {
    this.left = clamp(left, 0, Math.max(0, this.parent.clientWidth - this.window.offsetWidth));
    this.top = clamp(top, 0, Math.max(0, this.parent.clientHeight - this.window.offsetHeight));
    this.window.style.left = `${this.left}px`; this.window.style.top = `${this.top}px`;
  }
  draw() {
    const source = this.getSource(); this.window.hidden = !this.toggle.checked || !source;
    if (this.window.hidden) return;
    this.place(this.left ?? (this.id === 'photo' ? this.parent.clientWidth - this.window.offsetWidth - 6 : 2), this.top ?? 6);
    const c = this.canvas.getContext('2d'), { image, x, y, fit, mirror = false } = source;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#172c2b'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const ratio = this.zoom * fit * this.canvas.width / this.canvas.getBoundingClientRect().width;
    c.save(); c.translate(this.canvas.width / 2, this.canvas.height / 2); c.scale(mirror ? -ratio : ratio, ratio);
    c.drawImage(image, -x, -y); c.restore();
    c.strokeStyle = '#ffffff90'; c.lineWidth = 1; c.beginPath();
    c.moveTo(120, 84); c.lineTo(136, 84); c.moveTo(128, 76); c.lineTo(128, 92); c.stroke();
  }
}
