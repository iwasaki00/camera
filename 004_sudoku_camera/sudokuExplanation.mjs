const DIGITS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

export const EXPLANATION_TECHNIQUES = Object.freeze({
  NAKED_SINGLE: "NAKED_SINGLE",
  HIDDEN_SINGLE_ROW: "HIDDEN_SINGLE_ROW",
  HIDDEN_SINGLE_COLUMN: "HIDDEN_SINGLE_COLUMN",
  HIDDEN_SINGLE_BLOCK: "HIDDEN_SINGLE_BLOCK"
});

const TECHNIQUE_LABELS = Object.freeze({
  NAKED_SINGLE: "候補が1つ",
  HIDDEN_SINGLE_ROW: "行で1か所",
  HIDDEN_SINGLE_COLUMN: "列で1か所",
  HIDDEN_SINGLE_BLOCK: "3×3で1か所"
});

function normalizeValue(value) {
  const number = Number(value?.value ?? value ?? 0);
  return Number.isInteger(number) && number >= 1 && number <= 9 ? number : 0;
}

function normalizeGrid(input) {
  if (!Array.isArray(input) || input.length !== 81) {
    throw new Error("解説には81セルの盤面が必要です。");
  }
  return input.map(normalizeValue);
}

function rowIndexes(row) {
  return Array.from({ length: 9 }, (_, col) => row * 9 + col);
}

function columnIndexes(col) {
  return Array.from({ length: 9 }, (_, row) => row * 9 + col);
}

function blockIndexes(block) {
  const startRow = Math.floor(block / 3) * 3;
  const startCol = (block % 3) * 3;
  const indexes = [];
  for (let row = startRow; row < startRow + 3; row += 1) {
    for (let col = startCol; col < startCol + 3; col += 1) {
      indexes.push(row * 9 + col);
    }
  }
  return indexes;
}

const ROWS = Array.from({ length: 9 }, (_, row) => rowIndexes(row));
const COLUMNS = Array.from({ length: 9 }, (_, col) => columnIndexes(col));
const BLOCKS = Array.from({ length: 9 }, (_, block) => blockIndexes(block));

function hasDuplicate(grid, indexes) {
  const values = indexes.map((index) => grid[index]).filter(Boolean);
  return new Set(values).size !== values.length;
}

export function isExplanationGridValid(input) {
  let grid;
  try {
    grid = normalizeGrid(input);
  } catch {
    return false;
  }
  return !ROWS.some((indexes) => hasDuplicate(grid, indexes))
    && !COLUMNS.some((indexes) => hasDuplicate(grid, indexes))
    && !BLOCKS.some((indexes) => hasDuplicate(grid, indexes));
}

export function calculateCandidates(input) {
  const grid = normalizeGrid(input);
  return grid.map((value, index) => {
    if (value !== 0) return [];
    const row = Math.floor(index / 9);
    const col = index % 9;
    const block = Math.floor(row / 3) * 3 + Math.floor(col / 3);
    const used = new Set([
      ...ROWS[row].map((cellIndex) => grid[cellIndex]),
      ...COLUMNS[col].map((cellIndex) => grid[cellIndex]),
      ...BLOCKS[block].map((cellIndex) => grid[cellIndex])
    ]);
    return DIGITS.filter((digit) => !used.has(digit));
  });
}

function matchingSourceCells(grid, indexes, digit, targetIndex) {
  return indexes.filter((index) => index !== targetIndex && grid[index] === digit);
}

export function calculateCandidateReasons(input, targetIndex) {
  const grid = normalizeGrid(input);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= 81) {
    throw new Error("候補理由の対象セルが不正です。");
  }

  const row = Math.floor(targetIndex / 9);
  const col = targetIndex % 9;
  const block = Math.floor(row / 3) * 3 + Math.floor(col / 3);
  const units = [
    ["ROW", ROWS[row]],
    ["COLUMN", COLUMNS[col]],
    ["BLOCK", BLOCKS[block]]
  ];

  return Object.fromEntries(DIGITS.map((digit) => {
    const reasons = units.flatMap(([type, indexes]) => {
      const sourceCells = matchingSourceCells(grid, indexes, digit, targetIndex);
      return sourceCells.length > 0 ? [{ type, sourceCells }] : [];
    });
    return [digit, { available: reasons.length === 0, reasons }];
  }));
}

function getPeerIndexes(index) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const block = Math.floor(row / 3) * 3 + Math.floor(col / 3);
  return [...new Set([...ROWS[row], ...COLUMNS[col], ...BLOCKS[block]])]
    .filter((cellIndex) => cellIndex !== index)
    .sort((a, b) => a - b);
}

function getNakedSingleRelatedCells(grid, targetIndex, placedValue) {
  const firstBlockerByDigit = new Map();
  for (const index of getPeerIndexes(targetIndex)) {
    const value = grid[index];
    if (value === 0 || value === placedValue || firstBlockerByDigit.has(value)) continue;
    firstBlockerByDigit.set(value, index);
  }
  return [...firstBlockerByDigit.entries()]
    .sort(([digitA], [digitB]) => digitA - digitB)
    .map(([, index]) => index);
}

function hiddenSingleInUnits(grid, candidates, units, technique, unitType) {
  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    const indexes = units[unitIndex];
    for (const digit of DIGITS) {
      if (indexes.some((index) => grid[index] === digit)) continue;
      const available = indexes.filter((index) => grid[index] === 0 && candidates[index].includes(digit));
      if (available.length !== 1) continue;
      return {
        technique,
        targetIndex: available[0],
        placedValue: digit,
        unit: { type: unitType, index: unitIndex, cells: indexes.slice() }
      };
    }
  }
  return null;
}

export function findNextLogicalStep(input, suppliedCandidates = null) {
  const grid = normalizeGrid(input);
  const candidates = suppliedCandidates || calculateCandidates(grid);

  for (let index = 0; index < 81; index += 1) {
    if (grid[index] === 0 && candidates[index].length === 1) {
      return {
        technique: EXPLANATION_TECHNIQUES.NAKED_SINGLE,
        targetIndex: index,
        placedValue: candidates[index][0],
        unit: null
      };
    }
  }

  return hiddenSingleInUnits(
    grid,
    candidates,
    BLOCKS,
    EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_BLOCK,
    "block"
  ) || hiddenSingleInUnits(
    grid,
    candidates,
    ROWS,
    EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_ROW,
    "row"
  ) || hiddenSingleInUnits(
    grid,
    candidates,
    COLUMNS,
    EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_COLUMN,
    "column"
  );
}

function reasonFor(step) {
  const value = step.placedValue;
  if (step.technique === EXPLANATION_TECHNIQUES.NAKED_SINGLE) {
    return {
      shortReason: `このマスに入る候補は${value}だけです`,
      detailReason: `1〜9から、同じ行・列・3×3ですでに使われている数字を除くと、${value}だけが残ります。`
    };
  }
  if (step.technique === EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_ROW) {
    return {
      shortReason: `この行で${value}を置けるのはここだけです`,
      detailReason: `この行のほかの空欄では${value}が候補から外れるため、このマスに${value}が入ります。`
    };
  }
  if (step.technique === EXPLANATION_TECHNIQUES.HIDDEN_SINGLE_COLUMN) {
    return {
      shortReason: `この列で${value}を置けるのはここだけです`,
      detailReason: `この列のほかの空欄では${value}が候補から外れるため、このマスに${value}が入ります。`
    };
  }
  return {
    shortReason: `この3×3で${value}を置けるのはここだけです`,
    detailReason: `この3×3のほかの空欄では${value}が候補から外れるため、このマスに${value}が入ります。`
  };
}

function buildPlacementReasons(grid, found) {
  if (!found.unit) return [];
  return found.unit.cells
    .filter((cellIndex) => grid[cellIndex] === 0)
    .map((cellIndex) => {
      const candidateReason = calculateCandidateReasons(grid, cellIndex)[found.placedValue];
      return {
        cellIndex,
        available: candidateReason.available,
        reasons: candidateReason.reasons.map((reason) => ({
          type: reason.type,
          sourceCells: reason.sourceCells.slice()
        }))
      };
    });
}

function buildStep(stepNumber, grid, candidates, found) {
  const gridBefore = grid.slice();
  const targetCandidates = candidates[found.targetIndex].slice();
  const gridAfter = grid.slice();
  gridAfter[found.targetIndex] = found.placedValue;
  const candidateSnapshotAfter = calculateCandidates(gridAfter);
  const relatedCells = found.unit
    ? found.unit.cells.filter((index) => index !== found.targetIndex && grid[index] !== 0)
    : getNakedSingleRelatedCells(grid, found.targetIndex, found.placedValue);
  const reasons = reasonFor(found);
  const candidateReasons = calculateCandidateReasons(grid, found.targetIndex);
  const placementReasons = buildPlacementReasons(grid, found);

  return {
    stepNumber,
    type: "PLACE",
    technique: found.technique,
    techniqueLabel: TECHNIQUE_LABELS[found.technique],
    targetCells: [found.targetIndex],
    relatedCells,
    unit: found.unit ? { ...found.unit, cells: found.unit.cells.slice() } : null,
    placedValue: found.placedValue,
    candidatesBefore: targetCandidates,
    candidatesAfter: [],
    eliminatedCandidates: targetCandidates.filter((digit) => digit !== found.placedValue),
    candidateReasons,
    placementReasons,
    candidateSnapshot: candidates.map((values) => values.slice()),
    candidateSnapshotAfter,
    gridBefore,
    gridAfter,
    shortReason: reasons.shortReason,
    detailReason: reasons.detailReason
  };
}

function emptyTechniqueCounts() {
  return Object.fromEntries(Object.values(EXPLANATION_TECHNIQUES).map((technique) => [technique, 0]));
}

export function generateExplanation(input) {
  const originalGrid = normalizeGrid(input);
  const grid = originalGrid.slice();
  const steps = [];
  const techniqueCounts = emptyTechniqueCounts();

  if (!isExplanationGridValid(grid)) {
    return { status: "invalid", steps, originalGrid, finalGrid: grid, remainingEmptyCells: grid.filter((value) => value === 0).length, techniqueCounts };
  }

  for (let iteration = 0; iteration < 81; iteration += 1) {
    const remainingEmptyCells = grid.filter((value) => value === 0).length;
    if (remainingEmptyCells === 0) {
      return { status: "solved", steps, originalGrid, finalGrid: grid.slice(), remainingEmptyCells: 0, techniqueCounts };
    }

    const candidates = calculateCandidates(grid);
    if (grid.some((value, index) => value === 0 && candidates[index].length === 0)) {
      return { status: "invalid", steps, originalGrid, finalGrid: grid.slice(), remainingEmptyCells, techniqueCounts };
    }

    const found = findNextLogicalStep(grid, candidates);
    if (!found) {
      return { status: "stuck", steps, originalGrid, finalGrid: grid.slice(), remainingEmptyCells, techniqueCounts };
    }

    const step = buildStep(steps.length + 1, grid, candidates, found);
    steps.push(step);
    techniqueCounts[step.technique] += 1;
    grid[found.targetIndex] = found.placedValue;
  }

  return {
    status: grid.includes(0) ? "stuck" : "solved",
    steps,
    originalGrid,
    finalGrid: grid.slice(),
    remainingEmptyCells: grid.filter((value) => value === 0).length,
    techniqueCounts
  };
}
