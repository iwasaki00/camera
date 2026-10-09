import assert from "node:assert/strict";
import { Stalker, STALKER_CONFIG } from "../stalker.js";

const s = new Stalker();
assert.equal(s.distance, 85);
for (const [distance, state] of [[100,"FAR"],[75,"FAR"],[74.99,"MID"],[45,"MID"],[44.99,"NEAR"],[20,"NEAR"],[19.99,"DANGER"],[5,"DANGER"]]) {
  s.setDistance(distance);
  assert.equal(s.distanceState, state);
}
s.setDistance(-1); assert.equal(s.distance, 5);
s.setDistance(101); assert.equal(s.distance, 100);
s.setDistance(NaN); assert.equal(s.distance, 100);
assert.equal(s.setRange("INVALID"), false);
for (const range of Object.keys(STALKER_CONFIG.profiles)) {
  s.setRange(range);
  const start = s.distance;
  for (let i=0; i<12; i++) s.update(100, 36, true);
  assert.equal(s.distance, start, "1.2 second grace");
  assert.equal(s.inGrace, false);
  s.update(100, 36, true);
  assert.ok(Math.abs(s.distance - (start - s.profile.approachRate / 10)) < 1e-8);
  const before = s.distance;
  for (const angle of [-35, 0, 35]) s.update(100, angle, true);
  assert.equal(s.distance, before, "LOOKING never heals");
  assert.equal(s.notLookingMs, 0);
  s.update(100, 90, false);
  assert.equal(s.paused, true);
  assert.equal(s.distance, before);
}
const simulate = dt => {
  const x = new Stalker();
  for(let t=0; t<12000; t+=dt) x.update(dt, 90, true);
  return x.distance;
};
assert.ok(Math.abs(simulate(10) - simulate(100)) < 1e-7, "frame-rate independent");
s.setDistance(75.01);
for(let i=0;i<13;i++) s.update(100,90,true);
assert.equal(s.distanceState, "MID");
assert.ok(s.distance < 75);
s.setDistance(5.01);
for(let i=0;i<70;i++) s.update(100,90,true);
assert.equal(s.distance, 5);
assert.equal(s.approachRate, 0);
s.retreat(); assert.equal(s.distance, 20);
s.setDistance(95); s.retreat(); assert.equal(s.distance, 100);
s.reset(); s.update(100000,90,true);
assert.equal(s.distance, 85, "large delta cannot catch up in background");
assert.equal(s.notLookingMs, 100);
s.update(100,NaN,true); assert.equal(s.paused, true);
s.reset(); assert.equal(s.distance,85);
console.log("Stalker: ranges, grace, rates, frame independence, limits, pause and retreat passed");
