// Presentation state only. Existing canvases, streams and editor models stay alive.
const $ = id => document.getElementById(id);
const details = (id, title) => {
  const node = document.createElement('details'); node.id = id;
  const summary = document.createElement('summary'); summary.textContent = title;
  node.append(summary); return node;
};
export class ScreenUI {
  constructor({changed}) {
    this.changed = changed; this.screen = 'photo';
    const panel = document.querySelector('.preview-panel'), workspace = document.querySelector('.workspace');
    const photo = workspace.firstElementChild, camera = document.querySelector('.camera-panel');
    workspace.append($('record-countdown-overlay'));
    // Keep the media decoder outside inactive/inert tab panels. Only its canvas preview switches.
    panel.append($('camera'));
    photo.id = 'photo-panel'; camera.id = 'camera-panel';
    this.panels = {photo, camera};
    const tabs = document.createElement('div'); tabs.className = 'screen-tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','プレビュー画面');
    for (const [id,label] of [['photo','絵画'],['camera','カメラ'],['finished','完成']]) {
      const button = document.createElement('button'); button.id = `screen-${id}`; button.type = 'button'; button.textContent = label;
      button.setAttribute('role','tab'); button.setAttribute('aria-controls',id==='camera'?'camera-panel':'photo-panel');
      button.dataset.recordingSafe = '';
      button.addEventListener('click',()=>this.select(id));
      button.addEventListener('keydown',event=>{
        const ids=['photo','camera','finished'];let next;
        if(event.key==='ArrowRight')next=(ids.indexOf(this.screen)+1)%3;
        if(event.key==='ArrowLeft')next=(ids.indexOf(this.screen)+2)%3;
        if(event.key==='Home')next=0;if(event.key==='End')next=2;
        if(next!==undefined){event.preventDefault();this.select(ids[next]);$(`screen-${ids[next]}`).focus({preventScroll:true});}
      });
      tabs.append(button);
    }
    const navigation=document.createElement('div');navigation.className='screen-navigation';
    const finishedMode=document.createElement('div');finishedMode.id='finished-mode-host';finishedMode.hidden=true;
    this.modeSlot=document.createComment('composite mode in quality settings');
    $('composite-mode').before(this.modeSlot);
    for(const option of $('composite-mode').options)option.textContent=option.value.toUpperCase();
    navigation.append(tabs,$('interaction-mode'),finishedMode);panel.prepend(navigation);
    this.settings = details('settings-panel','調整パネル');
    this.settings.firstElementChild.tabIndex=-1;
    const body = document.createElement('div'); body.className = 'settings-body'; this.settings.append(body); panel.append(this.settings);
    const parts = details('settings-parts','A. パーツ・ぼかし');
    body.append(parts);
    const partActions = document.createElement('div'); partActions.className = 'part-management';
    partActions.append($('part-management'));
    parts.append(partActions,document.querySelector('.quick-controls'));
    const advanced = $('advanced'), layer = document.querySelector('.layer-controls');
    parts.append(layer,advanced);
    const cameraSettings = details('settings-camera','B. カメラ・切り抜き');
    body.append(cameraSettings);
    cameraSettings.append(camera.querySelector('.panel-heading'));
    const source = details('source-settings','カメラ切り抜き / 数値');
    source.append($('source-zoom').previousElementSibling,$('source-zoom'),$('source-controls'),$('source-aspect-control'));
    cameraSettings.append(source);
    const quality = details('settings-quality','C. 色調・質感');
    body.append(quality);
    quality.append(document.querySelector('.composite-bar'),$('composite-compare-state'),$('composite-settings'));
    const record = details('settings-recording','D. 録画設定');
    body.append(record);
    const oldOptions = $('recording-panel').querySelector('details');
    record.append(oldOptions.querySelector('.record-options')); oldOptions.remove();
    const more = details('settings-more','E. 詳細・診断・ヘルプ');
    body.append(more);
    more.append($('diagnostics'),$('image-picker-help'));
    body.append(parts,cameraSettings,quality,record,more);
    const exportPreview=details('png-preview','PNG保存用の画像を表示');
    exportPreview.append(...$('export-result').childNodes);$('export-result').append(exportPreview);
    this.settings.addEventListener('toggle',()=>{
      $('settings-toggle').setAttribute('aria-expanded',String(this.settings.open));
      this.refresh();
    });
    const bar = document.createElement('div'); bar.id='basic-bar';bar.setAttribute('aria-label','基本操作');
    const actions=document.querySelector('.actions');
    const toggle=document.createElement('button');toggle.id='settings-toggle';toggle.type='button';toggle.textContent='調整';
    toggle.dataset.recordingSafe='';toggle.setAttribute('aria-controls','settings-panel');toggle.setAttribute('aria-expanded','false');
    toggle.addEventListener('click',()=>{this.settings.open=!this.settings.open;});
    actions.append(toggle);bar.append(actions,$('recording-panel'));
    panel.append(this.settings,$('status'),$('export-result'),bar);
    for(const id of ['photo','camera']){
      $(`${id}-view-reset`).textContent='全体';
      const focus=document.createElement('button');focus.id=`${id}-view-focus`;focus.type='button';focus.textContent='寄る';
      focus.setAttribute('aria-label',`${id==='photo'?'絵画':'カメラ'}の選択パーツを中心に拡大`);focus.setAttribute('aria-pressed','false');
      $(`${id}-view-reset`).after(focus);
    }
    $('record-start').textContent='● 録画開始';$('record-open').textContent='結果・保存';
    this.status=document.createElement('div');this.status.id='screen-state';this.status.setAttribute('aria-label','現在の状態');
    panel.insertBefore(this.status,workspace);
    this.observer=new MutationObserver(()=>this.sync());
    for(const id of ['camera-state','record-status','selected-part-name','composite-mode'])
      this.observer.observe($(id),{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-state']});
    $('composite-mode').addEventListener('change',()=>this.sync());
    this.select('photo',false);
  }
  select(screen,notify=true) {
    if(!['photo','camera','finished'].includes(screen))return;
    this.screen=screen;document.querySelector('.preview-panel').dataset.screen=screen;
    const finished=screen==='finished';
    $('finished-mode-host').hidden=!finished;
    if(finished)$('finished-mode-host').append($('composite-mode'));
    else this.modeSlot.after($('composite-mode'));
    $('preview-title').firstChild.textContent=screen==='camera'?'カメラ側 / ':screen==='finished'?'完成 / ':'絵画側 / ';
    for(const id of ['photo','camera','finished']){
      const tab=$(`screen-${id}`),active=id===screen;
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    }
    for(const [id,node] of Object.entries(this.panels)){
      const active=id===(screen==='camera'?'camera':'photo');
      node.dataset.active=String(active);node.inert=!active;node.setAttribute('aria-hidden',String(!active));
      node.setAttribute('role','tabpanel');node.setAttribute('aria-labelledby',`screen-${screen==='finished'&&id==='photo'?'finished':id}`);
    }
    this.sync();if(notify)this.changed();
  }
  refresh(){requestAnimationFrame(()=>this.changed());}
  sync() {
    const running=$('camera-state').textContent==='使用中', connecting=$('camera-state').textContent==='接続中';
    $('start').hidden=running||connecting;$('stop').hidden=!running&&!connecting;
    const busy=['initializing','countdown','recording','stopping'].includes($('record-status').dataset.state);
    $('record-start').hidden=busy;$('record-stop').hidden=!busy;
    // Keep "record result" discoverable after closing the result dialog.
    $('record-open').hidden=$('record-open').disabled;
    const hasResult=!$('record-open').disabled;
    $('recording-panel').dataset.hasResult=String(hasResult);
    const unsaved=hasResult&&!$('record-temporary').hidden;
    $('recording-panel').dataset.unsaved=String(unsaved);
    $('record-start').textContent=hasResult?'録り直す':'● 録画開始';
    $('record-start').setAttribute('aria-label',hasResult?'録り直す':'録画開始');
    $('record-start').classList.toggle('primary',!hasResult);
    $('record-open').classList.toggle('primary',hasResult);
    const text=[connecting?'カメラ接続中':running?'カメラ使用中':'カメラ停止中',
      $('selected-part-name').textContent,$('composite-mode').value.toUpperCase()];
    if(busy||$('record-status').textContent.includes('未保存'))text.push($('record-status').textContent);
    const label=text.join(' · ');if(this.status.textContent!==label)this.status.textContent=label;this.status.title=label;
    this.status.dataset.recording=String(busy);
    this.status.dataset.error=String($('record-status').dataset.error==='true');
    this.status.dataset.warning=String($('record-status').textContent.includes('未保存'));
  }
}
