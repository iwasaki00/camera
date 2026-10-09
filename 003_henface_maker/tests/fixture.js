export function createFixture() {
const canvas = () => { const c=document.createElement('canvas');c.width=480;c.height=640;return c; };
const base=canvas(), b=base.getContext('2d');
b.fillStyle='#b5d5df';b.fillRect(0,0,480,640);
b.fillStyle='#dbad8e';b.beginPath();b.ellipse(240,310,160,240,0,0,Math.PI*2);b.fill();
// Fine grid reveals clipping seams and sampling discontinuities.
b.strokeStyle='rgba(70,40,20,.15)';b.lineWidth=1;
for(let x=80;x<410;x+=16){b.beginPath();b.moveTo(x,70);b.lineTo(x,550);b.stroke();}
for(let y=80;y<560;y+=16){b.beginPath();b.moveTo(80,y);b.lineTo(400,y);b.stroke();}
const landmarks=Array.from({length:478},()=>({x:.5,y:.5}));
function feature(ids,cx,cy,rx,ry){ids.forEach((id,i)=>{const a=i/ids.length*Math.PI*2;landmarks[id]={x:1-(cx+Math.cos(a)*rx)/480,y:(cy+Math.sin(a)*ry)/640};});}
feature([6,1,2,98,327,168,197],240,315,25,45);
feature([33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],175,235,35,15);
feature([362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382],305,235,35,15);
feature([61,291,13,14,78,308,0,17],240,410,55,20);
feature([46,53,52,65,55,70,63,105,66,107],175,195,40,8);
feature([276,283,282,295,285,300,293,334,296,336],305,195,40,8);
for(const x of [175,305]){b.fillStyle='#fff';b.beginPath();b.ellipse(x,235,35,15,0,0,Math.PI*2);b.fill();b.fillStyle='#352720';b.beginPath();b.arc(x,235,9,0,Math.PI*2);b.fill();b.fillRect(x-40,188,80,9);}
b.strokeStyle='#704c37';b.lineWidth=5;b.beginPath();b.moveTo(240,280);b.lineTo(220,345);b.lineTo(260,345);b.stroke();
b.fillStyle='#a04e50';b.beginPath();b.ellipse(240,410,55,20,0,0,Math.PI*2);b.fill();
b.strokeStyle='#252525';b.lineWidth=4;for(const x of [175,305])b.strokeRect(x-49,210,98,52);b.beginPath();b.moveTo(224,223);b.lineTo(256,223);b.stroke();

landmarks[152]={x:.5,y:550/640};
feature([148,176,149,150,377,400,378],240,460,115,75);
return {base,landmarks};
}
