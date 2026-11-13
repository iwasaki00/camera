import { LIMITS, imageHeader } from './template-schema.js?v=0.9.0';

export const canvasBlob = (canvas, type = 'image/png', quality) => new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('画像データを作成できませんでした。')),type,quality));
export async function decodeBackground(blob, metadata) {
  if (!(blob instanceof Blob) || blob.size !== metadata.storedSize || blob.size > LIMITS.image) throw new Error('背景画像のファイルサイズが一致しません。');
  const dimensions = imageHeader(new Uint8Array(await blob.arrayBuffer()), metadata.storedMime);
  if (dimensions.width !== metadata.width || dimensions.height !== metadata.height) throw new Error('背景画像の実サイズが設定と一致しません。');
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image(); await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('背景画像をデコードできませんでした。'));image.src=url;});
    if(image.naturalWidth!==metadata.width||image.naturalHeight!==metadata.height)throw new Error('背景画像の向き・サイズが一致しません。');
    const canvas=document.createElement('canvas');canvas.width=metadata.width;canvas.height=metadata.height;
    canvas.getContext('2d').drawImage(image,0,0);return canvas;
  } finally {URL.revokeObjectURL(url);}
}
export async function thumbnail(canvas) {
  const scale=Math.min(1,256/Math.max(canvas.width,canvas.height)),small=document.createElement('canvas');
  small.width=Math.max(1,Math.round(canvas.width*scale));small.height=Math.max(1,Math.round(canvas.height*scale));
  const ctx=small.getContext('2d');ctx.fillStyle='#f1f4ef';ctx.fillRect(0,0,small.width,small.height);ctx.drawImage(canvas,0,0,small.width,small.height);
  return canvasBlob(small,'image/jpeg',.78);
}
