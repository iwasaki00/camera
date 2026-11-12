import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function checkPicker({evaluate,command,waitFor,choosers,profile,audit}) {
  if(process.env.SIMULATE_STALE_CACHE==='1') {
    await waitFor("!!document.querySelector('#image-file')");
    assert.deepEqual(await evaluate("[document.body.dataset.appState,document.querySelector('#image-file').disabled,document.querySelector('#image-file-native').disabled]"),['initializing',true,true]);
    console.log('PASS: delayed initialization keeps both image inputs disabled with explanation');
  }
  await waitFor("!!document.querySelector('#image-file')&&!document.querySelector('#image-file').disabled");
  await command('Page.setInterceptFileChooserDialog',{enabled:true});
  const click=async (selector,touch=false,edge=false)=>{
    const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+${edge?'r.width-5':'r.width/2'},y:r.y+${edge?'r.height-5':'r.height/2'}};})()`);
    if(touch) {
      await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1,radiusX:8,radiusY:8}]});
      await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
      await command('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
    }
  };
  const choose=async(selector,file,touch=false,edge=false)=>{
    assert.equal(choosers.length,0);
    await click(selector,touch,edge);
    for(let i=0;i<50&&!choosers.length;i++)await new Promise(r=>setTimeout(r,50));
    assert.equal(choosers.length,1,'real click must activate native file chooser');
    const chooser=choosers.shift();
    await command('DOM.setFileInputFiles',{files:file?[file]:[],backendNodeId:chooser.backendNodeId});
  };
  console.log('AUDIT:',await evaluate(`JSON.stringify({status:document.querySelector('#status').textContent,disabled:document.querySelector('#image-file').disabled,trigger:document.querySelector('#image-trigger').tagName,inputWidth:document.querySelector('#image-file').getBoundingClientRect().width,inputHeight:document.querySelector('#image-file').getBoundingClientRect().height,css:document.querySelector('link[rel=stylesheet]').getAttribute('href')})`));
  await choose('#image-trigger',null);
  console.log('PASS: initialized input; real click activates chooser; cancellation returns safely');
  if(audit)return;
  await choose('#image-trigger',null,true);
  await choose('#image-trigger',null,true,true);
  console.log('PASS: real touch taps at center and lower-right edge activate native chooser');
  const png=path.join(profile,'picker.png'),jpeg=path.join(profile,'picker.jpg'),invalid=path.join(profile,'broken.png'),unsupported=path.join(profile,'text.txt');
  for(const [file,mime]of [[png,'image/png'],[jpeg,'image/jpeg']]) {
    const url=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').fillStyle='#a04030';c.getContext('2d').fillRect(0,0,400,600);return c.toDataURL('${mime}');})()`);
    await writeFile(file,Buffer.from(url.split(',')[1],'base64'));
    await choose('#image-trigger',file);
    await waitFor("document.querySelector('#status').dataset.state==='image-ready'");
    assert.deepEqual(await evaluate("[document.querySelector('#composition').width,document.querySelector('#composition').height,document.querySelector('#empty-hint').hidden]"),[400,600,true]);
    console.log('PASS: chooser selection decodes and displays '+mime);
  }
  await choose('#image-trigger',jpeg);
  await waitFor("document.querySelector('#status').dataset.state==='image-ready'&&document.querySelector('#image-file').value===''");
  const before=await evaluate("document.querySelector('#composition').toDataURL()");
  await choose('#image-trigger',null);
  assert.equal(await evaluate("document.querySelector('#composition').toDataURL()"),before);
  await choose('#image-trigger',jpeg);
  await waitFor("document.querySelector('#status').dataset.state==='image-ready'&&document.querySelector('#image-file').value===''");
  console.log('PASS: same image reselection and cancel/reopen preserve image');
  await writeFile(invalid,'invalid');await writeFile(unsupported,'text');
  for(const [file,state]of [[invalid,'image-decode-error'],[unsupported,'unsupported-image']]) {
    await choose('#image-trigger',file);await waitFor(`document.querySelector('#status').dataset.state==='${state}'`);
    assert.equal(await evaluate("document.querySelector('#composition').toDataURL()"),before);
  }
  console.log('PASS: invalid image and unsupported type report distinct errors; previous image retained');
  await click('#image-picker-help summary');await choose('#image-file-native',png);
  await waitFor("document.querySelector('#status').dataset.state==='image-ready'");
  console.log('PASS: visible native fallback uses normal image loader');
  await evaluate("document.querySelector('#image-file').focus()");
  assert.equal(await evaluate("document.activeElement.id"),'image-file');
  await command('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await command('Input.dispatchKeyEvent',{type:'char',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  for(let i=0;i<50&&!choosers.length;i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(choosers.length,1);await command('DOM.setFileInputFiles',{files:[],backendNodeId:choosers.shift().backendNodeId});
  console.log('PASS: native input keyboard activation');
  await click('#templates-open');await waitFor("!document.querySelector('#template-import').disabled");
  await choose('#template-import-trigger',null);
  const zipBefore=await evaluate("document.querySelector('#composition').toDataURL()");
  await click('#template-export');await waitFor("!document.querySelector('#template-download').hidden");
  const zipBytes=await evaluate(`(async()=>{const b=await(await fetch(document.querySelector('#template-download').href)).blob();return [...new Uint8Array(await b.arrayBuffer())];})()`);
  const validZip=path.join(profile,'portrait-template.zip');await writeFile(validZip,Buffer.from(zipBytes));
  await choose('#template-import-trigger',validZip);
  await waitFor("document.querySelector('#template-confirm').open");await click('#template-confirm-yes');
  await waitFor("!document.querySelector('#template-manager').open");
  assert.equal(await evaluate("document.querySelector('#composition').toDataURL()"),zipBefore);
  console.log('PASS: valid ZIP chosen through real chooser restores background');
  await click('#templates-open');await waitFor("!document.querySelector('#template-import').disabled");
  // Existing template tests cover ZIP data; here exercise the real chooser and importer error path.
  const badZip=path.join(profile,'invalid.zip');await writeFile(badZip,'invalid zip');
  await choose('#template-import-trigger',badZip);await waitFor("document.querySelector('#template-message').dataset.error==='true'");
  await click('#zip-picker-help summary');await choose('#template-import-native',null);
  console.log('PASS: ZIP chooser, cancellation, import validation and native fallback');
  await click('#templates-close');
  assert.deepEqual(await evaluate(`(()=>{const e=document.querySelector('#image-file'),r=e.getBoundingClientRect(),b=document.querySelector('#image-trigger').getBoundingClientRect();e.scrollIntoView({block:'center'});const q=e.getBoundingClientRect();return [r.width>=44,r.height>=44,Math.abs(r.width-b.width)<3,document.elementFromPoint(q.x+q.width/2,q.y+q.height/2)===e,document.documentElement.scrollWidth<=innerWidth];})()`),[true,true,true,true,true]);
  console.log('PASS: full-size input owns hit target; mobile layout fits');
  await command('Network.enable');await command('Network.setBlockedURLs',{urls:['*app.js*']});await command('Page.reload',{ignoreCache:true});
  await waitFor("document.querySelector('#status')?.dataset.state==='initialization-error'");
  assert.equal(await evaluate("[...document.querySelectorAll('input[type=file]')].every(e=>e.disabled)"),true);
  console.log('PASS: initialization failure explains disabled inputs');
  await command('Network.setBlockedURLs',{urls:[]});await command('Page.reload',{ignoreCache:true});
  await waitFor("document.body.dataset.appState==='ready'&&!document.querySelector('#image-file').disabled");
  console.log('PASS: reload recovers initialization');
}
