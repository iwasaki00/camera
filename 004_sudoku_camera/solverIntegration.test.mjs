import assert from "node:assert/strict";
import test from "node:test";
import {
  createOriginalPuzzle,
  getSolveGate,
  solvePuzzle,
  validateSolvedGrid
} from "./solverIntegration.mjs";

const PUZZLE = [
  5,3,0,0,7,0,0,0,0,
  6,0,0,1,9,5,0,0,0,
  0,9,8,0,0,0,0,6,0,
  8,0,0,0,6,0,0,0,3,
  4,0,0,8,0,3,0,0,1,
  7,0,0,0,2,0,0,0,6,
  0,6,0,0,0,0,2,8,0,
  0,0,0,4,1,9,0,0,5,
  0,0,0,0,8,0,0,7,9
];

const SOLUTION = [
  5,3,4,6,7,8,9,1,2,
  6,7,2,1,9,5,3,4,8,
  1,9,8,3,4,2,5,6,7,
  8,5,9,7,6,1,4,2,3,
  4,2,6,8,5,3,7,9,1,
  7,1,3,9,2,4,8,5,6,
  9,6,1,5,3,7,2,8,4,
  2,8,7,4,1,9,6,3,5,
  3,4,5,2,8,6,1,7,9
];

test("CASE 1: known puzzle is solved to the expected 81 cells", () => {
  const result = solvePuzzle(PUZZLE);
  assert.equal(result.status, "solved");
  assert.deepEqual(result.solution, SOLUTION);
});

test("CASE 2: row duplicate blocks Solver", () => {
  assert.equal(getSolveGate([["duplicate-row"]]), "blocked");
});

test("CASE 3: column duplicate blocks Solver", () => {
  assert.equal(getSolveGate([["duplicate-column"]]), "blocked");
});

test("CASE 4: block duplicate blocks Solver", () => {
  assert.equal(getSolveGate([["duplicate-block"]]), "blocked");
});

test("CASE 5: low confidence alone requires confirmation", () => {
  assert.equal(getSolveGate([["low-confidence"]]), "confirm");
});

test("CASE 6: unsolvable valid puzzle returns safely", () => {
  const unsolvable = PUZZLE.slice();
  unsolvable[0] = 1;
  const result = solvePuzzle(unsolvable);
  assert.equal(result.status, "unsolved");
  assert.equal(result.solution, null);
});

test("CASE 7: solved grid passes row, column and block validation", () => {
  assert.deepEqual(validateSolvedGrid(SOLUTION, PUZZLE), { valid: true, reason: "" });
});

test("CASE 8: original clues remain unchanged", () => {
  const changed = SOLUTION.slice();
  changed[0] = 4;
  assert.equal(validateSolvedGrid(changed, PUZZLE).valid, false);
});

test("CASE 9: manually edited current value is captured as an original clue", () => {
  const cells = PUZZLE.map((value) => ({ value, ocrValue: value, manuallyEdited: false }));
  cells[2] = { value: 4, ocrValue: 0, manuallyEdited: true };
  assert.equal(createOriginalPuzzle(cells)[2], 4);
});

test("invalid Solver output is rejected", () => {
  const invalid = SOLUTION.slice();
  invalid[0] = invalid[1];
  assert.equal(validateSolvedGrid(invalid, PUZZLE).valid, false);
});

