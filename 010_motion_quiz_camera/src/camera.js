export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facingMode = "environment";
  }

  async start(facingMode = this.facingMode) {
    this.stop();
    this.facingMode = facingMode;
    const constraints = {
      audio: false,
      video: { facingMode: { ideal:facingMode }, width:{ ideal:1280, max:1280 }, height:{ ideal:720, max:720 }, frameRate:{ ideal:24, max:30 } }
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise(resolve => this.video.readyState >= 2 ? resolve() : this.video.addEventListener("loadeddata", resolve, { once:true }));
    return this.stream;
  }

  async flip() {
    return this.start(this.facingMode === "environment" ? "user" : "environment");
  }

  stop() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
