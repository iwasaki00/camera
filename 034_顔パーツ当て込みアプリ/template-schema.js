import { DEFAULT_CORRECTION } from './tracking-geometry.js?v=0.6.2';
import { DEFAULT_COMPOSITE, defaultAppearance, validateAppearance, validateComposite } from './composite-color.js?v=0.6.2';
export const SCHEMA_VERSION = 3;
export const LIMITS = Object.freeze({ zip: 25 * 1024 * 1024, image: 20 * 1024 * 1024, json: 128 * 1024, thumbnail: 256 * 1024, edge: 2048, entries: 32 });
export const newId = () => globalThis.crypto?.randomUUID?.() || `template-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const string = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const date = v => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
export function validName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) fail('名前は1〜80文字で入力してください。');
  return value.trim();
}

// Copy an explicit allowlist. No streams, camera canvases, image frames or view state can enter a document.
export function validateDocument(input) {
  if (!object(input) || ![1, 2, SCHEMA_VERSION].includes(input.schemaVersion)) fail('対応していないテンプレート形式・スキーマバージョンです。');
  const legacy=input.schemaVersion===1;
  if(!legacy && typeof input.trackingEnabled!=='boolean')fail('自動追従の設定が不正です。');
  if (!string(input.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(input.id) || !date(input.createdAt) || !date(input.updatedAt) || input.updatedAt < input.createdAt) fail('テンプレートIDまたは日時が不正です。');
  const b = input.background;
  if (!object(b) || !['background.png', 'background.jpg', 'background.jpeg'].includes(b.path) || !string(b.name, 255)
    || typeof b.mime !== 'string' || b.mime.length > 100 || (b.mime && !/^image\/[a-zA-Z0-9.+-]+$/.test(b.mime))
    || !Number.isInteger(b.size) || !number(b.size, 0, 1024 * 1024 * 1024)
    || !['image/png', 'image/jpeg'].includes(b.storedMime) || (b.path.endsWith('.png') ? b.storedMime !== 'image/png' : b.storedMime !== 'image/jpeg')
    || !Number.isInteger(b.storedSize) || !number(b.storedSize, 1, LIMITS.image)
    || !Number.isInteger(b.width) || !number(b.width, 1, LIMITS.edge) || !Number.isInteger(b.height) || !number(b.height, 1, LIMITS.edge)) fail('背景画像の情報が不正です。');
  if (typeof input.mirror !== 'boolean' || !Array.isArray(input.parts) || input.parts.length > 4) fail('パーツまたは左右反転の情報が不正です。');
  const seen = new Set(), ids = new Set(), layers = new Set();
  const parts = input.parts.map(p => {
    if (!object(p) || !['mouth','leftEye','rightEye','nose'].includes(p.partType) || !string(p.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(p.id)
      || seen.has(p.partType) || ids.has(p.id) || typeof p.enabled !== 'boolean') fail('パーツ種類・ID・有効状態が不正、または重複しています。');
    seen.add(p.partType); ids.add(p.id);
    const t = p.targetRect, s = p.sourceRect;
    if (!object(t) || !number(t.x, 0, 100) || !number(t.y, 0, 100) || !number(t.width, 1, 100) || !number(t.height, 1, 100)
      || !object(s) || !number(s.x, 0, 1) || !number(s.y, 0, 1) || !number(s.zoom, 1, 6)
      || !number(p.rotation, -180, 180) || !number(p.feather, 0, 100) || !['oval','rectangle'].includes(p.shape)
      || !Number.isInteger(p.zIndex) || !number(p.zIndex, 0, 1000000) || layers.has(p.zIndex)) fail('パーツの座標・サイズ・回転・ぼかし・重なり順が不正です。');
    layers.add(p.zIndex);
    const guides = p.guides ?? { photo: true, camera: true };
    if (!object(guides) || typeof guides.photo !== 'boolean' || typeof guides.camera !== 'boolean') fail('枠表示の情報が不正です。');
    const tracking=legacy?DEFAULT_CORRECTION:p.tracking;
    if(!object(tracking) || !number(tracking.offsetX,-1.5,1.5) || !number(tracking.offsetY,-1.5,1.5)
      || !number(tracking.widthScale,.5,3) || !number(tracking.heightScale,.5,3) || !number(tracking.rotation,-90,90))fail('自動追従の補正値が不正です。');
    return { id: p.id, partType: p.partType, enabled: p.enabled, targetRect: { x:t.x, y:t.y, width:t.width, height:t.height },
      sourceRect: { x:s.x, y:s.y, zoom:s.zoom }, rotation:p.rotation, shape:p.shape, feather:p.feather, zIndex:p.zIndex,
      guides: { photo:guides.photo, camera:guides.camera }, tracking: {offsetX:tracking.offsetX,offsetY:tracking.offsetY,widthScale:tracking.widthScale,heightScale:tracking.heightScale,rotation:tracking.rotation},
      appearance: input.schemaVersion < 3 ? defaultAppearance() : validateAppearance(p.appearance) };
  });
  return { schemaVersion: SCHEMA_VERSION, appVersion: '0.6.2', id:input.id, name:validName(input.name), createdAt:input.createdAt, updatedAt:input.updatedAt,
    background: { path:b.path, name:b.name, mime:b.mime, size:b.size, storedMime:b.storedMime, storedSize:b.storedSize, width:b.width, height:b.height }, parts, mirror:input.mirror, trackingEnabled:legacy?false:input.trackingEnabled,
    composite: input.schemaVersion < 3 ? {...DEFAULT_COMPOSITE} : validateComposite(input.composite) };
}

export const documentBytes = doc => new TextEncoder().encode(JSON.stringify(doc)).length;
export function imageHeader(bytes, mime) {
  const u = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height;
  if (mime === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) || u.getUint32(8)!==13 || u.getUint32(12)!==0x49484452) fail('PNG画像の実データが不正です。');
    width=u.getUint32(16); height=u.getUint32(20);
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0]!==255 || bytes[1]!==216) fail('JPEG画像の実データが不正です。');
    let p=2;
    while(p+4<=bytes.length) {
      if(bytes[p++]!==255) fail('JPEG画像が不正です。');
      while(bytes[p]===255)p++;
      const marker=bytes[p++]; if(marker===0xda||marker===0xd9)break;
      const size=u.getUint16(p);if(size<2||p+size>bytes.length)fail('JPEG画像が途切れています。');
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if(size<8)fail('JPEG画像が不正です。');height=u.getUint16(p+3);width=u.getUint16(p+5);break;
      }p+=size;
    }
  } else fail('PNGまたはJPEG形式の背景画像を使用してください。');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.edge||height>LIMITS.edge)fail('背景画像のサイズ上限は長辺2048pxです。');
  return {width,height};
}
