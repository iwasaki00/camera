import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function checkComposite({evaluate,command,waitFor}) {
  const click=id=>{const index={mouth:0,leftEye:1,rightEye:2,nose:3}[id.replace('select-','')];return index===undefined?evaluate(`document.getElementById('${id}').click()`):evaluate(`(()=>{while(document.querySelectorAll('#part-list button').length<=${index})document.querySelector('#part-add').click();document.querySelectorAll('#part-list button')[${index}].click()})()`);};
  const write=(id,value)=>evaluate(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.type==='range'?'input':'change'));})()`);
  const startCamera=async()=>{
    await evaluate("clearInterval(colorTimer);colorTimer=setInterval(()=>colorFeed.getContext('2d').fillRect(0,0,1,1),33)");
    await click('start');await waitFor("document.querySelector('#camera').readyState>=2&&document.querySelector('#camera-state').textContent==='使用中'");
    await evaluate("document.querySelector('#camera').pause();clearInterval(colorTimer)");
  };
  const png=async()=>{await click('save');await waitFor("!document.querySelector('#save').disabled");return evaluate("(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL();})()");};
  await evaluate(`(async()=>{
    const bg=document.createElement('canvas');bg.width=400;bg.height=600;bg.getContext('2d').fillStyle='#bd927a';bg.getContext('2d').fillRect(0,0,400,600);
    const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>bg.toBlob(r))],'warm.png',{type:'image/png'}));const e=document.querySelector('#image-file');e.files=dt.files;e.dispatchEvent(new Event('change'));
    window.colorFeed=document.createElement('canvas');colorFeed.width=640;colorFeed.height=480;
    const c=colorFeed.getContext('2d');c.fillStyle='#82645a';c.fillRect(0,0,640,480);c.fillStyle='#181010';c.fillRect(310,300,20,15);c.fillStyle='#f8f0e8';c.fillRect(315,301,10,3);
    window.nativeGUM=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>colorFeed.captureStream(30);
    window.colorTimer=setInterval(()=>{c.fillStyle='#82645a';c.fillRect(0,0,1,1)},33);
  })()`);
  await waitFor("document.querySelector('#status').dataset.state==='image-ready'");
  for(const [i,type]of ['mouth','leftEye','rightEye','nose'].entries()) {
    await click('select-'+type);for(const [key,value]of Object.entries({x:i%2?75:25,y:i<2?25:75,width:26,height:16,rotation:i*7,feather:20}))await write('part-'+key,value);
  }
  await startCamera();
  // Frozen old renderer, actual Canvas RGBA comparison across mirror/shape/rotation cases.
  assert.equal(await evaluate(`(async()=>{
    const {CompositeRenderer}=await import('./renderer.js?v=0.6.2'),{CompositeRenderer:Legacy}=await import('./tests/fixtures/original-renderer.mjs'),{createLegacyPart:createPart}=await import('./tests/fixtures/legacy-parts.mjs');
    for(const mirror of [true,false])for(const shape of ['oval','rectangle']) {
      const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=400;a.height=b.height=600;
      const parts=['mouth','leftEye','rightEye','nose'].map((t,i)=>({...createPart(t,i),shape,rotation:i*17,feather:i*17}));
      new Legacy().draw(a.getContext('2d'),document.querySelector('#camera'),parts,mirror);
      new CompositeRenderer().draw(b.getContext('2d'),document.querySelector('#camera'),parts,mirror,{composite:{mode:'original'},time:performance.now()});
      const aa=a.getContext('2d').getImageData(0,0,400,600).data,bb=b.getContext('2d').getImageData(0,0,400,600).data;if(!aa.every((v,i)=>v===bb[i]))return false;
    }return true;
  })()`),true);
  console.log('PASS COLOR: ORIGINAL RGBA equals frozen old renderer for four parts, both shapes, mirror and rotation');
  const original=await png();const originalPreview=await evaluate("document.querySelector('#composition').toDataURL()");await write('composite-mode','natural');const natural=await png();assert.notEqual(natural,original);
  await write('composite-strength',0);assert.equal(await png(),original);await write('composite-strength',100);
  await write('composite-mode','comic');assert.notEqual(await png(),natural);
  console.log('PASS COLOR: three modes, ORIGINAL-compatible zero global strength, and corrected PNG');
  await click('select-mouth');await write('composite-mode','natural');await write('color-brightness',18);await write('color-temperature',17);await write('color-tint',9);
  await click('select-leftEye');assert.equal(await evaluate("document.querySelector('#color-brightness').value"),'0');await write('color-brightness',-8);
  await click('select-mouth');assert.equal(await evaluate("document.querySelector('#color-brightness').value"),'18');
  await write('composite-mode','comic');assert.equal(await evaluate("document.querySelector('#color-brightness').value"),'6');await write('composite-mode','natural');
  assert.equal(await evaluate("document.querySelector('#color-brightness').value"),'18');
  console.log('PASS COLOR: selected-part and per-mode settings retain independent manual corrections');
  const corrected=await png();
  const beforeValues=await evaluate("[...document.querySelectorAll('#part-controls input,#source-controls input,#composite-controls input')].map(e=>e.value)");
  const point=await evaluate("(()=>{const e=document.querySelector('#composite-before');for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:8,radiusY:8}]});
  await waitFor("document.querySelector('#composite-before').getAttribute('aria-pressed')==='true'");
  const actualPreview=await evaluate("document.querySelector('#composition').toDataURL()");
  assert.ok(actualPreview===originalPreview,'held comparison must equal ORIGINAL preview');
  assert.equal(await png(),corrected,'PNG ignores temporary comparison');
  await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor("document.querySelector('#composite-before').getAttribute('aria-pressed')==='false'");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#part-controls input,#source-controls input,#composite-controls input')].map(e=>e.value)"),beforeValues);
  assert.equal(await evaluate("document.querySelector('#composition').toDataURL()"),corrected);
  console.log('PASS COLOR: held touch comparison restores safely, changes no controls, and never changes official PNG mode');
  await click('photo-guide');await click('photo-loupe');await write('photo-view-zoom',200);assert.equal(await png(),corrected);
  await click('photo-guide');await click('photo-loupe');
  await evaluate("document.querySelector('#photo-loupe').checked=true;document.querySelector('#photo-loupe').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("document.querySelector('#photo-magnifier').hidden"),false);
  console.log('PASS COLOR: guides/magnifier/zoom excluded from PNG; magnifier retains actual corrected composite source');
  await click('composite-auto');await new Promise(r=>setTimeout(r,700));const matched=await png();assert.notEqual(matched,corrected);
  await click('composite-auto');assert.equal(await png(),corrected);
  await click('composite-texture');const untextured=await png();await click('composite-texture');assert.equal(await png(),corrected);assert.notEqual(untextured,corrected);
  console.log('PASS COLOR: automatic matching ON/OFF, stable grain and texture bypass');
  const shape=await evaluate("document.querySelector('#shape').value");await write('shape','rectangle');assert.notEqual(await png(),corrected);await write('shape',shape);
  const stoppedValues=await evaluate("[...document.querySelectorAll('#composite-controls input')].map(e=>e.value)");
  await click('stop');await startCamera();
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#composite-controls input')].map(e=>e.value)"),stoppedValues);assert.ok((await png()).startsWith('data:image/png'));
  console.log('PASS COLOR: shape/Feather masks and camera stop/restart preserve color configuration');
  await click('templates-open');await waitFor("!document.querySelector('#template-save').disabled");await click('template-save-as');
  await evaluate("document.querySelector('#template-name').value='Color fixture';document.querySelector('#template-name-form').requestSubmit()");
  await waitFor("!document.querySelector('#template-name-dialog').open&&document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  const saved=await evaluate(`(async()=>{const {TemplateStore}=await import('./template-store.js?v=0.6.2');const s=new TemplateStore(),rows=await s.list();s.close();return rows.find(r=>r.doc.name==='Color fixture').doc;})()`);
  assert.equal(saved.schemaVersion,4);assert.equal(saved.composite.mode,'natural');assert.equal(saved.parts[0].appearance.natural.brightness,18);
  await click('template-export');await waitFor("!document.querySelector('#template-download').hidden&&document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  const zipDoc=await evaluate(`(async()=>{const {importTemplate}=await import('./template-zip.js?v=0.6.2');window.colorZip=await(await fetch(document.querySelector('#template-download').href)).blob();return(await importTemplate(colorZip)).doc;})()`);
  assert.deepEqual(zipDoc.parts,saved.parts);assert.deepEqual(zipDoc.composite,saved.composite);
  await click('templates-close');await write('composite-mode','comic');await click('templates-open');
  await waitFor("!document.querySelector('#template-import').disabled");
  await evaluate("const d=new DataTransfer();d.items.add(new File([colorZip],'color.zip',{type:'application/zip'}));const e=document.querySelector('#template-import');e.files=d.files;e.dispatchEvent(new Event('change'))");
  await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-yes');await waitFor("!document.querySelector('#template-manager').open");
  assert.equal(await evaluate("document.querySelector('#composite-mode').value"),'natural');assert.equal(await evaluate("document.querySelector('#camera').srcObject"),null);
  await startCamera();assert.equal(await evaluate("document.querySelector('#composite-mode').value"),'natural');
  assert.equal(await evaluate(`(async()=>{
    const {CompositeRenderer}=await import('./renderer.js?v=0.6.2'),{importTemplate}=await import('./template-zip.js?v=0.6.2');
    const record=await importTemplate(colorZip),bg=new Image();bg.src=URL.createObjectURL(record.background);await bg.decode();URL.revokeObjectURL(bg.src);
    Object.assign(colorFeed,{videoWidth:640,videoHeight:480,readyState:4});const results=[];
    for(const doc of [${JSON.stringify(saved)},record.doc]){const c=document.createElement('canvas');c.width=400;c.height=600;const ctx=c.getContext('2d');ctx.drawImage(bg,0,0);new CompositeRenderer().draw(ctx,colorFeed,doc.parts,doc.mirror,{composite:doc.composite,background:bg,time:0});results.push(c.toDataURL());}
    return results[0]===results[1];
  })()`),true);
  console.log('PASS COLOR: IndexedDB and ZIP retain all four mode settings; same-source restored PNG pixels match');
  await command('Page.reload');await waitFor("document.body.dataset.appState==='ready'");await click('templates-open');await waitFor("document.querySelector('#template-list [data-action=load]')");
  await evaluate("document.querySelector('#template-list [data-action=load]').click()");await waitFor("!document.querySelector('#template-manager').open");
  assert.equal(await evaluate("document.querySelector('#composite-mode').value"),'natural');
  await click('select-mouth');assert.equal(await evaluate("document.querySelector('#color-brightness').value"),'18');
  console.log('PASS COLOR: reload and actual IndexedDB load restore correction controls');
  for(const width of [375,390]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate("document.querySelector('#composite-settings').open=true");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    assert.equal(await evaluate("document.querySelector('#composite-before').getBoundingClientRect().height>=44"),true);
  }
  if(process.env.COLOR_SCREENSHOT_PATH){await evaluate('scrollTo(0,0)');const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.COLOR_SCREENSHOT_PATH,Buffer.from(data,'base64'));}
  console.log('PASS COLOR: 375px and 390px collapsed/expanded UI fits with 44px comparison target');
}
