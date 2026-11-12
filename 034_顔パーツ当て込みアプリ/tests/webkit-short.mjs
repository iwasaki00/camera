import assert from 'node:assert/strict';
export async function checkWebkitShort(page){
  await page.waitForFunction(()=>document.body.dataset.appState==='ready');
  const result=await page.evaluate(async()=>{
    const {drawRecordingOutput,outputOptions}=await import('./recording-output.js?v=0.8.0');
    const {recordingPlan}=await import('./recording.js?v=0.8.0');
    const source=document.createElement('canvas');source.width=800;source.height=400;const s=source.getContext('2d');s.fillStyle='#f00';s.fillRect(0,0,400,400);s.fillStyle='#00f';s.fillRect(400,0,400,400);
    const output=document.createElement('canvas');output.width=360;output.height=640;const c=output.getContext('2d');
    const pixel=(x,y)=>[...c.getImageData(x,y,1,1).data];
    drawRecordingOutput(c,source,360,640,outputOptions({aspect:'vertical'}),1,15);const fit={left:pixel(10,260),right:pixel(350,260),band:pixel(10,10)};
    drawRecordingOutput(c,source,360,640,outputOptions({aspect:'vertical',framing:'fill',centerX:0}),1,15);const left=pixel(10,10);
    drawRecordingOutput(c,source,360,640,outputOptions({aspect:'vertical',framing:'fill',centerX:1}),1,15);const right=pixel(10,10);
    drawRecordingOutput(c,source,360,640,outputOptions({aspect:'vertical',fade:true,title:'日本語の長いタイトル'.repeat(10),titleTime:'all'}),0,15);const black=pixel(10,10);
    return {fit,left,right,black,low:recordingPlan(800,400,'low','vertical'),defaults:document.querySelector('#record-countdown').checked};
  });
  assert.deepEqual(result.fit.left,[255,0,0,255]);assert.deepEqual(result.fit.right,[0,0,255,255]);console.log('PASS WEBKIT SHORT: 9:16 FIT includes both image edges and letterbox');
  assert.deepEqual(result.left,[255,0,0,255]);assert.deepEqual(result.right,[0,0,255,255]);console.log('PASS WEBKIT SHORT: FILL left/right crop uses output-only transformation');
  assert.deepEqual(result.black,[0,0,0,255]);assert.equal(result.low.width,270);assert.equal(result.low.height,480);assert.equal(result.defaults,true);console.log('PASS WEBKIT SHORT: fade/title Canvas path, even low resolution and countdown default');
  for(const width of [375,390]){await page.setViewportSize({width,height:844});await page.locator('#settings-toggle').click();await page.evaluate(()=>document.querySelector('#settings-recording').open=true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>document.querySelector('#settings-panel').open=false);}
  console.log('PASS WEBKIT SHORT: collapsed recording settings at 375px / 390px without overflow; native recording unavailable in this Windows WebKit');
}
