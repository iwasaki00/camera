import { BLINK_DROP_LABELS, BLINK_DROP_PARTS, blinkDropScore } from "./blinkDropGame";
import type { BlinkDropSession } from "./blinkDropGame";

type Props = {
  session: BlinkDropSession;
  cameraActive: boolean;
  tracking: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  exit: () => void;
  save: () => void;
};

export default function BlinkDropHud({ session, cameraActive, tracking, start, pause, resume, restart, exit, save }: Props) {
  const current = BLINK_DROP_PARTS[session.currentIndex];
  if (session.phase === "ready" || session.phase === "error") return <div className="game-panel game-start-panel">
    <h2>瞬きキャッチ</h2>
    <p>目・鼻・口が上から落ちてきます。瞬きした位置で固定しよう！</p>
    <p className="game-order">右目 → 左目 → 鼻 → 口</p>
    {session.error && <p className="game-error">{session.error}</p>}
    <button className="primary-button" type="button" onClick={start}>ゲームスタート</button>
    <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
  </div>;
  if (session.phase === "countdown") return <div className="game-panel game-countdown"><strong>3</strong><span>顔を中央に合わせてね</span></div>;
  if (session.phase === "completed") {
    const score = blinkDropScore(session);
    return <div className="game-panel game-result-panel">
      <h2>完成！</h2><strong>{score.title}</strong>
      <p>正解度 {score.accuracy}　変顔度 {score.funny}</p>
      <div className="game-result-actions"><button className="primary-button" type="button" onClick={restart}>もう一回</button>
        <button className="secondary-button" type="button" disabled={!cameraActive} onClick={save}>保存</button></div>
      <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
    </div>;
  }
  return <div className="game-hud">
    <div className="game-target"><strong>{session.phase === "fixing" ? "キャッチ！" : BLINK_DROP_LABELS[current] + "を止めて！"}</strong>
      <span>{session.currentIndex + 1} / 4</span></div>
    <div className={"blink-status " + (!tracking ? "is-waiting" : "")}>{tracking ? "まばたきで固定" : "顔を探しています…"}</div>
    <div className="game-mini-actions">
      {session.phase === "paused" ? <button type="button" onClick={resume}>再開</button> : <button type="button" onClick={pause}>一時停止</button>}
      <button type="button" onClick={restart}>リスタート</button><button type="button" onClick={exit}>やめる</button>
    </div>
    {session.phase === "paused" && <div className="game-paused">一時停止中</div>}
  </div>;
}
