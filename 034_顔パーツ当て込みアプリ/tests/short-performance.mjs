import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function compareShortPerformance({evaluate,waitFor}) {
  const rows=[];
  await evaluate("window.recordingMotion=setInterval(()=>drawFace({dx:8*Math.sin(performance.now()/500)}),100);document.querySelector('#record-countdown').checked=false");
  const cases=[['original-off','original',false,'original','fit',''],['original-aspect','original',true,'original','fit',''],['vertical-fit','original',true,'vertical','fit',''],['vertical-fill','original',true,'vertical','fill',''],['vertical-title','original',true,'vertical','fit','日本語ショート動画'],['natural-off','natural',false,'vertical','fit',''],['vertical-natural-tracking','natural',true,'vertical','fit','']];
  for(const [name,mode,recording,aspect,framing,title] of cases) {
    await evaluate(`(()=>{for(const [id,v]of Object.entries(${JSON.stringify({'composite-mode':mode,'record-aspect':aspect,'record-framing':framing,'record-title':title,'record-title-time':'all','record-quality':'normal'})})){const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change'));}document.querySelector('#diagnostics').open=true;document.querySelector('#record-mic').checked=false;document.querySelector('#record-fade').checked=false;document.querySelector('#settings-panel').open=false;})()`);
    if(recording){await evaluate("document.querySelector('#record-start').click()");await waitFor("document.querySelector('#record-status').dataset.state==='recording'");}
    await new Promise(r=>setTimeout(r,1000));
    const row=await evaluate(`(async()=>{const ctx=document.querySelector('#composition').getContext('2d'),original=ctx.clearRect;let frames=0;ctx.clearRect=function(...a){frames++;return original.apply(this,a)};
      const before=Number(document.querySelector('#tracking-status').dataset.count),start=performance.now();await new Promise(r=>setTimeout(r,5500));const elapsed=performance.now()-start;ctx.clearRect=original;
      const diagnostics=document.querySelector('#diagnostic-values').textContent,match=diagnostics.match(/合成ms 平均[/]最大（同じ計測窓）: ([0-9.]+) [/] ([0-9.]+)/),transfer=diagnostics.match(/録画Canvas転送ms 平均[/]最大（今回の録画全体）: ([0-9.]+) [/] ([0-9.]+)/);
      return {name:'${name}',drawFps:frames*1000/elapsed,detectionFps:(Number(document.querySelector('#tracking-status').dataset.count)-before)*1000/elapsed,compositeAverageMs:match?Number(match[1]):null,transferAverageMs:${recording}&&transfer?Number(transfer[1]):null,diagnostics};})()`);
    assert.ok(row.drawFps>0&&row.detectionFps>0);rows.push(row);
    if(recording){await evaluate("document.querySelector('#record-stop').click()");await waitFor("document.querySelector('#record-result').open");
      const data=await evaluate("(async()=>{const a=document.querySelector('#record-download');return{extension:a.download.split('.').at(-1),bytes:[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]}})()");
      const file=`reports/v0.8.0-performance-${name}.${data.extension}`;await writeFile(file,new Uint8Array(data.bytes));const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{encoding:'utf8'})),video=probe.streams.find(s=>s.codec_type==='video');
      Object.assign(row,{file,bytes:data.bytes.length,duration:Number(probe.format.duration),width:video.width,height:video.height,configuredFps:24,frames:Number(video.nb_read_frames)});row.actualFps=row.frames/row.duration;
      assert.ok(row.duration>5);assert.equal(row.width,aspect==='vertical'?360:400);assert.equal(row.height,aspect==='vertical'?640:600);
      await evaluate("document.querySelector('#record-acknowledge').click();document.querySelector('#record-close').click()");}
    console.log('PERF SHORT '+JSON.stringify(row));
  }
  await evaluate('clearInterval(recordingMotion);drawFace()');
  await writeFile('reports/v0.8.0-performance.json',JSON.stringify({conditions:'Desktop Chrome, actual local Face Landmarker Worker; same 640x480 NASA face translated +/-8px at 10Hz, camera30fps, four parts, background400x600, diagnostics ON, output preview closed, seven sequential 5.5s samples after 1s settling. Encoded fps = decoded video frame count / file duration. Not iPhone results.',rows},null,2)+'\n');
}
