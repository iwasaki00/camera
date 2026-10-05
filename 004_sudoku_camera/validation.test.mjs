import assert from "node:assert/strict";
import test from "node:test";
import { validateSudokuGrid } from "./validation.mjs";

function cells() {
  return Array.from({ length: 81 }, () => ({
    value: 0,
    confidence: null,
    manuallyEdited: false
  }));
}

test("CASE 1: normal grid has no duplicate issues", () => {
  const grid = cells();
  grid[0].value = 1;
  grid[10].value = 2;
  grid[20].value = 3;
  assert.deepEqual(validateSudokuGrid(grid).flat(), []);
});

test("CASE 2: row duplicates mark every matching cell", () => {
  const grid = cells();
  grid[0].value = 5;
  grid[4].value = 5;
  const issues = validateSudokuGrid(grid);
  assert.ok(issues[0].includes("duplicate-row"));
  assert.ok(issues[4].includes("duplicate-row"));
});

test("CASE 3: column duplicates mark every matching cell", () => {
  const grid = cells();
  grid[0].value = 5;
  grid[36].value = 5;
  const issues = validateSudokuGrid(grid);
  assert.ok(issues[0].includes("duplicate-column"));
  assert.ok(issues[36].includes("duplicate-column"));
});

test("CASE 4: block duplicates mark every matching cell", () => {
  const grid = cells();
  grid[0].value = 5;
  grid[10].value = 5;
  const issues = validateSudokuGrid(grid);
  assert.ok(issues[0].includes("duplicate-block"));
  assert.ok(issues[10].includes("duplicate-block"));
});

test("CASE 5: confidence 69 is low confidence", () => {
  const grid = cells();
  grid[0].confidence = 69;
  assert.ok(validateSudokuGrid(grid)[0].includes("low-confidence"));
});

test("CASE 6: confidence 70 is not low confidence", () => {
  const grid = cells();
  grid[0].confidence = 70;
  assert.ok(!validateSudokuGrid(grid)[0].includes("low-confidence"));
});

test("CASE 7: manually edited cells ignore low confidence", () => {
  const grid = cells();
  grid[0].confidence = 50;
  grid[0].manuallyEdited = true;
  assert.ok(!validateSudokuGrid(grid)[0].includes("low-confidence"));
});

test("CASE 8: zero values never create duplicate issues", () => {
  const issues = validateSudokuGrid(cells());
  assert.equal(issues.filter((entry) => entry.some((issue) => issue.startsWith("duplicate-"))).length, 0);
});

test("CASE 9: correcting a duplicate clears the issue", () => {
  const grid = cells();
  grid[0].value = 5;
  grid[4].value = 5;
  assert.ok(validateSudokuGrid(grid)[0].includes("duplicate-row"));
  grid[4].value = 7;
  const issues = validateSudokuGrid(grid);
  assert.ok(!issues[0].includes("duplicate-row"));
  assert.ok(!issues[4].includes("duplicate-row"));
});

test("CASE 10: a cell can retain multiple reasons", () => {
  const grid = cells();
  grid[0] = { value: 5, confidence: 69, manuallyEdited: false };
  grid[4].value = 5;
  const issues = validateSudokuGrid(grid);
  assert.ok(issues[0].includes("low-confidence"));
  assert.ok(issues[0].includes("duplicate-row"));
});

