import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart } from '../parts.js';
import { validateDocument, imageHeader, LIMITS } from '../template-schema.js';
import { cleanRecord, TemplateStore, storageMessage } from '../template-store.js';
import { exportTemplate, importTemplate, crc32 } from '../template-zip.js';
import { zipSync, strToU8 } from '../vendor/fflate-0.8.2.js';

const image = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
const doc = () => ({schemaVersion:1,id:'fixture',name:'四つのパーツ',createdAt:'2026-11-03T00:00:00.000Z',updatedAt:'2026-11-03T00:00:00.000Z',
  background:{path:'background.png',name:'original.heic',mime:'image/heic',size:1234,storedMime:'image/png',storedSize:image.length,width:1,height:1},
  parts:['mouth','leftEye','rightEye','nose'].map((type,i)=>({...createPart(type,i),enabled:i!==2,rotation:i*15,feather:i*12,targetRect:{x:20+i*15,y:30+i*10,width:15+i,height:9+i}})),mirror:false});
const record = () => ({doc:doc(),background:new Blob([image],{type:'image/png'}),thumbnail:new Blob([image],{type:'image/png'})});
const zip = (document=doc(),background=image,extra={},options={level:0}) => new Blob([zipSync({'template.json':strToU8(typeof document==='string'?document:JSON.stringify(document)),'background.png':background,...extra},options)]);

test('schema preserves all four independent settings, enable states, order and mirror',()=>{
  const input=doc(),result=validateDocument(input);assert.deepEqual(result.parts,input.parts);assert.equal(result.mirror,false);
  result.parts[0].targetRect.x=90;assert.equal(input.parts[0].targetRect.x,20);
});
test('deleted parts and empty collection remain absent',()=>{
  const input=doc();input.parts.splice(1,1);assert.equal(validateDocument(input).parts.length,3);
  input.parts=[];assert.deepEqual(validateDocument(input).parts,[]);
});
test('explicit allowlist excludes camera frames, streams, view and unknown properties',()=>{
  const input=doc();input.camera='private';input.view={scale:4};input.parts[0].frame='private';input.background.face='private';
  const r=cleanRecord({...record(),doc:input,video:'private'});
  assert.equal(JSON.stringify(r.doc).includes('private'),false);assert.deepEqual(Object.keys(r).sort(),['background','bytes','doc','thumbnail']);
  assert.ok(r.bytes>image.length*2);
});
const invalidCases=[
  ['unsupported schema',d=>d.schemaVersion=2],['missing image',d=>delete d.background],['invalid type',d=>d.parts[0].partType='ear'],
  ['duplicate type',d=>d.parts[1].partType='mouth'],['duplicate id',d=>d.parts[1].id='mouth'],['duplicate layer',d=>d.parts[1].zIndex=0],
  ['invalid name',d=>d.name='  '],['invalid timestamp',d=>d.updatedAt='yesterday'],['invalid mirror',d=>d.mirror=1],
  ['negative coordinate',d=>d.parts[0].targetRect.x=-1],['zero size',d=>d.parts[0].targetRect.width=0],['non-finite size',d=>d.parts[0].targetRect.height=NaN],
  ['invalid source',d=>d.parts[0].sourceRect.x=1.1],['invalid crop size',d=>d.parts[0].sourceRect.zoom=0],['invalid rotation',d=>d.parts[0].rotation=181],
  ['invalid feather',d=>d.parts[0].feather=101],['invalid shape',d=>d.parts[0].shape='triangle'],['unsafe image path',d=>d.background.path='../background.png'],
  ['image mime mismatch',d=>d.background.storedMime='image/jpeg'],['oversize dimensions',d=>d.background.width=2049]
];
for(const [label,change]of invalidCases)test(`schema rejects ${label}`,()=>{const d=doc();change(d);assert.throws(()=>validateDocument(d));});
test('ZIP roundtrip retains image bytes and every part setting',async()=>{
  const r=record(),output=await exportTemplate(r),restored=await importTemplate(output);
  assert.equal(output.type,'application/zip');assert.deepEqual(restored.doc,validateDocument(r.doc));assert.deepEqual(new Uint8Array(await restored.background.arrayBuffer()),image);
});
test('deflated ZIP imports; unrelated files are not extracted or executed',async()=>{
  const output=zip(doc(),image,{'../unwanted.js':strToU8('throw new Error("never execute")')},{level:6});
  assert.equal((await importTemplate(output)).doc.id,'fixture');
});
test('invalid JSON is rejected',async()=>{await assert.rejects(importTemplate(zip('{broken')));});
test('invalid schema is rejected during ZIP import',async()=>{const d=doc();d.schemaVersion=100;await assert.rejects(importTemplate(zip(d)));});
test('invalid ZIP, truncated ZIP and missing files are rejected',async()=>{
  await assert.rejects(importTemplate(new Blob(['not zip'])));
  const bytes=new Uint8Array(await zip().arrayBuffer());await assert.rejects(importTemplate(new Blob([bytes.subarray(0,bytes.length-10)])));
  await assert.rejects(importTemplate(new Blob([zipSync({'template.json':strToU8(JSON.stringify(doc()))})])));
});
test('invalid image signature and dimensions are rejected',async()=>{
  await assert.rejects(importTemplate(zip(doc(),new Uint8Array(image.length))));
  const d=doc();d.background.width=2;await assert.rejects(importTemplate(zip(d)));
  assert.throws(()=>imageHeader(image,'image/jpeg'));
});
test('CRC corruption is rejected',async()=>{
  const bytes=new Uint8Array(await zip().arrayBuffer());bytes[45]^=1;await assert.rejects(importTemplate(new Blob([bytes])));
  assert.equal(crc32(strToU8('123456789')),0xcbf43926);
});
test('ZIP size limit and excessive declared expansion are rejected',async()=>{
  await assert.rejects(importTemplate(new Blob([new Uint8Array(LIMITS.zip+1)])));
  const bytes=new Uint8Array(await zip().arrayBuffer()),v=new DataView(bytes.buffer);
  for(let p=0;p<bytes.length-46;p++)if(v.getUint32(p,true)===0x02014b50){v.setUint32(p+24,LIMITS.json+1,true);break;}
  await assert.rejects(importTemplate(new Blob([bytes])));
});
test('deflate expansion beyond declared size is rejected',async()=>{
  const bytes=new Uint8Array(await zip(doc(),image,{}, {level:6}).arrayBuffer()),v=new DataView(bytes.buffer);
  for(let p=0;p<bytes.length-46;p++)if(v.getUint32(p,true)===0x02014b50){v.setUint32(p+24,10,true);break;}
  await assert.rejects(importTemplate(new Blob([bytes])));
});
test('IndexedDB unavailable is explicit and quota errors describe atomic failure',async()=>{
  await assert.rejects(new TemplateStore(null).open());
  assert.match(storageMessage({name:'QuotaExceededError'}),/既存データは変更されていません/);
  assert.match(storageMessage({name:'SecurityError'}),/ZIP出力/);
});
test('record rejects missing thumbnails and incorrect image byte size',()=>{
  assert.throws(()=>cleanRecord({...record(),thumbnail:null}));
  assert.throws(()=>cleanRecord({...record(),background:new Blob(['wrong'])}));
});
