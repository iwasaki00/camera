import { LANDMARK_GROUPS } from '../face-landmarks.js';
// Synthetic geometry, not measured landmarks. Real inference is tested separately with astronaut.png.
export function mockLandmarks({dx=0,dy=0,scale=1,angle=0,mouthHeight=.07,width=640,height=480}={}) {
  const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  const boxes={mouth:[.5,.67,.24,mouthHeight],leftEye:[.65,.38,.15,.04],rightEye:[.35,.38,.15,.04],nose:[.5,.52,.14,.18]};
  for(const [type,indices] of Object.entries(LANDMARK_GROUPS)){
    const [x,y,w,h]=boxes[type];
    indices.forEach((id,i)=>{
      const phase=i/indices.length*Math.PI*2;
      const px=(x+w/2*Math.cos(phase)-.5)*width*scale,py=(y+h/2*Math.sin(phase)-.5)*height*scale;
      points[id]={x:.5+(px*Math.cos(angle)-py*Math.sin(angle))/width+dx,
        y:.5+(px*Math.sin(angle)+py*Math.cos(angle))/height+dy,z:0};
    });
  }
  return points;
}
