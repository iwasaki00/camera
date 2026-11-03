import test from 'node:test';
import assert from 'node:assert/strict';
import { PartCollection, PART_TYPES, createPart, migrateMouth, orderedParts, sourceForDisplay, setDisplaySource } from '../parts.js';
import { CompositeRenderer, sourceRect } from '../renderer.js';

test('initial mouth preserves v0.1.2 geometry and settings', () => {
  const c = new PartCollection(); assert.equal(c.parts.length, 1);
  assert.equal(c.selected.id, 'mouth'); assert.equal(c.selected.enabled, true);
  assert.deepEqual(c.selected.targetRect, { x: 50, y: 65, width: 24, height: 10 });
  assert.deepEqual(sourceForDisplay(c.selected, true), { x: .5, y: .65, zoom: 1.5 });
});
test('migration copies custom mouth settings and keeps the same crop under mirror', () => {
  const legacy = { x: 24, y: 67, width: 31, height: 12, rotation: 38, shape: 'rectangle', feather: 62 };
  const source = { x: .25, y: .7, zoom: 3 };
  const part = migrateMouth(legacy, source, true);
  assert.deepEqual(part.targetRect, { x: 24, y: 67, width: 31, height: 12 });
  assert.equal(part.rotation, 38); assert.equal(part.shape, 'rectangle'); assert.equal(part.feather, 62);
  assert.deepEqual(sourceForDisplay(part, true), source);
  part.targetRect.x = 12; part.sourceRect.y = .2;
  assert.equal(legacy.x, 24); assert.equal(source.y, .7);
});
test('all four types can be added, and unknown types cannot exceed the limit', () => {
  const c = new PartCollection(); for (const type of Object.keys(PART_TYPES)) c.add(type);
  assert.equal(c.parts.length, 4); assert.equal(new Set(c.parts.map(p => p.id)).size, 4);
  for (const p of c.parts.filter(p => p.id !== 'mouth')) assert.deepEqual([p.targetRect.x, p.targetRect.y], [50, 50]);
  assert.equal(c.add('extra'), null); assert.equal(c.add('__proto__'), null); assert.equal(c.parts.length, 4);
});
test('adding an existing type selects it without overwriting any settings', () => {
  const c = new PartCollection(); const eye = c.add('leftEye'); eye.rotation = 32; eye.enabled = false;
  c.add('nose'); assert.equal(c.add('leftEye'), eye); assert.equal(c.selected, eye);
  assert.equal(eye.rotation, 32); assert.equal(eye.enabled, false); assert.equal(c.parts.length, 3);
});
test('each target, source, rotation, feather and shape is independent', () => {
  const c = new PartCollection(); const left = c.add('leftEye'), right = c.add('rightEye');
  const before = structuredClone(right);
  left.targetRect.x = 14; left.sourceRect.x = .8; left.sourceRect.zoom = 5;
  left.rotation = 48; left.feather = 85; left.shape = 'rectangle';
  left.guides.photo = false;
  assert.deepEqual(right, before); assert.notEqual(left.targetRect, right.targetRect); assert.notEqual(left.sourceRect, right.sourceRect);
});
test('selection changes never mutate model settings and invalid selection is ignored', () => {
  const c = new PartCollection(); c.add('leftEye'); const before = structuredClone(c.parts);
  assert.equal(c.select('mouth'), true); assert.equal(c.select('missing'), false);
  assert.equal(c.selected.id, 'mouth'); assert.deepEqual(c.parts, before);
});
test('deletion and disabled state differ; re-adding a deleted type creates a fresh center placement', () => {
  const c = new PartCollection(); c.selected.enabled = false;
  assert.equal(c.parts.length, 1); c.selected.targetRect.x = 12;
  assert.equal(c.removeSelected(), true); assert.equal(c.selected, null);
  const mouth = c.add('mouth'); assert.equal(mouth.enabled, true); assert.equal(mouth.targetRect.x, 50); assert.equal(mouth.targetRect.y, 50);
});
test('deleting the selected part safely falls back until all parts are gone', () => {
  const c = new PartCollection(); c.add('leftEye'); c.add('rightEye'); c.add('nose');
  for (let remaining = 3; remaining >= 0; remaining--) {
    assert.equal(c.removeSelected(), true); assert.equal(c.parts.length, remaining);
    assert.equal(!!c.selected, remaining > 0);
  }
  assert.equal(c.removeSelected(), false); assert.equal(c.reorder(1), false);
});
test('mirror changes visual orientation but retains the same physical eye crop', () => {
  const p = createPart('leftEye'); p.sourceRect = { x: .7, y: .4, zoom: 4 };
  const original = structuredClone(p.sourceRect);
  const a = sourceRect(1280, 720, 2, sourceForDisplay(p, false), false);
  const b = sourceRect(1280, 720, 2, sourceForDisplay(p, true), true);
  assert.ok(Math.abs(a.x - b.x) < 1e-8); assert.equal(a.y, b.y); assert.deepEqual(p.sourceRect, original);
  setDisplaySource(p, { x: .2, y: .3, zoom: 5 }, true);
  assert.deepEqual(p.sourceRect, { x: .8, y: .3, zoom: 5 });
});
test('layer moves include disabled parts and leave all other settings intact', () => {
  const c = new PartCollection(); c.add('leftEye'); c.add('nose'); c.select('mouth');
  const before = structuredClone(c.selected.targetRect); c.parts[1].enabled = false;
  c.reorder(1); c.reorder(1); assert.equal(orderedParts(c.parts).at(-1).id, 'mouth');
  assert.equal(c.reorder(1), false); c.reorder(-1); c.reorder(-1);
  assert.equal(orderedParts(c.parts)[0].id, 'mouth'); assert.deepEqual(c.selected.targetRect, before);
});
function rendererFixture() {
  const calls = [], instances = [];
  const renderer = new CompositeRenderer(() => { const instance = { draw: (...args) => calls.push(args) }; instances.push(instance); return instance; });
  return { renderer, calls, instances };
}
test('composite draws enabled parts in z order with independent crop and mask settings', () => {
  const c = new PartCollection(); c.add('leftEye'); c.add('rightEye'); c.add('nose');
  c.parts[1].enabled = false; c.parts[0].zIndex = 8;
  c.parts[0].rotation = 44; c.parts[0].feather = 66; c.parts[2].shape = 'rectangle';
  const f = rendererFixture(), ctx = {}, video = {};
  f.renderer.draw(ctx, video, c.parts, true);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map(call => call[3].x), [.65, .5, .5]);
  assert.equal(f.calls[0][2].shape, 'rectangle'); assert.equal(f.calls[0][2].rotation, 0);
  assert.equal(f.calls[2][2].rotation, 44); assert.equal(f.calls[2][2].feather, 66);
  assert.ok(f.calls.every(call => call[5] === false)); // No guides enter the export canvas.
});
test('each part retains its own renderer between frames and disable/enable cycles', () => {
  const c = new PartCollection(); c.add('nose'); const f = rendererFixture();
  f.renderer.draw({}, {}, c.parts, true); const mouthRenderer = f.renderer.renderers.get('mouth');
  c.parts[0].enabled = false; f.renderer.draw({}, {}, c.parts, true);
  c.parts[0].enabled = true; f.renderer.draw({}, {}, c.parts, true);
  assert.equal(f.instances.length, 2); assert.equal(f.renderer.renderers.get('mouth'), mouthRenderer);
});
test('deleting a part releases its renderer without evicting other parts', () => {
  const c = new PartCollection(); c.add('nose'); const f = rendererFixture();
  f.renderer.draw({}, {}, c.parts, true); c.removeSelected(); f.renderer.draw({}, {}, c.parts, true);
  assert.equal(f.renderer.renderers.size, 1); assert.equal(f.renderer.renderers.has('mouth'), true);
  c.add('nose'); f.renderer.draw({}, {}, c.parts, true); assert.equal(f.instances.length, 3);
});
