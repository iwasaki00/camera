export class ActionDetector {
  constructor(cooldown = 200) {
    this.cooldown = cooldown;
    this.states = new Map();
  }

  setCooldown(value) { this.cooldown = value; }
  reset() { this.states.clear(); }

  // inactive → active → cooldown の遷移で「閾値を越えた瞬間」だけを返す。
  update(action, score, threshold, now = performance.now()) {
    const offThreshold = threshold * 0.72;
    const state = this.states.get(action) || { phase: "inactive", until: 0 };
    let triggered = false;

    if (state.phase === "inactive" && score >= threshold) {
      state.phase = "active";
      triggered = true;
    } else if (state.phase === "active" && score < offThreshold) {
      state.phase = "cooldown";
      state.until = now + this.cooldown;
    } else if (state.phase === "cooldown") {
      if (score >= threshold) {
        state.phase = "active"; // 戻り切る前の再動作では鳴らさない
      } else if (now >= state.until && score < offThreshold) {
        state.phase = "inactive";
      }
    }

    this.states.set(action, state);
    return { triggered, phase: state.phase, score, threshold };
  }
}
