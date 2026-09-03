const SOUND_FILES = {
  kick: "assets/audio/drums/kick.wav",
  snare: "assets/audio/drums/snare.wav",
  hihat: "assets/audio/drums/hihat.wav",
  clap: "assets/audio/drums/clap.wav",
  tom: "assets/audio/drums/tom.wav",
  crash: "assets/audio/drums/crash.wav",
  c4: "assets/audio/piano/c4.wav",
  d4: "assets/audio/piano/d4.wav",
  e4: "assets/audio/piano/e4.wav",
  g4: "assets/audio/piano/g4.wav",
};

const NOTES = { c4: 261.63, d4: 293.66, e4: 329.63, g4: 392 };

export const SOUND_LABELS = {
  kick: "KICK", snare: "SNARE", hihat: "HI-HAT", clap: "CLAP", tom: "TOM",
  crash: "CRASH", c4: "PIANO C", d4: "PIANO D", e4: "PIANO E", g4: "PIANO G",
};

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.volume = 0.8;
    this.buffers = new Map();
  }

  // iOS Safariの制約に合わせ、必ずタップイベント内から呼ぶ。
  async unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio APIに対応していません。");
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    const silent = this.context.createBuffer(1, 1, this.context.sampleRate);
    const source = this.context.createBufferSource();
    source.buffer = silent;
    source.connect(this.master);
    source.start();
    this.preload();
  }

  setVolume(value) {
    this.volume = value;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.015);
    }
  }

  async preload() {
    // 素材未配置でもアプリを止めず、play()の合成音フォールバックを使う。
    await Promise.all(Object.entries(SOUND_FILES).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(name, buffer);
      } catch (_) { /* optional audio files */ }
    }));
  }

  play(name) {
    if (!this.context || this.context.state !== "running") return;
    const buffer = this.buffers.get(name);
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.master);
      source.start();
      return;
    }
    this.playSynth(name);
  }

  playSynth(name) {
    const ctx = this.context;
    const now = ctx.currentTime;
    if (NOTES[name]) return this.tone(NOTES[name], now, 0.5, "triangle");
    if (name === "kick") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
      gain.gain.setValueAtTime(0.9, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain).connect(this.master); osc.start(now); osc.stop(now + 0.23); return;
    }
    if (name === "tom") return this.tone(115, now, 0.22, "sine");
    this.noise(now, name === "crash" ? 0.6 : name === "hihat" ? 0.08 : 0.16, name);
  }

  tone(frequency, now, duration, type) {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type; osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.48, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(this.master); osc.start(now); osc.stop(now + duration);
  }

  noise(now, duration, kind) {
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = kind === "snare" ? "bandpass" : "highpass";
    filter.frequency.value = kind === "crash" ? 3200 : 6500;
    gain.gain.setValueAtTime(kind === "hihat" ? 0.25 : 0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(this.master); source.start(now);
  }
}
