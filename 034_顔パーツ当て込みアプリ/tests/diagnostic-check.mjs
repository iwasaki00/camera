import assert from 'node:assert/strict';
export async function checkDiagnosticPanel({evaluate,waitFor}) {
  assert.equal(await evaluate("document.querySelector('#diagnostics').open"),false);
  await evaluate("window.diagnosticUpdates=0;window.diagnosticObserver=new MutationObserver(()=>window.diagnosticUpdates++);window.diagnosticObserver.observe(document.querySelector('#diagnostic-values'),{childList:true,subtree:true,characterData:true});document.querySelector('#diagnostics').open=true;");
  await waitFor("document.querySelector('#diagnostic-values').textContent.includes('480×360')&&document.querySelector('#diagnostic-values').textContent.includes('worker')");
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>window.copiedDiagnostic=t}});document.querySelector('#diagnostic-copy').click();");
  await waitFor("!!window.copiedDiagnostic");assert.equal(await evaluate("window.copiedDiagnostic.includes('5秒')&&window.copiedDiagnostic.includes('640×480')&&window.copiedDiagnostic.includes('480×360')"),true);
  await evaluate("navigator.clipboard.writeText=async()=>{throw new Error('blocked')};document.querySelector('#diagnostic-copy').click()");
  await waitFor("!document.querySelector('#diagnostic-text').hidden");assert.equal(await evaluate("document.querySelector('#diagnostic-text').value.includes('Portrait Face Parts Player v0.6.2')"),true);
  await evaluate("delete navigator.clipboard;document.querySelector('#diagnostics').open=false");
  await new Promise(r=>setTimeout(r,100));const count=await evaluate('window.diagnosticUpdates');await new Promise(r=>setTimeout(r,650));
  assert.equal(await evaluate('window.diagnosticUpdates'),count);await evaluate('window.diagnosticObserver.disconnect()');
  console.log('PASS DIAGNOSTICS: live rolling values, both resolutions, copy and denied-copy fallback; no display updates when OFF');
}
