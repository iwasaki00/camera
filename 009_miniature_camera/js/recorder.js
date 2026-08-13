const TYPES = ["video/mp4;codecs=h264", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function supportedMimeType() {
  if (!window.MediaRecorder) return "";
  return TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export class CanvasRecorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.recorder = null;
    this.chunks = [];
    this.stream = null;
    this.mimeType = supportedMimeType();
  }

  get supported() { return Boolean(window.MediaRecorder && this.canvas.captureStream && this.mimeType); }

  start(audioStream, fps = 30) {
    if (!this.supported) throw new Error("RECORDING_UNSUPPORTED");
    const videoTrack = this.canvas.captureStream(fps).getVideoTracks()[0];
    const tracks = [videoTrack];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    this.stream = new MediaStream(tracks);
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder.ondataavailable = (event) => { if (event.data?.size) this.chunks.push(event.data); };
    this.recorder.start(1000);
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === "inactive") return reject(new Error("NOT_RECORDING"));
      this.recorder.onerror = () => reject(new Error("RECORDING_FAILED"));
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.stream?.getVideoTracks().forEach((track) => track.stop());
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}
