import { validateDocument, newId, validName, documentBytes, LIMITS } from './template-schema.js?v=0.8.0';
export const DATABASE_NAME = 'portrait-face-parts-templates';
export function storageMessage(error) {
  return error?.name==='QuotaExceededError' ? '保存容量が不足しています。保存は完了していません。既存データは変更されていません。'
    : 'ブラウザ内保存を利用できません。サイトの保存設定を確認してください。ZIP出力は利用できます。';
}
export function cleanRecord(record) {
  const doc=validateDocument(record.doc);
  if(!(record.background instanceof Blob)||record.background.size!==doc.background.storedSize||!(record.thumbnail instanceof Blob)
    ||record.thumbnail.size>LIMITS.thumbnail||!['image/jpeg','image/png'].includes(record.thumbnail.type))throw new Error('保存する画像データが不正です。');
  return {doc,background:record.background,thumbnail:record.thumbnail,bytes:documentBytes(doc)+record.background.size+record.thumbnail.size};
}
export class TemplateStore {
  constructor(factory) {
    if(arguments.length)this.factory=factory;
    else {try{this.factory=globalThis.indexedDB;}catch{this.factory=null;}}
    this.db=null;
  }
  async open() {
    if(this.db)return this.db;
    if(!this.factory)throw new Error('IndexedDB unavailable');
    return new Promise((resolve,reject)=>{
      let request,blocked=false;try{request=this.factory.open(DATABASE_NAME,1);}catch(error){reject(error);return;}
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('templates'))request.result.createObjectStore('templates',{keyPath:'doc.id'});};
      request.onerror=()=>reject(request.error);request.onblocked=()=>{blocked=true;reject(new Error('保存データが別のタブで使用中です。ほかのタブを閉じて再試行してください。'));};
      request.onsuccess=()=>{if(blocked){request.result.close();return;}this.db=request.result;this.db.onversionchange=()=>{this.db.close();this.db=null;};resolve(this.db);};
    });
  }
  close(){this.db?.close();this.db=null;}
  async run(mode, operation) {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('templates',mode),store=tx.objectStore('templates');let result,error;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>{};tx.onabort=()=>reject(error||tx.error||new Error('保存処理が中断されました。'));
      const abort=e=>{error=e;try{tx.abort();}catch{reject(e);}};
      try{operation(store,value=>{result=value;},abort);}catch(e){abort(e);}
    });
  }
  get(id){return this.run('readonly',(store,done)=>{const req=store.get(id);req.onsuccess=()=>done(req.result||null);});}
  async list(){return this.run('readonly',(store,done)=>{const req=store.getAll();req.onsuccess=()=>done(req.result.map(r=>({doc:r.doc,thumbnail:r.thumbnail,bytes:r.bytes})).sort((a,b)=>b.doc.updatedAt.localeCompare(a.doc.updatedAt)));});}
  put(record){const value=cleanRecord(record);return this.run('readwrite',(store,done)=>{store.put(value);done(value);});}
  remove(id){return this.run('readwrite',(store,done)=>{store.delete(id);done(true);});}
  change(id,operation){return this.run('readwrite',(store,done,abort)=>{
    const req=store.get(id);req.onsuccess=()=>{try{if(!req.result)throw new Error('テンプレートが見つかりません。');const next=cleanRecord(operation(req.result));store.put(next);done(next);}catch(e){abort(e);}};
  });}
  rename(id,name){const nextName=validName(name);return this.change(id,r=>({...r,doc:{...r.doc,name:nextName,updatedAt:new Date(Math.max(Date.now(),Date.parse(r.doc.updatedAt)+1)).toISOString()}}));}
  duplicate(id){return this.change(id,r=>{const now=new Date().toISOString();return {...r,doc:{...r.doc,id:newId(),name:(r.doc.name+' コピー').slice(0,80),createdAt:now,updatedAt:now}};});}
}
