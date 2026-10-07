import assert from "node:assert/strict";
import {
  normalizeDegrees,
  signedAngleDifference,
  relativeHeading,
  turnSpeed,
  sideFromDifference,
  peripheralReveal,
  chooseRelocatedYaw
} from "../logic.js";

assert.equal(normalizeDegrees(361), 1);
assert.equal(normalizeDegrees(-1), 359);
assert.equal(normalizeDegrees(null), null);

assert.equal(signedAngleDifference(1, 359), 2);
assert.equal(signedAngleDifference(359, 1), -2);
assert.equal(signedAngleDifference(90, 0), 90);
assert.equal(signedAngleDifference(270, 0), -90);

assert.equal(relativeHeading(1, 359), 2);
assert.equal(relativeHeading(359, 1), -2);
assert.equal(turnSpeed(1, 359, 100), 20);
assert.equal(turnSpeed(359, 1, 100), -20);

assert.equal(sideFromDifference(20), "RIGHT");
assert.equal(sideFromDifference(-20), "LEFT");
assert.equal(sideFromDifference(0, "LEFT"), "LEFT");

assert.equal(peripheralReveal(46, 46, 15), 0);
assert.equal(peripheralReveal(15, 46, 15), 1);
assert.equal(peripheralReveal(-15, 46, 15), 1);

const relocatedPositive = chooseRelocatedYaw(10, 78, () => 0.75);
assert.ok(Math.abs(signedAngleDifference(relocatedPositive, 10)) >= 78);
const relocatedNegative = chooseRelocatedYaw(350, 78, () => 0.25);
assert.ok(Math.abs(signedAngleDifference(relocatedNegative, 350)) >= 78);

console.log("logic tests: 19 assertions passed");
