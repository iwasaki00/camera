import assert from "node:assert/strict";
import { EncounterDirector, ENCOUNTER_CONFIG } from "../encounters.js";
import { STALKER_CONFIG } from "../stalker.js";

const d = new EncounterDirector(ENCOUNTER_CONFIG, () => 0);
d.update(0);
assert.equal(d.state, "ARMING");
assert.equal(d.update(1), null);
assert.equal(d.update(d.deadline), "PEEK");
assert.equal(d.force("PASS", d.deadline), false);
assert.equal(d.begin(d.deadline), true);
assert.equal(d.state, "EVENT");
assert.equal(d.update(999999), null);
d.finish(100);
assert.equal(d.state, "COOLDOWN");
assert.equal(d.currentEncounter, null);
assert.equal(d.previousEncounter, "PEEK");
d.update(d.deadline);
assert.equal(d.state, "IDLE");
d.previousEncounter = "PEEK";
d.consecutive = 2;
assert.notEqual(d.choose(), "PEEK");
d.previousEncounter = "CLOSE_CALL";
d.consecutive = 1;
d.random = () => .999999;
assert.notEqual(d.choose(), "CLOSE_CALL");
assert.equal(d.force("INVALID", 0), false);

let seed = 12345;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const many = new EncounterDirector(ENCOUNTER_CONFIG, random);
const counts = { PEEK: 0, PASS: 0, FLY_BY: 0, CLOSE_CALL: 0 };
let last = null;
let streak = 0;
for (let i = 0; i < 20000; i++) {
  const type = many.choose();
  counts[type]++;
  streak = type === last ? streak + 1 : 1;
  assert.ok(streak <= 2);
  assert.ok(type !== "CLOSE_CALL" || type !== last);
  many.currentEncounter = type;
  many.finish(i);
  last = type;
}
assert.ok(counts.CLOSE_CALL / 20000 < .08);
assert.ok(Object.values(counts).every(n => n > 0));
for (const profile of Object.values(STALKER_CONFIG.profiles)) {
  const stage = new EncounterDirector(ENCOUNTER_CONFIG, () => 0.5);
  stage.setProfile(profile, 0);
  stage.update(0);
  assert.equal(stage.deadline, (profile.minEncounterDelay + profile.maxEncounterDelay) / 2);
  let cumulative = 0;
  for (const [type, weight] of Object.entries(profile.weights)) {
    stage.random = () => (cumulative + weight / 2) / 100;
    assert.equal(stage.choose(), type);
    cumulative += weight;
  }
  stage.random = () => 0.5;
  stage.setProfile(STALKER_CONFIG.profiles.DANGER, 100);
  assert.equal(stage.profile, STALKER_CONFIG.profiles.DANGER);
  stage.previousEncounter = "CLOSE_CALL";
  stage.consecutive = 1;
  stage.random = () => .99999;
  assert.notEqual(stage.choose(), "CLOSE_CALL");
}
console.log("Encounter Director: transitions, overlap, 20,000 draws passed", counts);
