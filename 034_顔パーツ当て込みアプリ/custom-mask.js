// Saved geometry is always in the original, unmirrored camera coordinate system.
export const MAX_MASK_POINTS=128;
export const MIN_MASK_AREA=.0005;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-7;
export function polygonArea(points){return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0))/2;}
function intersects(a,b,c,d){
  const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b),e=1e-10;
  const on=(p,q,r)=>Math.abs(cross(p,q,r))<e&&r.x>=Math.min(p.x,q.x)-e&&r.x<=Math.max(p.x,q.x)+e&&r.y>=Math.min(p.y,q.y)-e&&r.y<=Math.max(p.y,q.y)+e;
  return ((x>e&&y<-e)||(x<-e&&y>e))&&((z>e&&w<-e)||(z<-e&&w>e))||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
export function simplePolygon(points){
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];if(near(a,b))return false;
    for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return false;}
  }return true;
}
export function validateCustomMask(value){
  const fail=message=>{throw new Error('フリーハンド輪郭: '+message);};
  const r=value?.rect,p=value?.points;
  if(!r||![r.x,r.y,r.width,r.height].every(finite)||r.x<0||r.y<0||r.width<.01||r.height<.01||r.x+r.width>1+1e-9||r.y+r.height>1+1e-9)fail('切り抜き矩形が不正です。');
  if(!Array.isArray(p)||p.length<3||p.length>MAX_MASK_POINTS)fail(`点数は3〜${MAX_MASK_POINTS}点にしてください。`);
  if(p.some(v=>!v||![v.x,v.y].every(finite)||v.x<0||v.y<0||v.x>1||v.y>1))fail('点の座標が不正です。');
  if(!simplePolygon(p))fail('自己交差や重複した線があります。描き直してください。');
  if(polygonArea(p)*r.width*r.height<MIN_MASK_AREA)fail('領域が小さすぎるか、ほぼ直線です。広く囲み直してください。');
  return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},points:p.map(v=>({x:v.x,y:v.y}))};
}
function lineDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function simplifyOpen(points,tolerance){
  if(points.length<3)return points;let max=0,index=0;
  for(let i=1;i<points.length-1;i++){const d=lineDistance(points[i],points[0],points.at(-1));if(d>max){max=d;index=i;}}
  return max>tolerance?[...simplifyOpen(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyOpen(points.slice(index),tolerance)]:[points[0],points.at(-1)];
}
export function maskFromStroke(input){
  let p=[];for(const v of input){if(!v||![v.x,v.y].every(finite)||v.x<0||v.y<0||v.x>1||v.y>1)throw new Error('カメラ映像内を囲んでください。');if(!p.length||!near(v,p.at(-1)))p.push({x:v.x,y:v.y});}
  if(p.length>1&&near(p[0],p.at(-1)))p.pop();
  if(p.length<3||p.length>2048)throw new Error('線が短すぎるか長すぎます。描き直してください。');
  if(!simplePolygon(p))throw new Error('自己交差した輪郭は使えません。描き直してください。');
  const area=polygonArea(p);let split=1;
  for(let i=2;i<p.length;i++)if(Math.hypot(p[i].x-p[0].x,p[i].y-p[0].y)>Math.hypot(p[split].x-p[0].x,p[split].y-p[0].y))split=i;
  let reduced=p,tolerance=.0008;
  for(let i=0;i<18;i++){
    reduced=[...simplifyOpen(p.slice(0,split+1),tolerance).slice(0,-1),...simplifyOpen([...p.slice(split),p[0]],tolerance).slice(0,-1)];
    if(reduced.length<=MAX_MASK_POINTS)break;tolerance*=1.5;
  }
  if(Math.abs(polygonArea(reduced)-area)>area*.1||!simplePolygon(reduced))throw new Error('輪郭を安全に簡略化できません。少し滑らかに描き直してください。');
  const x=Math.min(...reduced.map(v=>v.x)),y=Math.min(...reduced.map(v=>v.y)),width=Math.max(...reduced.map(v=>v.x))-x,height=Math.max(...reduced.map(v=>v.y))-y;
  return validateCustomMask({rect:{x,y,width,height},points:reduced.map(v=>({x:(v.x-x)/width,y:(v.y-y)/height}))});
}
export function displayToRaw(point,geometry,view,mirror){
  const x=(point.x-geometry.origin.x-view.x)/view.scale/geometry.width,y=(point.y-geometry.origin.y-view.y)/view.scale/geometry.height;
  return {x:mirror?1-x:x,y};
}
export function boundedRect(rect){
  const width=Math.max(.01,Math.min(1,rect.width)),height=Math.max(.01,Math.min(1,rect.height));
  return {x:Math.max(0,Math.min(1-width,rect.x)),y:Math.max(0,Math.min(1-height,rect.y)),width,height};
}
// Rasterize once, then feather inward with a linear-time chamfer distance transform.
export function polygonMask(ctx,width,height,points,feather,mirror=false){
  ctx.clearRect(0,0,width,height);ctx.fillStyle='#fff';ctx.beginPath();
  points.forEach((p,i)=>{const x=(mirror?1-p.x:p.x)*width,y=p.y*height;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();ctx.fill();
  if(!feather)return;
  const image=ctx.getImageData(0,0,width,height),a=image.data,d=new Float32Array(width*height),diagonal=Math.SQRT2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;d[i]=a[i*4+3]<255||x===0||y===0||x===width-1||y===height-1?0:1e6;}
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;d[i]=Math.min(d[i],d[i-1]+1,d[i-width]+1,d[i-width-1]+diagonal,d[i-width+1]+diagonal);}
  for(let y=height-2;y>0;y--)for(let x=width-2;x>0;x--){const i=y*width+x;d[i]=Math.min(d[i],d[i+1]+1,d[i+width]+1,d[i+width+1]+diagonal,d[i+width-1]+diagonal);}
  const radius=Math.min(width,height)*feather/200;
  for(let i=0;i<d.length;i++){const t=Math.min(1,d[i]/radius);a[i*4+3]=Math.round(a[i*4+3]*t*t*(3-2*t));}
  ctx.putImageData(image,0,0);
}
