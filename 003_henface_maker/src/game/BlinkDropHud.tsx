import { useEffect, useState } from "react";
import { BLINK_DROP_LABELS, BLINK_DROP_PARTS, BLINK_DROP_DIFFICULTIES, DIFFICULTY_MODES, blinkDropScore } from "./blinkDropGame";
import type { BlinkDropSession, BlinkDropDifficulty } from "./blinkDropGame";
import { FACE_TRIGGER_OPTIONS } from "./faceTriggers";
import type { FaceTriggerSettings } from "./faceTriggers";

export function FaceTriggerControls({ settings, change, disabled = false }: {
  settings: FaceTriggerSettings; change: (settings: FaceTriggerSettings) => void; disabled?: boolean
}) {
  return <fieldset className="game-trigger-settings" disabled={disabled}><legend>固定する操作</legend>
    {FACE_TRIGGER_OPTIONS.map(({ key, label }) => <label key={key}>
      <input type="checkbox" aria-label={label + "で固定"} checked={settings[key]} onChange={e => change({ ...settings, [key]: e.target.checked })} />{label}
    </label>)}<small>タップ固定はいつでも有効</small>
  </fieldset>;
}

type Props = {
  session: BlinkDropSession;
  countdownText: string;
  difficulty: BlinkDropDifficulty;
  selectDifficulty: (difficulty: BlinkDropDifficulty) => void;
  triggerSettings: FaceTriggerSettings;
  selectTriggers: (settings: FaceTriggerSettings) => void;
  settingsDisabled: boolean;
  cameraActive: boolean;
  tracking: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  exit: () => void;
  save: () => void;
};

export default function BlinkDropHud({ session, countdownText, difficulty, selectDifficulty, triggerSettings, selectTriggers, settingsDisabled, cameraActive, tracking, start, pause, resume, restart, exit, save }: Props) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    if (session.phase === "playing" && session.currentIndex === 0) {
      const timer = window.setTimeout(() => setNow(performance.now()), Math.max(0, session.partStartedAt + 300 - performance.now()));
      return () => window.clearTimeout(timer);
    }
  }, [session.phase, session.countdownStartedAt, session.partStartedAt, session.currentIndex]);
  const current = BLINK_DROP_PARTS[session.currentIndex];
  if (session.phase === "ready" || session.phase === "error") return <div className="game-panel game-start-panel">
    <h2>瞬きキャッチ</h2>
    <p>目と眉が一緒に落ちてきます。瞬き・見開き・大きな開口で固定！映像タップでも遊べます。</p>
    <p className="game-order">右目と眉 → 左目と眉 → 鼻 → 口</p>
    <label className="game-difficulty-picker">難易度
      <select aria-label="ゲーム難易度" aria-describedby="game-difficulty-description" value={difficulty} onChange={e => selectDifficulty(e.target.value as BlinkDropDifficulty)}>
        {BLINK_DROP_DIFFICULTIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <small id="game-difficulty-description">{DIFFICULTY_MODES[difficulty].description}</small>
    <FaceTriggerControls settings={triggerSettings} change={selectTriggers} disabled={settingsDisabled} />
    {session.error && <p className="game-error">{session.error}</p>}
    <button className="primary-button" type="button" onClick={start}>ゲームスタート</button>
    <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
  </div>;
  if (session.phase === "countdown") return <div className="game-panel game-countdown"><strong>{countdownText}</strong><span>目を開いて顔を中央に合わせてね</span>
    <button type="button" onClick={pause}>一時停止</button><button type="button" onClick={restart}>リスタート</button></div>;
  if (session.phase === "paused" && session.pausedPhase === "countdown") return <div className="game-panel game-countdown"><strong>{countdownText}</strong><span>カウントダウン一時停止中</span>
    <button type="button" onClick={resume}>再開</button><button type="button" onClick={restart}>リスタート</button></div>;
  if (session.phase === "completed") {
    const score = blinkDropScore(session);
    return <div className="game-panel game-result-panel">
      <div className="game-result-card">
      <h2>完成！</h2><strong>{score.title}</strong>
      <p>正解度 {score.accuracy}　変顔度 {score.funny}</p>
      <div className="game-result-actions"><button className="primary-button" type="button" onClick={restart}>もう一回</button>
        <button className="secondary-button" type="button" disabled={!cameraActive} onClick={save}>写真を保存</button></div>
      <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
      </div>
    </div>;
  }
  return <div className="game-hud">
    {session.phase === "playing" && session.currentIndex === 0 && now - session.partStartedAt < 300 && <div className="game-start-cue">START!</div>}
    <div className="game-target"><strong>{session.phase === "fixing" ? "キャッチ！ 表情を戻してね" : BLINK_DROP_LABELS[current] + "を止めて！"}</strong>
      <span><small className="game-difficulty">{session.difficulty}</small>{session.currentIndex + 1} / 4</span></div>
    <div className={"blink-status " + (!tracking ? "is-waiting" : "")}>{tracking ? "表情で固定 · 映像タップでもOK" : "顔を探しています…"}</div>
    <div className="game-mini-actions">
      {session.phase === "paused" ? <button type="button" onClick={resume}>再開</button> : <button type="button" onClick={pause}>一時停止</button>}
      <button type="button" onClick={restart}>リスタート</button><button type="button" onClick={exit}>やめる</button>
    </div>
    {session.phase === "paused" && <div className="game-paused">一時停止中</div>}
  </div>;
}
