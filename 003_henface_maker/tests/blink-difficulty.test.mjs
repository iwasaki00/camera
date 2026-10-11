import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../src/game/blinkDropGame.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const game = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const { createBlinkDropSession, beginBlinkDrop, fallingStateAt, fallingOffsetAt, catchBlinkDropPart,
  advanceBlinkDrop, pauseBlinkDrop, resumeBlinkDrop, blinkDropScore, DIFFICULTY_MODES } = game;
const play = difficulty => beginBlinkDrop(createBlinkDropSession('countdown', difficulty), 1000);
assert.deepEqual(game.BLINK_DROP_DIFFICULTIES, ['EASY','NORMAL','HARD','CHAOS','MONSTER']);
assert.equal(createBlinkDropSession().difficulty, 'NORMAL');
assert.equal(game.startBlinkDropCountdown(100, 'MONSTER').difficulty, 'MONSTER');

// Compare NORMAL directly with the pre-0.7 formula, including repeat boundaries.
for (let elapsed = 0; elapsed < 30000; elapsed += 17) {
  assert.equal(fallingOffsetAt(play('NORMAL'), 1000 + elapsed), -6 + 8 * (elapsed % 2400) / 2400);
}
assert(DIFFICULTY_MODES.EASY.durationMs > DIFFICULTY_MODES.NORMAL.durationMs);
assert(DIFFICULTY_MODES.HARD.durationMs < DIFFICULTY_MODES.NORMAL.durationMs);
for (const difficulty of game.BLINK_DROP_DIFFICULTIES) {
  const session = play(difficulty), duration = DIFFICULTY_MODES[difficulty].durationMs;
  for (let elapsed = 0; elapsed < duration * 4; elapsed += 13) {
    const state = fallingStateAt(session, 1000 + elapsed);
    assert(state.progress >= 0 && state.progress < 1);
    assert(state.verticalOffset >= -6 && state.verticalOffset < 2);
    assert(Math.abs(state.horizontalOffset) <= DIFFICULTY_MODES[difficulty].sway + 1e-12);
    assert(Math.abs(state.rotation) <= Math.PI * 25 / 180 + 1e-12);
    assert(state.scale >= .8 - 1e-12 && state.scale <= 1.2 + 1e-12);
    assert.equal(state.elapsedTime, elapsed);
  }
  assert.equal(fallingStateAt(session, 1000 + duration).progress, 0);
  assert.equal(fallingStateAt(session, 1000 + duration).verticalOffset, -6);
  for (const fps of [7,24,30,60,120]) {
    const at = 1000 + duration * .63;
    for (let t = 1000; t < at; t += 1000 / fps) fallingStateAt(session, t);
    assert.deepEqual(fallingStateAt(session, at), fallingStateAt(play(difficulty), at));
  }
  const pauseAt = 1000 + duration * .42;
  const paused = pauseBlinkDrop(session, pauseAt), frozen = fallingStateAt(session, pauseAt);
  assert.deepEqual(fallingStateAt(paused, pauseAt + 9000), frozen);
  const resumed = resumeBlinkDrop(paused, pauseAt + 9000);
  assert.deepEqual(fallingStateAt(resumed, pauseAt + 9000), frozen);
  assert.deepEqual(fallingStateAt(resumed, pauseAt + 9250), fallingStateAt(session, pauseAt + 250));
  const caught = catchBlinkDropPart(session, pauseAt, {x:.7,y:-.3}, {x:.05,y:-.2});
  assert.equal(session.fixedTransforms[0], null, 'Original session is immutable');
  assert.deepEqual(caught.fixedTransforms[0], { partType:'rightEye', horizontalOffset:frozen.horizontalOffset, rotation:frozen.rotation, scale:frozen.scale });
  assert.deepEqual(caught.fixedPositions[0], {x:.7,y:-.3});
  assert.deepEqual(fallingStateAt(caught, pauseAt + 9000), frozen, 'FIXING does not advance');
  const pausedFix = pauseBlinkDrop(caught, pauseAt + 100);
  assert.deepEqual(fallingStateAt(pausedFix, pauseAt + 9000), frozen);
  const resumedFix = resumeBlinkDrop(pausedFix, pauseAt + 9100);
  assert.deepEqual(fallingStateAt(resumedFix, pauseAt + 9200), frozen);
  assert.equal(catchBlinkDropPart(caught, pauseAt + 1), caught, 'One operation fixes one turn');
  let complete = caught;
  for (let index = 1; index < 4; index++) {
    complete = advanceBlinkDrop(complete, pauseAt + index * 2000);
    complete = catchBlinkDropPart(complete, complete.partStartedAt + duration * .68, {x:index*.2,y:index*.1});
  }
  const saved = JSON.stringify(complete.fixedTransforms);
  complete = advanceBlinkDrop(complete, 50000);
  assert.equal(complete.phase, 'completed');
  assert.deepEqual(complete.fixedTransforms.map(p=>p.partType), game.BLINK_DROP_PARTS);
  assert.equal(JSON.stringify(complete.fixedTransforms), saved);
  const score = blinkDropScore(complete); assert(score.accuracy >= 0 && score.accuracy <= 100 && score.funny >= 0 && score.funny <= 100);
  console.log('PASS ' + difficulty + ': duration, bounded motion, FPS independence, repeat, pause/FIXING, snapshot, four turns');
}
for (const difficulty of ['EASY','NORMAL','HARD']) {
  const state = fallingStateAt(play(difficulty), 1000 + DIFFICULTY_MODES[difficulty].durationMs * .125);
  assert.equal(state.horizontalOffset, 0); assert.equal(state.rotation, 0); assert.equal(state.scale, 1);
}
const chaos = fallingStateAt(play('CHAOS'), 1000 + 2500 * .125);
assert(chaos.horizontalOffset > .09); assert.equal(chaos.rotation, 0); assert.equal(chaos.scale, 1);
const monster = fallingStateAt(play('MONSTER'), 1000 + 1500 * .125);
assert(monster.horizontalOffset > chaos.horizontalOffset); assert(monster.rotation > 0); assert(monster.scale > 1);
for (let t = 1000; t < 3400; t += 19) {
  const caught = catchBlinkDropPart(play('NORMAL'), t), average = Math.abs(caught.fixedOffsets[0]);
  const score = blinkDropScore(caught);
  assert.equal(score.accuracy, Math.max(0,Math.round(100-average/6*100)));
  assert.equal(score.funny, Math.min(100,Math.round(average/5*100)));
}
const perfect = {...createBlinkDropSession('completed'), fixedOffsets:[0,null,null,null]};
const skewed = {...perfect, fixedTransforms:[{partType:'rightEye',horizontalOffset:.16,rotation:.4,scale:1.2},null,null,null]};
assert(blinkDropScore(skewed).accuracy < blinkDropScore(perfect).accuracy);
assert(blinkDropScore(skewed).funny > blinkDropScore(perfect).funny);
console.log('PASS NORMAL exact legacy motion/score; CHAOS/MONSTER motion and score penalties');
