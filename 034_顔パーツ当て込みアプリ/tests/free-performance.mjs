import assert from 'node:assert/strict';import{writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';
export async function compareFreePerformance({evaluate,command,waitFor}){
 const rows=[];
 for(const parts of [1,4,8]){
  await command('Page.reload');await waitFor("document.body.dataset.appState==='ready'");
  await evaluate(`(async()=>{const bg=document.createElement('canvas');bg.width=400;bg.height=600;const b=bg.getContext('2d');b.fillStyle='#bd927a';b.fillRect(0,0,400,600);const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>bg.toBlob(r))],'perf.png',{type:'image/png'}));const e=document.querySelector('#image-file');e.files=dt.files;e.dispatchEvent(new Event('change'));
    window.perfFeed=document.createElement('canvas');perfFeed.width=640;perfFeed.height=480;let i=0;window.perfTimer=setInterval(()=>{const c=perfFeed.getContext('2d');c.fillStyle='hsl('+(i++*3%360)+' 40% 55%)';c.fillRect(0,0,640,480);c.fillStyle='#303030';c.fillRect(100+Math.sin(i/5)*30,120,25,40)},33);navigator.mediaDevices.getUserMedia=async()=>perfFeed.captureStream(30);})()`);
  await waitFor("!document.querySelector('#save').disabled");
  for(let i=0;i<parts;i++){if(i)await evaluate("document.querySelector('#part-add').click()");await evaluate(`(()=>{for(const[k,v]of Object.entries({x:${parts===1?50:25+(i%2)*50},y:${parts===1?50:15+Math.floor(i/2)*23},width:24,height:18})){const e=document.querySelector('#part-'+k);e.value=v;e.dispatchEvent(new Event('input'));}})()`);}
  await evaluate("document.querySelector('#start').click();document.querySelector('#record-countdown').checked=false;document.querySelector('#record-aspect').value='vertical';document.querySelector('#diagnostics').open=true");await waitFor("document.querySelector('#camera').readyState>=2");
  for(const mode of ['original','natural'])for(const recording of [false,true]){
   await evaluate(`(()=>{const e=document.querySelector('#composite-mode');e.value='${mode}';e.dispatchEvent(new Event('change'));})()`);
   if(recording){await evaluate("document.querySelector('#record-start').click()");await waitFor("document.querySelector('#record-status').dataset.state==='recording'");
    assert.equal(await evaluate("[...document.querySelectorAll('#part-list button')].every(b=>b.disabled)&&document.querySelector('#part-add').disabled&&document.querySelector('#templates-open').disabled&&document.querySelector('#part-name').disabled"),true);
    await evaluate("for(const id of ['camera','finished','photo'])document.querySelector('#screen-'+id).click()");assert.equal(await evaluate("document.querySelector('#record-status').dataset.state"),'recording');
   }
   await new Promise(r=>setTimeout(r,600));
   // Reset the diagnostic window so a previous mode cannot contaminate this short sample.
   await evaluate("(async()=>{const d=document.querySelector('#diagnostics');d.open=false;await new Promise(r=>setTimeout(r,30));d.open=true;await new Promise(r=>setTimeout(r,30));})()");
   const heapBefore=await command('Runtime.getHeapUsage');
   const row=await evaluate(`(async()=>{const c=document.querySelector('#composition').getContext('2d'),original=c.clearRect;let frames=0;c.clearRect=function(...a){frames++;return original.apply(this,a)};const start=performance.now();await new Promise(r=>setTimeout(r,3500));const elapsed=performance.now()-start;c.clearRect=original;const text=document.querySelector('#diagnostic-values').textContent,composite=text.match(/合成ms 平均[/]最大（同じ計測窓）: ([0-9.]+) [/] ([0-9.]+)/),transfer=text.match(/録画Canvas転送ms 平均[/]最大（今回の録画全体）: ([0-9.]+) [/] ([0-9.]+)/);return{parts:${parts},mode:'${mode}',recording:${recording},drawFps:frames*1000/elapsed,compositeAverageMs:composite?Number(composite[1]):null,transferAverageMs:${recording}&&transfer?Number(transfer[1]):null}})()`);
   const heapAfter=await command('Runtime.getHeapUsage');row.jsHeapBefore=heapBefore.usedSize;row.jsHeapAfter=heapAfter.usedSize;assert.ok(row.drawFps>0&&row.compositeAverageMs!==null);
   if(recording){await evaluate("document.querySelector('#record-stop').click()");await waitFor("document.querySelector('#record-result').open&&document.querySelector('#record-player').readyState>=2");
    const data=await evaluate("(async()=>{const a=document.querySelector('#record-download');return{ext:a.download.split('.').at(-1),bytes:[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]}})()");const file=`reports/v0.9.0-${parts}-parts-${mode}.${data.ext}`;await writeFile(file,new Uint8Array(data.bytes));const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{encoding:'utf8'})),v=probe.streams.find(s=>s.codec_type==='video');assert.equal(v.width,360);assert.equal(v.height,640);row.duration=Number(probe.format.duration);row.bytes=data.bytes.length;row.actualFps=Number(v.nb_read_frames)/row.duration;row.file=file;
    const hashes=execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1));assert.ok(new Set(hashes).size>3);
    await command('Runtime.evaluate',{expression:"document.querySelector('#record-player').play()",userGesture:true,awaitPromise:true});await waitFor("document.querySelector('#record-player').currentTime>.1");await evaluate("document.querySelector('#record-acknowledge').click();document.querySelector('#record-close').click()");
   }rows.push(row);console.log('PERF FREE '+JSON.stringify(row));
  }
  assert.equal(await evaluate("!performance.getEntriesByType('resource').some(r=>/mediapipe|landmarker|tracking-worker/.test(r.name))"),true);await evaluate('clearInterval(perfTimer)');
 }
 await writeFile('reports/v0.9.0-performance.json',JSON.stringify({conditions:'Desktop Chrome, moving 640x480 synthetic camera at30fps; background400x600; 1/4/8 parts, ORIGINAL/NATURAL, recording OFF/9:16 FIT ON(360x640,24fps), six native recordings. 3.5s samples after600ms settling, diagnostic rolling window reset for each condition, output preview closed, sequential single browser. Recording editing locks and camera/finished/photo tab switches verified before settling. Runtime.getHeapUsage measures JS heap, excluding GPU/media/native memory. Actual fps = decoded frames/file duration. Not iPhone results.',rows},null,2)+'\n');
}
