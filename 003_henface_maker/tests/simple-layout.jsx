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
localStorage.removeItem('henface.layout');
localStorage.removeItem('henface.randomStrength');
localStorage.removeItem('henface.settingsOpen');
let root = createRoot(document.querySelector('#app'));
const remount = async () => { root.unmount(); root = createRoot(document.querySelector('#app')); root.render(<App />); await tick(); };
root.render(<App />);
await tick();
try {
  assert('初回起動はsimple/monster', document.querySelector('[aria-label="レイアウト"]').value === 'simple' && document.querySelector('[aria-label="ランダム強度"]').value === 'monster');
  assert('初回は縦長全画面と右上ランダム', document.querySelector('.preview-frame').clientHeight > 700 && visible(document.querySelector('.simple-random-button')));
  document.querySelector('.simple-random-button').click(); await tick();
  assert('初回のsimpleランダムはmonster', document.querySelector('.diagnosis').textContent.includes('monster'));
  await select('レイアウト', 'compact'); await select('ランダム強度', 'weak');
  await remount();
  assert('再起動で保存済みcompact/weakを復元', document.querySelector('[aria-label="レイアウト"]').value === 'compact' && document.querySelector('[aria-label="ランダム強度"]').value === 'weak');
  await select('レイアウト', 'simple'); document.querySelector('.simple-random-button').click(); await tick();
  assert('simpleでも復元した強度を使用', document.querySelector('.diagnosis').textContent.includes('weak'));
  localStorage.setItem('henface.layout', 'unknown'); localStorage.setItem('henface.randomStrength', 'unknown');
  await remount();
  assert('不正な保存値はsimple/monsterへ復帰', document.querySelector('[aria-label="レイアウト"]').value === 'simple' && document.querySelector('[aria-label="ランダム強度"]').value === 'monster');
  assert('不正値を安全な値で保存し直す', localStorage.getItem('henface.layout') === 'simple' && localStorage.getItem('henface.randomStrength') === 'monster');
  localStorage.setItem('henface.layout', 'compact'); localStorage.setItem('henface.settingsOpen', '1');
  await remount();
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
  document.querySelector('.game-entry-button').click(); await tick();
  assert('瞬きキャッチ開始画面へ切替', document.querySelector('.game-start-panel h2').textContent === '瞬きキャッチ');
  assert('ゲーム中は通常編集UIを非表示', !visible(document.querySelector('.settings-toggle')) && !visible(document.querySelector('.extra-tools')));
  assert('ゲーム画面を縦いっぱいに表示', document.querySelector('.preview-frame').clientHeight > 740);
  document.querySelector('.game-header-exit').click(); await tick();
  assert('通常モードへ戻れる', !document.querySelector('.game-start-panel') && visible(document.querySelector('.game-entry-button')));
  results.push('viewport ' + innerWidth + '×' + innerHeight);
  document.documentElement.dataset.result = 'pass';
} catch (error) {
  results.push(error.stack); document.documentElement.dataset.result = 'fail';
}
document.querySelector('#results').textContent = results.join('\n');
