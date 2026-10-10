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
  resultSnapshot?: string;
};

export default function BlinkDropHud({ session, cameraActive, tracking, start, pause, resume, restart, exit, save, resultSnapshot }: Props) {
  const current = BLINK_DROP_PARTS[session.currentIndex];
  if (session.phase === "ready" || session.phase === "error") return <div className="game-panel game-start-panel">
    <h2>瞬きキャッチ</h2>
    <p>眉・眼鏡まわりを含む目セット、鼻、口が落ちてきます。瞬きした位置で固定しよう！</p>
    <p className="game-order">右目セット → 左目セット → 鼻 → 口</p>
    {session.error && <p className="game-error">{session.error}</p>}
    <button className="primary-button" type="button" onClick={start}>ゲームスタート</button>
    <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
  </div>;
  if (session.phase === "countdown") return <div className="game-panel game-countdown"><strong>3</strong><span>顔を中央に合わせてね</span></div>;
  if (session.phase === "completed") {
    const score = blinkDropScore(session);
    return <div className="game-panel game-result-panel">
      {resultSnapshot && <img className="game-result-image" src={resultSnapshot} alt="瞬きキャッチの完成した顔" />}
      <div className="game-result-card">
      <h2>完成！</h2><strong>{score.title}</strong>
      <p>正解度 {score.accuracy}　変顔度 {score.funny}</p>
      <div className="game-result-actions"><button className="primary-button" type="button" onClick={restart}>もう一回</button>
        <button className="secondary-button" type="button" disabled={!resultSnapshot} onClick={save}>保存</button></div>
      <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
      </div>
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
