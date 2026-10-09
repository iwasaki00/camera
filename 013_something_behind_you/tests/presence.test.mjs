import assert from "node:assert/strict";
import { PresenceDirector, PRESENCE_CONFIG, presenceSpatial } from "../presence.js";

const input = { active: true, range: "FAR", looking: false, entityYaw: 180, relativeYaw: 0, strongEncounter: false };
for (const [range, profile] of Object.entries(PRESENCE_CONFIG.profiles)) {
  const d = new PresenceDirector(PRESENCE_CONFIG, () => 0.5);
  d.update(0, { ...input, range });
  assert.equal(d.state, "WAITING");
  assert.equal(d.deadline, (profile.delay[0] + profile.delay[1]) / 2);
  let total = 0;
  for (const [type, weight] of Object.entries(profile.weights)) {
    if (!weight) continue;
    d.random = () => (total + weight / 2) / 100;
    assert.equal(d.choose(0, range), type);
    total += weight;
  }
  assert.equal(total, 100);
}
let seed = 17;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const range of Object.keys(PRESENCE_CONFIG.profiles)) {
  const d = new PresenceDirector(PRESENCE_CONFIG, random);
  let previous = null, streak = 0;
  for(let i=0;i<10000;i++) {
    const type = d.choose(i * 20000, range);
    if (range === "FAR") assert.notEqual(type, "BREATH");
    streak = previous === type ? streak + 1 : 1;
    assert.ok(streak <= 2);
    assert.ok(type !== "BREATH" || type !== previous);
    d.played({type,yaw:180}, i * 20000, input, false);
    previous = type;
  }
}
const d = new PresenceDirector(PRESENCE_CONFIG, () => 0);
assert.equal(d.update(0,input), null);
const deadline = d.deadline;
assert.equal(deadline, PRESENCE_CONFIG.profiles.FAR.delay[0] + PRESENCE_CONFIG.quietExtraMs, "quiet extra time retained");
assert.equal(d.update(deadline,{...input,active:false}), null);
assert.equal(d.state,"IDLE");
d.update(deadline+1,input);
assert.ok(d.deadline > deadline+1, "fresh wait after resume, no backlog");
assert.equal(d.update(d.deadline,{...input,strongEncounter:true}), null);
assert.equal(d.state,"WAITING");
const event = d.update(d.deadline,input);
assert.equal(event.type,"RUSTLE");
assert.ok(Math.abs(event.yaw - 180) <= 15);
d.played(event,0,input);
assert.equal(d.state,"PLAYING");
assert.equal(d.consumeBait(300,{...input,canPeek:true}),false, "must turn toward sound");
assert.equal(d.consumeBait(200,{...input,relativeYaw:170,canPeek:true}),false);
assert.equal(d.consumeBait(300,{...input,relativeYaw:170,canPeek:false}),false);
assert.equal(d.consumeBait(300,{...input,relativeYaw:170,canPeek:true}),true);
assert.equal(d.consumeBait(301,{...input,relativeYaw:170,canPeek:true}),false);
d.played(event,1000,input);
assert.equal(d.consumeBait(4200,{...input,relativeYaw:170,canPeek:true}),false, "bait expires");
d.played(event,5000,input);
d.expireBait(5001,90); assert.equal(d.bait,null,"relocation invalidates bait");
d.random = () => 0.99;
d.played(event,6000,input); assert.equal(d.bait,null,"not every sound is bait");
d.played({type:"BREATH",yaw:180},7000,input);
d.random = () => 0.999;
assert.notEqual(d.choose(7001,"DANGER"),"BREATH","breath cooldown");
d.update(7800,input); assert.equal(d.state,"COOLDOWN");
d.pause(); assert.equal(d.currentPresence,null); assert.equal(d.bait,null);
d.reset(); assert.equal(d.previousPresence,null);
for (const [angle, direction] of [[-90,"LEFT"],[90,"RIGHT"],[0,"FRONT"],[35,"FRONT"],[-35,"FRONT"],[125,"BEHIND"],[-180,"BEHIND"],[540,"BEHIND"]]) {
  assert.equal(presenceSpatial(angle,60).direction,direction);
}
for(let angle=-720;angle<=720;angle++) assert.ok(Math.abs(presenceSpatial(angle,5).pan)<=0.7);
assert.equal(presenceSpatial(-90,60).pan,-0.7);
assert.equal(presenceSpatial(90,60).pan,0.7);
assert.ok(presenceSpatial(0,10).gain > presenceSpatial(0,85).gain);
assert.ok(presenceSpatial(180,10).gain < presenceSpatial(0,10).gain);
assert.ok(presenceSpatial(180,10).cutoff < presenceSpatial(0,10).cutoff);
assert.equal(presenceSpatial(NaN,5),null);
console.log("Presence: 40,000 draws, profiles, silence, suppression, direction, pan, bait and pause passed");
