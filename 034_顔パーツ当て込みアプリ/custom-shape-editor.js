import {displayToRaw,maskFromStroke,validateCustomMask} from './custom-mask.js?v=0.9.1';
const $=id=>document.getElementById(id);
export class CustomShapeEditor {
  constructor({target,video,viewport,selected,mirror,ready,locked,changed,message,before}){
    Object.assign(this,{target,video,viewport,selected,mirror,ready,locked,changed,message,before});
    this.overlay=document.createElement('canvas');this.overlay.className='custom-shape-overlay';
    this.overlay.setAttribute('aria-label','静止したカメラ映像を指またはマウスで囲む');target.parentElement.append(this.overlay);
    this.pointers=new Set();
    $('shape-draw').addEventListener('click',()=>this.start());
    $('shape-confirm').addEventListener('click',()=>this.confirm());
    $('shape-redraw').addEventListener('click',()=>{this.points=[];this.draft=null;this.sync();this.draw();this.message('映像内を1本の線で囲んでください。');});
    $('shape-cancel').addEventListener('click',()=>this.cancel());
    this.overlay.addEventListener('pointerdown',e=>this.down(e));
    this.overlay.addEventListener('pointermove',e=>this.move(e));
    this.overlay.addEventListener('pointerup',e=>this.up(e));
    this.overlay.addEventListener('pointercancel',()=>this.cancel());
    this.overlay.addEventListener('lostpointercapture',e=>{if(this.pointers.has(e.pointerId))this.cancel();});
    this.overlay.addEventListener('contextmenu',e=>{if(this.active)e.preventDefault();});
    window.addEventListener('resize',()=>this.cancel());window.addEventListener('orientationchange',()=>this.cancel());
    this.sync();
  }
  start(){
    if(this.active||!this.ready()||this.locked()){this.message('カメラ使用中・録画停止中に輪郭を描けます。',true);return false;}
    this.before?.();this.partId=this.selected().id;this.view={...this.viewport.view};this.mirrored=this.mirror();
    this.still=document.createElement('canvas');this.still.width=this.video.videoWidth;this.still.height=this.video.videoHeight;
    this.still.getContext('2d').drawImage(this.video,0,0);this.active=true;this.points=[];this.draft=null;this.blocked=false;
    this.sync();this.changed();this.message('静止画を囲んでください。指を離した後「確定」で保存します。');return true;
  }
  sync(){
    $('shape-draw').disabled=!this.ready()||this.locked();$('shape-draw').textContent=this.selected()?.customMask?'輪郭を描き直す':'輪郭を描く';
    $('shape-draw').hidden=!!this.active;$('camera-shape').hidden=!!this.active;$('shape-actions').hidden=!this.active;
    $('shape-confirm').disabled=!this.draft;this.overlay.dataset.active=String(!!this.active);
  }
  cancel(){
    if(!this.active)return;this.active=false;this.draft=null;this.points=[];for(const id of this.pointers)if(this.overlay.hasPointerCapture(id))this.overlay.releasePointerCapture(id);this.pointers.clear();this.blocked=false;
    if(this.still){this.still.width=this.still.height=0;this.still=null;}
    this.sync();this.changed();this.message('下書きを破棄し、ライブ表示に戻しました。');
  }
  confirm(){
    if(!this.active||!this.draft||this.selected()?.id!==this.partId||!this.ready()||this.locked())return;
    const part=this.selected(),mask=validateCustomMask(this.draft);this.cancel();part.customMask=mask;part.shape='freehand';
    this.changed();this.message('輪郭を確定しました。ライブ映像を合成しています。');
  }
  point(event){const r=this.overlay.getBoundingClientRect();return displayToRaw({x:event.clientX-r.left,y:event.clientY-r.top},this.viewport.geometry(),this.viewport.view,this.mirror());}
  down(e){
    if(!this.active||e.button!==0)return;e.preventDefault();e.stopPropagation();this.pointers.add(e.pointerId);this.overlay.setPointerCapture(e.pointerId);
    if(this.pointers.size>1){this.blocked=true;this.points=[];this.draft=null;this.sync();this.draw();this.message('2本目の指により線を破棄しました。1本指で描き直してください。',true);return;}
    this.pointer=e.pointerId;this.draft=null;this.points=[];this.invalid=false;this.append(e);this.sync();this.draw();
  }
  append(e){const p=this.point(e);if(p.x<0||p.y<0||p.x>1||p.y>1){this.invalid=true;return;}if(this.points.length>=2048){this.invalid=true;return;}const last=this.points.at(-1);if(!last||Math.hypot(p.x-last.x,p.y-last.y)>.0005)this.points.push(p);}
  move(e){if(!this.active||this.blocked||!this.pointers.has(e.pointerId)||e.pointerId!==this.pointer)return;e.preventDefault();this.append(e);this.draw();}
  up(e){
    if(!this.active||!this.pointers.has(e.pointerId))return;e.preventDefault();this.pointers.delete(e.pointerId);
    if(this.blocked){if(!this.pointers.size)this.blocked=false;return;}
    if(e.pointerId!==this.pointer)return;this.append(e);
    try{if(this.invalid)throw new Error('映像の外に出た線や長すぎる線は使えません。描き直してください。');this.draft=maskFromStroke(this.points);this.message('輪郭を確認し、「確定」または「描き直す」を選んでください。');}
    catch(error){this.draft=null;this.message(error.message,true);}
    this.sync();this.draw();
  }
  draw(){
    if(this.active&&(this.selected()?.id!==this.partId||this.mirror()!==this.mirrored||JSON.stringify(this.view)!==JSON.stringify(this.viewport.view)||!this.ready()||this.locked()||this.video.videoWidth!==this.still.width||this.video.videoHeight!==this.still.height)){this.cancel();return;}
    const g=this.viewport.geometry(),dpr=window.devicePixelRatio||1,w=Math.round(g.surface.width*dpr),h=Math.round(g.surface.height*dpr);
    this.overlay.style.width=g.surface.width+'px';this.overlay.style.height=g.surface.height+'px';
    if(this.overlay.width!==w||this.overlay.height!==h){this.overlay.width=w;this.overlay.height=h;}
    const c=this.overlay.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,g.surface.width,g.surface.height);
    if(!this.ready())return;
    let raw=this.active?this.points:null,closed=!!this.draft;
    const part=this.selected(),mask=this.active?this.draft:part?.shape==='freehand'&&part.guides.camera?part.customMask:null;
    if(mask){raw=mask.points.map(p=>({x:mask.rect.x+p.x*mask.rect.width,y:mask.rect.y+p.y*mask.rect.height}));closed=true;}
    if(!raw?.length)return;
    c.beginPath();raw.forEach((p,i)=>{const x=g.origin.x+this.viewport.view.x+(this.mirror()?1-p.x:p.x)*g.width*this.viewport.view.scale,y=g.origin.y+this.viewport.view.y+p.y*g.height*this.viewport.view.scale;if(i)c.lineTo(x,y);else c.moveTo(x,y);});
    if(closed){c.closePath();if(this.active){c.fillStyle='#25d9c84d';c.fill();}}
    c.strokeStyle=this.active?'#16ffe1':'#fff';c.lineWidth=this.active?3:2;c.stroke();
  }
}
