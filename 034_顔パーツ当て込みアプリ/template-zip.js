// fflate 0.8.2 / MIT; bundled locally, no network or filesystem extraction.
import { zipSync, strToU8, Inflate } from './vendor/fflate-0.8.2.js';
import { LIMITS, validateDocument, imageHeader } from './template-schema.js?v=0.6.2';
const invalid = () => {throw new Error('ZIPファイルが不正、破損、または未対応の形式です。');};
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(data){let crc=0xffffffff;for(const value of data)crc=crcTable[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function entries(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.length;
  if(n<22||n>LIMITS.zip)invalid();
  let end=-1;for(let p=n-22;p>=Math.max(0,n-65557);p--)if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===n){end=p;break;}
  if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))invalid();
  const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
  if(count<2||count>LIMITS.entries||view.getUint16(end+8,true)!==count||start+length!==end)invalid();
  const result=new Map();let p=start;
  for(let i=0;i<count;i++){
    if(p+46>end||view.getUint32(p,true)!==0x02014b50)invalid();
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true),packed=view.getUint32(p+20,true),size=view.getUint32(p+24,true);
    const nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),offset=view.getUint32(p+42,true);
    if(p+46+nameLength+extra+comment>end||view.getUint16(p+34,true)!==0||[packed,size,offset].includes(0xffffffff))invalid();
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p+46,p+46+nameLength));
    if(result.has(name))invalid();
    result.set(name,{flags,method,crc,packed,size,offset});p+=46+nameLength+extra+comment;
  }
  if(p!==end)invalid();
  return {result,view,start};
}
async function extract(bytes,index,name,max) {
  const entry=index.result.get(name);if(!entry||entry.size<1||entry.size>max||entry.packed>LIMITS.zip||(entry.flags&1)||![0,8].includes(entry.method))invalid();
  const {view,start}=index,o=entry.offset;
  if(o+30>start||view.getUint32(o,true)!==0x04034b50||view.getUint16(o+8,true)!==entry.method||view.getUint16(o+6,true)!==entry.flags)invalid();
  const nl=view.getUint16(o+26,true),el=view.getUint16(o+28,true),dataStart=o+30+nl+el;
  if(dataStart+entry.packed>start||new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(o+30,o+30+nl))!==name)invalid();
  const input=bytes.subarray(dataStart,dataStart+entry.packed);let output;
  if(entry.method===0){if(input.length!==entry.size)invalid();output=input.slice();}
  else {
    // Small compressed chunks bound worst-case expansion before each size check.
    output=new Uint8Array(entry.size);let written=0;
    const inflater=new Inflate(chunk=>{if(written+chunk.length>entry.size)invalid();output.set(chunk,written);written+=chunk.length;});
    for(let p=0;p<input.length;p+=256){inflater.push(input.subarray(p,p+256),p+256>=input.length);if(p%16384===0)await new Promise(r=>setTimeout(r,0));}
    if(written!==entry.size)invalid();
  }
  if(crc32(output)!==entry.crc)invalid();return output;
}
export async function exportTemplate(record) {
  const doc=validateDocument(record.doc),background=new Uint8Array(await record.background.arrayBuffer()),json=strToU8(JSON.stringify(doc,null,2));
  if(json.length>LIMITS.json||background.length!==doc.background.storedSize)invalid();
  const dimensions=imageHeader(background,doc.background.storedMime);if(dimensions.width!==doc.background.width||dimensions.height!==doc.background.height)invalid();
  return new Blob([zipSync({'template.json':json,[doc.background.path]:background},{level:0})],{type:'application/zip'});
}
export async function importTemplate(file) {
  try {
    if(!(file instanceof Blob)||file.size>LIMITS.zip)throw new Error('ZIPファイルの上限は25MBです。');
    const bytes=new Uint8Array(await file.arrayBuffer()),index=entries(bytes);
    const json=await extract(bytes,index,'template.json',LIMITS.json);
    let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(json));}catch{throw new Error('template.jsonが不正です。');}
    const doc=validateDocument(input),image=await extract(bytes,index,doc.background.path,LIMITS.image);
    if(image.length!==doc.background.storedSize)invalid();
    const dimensions=imageHeader(image,doc.background.storedMime);
    if(dimensions.width!==doc.background.width||dimensions.height!==doc.background.height)invalid();
    return {doc,background:new Blob([image],{type:doc.background.storedMime})};
  } catch(error) {if(error instanceof RangeError||error instanceof TypeError)throw new Error('ZIP・JSON・画像データを読み込めませんでした。');throw error;}
}
