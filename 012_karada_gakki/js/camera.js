export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
  }

  async start() {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("このブラウザはカメラ撮影に対応していません。");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 720 },
        height: { ideal: 1280 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.readyState >= 2) resolve();
      else this.video.addEventListener("loadeddata", resolve, { once: true });
    });
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
