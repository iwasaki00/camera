import {defaultAppearance} from './composite-color.js?v=0.9.1';
import {boundedRect,validateCustomMask} from './custom-mask.js?v=0.9.1';
export const MAX_PARTS=8;
export const LEGACY_PART_NAMES=Object.freeze({mouth:'口',leftEye:'左目',rightEye:'右目',nose:'鼻'});
export const newPartId=()=>globalThis.crypto?.randomUUID?.()||`part-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function validPartName(value){if(typeof value!=='string'||!value.trim()||value.trim().length>40)throw new Error('パーツ名は1〜40文字で入力してください。');return value.trim();}
export function createPart(name='パーツ1',zIndex=0){
  return {id:newPartId(),name:validPartName(name),enabled:true,zIndex,targetRect:{x:50,y:50,width:24,height:18},
    sourceRect:{x:.5,y:.5,zoom:1.5,aspect:1},rotation:0,shape:'oval',feather:20,guides:{photo:true,camera:true},appearance:defaultAppearance()};
}
export const sourceForDisplay=(part,mirror)=>{
  if(part.shape==='freehand'&&part.customMask){const r=part.customMask.rect;return {rect:r,x:mirror?1-r.x-r.width/2:r.x+r.width/2,y:r.y+r.height/2,zoom:.6/r.width};}
  return {...part.sourceRect,x:mirror?1-part.sourceRect.x:part.sourceRect.x};
};
export function setDisplaySource(part,source,mirror){
  if(part.shape==='freehand'&&part.customMask){const r=part.customMask.rect,scale=(.6/r.width)/source.zoom,w=r.width*scale,h=r.height*scale,f=Math.min(1,1/w,1/h),width=w*f,height=h*f;
    const rect=boundedRect({x:(mirror?1-source.x:source.x)-width/2,y:source.y-height/2,width,height});
    try{validateCustomMask({...part.customMask,rect});part.customMask.rect=rect;return true;}catch{return false;}}
  part.sourceRect={...part.sourceRect,...source,x:mirror?1-source.x:source.x};
}
export const orderedParts=parts=>[...parts].filter(p=>p.enabled).sort((a,b)=>a.zIndex-b.zIndex);
export class PartCollection {
  constructor(){this.parts=[createPart()];this.selectedId=this.parts[0].id;}
  get selected(){return this.parts.find(p=>p.id===this.selectedId)||null;}
  select(id){if(!this.parts.some(p=>p.id===id))return false;this.selectedId=id;return true;}
  uniqueName(base){let name=base,i=2;while(this.parts.some(p=>p.name===name))name=base.slice(0,34)+` ${i++}`;return name;}
  frontIndex(){return Math.max(-1,...this.parts.map(p=>p.zIndex))+1;}
  add(){if(this.parts.length>=MAX_PARTS)return null;let n=1;while(this.parts.some(p=>p.name===`パーツ${n}`))n++;const part=createPart(`パーツ${n}`,this.frontIndex());this.parts.push(part);this.selectedId=part.id;return part;}
  rename(name){if(!this.selected)return false;this.selected.name=validPartName(name);return true;}
  duplicate(){if(!this.selected||this.parts.length>=MAX_PARTS)return null;const part=structuredClone(this.selected);part.id=newPartId();part.name=this.uniqueName(part.name.slice(0,30)+' コピー');part.zIndex=this.frontIndex();part.targetRect.x=Math.min(100,part.targetRect.x+3);part.targetRect.y=Math.min(100,part.targetRect.y+3);if(part.targetRect.x===this.selected.targetRect.x&&part.targetRect.y===this.selected.targetRect.y){part.targetRect.x-=3;part.targetRect.y-=3;}this.parts.push(part);this.selectedId=part.id;return part;}
  removeSelected(){if(this.parts.length<=1)return false;const i=this.parts.findIndex(p=>p.id===this.selectedId);if(i<0)return false;this.parts.splice(i,1);this.selectedId=this.parts[Math.min(i,this.parts.length-1)].id;return true;}
  reorder(direction){const sorted=[...this.parts].sort((a,b)=>a.zIndex-b.zIndex),i=sorted.findIndex(p=>p.id===this.selectedId);
    const next=direction==='first'?sorted.length-1:direction==='last'?0:i+direction;if(i<0||next<0||next>=sorted.length||next===i)return false;
    sorted.splice(i,1);sorted.splice(next,0,this.selected);sorted.forEach((p,z)=>p.zIndex=z);return true;}
}
