import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function compareNaturalPerformance({evaluate,waitFor}) {
  const reports=[];
  for(const mode of ['original','natural','natural','original']) {
    await evaluate(`(()=>{const e=document.querySelector('#composite-mode');e.value='${mode}';e.dispatchEvent(new Event('change'));const a=document.querySelector('#composite-auto');a.checked=true;a.dispatchEvent(new Event('change'));const d=document.querySelector('#diagnostics');d.open=false;})()`);
    await new Promise(r=>setTimeout(r,1500));
    await waitFor("document.querySelector('#tracking-status').dataset.state==='tracking'",200);
    await evaluate("document.querySelector('#diagnostics').open=true");
    await new Promise(r=>setTimeout(r,100));
    const result=await evaluate(`(async()=>{
      const ctx=document.querySelector('#composition').getContext('2d'),clear=ctx.clearRect;let count=0;
      ctx.clearRect=function(...args){count++;return clear.apply(this,args)};
      const start=performance.now(),before=Number(document.querySelector('#tracking-status').dataset.count);
      await new Promise(r=>setTimeout(r,5000));const elapsed=performance.now()-start;ctx.clearRect=clear;
      const diagnostic=document.querySelector('#diagnostic-values').textContent,match=diagnostic.match(/合成ms 平均[/]最大（同じ計測窓）: ([0-9.]+) [/] ([0-9.]+)/);
      return {mode:'${mode}',elapsedMs:elapsed,drawFps:count*1000/elapsed,detectionFps:(Number(document.querySelector('#tracking-status').dataset.count)-before)*1000/elapsed,
        compositeAverageMs:match?Number(match[1]):null,compositeMaxMs:match?Number(match[2]):null,backend:document.querySelector('#tracking-status').dataset.backend,diagnostic};
    })()`);
    assert.ok(result.drawFps>0&&result.detectionFps>0);assert.notEqual(result.compositeAverageMs,null);reports.push(result);console.log('PERF COLOR: '+JSON.stringify(result));
  }
  await evaluate("(()=>{document.querySelector('#diagnostics').open=false;const e=document.querySelector('#composite-mode');e.value='natural';e.dispatchEvent(new Event('change'));const a=document.querySelector('#composite-auto');a.checked=false;a.dispatchEvent(new Event('change'));})()");
  if(process.env.NATURAL_PERFORMANCE_OUTPUT)await writeFile(process.env.NATURAL_PERFORMANCE_OUTPUT,JSON.stringify({conditions:{browser:'Windows Chrome headless',input:'640x480 NASA face canvas stream',output:'400x600',parts:4,feather:10,model:'actual local MediaPipe Face Landmarker CPU',tracking:true,texture:true,autoMatchRequested:true,background:'#a04030 (conservative target skin test may reject)',warmupSeconds:1.5,sampleSeconds:5,diagnosticsWindowSeconds:5,order:'original,natural,natural,original'},reports},null,2)+'\n');
}
