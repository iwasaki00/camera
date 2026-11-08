import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Identical fixture, 4-part renderer, cadence and external timing for both revisions.
export async function comparePerformance({evaluate,waitFor}) {
  await evaluate(`(async()=>{
    window.benchImage=new Image();window.benchImage.src='./tests/fixtures/astronaut.png';await benchImage.decode();
    window.benchInput=document.createElement('canvas');benchInput.width=640;benchInput.height=480;
    const draw=()=>{const c=benchInput.getContext('2d');c.fillStyle='#191919';c.fillRect(0,0,640,480);c.drawImage(benchImage,100,30,240,270,150,50,340,382.5)};
    draw();window.benchFeed=setInterval(draw,33);window.benchVideo=document.createElement('video');benchVideo.muted=true;benchVideo.playsInline=true;document.body.append(benchVideo);
    benchVideo.srcObject=benchInput.captureStream(30);await benchVideo.play();window.benchOutput=document.createElement('canvas');benchOutput.width=400;benchOutput.height=600;
  })()`);
  const reports=[];
  try {
    for(const variant of ['baseline','candidate','candidate','baseline']) {
      const prefix=variant==='baseline'?'./baseline/':'./';
      await evaluate(`(async()=>{
        const {FaceTracker,createDetector}=await import('${prefix}tracking.js'),{CompositeRenderer}=await import('${prefix}renderer.js'),{createPart}=await import('${prefix}parts.js');
        window.benchSamples=[];window.benchFrames=0;window.benchTracker=new FaceTracker({video:benchVideo,factory:async signal=>{
          const detector=await createDetector(signal);return {backend:detector.backend,close:()=>detector.close(),detect:async(...args)=>{const r=await detector.detect(...args);benchSamples.push(r.ms);return r;}};
        }});
        const parts=['mouth','leftEye','rightEye','nose'].map((type,i)=>({...createPart(type,i),targetRect:{x:i%2?75:25,y:i<2?25:75,width:26,height:16},feather:10}));
        const renderer=new CompositeRenderer(),ctx=benchOutput.getContext('2d');let last=-Infinity;
        window.benchLive=true;const tick=time=>{if(!benchLive)return;if(time-last>=1000/30-1){const start=performance.now();ctx.clearRect(0,0,400,600);ctx.fillStyle='#a04030';ctx.fillRect(0,0,400,600);renderer.draw(ctx,benchVideo,parts,true,benchTracker.crops(parts,640,480));benchTracker.observeDraw?.(performance.now()-start);benchFrames++;last=time;}window.benchRAF=requestAnimationFrame(tick)};
        benchRAF=requestAnimationFrame(tick);await benchTracker.start();
      })()`);
      await waitFor("window.benchTracker.state.status==='tracking'",300);
      await evaluate("new Promise(r=>setTimeout(r,2500))");
      const result=await evaluate(`(async()=>{
        benchSamples=[];benchFrames=0;const start=performance.now();await new Promise(r=>setTimeout(r,5000));const elapsed=performance.now()-start;
        const result={variant:'${variant}',backend:benchTracker.metrics.backend,seconds:elapsed/1000,drawFps:benchFrames*1000/elapsed,detectionFps:benchSamples.length*1000/elapsed,
          inferenceMeanMs:benchSamples.reduce((a,b)=>a+b,0)/benchSamples.length,inferenceMaxMs:Math.max(...benchSamples),samples:benchSamples.length};
        benchLive=false;cancelAnimationFrame(benchRAF);benchTracker.stop();return result;
      })()`);
      assert.ok(result.samples>0);assert.equal(result.backend,'worker');reports.push(result);console.log('PERFORMANCE COMPARISON: '+JSON.stringify(result));
    }
  } finally {await evaluate('benchLive=false;cancelAnimationFrame(benchRAF);benchTracker?.stop();clearInterval(benchFeed);benchVideo.srcObject.getTracks().forEach(t=>t.stop());benchVideo.remove()');}
  if(process.env.PERFORMANCE_OUTPUT)await writeFile(process.env.PERFORMANCE_OUTPUT,JSON.stringify({conditions:{frame:'640x480',output:'400x600',parts:4,feather:10,delegate:'CPU',backend:'worker',warmupSeconds:2.5,sampleSeconds:5,order:'baseline,candidate,candidate,baseline',diagnostics:false},reports},null,2)+'\n');
}
