import test from 'node:test';
import assert from 'node:assert/strict';
import { Viewport, toContent, toScreen, zoomAt, midpoint, distance } from '../viewport.js';
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

const focusView=()=>{
  const view=new Viewport({style:{}});
  view.geometry=()=>({origin:{x:35,y:18},surface:{width:360,height:480}});
  return view;
};
test('focus centers the selected part with letterbox origin and keeps the model untouched',()=>{
  const view=focusView(),box=Object.freeze({x:90,y:210,width:60,height:24,angle:.4});
  view.set({scale:2,x:17,y:-45});view.focus(box);
  const center=toScreen(box,view.view,view.geometry().origin);near(center.x,180);near(center.y,240);
  assert.ok(view.view.scale>=1.5&&view.view.scale<=4);
  assert.deepEqual(view.returnView,{scale:2,x:17,y:-45});
});
test('focus retarget preserves the original manual view and restore returns to it exactly',()=>{
  const view=focusView(),manual={scale:2.25,x:-38.7,y:72.9};view.set(manual);
  view.focus({x:100,y:80,width:40,height:20});view.focus({x:180,y:220,width:60,height:20});
  view.restore();assert.deepEqual(view.view,manual);assert.equal(view.returnView,null);
});
test('manual display changes and whole-image reset finish the focus preset',()=>{
  const view=focusView(),box={x:90,y:210,width:60,height:24};
  view.focus(box);view.zoom(2);assert.equal(view.returnView,null);
  view.focus(box);view.set({...view.view,x:11});assert.equal(view.returnView,null);
  view.focus(box);view.reset();assert.deepEqual(view.view,{scale:1,x:0,y:0});assert.equal(view.returnView,null);
});
test('focus considers rotated bounds and rejects invalid or unavailable geometry',()=>{
  const view=focusView();view.focus({x:100,y:80,width:180,height:20,angle:Math.PI/2});
  near(view.view.scale,480*.6/180);
  const saved=structuredClone(view.view);assert.equal(view.focus({x:NaN,y:0,width:10,height:10}),false);assert.deepEqual(view.view,saved);
  view.geometry=()=>({origin:{x:0,y:0},surface:{width:0,height:0}});
  assert.equal(view.focus({x:5,y:5,width:10,height:10}),false);assert.deepEqual(view.view,saved);
});
