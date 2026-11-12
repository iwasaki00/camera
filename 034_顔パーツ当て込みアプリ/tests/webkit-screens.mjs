import assert from 'node:assert/strict';
export async function checkWebkitScreens(page) {
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').fillRect(0,0,400,600);return c.toDataURL().split(',')[1];});
  const chooser=page.waitForEvent('filechooser');await page.locator('#image-trigger').tap();
  await (await chooser).setFiles({name:'screen.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='image-ready');
  console.log('PASS WEBKIT SCREEN: native image chooser and rendering in reorganized screen');
  assert.equal(await page.evaluate(()=>['photo','camera'].every(id=>!document.querySelector('#'+id+'-loupe').checked)),true);
  await page.locator('#photo-loupe').tap();assert.equal(await page.locator('#photo-magnifier').isVisible(),true);
  await page.locator('#photo-loupe').tap();assert.equal(await page.locator('#photo-magnifier').isVisible(),false);
  console.log('PASS WEBKIT REFINEMENT: initial magnifier storage and real touch show/store');
  await page.locator('#photo-view-focus').tap();
  assert.equal(await page.locator('#photo-view-focus').getAttribute('aria-pressed'),'true');
  await page.locator('#photo-view-focus').tap();
  assert.equal(await page.locator('#photo-view-value').textContent(),'100%');
  console.log('PASS WEBKIT REFINEMENT: touch focus and return to the previous whole-image view');
  await page.evaluate(()=>{window.originalCanvas=document.querySelector('#composition');});
  for(const width of [375,390]){
    await page.setViewportSize({width,height:844});
    for(const id of ['camera','finished','photo']){
      await page.locator('#screen-'+id).tap();
      assert.equal(await page.locator('#screen-'+id).getAttribute('aria-selected'),'true');
      assert.equal(await page.evaluate(()=>document.querySelector('#composition')===originalCanvas&&document.documentElement.scrollWidth<=innerWidth),true);
      if(id==='finished')assert.equal(await page.evaluate(()=>document.querySelector('#composite-mode').parentElement.id==='finished-mode-host'&&getComputedStyle(document.querySelector('.part-bar')).display==='none'),true);
    }
  }
  console.log('PASS WEBKIT SCREEN: three tabs retain canvas and fit 375/390px');
  await page.locator('#photo-view-zoom').fill('200');await page.locator('#photo-view-zoom').dispatchEvent('input');
  await page.locator('#screen-camera').tap();await page.locator('#screen-photo').tap();
  const before=await page.evaluate(()=>Number(document.querySelector('#part-x').value));
  const rect=await page.locator('#composition').boundingBox();
  const y=await page.evaluate(()=>Number(document.querySelector('#part-y').value));
  const p={x:rect.x+rect.width*before/100,y:rect.y+rect.height*y/100};
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+8,p.y+4,{steps:4});await page.mouse.up();
  const after=await page.evaluate(()=>Number(document.querySelector('#part-x').value));
  assert.ok(Math.abs(after-before-800/rect.width)<.2);
  await page.locator('#screen-finished').tap();
  assert.equal(await page.evaluate(()=>{const e=document.querySelector('[data-editor=composition]');return e.getContext('2d').getImageData(0,0,e.width,e.height).data.every(v=>v===0)&&document.querySelector('#photo-guide').checked;}),true);
  console.log('PASS WEBKIT SCREEN: 200% editing after tab restore; finished guide exclusion preserves guide preference');
  await page.locator('#settings-toggle').tap();await page.locator('#settings-quality > summary').tap();
  await page.locator('#composite-mode').selectOption('natural');
  assert.match(await page.locator('#screen-state').textContent(),/NATURAL/);
  await page.locator('#settings-toggle').tap();assert.equal(await page.evaluate(()=>document.querySelector('#settings-panel').open),false);
  await page.setViewportSize({width:844,height:390});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS WEBKIT SCREEN: bounded settings, live mode status and landscape layout');
}
