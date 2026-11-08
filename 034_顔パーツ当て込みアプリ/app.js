import { Camera } from './camera.js?v=0.4.2';
import { CompositeRenderer, sourceRect } from './renderer.js?v=0.4.2';
import { TouchEditor, sourceFromBox } from './editor.js?v=0.4.2';
import { Viewport } from './viewport.js?v=0.4.2';
import { Magnifier } from './magnifier.js?v=0.4.2';
import { PartCollection, PART_TYPES, sourceForDisplay, setDisplaySource } from './parts.js?v=0.4.2';
import { TemplateUI } from './template-ui.js?v=0.4.2';
import { FaceTracker } from './tracking.js?v=0.4.2';
import { correctionFor, DEFAULT_CORRECTION, displayCrop } from './tracking-geometry.js?v=0.4.2';
import { Diagnostics, DiagnosticPanel } from './diagnostics.js?v=0.4.2';

const $ = id => document.getElementById(id);
const canvas = $('composition'), ctx = canvas.getContext('2d');
const video = $('camera'), camera = new Camera(video), renderer = new CompositeRenderer();
const collection = new PartCollection();
const state = { image: null, imageMetadata: null, backgroundRevision: 0, running: false, mirror: true, mode: 'edit', trackingEnabled: false,
  parts: collection.parts };
const selected = () => collection.selected;
const selectedSource = () => selected() ? sourceForDisplay(selected(), state.mirror) : { x: .5, y: .5, zoom: 1.5 };
const setSource = source => { if (selected()) setDisplaySource(selected(), source, state.mirror); };
const readValue = key => selected() ? (selected().targetRect[key] ?? selected()[key]) : 0;
function writeValue(key, value) {
  const part = selected(); if (!part) return;
  if (Object.prototype.hasOwnProperty.call(part.targetRect, key)) part.targetRect[key] = value; else part[key] = value;
}
let frame = 0, imageGeneration = 0, exportUrl = null, lastDraw = -Infinity;
let photoEditor, cameraEditor;
let photoMagnifier, cameraMagnifier;
let templates;
const photoView = new Viewport(canvas, { min: .5, changed: () => { syncViewControls(); render(); } });
const cameraView = new Viewport($('camera-preview'), { changed: () => { syncViewControls(); render(); } });
const controls = [];
const trackingControls = [];
const message = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };
const diagnostics = new Diagnostics();
const tracker = new FaceTracker({ video, diagnostics, changed: () => syncTrackingUI(), failed: () => {
  state.trackingEnabled = false; cancelEditors(); update();
  message('自動追従を利用できません。手動に戻しました。再度ONにするとモデルの読込を再試行します。', true);
} });
const trackedCrop = () => state.trackingEnabled && selected() ? tracker.crops(state.parts, video.videoWidth, video.videoHeight)[selected().id] : null;
const diagnosticPanel = new DiagnosticPanel({details:$('diagnostics'),output:$('diagnostic-values'),copy:$('diagnostic-copy'),fallback:$('diagnostic-text'),status:$('diagnostic-copy-status'),metrics:diagnostics,
  sample:()=>diagnostics.snapshot(performance.now(),{status:tracker.state.status,backend:tracker.active?(tracker.metrics.backend||'初期化中'):'未使用',
    videoWidth:video.videoWidth,videoHeight:video.videoHeight,inputWidth:tracker.active?(tracker.metrics.inputWidth||0):0,inputHeight:tracker.active?(tracker.metrics.inputHeight||0):0,
    lastCapture:tracker.metrics.lastCapture,lastGoodAgeMs:Number.isFinite(tracker.state.lastGood)?performance.now()-tracker.state.lastGood:null,interval:tracker.metrics.interval})});
const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};

function syncTrackingUI() {
  const status = tracker.state.status;
  const labels = { stopped: '停止中', initializing:'初期化中', detecting: '検出中', tracking: '追従中', lost: '一時的な未検出', notFound: '顔消失', error: '利用不可／エラー' };
  $('tracking-toggle').checked = state.trackingEnabled;
  $('tracking-manual').hidden = !state.trackingEnabled;
  setText($('tracking-status'),status === 'error' ? labels.error : !state.trackingEnabled ? '手動' : !state.running ? 'カメラ停止中' : labels[status]);
  $('tracking-status').dataset.state = status; $('tracking-status').dataset.backend = tracker.metrics.backend;
  $('tracking-status').dataset.count = tracker.metrics.count;
}

function syncViewControls() {
  for (const [id, viewport] of [['photo', photoView], ['camera', cameraView]]) {
    $(`${id}-view-zoom`).value = Math.round(viewport.view.scale * 100);
    $(`${id}-view-value`).value = `${Math.round(viewport.view.scale * 100)}%`;
  }
}

function syncControls() {
  const part = selected(), source = selectedSource();
  for (const { key, input, output, unit } of controls) {
    input.disabled = !part; input.value = Number(readValue(key).toFixed(1)); output.value = part ? `${input.value}${unit}` : '—';
  }
  for (const id of ['quick-feather', 'shape', 'source-zoom', 'part-enabled', 'part-delete', 'part-front', 'part-back']) $(id).disabled = !part;
  $('quick-feather').value = part?.feather ?? 20;
  $('quick-feather-value').value = part ? `${Math.round(part.feather)}%` : '—';
  $('shape').value = part?.shape ?? 'oval';
  $('source-zoom').value = source.zoom;
  $('source-zoom-value').value = part ? `${source.zoom.toFixed(2)}×` : '—';
  $('part-enabled').checked = part?.enabled ?? false;
  for (const id of ['photo', 'camera']) { $(`${id}-guide`).disabled = !part; $(`${id}-guide`).checked = part?.guides[id] ?? false; }
  $('selected-part-name').textContent = part ? `${PART_TYPES[part.partType]}${part.enabled ? '' : ' / 合成OFF'}` : '未選択';
  $('camera-part-name').textContent = part ? PART_TYPES[part.partType] : '未選択';
  canvas.setAttribute('aria-label', `絵画側の${part ? PART_TYPES[part.partType] : '未選択'}。枠内で移動、四隅で拡縮、上の丸で回転`);
  const order = [...state.parts].sort((a, b) => a.zIndex - b.zIndex);
  $('part-order-value').value = part ? `${order.indexOf(part) + 1} / ${order.length}` : '—';
  $('part-back').disabled = !part || order[0] === part;
  $('part-front').disabled = !part || order[order.length - 1] === part;
  for (const [type, label] of Object.entries(PART_TYPES)) {
    const button = $(`select-${type}`), existing = state.parts.find(p => p.partType === type);
    button.textContent = existing ? `${label} ${existing.enabled ? '●' : '○'}` : `＋${label}`;
    button.dataset.exists = String(!!existing); button.dataset.enabled = String(existing?.enabled ?? false);
    button.setAttribute('aria-pressed', String(existing?.id === collection.selectedId));
    button.setAttribute('aria-label', `${label}を${existing ? '選択' : '追加'}`);
  }
  $('eye-convention').textContent = `左右は映る本人基準。反転${state.mirror ? 'ON：本人の左目は画面左' : 'OFF：本人の左目は画面右'}。`;
  for (const key of ['x', 'y']) {
    $(`source-${key}`).disabled = !part;
    $(`source-${key}`).value = (source[key] * 100).toFixed(1);
    $(`source-${key}-value`).value = part ? `${(source[key] * 100).toFixed(1)}%` : '—';
  }
  photoMagnifier?.setLabel(part ? PART_TYPES[part.partType] : '未選択');
  cameraMagnifier?.setLabel(part ? PART_TYPES[part.partType] : '未選択');
  $('tracking-part-name').textContent = part ? PART_TYPES[part.partType] : '未選択';
  const correction = part ? correctionFor(part) : DEFAULT_CORRECTION;
  for(const {key,input,output,scale,unit} of trackingControls) {
    input.disabled = !part; input.value = correction[key]*scale; output.value = `${Number(input.value).toFixed(key==='rotation'?0:1)}${unit}`;
  }
  $('tracking-correction-reset').disabled = !part;
  for(const id of ['source-x','source-y','source-zoom'])$(id).disabled = !part || state.trackingEnabled;
  syncTrackingUI();
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
for(const [key,title,min,max,step,scale,unit] of [
  ['offsetX','X補正',-150,150,1,100,'%'],['offsetY','Y補正',-150,150,1,100,'%'],
  ['widthScale','幅の倍率',.5,3,.01,1,'×'],['heightScale','高さの倍率',.5,3,.01,1,'×'],['rotation','回転補正',-90,90,1,1,'°']
]) {
  const label=document.createElement('label');label.className='slider-label';label.htmlFor=`tracking-${key}`;label.textContent=title;
  const output=document.createElement('output'),input=document.createElement('input');
  Object.assign(input,{id:label.htmlFor,type:'range',min,max,step});label.append(output);$('tracking-controls').append(label,input);
  input.addEventListener('input',()=>{if(selected())selected().tracking={...correctionFor(selected()),[key]:Number(input.value)/scale};update();});
  trackingControls.push({key,input,output,scale,unit});
}
$('tracking-correction-reset').addEventListener('click',()=>{if(selected())selected().tracking={...DEFAULT_CORRECTION};update();});
function setTracking(enabled) {
  cancelEditors(); state.trackingEnabled=enabled;
  if(enabled && state.running)tracker.start();else tracker.stop();
  update();
}
$('tracking-toggle').addEventListener('change',event=>setTracking(event.target.checked));
$('tracking-manual').addEventListener('click',()=>setTracking(false));

function renderComposite(target) {
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  if (state.image) target.drawImage(state.image, 0, 0, target.canvas.width, target.canvas.height);
  renderer.draw(target, state.running ? video : null, state.parts, state.mirror,
    state.trackingEnabled ? tracker.crops(state.parts, video.videoWidth, video.videoHeight) : null);
  if(state.trackingEnabled && $('tracking-status').dataset.state!==tracker.state.status)syncTrackingUI();
}
function render() {
  diagnostics.frame(performance.now());
  renderComposite(ctx);
  photoEditor?.draw();
  photoMagnifier?.draw();
  const preview = $('camera-preview'), c = preview.getContext('2d');
  c.clearRect(0, 0, preview.width, preview.height);
  if (!state.running || video.readyState < 2 || !video.videoWidth) { cameraEditor?.draw(); cameraMagnifier?.draw(); return; }
  const height = Math.round(preview.width * video.videoHeight / video.videoWidth);
  if (preview.height !== height) preview.height = height;
  c.save(); if (state.mirror) { c.translate(preview.width, 0); c.scale(-1, 1); }
  c.drawImage(video, 0, 0, preview.width, preview.height); c.restore();
  cameraEditor?.draw();
  cameraMagnifier?.draw();
}
function tick(time = performance.now()) {
  if(time-lastDraw>=1000/30-1){const start=performance.now();render();tracker.observeDraw(performance.now()-start);lastDraw=time;}
  frame = state.running ? requestAnimationFrame(tick) : 0;
}
function stopCamera(text = 'カメラを停止しました。再開するには「カメラ開始」を押してください。') {
  cameraEditor?.cancel();
  tracker.stop();
  camera.stop(); state.running = false; cancelAnimationFrame(frame); frame = 0;
  $('start').disabled = false; $('stop').disabled = true;
  $('camera-state').textContent = '停止中'; $('camera-hint').hidden = false;
  render(); message(text);
  syncTrackingUI();
}
$('start').addEventListener('click', async () => {
  $('start').disabled = true; $('stop').disabled = false; $('camera-state').textContent = '接続中';
  message('カメラの使用を許可してください。');
  try {
    if (!window.isSecureContext) throw new Error('UNSUPPORTED');
    if (!await camera.start()) return;
    state.running = true; $('camera-state').textContent = '使用中'; $('camera-hint').hidden = true;
    if(state.trackingEnabled)tracker.start();
    camera.stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (state.running) stopCamera('カメラとの接続が終了しました。再度開始してください。');
    }, { once: true }));
    message('写真は水色、カメラはオレンジの枠を直接ドラッグして合わせてください。'); tick();
  } catch (error) {
    stopCamera();
    const messages = { NotAllowedError: 'カメラが許可されていません。Safariのサイト設定で許可してください。',
      NotFoundError: 'カメラが見つかりません。', NotReadableError: 'カメラを使用できません。他のアプリを閉じて再度お試しください。',
      UNSUPPORTED: 'カメラを利用するには HTTPS または localhost で開いてください。' };
    message(messages[error.name] || messages[error.message] || 'カメラを開始できませんでした。再度お試しください。', true);
  }
});
$('stop').addEventListener('click', () => stopCamera());
$('mirror').addEventListener('change', event => { cameraEditor.cancel(); state.mirror = event.target.checked; update(); });
for (const [id, viewport] of [['photo', photoView], ['camera', cameraView]]) {
  $(`${id}-guide`).addEventListener('change', event => {
    photoEditor.cancel(); cameraEditor.cancel(); if (selected()) selected().guides[id] = event.target.checked; render(); templates?.changed();
  });
  $(`${id}-view-zoom`).addEventListener('input', event => {
    photoEditor.cancel(); cameraEditor.cancel(); viewport.zoom(Number(event.target.value) / 100);
  });
  $(`${id}-view-reset`).addEventListener('click', () => { photoEditor.cancel(); cameraEditor.cancel(); viewport.reset(); });
}
$('interaction-mode').addEventListener('change', event => {
  photoEditor.cancel(); cameraEditor.cancel(); state.mode = event.target.value; render();
});
$('shape').addEventListener('change', event => { if (selected()) selected().shape = event.target.value; update(); });
$('source-zoom').addEventListener('input', event => {
  setSource({ ...selectedSource(), zoom: Number(event.target.value) }); update();
});
$('quick-feather').addEventListener('input', event => {
  if (selected()) selected().feather = Number(event.target.value); update();
});
function cancelEditors() { photoEditor?.cancel(); cameraEditor?.cancel(); }
for (const type of Object.keys(PART_TYPES)) $(`select-${type}`).addEventListener('click', () => {
  cancelEditors(); collection.add(type); update();
});
$('part-enabled').addEventListener('change', event => { if (selected()) selected().enabled = event.target.checked; update(); });
$('part-delete').addEventListener('click', () => { cancelEditors(); collection.removeSelected(); update(); });
for (const [id, direction] of [['part-front', 1], ['part-back', -1]]) $(id).addEventListener('click', () => { collection.reorder(direction); update(); });

async function loadImage(event) {
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
    if (generation !== imageGeneration) return;
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
    imageMessage('画像の読み込みが完了しました。パーツを選び、枠を直接動かして合わせてください。', false, 'image-ready');
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
window.addEventListener('pagehide', () => { diagnosticPanel.pause();photoEditor.cancel(); stopCamera(); clearExport(); });
photoEditor = new TouchEditor(canvas, {
  color: '#24e3cd', enabled: () => !!selected()?.guides.photo && !!state.image, viewport: photoView, mode: () => state.mode,
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
  editable: () => !state.trackingEnabled,
  enabled: () => !!selected()?.guides.camera && state.running && video.readyState >= 2, viewport: cameraView, mode: () => state.mode,
  snapshot: () => ({ ...selected().sourceRect }), restore: saved => { selected().sourceRect = { ...saved }; update(); },
  getBox: size => {
    if (!video.videoWidth || !selected()) return null;
    if(state.trackingEnabled) {
      const raw=trackedCrop();if(!raw)return null;
      const crop=displayCrop(raw,video.videoWidth,state.mirror);
      return {x:crop.x/video.videoWidth*size.width,y:crop.y/video.videoHeight*size.height,
        width:crop.width/video.videoWidth*size.width,height:crop.height/video.videoHeight*size.height,angle:crop.angle};
    }
    const p = selected().targetRect, crop = sourceRect(video.videoWidth, video.videoHeight,
      canvas.width * p.width / (canvas.height * p.height), selectedSource(), state.mirror);
    return { x: (crop.visualX + crop.width / 2) / video.videoWidth * size.width,
      y: (crop.y + crop.height / 2) / video.videoHeight * size.height,
      width: crop.width / video.videoWidth * size.width, height: crop.height / video.videoHeight * size.height, angle: 0 };
  },
  change: (box, size, drag) => {
    if (drag.action.type === 'move') {
      // Use the visible crop center at drag start, avoiding a jump after edge clamping.
      const p = selected().targetRect, aspect = canvas.width * p.width / (canvas.height * p.height);
      const result = sourceFromBox({ ...box, width: drag.box.width, height: drag.box.height }, size, aspect);
      setSource({ ...selectedSource(), x: result.x, y: result.y });
    } else {
      const p = selected().targetRect, aspect = canvas.width * p.width / (canvas.height * p.height);
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
  id: 'photo', label: '絵画側', color: '#24e3cd', getSource: () => state.image && selected() ? {
    image: canvas, x: canvas.width * selected().targetRect.x / 100, y: canvas.height * selected().targetRect.y / 100,
    fit: photoView.geometry().width / canvas.width
  } : null
});
cameraMagnifier = new Magnifier($('camera-preview').parentElement, {
  id: 'camera', label: 'カメラ側', color: '#ffba69', getSource: () => {
    if (!state.running || video.readyState < 2 || !video.videoWidth || !selected()) return null;
    if(state.trackingEnabled) {
      const crop=trackedCrop();return crop?{image:video,x:crop.x,y:crop.y,fit:cameraView.geometry().width/video.videoWidth,mirror:state.mirror}:null;
    }
    const part = selected().targetRect, crop = sourceRect(video.videoWidth, video.videoHeight,
      canvas.width * part.width / (canvas.height * part.height), selectedSource(), state.mirror);
    return { image: video, x: crop.x + crop.width / 2, y: crop.y + crop.height / 2,
      fit: cameraView.geometry().width / video.videoWidth, mirror: state.mirror };
  }
});
templates = new TemplateUI({
  read: () => ({ canvas: state.image, metadata: state.imageMetadata, revision: state.backgroundRevision, parts: state.parts, mirror: state.mirror, trackingEnabled:state.trackingEnabled }),
  message,
  apply: async (doc, background) => {
    imageGeneration++; cancelEditors(); stopCamera();
    state.image = background; state.backgroundRevision++;
    state.imageMetadata = { name: doc.background.name, mime: doc.background.mime, size: doc.background.size };
    canvas.width = background.width; canvas.height = background.height;
    collection.parts.splice(0, collection.parts.length, ...structuredClone(doc.parts));
    collection.selectedId = collection.parts.find(p => p.partType === 'mouth')?.id ?? collection.parts[0]?.id ?? null;
    state.mirror = doc.mirror; $('mirror').checked = doc.mirror;
    state.trackingEnabled = doc.trackingEnabled;
    state.mode = 'edit'; $('interaction-mode').value = 'edit';
    $('empty-hint').hidden = true; $('save').disabled = false; clearExport();
    photoView.reset(); cameraView.reset(); photoMagnifier.reset(); cameraMagnifier.reset();
    syncControls(); syncViewControls(); render();
  }
});
syncControls();
syncViewControls();
render();
for (const id of ['image-file', 'image-file-native']) $(id).disabled = false;
$('image-trigger').removeAttribute('aria-disabled');
document.body.dataset.appState = 'ready';
$('status').dataset.state = 'ready';
message('画像を読み込み、枠を直接動かして合わせてください。2本指で表示を拡大できます。');
