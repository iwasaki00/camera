import { LANDMARK_GROUPS } from './face-landmarks.js?v=0.8.0';

export const DEFAULT_CORRECTION = Object.freeze({ offsetX: 0, offsetY: 0, widthScale: 1, heightScale: 1, rotation: 0 });
export const TRACKING_CONFIG = Object.freeze({
  inputEdge: 480, fallbackEdge: 320, interval: 100, fallbackInterval: 200, maxInterval: 500,
  holdMs: 650, positionTau: 45, sizeTau: 60, rotationTau: 60,
  positionDeadband: .0006, sizeDeadband: .006, angleDeadband: .002, mouthGrowthTau: 6,
  maxRoll: 75, maxDepthRatio: .95, maxJump: .22, maxScaleJump: 2.8
});
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const correctionFor = part => ({ ...DEFAULT_CORRECTION, ...part.tracking });
export const angleDelta = (a, b) => Math.atan2(Math.sin(a-b), Math.cos(a-b));
const mean = points => ({ x: points.reduce((n,p)=>n+p.x,0)/points.length, y: points.reduce((n,p)=>n+p.y,0)/points.length,
  z: points.reduce((n,p)=>n+p.z,0)/points.length });

// All geometry is measured on the original unmirrored frame, never in CSS coordinates.
export function landmarksToCrops(landmarks, width, height, config = TRACKING_CONFIG) {
  if (!Array.isArray(landmarks) || landmarks.length < 468 || !(width > 0 && height > 0)) return null;
  const groups = {};
  for (const [type, indices] of Object.entries(LANDMARK_GROUPS)) {
    const points = indices.map(i=>landmarks[i]);
    if (points.some(p=>!p || ![p.x,p.y,p.z].every(Number.isFinite) || p.x<0 || p.x>1 || p.y<0 || p.y>1 || Math.abs(p.z)>2)) return null;
    groups[type] = points.map(p=>({ x:p.x*width, y:p.y*height, z:p.z*width }));
  }
  const left = mean(groups.leftEye), right = mean(groups.rightEye);
  const eyeDistance = Math.hypot(left.x-right.x, left.y-right.y);
  const angle = Math.atan2(left.y-right.y, left.x-right.x);
  if (eyeDistance < width*.025 || eyeDistance > width*.85 || Math.abs(angle)*180/Math.PI > config.maxRoll
    || Math.abs(left.z-right.z)/eyeDistance > config.maxDepthRatio) return null;
  const cos = Math.cos(angle), sin = Math.sin(angle), result = {};
  for (const [type, points] of Object.entries(groups)) {
    const local = points.map(p=>({ x:p.x*cos+p.y*sin, y:-p.x*sin+p.y*cos }));
    const xs = local.map(p=>p.x), ys = local.map(p=>p.y);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
    const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
    let w=maxX-minX, h=maxY-minY;
    if (type==='mouth') { w=Math.max(w,eyeDistance*.25)*1.3; h=Math.max(h,eyeDistance*.18,w*.28)*1.4; }
    else if (type==='nose') { w=Math.max(w,eyeDistance*.2)*1.15; h=Math.max(h,eyeDistance*.25)*1.12; }
    else { w=Math.max(w,eyeDistance*.15)*1.35; h=Math.max(h,w*.38)*1.5; }
    if (w>width*.9 || h>height*.9 || w<1 || h<1) return null;
    result[type] = { x:(cx*cos-cy*sin)/width, y:(cx*sin+cy*cos)/height, width:w/width, height:h/height, angle };
  }
  // A severe profile compresses one eye. Treat it as low quality instead of distorting the crop.
  const ratio=result.leftEye.width/result.rightEye.width;
  if(ratio<.35 || ratio>2.85) return null;
  return result;
}

export function correctedCrop(crop, correction, width, height) {
  const c={...DEFAULT_CORRECTION,...correction}, cos=Math.cos(crop.angle), sin=Math.sin(crop.angle);
  const dx=c.offsetX*crop.width*width, dy=c.offsetY*crop.height*height;
  const result={ x:crop.x*width+dx*cos-dy*sin, y:crop.y*height+dx*sin+dy*cos,
    width:crop.width*width*c.widthScale, height:crop.height*height*c.heightScale, angle:crop.angle+c.rotation*Math.PI/180 };
  const a=Math.abs(Math.cos(result.angle)), b=Math.abs(Math.sin(result.angle));
  const extentX=a*result.width+b*result.height, extentY=b*result.width+a*result.height;
  const scale=Math.min(1,width/extentX,height/extentY);
  result.width*=scale;result.height*=scale;
  const hx=(a*result.width+b*result.height)/2, hy=(b*result.width+a*result.height)/2;
  result.x=clamp(result.x,hx,width-hx);result.y=clamp(result.y,hy,height-hy);
  return result;
}

export function displayCrop(crop, width, mirror) {
  return {...crop,x:mirror?width-crop.x:crop.x,angle:mirror?-crop.angle:crop.angle};
}

// Only the last accepted crops are retained. No frame, landmark history or identity data is stored.
export class TrackingState {
  constructor(config=TRACKING_CONFIG) {this.config=config;this.clear();}
  clear() {this.crops=null;this.lastGood=-Infinity;this.lastRaw=null;this.pending=null;this.status='stopped';}
  accept(landmarks,width,height,time) {
    const next=landmarksToCrops(landmarks,width,height,this.config);
    if(!next){this.miss(time);return false;}
    const raw=Object.fromEntries(Object.entries(next).map(([type,crop])=>[type,{...crop}]));
    const fresh=this.crops && time-this.lastGood<=this.config.holdMs;
    const dt=Math.max(1,time-this.lastGood);
    if(fresh && Object.keys(next).some(type=>{
      const a=next[type],b=this.lastRaw[type],ratio=a.width/b.width,heightRatio=a.height/b.height;
      return Math.hypot(a.x-b.x,a.y-b.y)>Math.min(.45,this.config.maxJump*Math.max(1,dt/150)) || ratio>this.config.maxScaleJump || ratio<1/this.config.maxScaleJump
        || (type!=='mouth' && (heightRatio>this.config.maxScaleJump || heightRatio<1/this.config.maxScaleJump))
        || Math.abs(angleDelta(a.angle,b.angle))>Math.PI/3;
    })) {this.miss(time);return false;}
    // Do not interpolate an old, hidden face across the image. Confirm a distant reacquisition twice.
    if(!fresh && this.crops && Math.hypot(next.nose.x-this.crops.nose.x,next.nose.y-this.crops.nose.y)>this.config.maxJump) {
      const stable=this.pending && time-this.pending.time<=this.config.holdMs && Object.keys(next).every(type=>{
        const a=next[type],b=this.pending.crops[type];return Math.hypot(a.x-b.x,a.y-b.y)<.04 && Math.abs(Math.log(a.width/b.width))<.25 && Math.abs(angleDelta(a.angle,b.angle))<.25;
      });
      if(!stable){this.pending={crops:raw,time};this.status='detecting';return false;}
    }
    this.pending=null;
    for(const [type,crop] of Object.entries(next)) {
      if(!fresh){if(this.crops)crop.angle=this.crops[type].angle+angleDelta(crop.angle,this.crops[type].angle);continue;}
      const before=this.crops[type];
      for(const key of ['x','y','width','height']) {
        const tau=['x','y'].includes(key)?this.config.positionTau:this.config.sizeTau;
        const position=['x','y'].includes(key);
        const delta=position?crop[key]-before[key]:Math.log(crop[key]/before[key]);
        const band=position?this.config.positionDeadband:this.config.sizeDeadband;
        const adjusted=Math.sign(delta)*Math.max(0,Math.abs(delta)-band);
        const effectiveTau=type==='mouth' && key==='height' && delta>0?this.config.mouthGrowthTau:tau;
        const step=adjusted*(1-Math.exp(-dt/effectiveTau));
        crop[key]=position?before[key]+step:before[key]*Math.exp(step);
      }
      const delta=angleDelta(crop.angle,before.angle),band=this.config.angleDeadband;
      crop.angle=before.angle+Math.sign(delta)*Math.max(0,Math.abs(delta)-band)*(1-Math.exp(-dt/this.config.rotationTau));
    }
    this.lastRaw=raw;
    this.crops=next;this.lastGood=time;this.status='tracking';return true;
  }
  miss(time) {this.pending=null;this.status=this.crops && time-this.lastGood<=this.config.holdMs?'lost':'notFound';}
  visible(time) {
    if(this.pending && time-this.pending.time>this.config.holdMs)this.pending=null;
    if(time-this.lastGood>this.config.holdMs){if(this.crops && !this.pending)this.status='notFound';return null;}return this.crops;
  }
  resolve(parts,width,height,time) {
    const crops=this.visible(time),result={};if(!crops)return result;
    for(const part of parts)if(crops[part.partType])result[part.id]=correctedCrop(crops[part.partType],part.tracking,width,height);
    return result;
  }
}
