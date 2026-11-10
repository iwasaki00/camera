import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function compareRecordingPerformance({evaluate,waitFor}) {
  const rows=[];
  for(const mode of ['original','natural'])for(const recording of [false,true]) {
    await evaluate(`(()=>{const e=document.querySelector('#composite-mode');e.value='${mode}';e.dispatchEvent(new Event('change'));document.querySelector('#diagnostics').open=true;document.querySelector('#record-mic').checked=false;})()`);
    if(recording){await evaluate("document.querySelector('#record-start').click()");await waitFor("document.querySelector('#record-status').dataset.state==='recording'");}
    await new Promise(r=>setTimeout(r,1000));
    const row=await evaluate(`(async()=>{const ctx=document.querySelector('#composition').getContext('2d'),original=ctx.clearRect;let frames=0;ctx.clearRect=function(...a){frames++;return original.apply(this,a)};
      const before=Number(document.querySelector('#tracking-status').dataset.count),start=performance.now();await new Promise(r=>setTimeout(r,5500));const elapsed=performance.now()-start;ctx.clearRect=original;
      return {mode:'${mode}',recording:${recording},drawFps:frames*1000/elapsed,detectionFps:(Number(document.querySelector('#tracking-status').dataset.count)-before)*1000/elapsed,diagnostics:document.querySelector('#diagnostic-values').textContent};})()`);
    assert.ok(row.drawFps>0&&row.detectionFps>0);rows.push(row);console.log('PERF RECORDING '+JSON.stringify(row));
    if(recording){await evaluate("document.querySelector('#record-stop').click()");await waitFor("document.querySelector('#record-result').open");
      const data=await evaluate("(async()=>{const a=document.querySelector('#record-download');return{extension:a.download.split('.').at(-1),bytes:[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]}})()");
      const file=`reports/v0.6.0-tracked-${mode}.${data.extension}`;await writeFile(file,new Uint8Array(data.bytes));const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(Number(probe.format.duration)>5);row.file=file;row.bytes=data.bytes.length;row.duration=Number(probe.format.duration);
      await evaluate("document.querySelector('#record-close').click()");}
  }
  await writeFile('reports/v0.6.0-performance.json',JSON.stringify({conditions:'Desktop Chrome / actual local Face Landmarker Worker / NASA still-face input 640x480 at 30fps / 4 parts / output and recording 400x600 / 24fps target / 5.5s samples after 1s settling / sequential single browser',rows},null,2)+'\n');
}
