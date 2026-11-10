// Additive percentages, except temperature/tint/grain (RGB-point controls).
export const COLOR_RANGES = Object.freeze({brightness:[-50,50],contrast:[-50,80],saturation:[-100,100],temperature:[-40,40],tint:[-40,40],grain:[0,15],blendStrength:[0,100],edgeSoftness:[0,30],edgeContrast:[0,60]});
export const DEFAULT_COMPOSITE = Object.freeze({mode:'original',blendStrength:100,autoMatch:false,textureEnabled:true});
const neutral = {brightness:0,contrast:0,saturation:0,temperature:0,tint:0,grain:0,blendStrength:100,edgeSoftness:0,edgeContrast:0};
export function defaultAppearance() {
  return {natural:{...neutral,contrast:-4,saturation:-6,grain:1,edgeSoftness:6},comic:{...neutral,brightness:6,contrast:22,saturation:30,edgeContrast:25}};
}
export function validateComposite(value) {
  if(!value||!['original','natural','comic'].includes(value.mode)||!valid(value.blendStrength,0,100)||typeof value.autoMatch!=='boolean'||typeof value.textureEnabled!=='boolean')throw new Error('合成モード・補正強度の設定が不正です。');
  return {mode:value.mode,blendStrength:value.blendStrength,autoMatch:value.autoMatch,textureEnabled:value.textureEnabled};
}
const valid=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateAppearance(value) {
  const result={};
  for(const mode of ['natural','comic']) {
    if(!value?.[mode])throw new Error('パーツの色調補正がありません。');
    result[mode]={};
    for(const [key,[min,max]]of Object.entries(COLOR_RANGES)) {
      if(!valid(value[mode][key],min,max))throw new Error('パーツの色調・境界補正値が不正です。');
      result[mode][key]=value[mode][key];
    }
  }
  return result;
}
export function activeCorrection(composite,appearance) {
  if(!composite||composite.mode==='original'||composite.blendStrength===0)return null;
  const settings=appearance?.[composite.mode];
  if(!settings||settings.blendStrength===0)return null;
  if(!(composite.autoMatch&&composite.mode==='natural')&&!Object.entries(settings).some(([k,v])=>k!=='blendStrength'&&v!==0&&(k!=='grain'||composite.textureEnabled)&&(k!=='edgeContrast'||composite.mode==='comic')))return null;
  return settings;
}
const bound=(v,a,b)=>Math.max(a,Math.min(b,v));
// Conservative warm-skin heuristic, not semantic segmentation. Dark pupils/mouth and white teeth are excluded.
export function skinWeight(r,g,b) {
  const light=.2126*r+.7152*g+.0722*b;
  if(light<35||light>225||r<b*1.02||g<b*.95||r>g*1.85||r<g*.95||Math.max(r,g,b)-Math.min(r,g,b)<8)return 0;
  return Math.min(1,(light-35)/30,(225-light)/30);
}
const median=values=>{values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length/2)]:0;};
export function representativeColor(data,width,height,shape='oval') {
  const rs=[],gs=[],bs=[];let ring=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const dx=(x+.5)/width*2-1,dy=(y+.5)/height*2-1;
    const radius=shape==='rectangle'?Math.max(Math.abs(dx),Math.abs(dy)):Math.hypot(dx,dy);
    if(radius<.65||radius>.96)continue;
    ring++;const i=(y*width+x)*4;
    if(data[i+3]<200||skinWeight(data[i],data[i+1],data[i+2])<.25)continue;
    rs.push(data[i]);gs.push(data[i+1]);bs.push(data[i+2]);
  }
  if(rs.length<12||rs.length<ring*.3)return null;
  const color=[median(rs),median(gs),median(bs)];
  const spread=median(rs.map((r,i)=>Math.abs(r-color[0])+Math.abs(gs[i]-color[1])+Math.abs(bs[i]-color[2])));
  return spread>65?null:color;
}
export function matchGains(target,source) {
  if(!target||!source)return [1,1,1];
  return target.map((value,i)=>bound(value/Math.max(25,source[i]),.85,1.18));
}
export function smoothGains(previous,next,elapsed) {
  const alpha=1-Math.exp(-Math.max(0,elapsed)/300);
  return next.map((n,i)=>previous[i]+(n-previous[i])*alpha);
}
export function grainPattern(width,height) {
  const values=new Float32Array(width*height);
  for(let i=0;i<values.length;i++) {let n=Math.imul(i+1,0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);values[i]=((n^(n>>>16))>>>0)/4294967295-.5;}
  return values;
}
export function correctPixels(data,width,height,settings,strength,gains=[1,1,1],noise=null,comic=false,shape='oval') {
  const amount=bound(strength*settings.blendStrength/100,0,1),contrast=1+settings.contrast/100,saturation=1+settings.saturation/100;
  const brightness=settings.brightness*2.55,temperature=settings.temperature*.6,tint=settings.tint*.5;
  const matched=gains[0]!==1||gains[1]!==1||gains[2]!==1;
  for(let i=0,p=0;i<data.length;i+=4,p++) {
    const r=data[i],g=data[i+1],b=data[i+2],skin=matched?skinWeight(r,g,b):0;
    let rr=(r-127.5)*contrast+127.5+brightness+temperature+tint;
    let gg=(g-127.5)*contrast+127.5+brightness-tint;
    let bb=(b-127.5)*contrast+127.5+brightness-temperature+tint;
    const light=.2126*rr+.7152*gg+.0722*bb;
    rr=(light+(rr-light)*saturation)*(1+(gains[0]-1)*skin);
    gg=(light+(gg-light)*saturation)*(1+(gains[1]-1)*skin);
    bb=(light+(bb-light)*saturation)*(1+(gains[2]-1)*skin);
    const grain=noise?noise[p]*settings.grain:0;
    let edge=1;
    if(comic&&settings.edgeContrast) {
      const dx=Math.abs((p%width+.5)/width*2-1),dy=Math.abs((Math.floor(p/width)+.5)/height*2-1);
      const radius=shape==='rectangle'?Math.max(dx,dy):Math.hypot(dx,dy);
      edge=1-settings.edgeContrast/100*bound((radius-.78)/.17,0,1);
    }
    data[i]=bound(r+((rr+grain)*edge-r)*amount,0,255);
    data[i+1]=bound(g+((gg+grain)*edge-g)*amount,0,255);
    data[i+2]=bound(b+((bb+grain)*edge-b)*amount,0,255);
    // Alpha belongs solely to the existing shape mask, never to color analysis.
  }
}

// Analysis is limited to 48x48 samples, at most 8Hz. No full-background pixel readback.
export class ColorProcessor {
  constructor(createCanvas) {this.sample=createCanvas();this.sample.width=this.sample.height=48;this.background=null;this.targetKey='';this.gains=[1,1,1];this.last=-Infinity;}
  target(background,part) {
    const key=[background?.width,background?.height,part.x,part.y,part.width,part.height,part.rotation,part.shape].join(':');
    if(this.background===background&&this.targetKey===key)return this.targetColor;
    this.background=background;this.targetKey=key;this.gains=[1,1,1];this.last=-Infinity;
    if(!background){this.targetColor=null;return null;}
    const c=this.sample.getContext('2d',{willReadFrequently:true}),w=background.width*part.width/100,h=background.height*part.height/100;
    c.resetTransform();c.clearRect(0,0,48,48);c.save();
    c.setTransform(48/(w*1.6),0,0,48/(h*1.6),24,24);c.rotate(-part.rotation*Math.PI/180);
    c.drawImage(background,-background.width*part.x/100,-background.height*part.y/100);c.restore();
    this.targetColor=representativeColor(c.getImageData(0,0,48,48).data,48,48,part.shape);this.analyses=(this.analyses||0)+1;
    return this.targetColor;
  }
  apply(patch,part,settings,composite,background,time) {
    const width=patch.width,height=patch.height,c=patch.getContext('2d',{willReadFrequently:true});
    if(composite.autoMatch&&composite.mode==='natural') {
      const target=this.target(background,part);
      if(time-this.last>=125) {
        const sample=this.sample.getContext('2d',{willReadFrequently:true});sample.resetTransform();sample.clearRect(0,0,48,48);sample.drawImage(patch,0,0,48,48);
        const next=matchGains(target,representativeColor(sample.getImageData(0,0,48,48).data,48,48,part.shape));
        this.gains=smoothGains(this.gains,next,Number.isFinite(this.last)?Math.min(500,time-this.last):125);this.last=time;
      }
    } else {this.gains[0]=this.gains[1]=this.gains[2]=1;this.last=-Infinity;}
    if(composite.textureEnabled&&settings.grain&&this.noise?.length!==width*height)this.noise=grainPattern(width,height);
    const image=c.getImageData(0,0,width,height);
    correctPixels(image.data,width,height,settings,composite.blendStrength/100,this.gains,composite.textureEnabled?this.noise:null,composite.mode==='comic',part.shape);
    c.putImageData(image,0,0);
  }
}
