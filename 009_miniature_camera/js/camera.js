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
  }

  async start({ facingMode = this.facingMode, quality = this.quality } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNSUPPORTED");
    this.stopVideo();
    this.facingMode = facingMode;
    this.quality = quality;
    const q = QUALITY[quality] || QUALITY.standard;
    const attempts = [
      { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.frameRate, max: 30 }, facingMode: { ideal: facingMode } },
      { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facingMode } },
      { facingMode },
      true,
    ];
    let lastError;
    for (const video of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        this.video.srcObject = this.stream;
        await this.video.play();
        return this.stream;
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }

  async setAudio(enabled) {
    if (!enabled) { this.stopAudio(); return null; }
    if (this.audioStream?.active) return this.audioStream;
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return this.audioStream;
  }

  async flip() {
    return this.start({ facingMode: this.facingMode === "environment" ? "user" : "environment" });
  }

  stopVideo() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  stopAudio() {
    this.audioStream?.getTracks().forEach((track) => track.stop());
    this.audioStream = null;
  }

  stop() { this.stopVideo(); this.stopAudio(); }

  get settings() { return this.stream?.getVideoTracks()[0]?.getSettings?.() || {}; }
}
