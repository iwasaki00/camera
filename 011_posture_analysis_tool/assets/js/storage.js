const KEY="posture-lens-results-v1";
export const getRecords=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch{return[]}};
export const saveRecord=record=>{try{const all=[record,...getRecords()].slice(0,40);localStorage.setItem(KEY,JSON.stringify(all));return all}catch{return null}};
export const deleteRecord=id=>{const all=getRecords().filter(x=>x.id!==id);try{localStorage.setItem(KEY,JSON.stringify(all))}catch{}return all};
