import { Camera } from './camera.js';
import { PartRenderer, sourceRect } from './renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('composition'), ctx = canvas.getContext('2d');
const video = $('camera'), camera = new Camera(video), renderer = new PartRenderer();
const state = { image: null, running: false, mirror: true, guide: true,
  parts: [{ id: 'mouth', x: 50, y: 65, width: 24, height: 10, rotation: 0, feather: 20, shape: 'oval' }],
  source: { x: .5, y: .65, zoom: 1.5 } };
let frame = 0, imageGeneration = 0, exportUrl = null;
const message = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };

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
  input.addEventListener('input', () => { state.parts[0][key] = Number(input.value); output.value = `${input.value}${unit}`; render(); });
  $('part-controls').append(label, input);
}

function renderComposite(target, guide) {
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  if (state.image) target.drawImage(state.image, 0, 0, target.canvas.width, target.canvas.height);
  for (const part of state.parts) renderer.draw(target, state.running ? video : null, part, state.source, state.mirror, guide);
}
function render() {
  renderComposite(ctx, state.guide && !!state.image);
  const preview = $('camera-preview'), c = preview.getContext('2d');
  c.clearRect(0, 0, preview.width, preview.height);
  if (!state.running || video.readyState < 2 || !video.videoWidth) return;
  const height = Math.round(preview.width * video.videoHeight / video.videoWidth);
  if (preview.height !== height) preview.height = height;
  c.save(); if (state.mirror) { c.translate(preview.width, 0); c.scale(-1, 1); }
  c.drawImage(video, 0, 0, preview.width, preview.height); c.restore();
  const part = state.parts[0];
  const crop = sourceRect(video.videoWidth, video.videoHeight,
    (canvas.width * part.width) / (canvas.height * part.height), state.source, state.mirror);
  const scale = preview.width / video.videoWidth;
  c.strokeStyle = '#24e3cd'; c.lineWidth = 3;
  c.strokeRect(crop.visualX * scale, crop.y * scale, crop.width * scale, crop.height * scale);
}
function tick() { render(); frame = state.running ? requestAnimationFrame(tick) : 0; }
function stopCamera(text = 'カメラを停止しました。再開するには「カメラ開始」を押してください。') {
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
    message('カメラ画面で口元をタップし、写真の口に合うように調整してください。'); tick();
  } catch (error) {
    stopCamera();
    const messages = { NotAllowedError: 'カメラが許可されていません。Safariのサイト設定で許可してください。',
      NotFoundError: 'カメラが見つかりません。', NotReadableError: 'カメラを使用できません。他のアプリを閉じて再度お試しください。',
      UNSUPPORTED: 'カメラを利用するには HTTPS または localhost で開いてください。' };
    message(messages[error.name] || messages[error.message] || 'カメラを開始できませんでした。再度お試しください。', true);
  }
});
$('stop').addEventListener('click', () => stopCamera());
$('mirror').addEventListener('change', event => { state.mirror = event.target.checked; render(); });
$('guide').addEventListener('change', event => { state.guide = event.target.checked; render(); });
$('shape').addEventListener('change', event => { state.parts[0].shape = event.target.value; render(); });
$('source-zoom').addEventListener('input', event => {
  state.source.zoom = Number(event.target.value); $('source-zoom-value').value = `${state.source.zoom.toFixed(1)}×`; render();
});
$('camera-preview').addEventListener('pointerdown', event => {
  if (!state.running) return;
  const rect = event.currentTarget.getBoundingClientRect();
  state.source.x = (event.clientX - rect.left) / rect.width;
  state.source.y = (event.clientY - rect.top) / rect.height; render();
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
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', () => { stopCamera(); clearExport(); });
render();
