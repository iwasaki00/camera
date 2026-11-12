import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Actual IndexedDB and app dialogs in Chromium. Camera input is a deterministic canvas stream.
export async function checkTemplates({evaluate,command,waitFor}) {
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const idle = () => waitFor("document.querySelector('#template-manager').getAttribute('aria-busy')==='false'");
  const open = async()=>{if(!await evaluate("document.querySelector('#template-manager').open"))await click('templates-open');await idle();};
  const write = values=>evaluate(`(()=>{for(const [id,value]of Object.entries(${JSON.stringify(values)})){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event(e.type==='range'?'input':'change'));}})()`);
  const setupStore = ()=>evaluate("(async()=>{const {TemplateStore}=await import('./template-store.js?v=0.6.2');window.templateStore=new TemplateStore();await window.templateStore.open();})()");
  const docs = ()=>evaluate("(async()=> (await window.templateStore.list()).map(r=>r.doc))()");
  const named = async(button,name)=>{
    await click(button);await waitFor("document.querySelector('#template-name-dialog').open");
    await evaluate(`document.querySelector('#template-name').value=${JSON.stringify(name)};document.querySelector('#template-name-form').requestSubmit()`);
    await waitFor("!document.querySelector('#template-name-dialog').open");await idle();
  };
  const action = async(id,name)=>{
    await evaluate(`(()=>{const card=document.querySelector('[data-template-id="${id}"]');card.querySelector('details').open=true;card.querySelector('[data-action="${name}"]').click();})()`);
  };
  const load = async id=>{
    await open();await action(id,'load');
    await waitFor("document.querySelector('#template-confirm').open||!document.querySelector('#template-manager').open");
    if(await evaluate("document.querySelector('#template-confirm').open"))await click('template-confirm-yes');
    await waitFor("!document.querySelector('#template-manager').open");await idle();
  };
  const assertRestored = async doc=>{
    assert.equal(await evaluate("document.querySelector('#mirror').checked"),doc.mirror);
    for(const type of ['mouth','leftEye','rightEye','nose']){
      const part=doc.parts.find(p=>p.partType===type);
      assert.equal(await evaluate(`document.querySelector('#select-${type}').dataset.exists`),String(!!part));
      if(!part)continue;
      await click(`select-${type}`);
      const values=await evaluate(`(()=>{const value=id=>Number(document.getElementById(id).value);return {
        targetRect:{x:value('part-x'),y:value('part-y'),width:value('part-width'),height:value('part-height')},
        sourceRect:{x:value('source-x')/100,y:value('source-y')/100,zoom:value('source-zoom')},rotation:value('part-rotation'),feather:value('part-feather'),
        enabled:document.querySelector('#part-enabled').checked,shape:document.querySelector('#shape').value,
        guides:{photo:document.querySelector('#photo-guide').checked,camera:document.querySelector('#camera-guide').checked},order:document.querySelector('#part-order-value').value};})()`);
      assert.deepEqual(values.targetRect,part.targetRect);assert.equal(values.rotation,part.rotation);assert.equal(values.feather,part.feather);
      assert.equal(values.enabled,part.enabled);assert.equal(values.shape,part.shape);assert.deepEqual(values.guides,part.guides);
      assert.ok(Math.abs(values.sourceRect.x-(doc.mirror?1-part.sourceRect.x:part.sourceRect.x))<.0011);
      assert.ok(Math.abs(values.sourceRect.y-part.sourceRect.y)<.0011);assert.equal(values.sourceRect.zoom,part.sourceRect.zoom);
      assert.equal(Number(values.order.split(' / ')[0]),[...doc.parts].sort((a,b)=>a.zIndex-b.zIndex).findIndex(p=>p.id===part.id)+1);
    }
  };
  const png=async()=>{await click('save');await waitFor("!document.querySelector('#save').disabled");return evaluate("(async()=>{const img=document.querySelector('#export-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL();})()");};
  const attachVideo=async()=>{
    await click('start');await waitFor("document.querySelector('#camera-state').textContent==='使用中'&&document.querySelector('#camera').readyState>=2");
    await evaluate(`(async()=>{const v=document.querySelector('#camera'),c=document.createElement('canvas');c.width=800;c.height=600;
      const ctx=c.getContext('2d');['#f00000','#00d000','#0000e0','#e0c000'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*200,0,200,600);});
      window.templateStreams??=[];const stream=c.captureStream(8);window.templateStreams.push(stream);v.srcObject=stream;await v.play();await new Promise(r=>setTimeout(r,180));v.pause();await new Promise(r=>requestAnimationFrame(r));})()`);
  };
  const importBytes=bytes=>evaluate(`(()=>{const input=document.querySelector('#template-import'),dt=new DataTransfer();dt.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})],'template.zip',{type:'application/zip'}));input.files=dt.files;input.dispatchEvent(new Event('change'));})()`);

  await setupStore();await click('select-nose');await write({'part-rotation':25,'part-feather':35,shape:'oval'});
  await click('photo-guide');await click('select-leftEye');await click('part-enabled');
  await click('select-mouth');await click('part-front');await attachVideo();
  const originalPNG=await png();await open();await named('template-save','四パーツ');
  let rows=await docs();assert.equal(rows.length,1);const firstId=rows[0].id,firstCreated=rows[0].createdAt;
  const firstDoc=rows[0];assert.equal(firstDoc.parts.length,4);assert.equal(firstDoc.parts.find(p=>p.partType==='leftEye').enabled,false);
  assert.equal(await evaluate("document.querySelector('#templates-open').textContent.includes('●')"),false);
  console.log('PASS TEMPLATE: new save with four independent parts, mirror and guide settings');

  assert.equal(await evaluate(`(async()=>{const r=await window.templateStore.get('${firstId}');const {decodeBackground}=await import('./template-images.js?v=0.6.2');
    const c=await decodeBackground(r.background,r.doc.background),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=0;i<p.length;i+=4)if(p[i]!==160||p[i+1]!==64||p[i+2]!==48||p[i+3]!==255)return false;
    const bitmap=await createImageBitmap(r.thumbnail),t=document.createElement('canvas');t.width=bitmap.width;t.height=bitmap.height;t.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
    const pixel=t.getContext('2d').getImageData(t.width/2,t.height/2,1,1).data;
    return Math.abs(pixel[0]-160)<5&&Math.abs(pixel[1]-64)<5&&Math.abs(pixel[2]-48)<5&&Object.keys(r).sort().join(',')==='background,bytes,doc,thumbnail';})()`),true);
  assert.equal(firstDoc.background.name,'portrait.png');assert.equal(firstDoc.background.mime,'image/png');
  assert.equal(await evaluate("document.querySelector('#template-usage').textContent.includes('1件')"),true);
  console.log('PASS TEMPLATE: stored background and thumbnail exclude live camera; original file metadata and capacity shown');

  await named('template-save','四パーツ更新');rows=await docs();assert.equal(rows.length,1);assert.equal(rows[0].id,firstId);assert.equal(rows[0].createdAt,firstCreated);assert.ok(rows[0].updatedAt>firstDoc.updatedAt);
  await named('template-save-as','別名');rows=await docs();assert.equal(rows.length,2);const secondId=rows.find(d=>d.id!==firstId).id;
  assert.equal(rows.find(d=>d.id===firstId).name,'四パーツ更新');
  console.log('PASS TEMPLATE: overwrite retains ID/creation date; save-as creates an independent record');

  await action(secondId,'rename');await evaluate("document.querySelector('#template-name').value='名前変更';document.querySelector('#template-name-form').requestSubmit()");
  await waitFor("!document.querySelector('#template-name-dialog').open");await idle();assert.equal((await docs()).find(d=>d.id===secondId).name,'名前変更');
  await action(secondId,'duplicate');await idle();rows=await docs();assert.equal(rows.length,3);const copyId=rows.find(d=>![firstId,secondId].includes(d.id)).id;
  await action(copyId,'delete');await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-no');await idle();assert.equal((await docs()).length,3);
  await action(copyId,'delete');await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-yes');await idle();assert.equal((await docs()).length,2);
  console.log('PASS TEMPLATE: rename, duplicate, delete confirmation cancellation and deletion');

  if(process.env.TEMPLATE_SCREENSHOT_PATH){const {data}=await command('Page.captureScreenshot',{format:'png'});await writeFile(process.env.TEMPLATE_SCREENSHOT_PATH,Buffer.from(data,'base64'));}
  assert.equal(await evaluate("(()=>{const d=document.querySelector('#template-manager');return d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth;})()"),true);
  await click('templates-close');await click('select-mouth');await write({'part-x':61,'photo-view-zoom':200,'camera-view-zoom':300,'interaction-mode':'pan'});
  await evaluate("const magnifier=document.querySelector('#photo-magnifier select');magnifier.value='5';magnifier.dispatchEvent(new Event('change'));");
  await open();await action(firstId,'load');
  await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-no');await idle();assert.equal(await evaluate("document.querySelector('#part-x').value"),'61');
  await action(firstId,'load');await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-yes');await waitFor("!document.querySelector('#template-manager').open");await idle();
  await assertRestored(firstDoc);assert.equal(await evaluate("document.querySelector('#camera').srcObject"),null);
  assert.equal(await evaluate("document.querySelector('#photo-view-value').value"),'100%');
  assert.equal(await evaluate("document.querySelector('#camera-view-value').value"),'100%');
  assert.equal(await evaluate("document.querySelector('#photo-magnifier select').value"),'3');
  assert.equal(await evaluate("document.querySelector('#interaction-mode').value"),'edit');
  await attachVideo();assert.equal(await png(),originalPNG);
  console.log('PASS TEMPLATE: unsaved-change cancel/accept, full restoration, manual camera restart, identical PNG output');

  await click('select-nose');await click('part-delete');await open();await named('template-save-as','鼻なし');
  const deletedDoc=(await docs()).find(d=>d.name==='鼻なし');assert.equal(deletedDoc.parts.length,3);
  await load(secondId);assert.equal(await evaluate("document.querySelector('#select-nose').dataset.exists"),'true');
  await load(deletedDoc.id);await assertRestored(deletedDoc);assert.equal(await evaluate("document.querySelector('#select-nose').dataset.exists"),'false');
  console.log('PASS TEMPLATE: deleted-part state is restored without recreating the missing part');

  await load(firstId);await open();await action(firstId,'export');await idle();
  const zipBytes=await evaluate("(async()=>Array.from(new Uint8Array(await (await fetch(document.querySelector('#template-download').href)).arrayBuffer())))()");
  assert.deepEqual(zipBytes.slice(0,2),[80,75]);
  await click('templates-close');await write({'part-x':63});await open();await importBytes(zipBytes);
  await waitFor("document.querySelector('#template-confirm').open");await click('template-confirm-yes');await waitFor("!document.querySelector('#template-manager').open");await idle();
  await assertRestored(firstDoc);assert.equal(await evaluate("document.querySelector('#templates-open').textContent.includes('●')"),true);
  await open();await named('template-save','ZIPから保存');assert.equal((await docs()).length,4);
  console.log('PASS TEMPLATE: ZIP export/import roundtrip restores data as a new unsaved draft, then explicitly saves');

  await importBytes([1,2,3]);await idle();assert.equal(await evaluate("document.querySelector('#template-message').dataset.error"),'true');assert.equal((await docs()).length,4);
  // A valid PNG header with no image payload passes header inspection but must fail browser decoding.
  await evaluate(`(async()=>{const r=await window.templateStore.get('${firstId}'),{zipSync,strToU8}=await import('./vendor/fflate-0.8.2.js');
    const broken=new Uint8Array(await r.background.arrayBuffer()).slice(0,33),doc=structuredClone(r.doc);doc.background.storedSize=broken.length;
    window.invalidTemplateZIP=Array.from(zipSync({'template.json':strToU8(JSON.stringify(doc)),'background.png':broken}));})()`);
  await importBytes(await evaluate('window.invalidTemplateZIP'));await idle();assert.equal(await evaluate("document.querySelector('#template-message').dataset.error"),'true');assert.equal((await docs()).length,4);
  assert.equal(await evaluate("document.querySelector('#template-confirm').open"),false);
  console.log('PASS TEMPLATE: invalid ZIP and truncated real image are rejected before applying or changing saved data');

  const beforeQuota=await docs();
  await evaluate("window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError')}");
  await click('template-save');await evaluate("document.querySelector('#template-name').value='失敗する更新';document.querySelector('#template-name-form').requestSubmit()");
  await idle();assert.equal(await evaluate("document.querySelector('#template-name-error').textContent.includes('容量')"),true);
  await evaluate('IDBObjectStore.prototype.put=window.originalPut');assert.deepEqual(await docs(),beforeQuota);await click('template-name-cancel');
  console.log('PASS TEMPLATE: simulated quota failure aborts overwrite and preserves every existing record');

  await click('templates-close');await evaluate('window.templateStreams.forEach(s=>s.getTracks().forEach(t=>t.stop()));window.templateStore.close()');
  const persisted=await docs();await command('Page.reload');await waitFor("!!document.querySelector('#image-file')&&!document.querySelector('#image-file').disabled");await setupStore();
  assert.deepEqual(await docs(),persisted);await load(firstId);await assertRestored(firstDoc);assert.equal(await evaluate("document.querySelector('#camera').srcObject"),null);
  assert.deepEqual(await evaluate("[document.querySelector('#composition').width,document.querySelector('#composition').height,Array.from(document.querySelector('#composition').getContext('2d').getImageData(0,0,1,1).data)]"),[400,600,[160,64,48,255]]);
  console.log('PASS TEMPLATE: page reload preserves IndexedDB records, background bytes and all saved settings');

  // Test browser-storage denial without erasing the real database; export remains independent of IndexedDB.
  const {identifier}=await command('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('blocked','SecurityError')}})"});
  await command('Page.reload');await waitFor("!!document.querySelector('#image-file')&&!document.querySelector('#image-file').disabled");await open();
  assert.equal(await evaluate("document.querySelector('#template-save').disabled&&document.querySelector('#template-storage').textContent.includes('ZIP')"),true);
  await click('templates-close');
  await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=40;c.height=60;const blob=await new Promise(r=>c.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([blob],'fallback.png',{type:'image/png'}));const e=document.querySelector('#image-file');e.files=dt.files;e.dispatchEvent(new Event('change'));})()`);
  await waitFor("!document.querySelector('#save').disabled");await open();await click('template-export');await idle();
  assert.equal(await evaluate("!document.querySelector('#template-download').hidden&&document.querySelector('#template-save').disabled"),true);
  await command('Page.removeScriptToEvaluateOnNewDocument',{identifier});await command('Page.reload');await waitFor("!!document.querySelector('#image-file')&&!document.querySelector('#image-file').disabled");await setupStore();assert.deepEqual(await docs(),persisted);
  console.log('PASS TEMPLATE: unavailable IndexedDB leaves editor and ZIP export usable; saved records remain intact');
}
