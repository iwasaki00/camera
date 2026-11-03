import { TemplateStore, storageMessage } from './template-store.js?v=0.4.0';
import { validateDocument, newId, validName } from './template-schema.js?v=0.4.0';
import { canvasBlob, thumbnail, decodeBackground } from './template-images.js?v=0.4.0';
import { exportTemplate, importTemplate } from './template-zip.js?v=0.4.0';

const $ = id => document.getElementById(id);
const element = (tag,text,className) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
export class TemplateUI {
  constructor(adapter,store=new TemplateStore()) {
    this.adapter=adapter;this.store=store;this.active=null;this.suggestedName='新しいテンプレート';this.baseline=this.fingerprint();
    this.available=false;this.busy=false;this.urls=[];this.downloadUrl=null;
    $('templates-open').addEventListener('click',()=>{ $('template-manager').showModal();this.run(()=>this.refresh()); });
    $('templates-close').addEventListener('click',()=>$('template-manager').close());
    $('template-retry').addEventListener('click',()=>this.run(async()=>{await this.store.open();this.available=true;await this.refresh();}));
    $('template-save').addEventListener('click',()=>this.nameForm(this.active?'テンプレートを上書き保存':'テンプレートを保存',this.active?.name||this.suggestedName,name=>this.save(name,false)));
    $('template-save-as').addEventListener('click',()=>this.nameForm('別名で保存',this.active?`${this.active.name} コピー`.slice(0,80):this.suggestedName,name=>this.save(name,true)));
    $('template-export').addEventListener('click',()=>this.run(async()=>this.download(await this.capture(this.active?.name||this.suggestedName))));
    $('template-import').addEventListener('change',event=>{
      const file=event.target.files?.[0];if(!file)return;
      this.run(async()=>{
        const record=await importTemplate(file),canvas=await decodeBackground(record.background,record.doc.background);
        if(!await this.confirmDiscard())return;
        await this.adapter.apply(record.doc,canvas);this.active=null;this.suggestedName=record.doc.name;this.baseline=null;this.changed();
        $('template-manager').close();this.adapter.message('ZIPを読み込みました。「保存・読込」から保存すると、このブラウザの一覧に残ります。');
      }).finally(()=>{event.target.value='';});
    });
    $('template-name-form').addEventListener('submit',event=>{event.preventDefault();if(this.busy)return;this.run(async()=>{
      const name=validName($('template-name').value);await this.nameAction(name);$('template-name-dialog').close();
    });});
    $('template-name-cancel').addEventListener('click',()=>$('template-name-dialog').close());
    for(const [id,value]of [['template-confirm-no','no'],['template-confirm-yes','yes']])$(id).addEventListener('click',()=>$('template-confirm').close(value));
    this.init();this.changed();
  }
  fingerprint(){const d=this.adapter.read();return JSON.stringify({image:d.revision,parts:d.parts,mirror:d.mirror,trackingEnabled:d.trackingEnabled});}
  get dirty(){return this.baseline!==this.fingerprint();}
  changed(){
    $('templates-open').textContent=this.dirty?'保存・読込 ●':'保存・読込';
    $('templates-open').setAttribute('aria-label',this.dirty?'保存・読込。未保存の変更があります':'保存・読込');
    $('template-current').textContent=`${this.active?.name||this.suggestedName}${this.dirty?' / 未保存の変更あり':''}`;
    const image=!!this.adapter.read().canvas;
    for(const id of ['template-save','template-save-as'])$(id).disabled=this.busy||!this.available||!image;
    $('template-export').disabled=this.busy||!image;
    $('template-import').disabled=this.busy;
    $('template-name-submit').disabled=this.busy;$('template-name-cancel').disabled=this.busy;
    $('templates-close').disabled=this.busy;$('template-retry').disabled=this.busy;
    $('template-manager').setAttribute('aria-busy',String(this.busy));
    $('template-message').dataset.storageAvailable=String(this.available);
  }
  async init(){try{await this.store.open();this.available=true;$('template-storage').textContent='この端末のブラウザ内に保存します。カメラ映像は保存しません。';}catch(error){this.available=false;$('template-storage').textContent=storageMessage(error);}this.changed();}
  async run(task){if(this.busy)return;this.busy=true;this.changed();$('template-name-error').textContent='';
    try{return await task();}catch(error){
      const text=['QuotaExceededError','SecurityError','InvalidStateError'].includes(error?.name)?storageMessage(error):(error?.message||'処理を完了できませんでした。');
      $('template-message').textContent=text;$('template-message').dataset.error='true';if($('template-name-dialog').open)$('template-name-error').textContent=text;
    }finally{this.busy=false;this.changed();}
  }
  nameForm(title,value,action){if(this.busy)return;this.nameAction=action;$('template-name-title').textContent=title;$('template-name').value=value;$('template-name-error').textContent='';$('template-name-dialog').showModal();$('template-name').focus();}
  confirm(text){return new Promise(resolve=>{const dialog=$('template-confirm');$('template-confirm-text').textContent=text;dialog.returnValue='';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='yes'),{once:true});dialog.showModal();});}
  async confirmDiscard(){return !this.dirty||await this.confirm('未保存の変更があります。変更を破棄して読み込みますか？');}
  async capture(name,asNew=false){
    const draft=this.adapter.read();if(!draft.canvas)throw new Error('背景画像を読み込んでください。');
    const parts=structuredClone(draft.parts),mirror=draft.mirror,trackingEnabled=draft.trackingEnabled,metadata={...draft.metadata};
    const background=await canvasBlob(draft.canvas),thumb=await thumbnail(draft.canvas);
    const now=new Date(Math.max(Date.now(),this.active?Date.parse(this.active.updatedAt)+1:0)).toISOString();
    const doc=validateDocument({schemaVersion:2,id:!asNew&&this.active?this.active.id:newId(),name,createdAt:!asNew&&this.active?this.active.createdAt:now,updatedAt:now,
      background:{path:'background.png',name:metadata.name||'background.png',mime:metadata.mime||'',size:metadata.size||0,storedMime:'image/png',storedSize:background.size,width:draft.canvas.width,height:draft.canvas.height},parts,mirror,trackingEnabled});
    return {doc,background,thumbnail:thumb};
  }
  async save(name,asNew){const fingerprint=this.fingerprint(),record=await this.capture(name,asNew);await this.store.put(record);this.active=record.doc;this.suggestedName=name;this.baseline=fingerprint;await this.refresh();this.notify('テンプレートを保存しました。');}
  notify(text){$('template-message').textContent=text;$('template-message').dataset.error='false';this.changed();}
  async refresh(){
    if(!this.available){$('template-storage').textContent='ブラウザ内保存は利用できません。ZIP出力・ZIP読込は利用できます。';return;}
    const rows=await this.store.list();for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];
    const list=$('template-list');list.replaceChildren();
    const bytes=rows.reduce((sum,row)=>sum+(row.bytes||0),0);
    $('template-usage').textContent=`${rows.length}件 / 概算 ${(bytes/1024/1024).toFixed(2)} MB`;
    if(!rows.length)list.append(element('p','保存済みテンプレートはありません。','help'));
    for(const row of rows){
      const doc=row.doc,card=element('article',undefined,'template-card');card.dataset.templateId=doc.id;
      const image=element('img');image.alt=`${doc.name}の背景画像`;image.loading='lazy';image.width=96;image.height=80;
      const url=URL.createObjectURL(row.thumbnail);this.urls.push(url);image.src=url;
      const info=element('div',undefined,'template-card-info');info.append(element('strong',doc.name),element('p',`${new Date(doc.updatedAt).toLocaleString('ja-JP')} / 有効${doc.parts.filter(p=>p.enabled).length}パーツ`,'help'));
      const button=(label,action,fn)=>{const b=element('button',label);b.type='button';b.dataset.action=action;b.addEventListener('click',fn);return b;};
      const load=button('読込','load',()=>this.run(async()=>{
        if(!await this.confirmDiscard())return;
        const record=await this.store.get(doc.id);if(!record)throw new Error('テンプレートが見つかりません。');
        const valid=validateDocument(record.doc),canvas=await decodeBackground(record.background,valid.background);
        await this.adapter.apply(valid,canvas);this.active=valid;this.suggestedName=valid.name;this.baseline=this.fingerprint();this.changed();$('template-manager').close();this.adapter.message(`「${valid.name}」を読み込みました。カメラは「カメラ開始」で起動してください。`);
      }));
      const more=element('details',undefined,'template-card-menu');more.append(element('summary','その他'));
      const actions=element('div',undefined,'template-card-actions');
      actions.append(
        button('名前変更','rename',()=>this.nameForm('名前変更',doc.name,async name=>{const r=await this.store.rename(doc.id,name);if(this.active?.id===doc.id)this.active=r.doc;await this.refresh();this.notify('名前を変更しました。');})),
        button('複製','duplicate',()=>this.run(async()=>{await this.store.duplicate(doc.id);await this.refresh();this.notify('複製しました。');})),
        button('削除','delete',()=>this.run(async()=>{if(!await this.confirm(`「${doc.name}」を削除しますか？`))return;await this.store.remove(doc.id);if(this.active?.id===doc.id){this.active=null;this.baseline=null;}await this.refresh();this.notify('削除しました。');})),
        button('ZIP出力','export',()=>this.run(async()=>{const record=await this.store.get(doc.id);if(!record)throw new Error('テンプレートが見つかりません。');await this.download(record);})));
      more.append(actions);card.append(image,info,load,more);list.append(card);
    }
  }
  async download(record){const blob=await exportTemplate(record);if(this.downloadUrl)URL.revokeObjectURL(this.downloadUrl);this.downloadUrl=URL.createObjectURL(blob);
    const link=$('template-download');link.href=this.downloadUrl;link.download=`${record.doc.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}.zip`;link.hidden=false;link.textContent='ZIPを保存（ダウンロードできない場合はここをタップ）';link.click();this.notify('背景画像と設定のZIPを作成しました。');}
}
