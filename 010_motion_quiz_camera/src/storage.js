import { DB_NAME, DB_VERSION } from "./config.js";

export class MotionStore {
  async open() {
    if(this.db) return this.db;
    this.db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains("works")) request.result.createObjectStore("works",{keyPath:"id"}); };
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
    return this.db;
  }
  async put(work) { const db=await this.open(); return this.request(db.transaction("works","readwrite").objectStore("works").put(work)); }
  async get(id) { const db=await this.open(); return this.request(db.transaction("works").objectStore("works").get(id)); }
  async all() { const db=await this.open(); const items=await this.request(db.transaction("works").objectStore("works").getAll()); return items.sort((a,b)=>b.createdAt-a.createdAt); }
  async delete(id) { const db=await this.open(); return this.request(db.transaction("works","readwrite").objectStore("works").delete(id)); }
  request(request) { return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}); }
}
