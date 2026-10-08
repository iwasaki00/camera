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
      location: { search: "?debug=1" }, isSecureContext: true,
      DeviceOrientationEvent: { requestPermission: async () => orientationDenied ? "denied" : "granted" },
      DeviceMotionEvent: { requestPermission: async () => "denied" },
      addEventListener() {}, requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
      setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: true })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, "") +
    "\nglobalThis.testApp = { runtime, director, encounterView, updateGame, handleOrientation, startExperience, relocateEntity, updateDebug };", sandbox);
  assert.equal(nodes.get("#debugPanel").hidden, true);
  assert.equal(nodes.get("#debugToggle").getAttribute("aria-pressed"), "false");
  if (debug) nodes.get("#debugToggle").click();
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
assert.equal(normal.nodes.get("#debugPanel").hidden, true);
normal.nodes.get("#debugToggle").click();
assert.equal(normal.nodes.get("#debugToggle").textContent, "DEBUG ON");
assert.ok(normal.buttons.every(button => button.disabled));
normal.buttons[0].click();
assert.equal(normal.director.currentEncounter, null);
normal.nodes.get("#debugToggle").click();
assert.equal(normal.nodes.get("#debugToggle").textContent, "DEBUG");
console.log("App integration: four encounters, cleanup, overlap, peek levels, spotting, relocation, null sensor and permission rejection passed");
