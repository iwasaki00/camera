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
    this.state = "idle";
    this.onError = null;
    this.onComplete = null;
  }

  get supported() { return Boolean(window.MediaRecorder && this.canvas.captureStream && this.mimeType); }

  start(audioStream, fps = 30) {
    if (this.state !== "idle") throw new Error("RECORDING_BUSY");
    if (!this.supported) throw new Error("RECORDING_UNSUPPORTED");
    this.state = "starting";
    this.chunks = [];
    this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    // Errors may arrive before the user presses Stop.
    this.result.catch(() => {});
    try {
      this.stream = this.canvas.captureStream(fps);
      // Own cloned audio tracks, so cleanup never depends on the camera owner.
      for (const track of audioStream?.getAudioTracks() || []) this.stream.addTrack(track.clone());
      this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
      this.recorder.ondataavailable = (event) => { if (event.data?.size) this.chunks.push(event.data); };
      this.recorder.onerror = () => {
        const error = new Error("RECORDING_FAILED");
        this.finish(error);
        this.onError?.(error);
      };
      this.recorder.onstop = () => this.finish();
      this.recorder.start(1000);
      this.state = "recording";
    } catch (error) { this.finish(error); throw error; }
  }

  finish(error) {
    if (this.state === "idle") return;
    clearTimeout(this.stopTimer);
    const wasRecording = this.state === "recording";
    const recorder = this.recorder;
    if (recorder) {
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
      try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* Already stopped. */ }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    const blob = error ? null : new Blob(this.chunks, { type: this.mimeType });
    this.stream = null; this.recorder = null; this.chunks = [];
    this.state = "idle";
    if (error) this.reject(error); else { this.resolve(blob); if (wasRecording) this.onComplete?.(blob); }
  }

  stop() {
    if (this.state === "stopping" || this.state === "idle") return this.result || Promise.reject(new Error("NOT_RECORDING"));
    this.state = "stopping";
    // Safari can suspend delivery of stop events while hidden. Preserve chunks already received.
    this.stopTimer = setTimeout(() => this.finish(), 4000);
    try {
      this.recorder.stop();
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch (error) { this.finish(error); }
    return this.result;
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
    this.state = "idle";
    this.generation = 0;
    this.onError = null;
    this.frameCanvas = document.createElement("canvas");
    this.frameContext = this.frameCanvas.getContext("2d", { alpha: false });
  }

  get supported() {
    return Boolean(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && window.createImageBitmap && supportedMimeType());
  }

  async captureFrame() {
    if (this.state !== "recording" || this.capturing || this.frames.length >= this.maxFrames) return;
    const generation = this.generation;
    this.capturing = true;
    try {
      const source = this.sourceCanvas;
      const width = Math.min(640, source.width);
      const height = Math.max(2, Math.round(width * source.height / source.width));
      if (!width || !Number.isFinite(height)) throw new Error("TIMELAPSE_CAPTURE_FAILED");
      if (this.frameCanvas.width !== width || this.frameCanvas.height !== height) {
        this.frameCanvas.width = width; this.frameCanvas.height = height;
      }
      this.frameContext.drawImage(source, 0, 0, width, height);
      const blob = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("TIMELAPSE_CAPTURE_FAILED")), 4000);
        const abort = (error) => { clearTimeout(timeout); reject(error); };
        this.abortCapture = abort;
        try {
          this.frameCanvas.toBlob((value) => {
            clearTimeout(timeout);
            if (this.abortCapture === abort) this.abortCapture = null;
            resolve(value);
          }, "image/jpeg", .84);
        } catch (error) {
          if (this.abortCapture === abort) this.abortCapture = null;
          abort(error);
        }
      });
      if (!blob) throw new Error("TIMELAPSE_CAPTURE_FAILED");
      if (generation === this.generation) this.frames.push(blob);
    } catch (error) {
      if (generation === this.generation) {
        this.cancel();
        this.onError?.(error);
      }
      throw error;
    } finally { if (generation === this.generation) this.capturing = false; }
  }

  start(factor = 4) {
    if (this.state !== "idle") throw new Error("RECORDING_BUSY");
    if (!this.supported) throw new Error("TIMELAPSE_UNSUPPORTED");
    ++this.generation;
    this.state = "recording";
    this.factor = [2, 4, 8, 16].includes(factor) ? factor : 4;
    this.frames = [];
    this.stopPromise = null;
    const capture = () => { if (this.capturing) return; this.capturePromise = this.captureFrame(); this.capturePromise.catch(() => {}); };
    queueMicrotask(capture);
    this.timer = setInterval(capture, Math.max(80, 1000 * this.factor / 30));
  }

  cancel() {
    ++this.generation;
    this.abortCapture?.(new Error("TIMELAPSE_INTERRUPTED"));
    this.abortCapture = null;
    clearInterval(this.timer); this.timer = null;
    this.abortEncoding?.(new Error("TIMELAPSE_INTERRUPTED"));
    this.abortEncoding = null;
    const recorder = this.encodingRecorder;
    if (recorder) {
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
      try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* Already stopped. */ }
    }
    this.encodingStream?.getTracks().forEach((track) => track.stop());
    this.encodingStream = null; this.encodingRecorder = null;
    this.frames = []; this.capturing = false; this.state = "idle";
  }

  stop() {
    if (this.state === "stopping") return this.stopPromise;
    if (this.state !== "recording") return Promise.reject(new Error("NOT_RECORDING"));
    this.state = "stopping";
    clearInterval(this.timer); this.timer = null;
    this.stopPromise = this.encode(this.generation);
    return this.stopPromise;
  }

  async encode(generation) {
    let stream, mediaRecorder, stopTimeout;
    let active = true;
    const check = () => { if (generation !== this.generation) throw new Error("TIMELAPSE_INTERRUPTED"); };
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    failure.catch(() => {});
    this.abortEncoding = rejectFailure;
    try {
      await Promise.race([this.capturePromise, failure]);
      check();
      if (this.frames.length < 2) throw new Error("TIMELAPSE_TOO_SHORT");
      const frames = this.frames.slice();
      const output = document.createElement("canvas");
      output.width = this.frameCanvas.width; output.height = this.frameCanvas.height;
      const ctx = output.getContext("2d", { alpha: false });
      stream = output.captureStream(30);
      this.encodingStream = stream;
      const mimeType = supportedMimeType();
      const chunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.encodingRecorder = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      const result = new Promise((resolve) => {
        mediaRecorder.onerror = () => rejectFailure(new Error("TIMELAPSE_ENCODING_FAILED"));
        mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      mediaRecorder.start(500);
      for (const frame of frames) {
        check();
        // A late bitmap must also be closed when cancellation wins the race.
        const decode = createImageBitmap(frame).then((bitmap) => {
          if (!active || generation !== this.generation) { bitmap.close?.(); throw new Error("TIMELAPSE_INTERRUPTED"); }
          return bitmap;
        });
        const bitmap = await Promise.race([decode, failure]);
        try { ctx.drawImage(bitmap, 0, 0, output.width, output.height); }
        finally { bitmap.close?.(); }
        await Promise.race([new Promise((resolve) => setTimeout(resolve, 34)), failure]);
      }
      check();
      mediaRecorder.stop();
      stopTimeout = setTimeout(() => rejectFailure(new Error("TIMELAPSE_ENCODING_FAILED")), 4000);
      return await Promise.race([result, failure]);
    } finally {
      active = false;
      clearTimeout(stopTimeout);
      if (mediaRecorder) {
        mediaRecorder.ondataavailable = mediaRecorder.onerror = mediaRecorder.onstop = null;
        try { if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch { /* Already stopped. */ }
      }
      stream?.getTracks().forEach((track) => track.stop());
      if (generation === this.generation) {
        this.frames = []; this.capturing = false; this.state = "idle";
        this.encodingStream = null; this.encodingRecorder = null; this.abortEncoding = null;
      }
    }
  }

  get outputSeconds() { return this.frames.length / 30; }
}
