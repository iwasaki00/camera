import {createServer} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{
 try{const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+ '/'.replace('/',process.platform==='win32'?'\\':'/')))throw Error();const data=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'motion-quiz-check-'));
const browser=spawn(process.env.BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('browser startup timeout')),15000);browser.stderr.on('data',b=>{out+=b;const match=out.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.on('error',reject);});
 const devtools=new URL(endpoint);const target=await fetch(`http://${devtools.host}/json/new?${origin}`,{method:'PUT'}).then(r=>r.json());
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 await send('Page.enable');
 await send('Page.navigate',{url:origin});
 for(let i=0;i<50;i++){if(await evaluate('document.readyState==="complete"&&!!document.querySelector("#recordButton")'))break;await new Promise(r=>setTimeout(r,100));}
 const results=[];
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[844,390],[1280,800]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});
  await evaluate('document.fonts.ready');
  const layout=await evaluate(`(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,record:rect('#recordButton'),start:rect('#startCameraButton'),stop:rect('#stopButton'),stage:rect('#stage'),panel:rect('.control-panel')};})()`);
  assert.ok(layout.stage.width>=width-40||width>=680,`${width}: preview shrunk`);
  assert.equal(layout.overflow,false,`${width} horizontal overflow`);
  for(const key of ['start','record','stop'])assert.ok(layout[key].x>=0&&layout[key].right<=width,`${width}: ${key} horizontal position`);
  if(width<500){assert.ok(layout.record.bottom<=height,`${width}: record below viewport ${JSON.stringify(layout)}`);assert.ok(layout.stop.bottom<=height);assert.ok(layout.start.bottom<=layout.stage.bottom);}
  if(width===844)assert.ok(layout.record.bottom<=height,"landscape controls below viewport");
  results.push({width,height,recordBottom:layout.record.bottom,overflow:layout.overflow});
  if(width===320||width===844){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(profile,`layout-${width}.png`),Buffer.from(shot.data,'base64'));}
 }
 console.log('Layout:',JSON.stringify(results));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const integration=await evaluate(`(async()=>{
  const {MotionQuizApp}=await import('./src/app.js');const a=new MotionQuizApp();window.checkApp=a;
  a.setState('countdown');const c=document.querySelector('#cancelCountdownButton').getBoundingClientRect();const s=document.querySelector('#stage').getBoundingClientRect();const cancelVisible=c.bottom<=s.bottom&&c.top>=s.top;a.cancelCountdown();
  const {DualRecorder}=await import('./src/recorder.js');const camera=document.createElement('canvas'),skeleton=document.createElement('canvas');camera.width=skeleton.width=320;camera.height=skeleton.height=240;const stream=camera.captureStream(20),recorder=new DualRecorder();recorder.start(stream,skeleton,20);const tracks=recorder.skeletonStream.getTracks();let n=0;const draw=setInterval(()=>{for(const canvas of [camera,skeleton]){const ctx=canvas.getContext('2d');ctx.fillStyle=n++%2?'#53f0b2':'#081714';ctx.fillRect(0,0,320,240);}},40);await new Promise(r=>setTimeout(r,650));const blobs=await recorder.stop();clearInterval(draw);const released=tracks.every(t=>t.readyState==='ended');const retained=stream.getTracks().every(t=>t.readyState==='live');stream.getTracks().forEach(t=>t.stop());
  const work={id:'browser-fixture',title:'Test quiz',answer:'Test answer',hint:'Test hint',createdAt:Date.now(),...blobs,motionData:[{time:0,landmarks:[]},{time:1,landmarks:[]}],durationSec:1,difficulty:'normal',width:320,height:240,cameraFacing:'environment',thumbnailBlob:null};delete work.errors;
  await a.store.put(work);await a.refreshLibrary();await a.openDetail(work.id);a.revealAnswer();const answer=document.querySelector('#answerBox').classList.contains('is-visible');a.setPlaybackSpeed(.5);a.setLoop(false);a.setDetailMode('original');const video=document.querySelector('#detailVideo');const originalURL=video.src;await video.play();const played=!video.paused;const speed=video.playbackRate,loop=video.loop;a.closeDetail();const stopped=video.paused&&!video.getAttribute('src');
  a.pending=work;a.state='review';a.openReview();document.querySelector('#titleInput').value='Retained title';document.querySelector('#answerInput').value='Retained answer';a.store.put=async()=>{throw new DOMException('quota','QuotaExceededError');};await a.savePending();const failedSaveRetained=a.pending===work&&document.querySelector('#titleInput').value==='Retained title';const card=document.querySelectorAll('.work-card').length;const scrollable=document.querySelector('#reviewForm').scrollHeight>document.querySelector('#reviewForm').clientHeight;a.closeReview();await a.store.delete(work.id);
  return {cancelVisible,originalBytes:blobs.originalBlob?.size,skeletonBytes:blobs.skeletonBlob?.size,errors:blobs.errors,released,retained,answer,played,speed,loop,stopped,failedSaveRetained,card,scrollable};
 })()`);
 assert.ok(integration.cancelVisible);assert.ok(integration.originalBytes>0);assert.ok(integration.skeletonBytes>0);assert.deepEqual(integration.errors,[]);for(const key of ['released','retained','answer','played','stopped','failedSaveRetained'])assert.equal(integration[key],true,key);assert.equal(integration.speed,.5);assert.equal(integration.loop,false);assert.equal(integration.card,1);
 console.log('Browser integration:',JSON.stringify(integration));console.log('Screenshots:',profile);
}finally{ws?.close();browser.kill();server.close();}
