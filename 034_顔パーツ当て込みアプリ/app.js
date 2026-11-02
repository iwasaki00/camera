import { Camera } from './camera.js';
import { PartRenderer, sourceRect } from './renderer.js';
import { TouchEditor, sourceFromBox } from './editor.js';

const $ = id => document.getElementById(id);
const canvas = $('composition'), ctx = canvas.getContext('2d');
const video = $('camera'), camera = new Camera(video), renderer = new PartRenderer();
const state = { image: null, running: false, mirror: true, guide: true,
  parts: [{ id: 'mouth', x: 50, y: 65, width: 24, height: 10, rotation: 0, feather: 20, shape: 'oval' }],
  source: { x: .5, y: .65, zoom: 1.5 } };
let frame = 0, imageGeneration = 0, exportUrl = null;
let photoEditor, cameraEditor;
const controls = [];
const message = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };

function syncControls() {
  for (const { key, input, output, unit } of controls) {
    input.value = Number(state.parts[0][key].toFixed(1)); output.value = `${input.value}${unit}`;
  }
  $('quick-feather').value = state.parts[0].feather;
  $('quick-feather-value').value = `${Math.round(state.parts[0].feather)}%`;
  $('source-zoom').value = state.source.zoom;
  $('source-zoom-value').value = `${state.source.zoom.toFixed(2)}×`;
  for (const key of ['x', 'y']) {
    $(`source-${key}`).value = (state.source[key] * 100).toFixed(1);
    $(`source-${key}-value`).value = `${(state.source[key] * 100).toFixed(1)}%`;
  }
}
function update() { syncControls(); render(); }

for (const [key, title, min, max, step, unit] of [
  ['x', 'X座標', 0, 100, .1, '%'], ['y', 'Y座標', 0, 100, .1, '%'],
  ['width', '幅', 1, 100, .1, '%'], ['height', '高さ', 1, 100, .1, '%'],
  ['rotation', '回転角', -180, 180, 1, '°'], ['feather', 'Feather / 境界ぼかし', 0, 100, 1, '%']
]) {
  const label = document.createElement('label'); label.className = 'slider-label'; label.htmlFor = `part-${key}`;
  const output = document.createElement('output'); output.htmlFor = `part-${key}`;
  const input = document.createElement('input'); input.id = `part-${key}`; input.type = 'range';
  Object.assign(input, { min, max, step, value: state.parts[0][key] });
  output.value = `${input.value}${unit}`; label.append(title, output);
  input.addEventListener('input', () => { state.parts[0][key] = Number(input.value); update(); });
  controls.push({ key, input, output, unit });
  $('part-controls').append(label, input);
}
for (const [key, title] of [['x', 'カメラ側 / X'], ['y', 'カメラ側 / Y']]) {
  const label = document.createElement('label'); label.className = 'slider-label'; label.htmlFor = `source-${key}`;
  const output = document.createElement('output'); output.id = `source-${key}-value`; output.htmlFor = label.htmlFor;
  const input = document.createElement('input'); Object.assign(input, { id: label.htmlFor, type: 'range', min: 0, max: 100, step: .1 });
  label.append(title, output); $('source-controls').append(label, input);
  input.addEventListener('input', () => { state.source[key] = Number(input.value) / 100; update(); });
}

function renderComposite(target, guide) {
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  if (state.image) target.drawImage(state.image, 0, 0, target.canvas.width, target.canvas.height);
  for (const part of state.parts) renderer.draw(target, state.running ? video : null, part, state.source, state.mirror, guide);
}
function render() {
  renderComposite(ctx, false);
  photoEditor?.draw();
  const preview = $('camera-preview'), c = preview.getContext('2d');
  c.clearRect(0, 0, preview.width, preview.height);
  if (!state.running || video.readyState < 2 || !video.videoWidth) { cameraEditor?.draw(); return; }
  const height = Math.round(preview.width * video.videoHeight / video.videoWidth);
  if (preview.height !== height) preview.height = height;
  c.save(); if (state.mirror) { c.translate(preview.width, 0); c.scale(-1, 1); }
  c.drawImage(video, 0, 0, preview.width, preview.height); c.restore();
  cameraEditor?.draw();
}
function tick() { render(); frame = state.running ? requestAnimationFrame(tick) : 0; }
function stopCamera(text = 'カメラを停止しました。再開するには「カメラ開始」を押してください。') {
  cameraEditor?.cancel();
  camera.stop(); state.running = false; cancelAnimationFrame(frame); frame = 0;
  $('start').disabled = false; $('stop').disabled = true;
  $('camera-state').textContent = '停止中'; $('camera-hint').hidden = false;
  render(); message(text);
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
$('mirror').addEventListener('change', event => { cameraEditor.cancel(); state.mirror = event.target.checked; render(); });
$('guide').addEventListener('change', event => { photoEditor.cancel(); cameraEditor.cancel(); state.guide = event.target.checked; render(); });
$('shape').addEventListener('change', event => { state.parts[0].shape = event.target.value; render(); });
$('source-zoom').addEventListener('input', event => {
  state.source.zoom = Number(event.target.value); update();
});
$('quick-feather').addEventListener('input', event => {
  state.parts[0].feather = Number(event.target.value); update();
});

$('image-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const generation = ++imageGeneration, url = URL.createObjectURL(file);
  message('画像を読み込んでいます…');
  try {
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
    $('empty-hint').hidden = true; $('save').disabled = false; clearExport(); render();
    message('画像を読み込みました。口領域の位置・大きさを合わせてください。');
  } catch {
    if (generation === imageGeneration) message('画像を読み込めませんでした。JPEG・PNGなどSafariで開ける画像を選んでください。', true);
  } finally { URL.revokeObjectURL(url); event.target.value = ''; }
});
function clearExport() {
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = null; $('export-result').hidden = true; $('export-image').removeAttribute('src'); $('download').removeAttribute('href');
}
$('save').addEventListener('click', async () => {
  if (!state.image) return;
  $('save').disabled = true;
  try {
    const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
    renderComposite(output.getContext('2d'), false);
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
document.addEventListener('visibilitychange', () => { if (document.hidden) { photoEditor.cancel(); stopCamera(); } });
window.addEventListener('pagehide', () => { photoEditor.cancel(); stopCamera(); clearExport(); });
photoEditor = new TouchEditor(canvas, {
  color: '#24e3cd', enabled: () => state.guide && !!state.image,
  getBox: size => { const p = state.parts[0]; return { x: p.x / 100 * size.width, y: p.y / 100 * size.height,
    width: p.width / 100 * size.width, height: p.height / 100 * size.height, angle: p.rotation * Math.PI / 180 }; },
  change: (box, size) => {
    Object.assign(state.parts[0], { x: box.x / size.width * 100, y: box.y / size.height * 100,
      width: box.width / size.width * 100, height: box.height / size.height * 100, rotation: box.angle * 180 / Math.PI });
    update();
  }
});
cameraEditor = new TouchEditor($('camera-preview'), {
  color: '#ffba69', rotation: false,
  enabled: () => state.guide && state.running && video.readyState >= 2,
  getBox: size => {
    if (!video.videoWidth) return null;
    const p = state.parts[0], crop = sourceRect(video.videoWidth, video.videoHeight,
      canvas.width * p.width / (canvas.height * p.height), state.source, state.mirror);
    return { x: (crop.visualX + crop.width / 2) / video.videoWidth * size.width,
      y: (crop.y + crop.height / 2) / video.videoHeight * size.height,
      width: crop.width / video.videoWidth * size.width, height: crop.height / video.videoHeight * size.height, angle: 0 };
  },
  change: (box, size, drag) => {
    if (drag.action.type === 'move') {
      // Use the visible crop center at drag start, avoiding a jump after edge clamping.
      const p = state.parts[0], aspect = canvas.width * p.width / (canvas.height * p.height);
      const result = sourceFromBox({ ...box, width: drag.box.width, height: drag.box.height }, size, aspect);
      state.source.x = result.x; state.source.y = result.y;
    } else {
      const p = state.parts[0], aspect = canvas.width * p.width / (canvas.height * p.height);
      const next = sourceFromBox(box, size, aspect);
      const width = Math.min(size.width * .6 / next.zoom, size.height * aspect), height = width / aspect;
      // Keep the opposite corner fixed while preserving the source aspect ratio.
      const anchored = { ...box, width, height,
        x: drag.box.x + drag.action.sx * (width - drag.box.width) / 2,
        y: drag.box.y + drag.action.sy * (height - drag.box.height) / 2 };
      Object.assign(state.source, sourceFromBox(anchored, size, aspect));
    }
    update();
  },
  outsideTap: (point, size) => { state.source.x = point.x / size.width; state.source.y = point.y / size.height; update(); }
});
syncControls();
render();
