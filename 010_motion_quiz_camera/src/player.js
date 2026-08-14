import { PoseRenderer } from "./renderer.js";

export class MotionPlayer {
  constructor(canvas) { this.canvas=canvas; this.renderer=new PoseRenderer(canvas); this.frames=[]; this.speed=1; this.loop=true; this.playing=false; }
  load(frames,difficulty,width=640,height=480) { this.stop(); this.frames=frames||[]; this.difficulty=difficulty; this.duration=this.frames.at(-1)?.time||0; this.renderer.width=width;this.renderer.height=height;this.canvas.width=width;this.canvas.height=height;this.drawFrame(this.frames[0]?.landmarks||[]); }
  play() { if(!this.frames.length)return;this.playing=true;this.started=performance.now();this.offset=this.current||0;this.tick(); }
  pause(){this.playing=false;cancelAnimationFrame(this.raf)}
  stop(){this.pause();this.current=0}
  tick=()=>{if(!this.playing)return;let t=this.offset+(performance.now()-this.started)/1000*this.speed;if(t>this.duration){if(this.loop){t=0;this.started=performance.now();this.offset=0}else{this.pause();return}}this.current=t;let frame=this.frames[0];for(const item of this.frames){if(item.time>t)break;frame=item}this.drawFrame(frame?.landmarks||[]);this.raf=requestAnimationFrame(this.tick)};
  drawFrame(landmarks){const ctx=this.canvas.getContext("2d");ctx.fillStyle="#020504";ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.renderer.drawSkeleton(ctx,landmarks,this.difficulty,this.canvas.width,this.canvas.height)}
}
