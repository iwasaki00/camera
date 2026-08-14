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

export class TimeLapseRecorder {
  constructor(sourceCanvas) {
    this.sourceCanvas = sourceCanvas;
    this.frames = [];
    this.factor = 4;
    this.timer = null;
    this.capturing = false;
    this.maxFrames = 600;
    this.frameCanvas = document.createElement("canvas");
    this.frameContext = this.frameCanvas.getContext("2d", { alpha: false });
  }

  get supported() {
    return Boolean(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && window.createImageBitmap && supportedMimeType());
  }

  async captureFrame() {
    if (this.capturing || this.frames.length >= this.maxFrames) return;
    this.capturing = true;
    const source = this.sourceCanvas;
    const width = Math.min(640, source.width);
    const height = Math.max(2, Math.round(width * source.height / source.width));
    if (this.frameCanvas.width !== width || this.frameCanvas.height !== height) {
      this.frameCanvas.width = width; this.frameCanvas.height = height;
    }
    this.frameContext.drawImage(source, 0, 0, width, height);
    const blob = await new Promise((resolve) => this.frameCanvas.toBlob(resolve, "image/jpeg", .84));
    if (blob) this.frames.push(blob);
    this.capturing = false;
  }

  start(factor = 4) {
    if (!this.supported) throw new Error("TIMELAPSE_UNSUPPORTED");
    this.factor = factor;
    this.frames = [];
    this.captureFrame();
    this.timer = setInterval(() => this.captureFrame(), Math.max(80, 1000 * factor / 30));
  }

  async stop() {
    clearInterval(this.timer);
    while (this.capturing) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.frames.length < 2) throw new Error("TIMELAPSE_TOO_SHORT");
    const output = document.createElement("canvas");
    output.width = this.frameCanvas.width; output.height = this.frameCanvas.height;
    const ctx = output.getContext("2d", { alpha: false });
    const stream = output.captureStream(30);
    const mimeType = supportedMimeType();
    const chunks = [];
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    const result = new Promise((resolve, reject) => {
      mediaRecorder.onerror = () => reject(new Error("TIMELAPSE_ENCODING_FAILED"));
      mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });
    mediaRecorder.start(500);
    for (const frame of this.frames) {
      const bitmap = await createImageBitmap(frame);
      ctx.drawImage(bitmap, 0, 0, output.width, output.height);
      bitmap.close?.();
      await new Promise((resolve) => setTimeout(resolve, 34));
    }
    mediaRecorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    const blob = await result;
    this.frames = [];
    return blob;
  }

  get outputSeconds() { return this.frames.length / 30; }
}
