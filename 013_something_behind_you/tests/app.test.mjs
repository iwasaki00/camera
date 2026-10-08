import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as logic from "../logic.js";
import { EncounterDirector, ENCOUNTER_CONFIG } from "../encounters.js";
import { Stalker, STALKER_CONFIG } from "../stalker.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness(debug = true, cameraDenied = false, orientationDenied = false) {
  let now = 0;
  const frames = [];
  const documentEvents = {};
  const windowEvents = {};
  const nodes = new Map();
  const buttonTypes = ["PEEK", "PASS", "FLY_BY", "CLOSE_CALL"];
  function node() {
    const classes = new Set();
    const attributes = new Map();
    return {
      style: { setProperty() {} }, dataset: {}, hidden: false, textContent: "",
      classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); }, toggle(n, on) { on ? classes.add(n) : classes.delete(n); }, contains(n) { return classes.has(n); } },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      addEventListener(type, fn) { this[type] = fn; },
      animate(frames, options) { assert.ok(frames.length >= 2); assert.ok(options.duration > 0); return { cancel() {} }; },
      play: async () => {}
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set("#" + match[1], node());
  const buttons = buttonTypes.map(type => Object.assign(node(), { dataset: { testEncounter: type } }));
  const distanceButtons = ["FAR", "MID", "NEAR", "DANGER"].map(type => Object.assign(node(), { dataset: { setDistance: type } }));
  let stopped = false;
  const sandbox = {
    ...logic, EncounterDirector, ENCOUNTER_CONFIG, Stalker, STALKER_CONFIG, URLSearchParams, console,
    performance: { now: () => now },
    navigator: { mediaDevices: { getUserMedia: async () => {
      if (cameraDenied) throw { name: "NotAllowedError" };
      return { getTracks: () => [{ stop() { stopped = true; } }] };
    } } },
    document: {
      hidden: false, body: node(), documentElement: node(),
      querySelector: selector => { assert.ok(nodes.has(selector), "missing DOM " + selector); return nodes.get(selector); },
      querySelectorAll: selector => selector === "[data-set-distance]" ? distanceButtons : buttons, addEventListener(type, fn) { documentEvents[type] = fn; }
    },
    window: {
      location: { search: "?debug=1" }, isSecureContext: true,
      DeviceOrientationEvent: { requestPermission: async () => orientationDenied ? "denied" : "granted" },
      DeviceMotionEvent: { requestPermission: async () => "denied" },
      addEventListener(type, fn) { windowEvents[type] = fn; }, requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
      setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: true })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, "") +
    "\nglobalThis.testApp = { runtime, director, stalker, encounterView, updateGame, handleOrientation, startExperience, relocateEntity, updateDebug, beginEscape };", sandbox);
  assert.equal(nodes.get("#debugPanel").hidden, true);
  assert.equal(nodes.get("#debugToggle").getAttribute("aria-pressed"), "false");
  if (debug) nodes.get("#debugToggle").click();
  return {
    ...sandbox.testApp, nodes, buttons, distanceButtons, setNow: value => { now = value; }, stopped: () => stopped,
    flushFrame(value) { now = value; frames.splice(0).forEach(fn => fn(now)); },
    hide() { sandbox.document.hidden = true; documentEvents.visibilitychange(); },
    show() { sandbox.document.hidden = false; documentEvents.visibilitychange(); },
    pagehide() { windowEvents.pagehide(); }
  };
}

const app = harness();
await app.startExperience();
app.handleOrientation({ alpha: null, webkitCompassHeading: null });
assert.equal(app.runtime.initialYaw, null);
app.handleOrientation({ webkitCompassHeading: 359 });
assert.equal(app.runtime.relativeYaw, 0);
for (const type of ["PASS", "FLY_BY", "CLOSE_CALL"]) {
  app.setNow(100);
  app.buttons.find(b => b.dataset.testEncounter === type).click();
  assert.equal(app.director.currentEncounter, type);
  assert.equal(app.director.state, "EVENT");
  app.buttons[0].click();
  assert.equal(app.director.currentEncounter, type);
  const beforeToggle = JSON.stringify({ runtime: app.runtime, director: app.director });
  const animation = app.encounterView.animation;
  app.nodes.get("#debugToggle").click();
  assert.equal(app.nodes.get("#debugPanel").hidden, true);
  assert.equal(app.nodes.get("#debugTests").hidden, true);
  assert.equal(app.nodes.get("#debugGuides").hidden, true);
  assert.equal(app.encounterView.animation, animation);
  assert.equal(JSON.stringify({ runtime: app.runtime, director: app.director }), beforeToggle);
  app.nodes.get("#debugToggle").click();
  assert.equal(app.nodes.get("#debugPanel").hidden, false);
  assert.equal(app.nodes.get("#debugTests").hidden, false);
  assert.equal(app.nodes.get("#debugGuides").hidden, false);
  assert.equal(app.director.currentEncounter, type);
  assert.equal(app.encounterView.animation, animation);
  app.updateGame(1000, 16);
  assert.equal(app.director.state, "COOLDOWN");
  assert.equal(app.encounterView.animation, null);
  assert.equal(app.encounterView.element.className, "encounter-visual");
  assert.equal(app.stalker.distance, 85, type + " must not reward distance");
}
app.buttons[0].click();
app.updateGame(100, 16);
assert.equal(app.runtime.state, "PERIPHERAL");
const peekDirector = JSON.stringify(app.director);
const peekYaw = app.runtime.entityYaw;
app.nodes.get("#debugToggle").click();
app.updateGame(110, 16);
app.nodes.get("#debugToggle").click();
assert.equal(app.runtime.state, "PERIPHERAL");
assert.equal(app.runtime.entityYaw, peekYaw);
assert.equal(JSON.stringify(app.director), peekDirector);
for (const [angle, level] of [[40, 1], [30, 2], [20, 3]]) {
  app.runtime.angleDiff = angle;
  app.updateGame(120, 16);
  assert.equal(app.encounterView.peekLevel, level);
}
app.runtime.turnSpeed = 120;
app.runtime.angleDiff = 10;
app.updateGame(140, 16);
assert.equal(app.runtime.state, "SPOTTED");
app.flushFrame(150);
assert.equal(app.runtime.state, "ESCAPE");
assert.equal(app.stalker.distance, 100, "discovered PEEK retreats 15");
app.beginEscape(true);
assert.equal(app.stalker.distance, 100, "escape cannot reward twice");
app.updateGame(410, 16);
assert.equal(app.director.state, "COOLDOWN");
assert.equal(app.runtime.state, "RELOCATE");
assert.equal(app.stalker.distance, 100, "relocate retains distance");
assert.ok(Math.abs(app.runtime.angleDiff) >= 78);
app.flushFrame(420);
assert.equal(app.runtime.state, "STALKING");
app.buttons[1].click();
app.hide();
assert.equal(app.director.state, "COOLDOWN");
assert.equal(app.encounterView.animation, null);
app.updateDebug(500);
assert.ok(!app.nodes.get("#debugEncounter").textContent.includes("NaN"));

const denied = harness(true, true);
await denied.startExperience();
assert.equal(denied.runtime.started, false);
assert.ok(denied.nodes.get("#startStatus").textContent.includes("許可"));
const motionDenied = harness(true, false, true);
await motionDenied.startExperience();
assert.equal(motionDenied.runtime.started, false);
assert.ok(motionDenied.stopped());
const normal = harness(false);
assert.equal(normal.nodes.get("#debugPanel").hidden, true);
normal.nodes.get("#debugToggle").click();
assert.equal(normal.nodes.get("#debugToggle").textContent, "DEBUG ON");
assert.ok(normal.buttons.every(button => button.disabled));
normal.buttons[0].click();
assert.equal(normal.director.currentEncounter, null);
normal.nodes.get("#debugToggle").click();
assert.equal(normal.nodes.get("#debugToggle").textContent, "DEBUG");

const distanceApp = harness();
for (const [index, range, value] of [[0, "FAR", 85], [1, "MID", 60], [2, "NEAR", 35], [3, "DANGER", 10]]) {
  distanceApp.distanceButtons[index].click();
  assert.equal(distanceApp.stalker.distance, value);
  assert.equal(distanceApp.director.profile, STALKER_CONFIG.profiles[range]);
}
distanceApp.nodes.get("#debugToggle").click();
distanceApp.distanceButtons[0].click();
assert.equal(distanceApp.stalker.distance, 10, "hidden DEBUG cannot change distance");
await distanceApp.startExperience();
assert.equal(distanceApp.stalker.distance, 85, "START resets distance");
distanceApp.handleOrientation({ webkitCompassHeading: 0 });
distanceApp.runtime.angleDiff = 90;
for (let t = 100; t <= 2000; t += 100) distanceApp.updateGame(t, 100);
assert.equal(distanceApp.stalker.distance, 85, "motion permission unavailable pauses approach");
distanceApp.runtime.motionPermission = "granted";
for (let t = 100; t <= 2000; t += 100) distanceApp.updateGame(t, 100);
assert.ok(distanceApp.stalker.distance < 85);
distanceApp.hide();
const pausedDistance = distanceApp.stalker.distance;
distanceApp.updateGame(2500, 100);
assert.equal(distanceApp.stalker.distance, pausedDistance);
distanceApp.show();
distanceApp.updateGame(3000, 100);
assert.equal(distanceApp.stalker.distance, pausedDistance, "resume waits for fresh orientation");
distanceApp.handleOrientation({ webkitCompassHeading: 0 });
distanceApp.runtime.angleDiff = 35;
distanceApp.updateGame(3000, 100);
assert.equal(distanceApp.stalker.distance, pausedDistance, "LOOKING stops without recovery");
distanceApp.runtime.stream = { getTracks: () => [{ readyState: "ended", stop() {} }] };
distanceApp.runtime.angleDiff = 90;
for (let i=0;i<30;i++) distanceApp.updateGame(3000,100);
assert.equal(distanceApp.stalker.distance, pausedDistance, "ended camera pauses approach");
distanceApp.pagehide();
assert.equal(distanceApp.runtime.started, false);
assert.equal(distanceApp.stalker.paused, true);
assert.equal(distanceApp.runtime.stream, null);

for (const type of ["PEEK", "PASS", "FLY_BY", "CLOSE_CALL"]) {
  const visual = harness();
  await visual.startExperience();
  visual.handleOrientation({ webkitCompassHeading: 0 });
  visual.distanceButtons[3].click();
  visual.buttons.find(b => b.dataset.testEncounter === type).click();
  assert.equal(visual.encounterView.profile, STALKER_CONFIG.profiles.DANGER);
  const animation = visual.encounterView.animation;
  visual.distanceButtons[0].click();
  assert.equal(visual.director.profile, STALKER_CONFIG.profiles.FAR);
  assert.equal(visual.encounterView.profile, STALKER_CONFIG.profiles.DANGER, "current effect retains profile");
  assert.equal(visual.encounterView.animation, animation);
}

const timeoutPeek = harness();
await timeoutPeek.startExperience();
timeoutPeek.handleOrientation({ webkitCompassHeading: 0 });
timeoutPeek.stalker.setDistance(60);
timeoutPeek.buttons[0].click();
timeoutPeek.updateGame(0, 16);
timeoutPeek.setNow(7000);
timeoutPeek.handleOrientation({ webkitCompassHeading: 0 });
timeoutPeek.updateGame(7000, 16);
timeoutPeek.flushFrame(7010);
assert.equal(timeoutPeek.runtime.state, "ESCAPE");
assert.equal(timeoutPeek.stalker.distance, 60, "timeout escape must not reward");
console.log("App integration: four encounters, cleanup, overlap, peek levels, spotting, relocation, null sensor and permission rejection passed");
