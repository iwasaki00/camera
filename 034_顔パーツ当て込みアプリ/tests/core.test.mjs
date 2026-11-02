import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../camera.js';
import { PartRenderer, sourceRect } from '../renderer.js';

test('source crop stays inside the video at either edge, for both mirror modes', () => {
  for (const mirror of [true, false]) for (const x of [0, .5, 1]) for (const y of [0, 1]) {
    const crop = sourceRect(1280, 720, 2.5, { x, y, zoom: 1.5 }, mirror);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= 1280 && crop.y + crop.height <= 720);
    assert.equal(crop.width / crop.height, 2.5);
  }
});
test('portrait crop fits the video and mirror maps the selected visual location', () => {
  const a = sourceRect(720, 1280, .1, { x: .2, y: .5, zoom: 2 }, false);
  const b = sourceRect(720, 1280, .1, { x: .2, y: .5, zoom: 2 }, true);
  assert.equal(a.height, 1280);
  assert.equal(b.x, 720 - a.x - a.width);
});
function fixture(getUserMedia) {
  let stops = 0;
  const stream = { getTracks: () => [{ stop() { stops++; } }] };
  const video = { srcObject: null, play: async () => {}, pause() {} };
  return { camera: new Camera(video, { getUserMedia: getUserMedia || (async () => stream) }), video, stream, stops: () => stops };
}
test('camera requests front camera without audio and releases tracks on stop', async () => {
  let options;
  const f = fixture(async constraints => { options = constraints; return f.stream; });
  assert.equal(await f.camera.start(), true);
  assert.equal(options.audio, false);
  assert.equal(options.video.facingMode.ideal, 'user');
  assert.equal(f.video.srcObject, f.stream);
  assert.equal(f.video.playsInline, true);
  f.camera.stop(); assert.equal(f.stops(), 1); assert.equal(f.video.srcObject, null);
});
test('stop during a pending camera permission request releases the late stream', async () => {
  let resolve;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.camera.start(); f.camera.stop(); resolve(f.stream);
  assert.equal(await pending, false); assert.equal(f.stops(), 1); assert.equal(f.video.srcObject, null);
});
test('permission denial is propagated and leaves the video detached', async () => {
  const f = fixture(async () => { throw new DOMException('denied', 'NotAllowedError'); });
  await assert.rejects(f.camera.start(), { name: 'NotAllowedError' });
  assert.equal(f.video.srcObject, null); assert.equal(f.camera.stream, null);
});
test('playback failure releases the camera', async () => {
  const f = fixture(); f.video.play = async () => { throw new Error('play failed'); };
  await assert.rejects(f.camera.start(), /play failed/);
  assert.ok(f.stops() >= 1); assert.equal(f.video.srcObject, null);
});
test('older permission requests cannot replace a newer stream', async () => {
  const resolves = [];
  const f = fixture(() => new Promise(r => resolves.push(r)));
  const first = f.camera.start(), second = f.camera.start();
  resolves[1](f.stream); assert.equal(await second, true);
  let oldStops = 0; resolves[0]({ getTracks: () => [{ stop() { oldStops++; } }] });
  assert.equal(await first, false); assert.equal(oldStops, 1); assert.equal(f.video.srcObject, f.stream);
});
function maskFixture() {
  const canvases = [];
  const renderer = new PartRenderer(() => {
    const canvas = { width: 0, height: 0, getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: image => { canvas.image = image; }
    }) }; canvases.push(canvas); return canvas;
  });
  return { renderer, alpha: (x, y) => canvases[1].image.data[(y * canvases[1].width + x) * 4 + 3] };
}
test('oval mask has transparent corners, opaque center, and feathered inner edge', () => {
  const f = maskFixture(); f.renderer.prepareMask(100, 50, { shape: 'oval', feather: 50 });
  assert.equal(f.alpha(0, 0), 0); assert.equal(f.alpha(50, 25), 255);
  assert.ok(f.alpha(50, 3) > 0 && f.alpha(50, 3) < 255);
});
test('rectangle mask, zero feather, and changed shape invalidate the mask', () => {
  const f = maskFixture(); f.renderer.prepareMask(100, 50, { shape: 'oval', feather: 0 });
  assert.equal(f.alpha(0, 0), 0);
  f.renderer.prepareMask(100, 50, { shape: 'rectangle', feather: 0 });
  assert.equal(f.alpha(0, 0), 255);
  f.renderer.prepareMask(100, 50, { shape: 'rectangle', feather: 40 });
  assert.ok(f.alpha(0, 0) < 255); assert.equal(f.alpha(50, 25), 255);
});
