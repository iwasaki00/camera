import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function checkShortVideo({evaluate,command,waitFor}) {
  let count=0;const rows=[],label=(process.env.CHROME_PATH||'').includes('Edge')?'edge':'chrome';
  const pass=s=>{count++;console.log('PASS SHORT: '+s);};
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const userClick=async id=>{const p=await evaluate(`(()=>{const e=document.getElementById('${id}');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await command('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  const set=(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});${typeof value==='boolean'?`e.checked=${value}`:`e.value=${JSON.stringify(value)}`};e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));})()`);
  await evaluate(`(async()=>{
    const c=document.createElement('canvas');c.width=800;c.height=400;const ctx=c.getContext('2d');
    ctx.fillStyle='#e04030';ctx.fillRect(0,0,400,400);ctx.fillStyle='#3050e0';ctx.fillRect(400,0,400,400);
    const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'landscape.png',{type:'image/png'}));const input=document.querySelector('#image-file');input.files=dt.files;input.dispatchEvent(new Event('change'));
    window.feed=document.createElement('canvas');feed.width=640;feed.height=480;let n=0;window.feedTimer=setInterval(()=>{const x=feed.getContext('2d');x.fillStyle='hsl('+(n++*7%360)+' 90% 50%)';x.fillRect(0,0,640,480)},33);
    window.microphoneCalls=0;const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=options=>{if(options.video)return Promise.resolve(feed.captureStream(30));microphoneCalls++;return gum(options);};
    window.shortStates=[];new MutationObserver(()=>shortStates.push({state:document.querySelector('#record-status').dataset.state,number:document.querySelector('#record-countdown-number').value,mic:microphoneCalls,at:performance.now()})).observe(document.querySelector('#record-status'),{attributes:true,attributeFilter:['data-state']});
    window.shortNumbers=[];new MutationObserver(()=>shortNumbers.push(document.querySelector('#record-countdown-number').value)).observe(document.querySelector('#record-countdown-number'),{childList:true,subtree:true});
  })()`);
  await waitFor("!document.querySelector('#save').disabled");await click('start');await waitFor("!document.querySelector('#record-start').disabled");
  assert.equal(await evaluate("document.querySelector('#record-countdown').checked"),true);
  await set('record-mic',true);await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='countdown'");
  assert.equal(await evaluate("microphoneCalls===1&&document.querySelector('#record-elapsed').value==='0.0秒'"),true);
  assert.equal(await evaluate("!document.querySelector('#record-countdown-overlay').hidden"),true);
  await click('record-start');await click('record-countdown-cancel');await waitFor("document.querySelector('#record-status').dataset.state==='idle'");
  assert.equal(await evaluate("document.querySelector('#camera').srcObject.getVideoTracks()[0].readyState==='live'"),true);pass('microphone before countdown, cancellation and duplicate-start protection');
  await set('record-mic',false);await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='countdown'");await click('stop');await waitFor("document.querySelector('#record-status').dataset.state==='idle'");pass('camera stop during countdown safely cancels');
  await click('start');await waitFor("!document.querySelector('#record-start').disabled");
  await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='countdown'");
  await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden");
  await waitFor("document.querySelector('#record-status').dataset.state==='idle'");assert.equal(await evaluate("document.querySelector('#record-countdown-overlay').hidden"),true);pass('background notification cancels countdown and releases its resources');
  await click('start');await waitFor("!document.querySelector('#record-start').disabled");
  const extract=async(name,expectedWidth,expectedHeight,audio)=>{
    await waitFor("document.querySelector('#record-result').open",220);await waitFor("document.querySelector('#record-player').readyState>=2");
    const data=await evaluate("(async()=>{const a=document.querySelector('#record-download');return {extension:a.download.split('.').at(-1),bytes:[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]};})()");
    const file=`reports/v0.8.0-${label}-short-${name}.${data.extension}`;await writeFile(file,new Uint8Array(data.bytes));
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
    const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,expectedWidth);assert.equal(video.height,expectedHeight);assert.equal(probe.streams.some(s=>s.codec_type==='audio'),audio);assert.ok(data.bytes.length>1000);
    const duration=Number(probe.format.duration),frames=Number(video.nb_read_frames);assert.ok(frames>5);assert.equal(probe.format.format_name.includes('mp4'),data.extension==='mp4');
    const hashes=execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(s=>s&&!s.startsWith('#')),uniqueFrames=new Set(hashes.map(s=>s.split(',').at(-1))).size;
    if(!name.startsWith('fill-'))assert.ok(uniqueFrames>3); // Extreme FILL deliberately crops out the central live mouth.
    rows.push({name,file,width:video.width,height:video.height,duration,frames,actualFps:frames/duration,bytes:data.bytes.length,audio,uniqueFrames});
    await userClick('record-play');await waitFor("document.querySelector('#record-player').currentTime>.15");await click('record-pause');
    await click('record-acknowledge');await click('record-close');
    return {file,duration,frame:time=>execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:8*1024*1024})};
  };
  const pixel=(frame,w,x,y)=>[...frame.subarray((y*w+x)*3,(y*w+x)*3+3)];
  await set('record-duration','15');await set('record-aspect','vertical');await set('record-title','日本語のショート動画 — 長いタイトルも安全領域に表示');await set('record-title-time','end');await set('record-fade',true);
  await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='countdown'");
  await click('screen-camera');await click('screen-finished');assert.equal(await evaluate("document.querySelector('#record-status').dataset.state"),'countdown');
  await new Promise(r=>setTimeout(r,2200));assert.equal(await evaluate("document.querySelector('#record-elapsed').value"),'0.0秒');
  await waitFor("document.querySelector('#record-status').dataset.state==='recording'");
  const numbers=await evaluate('shortNumbers');assert.ok(numbers.includes('2')&&numbers.includes('1'),JSON.stringify(numbers));pass('real 3 / 2 / 1 countdown ends before recorder elapsed starts');
  await click('screen-camera');await click('screen-finished');assert.equal(await evaluate("document.querySelector('#record-aspect').disabled"),true);
  const fit=await extract('fit-fade-title-end',360,640,false);assert.ok(fit.duration>=14.6&&fit.duration<16);
  const mid=fit.frame(3),first=fit.frame(.05),late=fit.frame(14.9),endTitle=fit.frame(13.5);
  assert.ok(pixel(mid,360,20,20)[0]>10);assert.ok(pixel(first,360,20,20)[0]<pixel(mid,360,20,20)[0]);assert.ok(pixel(late,360,20,20)[0]<pixel(mid,360,20,20)[0]);
  assert.ok(pixel(mid,360,10,260)[0]>180&&pixel(mid,360,350,260)[2]>180); // Entire red/blue landscape, no distortion.
  const white=frame=>{let n=0;for(let i=420*360*3;i<600*360*3;i+=3)if(frame[i]>200&&frame[i+1]>200&&frame[i+2]>200)n++;return n;};
  assert.ok(white(endTitle)>white(mid)+100);pass('actual 15s 360×640 FIT file, moving video, letterbox, end title and both fades; tabs do not interrupt');
  await set('record-countdown',false);await set('record-fade',false);await set('record-title-time','none');await set('record-framing','fill');
  for(const [name,center]of [['fill-left',0],['fill-right',100]]){
    await set('record-center-x',String(center));await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='recording'");await new Promise(r=>setTimeout(r,2100));await click('record-stop');
    const result=await extract(name,360,640,false),p=pixel(result.frame(.6),360,20,30);assert.ok(center===0?p[0]>180&&p[2]<100:p[2]>180&&p[0]<100,p.join(','));pass('decoded '+name+' crop fills vertical video with correct edge');
  }
  await set('record-framing','fit');await set('record-title-time','all');await set('record-title',('<script>日本語タイトルは文字です</script>'+'長い日本語タイトル'.repeat(20)).slice(0,160));await set('record-quality','low');await set('record-mic',true);await set('composite-mode','natural');
  await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='recording'");await new Promise(r=>setTimeout(r,2200));await click('record-stop');const audio=await extract('natural-title-audio-low',270,480,true);assert.ok(audio.duration>2);pass('270×480 low-load NATURAL title/audio file plays; native encoded audio track verified');
  await set('record-quality','normal');await set('record-mic',false);await set('record-title-time','start');await set('record-fade',true);await set('composite-mode','original');
  await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='recording'");await new Promise(r=>setTimeout(r,3200));await click('record-stop');
  const intro=await extract('title-start-manual-stop',360,640,false),beforeTitle=intro.frame(.8),afterTitle=intro.frame(2.5),manualEnd=intro.frame(intro.duration-.15);
  assert.ok(white(beforeTitle)>white(afterTitle)+100);assert.ok(pixel(manualEnd,360,20,20)[0]>10);pass('first-two-second title disappears on time; manual stop adds no artificial fade-out');
  await set('record-aspect','original');await set('record-title-time','none');await set('record-mic',false);await set('record-quality','normal');await set('composite-mode','comic');
  await click('record-start');await waitFor("document.querySelector('#record-status').dataset.state==='recording'");await new Promise(r=>setTimeout(r,1600));await click('record-stop');await extract('comic-original',720,360,false);pass('original aspect and COMIC native recording compatibility');
  // Pixel-exact preview comparison at a controlled timestamp; no extra model/compositor calls.
  const preview=await evaluate(`(async()=>{const {drawRecordingOutput,outputOptions}=await import('./recording-output.js?v=0.8.0');
    document.querySelector('#settings-panel').open=true;document.querySelector('#settings-recording').open=true;
    const source=document.querySelector('#composition'),canvas=document.createElement('canvas');canvas.width=720;canvas.height=360;
    document.querySelector('#record-title').dispatchEvent(new Event('input'));
    drawRecordingOutput(canvas.getContext('2d'),source,720,360,outputOptions(),1,15);
    const target=document.querySelector('#record-output-preview');return{a:canvas.toDataURL(),b:target.toDataURL()};})()`);
  // Allow a paint after opening; live camera means pixel comparison must be synchronous.
  assert.equal(preview.a,preview.b);pass('pixel-exact output preview and shared recording renderer at identical timestamp');
  await set('record-aspect','vertical');await set('record-title-time','all');await set('record-title','ショート動画の出力プレビュー');
  await evaluate("document.querySelector('#record-output-preview').scrollIntoView({block:'nearest'})");
  const previewShot=await command('Page.captureScreenshot',{format:'png'});await writeFile(`reports/v0.8.0-${label}-output-settings.png`,Buffer.from(previewShot.data,'base64'));
  await set('record-title','');await set('record-title-time','none');
  await click('screen-photo');
  for(const width of [375,390]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,150));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    const size=await evaluate("(()=>{document.querySelector('#settings-panel').open=false;return {height:document.documentElement.scrollHeight,button:document.querySelector('#record-start').getBoundingClientRect().height}})()");assert.ok(size.button>=44);assert.ok(size.height<=890);rows.push({layoutWidth:width,...size});
    const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(`reports/v0.8.0-${label}-short-ui-${width}.png`,Buffer.from(screenshot.data,'base64'));
  }pass('375px / 390px no horizontal overflow, 44px recording taps, compact main scroll retained');
  await evaluate('clearInterval(feedTimer)');await click('stop');
  await writeFile(`reports/v0.8.0-${label}-short-video.json`,JSON.stringify({groups:count,browser:await evaluate('navigator.userAgent'),rows},null,2)+'\n');
}
