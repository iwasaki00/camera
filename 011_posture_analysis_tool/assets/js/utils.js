export const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z||0)+(b.z||0))/2,visibility:Math.min(a.visibility??1,b.visibility??1)});
export const angleLine=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
export const angle3=(a,b,c)=>{const u={x:a.x-b.x,y:a.y-b.y},v={x:c.x-b.x,y:c.y-b.y};const d=u.x*v.x+u.y*v.y,m=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);return m?Math.acos(Math.max(-1,Math.min(1,d/m)))*180/Math.PI:0};
export const averageFrames=frames=>frames[0].map((_,i)=>{const pts=frames.map(f=>f[i]);return{x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length,z:pts.reduce((s,p)=>s+(p.z||0),0)/pts.length,visibility:pts.reduce((s,p)=>s+(p.visibility??1),0)/pts.length}});
export const fmt=(n,unit="°")=>`${n>=0?"":"−"}${Math.abs(n).toFixed(1)}${unit}`;
export const safeDate=iso=>new Intl.DateTimeFormat("ja-JP",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
