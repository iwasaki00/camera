import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function compareRecordingPerformance({evaluate,waitFor}) {
  const rows=[];
  await evaluate("window.recordingMotion=setInterval(()=>drawFace({dx:8*Math.sin(performance.now()/500)}),100)");
  for(const mode of ['original','natural'])for(const recording of [false,true]) {
    await evaluate(`(()=>{const e=document.querySelector('#composite-mode');e.value='${mode}';e.dispatchEvent(new Event('change'));document.querySelector('#diagnostics').open=true;document.querySelector('#record-mic').checked=false;})()`);
    if(recording){await evaluate("document.querySelector('#record-start').click()");await waitFor("document.querySelector('#record-status').dataset.state==='recording'");}
    await new Promise(r=>setTimeout(r,1000));
    const row=await evaluate(`(async()=>{const ctx=document.querySelector('#composition').getContext('2d'),original=ctx.clearRect;let frames=0;ctx.clearRect=function(...a){frames++;return original.apply(this,a)};
      const before=Number(document.querySelector('#tracking-status').dataset.count),start=performance.now();await new Promise(r=>setTimeout(r,5500));const elapsed=performance.now()-start;ctx.clearRect=original;
      const diagnostics=document.querySelector('#diagnostic-values').textContent,match=diagnostics.match(/合成ms 平均[/]最大（同じ計測窓）: ([0-9.]+) [/] ([0-9.]+)/),plan=diagnostics.match(/録画解像度: ([0-9]+)×([0-9]+) [/] 設定fps: ([0-9]+)/);
      const transfer=diagnostics.match(/録画Canvas転送ms 平均[/]最大（今回の録画全体）: ([0-9.]+) [/] ([0-9.]+)/),elapsedRecording=diagnostics.match(/経過秒: ([0-9.]+)/);
      return {mode:'${mode}',recording:${recording},drawFps:frames*1000/elapsed,detectionFps:(Number(document.querySelector('#tracking-status').dataset.count)-before)*1000/elapsed,compositeAverageMs:match?Number(match[1]):null,compositeMaxMs:match?Number(match[2]):null,recordingTransferAverageMs:${recording}&&transfer?Number(transfer[1]):null,recordingTransferMaxMs:${recording}&&transfer?Number(transfer[2]):null,recordingElapsedSeconds:${recording}&&elapsedRecording?Number(elapsedRecording[1]):null,recordingWidth:${recording}&&plan?Number(plan[1]):null,recordingHeight:${recording}&&plan?Number(plan[2]):null,recordingFps:${recording}&&plan?Number(plan[3]):null,diagnostics};})()`);
    assert.ok(row.drawFps>0&&row.detectionFps>0);rows.push(row);console.log('PERF RECORDING '+JSON.stringify(row));
    if(recording){await evaluate("document.querySelector('#record-stop').click()");await waitFor("document.querySelector('#record-result').open");await waitFor("document.querySelector('#diagnostic-values').textContent.includes('録画状態: READY')");const finalDiagnostic=await evaluate("document.querySelector('#diagnostic-values').textContent");row.recordingWallSeconds=Number(finalDiagnostic.match(/経過秒: ([0-9.]+)/)[1]);
      const data=await evaluate("(async()=>{const a=document.querySelector('#record-download');return{extension:a.download.split('.').at(-1),bytes:[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]}})()");
      const file=`reports/v0.6.2-tracked-${mode}.${data.extension}`;await writeFile(file,new Uint8Array(data.bytes));const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(Number(probe.format.duration)>5);row.file=file;row.bytes=data.bytes.length;row.duration=Number(probe.format.duration);
      const hashes=execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1));row.uniqueFrames=new Set(hashes).size;assert.ok(row.uniqueFrames>2);
      await evaluate("document.querySelector('#record-acknowledge').click();document.querySelector('#record-close').click()");}
  }
  await evaluate('clearInterval(recordingMotion);drawFace()');
  await writeFile('reports/v0.6.2-performance.json',JSON.stringify({conditions:'Desktop Chrome / actual local Face Landmarker Worker / NASA face translated horizontally +/-8px at 10Hz, input 640x480 at 30fps / 4 parts / output and recording 400x600 / 24fps target / 5.5s samples after 1s settling / sequential single browser / diagnostics ON',rows},null,2)+'\n');
}
