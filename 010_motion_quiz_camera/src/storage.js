import { DB_NAME, DB_VERSION } from "./config.js";

export class MotionStore {
  async open() {
    if(this.db) return this.db;
    this.db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains("works")) request.result.createObjectStore("works",{keyPath:"id"}); };
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.db=null;};resolve(db);}; request.onerror=()=>reject(request.error);
    });
    return this.db;
  }
  async put(work) { const db=await this.open(); return this.write(db, store=>store.put(work)); }
  async get(id) { const db=await this.open(); return this.request(db.transaction("works").objectStore("works").get(id)); }
  async all() { const db=await this.open(); const items=await this.request(db.transaction("works").objectStore("works").getAll()); return items.sort((a,b)=>b.createdAt-a.createdAt); }
  async delete(id) { const db=await this.open(); return this.write(db, store=>store.delete(id)); }
  write(db, action) { return new Promise((resolve,reject)=>{const tx=db.transaction("works","readwrite");tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error("端末への保存を完了できませんでした。"));action(tx.objectStore("works"));}); }
  request(request) { return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}); }
}
