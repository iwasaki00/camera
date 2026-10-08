import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as logic from "../logic.js";
import { EncounterDirector, ENCOUNTER_CONFIG } from "../encounters.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness(debug = true, cameraDenied = false, orientationDenied = false) {
  let now = 0;
  const frames = [];
  const documentEvents = {};
  const nodes = new Map();
  const buttonTypes = ["PEEK", "PASS", "FLY_BY", "CLOSE_CALL"];
  function node() {
    const classes = new Set();
    return {
      style: { setProperty() {} }, dataset: {}, hidden: false, textContent: "",
      classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); }, toggle(n, on) { on ? classes.add(n) : classes.delete(n); }, contains(n) { return classes.has(n); } },
      setAttribute() {}, addEventListener(type, fn) { this[type] = fn; },
      animate(frames, options) { assert.ok(frames.length >= 2); assert.ok(options.duration > 0); return { cancel() {} }; },
      play: async () => {}
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set("#" + match[1], node());
  const buttons = buttonTypes.map(type => Object.assign(node(), { dataset: { testEncounter: type } }));
  let stopped = false;
  const sandbox = {
    ...logic, EncounterDirector, ENCOUNTER_CONFIG, URLSearchParams, console,
    performance: { now: () => now },
    navigator: { mediaDevices: { getUserMedia: async () => {
      if (cameraDenied) throw { name: "NotAllowedError" };
      return { getTracks: () => [{ stop() { stopped = true; } }] };
    } } },
    document: {
      hidden: false, body: node(), documentElement: node(),
      querySelector: selector => { assert.ok(nodes.has(selector), "missing DOM " + selector); return nodes.get(selector); },
      querySelectorAll: () => buttons, addEventListener(type, fn) { documentEvents[type] = fn; }
    },
    window: {
      location: { search: debug ? "?debug=1" : "" }, isSecureContext: true,
      DeviceOrientationEvent: { requestPermission: async () => orientationDenied ? "denied" : "granted" },
      DeviceMotionEvent: { requestPermission: async () => "denied" },
      addEventListener() {}, requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
      setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: true })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, "") +
    "\nglobalThis.testApp = { runtime, director, encounterView, updateGame, handleOrientation, startExperience, relocateEntity, updateDebug };", sandbox);
  return {
    ...sandbox.testApp, nodes, buttons, setNow: value => { now = value; }, stopped: () => stopped,
    flushFrame(value) { now = value; frames.splice(0).forEach(fn => fn(now)); },
    hide() { sandbox.document.hidden = true; documentEvents.visibilitychange(); }
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
  app.buttons.find(b => b.dataset.testEncounter === "PEEK").click();
  assert.equal(app.director.currentEncounter, type);
  app.updateGame(1000, 16);
  assert.equal(app.director.state, "COOLDOWN");
  assert.equal(app.encounterView.animation, null);
  assert.equal(app.encounterView.element.className, "encounter-visual");
}
app.buttons[0].click();
app.updateGame(100, 16);
assert.equal(app.runtime.state, "PERIPHERAL");
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
app.updateGame(410, 16);
assert.equal(app.director.state, "COOLDOWN");
assert.equal(app.runtime.state, "RELOCATE");
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
assert.ok(!normal.nodes.get("#debugPanel").classList.contains("debug-enabled"));
console.log("App integration: four encounters, cleanup, overlap, peek levels, spotting, relocation, null sensor and permission rejection passed");
