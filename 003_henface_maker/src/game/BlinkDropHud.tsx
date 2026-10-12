import { useEffect, useState } from "react";
import { BLINK_DROP_LABELS, BLINK_DROP_PARTS, BLINK_DROP_DIFFICULTIES, DIFFICULTY_MODES, blinkDropScore } from "./blinkDropGame";
import type { BlinkDropSession, BlinkDropDifficulty } from "./blinkDropGame";
import { FACE_TRIGGER_OPTIONS } from "./faceTriggers";
import type { FaceTriggerSettings } from "./faceTriggers";
import { GAME_TITLE, CHALLENGES, challengeDefinition, challengeRank, challengeResult } from "./faceChallenge";
import type { GameMode, ChallengeId } from "./faceChallenge";

export function GameModeControls({ mode, selectMode, challengeId, selectChallenge, difficulty, disabled = false }: {
  mode: GameMode; selectMode: (mode: GameMode) => void; challengeId: ChallengeId;
  selectChallenge: (id: ChallengeId) => void; difficulty: BlinkDropDifficulty; disabled?: boolean
}) {
  return <fieldset className="game-mode-settings" disabled={disabled}><legend>ゲームモード</legend>
    <div className="game-mode-buttons">
      <button type="button" aria-pressed={mode === "free"} onClick={() => selectMode("free")}>FREE · フリー</button>
      <button type="button" aria-pressed={mode === "challenge"} onClick={() => selectMode("challenge")}>CHALLENGE · お題</button>
    </div>
    {mode === "challenge" ? <>
      <label className="game-challenge-picker">お題<select aria-label="チャレンジのお題" value={challengeId} onChange={e => selectChallenge(e.target.value as ChallengeId)}>
        {CHALLENGES.map(item => <option key={item.id} value={item.id}>{item.code} {item.name}</option>)}
      </select></label>
      <small>{challengeDefinition(challengeId).description}</small>
      <small>{difficulty === "MONSTER" && challengeId === "chaosFace" ? "位置・角度・サイズを採点" : difficulty === "CHAOS" || difficulty === "MONSTER" ? "縦・横の位置を採点" : "縦の位置を採点"}</small>
    </> : <small>自由に止めて、好きな変顔を作ろう！</small>}
  </fieldset>;
}

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
  gameMode: GameMode;
  selectMode: (mode: GameMode) => void;
  challengeId: ChallengeId;
  selectChallenge: (id: ChallengeId) => void;
  setup: () => void;
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

export default function BlinkDropHud({ session, countdownText, difficulty, selectDifficulty, gameMode, selectMode, challengeId, selectChallenge, setup, triggerSettings, selectTriggers, settingsDisabled, cameraActive, tracking, start, pause, resume, restart, exit, save }: Props) {
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
    <h2>{GAME_TITLE}</h2>
    <p>目と眉が一緒に落ちてきます。瞬き・見開き・大きな開口で固定！映像タップでも遊べます。</p>
    <p className="game-order">右目と眉 → 左目と眉 → 鼻 → 口</p>
    <GameModeControls mode={gameMode} selectMode={selectMode} challengeId={challengeId} selectChallenge={selectChallenge} difficulty={difficulty} disabled={settingsDisabled} />
    <label className="game-difficulty-picker">難易度
      <select aria-label="ゲーム難易度" aria-describedby="game-difficulty-description" value={difficulty} onChange={e => selectDifficulty(e.target.value as BlinkDropDifficulty)}>
        {BLINK_DROP_DIFFICULTIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <small id="game-difficulty-description">{DIFFICULTY_MODES[difficulty].description}</small>
    <details className="game-operation-details"><summary>固定する操作（瞬き・見開き・開口・タップ）</summary>
      <FaceTriggerControls settings={triggerSettings} change={selectTriggers} disabled={settingsDisabled} />
    </details>
    {session.error && <p className="game-error">{session.error}</p>}
    <button className="primary-button" type="button" onClick={start}>ゲームスタート</button>
    <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button>
  </div>;
  if (session.phase === "countdown") return <div className="game-panel game-countdown"><strong>{countdownText}</strong>
    {session.challenge && <span>{challengeDefinition(session.challenge.id).name}に挑戦！<small className="challenge-countdown-description">{challengeDefinition(session.challenge.id).description}</small></span>}
    <span>目と口を普通に戻して、顔を中央に合わせてね</span>
    <button type="button" onClick={pause}>一時停止</button><button type="button" onClick={restart}>リスタート</button></div>;
  if (session.phase === "paused" && session.pausedPhase === "countdown") return <div className="game-panel game-countdown"><strong>{countdownText}</strong><span>カウントダウン一時停止中</span>
    <button type="button" onClick={resume}>再開</button><button type="button" onClick={restart}>リスタート</button></div>;
  if (session.phase === "completed") {
    const score = blinkDropScore(session);
    const result = session.challenge ? challengeResult(session.challenge) : null;
    return <div className="game-panel game-result-panel">
      <div className="game-result-card">
      <h2>{GAME_TITLE} 完成！</h2><strong>{result ? `総合 ${result.score}点 · ${result.rank}` : score.title}</strong>
      {session.challenge ? <p className="challenge-result-name">{challengeDefinition(session.challenge.id).name}<small>パーツ得点：{session.challenge.scores.map(value => value ?? 0).join(" / ")}</small></p> : <p>正解度 {score.accuracy}　変顔度 {score.funny}</p>}
      <div className="game-result-actions"><button className="primary-button" type="button" onClick={restart}>もう一回</button>
        <button className="secondary-button" type="button" disabled={!cameraActive} onClick={save}>写真を保存</button></div>
      <div className="game-result-actions"><button className="minor-button" type="button" onClick={setup}>モード選択へ戻る</button>
        <button className="minor-button" type="button" onClick={exit}>通常モードへ戻る</button></div>
      </div>
    </div>;
  }
  return <div className="game-hud">
    {session.phase === "playing" && session.currentIndex === 0 && now - session.partStartedAt < 300 && <div className="game-start-cue">START!</div>}
    <div className="game-target"><div>{session.challenge && <small className="game-challenge-name">{challengeDefinition(session.challenge.id).name}</small>}
      <strong>{session.phase === "fixing" ? "キャッチ！ 表情を戻してね" : BLINK_DROP_LABELS[current] + "を止めて！"}</strong></div>
      <span><small className="game-difficulty">{session.difficulty}</small>{session.currentIndex + 1} / 4</span></div>
    <div className={"blink-status " + (!tracking ? "is-waiting" : "")}>{tracking ? "表情で固定 · 映像タップでもOK" : "顔を探しています…"}</div>
    {session.challenge && (() => {
      const i = session.phase === "fixing" || session.pausedPhase === "fixing" ? session.currentIndex : session.currentIndex - 1;
      const value = session.challenge.scores[i];
      return value != null ? <div className="challenge-feedback" role="status">{BLINK_DROP_LABELS[BLINK_DROP_PARTS[i]]}：{value}点 · {challengeRank(value)}</div> : null;
    })()}
    <div className="game-mini-actions">
      {session.phase === "paused" ? <button type="button" onClick={resume}>再開</button> : <button type="button" onClick={pause}>一時停止</button>}
      <button type="button" onClick={restart}>リスタート</button><button type="button" onClick={exit}>やめる</button>
    </div>
    {session.phase === "paused" && <div className="game-paused">一時停止中</div>}
  </div>;
}
