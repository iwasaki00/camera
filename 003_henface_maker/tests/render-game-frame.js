// Test-only rendering buffer. Game production code has no export/capture API.
export function renderGameFrame(renderer, base, landmarks, session, now) {
  const canvas = document.createElement('canvas');
  canvas.width = base.width; canvas.height = base.height;
  renderer.render(base, canvas.getContext('2d'), landmarks, session, now, 'normal');
  return canvas;
}
