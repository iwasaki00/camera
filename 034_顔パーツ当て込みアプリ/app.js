import {CustomShapeEditor} from './custom-shape-editor.js?v=0.9.1';
import {boundedRect,validateCustomMask} from './custom-mask.js?v=0.9.1';
import { Camera } from './camera.js?v=0.9.1';
import { CompositeRenderer, sourceRect } from './renderer.js?v=0.9.1';
import { TouchEditor, sourceFromBox } from './editor.js?v=0.9.1';
import { Viewport, toScreen } from './viewport.js?v=0.9.1';
import { Magnifier } from './magnifier.js?v=0.9.1';
import { PartCollection, MAX_PARTS, sourceForDisplay, setDisplaySource } from './parts.js?v=0.9.1';
import { TemplateUI } from './template-ui.js?v=0.9.1';
import { Diagnostics, DiagnosticPanel } from './diagnostics.js?v=0.9.1';
import { DEFAULT_COMPOSITE } from './composite-color.js?v=0.9.1';
import { CompositeUI } from './composite-ui.js?v=0.9.1';
import { VideoRecording } from './recording.js?v=0.9.1';
import { RecordingUI } from './recording-ui.js?v=0.9.1';
import { ScreenUI } from './screen-ui.js?v=0.9.1';

const $ = id => document.getElementById(id);
const canvas = $('composition'), ctx = canvas.getContext('2d');
const video = $('camera'), camera = new Camera(video), renderer = new CompositeRenderer();
const collection = new PartCollection();
const state = { image: null, imageMetadata: null, backgroundRevision: 0, running: false, mirror: true, mode: 'edit',
  parts: collection.parts, composite: {...DEFAULT_COMPOSITE} };
let comparing = false, compositeUI;
let recording, recordingUI;
const selected = () => collection.selected;
const selectedSource = () => selected() ? sourceForDisplay(selected(), state.mirror) : { x: .5, y: .5, zoom: 1.5 };
const setSource = source => { if (selected()) setDisplaySource(selected(), source, state.mirror); };
const readValue = key => selected() ? (selected().targetRect[key] ?? selected()[key]) : 0;
function writeValue(key, value) {
  const part = selected(); if (!part) return;
  if (Object.prototype.hasOwnProperty.call(part.targetRect, key)) part.targetRect[key] = value; else part[key] = value;
}
let frame = 0, imageGeneration = 0, exportUrl = null, lastDraw = -Infinity;
let photoEditor, cameraEditor, customEditor;
let photoMagnifier, cameraMagnifier;
let templates;
const screens = new ScreenUI({changed:()=>{cancelEditors();photoMagnifier?.cancelDrag();cameraMagnifier?.cancelDrag();customEditor?.sync();render();}});
const photoView = new Viewport(canvas, { min: .5, changed: () => { syncViewControls(); render(); } });
const cameraView = new Viewport($('camera-preview'), { changed: () => { syncViewControls(); render(); } });
const controls = [];
const message = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };
const diagnostics = new Diagnostics();
const diagnosticPanel = new DiagnosticPanel({details:$('diagnostics'),output:$('diagnostic-values'),copy:$('diagnostic-copy'),fallback:$('diagnostic-text'),status:$('diagnostic-copy-status'),metrics:diagnostics,
  sample:()=>diagnostics.snapshot(performance.now(),{videoWidth:video.videoWidth,videoHeight:video.videoHeight,parts:state.parts.length,
    recordingState:recording?.state,recordingAverageMs:recording?.metrics.averageMs,recordingMaxMs:recording?.metrics.maxMs,
    recordingFrames:recording?.metrics.frames,recordingElapsedMs:recording?.elapsedMs,recordingBytes:recording?.metrics.bytes,
    recording:recording?.diagnosticSnapshot(),recordingUIError:recordingUI?.error})});
const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};

function syncViewControls() {
  for (const [id, viewport] of [['photo', photoView], ['camera', cameraView]]) {
    $(`${id}-view-zoom`).value = Math.round(viewport.view.scale * 100);
    $(`${id}-view-value`).value = `${Math.round(viewport.view.scale * 100)}%`;
    $(`${id}-view-focus`).textContent=viewport.returnView?'戻す':'寄る';
    $(`${id}-view-focus`).setAttribute('aria-pressed',String(!!viewport.returnView));
    $(`${id}-view-focus`).setAttribute('aria-label',viewport.returnView?'寄る前の表示倍率・位置に戻す':`${id==='photo'?'絵画':'カメラ'}の選択パーツを中心に拡大`);
  }
}

function syncControls() {
  const part = selected(), source = selectedSource();
  compositeUI?.sync(part ? part.name : '未選択');
  for (const { key, input, output, unit } of controls) {
    input.disabled = !part; input.value = Number(readValue(key).toFixed(1)); output.value = part ? `${input.value}${unit}` : '—';
  }
  for (const id of ['quick-feather', 'shape', 'source-zoom', 'part-enabled', 'part-delete', 'part-front', 'part-back']) $(id).disabled = !part;
  $('quick-feather').value = part?.feather ?? 20;
  $('quick-feather-value').value = part ? `${Math.round(part.feather)}%` : '—';
  $('shape').value = part?.shape ?? 'oval';$('camera-shape').value=part?.shape??'oval';
  $('source-zoom').max=part?.shape==='freehand'?60:6;
  $('source-zoom').value = source.zoom;
  $('source-zoom-value').value = part ? `${source.zoom.toFixed(2)}×` : '—';
  $('part-enabled').checked = part?.enabled ?? false;
  for (const id of ['photo', 'camera']) { $(`${id}-guide`).disabled = !part; $(`${id}-guide`).checked = part?.guides[id] ?? false; }
  $('selected-part-name').textContent = part ? `${part.name}${part.enabled ? '' : ' / 合成OFF'}` : '未選択';
  $('camera-part-name').textContent = part ? part.name : '未選択';
  canvas.setAttribute('aria-label', `絵画側の${part ? part.name : '未選択'}。枠内で移動、四隅で拡縮、上の丸で回転`);
  const order = [...state.parts].sort((a, b) => a.zIndex - b.zIndex);
  $('part-order-value').value = part ? `${order.indexOf(part) + 1} / ${order.length}` : '—';
  $('part-back').disabled = !part || order[0] === part;
  $('part-front').disabled = !part || order[order.length - 1] === part;
  syncPartList();
  for (const key of ['x', 'y']) {
    $(`source-${key}`).disabled = !part;
    $(`source-${key}`).value = (source[key] * 100).toFixed(1);
    $(`source-${key}-value`).value = part ? `${(source[key] * 100).toFixed(1)}%` : '—';
  }
  photoMagnifier?.setLabel(part ? part.name : '未選択');
  cameraMagnifier?.setLabel(part ? part.name : '未選択');
  customEditor?.sync();recordingUI?.applyLock();
}
function update() { syncControls(); render(); templates?.changed(); }

for (const [key, title, min, max, step, unit] of [
  ['x', 'X座標', 0, 100, .1, '%'], ['y', 'Y座標', 0, 100, .1, '%'],
  ['width', '幅', 1, 100, .1, '%'], ['height', '高さ', 1, 100, .1, '%'],
  ['rotation', '回転角', -180, 180, 1, '°'], ['feather', 'Feather / 境界ぼかし', 0, 100, 1, '%']
]) {
  const label = document.createElement('label'); label.className = 'slider-label'; label.htmlFor = `part-${key}`;
  const output = document.createElement('output'); output.htmlFor = `part-${key}`;
  const input = document.createElement('input'); input.id = `part-${key}`; input.type = 'range';
  Object.assign(input, { min, max, step, value: readValue(key) });
  output.value = `${input.value}${unit}`; label.append(title, output);
  input.addEventListener('input', () => { writeValue(key, Number(input.value)); update(); });
  controls.push({ key, input, output, unit });
  $('part-controls').append(label, input);
}
for (const [key, title] of [['x', 'カメラ側 / X'], ['y', 'カメラ側 / Y']]) {
  const label = document.createElement('label'); label.className = 'slider-label'; label.htmlFor = `source-${key}`;
  const output = document.createElement('output'); output.id = `source-${key}-value`; output.htmlFor = label.htmlFor;
  const input = document.createElement('input'); Object.assign(input, { id: label.htmlFor, type: 'range', min: 0, max: 100, step: .1 });
  label.append(title, output); $('source-controls').append(label, input);
  input.addEventListener('input', () => { setSource({ ...selectedSource(), [key]: Number(input.value) / 100 }); update(); });
}
function renderComposite(target, before = false) {
  const started = diagnostics.enabled ? performance.now() : 0;
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  if (state.image) target.drawImage(state.image, 0, 0, target.canvas.width, target.canvas.height);
  renderer.draw(target, state.running ? video : null, state.parts, state.mirror,
    {composite:before ? {...state.composite,mode:'original'} : state.composite,background:state.image,time:performance.now()});
  if(diagnostics.enabled && target===ctx)diagnostics.composition(performance.now(),performance.now()-started);
}
function render() {
  for(const [id,available] of [['photo',!!state.image],['camera',state.running&&video.readyState>=2]]){
    const control=$(`${id}-view-focus`),disabled=!available||!selected()||!!recording?.busy;
    if(control.disabled!==disabled)control.disabled=disabled;
  }
  diagnostics.frame(performance.now());
  renderComposite(ctx, comparing && !recording?.busy);
  recording?.pushFrame(canvas, performance.now());
  recordingUI?.pushPreview(canvas, performance.now());
  photoEditor?.draw();
  photoMagnifier?.draw();
  const preview = $('camera-preview'), c = preview.getContext('2d');
  c.clearRect(0, 0, preview.width, preview.height);
  if (!state.running || video.readyState < 2 || !video.videoWidth) { cameraEditor?.draw(); cameraMagnifier?.draw();customEditor?.draw(); return; }
  const height = Math.round(preview.width * video.videoHeight / video.videoWidth);
  if (preview.height !== height) preview.height = height;
  c.save(); if (state.mirror) { c.translate(preview.width, 0); c.scale(-1, 1); }
  c.drawImage(customEditor?.still||video, 0, 0, preview.width, preview.height); c.restore();
  cameraEditor?.draw();
  cameraMagnifier?.draw();customEditor?.draw();
}
function tick(time = performance.now()) {
  if(time-lastDraw>=1000/30-1){render();lastDraw=time;}
  frame = state.running ? requestAnimationFrame(tick) : 0;
}
function stopCamera(text = 'カメラを停止しました。') {
  customEditor?.cancel();
  recording?.stop('カメラ停止のため録画を終了しました。');
  cameraEditor?.cancel();
  camera.stop(); state.running = false; cancelAnimationFrame(frame); frame = 0;
  $('start').disabled = false; $('stop').disabled = true;
  $('camera-state').textContent = '停止中'; $('camera-hint').hidden = false;
  customEditor?.sync();render(); message(text);
  recordingUI?.sync();
}
$('start').addEventListener('click', async () => {
  $('start').disabled = true; $('stop').disabled = false; $('camera-state').textContent = '接続中';
  message('カメラの使用を許可してください。');
  try {
    if (!window.isSecureContext) throw new Error('UNSUPPORTED');
    if (!await camera.start()) return;
    state.running = true; $('camera-state').textContent = '使用中'; $('camera-hint').hidden = true;
    camera.stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (state.running) stopCamera('カメラとの接続が終了しました。再度開始してください。');
    }, { once: true }));
    customEditor?.sync();message('枠をドラッグして位置を合わせます。'); tick();
    recordingUI?.sync();
  } catch (error) {
    stopCamera();
    const messages = { NotAllowedError: 'カメラが許可されていません。Safariのサイト設定で許可してください。',
      NotFoundError: 'カメラが見つかりません。', NotReadableError: 'カメラを使用できません。他のアプリを閉じて再度お試しください。',
      UNSUPPORTED: 'カメラを利用するには HTTPS または localhost で開いてください。' };
    message(messages[error.name] || messages[error.message] || 'カメラを開始できませんでした。再度お試しください。', true);
  }
});
$('stop').addEventListener('click', () => stopCamera());
$('mirror').addEventListener('change', event => { customEditor?.cancel();cameraEditor.cancel(); state.mirror = event.target.checked; update(); });
for (const [id, viewport] of [['photo', photoView], ['camera', cameraView]]) {
  $(`${id}-guide`).addEventListener('change', event => {
    photoEditor.cancel(); cameraEditor.cancel(); if (selected()) selected().guides[id] = event.target.checked; render(); templates?.changed();
  });
  $(`${id}-view-zoom`).addEventListener('input', event => {
    photoEditor.cancel(); cameraEditor.cancel(); viewport.zoom(Number(event.target.value) / 100);
  });
  $(`${id}-view-reset`).addEventListener('click', () => { photoEditor.cancel(); cameraEditor.cancel(); viewport.reset(); });
  $(`${id}-view-focus`).addEventListener('click',()=>{
    cancelEditors();if(viewport.returnView)viewport.restore();else focusPart(id);
  });
}
function focusPart(id) {
  const editor=id==='photo'?photoEditor:cameraEditor,view=id==='photo'?photoView:cameraView;
  if(!selected()||(id==='photo'?!state.image:!state.running))return;
  const geometry=view.geometry(),box=editor.getBox(geometry);
  if(box)view.focus(box);
}
$('interaction-mode').addEventListener('change', event => {
  photoEditor.cancel(); cameraEditor.cancel(); state.mode = event.target.value; render();
});
function changeShape(event){
  const part=selected();if(!part||recording?.busy)return;customEditor?.cancel();
  if(event.target.value==='freehand'&&!part.customMask){screens.select('camera');customEditor?.start();syncControls();return;}
  part.shape=event.target.value;update();
}
for(const id of ['shape','camera-shape'])$(id).addEventListener('change',changeShape);
$('source-zoom').addEventListener('input', event => {
  setSource({ ...selectedSource(), zoom: Number(event.target.value) }); update();
});
$('quick-feather').addEventListener('input', event => {
  if (selected()) selected().feather = Number(event.target.value); update();
});
function cancelEditors() { customEditor?.cancel();photoEditor?.cancel(); cameraEditor?.cancel(); }
function syncPartList(){
  const list=$('part-list'),ids=state.parts.map(p=>p.id).join('|');
  if(list.dataset.ids!==ids){list.replaceChildren();for(const p of state.parts){const b=document.createElement('button');b.type='button';b.dataset.partId=p.id;b.addEventListener('click',()=>{if(recording?.busy)return;cancelEditors();collection.select(p.id);update();if(photoView.returnView)focusPart('photo');if(cameraView.returnView)focusPart('camera');});list.append(b);}list.dataset.ids=ids;}
  for(const p of state.parts){const b=[...list.children].find(b=>b.dataset.partId===p.id);b.textContent=p.name+(p.enabled?' ●':' ○');b.title=p.name;b.setAttribute('aria-pressed',String(p===selected()));b.dataset.enabled=String(p.enabled);}
  if(list.dataset.selected!==collection.selectedId){list.dataset.selected=collection.selectedId;const button=[...list.children].find(b=>b.dataset.partId===collection.selectedId);if(button){const b=button.getBoundingClientRect(),r=list.getBoundingClientRect();if(b.left<r.left)list.scrollLeft+=b.left-r.left;else if(b.right>r.right)list.scrollLeft+=b.right-r.right;}}
  $('part-add').disabled=state.parts.length>=MAX_PARTS;$('part-duplicate').disabled=state.parts.length>=MAX_PARTS;
  $('part-limit').textContent=state.parts.length>=MAX_PARTS?'最大8個です。追加する場合は既存パーツを削除してください。':state.parts.length+' / 8';
  $('part-delete').disabled=state.parts.length<=1;$('part-delete').title=state.parts.length<=1?'最後の1個は削除できません':'';
  $('part-name').value=selected()?.name||'';
  $('part-top').disabled=$('part-front').disabled;$('part-bottom').disabled=$('part-back').disabled;
  $('source-aspect').disabled=selected()?.shape==='freehand';
  $('source-aspect').value=selected()?.sourceRect.aspect||1;$('source-aspect-value').value=selected()?.shape==='freehand'?'輪郭の枠で縦横を調整':selected()?.sourceRect.aspect?selected().sourceRect.aspect.toFixed(2)+' : 1':'旧版：配置の縦横比';
}
$('part-add').addEventListener('click',()=>{if(recording?.busy)return;cancelEditors();if(collection.add())message('パーツを追加しました。');update();});
$('part-duplicate').addEventListener('click',()=>{if(recording?.busy)return;cancelEditors();if(collection.duplicate())message('パーツを複製しました。');update();});
$('part-rename').addEventListener('click',()=>{if(recording?.busy)return;try{collection.rename($('part-name').value);update();message('パーツ名を変更しました。');}catch(error){message(error.message,true);}});
$('part-enabled').addEventListener('change',event=>{if(selected())selected().enabled=event.target.checked;update();});
$('part-delete').addEventListener('click',()=>{if(recording?.busy||state.parts.length<=1)return;if(!window.confirm('「'+selected().name+'」を削除しますか？'))return;cancelEditors();collection.removeSelected();update();});
for(const [id,direction]of [['part-front',1],['part-back',-1],['part-top','first'],['part-bottom','last']])$(id).addEventListener('click',()=>{collection.reorder(direction);update();});
$('source-aspect').addEventListener('input',event=>{setSource({...selectedSource(),aspect:Number(event.target.value)});update();});

async function loadImage(event) {
  if(recording?.busy)return;
  const file = event.target.files?.[0]; if (!file) return;
  const generation = ++imageGeneration;
  let url;
  const imageMessage = (text, error, state) => { message(text, error); $('status').dataset.state = state; };
  imageMessage('画像を読み込んでいます…', false, 'image-loading');
  try {
    if (file.type && !file.type.startsWith('image/') && file.type !== 'application/octet-stream') throw new Error('UNSUPPORTED_IMAGE');
    url = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (generation !== imageGeneration || recording?.busy) return;
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('INVALID_IMAGE');
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    // Keep only the resized bitmap so very large originals do not remain in the animation loop.
    const background = document.createElement('canvas');
    background.width = Math.max(1, Math.round(image.naturalWidth * scale));
    background.height = Math.max(1, Math.round(image.naturalHeight * scale));
    background.getContext('2d').drawImage(image, 0, 0, background.width, background.height);
    photoEditor.cancel(); cameraEditor.cancel();
    state.image = background; canvas.width = background.width; canvas.height = background.height;
    state.imageMetadata = { name: file.name, mime: file.type || '', size: file.size }; state.backgroundRevision++;
    $('empty-hint').hidden = true; $('save').disabled = false; clearExport(); photoView.reset();
    templates?.changed();
    recordingUI?.sync();
    imageMessage('画像を読み込みました。枠をドラッグで調整できます。', false, 'image-ready');
  } catch (error) {
    if (generation === imageGeneration) {
      if (error?.message === 'UNSUPPORTED_IMAGE') imageMessage('非対応画像形式です。JPEG・PNGなどの画像を選んでください。', true, 'unsupported-image');
      else imageMessage('画像のデコードに失敗しました。このブラウザで開けるJPEG・PNGなどの画像を選んでください。', true, 'image-decode-error');
    }
  } finally { if (url) URL.revokeObjectURL(url); event.target.value = ''; }
}
for (const id of ['image-file', 'image-file-native']) $(id).addEventListener('change', loadImage);
function clearExport() {
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = null; $('export-result').hidden = true; $('export-image').removeAttribute('src'); $('download').removeAttribute('href');
}
$('save').addEventListener('click', async () => {
  if (!state.image) return;
  $('save').disabled = true;
  try {
    const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
    renderComposite(output.getContext('2d'));
    const blob = await new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('PNG_FAILED')), 'image/png'));
    clearExport(); exportUrl = URL.createObjectURL(blob);
    const filename = `portrait-mouth-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    $('export-image').src = exportUrl; $('download').href = exportUrl; $('download').download = filename;
    $('export-result').hidden = false;
    $('download').click();
    message('PNGを作成しました。iPhoneでダウンロードできない場合は、保存用画像を長押ししてください。');
  } catch { message('PNGの作成に失敗しました。再度お試しください。', true); }
  finally { $('save').disabled = !state.image; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { diagnosticPanel.pause();photoEditor.cancel(); stopCamera(); } else diagnosticPanel.resume(); });
window.addEventListener('pagehide', () => { diagnosticPanel.pause();photoEditor.cancel(); stopCamera(); clearExport();if(recordingUI){recordingUI.suspended=true;if($('record-result').open)$('record-result').close();recordingUI.releasePreview();} });
window.addEventListener('pageshow', () => {if(recordingUI){recordingUI.suspended=false;recordingUI.sync();}});
photoEditor = new TouchEditor(canvas, {
  color: '#24e3cd', editable: () => !recording?.busy && screens.screen === 'photo', enabled: () => screens.screen === 'photo' && !!selected()?.guides.photo && !!state.image, viewport: photoView, mode: () => screens.screen === 'finished' ? 'view' : state.mode,
  snapshot: () => ({ targetRect: { ...selected().targetRect }, rotation: selected().rotation }), restore: saved => { Object.assign(selected(), saved); update(); },
  getBox: size => { if (!selected()) return null; const p = selected().targetRect; return { x: p.x / 100 * size.width, y: p.y / 100 * size.height,
    width: p.width / 100 * size.width, height: p.height / 100 * size.height, angle: selected().rotation * Math.PI / 180 }; },
  change: (box, size) => {
    Object.assign(selected().targetRect, { x: box.x / size.width * 100, y: box.y / size.height * 100,
      width: box.width / size.width * 100, height: box.height / size.height * 100 });
    selected().rotation = box.angle * 180 / Math.PI;
    update();
  }
});
cameraEditor = new TouchEditor($('camera-preview'), {
  color: '#ffba69', rotation: false,
  editable: () => !customEditor?.active && !recording?.busy && screens.screen === 'camera',
  enabled: () => !customEditor?.active && screens.screen === 'camera' && !!selected()?.guides.camera && state.running && video.readyState >= 2, viewport: cameraView, mode: () => state.mode,
  snapshot: () => ({sourceRect:{...selected().sourceRect},customMask:selected().customMask?structuredClone(selected().customMask):null}), restore: saved => {selected().sourceRect={...saved.sourceRect};if(saved.customMask)selected().customMask=structuredClone(saved.customMask);update();},
  getBox: size => {
    if (!video.videoWidth || !selected()) return null;
    const p = selected().targetRect, crop = sourceRect(video.videoWidth, video.videoHeight,
      canvas.width * p.width / (canvas.height * p.height), selectedSource(), state.mirror);
    return { x: (crop.visualX + crop.width / 2) / video.videoWidth * size.width,
      y: (crop.y + crop.height / 2) / video.videoHeight * size.height,
      width: crop.width / video.videoWidth * size.width, height: crop.height / video.videoHeight * size.height, angle: 0 };
  },
  change: (box, size, drag) => {
    if(selected().shape==='freehand'&&selected().customMask){
      const width=box.width/size.width,height=box.height/size.height,rect=boundedRect({x:state.mirror?1-(box.x+box.width/2)/size.width:(box.x-box.width/2)/size.width,y:(box.y-box.height/2)/size.height,width,height});
      try{validateCustomMask({...selected().customMask,rect});selected().customMask.rect=rect;}catch{message('輪郭の領域が小さすぎます。',true);}
      update();return;
    }
    if (drag.action.type === 'move') {
      // Use the visible crop center at drag start, avoiding a jump after edge clamping.
      const p = selected().targetRect, aspect = selectedSource().aspect || canvas.width * p.width / (canvas.height * p.height);
      const result = sourceFromBox({ ...box, width: drag.box.width, height: drag.box.height }, size, aspect);
      setSource({ ...selectedSource(), x: result.x, y: result.y });
    } else {
      const p = selected().targetRect, aspect = selectedSource().aspect || canvas.width * p.width / (canvas.height * p.height);
      const next = sourceFromBox(box, size, aspect);
      const width = Math.min(size.width * .6 / next.zoom, size.height * aspect), height = width / aspect;
      // Keep the opposite corner fixed while preserving the source aspect ratio.
      const anchored = { ...box, width, height,
        x: drag.box.x + drag.action.sx * (width - drag.box.width) / 2,
        y: drag.box.y + drag.action.sy * (height - drag.box.height) / 2 };
      setSource(sourceFromBox(anchored, size, aspect));
    }
    update();
  }
});
photoMagnifier = new Magnifier(canvas.parentElement, {
  getAnchor:()=>{const g=photoView.geometry();const box=photoEditor.getBox(g);return box?toScreen(box,photoView.view,g.origin):null;},
  id: 'photo', label: '絵画側', color: '#24e3cd', getSource: () => state.image && selected() ? {
    image: canvas, x: canvas.width * selected().targetRect.x / 100, y: canvas.height * selected().targetRect.y / 100,
    fit: photoView.geometry().width / canvas.width
  } : null
});
cameraMagnifier = new Magnifier($('camera-preview').parentElement, {
  getAnchor:()=>{const g=cameraView.geometry();const box=cameraEditor.getBox(g);return box?toScreen(box,cameraView.view,g.origin):null;},
  id: 'camera', label: 'カメラ側', color: '#ffba69', getSource: () => {
    if(customEditor?.active)return null;
    if (!state.running || video.readyState < 2 || !video.videoWidth || !selected()) return null;
    const part = selected().targetRect, crop = sourceRect(video.videoWidth, video.videoHeight,
      canvas.width * part.width / (canvas.height * part.height), selectedSource(), state.mirror);
    return { image: video, x: crop.x + crop.width / 2, y: crop.y + crop.height / 2,
      fit: cameraView.geometry().width / video.videoWidth, mirror: state.mirror };
  }
});
customEditor=new CustomShapeEditor({target:$('camera-preview'),video,viewport:cameraView,selected,mirror:()=>state.mirror,
  ready:()=>screens.screen==='camera'&&state.running&&video.readyState>=2&&!!selected(),locked:()=>!!recording?.busy,before:cancelEditors,
  changed:()=>{update();recordingUI?.sync();},message});
templates = new TemplateUI({
  locked: () => !!recording?.busy,
  read: () => ({ canvas: state.image, metadata: state.imageMetadata, revision: state.backgroundRevision, parts: state.parts, mirror: state.mirror, composite:state.composite }),
  message,
  apply: async (doc, background) => {
    if(recording?.busy)throw new Error('録画中はテンプレートを切り替えられません。');
    imageGeneration++; cancelEditors(); stopCamera();
    state.image = background; state.backgroundRevision++;
    state.imageMetadata = { name: doc.background.name, mime: doc.background.mime, size: doc.background.size };
    canvas.width = background.width; canvas.height = background.height;
    collection.parts.splice(0, collection.parts.length, ...structuredClone(doc.parts));
    collection.selectedId = collection.parts[0]?.id ?? null;
    state.mirror = doc.mirror; $('mirror').checked = doc.mirror;
    state.composite = structuredClone(doc.composite);compositeUI.setCompare(false);
    state.mode = 'edit'; $('interaction-mode').value = 'edit';
    $('empty-hint').hidden = true; $('save').disabled = false; clearExport();
    photoView.reset(); cameraView.reset(); photoMagnifier.reset(); cameraMagnifier.reset();
    syncControls(); syncViewControls(); render();
  }
});
compositeUI = new CompositeUI({read:()=>state.composite,selected,changed:update,compare:active=>{comparing=active;render();}});
recording = new VideoRecording({changed:()=>recordingUI?.sync()});
recordingUI = new RecordingUI({recorder:recording,ready:()=>!customEditor?.active&&!!state.image&&state.running&&video.readyState>=2,
  start:()=>{if(!state.image||!state.running||video.readyState<2)return;return recording.start({source:canvas,...recordingUI.options()});},
  lockChanged:busy=>{if(busy){imageGeneration++;cancelEditors();compositeUI.setCompare(false);}else{$('start').disabled=state.running;$('stop').disabled=!state.running;}syncControls();render();templates?.changed();}
});
syncControls();
syncViewControls();
render();
for (const id of ['image-file', 'image-file-native']) $(id).disabled = false;
$('image-trigger').removeAttribute('aria-disabled');
document.body.dataset.appState = 'ready';
$('status').dataset.state = 'ready';
message('画像を読み込んで始めてください。');
