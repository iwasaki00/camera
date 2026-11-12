// Optional local Playwright installation; adds no production dependency.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const {webkit}=process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE,'index.mjs')).href)
  : await import('playwright-core');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{
  try {
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!target.startsWith(root)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[path.extname(target)]||'application/octet-stream');
    res.end(await readFile(target));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await webkit.launch({headless:true,timeout:15000});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await Promise.race([context.newPage(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('WebKit newPage timeout (15s)')),15000);timer.unref();})]);
  page.setDefaultTimeout(8000);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>document.body.dataset.appState==='ready');
  if(process.argv.includes('--short')) {
    const {checkWebkitShort}=await import('./webkit-short.mjs');await checkWebkitShort(page);
  } else if(process.argv.includes('--screens')) {
    const {checkWebkitScreens}=await import('./webkit-screens.mjs');await checkWebkitScreens(page);
  } else if(process.argv.includes('--recording')) {
    const {checkWebkitRecording}=await import('./webkit-recording.mjs');await checkWebkitRecording(page);
  } else if(process.argv.includes('--composite')) {
    const {checkWebkitColor}=await import('./webkit-color-check.mjs');await checkWebkitColor(page);
  } else {
  const choose=async(selector,file,tap=false)=>{
    const event=page.waitForEvent('filechooser');
    if(tap)await page.locator(selector).tap();else await page.locator(selector).click();
    const chooser=await event;
    await chooser.setFiles(file||[]);
  };
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=160;c.getContext('2d').fillRect(0,0,120,160);return c.toDataURL().split(',')[1];});
  const png={name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')};
  for(const width of [375,390]) {
    await page.setViewportSize({width,height:844});
    await choose('#image-trigger',png,true);
    await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='image-ready'&&document.querySelector('#image-file').value==='');
    assert.deepEqual(await page.evaluate(()=>[document.querySelector('#composition').width,document.querySelector('#composition').height,document.documentElement.scrollWidth<=innerWidth]),[120,160,true]);
    console.log(`PASS: WebKit ${width}px real tap → filechooser → PNG displayed`);
  }
  await choose('#image-trigger',null);
  await choose('#image-trigger',png);
  await page.waitForFunction(()=>document.querySelector('#image-file').value==='');
  console.log('PASS: WebKit cancellation and same-image reselection');
  await page.locator('#settings-toggle').click();await page.locator('#settings-more summary').first().click();
  await page.locator('#image-picker-help summary').click();await choose('#image-file-native',png);
  await page.waitForFunction(()=>document.querySelector('#image-file-native').value==='');
  console.log('PASS: WebKit native fallback');
  await page.locator('#templates-open').click();await page.locator('#template-import').waitFor({state:'visible'});
  await choose('#template-import-trigger',null);
  await page.locator('#zip-picker-help summary').click();await choose('#template-import-native',null);
  console.log('PASS: WebKit normal and fallback ZIP file choosers');
  }
}finally{await browser?.close();await new Promise(r=>server.close(r));}
