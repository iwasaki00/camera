import { BLINK_DROP_PARTS, DIFFICULTY_MODES, createBlinkDropSession, fallingStateAt } from "./blinkDropGame";
import type { BlinkDropDifficulty, BlinkDropPart, BlinkDropSession, FallingState } from "./blinkDropGame";
import type { Point } from "../featureRenderer";

export const GAME_TITLE = "カオストップ！";
export const GAME_SUBTITLE = "表情で止めて、変顔を完成させよう！";
export type GameMode = "free" | "challenge";
export const CHALLENGES = [
  { id: "perfect", code: "CH-01", name: "ぴったり顔", description: "すべてのパーツを本来の位置に止めよう！", progress: [.75, .75, .75, .75] },
  { id: "foreheadEyes", code: "CH-02", name: "おでこ目", description: "両目と眉をいつもより上に止めよう！", progress: [.5, .5, .75, .75] },
  { id: "highMouth", code: "CH-03", name: "口が上すぎ！", description: "口だけをいつもより上に止めよう！", progress: [.75, .75, .75, .5] },
  { id: "scattered", code: "CH-04", name: "バラバラ顔", description: "4つのパーツを、それぞれ違う高さに止めよう！", progress: [.45, .85, .65, .55] },
  { id: "chaosFace", code: "CH-05", name: "カオス顔", description: "難易度に応じて、位置・角度・サイズも合わせよう！", progress: [.625, .875, .68, .82] }
] as const;
export type ChallengeId = typeof CHALLENGES[number]["id"];
export const challengeDefinition = (id: ChallengeId) => CHALLENGES.find(item => item.id === id) ?? CHALLENGES[0];
export type ChallengeTarget = Pick<FallingState, "progress" | "verticalOffset" | "horizontalOffset" | "rotation" | "scale">;
export type ChallengeRun = { id: ChallengeId; targets: ChallengeTarget[]; scores: Array<number | null>; fixedTargets: Array<Point | null> };
export type ChallengeGeometry = {
  pose: { center: Point; scale: number; angle: number };
  parts: Record<BlinkDropPart | "rightBrow" | "leftBrow", { center: Point; dropHeight: number; contour: Point[] }>;
  skinOutline: Point[];
};

export function createChallengeRun(id: ChallengeId, difficulty: BlinkDropDifficulty): ChallengeRun {
  const session = createBlinkDropSession("playing", difficulty);
  // Use the existing trajectory, including the correlated sway/rotation/scale.
  // All templates stay away from the wrap seam and are reachable in one cycle.
  const targets = challengeDefinition(id).progress.map(progress => {
    const { verticalOffset, horizontalOffset, rotation, scale } = fallingStateAt(session, progress * DIFFICULTY_MODES[difficulty].durationMs);
    return { progress, verticalOffset, horizontalOffset, rotation, scale };
  });
  return { id, targets, scores: [null, null, null, null], fixedTargets: [null, null, null, null] };
}
const faceWidth = (g: ChallengeGeometry) => Math.max(...g.skinOutline.map(p => p.x)) - Math.min(...g.skinOutline.map(p => p.x));
export function challengeTargetPosition(g: ChallengeGeometry, index: number, target: ChallengeTarget): Point {
  const part = g.parts[BLINK_DROP_PARTS[index]];
  return { x: (part.center.x - g.pose.center.x + target.horizontalOffset * faceWidth(g)) / g.pose.scale,
    y: (part.center.y - g.pose.center.y + target.verticalOffset * part.dropHeight) / g.pose.scale };
}
export const CHALLENGE_SCORE_WEIGHTS = { vertical: .70, horizontal: .15, rotation: .10, scale: .05 } as const;
export const CHALLENGE_SCORE_TOLERANCE = { verticalDropUnits: 2, horizontalFaceWidth: .20, rotation: Math.PI / 4, scale: .4 } as const;
export function challengePartScore(g: ChallengeGeometry, index: number, target: ChallengeTarget,
  position: Point, transform: Pick<FallingState, "rotation" | "scale">, difficulty: BlinkDropDifficulty, id: ChallengeId): number {
  const goal = challengeTargetPosition(g, index, target);
  const errors: Array<{ error: number; weight: number }> = [
    { error: Math.abs(position.y - goal.y) / (g.parts[BLINK_DROP_PARTS[index]].dropHeight / g.pose.scale * CHALLENGE_SCORE_TOLERANCE.verticalDropUnits), weight: CHALLENGE_SCORE_WEIGHTS.vertical }
  ];
  if (difficulty === "CHAOS" || difficulty === "MONSTER") errors.push({
    error: Math.abs(position.x - goal.x) / (faceWidth(g) / g.pose.scale * CHALLENGE_SCORE_TOLERANCE.horizontalFaceWidth), weight: CHALLENGE_SCORE_WEIGHTS.horizontal });
  if (difficulty === "MONSTER" && id === "chaosFace") {
    const angle = Math.abs(Math.atan2(Math.sin(transform.rotation - target.rotation), Math.cos(transform.rotation - target.rotation)));
    errors.push({ error: angle / CHALLENGE_SCORE_TOLERANCE.rotation, weight: CHALLENGE_SCORE_WEIGHTS.rotation },
      { error: Math.abs(transform.scale - target.scale) / CHALLENGE_SCORE_TOLERANCE.scale, weight: CHALLENGE_SCORE_WEIGHTS.scale });
  }
  const weight = errors.reduce((sum, item) => sum + item.weight, 0);
  const error = errors.reduce((sum, item) => sum + Math.min(1, item.error) * item.weight, 0) / weight;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - error))));
}
export function recordChallengeCatch(session: BlinkDropSession, g: ChallengeGeometry): BlinkDropSession {
  if (session.gameMode !== "challenge" || !session.challenge || session.phase !== "fixing") return session;
  const i = session.currentIndex, position = session.fixedPositions[i], transform = session.fixedTransforms[i];
  if (!position || !transform || session.challenge.scores[i] !== null) return session;
  const target = session.challenge.targets[i], scores = session.challenge.scores.slice(), fixedTargets = session.challenge.fixedTargets.slice();
  scores[i] = challengePartScore(g, i, target, position, transform, session.difficulty, session.challenge.id);
  fixedTargets[i] = challengeTargetPosition(g, i, target);
  return { ...session, challenge: { ...session.challenge, scores, fixedTargets } };
}
export function challengeRank(score: number): string {
  return score >= 95 ? "PERFECT" : score >= 80 ? "GREAT" : score >= 60 ? "GOOD" : score >= 40 ? "CLOSE" : "MISS";
}
export function challengeResult(run: ChallengeRun): { score: number; rank: string } {
  const score = Math.round(run.scores.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 4);
  return { score, rank: challengeRank(score) };
}

/** Transparent guide layer only: the photo canvas is never modified here. */
export function renderChallengeGuide(ctx: CanvasRenderingContext2D, g: ChallengeGeometry | null, session: BlinkDropSession): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!g || session.gameMode !== "challenge" || !session.challenge || !["countdown", "playing", "fixing", "paused"].includes(session.phase)) return;
  const index = session.currentIndex, kind = BLINK_DROP_PARTS[index], target = session.challenge.targets[index];
  const goal = challengeTargetPosition(g, index, target), part = g.parts[kind];
  const x = g.pose.center.x + goal.x * g.pose.scale, y = g.pose.center.y + goal.y * g.pose.scale;
  ctx.save(); ctx.translate(g.pose.center.x, g.pose.center.y); ctx.rotate(g.pose.angle); ctx.translate(-g.pose.center.x, -g.pose.center.y);
  ctx.translate(x, y); ctx.rotate(target.rotation); ctx.scale(target.scale, target.scale);
  ctx.strokeStyle = "rgba(153,226,250,.85)"; ctx.fillStyle = "rgba(153,226,250,.08)";
  ctx.lineWidth = Math.max(1.5, g.pose.scale * .012); ctx.setLineDash([g.pose.scale * .035, g.pose.scale * .025]);
  const contour = (points: Point[]) => {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x - part.center.x, p.y - part.center.y) : ctx.moveTo(p.x - part.center.x, p.y - part.center.y));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  contour(part.contour);
  if (index < 2) contour(g.parts[index === 0 ? "rightBrow" : "leftBrow"].contour);
  ctx.setLineDash([]); ctx.beginPath(); ctx.arc(0, 0, g.pose.scale * .025, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
