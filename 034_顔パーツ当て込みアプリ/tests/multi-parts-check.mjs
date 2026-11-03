import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function checkMultiParts({ evaluate, command, touchDrag, waitFor }) {
  const types = ['mouth','leftEye','rightEye','nose'];
  const choose = type => evaluate(`document.querySelector('#select-${type}').click()`);
  const write = values => evaluate(`(() => {
    for(const [id,value]of Object.entries(${JSON.stringify(values)})) {
      const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event(el.type==='range'?'input':'change'));
    }
  })()`);
  const read = () => evaluate(`(() => {
    const values=Object.fromEntries(Array.from(document.querySelectorAll('#part-controls input,#source-controls input,#source-zoom')).map(el=>[el.id,Number(el.value)]));
    if(document.querySelector('#mirror').checked)values['source-x']=100-values['source-x'];
    return {...values,shape:document.querySelector('#shape').value,enabled:document.querySelector('#part-enabled').checked,order:document.querySelector('#part-order-value').value,
      photoGuide:document.querySelector('#photo-guide').checked,cameraGuide:document.querySelector('#camera-guide').checked};
  })()`);
  const all = async () => { const result={}; for(const type of types) { await choose(type); result[type]=await read(); } return result; };
  const pixel = (x,y) => evaluate(`Array.from(document.querySelector('#composition').getContext('2d').getImageData(${x},${y},1,1).data)`);
  const nearColor = (actual, expected) => assert.ok(expected.every((v,i)=>Math.abs(actual[i]-v)<=8),`${actual} != ${expected}`);
  const centers = [[100,150],[300,150],[100,450],[300,450]];
  const colors = [[240,0,0,255],[0,208,0,255],[0,0,224,255],[224,192,0,255]];
  const config = index => ({'part-x': index%2?75:25,'part-y':index<2?25:75,'part-width':20,'part-height':12,
    'part-rotation':0,'part-feather':0,shape:'rectangle','source-x':12.5+index*25,'source-y':50,'source-zoom':6});
  const png = async () => { await evaluate("document.querySelector('#save').click()"); await waitFor("!document.querySelector('#save').disabled");
    return evaluate("(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL();})()"); };
  assert.equal(await evaluate("document.querySelectorAll('.part-tabs [data-exists=true]').length"),1);
  await evaluate(`(async()=>{
    const video=document.querySelector('#camera');window.multiOriginalStream=video.srcObject;
    const c=document.createElement('canvas');c.width=800;c.height=600;const ctx=c.getContext('2d');
    ['#f00000','#00d000','#0000e0','#e0c000'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*200,0,200,600);});
    window.multiPattern=c;window.multiTestStream=c.captureStream(8);video.srcObject=window.multiTestStream;
    await video.play();await new Promise(r=>setTimeout(r,180));video.pause();
    for(const id of ['photo','camera']){const el=document.querySelector('#'+id+'-loupe');el.checked=false;el.dispatchEvent(new Event('change'));document.querySelector('#'+id+'-view-reset').click();}
    const mirror=document.querySelector('#mirror');mirror.checked=false;mirror.dispatchEvent(new Event('change'));
  })()`);
  try {
    for(let i=0;i<types.length;i++){await choose(types[i]);await write(config(i));}
    assert.equal(await evaluate("document.querySelectorAll('.part-tabs [data-exists=true]').length"),4);
    const settings=await all(); await choose('leftEye'); await choose('leftEye');
    assert.deepEqual(await all(),settings);
    assert.equal(await evaluate("document.querySelectorAll('.part-tabs [data-exists=true]').length"),4);
    for(let i=0;i<4;i++)nearColor(await pixel(...centers[i]),colors[i]);
    nearColor(await pixel(0,0),[160,64,48,255]);
    await evaluate(`(async()=>{
      const v=document.querySelector('#camera');await v.play();const ctx=window.multiPattern.getContext('2d');
      ['#00e0e0','#e000e0','#e0e000','#4040e0'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*200,0,200,600);});
    })()`);
    await waitFor(`(() => {const ctx=document.querySelector('#composition').getContext('2d');
      return [[100,150],[300,150],[100,450],[300,450]].every(([x,y],i)=>{
        const actual=ctx.getImageData(x,y,1,1).data,expected=[[0,224,224],[224,0,224],[224,224,0],[64,64,224]][i];
        return expected.every((v,k)=>Math.abs(actual[k]-v)<=8);
      });})()`);
    await evaluate(`(()=>{const ctx=window.multiPattern.getContext('2d');['#f00000','#00d000','#0000e0','#e0c000'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*200,0,200,600);});})()`);
    await waitFor(`(() => {const ctx=document.querySelector('#composition').getContext('2d');
      return [[100,150],[300,150],[100,450],[300,450]].every(([x,y],i)=>{
        const actual=ctx.getImageData(x,y,1,1).data,expected=${JSON.stringify(colors)}[i];
        return expected.every((v,k)=>Math.abs(actual[k]-v)<=8);
      });})()`);
    await evaluate("document.querySelector('#camera').pause()");
    if(process.env.MULTI_SCREENSHOT_PATH) {
      await evaluate('window.scrollTo(0,0)');
      const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      await writeFile(process.env.MULTI_SCREENSHOT_PATH,Buffer.from(data,'base64'));
    }
    console.log('PASS MULTI: four distinct source crops, unique additions, simultaneous composite, and selection persistence');

    await choose('leftEye');await write({'part-x':65,'part-rotation':35,'part-feather':60,'source-x':45,'source-y':40,shape:'oval'});
    const changed=await all(); for(const type of ['mouth','rightEye','nose'])assert.deepEqual(changed[type],settings[type]);
    for(const i of [0,2,3])nearColor(await pixel(...centers[i]),colors[i]);
    await choose('leftEye');await write(config(1));
    await choose('mouth'); const beforeDisabled=await read();
    await evaluate("document.querySelector('#part-enabled').click()");nearColor(await pixel(...centers[0]),[160,64,48,255]);
    for(const i of [1,2,3])nearColor(await pixel(...centers[i]),colors[i]);
    await evaluate("document.querySelector('#part-enabled').click()");assert.deepEqual(await read(),beforeDisabled);
    await choose('rightEye');await evaluate("document.querySelector('#part-delete').click()");
    assert.equal(await evaluate("document.querySelector('#select-rightEye').dataset.exists"),'false');
    await choose('rightEye');assert.equal((await read())['part-x'],50);
    assert.equal((await read())['part-y'],50);await write(config(2));
    console.log('PASS MULTI: independent target/source/rotation/feather, enable toggle, delete and fresh re-add');

    await choose('leftEye');await evaluate("document.querySelector('#photo-guide').click()");
    await choose('mouth');assert.equal((await read()).photoGuide,true);
    await choose('leftEye');assert.equal((await read()).photoGuide,false);assert.equal((await read()).cameraGuide,true);
    await evaluate("document.querySelector('#composition').scrollIntoView({block:'center',behavior:'instant'})");
    const hiddenBefore=await read(),hiddenBox=await evaluate('window.photoBox()');
    await touchDrag(hiddenBox,{x:hiddenBox.x+10,y:hiddenBox.y+4});assert.deepEqual(await read(),hiddenBefore);
    nearColor(await pixel(...centers[1]),colors[1]);
    await evaluate("document.querySelector('#photo-guide').click()");
    console.log('PASS MULTI: per-part guide visibility persists separately from compositing and camera guides');

    await evaluate("document.querySelector('#mirror').click()");
    for(let i=0;i<4;i++)nearColor(await pixel(...centers[i]),colors[i]);
    await evaluate("document.querySelector('#mirror').click()");
    for(const type of types) {
      await choose(type);for(const id of ['photo','camera'])await evaluate(`(() => {const el=document.querySelector('#${id}-loupe');el.checked=true;el.dispatchEvent(new Event('change'));})()`);
      const i=types.indexOf(type);
      for(const id of ['photo','camera']) {
        nearColor(await evaluate(`Array.from(document.querySelector('#${id}-magnifier canvas').getContext('2d').getImageData(144,100,1,1).data)`),colors[i]);
        assert.equal(await evaluate(`document.querySelector('#${id}-magnifier .magnifier-heading span').textContent`),['口','左目','右目','鼻'][i]);
      }
    }
    console.log('PASS MULTI: anatomical eye identity under mirror and both magnifiers follow the selected part');
    await evaluate("for(const id of ['photo','camera']){const el=document.querySelector('#'+id+'-loupe');el.checked=false;el.dispatchEvent(new Event('change'));}");

    for(const type of types){await choose(type);await write({'part-x':50,'part-y':50});}
    // Re-adding the right eye put it in front of the others.
    const beforeOrder=await all();
    const topType=types.find(type=>beforeOrder[type].order.startsWith('4 /'));
    nearColor(await pixel(200,300),colors[types.indexOf(topType)]);
    await choose('mouth');for(let i=0;i<3;i++)await evaluate("document.querySelector('#part-front').click()");
    nearColor(await pixel(200,300),colors[0]);
    for(let i=0;i<3;i++)await evaluate("document.querySelector('#part-back').click()");
    nearColor(await pixel(200,300),colors[types.indexOf(topType)]);
    const beforeMove=await all();await choose('mouth');
    await evaluate("document.querySelector('#composition').scrollIntoView({block:'center',behavior:'instant'})");
    const box=await evaluate('window.photoBox()');await touchDrag(box,{x:box.x+6,y:box.y-3});
    const afterMove=await all();for(const type of ['leftEye','rightEye','nose'])assert.deepEqual(afterMove[type],beforeMove[type]);
    await choose('mouth');await write({'part-x':50,'part-y':50});
    nearColor(await pixel(200,300),colors[types.indexOf(topType)]);
    for(let i=0;i<4;i++){await choose(types[i]);await write(config(i));}
    console.log('PASS MULTI: front/back order is visible in pixels; overlapping non-selected parts cannot be edited');

    const beforePNG=await png(),beforeZoom=await all();
    assert.equal(beforePNG,await evaluate("document.querySelector('#composition').toDataURL()"));
    await write({'photo-view-zoom':200,'camera-view-zoom':400,'interaction-mode':'pan'});
    await evaluate("document.querySelector('#composition').scrollIntoView({block:'center',behavior:'instant'})");
    const stage=await evaluate("(()=>{const r=document.querySelector('.stage').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()");
    await touchDrag(stage,{x:stage.x+15,y:stage.y-12});
    assert.deepEqual(await all(),beforeZoom);assert.equal(await png(),beforePNG);
    await evaluate("document.querySelector('#photo-view-reset').click();document.querySelector('#camera-view-reset').click()");
    await write({'interaction-mode':'edit'});
    // A non-mouth part remains editable in the zoomed coordinate system.
    await choose('leftEye');await write({'photo-view-zoom':200});
    await evaluate("document.querySelector('#composition').scrollIntoView({block:'center',behavior:'instant'})");
    // Center the selected eye for a visible hit target at 200%.
    await write({'part-x':50,'part-y':50}); const zoomBox=await evaluate('window.photoBox()');
    await touchDrag(zoomBox,{x:zoomBox.x+8,y:zoomBox.y+4});
    assert.ok(Math.abs((await read())['part-x']-50-8/zoomBox.surfaceWidth*100)<.2);
    await write(config(1));await evaluate("document.querySelector('#photo-view-reset').click()");
    for(let i=0;i<4;i++)nearColor(await pixel(...centers[i]),colors[i]);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    console.log('PASS MULTI: zoomed eye edit, independent multi-part coordinates, all-parts PNG and guide/view exclusion');

    // Removing every part must not leave editors or magnifiers pointing at deleted data.
    await evaluate("for(let i=0;i<4;i++)document.querySelector('#part-delete').click()");
    assert.equal(await evaluate("document.querySelectorAll('.part-tabs [data-exists=true]').length"),0);
    assert.equal(await evaluate("document.querySelector('#part-x').disabled"),true);
    await png();for(let i=0;i<4;i++){await choose(types[i]);await write(config(i));}
    console.log('PASS MULTI: deleting all parts is safe; the four parts can be recreated');
  } finally {
    await evaluate(`(async()=>{const v=document.querySelector('#camera');v.srcObject=window.multiOriginalStream;window.multiTestStream.getTracks().forEach(t=>t.stop());await v.play();await new Promise(r=>setTimeout(r,100));v.pause();})()`);
  }
  const beforeRestart=await all();
  await evaluate("document.querySelector('#stop').click();document.querySelector('#start').click()");
  await waitFor("document.querySelector('#camera-state').textContent==='使用中'&&document.querySelector('#camera').readyState>=2");
  assert.deepEqual(await all(),beforeRestart);
  await evaluate("document.querySelector('#camera').pause()");
  console.log('PASS MULTI: all four configurations survive camera stop and restart');
}
