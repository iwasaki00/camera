import assert from 'node:assert/strict';
export async function checkWebkitColor(page) {
  assert.equal(await page.evaluate(async()=>{
    const {CompositeRenderer}=await import('./renderer.js?v=0.6.0');
    const {createPart}=await import('./parts.js?v=0.6.0'),{DEFAULT_COMPOSITE}=await import('./composite-color.js?v=0.6.0');
    const source=document.createElement('canvas');source.width=source.videoWidth=320;source.height=source.videoHeight=240;source.readyState=4;
    const s=source.getContext('2d');s.fillStyle='#82645a';s.fillRect(0,0,320,240);
    const bg=document.createElement('canvas');bg.width=400;bg.height=600;bg.getContext('2d').fillStyle='#bd927a';bg.getContext('2d').fillRect(0,0,400,600);
    const parts=['mouth','leftEye','rightEye','nose'].map((t,i)=>({...createPart(t,i),targetRect:{x:i%2?75:25,y:i<2?25:75,width:26,height:16},rotation:i*17}));
    const out=document.createElement('canvas');out.width=400;out.height=600;const c=out.getContext('2d'),renderer=new CompositeRenderer(),values=[];
    for(const mode of ['original','natural','comic','original']){c.clearRect(0,0,400,600);c.drawImage(bg,0,0);renderer.draw(c,source,parts,true,null,{composite:{...DEFAULT_COMPOSITE,mode},background:bg,time:100});values.push(out.toDataURL());}
    return values[0]===values[3]&&values[0]!==values[1]&&values[1]!==values[2];
  }),true);
  console.log('PASS WEBKIT COLOR: four-part Canvas ORIGINAL/NATURAL/COMIC; return to ORIGINAL has identical pixels');
  await page.locator('#composite-mode').selectOption('natural');
  await page.locator('#composite-settings summary').click();await page.locator('#color-temperature').fill('15');await page.locator('#color-temperature').dispatchEvent('input');
  await page.locator('#select-leftEye').click();assert.equal(await page.locator('#color-temperature').inputValue(),'0');await page.locator('#select-mouth').click();assert.equal(await page.locator('#color-temperature').inputValue(),'15');
  console.log('PASS WEBKIT COLOR: native controls and independent selected-part correction');
  await page.locator('#composite-before').focus();await page.keyboard.down('Space');assert.equal(await page.locator('#composite-before').getAttribute('aria-pressed'),'true');await page.keyboard.up('Space');assert.equal(await page.locator('#composite-before').getAttribute('aria-pressed'),'false');
  console.log('PASS WEBKIT COLOR: keyboard hold/release comparison');
  for(const width of [375,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok((await page.locator('#composite-before').boundingBox()).height>=44);}
  console.log('PASS WEBKIT COLOR: 375px/390px expanded correction controls fit');
}
