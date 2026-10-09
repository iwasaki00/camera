import { PRESENCE_CONFIG, presenceSpatial } from "./presence.js";
import { signedAngleDifference } from "./logic.js";

// 合成器だけを差し替えれば、Director・方向・距離のロジックは維持できる。
export class PresenceAudio {
  constructor(Context, config = PRESENCE_CONFIG, random = Math.random) {
    this.Context = Context;
    this.config = config;
    this.random = random;
    this.enabled = true;
    this.volume = config.initialVolume;
    this.context = null;
    this.master = null;
    this.voice = null;
    this.lastSpatial = null;
    this.error = "";
  }
  get state() { return this.context?.state || (this.Context ? "not-initialized" : "unsupported"); }
  get ready() { return this.enabled && this.state === "running"; }
  // START / SOUND ONの同期的なユーザー操作を起点としてのみ呼ぶ。
  async unlock() {
    if (!this.enabled || !this.Context) return false;
    try {
      if (!this.context || this.context.state === "closed") {
        this.context = new this.Context();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume * this.config.maximumGain;
        this.master.connect(this.context.destination);
      }
      if (this.context.state !== "running") await this.context.resume();
      this.error = "";
      return this.ready;
    } catch {
      this.error = "Audio unavailable — tap SOUND ON to retry";
      this.stop();
      return false;
    }
  }
  setEnabled(enabled) { this.enabled = enabled; if (!enabled) this.stop(); }
  stop() {
    const voice = this.voice;
    this.voice = null;
    if (!voice) return;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* 自然終了済み */ }
    for (const node of voice.nodes) { try { node.disconnect(); } catch { /* 切断済み */ } }
  }
  spatial(event, relativeYaw, distance) {
    const spatial = presenceSpatial(signedAngleDifference(event.yaw, relativeYaw), distance, this.config);
    if (!spatial) return;
    this.lastSpatial = { ...spatial,
      effectiveVolume: spatial.gain * this.volume * this.config.maximumGain * this.config.sounds[event.type].peak };
    if (!this.voice) return;
    const now = this.context.currentTime;
    this.voice.spatialGain.gain.setTargetAtTime(spatial.gain, now, 0.025);
    this.voice.rearFilter.frequency.setTargetAtTime(spatial.cutoff, now, 0.025);
    this.voice.panner?.pan.setTargetAtTime(spatial.pan, now, 0.025);
  }
  play(event, relativeYaw, distance) {
    if (!this.ready || !this.config.sounds[event.type] || !Number.isFinite(event.yaw)
      || !Number.isFinite(relativeYaw) || !Number.isFinite(distance)) return false;
    this.stop();
    const context = this.context;
    const sound = this.config.sounds[event.type];
    const duration = sound.duration / 1000;
    const nodes = [];
    let source;
    try {
      const noise = event.type === "RUSTLE" || event.type === "BREATH";
      source = noise ? context.createBufferSource() : context.createOscillator();
      nodes.push(source);
      if (noise) {
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (this.random() * 2 - 1) * 0.5;
        source.buffer = buffer;
        source.loop = false;
      } else {
        source.type = event.type === "TAP" ? "sine" : "triangle";
        source.frequency.setValueAtTime(sound.frequency, context.currentTime);
        source.frequency.exponentialRampToValueAtTime(sound.frequency * 0.5, context.currentTime + duration);
      }
      const tone = context.createBiquadFilter();
      const rearFilter = context.createBiquadFilter();
      const envelope = context.createGain();
      const spatialGain = context.createGain();
      nodes.push(tone, rearFilter, envelope, spatialGain);
      tone.type = noise ? "bandpass" : "lowpass";
      tone.frequency.value = noise ? sound.frequency : 700;
      tone.Q.value = 0.5;
      rearFilter.type = "lowpass";
      // StereoPanner非対応時も再生可（mono fallback）。
      const panner = context.createStereoPanner ? context.createStereoPanner() : null;
      if (panner) nodes.push(panner);
      source.connect(tone);
      tone.connect(rearFilter);
      rearFilter.connect(panner || envelope);
      panner?.connect(envelope);
      envelope.connect(spatialGain);
      spatialGain.connect(this.master);
      const now = context.currentTime;
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(sound.peak, now + sound.attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      const voice = { source, nodes, spatialGain, rearFilter, panner };
      this.voice = voice;
      // 初回は直接設定し、以降の向き・距離変更は短い補間を使う。
      const spatial = presenceSpatial(signedAngleDifference(event.yaw, relativeYaw), distance, this.config);
      spatialGain.gain.value = spatial.gain;
      rearFilter.frequency.value = spatial.cutoff;
      if (panner) panner.pan.value = spatial.pan;
      this.spatial(event, relativeYaw, distance);
      source.onended = () => { if (this.voice === voice) this.voice = null; nodes.forEach(node => node.disconnect()); };
      source.start(now);
      source.stop(now + duration + 0.02);
      this.error = "";
      return true;
    } catch {
      this.stop();
      try { source?.stop(); } catch { /* 未開始 */ }
      nodes.forEach(node => { try { node.disconnect(); } catch { /* 未接続 */ } });
      this.error = "Audio playback unavailable";
      return false;
    }
  }
}
