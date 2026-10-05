export const DEFAULT_CONFIDENCE_THRESHOLD = 70;

const ISSUE_LOW_CONFIDENCE = "low-confidence";
const ISSUE_DUPLICATE_ROW = "duplicate-row";
const ISSUE_DUPLICATE_COLUMN = "duplicate-column";
const ISSUE_DUPLICATE_BLOCK = "duplicate-block";

function normalizedValue(cell) {
  const value = Number(cell?.value ?? cell ?? 0);
  return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 0;
}

function markDuplicateGroups(groups, values, issues, issueName) {
  for (const group of groups) {
    const positionsByValue = new Map();
    for (const index of group) {
      const value = values[index];
      if (value === 0) continue;
      const positions = positionsByValue.get(value) || [];
      positions.push(index);
      positionsByValue.set(value, positions);
    }

    for (const positions of positionsByValue.values()) {
      if (positions.length < 2) continue;
      for (const index of positions) issues[index].push(issueName);
    }
  }
}

function createRowGroups() {
  return Array.from({ length: 9 }, (_, row) =>
    Array.from({ length: 9 }, (_, col) => row * 9 + col)
  );
}

function createColumnGroups() {
  return Array.from({ length: 9 }, (_, col) =>
    Array.from({ length: 9 }, (_, row) => row * 9 + col)
  );
}

function createBlockGroups() {
  const groups = [];
  for (let blockRow = 0; blockRow < 3; blockRow += 1) {
    for (let blockCol = 0; blockCol < 3; blockCol += 1) {
      const group = [];
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          group.push((blockRow * 3 + row) * 9 + blockCol * 3 + col);
        }
      }
      groups.push(group);
    }
  }
  return groups;
}

const ROW_GROUPS = createRowGroups();
const COLUMN_GROUPS = createColumnGroups();
const BLOCK_GROUPS = createBlockGroups();

export function validateSudokuGrid(cells, confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  if (!Array.isArray(cells) || cells.length !== 81) {
    throw new Error("Validationには81セルが必要です。");
  }

  const issues = Array.from({ length: 81 }, () => []);
  const values = cells.map(normalizedValue);

  cells.forEach((cell, index) => {
    if (
      !cell?.manuallyEdited
      && Number.isFinite(cell?.confidence)
      && cell.confidence < confidenceThreshold
    ) {
      issues[index].push(ISSUE_LOW_CONFIDENCE);
    }
  });

  markDuplicateGroups(ROW_GROUPS, values, issues, ISSUE_DUPLICATE_ROW);
  markDuplicateGroups(COLUMN_GROUPS, values, issues, ISSUE_DUPLICATE_COLUMN);
  markDuplicateGroups(BLOCK_GROUPS, values, issues, ISSUE_DUPLICATE_BLOCK);

  return issues;
}

