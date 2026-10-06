import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  calculateCandidates,
  EXPLANATION_TECHNIQUES,
  findNextLogicalStep,
  generateExplanation
} from "./sudokuExplanation.mjs";

const SOLVED = [
  1,2,3,4,5,6,7,8,9, 4,5,6,7,8,9,1,2,3, 7,8,9,1,2,3,4,5,6,
  2,3,4,5,6,7,8,9,1, 5,6,7,8,9,1,2,3,4, 8,9,1,2,3,4,5,6,7,
  3,4,5,6,7,8,9,1,2, 6,7,8,9,1,2,3,4,5, 9,1,2,3,4,5,6,7,8
];

const HIDDEN_BLOCK = [0,2,0,0,0,0,7,0,0,0,0,6,0,0,9,1,0,3,0,0,9,1,0,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,6,0,0,4,0,0,0,8,0,0,2,0,0,0,9,1,0,0,0,0,0,1,0,0,0,0,6,7,0];
const HIDDEN_COLUMN = [0,0,3,0,0,6,0,8,0,0,0,0,0,0,0,0,2,0,0,8,0,0,0,0,0,5,0,0,3,0,0,0,0,0,0,0,0,6,0,0,0,1,0,3,4,0,9,0,0,0,0,0,0,7,0,0,0,6,0,0,0,0,0,0,0,0,0,1,0,3,0,0,0,0,2,0,0,0,0,0,8];
const HIDDEN_ROW = [0,0,0,0,0,6,0,0,0,0,0,0,7,8,9,1,0,0,7,8,9,1,0,0,0,0,6,0,3,4,5,6,0,0,0,0,0,0,0,0,0,0,0,3,4,0,9,0,0,3,4,0,0,0,0,4,5,0,0,8,9,1,0,0,7,0,0,1,0,0,4,0,0,1,0,0,0,0,0,0,0];

test("候補計算は同じ行・列・3×3の数字を除外する", () => {
  const grid = Array(81).fill(0);
  grid[0] = 1;
  grid[10] = 2;
  grid[20] = 3;
  grid[4] = 4;
  grid[36] = 5;
  assert.deepEqual(calculateCandidates(grid)[9], [4, 6, 7, 8, 9]);
});

test("Naked SingleをPLACEとして検出する", () => {
  const grid = SOLVED.slice();
  grid[0] = 0;
  const result = generateExplanation(grid);
  const step = result.steps[0];
  assert.equal(step.technique, EXPLANATION_TECHNIQUES.NAKED_SINGLE);
  assert.equal(step.type, "PLACE");
  assert.deepEqual(step.targetCells, [0]);
  assert.equal(step.placedValue, 1);
  assert.deepEqual(step.candidatesBefore, [1]);
  assert.equal(step.relatedCells.length, 8);
  assert.equal(new Set(step.relatedCells.map((index) => grid[index])).size, 8);
});

test("Hidden Single Blockを決定的に検出する", () => {
  const step = findNextLogicalStep(HIDDEN_BLOCK);
  assert.equal(step.technique, EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_BLOCK);
  assert.equal(step.targetIndex, 61);
  assert.equal(step.placedValue, 1);
});

test("Hidden Single Rowを決定的に検出する", () => {
  const step = findNextLogicalStep(HIDDEN_ROW);
  assert.equal(step.technique, EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_ROW);
  assert.equal(step.targetIndex, 9);
  assert.equal(step.placedValue, 4);
});

test("Hidden Single Columnを決定的に検出する", () => {
  const step = findNextLogicalStep(HIDDEN_COLUMN);
  assert.equal(step.technique, EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_COLUMN);
  assert.equal(step.targetIndex, 1);
  assert.equal(step.placedValue, 2);
});

test("同じ盤面は同じStep列を返す", () => {
  const first = generateExplanation(HIDDEN_ROW);
  const second = generateExplanation(HIDDEN_ROW);
  const signature = (result) => result.steps.map((step) => [step.technique, step.targetCells[0], step.placedValue]);
  assert.deepEqual(signature(first), signature(second));
});

test("SnapshotでSTEP 0・1・2の盤面を正確に再現できる", () => {
  const grid = SOLVED.slice();
  grid[0] = 0;
  grid[1] = 0;
  const result = generateExplanation(grid);
  assert.equal(result.steps.length, 2);
  assert.deepEqual(result.originalGrid, grid);
  assert.deepEqual(result.steps[0].gridBefore, grid);
  assert.deepEqual(result.steps[0].gridAfter, result.steps[1].gridBefore);
  assert.deepEqual(result.steps[1].gridAfter, SOLVED);
});

test("入力盤面を書き換えない", () => {
  const grid = HIDDEN_BLOCK.slice();
  const before = grid.slice();
  generateExplanation(grid);
  assert.deepEqual(grid, before);
});

test("solved・stuck・invalidで停止する", () => {
  assert.equal(generateExplanation(SOLVED).status, "solved");
  assert.equal(generateExplanation(Array(81).fill(0)).status, "stuck");
  const invalid = SOLVED.slice();
  invalid[1] = 1;
  assert.equal(generateExplanation(invalid).status, "invalid");
});

test("StepデータとtechniqueCountsを保持する", () => {
  const grid = SOLVED.slice();
  grid[0] = 0;
  const result = generateExplanation(grid);
  const step = result.steps[0];
  for (const field of ["stepNumber", "type", "technique", "targetCells", "relatedCells", "unit", "placedValue", "candidatesBefore", "candidatesAfter", "eliminatedCandidates", "shortReason", "detailReason", "gridBefore", "gridAfter", "candidateSnapshot"]) {
    assert.ok(Object.hasOwn(step, field), field);
  }
  assert.equal(result.techniqueCounts.NAKED_SINGLE, 1);
});

test("Explanation Engineは既存Solverを参照しない", async () => {
  const source = await readFile(new URL("./sudokuExplanation.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("sudokuSolver"), false);
  assert.equal(source.includes("solveSudoku"), false);
});
