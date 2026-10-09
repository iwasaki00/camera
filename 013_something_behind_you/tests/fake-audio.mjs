export class FakeAudioContext {
  static instances = [];
  constructor() {
    FakeAudioContext.instances.push(this);
    this.state = "suspended";
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = {};
    this.nodes = [];
    this.starts = 0;
  }
  resume() { this.state = "running"; return Promise.resolve(); }
  param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }; }
  node() {
    const node = { gain: this.param(), frequency: this.param(), Q: this.param(), pan: this.param(),
      connections: [], disconnected: false, stopTimes: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnected = true; this.connections = []; },
      start: () => { this.starts++; },
      stop(time) { this.stopTimes.push(time); } };
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createStereoPanner() { return this.node(); }
  createOscillator() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
}
