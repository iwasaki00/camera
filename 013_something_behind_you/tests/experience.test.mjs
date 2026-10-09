import assert from "node:assert/strict";
import { Stalker, STALKER_CONFIG } from "../stalker.js";
import { EncounterDirector, ENCOUNTER_CONFIG } from "../encounters.js";
import { PresenceDirector, PRESENCE_CONFIG } from "../presence.js";

let seed = 20261009;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const distance = new Stalker(STALKER_CONFIG, random);
const encounter = new EncounterDirector(ENCOUNTER_CONFIG, random);
const presence = new PresenceDirector(PRESENCE_CONFIG, random);
const counts = { PEEK: 0, PASS: 0, FLY_BY: 0, CLOSE_CALL: 0 };
const sounds = { RUSTLE: 0, FOOTSTEP: 0, TAP: 0, BREATH: 0 };
let dangerRun = 0, maxDangerRun = 0, previous = distance.distance, changes = 0;
// 2時間を100msフレームで模擬。実時間の待機・新規タイマーなし。
for (let now = 0; now < 2 * 60 * 60 * 1000; now += 100) {
  distance.update(100, 90, true);
  assert.ok(distance.distance >= 5 && distance.distance <= 100);
  if (distance.distance !== previous) changes++;
  previous = distance.distance;
  dangerRun = distance.distanceState === "DANGER" ? dangerRun + 100 : 0;
  maxDangerRun = Math.max(maxDangerRun, dangerRun);
  encounter.setProfile(distance.profile, now);
  const type = encounter.update(now);
  if (type) { counts[type]++; encounter.begin(now); }
  if (encounter.state === "EVENT" && now - encounter.eventStartedAt >= 700) {
    if (encounter.currentEncounter === "PEEK") distance.retreat();
    distance.afterEncounter(encounter.currentEncounter);
    encounter.finish(now);
  }
  const input = { active: true, range: distance.distanceState, looking: false,
    entityYaw: 180, relativeYaw: 0, strongEncounter: encounter.state === "EVENT" && encounter.currentEncounter !== "PEEK" };
  const event = presence.update(now, input);
  if (event) { sounds[event.type]++; presence.played(event, now, input); }
}
assert.ok(changes > 100);
assert.ok(maxDangerRun <= STALKER_CONFIG.dangerMaxMs + 100);
assert.ok(Object.values(counts).every(value => value > 0));
assert.ok(Object.values(sounds).every(value => value > 0));

distance.setDistance(5);
for (let i = 0; i < 80; i++) distance.update(100, 0, true);
assert.equal(distance.distanceState, "FAR", "DANGER expires even while looking");
distance.setDistance(35);
distance.retreat();
assert.equal(distance.distance, 50);
distance.random = () => 0;
distance.afterEncounter("CLOSE_CALL");
assert.equal(distance.distanceState, "FAR");
distance.setDistance(85);
for (let i = 0; i < 250; i++) distance.update(100, 0, true);
assert.notEqual(distance.distance, 85, "natural distance change without approach");
const snapshot = JSON.stringify(distance);
for (let i = 0; i < 1000; i++) distance.update(100, 90, false);
const paused = JSON.stringify(distance);
assert.equal(distance.cycleMs, JSON.parse(snapshot).cycleMs);
assert.equal(distance.distance, JSON.parse(snapshot).distance);
assert.equal(JSON.stringify(distance), paused);
presence.pause(); encounter.reset();
assert.equal(presence.bait, null);
assert.equal(presence.deadline, null);
assert.equal(encounter.deadline, null);
console.log("Experience longevity: simulated 2h, bounds/cycles, bounded DANGER, all events/sounds and stop passed", { counts, sounds, maxDangerRun });
