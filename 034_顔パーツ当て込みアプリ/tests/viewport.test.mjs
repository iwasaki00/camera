import test from 'node:test';
import assert from 'node:assert/strict';
import { toContent, toScreen, zoomAt, midpoint, distance } from '../viewport.js';
import { dragBox, hitTest } from '../editor.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('coordinate conversion round-trips with padding and independent pan at 50/100/200/400%', () => {
  const origin = { x: 63.25, y: 12.5 }, point = { x: 154.3, y: 217.8 };
  for (const scale of [.5, 1, 2, 4]) {
    const view = { scale, x: -123.5, y: 17.3 }, result = toContent(toScreen(point, view, origin), view, origin);
    near(result.x, point.x); near(result.y, point.y);
  }
});
test('pinch keeps the initial content anchor under the moving pinch center', () => {
  const origin = { x: 45, y: 0 }, view = { scale: 1.5, x: -20, y: 10 };
  const from = { x: 130, y: 140 }, to = { x: 160, y: 175 };
  for (const scale of [.5, 2, 4]) {
    const next = zoomAt(view, origin, from, to, scale);
    const anchor = toContent(from, view, origin), mapped = toScreen(anchor, next, origin);
    near(mapped.x, to.x); near(mapped.y, to.y);
  }
});
test('same finger motion maps to correct model delta at 100/200/400% on rotated parts', () => {
  const origin = { x: 55, y: 0 }, bounds = { width: 300, height: 450 };
  const box = { x: 150, y: 200, width: 90, height: 45, angle: Math.PI / 4 };
  for (const scale of [1, 2, 4]) {
    const view = { scale, x: -50, y: -100 }, from = toScreen(box, view, origin), to = { x: from.x + 20, y: from.y - 12 };
    const action = hitTest(from, { ...box, ...from, width: box.width * scale, height: box.height * scale });
    assert.equal(action.type, 'move');
    const result = dragBox(box, toContent(from, view, origin), toContent(to, view, origin), action, bounds);
    near(result.x - box.x, 20 / scale); near(result.y - box.y, -12 / scale);
  }
});
test('pinch distance and center do not depend on pointer ordering', () => {
  const a = { x: 20, y: 40 }, b = { x: 80, y: 120 };
  assert.deepEqual(midpoint(a, b), midpoint(b, a)); near(distance(a, b), 100);
});
