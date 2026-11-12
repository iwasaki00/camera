import assert from 'node:assert/strict';
export async function checkRefinement({evaluate,command,waitFor,drag}) {
  let count=0;const pass=text=>{count++;console.log('PASS REFINEMENT:',text);};
  const click=id=>evaluate(`document.querySelector('#${id}').click()`);
  const values=()=>evaluate("JSON.stringify([...document.querySelectorAll('#part-controls input,#source-controls input,#source-zoom,#photo-guide,#camera-guide')].map(e=>[e.value,e.checked]))");
  const matrix=id=>evaluate(`document.querySelector('#${id==='photo'?'composition':'camera-preview'}').style.transform`);
  const tap=async id=>{
    const p=await evaluate(`(()=>{const e=document.getElementById('${id}');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1,radiusX:8,radiusY:8}]});
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  assert.deepEqual(await evaluate("['photo','camera'].map(id=>[document.querySelector('#'+id+'-loupe').checked,document.querySelector('#'+id+'-magnifier').hidden])"),[[false,true],[false,true]]);
  pass('both magnifiers start stored');
  const initial=await values();
  for(const id of ['photo','camera']){
    await click(`screen-${id}`);
    await evaluate(`(()=>{const e=document.querySelector('#${id}-view-zoom');e.value=200;e.dispatchEvent(new Event('input'));const m=document.querySelector('#interaction-mode');m.value='pan';m.dispatchEvent(new Event('change'));})()`);
    const center=await evaluate(`(()=>{const r=document.querySelector('.${id==='photo'?'stage':'camera-stage'}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await drag(center,{x:center.x+11,y:center.y-8});
    await evaluate("(()=>{const m=document.querySelector('#interaction-mode');m.value='edit';m.dispatchEvent(new Event('change'));})()");
    const manual=await matrix(id);
    await tap(`${id}-view-focus`);
    assert.equal(await evaluate(`document.querySelector('#${id}-view-focus').getAttribute('aria-pressed')`),'true');
    const error=await evaluate(`(async()=>{
      const canvas=document.querySelector('#${id==='photo'?'composition':'camera-preview'}'),r=canvas.getBoundingClientRect(),s=canvas.parentElement.getBoundingClientRect();
      const value=id=>Number(document.getElementById(id).value);let x=value('part-x')/100,y=value('part-y')/100;
      if('${id}'==='camera'){
        const {sourceRect}=await import('./renderer.js'),v=document.querySelector('#camera'),image=document.querySelector('#composition');
        const crop=sourceRect(v.videoWidth,v.videoHeight,image.width*value('part-width')/(image.height*value('part-height')),{x:value('source-x')/100,y:value('source-y')/100,zoom:value('source-zoom')},document.querySelector('#mirror').checked);
        x=(crop.visualX+crop.width/2)/v.videoWidth;y=(crop.y+crop.height/2)/v.videoHeight;
      }
      return Math.hypot(r.x+r.width*x-s.x-s.width/2,r.y+r.height*y-s.y-s.height/2);
    })()`);
    assert.ok(error<1,`${id} focus center error ${error}`);assert.equal(await values(),initial);
    await tap(`${id}-view-focus`);assert.equal(await matrix(id),manual);
    await tap(`${id}-view-focus`);
    await evaluate(`(()=>{const z=document.querySelector('#${id}-view-zoom');z.value=150;z.dispatchEvent(new Event('input'));})()`);
    assert.equal(await evaluate(`document.querySelector('#${id}-view-focus').getAttribute('aria-pressed')`),'false');
    await tap(`${id}-view-reset`);
    assert.equal(await evaluate(`document.querySelector('#${id}-view-value').value`),'100%');
  }
  pass('real touch focus centers photo/camera crops, restores manual pan/zoom, and keeps all model values');
  for(const id of ['photo','camera']){
    await click(`screen-${id}`);await tap(`${id}-loupe`);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier').hidden`),false);
    const p=await evaluate(`(()=>{const w=document.querySelector('#${id}-magnifier'),r=w.getBoundingClientRect(),s=w.parentElement.getBoundingClientRect();return{x:r.x+15,y:r.y+15,dx:r.x>s.x+s.width/2?-20:20,dy:r.y>s.y+s.height/2?-12:12,left:r.x,top:r.y};})()`);
    await drag({x:p.x,y:p.y},{x:p.x+p.dx,y:p.y+p.dy});
    assert.ok(await evaluate(`Math.abs(document.querySelector('#${id}-magnifier').getBoundingClientRect().x-${p.left+p.dx})<1`));
    await evaluate(`(()=>{const e=document.querySelector('#${id}-magnifier select');e.value='5';e.dispatchEvent(new Event('change'));})()`);
    await click('screen-finished');await click(`screen-${id}`);
    assert.equal(await evaluate(`document.querySelector('#${id}-magnifier select').value`),'5');
    for(const [width,height] of [[844,390],[375,568],[390,844]]){
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      assert.equal(await evaluate(`(()=>{const e=document.querySelector('#${id}-magnifier'),r=e.getBoundingClientRect(),s=e.parentElement.getBoundingClientRect();return r.x>=s.x-.5&&r.y>=s.y-.5&&r.right<=s.right+.5&&r.bottom<=s.bottom+.5;})()`),true,`${id} magnifier ${width}x${height}`);
      assert.equal(await evaluate(`(()=>{const e=document.querySelector('#${id}-magnifier'),r=e.getBoundingClientRect(),s=e.parentElement.getBoundingClientRect();return Math.min(innerHeight,s.bottom)-Math.max(0,s.top)<r.height||r.y>=-.5&&r.bottom<=innerHeight+.5;})()`),true,`${id} magnifier remains in visible viewport`);
    }
    await tap(`${id}-loupe`);assert.equal(await evaluate(`document.querySelector('#${id}-magnifier').hidden`),true);
    await evaluate(`(()=>{const e=document.querySelector('#${id}-magnifier select');e.value='3';e.dispatchEvent(new Event('change'));})()`);
  }
  pass('magnifiers show/store with touch, drag, retain 5x across tabs, and clamp after orientation changes');
  await click('screen-camera');
  assert.equal(await evaluate("document.querySelector('.tracking-bar').getBoundingClientRect().bottom<=document.querySelector('.camera-stage').getBoundingClientRect().top+.5"),true);
  pass('tracking controls sit above camera pixels');
  const model=await values(),photoHeight=await evaluate("document.querySelector('.stage').getBoundingClientRect().height");
  await click('screen-finished');
  assert.equal(await evaluate("document.querySelector('#composite-mode').parentElement.id"),'finished-mode-host');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.part-bar')).display==='none'&&document.querySelector('#part-delete').getBoundingClientRect().width===0"),true);
  assert.ok(await evaluate("document.querySelector('.stage').getBoundingClientRect().height")>photoHeight);
  await evaluate("(()=>{const e=document.querySelector('#composite-mode');e.value='natural';e.dispatchEvent(new Event('change'));})()");
  assert.equal(await values(),model);
  await click('screen-photo');assert.equal(await evaluate("document.querySelector('#composite-mode').value"),'natural');
  await evaluate("(()=>{const e=document.querySelector('#composite-mode');e.value='original';e.dispatchEvent(new Event('change'));})()");
  assert.equal(await values(),model);
  pass('finished screen enlarges preview, provides the existing mode selector, and hides editing without modifying settings');
  // UI-only preferences must remain absent from the existing schema-3 ZIP.
  await click('templates-open');await waitFor("!document.querySelector('#template-export').disabled");await click('template-export');await waitFor("!document.querySelector('#template-download').hidden");
  assert.equal(await evaluate("(async()=>{const {importTemplate}=await import('./template-zip.js');const d=(await importTemplate(await(await fetch(document.querySelector('#template-download').href)).blob())).doc;return d.schemaVersion===3&&!('magnifier' in d)&&!('screen' in d)&&d.parts.every(p=>!('loupe' in p)&&!('viewport' in p));})()"),true);
  await click('templates-close');await evaluate('window.scrollTo(0,0)');
  pass('schema 3 export contains no magnifier storage or display focus state');
  return count;
}
