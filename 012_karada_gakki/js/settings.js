export const ACTIONS = {
  face: [
    ["mouthOpen", "口を開く"], ["winkLeft", "左ウインク"], ["winkRight", "右ウインク"],
    ["smile", "笑顔"], ["tiltLeft", "頭を左へ"], ["tiltRight", "頭を右へ"],
  ],
  body: [
    ["leftHand", "左手を上げる"], ["rightHand", "右手を上げる"], ["bothHands", "両手を上げる"],
    ["leftLeg", "左足を上げる"], ["rightLeg", "右足を上げる"],
  ],
};

export const PRESETS = {
  drum: {
    face: { mouthOpen: "kick", winkLeft: "hihat", winkRight: "snare", smile: "clap", tiltLeft: "c4", tiltRight: "d4" },
    body: { leftHand: "hihat", rightHand: "snare", bothHands: "crash", leftLeg: "kick", rightLeg: "tom" },
  },
  piano: {
    face: { mouthOpen: "c4", winkLeft: "d4", winkRight: "e4", smile: "g4", tiltLeft: "c4", tiltRight: "d4" },
    body: { leftHand: "c4", rightHand: "d4", bothHands: "g4", leftLeg: "e4", rightLeg: "g4" },
  },
  effect: {
    face: { mouthOpen: "crash", winkLeft: "hihat", winkRight: "clap", smile: "snare", tiltLeft: "tom", tiltRight: "kick" },
    body: { leftHand: "clap", rightHand: "snare", bothHands: "crash", leftLeg: "tom", rightLeg: "kick" },
  },
};

export const SOUND_OPTIONS = ["kick", "snare", "hihat", "clap", "tom", "crash", "c4", "d4", "e4", "g4"];

export function loadSettings() {
  const fallback = { preset: "drum", sensitivity: 50, cooldown: 200, volume: 80, assignments: JSON.parse(JSON.stringify(PRESETS.drum)) };
  try {
    const saved = JSON.parse(localStorage.getItem("karada-gakki-settings"));
    return saved ? { ...fallback, ...saved, assignments: { ...fallback.assignments, ...saved.assignments } } : fallback;
  } catch (_) { return fallback; }
}

export function saveSettings(settings) {
  localStorage.setItem("karada-gakki-settings", JSON.stringify(settings));
}

// 感度を上げるほど必要スコアを下げる（基準値の70〜130%）。
export function scaledThreshold(base, sensitivity) {
  return Math.min(0.98, Math.max(0.08, base * (1.3 - sensitivity * 0.006)));
}
