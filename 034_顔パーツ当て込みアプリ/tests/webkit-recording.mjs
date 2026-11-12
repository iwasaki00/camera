import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function checkWebkitRecording(page) {
  const supported=await page.evaluate(()=>({recorder:typeof MediaRecorder,capture:typeof HTMLCanvasElement.prototype.captureStream,types:['video/mp4','video/webm'].filter(t=>globalThis.MediaRecorder?.isTypeSupported(t))}));
  console.log('WEBKIT RECORDING SUPPORT',JSON.stringify(supported));
  if(!supported.types.length||supported.capture!=='function'){assert.equal(await page.locator('#record-start').isDisabled(),true);assert.match(await page.locator('#record-status').textContent(),/対応していません/);for(const width of [375,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}console.log('PASS WEBKIT: unsupported recording is explained; 375px/390px layouts fit (real recording unavailable)');return;}
  await page.evaluate(async()=>{
    const bg=document.createElement('canvas');bg.width=320;bg.height=480;bg.getContext('2d').fillRect(0,0,320,480);const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>bg.toBlob(r))],'portrait.png',{type:'image/png'}));const e=document.querySelector('#image-file');e.files=dt.files;e.dispatchEvent(new Event('change'));
    window.feed=document.createElement('canvas');feed.width=640;feed.height=480;let n=0;window.feedTimer=setInterval(()=>{const c=feed.getContext('2d');c.fillStyle=`hsl(${n++*4%360} 70% 50%)`;c.fillRect(0,0,640,480)},33);navigator.mediaDevices.getUserMedia=async()=>feed.captureStream(30);
  });
  await page.waitForFunction(()=>!document.querySelector('#save').disabled);await page.locator('#start').click();
  await page.locator('#record-start').click();await page.waitForFunction(()=>document.querySelector('#record-status').dataset.state==='recording');await page.waitForTimeout(2400);await page.locator('#record-stop').click();await page.waitForFunction(()=>document.querySelector('#record-result').open);
  const result=await page.evaluate(async()=>{const a=document.querySelector('#record-download');return{filename:a.download,bytes:[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]}});
  const file='reports/v0.6.2-webkit-original.'+result.filename.split('.').at(-1);await writeFile(file,new Uint8Array(result.bytes));const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(Number(probe.format.duration)>1);
  await page.locator('#record-play').click();await page.waitForFunction(()=>document.querySelector('#record-player').currentTime>.2);await page.locator('#record-pause').click();
  for(const width of [375,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.locator('#record-close').click();await page.locator('#stop').click();await page.evaluate(()=>clearInterval(feedTimer));console.log('PASS WEBKIT REAL RECORDING: native Canvas stream, native MediaRecorder, valid video file and browser playback, mobile widths',file);
}
