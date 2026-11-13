import {shareableRecording} from './recording.js?v=0.9.1';
import {recordingPlan} from './recording.js?v=0.9.1';
import {outputOptions,drawRecordingOutput} from './recording-output.js?v=0.9.1';
const $=id=>document.getElementById(id);
const names={idle:'待機',initializing:'初期化中',countdown:'カウントダウン',recording:'録画中',stopping:'録画終了処理中',completed:'録画完了',error:'エラー'};
export class RecordingUI {
  constructor({recorder,ready,start,lockChanged,confirmDiscard=()=>window.confirm('未保存の録画を置き換えます。先に保存先で動画を確認しましたか？ 置き換えてよい場合はOKを選んでください。')}) {
    Object.assign(this,{recorder,ready,start,lockChanged,confirmDiscard});this.disabled=new Map();this.url=null;this.result=null;this.acknowledged=false;this.error='';
    this.beforeLeave=event=>{event.preventDefault();event.returnValue=true;};
    $('record-start').addEventListener('click',()=>this.requestStart());
    $('record-stop').addEventListener('click',()=>recorder.stop());
    $('record-countdown-cancel').addEventListener('click',()=>recorder.stop('カウントダウンをキャンセルしました。'));
    for(const input of document.querySelectorAll('.record-options input,.record-options select'))input.addEventListener('input',()=>{this.previewAt=0;if(this.previewSource)this.pushPreview(this.previewSource,performance.now(),true);});
    $('record-silent').addEventListener('click',()=>{$('record-mic').checked=false;this.requestStart();});
    $('record-open').addEventListener('click',()=>this.open());
    $('record-close').addEventListener('click',()=>$('record-result').close());
    $('record-result').addEventListener('close',()=>this.releasePreview());
    const playbackFailed=()=>{this.error='この環境で動画を再生できません。データは保持しています。「動画を保存」で別の対応プレイヤーでも確認できます。';$('record-result-message').textContent=this.error;};
    $('record-play').addEventListener('click',async()=>{try{await $('record-player').play();$('record-result-message').textContent='録画済み動画を再生しています。';}catch{playbackFailed();}});
    $('record-pause').addEventListener('click',()=>{$('record-player').pause();$('record-player').currentTime=0;});
    $('record-player').addEventListener('error',()=>{if(this.url)playbackFailed();});
    $('record-retake').addEventListener('click',()=>this.requestStart());
    $('record-acknowledge').addEventListener('click',()=>{this.acknowledged=true;this.sync();$('record-result-message').textContent='保存先での確認済みとして記録しました。';});
    $('record-download').addEventListener('click',()=>{$('record-result-message').textContent='保存リンクを操作しました。端末の保存先で再生できたら「保存先で確認済み」を押してください。保存できない場合も動画はここに残ります。';});
    $('record-retry-link').addEventListener('click',()=>this.open());
    $('record-share').addEventListener('click',async()=>{
      const file=shareableRecording(recorder.result);if(!file){$('record-result-message').textContent='ファイル共有は利用できません。動画を保存をご利用ください。';return;}
      try{await navigator.share({files:[file],title:'Portrait Face Parts Player'});$('record-result-message').textContent='共有先へ動画を渡しました。';}
      catch(error){if(error?.name!=='AbortError')this.error='共有できませんでした。動画を保存をご利用ください。';$('record-result-message').textContent=error?.name==='AbortError'?'共有をキャンセルしました。動画は保持しています。':this.error;}
    });
    this.sync();
  }
  requestStart() {
    if(this.recorder.busy)return;
    if(!this.ready()){$('record-result-message').textContent='カメラ停止中です。動画を保持しています。閉じて「カメラ開始」を押してから録り直してください。';return;}
    if(this.recorder.result&&!this.acknowledged&&!this.confirmDiscard())return;
    if($('record-result').open)$('record-result').close();
    this.error='';this.start();
  }
  syncLeaveWarning() {
    const warn=this.recorder.busy||!!this.recorder.result&&!this.acknowledged;
    if(warn===this.warnOnLeave)return;this.warnOnLeave=warn;
    if(warn)window.addEventListener('beforeunload',this.beforeLeave);else window.removeEventListener('beforeunload',this.beforeLeave);
  }
  options(){return {duration:Number($('record-duration').value),microphone:$('record-mic').checked,quality:$('record-quality').value,countdown:$('record-countdown').checked,
    output:outputOptions({aspect:$('record-aspect').value,framing:$('record-framing').value,centerX:Number($('record-center-x').value)/100,centerY:Number($('record-center-y').value)/100,title:$('record-title').value,titleTime:$('record-title-time').value,fade:$('record-fade').checked})};}
  pushPreview(source,time,force=false) {
    this.previewSource=source;
    if(!force&&(time<(this.previewAt||0)||!$('settings-panel').open||!$('settings-recording').open||document.hidden))return;
    this.previewAt=time+200;
    const options=this.options(),s=this.recorder.session,output=s?.output||options.output,duration=s?.duration||options.duration;
    const plan=s?.plan||recordingPlan(source.width,source.height,options.quality,output.aspect),canvas=$('record-output-preview');
    if(canvas.width!==plan.width||canvas.height!==plan.height){canvas.width=plan.width;canvas.height=plan.height;}
    $('record-preview-time').max=duration;
    const seconds=this.recorder.state==='recording'?this.recorder.elapsedMs/1000:Math.min(duration,Number($('record-preview-time').value));
    $('record-preview-value').value=`${seconds.toFixed(1)}秒`;
    drawRecordingOutput(canvas.getContext('2d'),source,plan.width,plan.height,output,seconds,duration);
  }
  applyLock() {
    const busy=this.recorder.busy;
    const controls=[...document.querySelectorAll('.preview-panel button,.preview-panel input,.preview-panel select,#templates-open')]
      .filter(e=>!e.closest('#recording-panel')&&!e.hasAttribute('data-recording-safe')&&!['stop','save','diagnostic-copy'].includes(e.id));
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
    $('recording-panel').dataset.recordingState=r.state;$('recording-panel').setAttribute('aria-busy',String(busy));
    $('record-countdown-overlay').hidden=r.state!=='countdown';
    $('record-countdown-number').value=String(r.session?.countdown||3);
    $('record-stop').textContent=r.state==='stopping'?'終了処理中…':r.state==='countdown'?'キャンセル':'録画停止';
    $('record-start').disabled=busy||!this.ready()||!r.supported;
    $('record-stop').disabled=!busy||r.state==='stopping';
    for(const id of ['record-duration','record-mic','record-quality'])$(id).disabled=busy;
    $('record-open').disabled=busy||!r.result;
    $('record-silent').hidden=!(r.state==='error'&&r.canRetrySilent);$('record-silent').disabled=busy||!this.ready();
    $('record-status').dataset.state=r.supported?r.state:'error';
    const text=!r.supported?'このブラウザはCanvas動画録画に対応していません。':r.error||this.error||`${names[r.state]}${r.reason?' / '+r.reason:''}${r.result&&!this.acknowledged?' / 未保存（保存先で確認）':''}`;
    if($('record-status').textContent!==text)$('record-status').textContent=text;
    $('record-status').dataset.error=String(r.state==='error'||!!r.error);
    $('record-elapsed').value=`${(r.elapsedMs/1000).toFixed(1)}秒`;
    if(!r.result&&this.result){this.releasePreview();this.result=null;this.acknowledged=false;}
    if(r.result&&this.result!==r.result){this.result=r.result;this.acknowledged=false;if(!document.hidden&&!this.suspended)this.open();}
    $('record-acknowledge').disabled=this.acknowledged||!r.result;
    $('record-temporary').hidden=!r.result||this.acknowledged;
    this.syncLeaveWarning();
  }
  open() {
    const r=this.recorder.result;if(!r)return;
    this.releasePreview();
    try{this.url=URL.createObjectURL(r.blob);}catch{this.error='動画リンクを作成できませんでした。録画結果は保持しています。「録画結果」から再試行してください。';$('record-status').textContent=this.error;$('record-status').dataset.error='true';return;}
    this.error='';$('record-status').dataset.error=String(!!this.recorder.error);$('record-status').textContent=this.recorder.error||`${names[this.recorder.state]}${!this.acknowledged?' / 未保存（保存先で確認）':''}`;
    $('record-player').src=this.url;
    $('record-download').href=this.url;$('record-download').download=r.filename;
    $('record-result-info').textContent=`${(r.elapsedMs/1000).toFixed(1)}秒 / ${r.width}×${r.height} / ${r.mime.split(';')[0]} / ${(r.blob.size/1024/1024).toFixed(2)} MB / ${r.hasAudio?'マイクON（音声収録は未検証）':'マイクOFF'}`;
    $('record-result-message').textContent=this.recorder.retainedPrevious?'新しい録画は完了しませんでした。以前の動画を保持しています。':r.partial?'録画中にエラーがありました。途中ファイルを保持しました。再生して確認してください。':'';
    $('record-share').disabled=!shareableRecording(r);
    $('record-share-help').textContent=$('record-share').disabled?'この環境はファイル共有非対応です。「動画を保存」を使ってください。':'共有の完了だけでは端末への保存は確認できません。保存先で動画を確認してください。';
    if(!$('record-result').open)$('record-result').showModal();
  }
  releasePreview() {
    $('record-player').pause();$('record-player').removeAttribute('src');$('record-player').load();
    $('record-download').removeAttribute('href');if(this.url)URL.revokeObjectURL(this.url);this.url=null;
  }
}
