import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/styles.css';

const results = [];
const assert = (name, ok) => { results.push((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) throw Error(name); };
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
const select = async (label, value) => {
  const element = document.querySelector('[aria-label="' + label + '"]');
  element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await tick();
};
const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none';
localStorage.setItem('henface.layout', 'compact');
localStorage.setItem('henface.settingsOpen', '1');
createRoot(document.querySelector('#app')).render(<App />);
await tick();
try {
  const camera = document.querySelector('canvas');
  const toggle = document.querySelector('.settings-toggle');
  const size = document.querySelector('[aria-label="大きくする / 小さくする"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(size, '130');
  size.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  await select('ランダム強度', 'monster');
  const beforeHeight = document.querySelector('.preview-frame').clientHeight;
  await select('レイアウト', 'simple');
  assert('simpleを保存・選択', localStorage.getItem('henface.layout') === 'simple');
  assert('下部設定をすべて非表示', ['.settings-toggle', '.controls-card', '.extra-tools'].every(selector => !visible(document.querySelector(selector))));
  assert('エフェクトと強度を保持', size.value === '130' && document.querySelector('[aria-label="ランダム強度"]').value === 'monster');
  assert('canvasノードを維持', document.querySelector('canvas') === camera);
  const frame = document.querySelector('.preview-frame');
  const random = document.querySelector('.simple-random-button');
  const f = frame.getBoundingClientRect(), b = random.getBoundingClientRect();
  assert('右上ボタン44px以上・枠内', b.width >= 44 && b.height >= 44 && b.top >= f.top + 8 && b.right <= f.right - 8 && b.right >= f.right - 20);
  assert('カメラ枠を縦に拡大', frame.clientHeight > beforeHeight);
  assert('横スクロールなし', document.documentElement.scrollWidth <= innerWidth);
  assert('主要UIが画面内', f.bottom <= innerHeight && b.bottom <= f.bottom);
  assert('映像を比率維持で枠いっぱいに拡大', getComputedStyle(camera).objectFit === 'cover');
  assert('画面下端までカメラ表示', Math.abs(f.bottom - (innerHeight - 9)) < 3);
  // Deterministic alternating draws verify successive taps execute the same live handler.
  const originalRandom = Math.random;
  for (const value of [.1, .9, .2]) {
    Math.random = () => value;
    const previous = size.value;
    random.click(); await tick();
    assert('連続ランダムが反映 ' + value, size.value !== previous && document.querySelector('.diagnosis').textContent.includes('monster'));
  }
  Math.random = originalRandom;
  const randomized = size.value;
  for (const layout of ['standard', 'compact', 'edge-controls']) {
    await select('レイアウト', layout);
    assert(layout + 'の編集UIと状態を復元', visible(toggle) && visible(document.querySelector('.controls-card')) && visible(document.querySelector('.extra-tools')) && size.value === randomized);
    assert(layout + 'のsimpleボタンなし', !document.querySelector('.simple-random-button'));
    assert(layout + 'の映像表示方式を維持', getComputedStyle(camera).objectFit === 'contain');
  }
  toggle.click(); await tick(); await select('レイアウト', 'simple'); await select('レイアウト', 'compact');
  assert('閉じていた編集状態も保持', document.querySelector('.controls-card').hidden && localStorage.getItem('henface.settingsOpen') === '0');
  await select('レイアウト', 'simple');
  frame.style.aspectRatio = '16 / 9';
  assert('縦横比変更後も右上位置維持', Math.abs(document.querySelector('.simple-random-button').getBoundingClientRect().right - b.right) < 1);
  results.push('viewport ' + innerWidth + '×' + innerHeight);
  document.documentElement.dataset.result = 'pass';
} catch (error) {
  results.push(error.stack); document.documentElement.dataset.result = 'fail';
}
document.querySelector('#results').textContent = results.join('\n');
