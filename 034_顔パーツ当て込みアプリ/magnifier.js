import { clamp } from './renderer.js?v=0.9.0';

export class Magnifier {
  constructor(parent, { id, label, color, getSource, getAnchor = () => null }) {
    Object.assign(this, { parent, getSource, getAnchor }); this.zoom = 3;
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
    this.toggle = document.getElementById(`${id}-loupe`); this.toggle.checked = false;
    this.toggle.addEventListener('change', () => this.draw());
    this.window.hidden=true;
    this.observer=new ResizeObserver(()=>{this.cancelDrag();this.draw();});this.observer.observe(parent);
    const reposition=()=>{if(!this.window.hidden&&this.left!==undefined)this.place(this.left,this.top);};
    window.addEventListener('scroll',reposition,{passive:true});
    window.visualViewport?.addEventListener('resize',reposition,{passive:true});
    window.visualViewport?.addEventListener('scroll',reposition,{passive:true});
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
    this.cancelDrag();
    this.zoom = 3; this.select.value = '3'; this.toggle.checked = false;
    this.left = undefined; this.top = undefined;
  }
  cancelDrag() {
    const pointerId = this.drag?.id; this.drag = null;
    if (pointerId !== undefined && this.window.hasPointerCapture(pointerId)) this.window.releasePointerCapture(pointerId);
  }
  setLabel(partLabel) {
    this.grip.textContent = partLabel;
    this.canvas.setAttribute('aria-label', `${this.label}の${partLabel}拡大表示`);
    this.select.setAttribute('aria-label', `${this.label}の${partLabel}拡大鏡倍率`);
    this.close.setAttribute('aria-label', `${this.label}の拡大鏡を閉じる`);
  }
  place(left, top) {
    this.left = clamp(left, 0, Math.max(0, this.parent.clientWidth - this.window.offsetWidth));
    const r=this.parent.getBoundingClientRect(),viewport=window.visualViewport;
    const visibleTop=Math.max(0,(viewport?.offsetTop||0)-r.top);
    const limit=Math.max(0,this.parent.clientHeight-this.window.offsetHeight);
    const visibleBottom=Math.min(limit,(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-r.top-this.window.offsetHeight);
    this.top = visibleBottom>=visibleTop?clamp(top,visibleTop,visibleBottom):clamp(top,0,limit);
    this.window.style.left = `${this.left}px`; this.window.style.top = `${this.top}px`;
  }
  draw() {
    if(!this.toggle.checked){this.window.hidden=true;return;}
    const source = this.getSource(); this.window.hidden = !this.toggle.checked || !source;
    if (this.window.hidden) return;
    if(this.left===undefined||this.top===undefined){
      const anchor=this.getAnchor();
      const right=Math.max(0,this.parent.clientWidth-this.window.offsetWidth-6),bottom=Math.max(0,this.parent.clientHeight-this.window.offsetHeight-6);
      const corners=[{x:right,y:6},{x:6,y:6},{x:right,y:bottom},{x:6,y:bottom}];
      if(anchor)corners.sort((a,b)=>Math.hypot(b.x+this.window.offsetWidth/2-anchor.x,b.y+this.window.offsetHeight/2-anchor.y)-Math.hypot(a.x+this.window.offsetWidth/2-anchor.x,a.y+this.window.offsetHeight/2-anchor.y));
      this.place(corners[0].x,corners[0].y);
    }else this.place(this.left,this.top);
    const c = this.canvas.getContext('2d'), { image, x, y, fit, mirror = false } = source;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#172c2b'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const ratio = this.zoom * fit * this.canvas.width / this.canvas.getBoundingClientRect().width;
    c.save(); c.translate(this.canvas.width / 2, this.canvas.height / 2); c.scale(mirror ? -ratio : ratio, ratio);
    c.drawImage(image, -x, -y); c.restore();
    c.strokeStyle = '#ffffff90'; c.lineWidth = 1; c.beginPath();
    c.moveTo(120, 84); c.lineTo(136, 84); c.moveTo(128, 76); c.lineTo(128, 92); c.stroke();
  }
}
