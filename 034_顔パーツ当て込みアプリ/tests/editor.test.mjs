import test from 'node:test';
import assert from 'node:assert/strict';
import { dragBox, handles, hitTest, rotate, sourceFromBox } from '../editor.js';
const bounds = { width: 400, height: 600 };
const box = { x: 200, y: 300, width: 100, height: 50, angle: 0 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('move uses a relative delta without snapping the center to the pointer', () => {
  const result = dragBox(box, { x: 210, y: 303 }, { x: 240, y: 323 }, { type: 'move' }, bounds);
  assert.equal(result.x, 230); assert.equal(result.y, 320); assert.equal(result.width, 100);
  assert.equal(dragBox(box, { x: 0, y: 0 }, { x: -999, y: 999 }, { type: 'move' }, bounds).x, 0);
});
test('all four resize handles preserve the opposite corner on rotated parts', () => {
  for (const angle of [0, Math.PI / 4, -Math.PI / 2]) for (const action of handles({ ...box, angle }, false)) {
    const start = { ...box, angle }, from = action;
    const delta = rotate({ x: action.sx * 20, y: action.sy * 10 }, angle);
    const result = dragBox(start, from, { x: from.x + delta.x, y: from.y + delta.y }, action, bounds);
    const before = rotate({ x: -action.sx * start.width / 2, y: -action.sy * start.height / 2 }, angle);
    const after = rotate({ x: -action.sx * result.width / 2, y: -action.sy * result.height / 2 }, angle);
    near(start.x + before.x, result.x + after.x); near(start.y + before.y, result.y + after.y);
    near(result.width, 120); near(result.height, 60);
  }
});
test('resize cannot invert or create a zero-size part', () => {
  const result = dragBox(box, { x: 250, y: 325 }, { x: -999, y: -999 }, { type: 'resize', sx: 1, sy: 1 }, bounds);
  assert.equal(result.width, 4); assert.equal(result.height, 6);
});
test('rotation is relative, normalized, and preserves size and center', () => {
  const result = dragBox(box, { x: 200, y: 245 }, { x: 255, y: 300 }, { type: 'rotate' }, bounds);
  near(result.angle, Math.PI / 2); assert.equal(result.x, 200); assert.equal(result.width, 100);
});
test('hit regions use CSS pixels, work when rotated, and favor nearest handle', () => {
  assert.equal(hitTest({ x: 200, y: 300 }, box).type, 'move');
  const rotated = { ...box, angle: .8 };
  const handle = handles(rotated)[2];
  assert.equal(hitTest({ x: handle.x + 14, y: handle.y }, rotated).type, 'resize');
  assert.equal(hitTest(handles(rotated)[4], rotated).type, 'rotate');
  assert.equal(hitTest({ x: 5, y: 5 }, box), null);
  assert.equal(hitTest({ x: 200, y: 300 }, { ...box, width: 22, height: 12 }).type, 'move');
});
test('source resize keeps aspect ratio, clamps zoom and center, and does not jump on unchanged input', () => {
  const size = { width: 320, height: 240 };
  const source = sourceFromBox({ x: 160, y: 120, width: 128, height: 64 }, size, 2);
  near(source.zoom, 1.5); near(source.x, .5); near(source.y, .5);
  const smaller = sourceFromBox({ x: -100, y: 500, width: 64, height: 32 }, size, 2);
  near(smaller.zoom, 3); near(smaller.x, .1); near(smaller.y, 1 - 16 / 240);
  const extreme = sourceFromBox({ x: 160, y: 120, width: 1000, height: 1000 }, size, 2);
  assert.equal(extreme.zoom, 1);
});
