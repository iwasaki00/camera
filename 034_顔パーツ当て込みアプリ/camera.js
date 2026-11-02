export class Camera {
  constructor(video, mediaDevices = navigator.mediaDevices) {
    this.video = video; this.mediaDevices = mediaDevices; this.stream = null; this.generation = 0;
  }
  async start() {
    this.stop();
    const generation = this.generation;
    let stream;
    try {
      if (!this.mediaDevices?.getUserMedia) throw new Error('UNSUPPORTED');
      stream = await this.mediaDevices.getUserMedia({ audio: false, video: {
        facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }
      } });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream; this.video.srcObject = stream;
      this.video.muted = true; this.video.playsInline = true;
      await this.video.play();
      return generation === this.generation;
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (generation !== this.generation) return false;
      this.stop(); throw error;
    }
  }
  stop() {
    ++this.generation;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.video.pause(); this.video.srcObject = null;
  }
}
