import {shareableRecording} from './recording.js?v=0.6.0';
const $=id=>document.getElementById(id);
const names={idle:'待機',initializing:'初期化中',recording:'録画中',stopping:'録画終了処理中',completed:'録画完了',error:'エラー'};
export class RecordingUI {
  constructor({recorder,ready,start,lockChanged}) {
    Object.assign(this,{recorder,ready,start,lockChanged});this.disabled=new Map();this.url=null;this.result=null;
    $('record-start').addEventListener('click',()=>start());
    $('record-stop').addEventListener('click',()=>recorder.stop());
    $('record-silent').addEventListener('click',()=>{$('record-mic').checked=false;start();});
    $('record-open').addEventListener('click',()=>this.open());
    $('record-close').addEventListener('click',()=>$('record-result').close());
    $('record-result').addEventListener('close',()=>this.releasePreview());
    $('record-play').addEventListener('click',async()=>{try{await $('record-player').play();$('record-result-message').textContent='録画済み動画を再生しています。';}catch{$('record-result-message').textContent='再生できません。保存リンクからファイルを確認してください。';}});
    $('record-pause').addEventListener('click',()=>{$('record-player').pause();$('record-player').currentTime=0;});
    $('record-player').addEventListener('error',()=>{if(this.url)$('record-result-message').textContent='このブラウザでは再生できません。動画保存からファイルを確認してください。';});
    $('record-retake').addEventListener('click',()=>{$('record-result').close();recorder.clearResult();if(ready())start();else $('record-status').textContent='カメラを開始してから録画してください。';});
    $('record-share').addEventListener('click',async()=>{
      const file=shareableRecording(recorder.result);if(!file){$('record-result-message').textContent='ファイル共有は利用できません。動画保存をご利用ください。';return;}
      try{await navigator.share({files:[file],title:'Portrait Face Parts Player'});$('record-result-message').textContent='共有先へ動画を渡しました。';}
      catch(error){$('record-result-message').textContent=error?.name==='AbortError'?'共有をキャンセルしました。':'共有できませんでした。動画保存をご利用ください。';}
    });
    this.sync();
  }
  options(){return {duration:Number($('record-duration').value),microphone:$('record-mic').checked,quality:$('record-quality').value};}
  applyLock() {
    const busy=this.recorder.busy;
    const controls=[...document.querySelectorAll('.preview-panel button,.preview-panel input,.preview-panel select,#templates-open')]
      .filter(e=>!e.closest('#recording-panel')&&!['stop','save','diagnostic-copy'].includes(e.id));
    for(const e of controls) {
      if(busy){if(!this.disabled.has(e))this.disabled.set(e,e.disabled);e.disabled=true;}
      else if(this.disabled.has(e)){e.disabled=this.disabled.get(e);this.disabled.delete(e);}
    }
    $('image-trigger').setAttribute('aria-disabled',String(busy||$('image-file').disabled));
    if(this.locked!==busy){this.locked=busy;this.lockChanged?.(busy);}
  }
  sync() {
    const r=this.recorder,busy=r.busy;
    this.applyLock();
    $('record-start').disabled=busy||!this.ready()||!r.supported;
    $('record-stop').disabled=!busy||r.state==='stopping';
    for(const id of ['record-duration','record-mic','record-quality'])$(id).disabled=busy;
    $('record-open').disabled=busy||!r.result;
    $('record-silent').hidden=!(r.state==='error'&&r.canRetrySilent);$('record-silent').disabled=busy||!this.ready();
    $('record-status').dataset.state=r.supported?r.state:'error';
    const text=!r.supported?'このブラウザはCanvas動画録画に対応していません。':r.error||`${names[r.state]}${r.reason?' / '+r.reason:''}`;
    if($('record-status').textContent!==text)$('record-status').textContent=text;
    $('record-status').dataset.error=String(r.state==='error'||!!r.error);
    $('record-elapsed').value=`${(r.elapsedMs/1000).toFixed(1)}秒`;
    if(!r.result&&this.result){this.releasePreview();this.result=null;}
    if(r.result&&this.result!==r.result){this.result=r.result;if(!document.hidden&&!this.suspended)this.open();}
  }
  open() {
    const r=this.recorder.result;if(!r)return;
    this.releasePreview();this.url=URL.createObjectURL(r.blob);$('record-player').src=this.url;
    $('record-download').href=this.url;$('record-download').download=r.filename;
    $('record-result-info').textContent=`${(r.elapsedMs/1000).toFixed(1)}秒 / ${r.width}×${r.height} / ${r.mime.split(';')[0]} / ${(r.blob.size/1024/1024).toFixed(2)} MB / ${r.hasAudio?'マイクON':'無音'}`;
    $('record-result-message').textContent=r.partial?'録画中にエラーがありました。途中ファイルを保持しました。再生して確認してください。':'';
    $('record-share').disabled=!shareableRecording(r);
    if(!$('record-result').open)$('record-result').showModal();
  }
  releasePreview() {
    $('record-player').pause();$('record-player').removeAttribute('src');$('record-player').load();
    $('record-download').removeAttribute('href');if(this.url)URL.revokeObjectURL(this.url);this.url=null;
  }
}
