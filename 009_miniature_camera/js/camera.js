const QUALITY = {
  low: { width: 640, height: 480, frameRate: 24 },
  standard: { width: 1280, height: 720, frameRate: 30 },
  high: { width: 1920, height: 1080, frameRate: 30 },
};

export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.audioStream = null;
    this.facingMode = "environment";
    this.quality = "standard";
    this.generation = 0;
    this.audioGeneration = 0;
    this.startQueue = Promise.resolve();
  }

  start({ facingMode = this.facingMode, quality = this.quality } = {}) {
    this.stopVideo();
    const generation = this.generation;
    const cancelled = () => new Error("CAMERA_CANCELLED");
    const run = async () => {
      if (generation !== this.generation) throw cancelled();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNSUPPORTED");
      const q = QUALITY[quality] || QUALITY.standard;
      const attempts = [
        { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.frameRate, max: 30 }, facingMode: { ideal: facingMode } },
        { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facingMode } },
        { facingMode },
        true,
      ];
      let lastError;
      for (const video of attempts) {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          if (generation !== this.generation) throw cancelled();
          this.video.srcObject = stream;
          await this.video.play();
          if (generation !== this.generation) throw cancelled();
          this.stream = stream;
          this.facingMode = facingMode;
          this.quality = quality;
          return stream;
        } catch (error) {
          stream?.getTracks().forEach((track) => track.stop());
          if (stream && this.video.srcObject === stream) this.video.srcObject = null;
          if (generation !== this.generation) throw cancelled();
          lastError = error;
        }
      }
      throw lastError;
    };
    const result = this.startQueue.then(run);
    this.startQueue = result.catch(() => {});
    return result;
  }

  async setAudio(enabled) {
    if (!enabled) { this.stopAudio(); return null; }
    if (this.audioStream?.active) return this.audioStream;
    const generation = ++this.audioGeneration;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (generation !== this.audioGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("AUDIO_CANCELLED");
    }
    this.audioStream = stream;
    return stream;
  }

  async flip() {
    return this.start({ facingMode: this.facingMode === "environment" ? "user" : "environment" });
  }

  get capabilities() {
    return this.stream?.getVideoTracks()[0]?.getCapabilities?.() || {};
  }

  async setZoom(value) {
    const track = this.stream?.getVideoTracks()[0];
    const zoom = this.capabilities.zoom;
    if (!track || !zoom) return false;
    const next = Math.max(zoom.min, Math.min(zoom.max, value));
    await track.applyConstraints({ advanced: [{ zoom: next }] });
    return true;
  }

  stopVideo() {
    ++this.generation;
    const attached = this.video.srcObject;
    attached?.getTracks().forEach((track) => track.stop());
    if (this.stream !== attached) this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  stopAudio() {
    ++this.audioGeneration;
    this.audioStream?.getTracks().forEach((track) => track.stop());
    this.audioStream = null;
  }

  stop() { this.stopVideo(); this.stopAudio(); }

  get settings() { return this.stream?.getVideoTracks()[0]?.getSettings?.() || {}; }
}
