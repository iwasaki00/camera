export const PART_TYPES = Object.freeze({ mouth: '口', leftEye: '左目', rightEye: '右目', nose: '鼻' });
const defaults = {
  mouth: { width: 24, height: 10, x: .5, y: .65, zoom: 1.5 },
  leftEye: { width: 14, height: 7, x: .65, y: .38, zoom: 3 },
  rightEye: { width: 14, height: 7, x: .35, y: .38, zoom: 3 },
  nose: { width: 12, height: 16, x: .5, y: .52, zoom: 3 }
};

export function createPart(partType, zIndex = 0) {
  if (!Object.prototype.hasOwnProperty.call(PART_TYPES, partType)) throw new Error('Unknown part type');
  const d = defaults[partType];
  return { id: partType, partType, enabled: true,
    targetRect: { x: 50, y: 50, width: d.width, height: d.height },
    // Normalized center in the original, unmirrored video; zoom defines crop extent.
    sourceRect: { x: d.x, y: d.y, zoom: d.zoom }, rotation: 0, shape: 'oval', feather: 20, zIndex,
    guides: { photo: true, camera: true } };
}

export function migrateMouth(legacy = { x: 50, y: 65, width: 24, height: 10, rotation: 0, shape: 'oval', feather: 20 },
  source = { x: .5, y: .65, zoom: 1.5 }, mirror = true) {
  const part = createPart('mouth');
  for (const key of ['x', 'y', 'width', 'height']) part.targetRect[key] = legacy[key] ?? part.targetRect[key];
  for (const key of ['rotation', 'shape', 'feather']) part[key] = legacy[key] ?? part[key];
  part.sourceRect = { ...source, x: mirror ? 1 - source.x : source.x };
  return part;
}

export const sourceForDisplay = (part, mirror) => ({ ...part.sourceRect, x: mirror ? 1 - part.sourceRect.x : part.sourceRect.x });
export function setDisplaySource(part, source, mirror) {
  part.sourceRect = { ...source, x: mirror ? 1 - source.x : source.x };
}
export const orderedParts = parts => [...parts].filter(p => p.enabled).sort((a, b) => a.zIndex - b.zIndex);

export class PartCollection {
  constructor(legacy, source, mirror = true) {
    this.parts = [migrateMouth(legacy, source, mirror)]; this.selectedId = 'mouth';
  }
  get selected() { return this.parts.find(p => p.id === this.selectedId) || null; }
  select(id) { if (!this.parts.some(p => p.id === id)) return false; this.selectedId = id; return true; }
  add(type) {
    if (!Object.prototype.hasOwnProperty.call(PART_TYPES, type)) return null;
    const existing = this.parts.find(p => p.partType === type);
    if (existing) { this.selectedId = existing.id; return existing; }
    if (this.parts.length >= 4) return null;
    const part = createPart(type, Math.max(-1, ...this.parts.map(p => p.zIndex)) + 1);
    this.parts.push(part); this.selectedId = part.id; return part;
  }
  removeSelected() {
    const index = this.parts.findIndex(p => p.id === this.selectedId);
    if (index < 0) return false;
    this.parts.splice(index, 1);
    this.selectedId = this.parts[Math.min(index, this.parts.length - 1)]?.id ?? null;
    return true;
  }
  reorder(direction) {
    const sorted = [...this.parts].sort((a, b) => a.zIndex - b.zIndex);
    const index = sorted.findIndex(p => p.id === this.selectedId), next = index + direction;
    if (index < 0 || next < 0 || next >= sorted.length) return false;
    [sorted[index], sorted[next]] = [sorted[next], sorted[index]];
    sorted.forEach((part, zIndex) => { part.zIndex = zIndex; }); return true;
  }
}
