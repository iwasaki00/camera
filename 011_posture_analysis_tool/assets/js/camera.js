export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facing = "environment";
    this.generation = 0;
    this.pending = null;
    this.abort = null;
  }

  start(facing = this.facing) {
    if (this.pending && facing === this.facing) return this.pending;
    this.stop();
    this.facing = facing;
    const generation = this.generation;
    const controller = new AbortController();
    this.abort = controller;
    const check = () => {
      if (generation !== this.generation || controller.signal.aborted) {
        throw new DOMException("カメラ起動を中断しました", "AbortError");
      }
    };
    const task = (async () => {
      let stream;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("このブラウザはカメラ撮影に対応していません。");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1920 }, frameRate: { ideal: 24, max: 30 } },
        });
        check();
        this.stream = stream;
        this.video.srcObject = stream;
        await new Promise((resolve, reject) => {
          const finish = (error) => { cleanup(); error ? reject(error) : resolve(); };
          let played = false;
          const loaded = () => { if (played && this.video.readyState >= 2) finish(); };
          const failed = () => finish(new Error("カメラ映像を読み込めませんでした"));
          const aborted = () => finish(new DOMException("カメラ起動を中断しました", "AbortError"));
          const timer = setTimeout(failed, 15000);
          const cleanup = () => {
            clearTimeout(timer);
            this.video.removeEventListener("loadeddata", loaded);
            this.video.removeEventListener("error", failed);
            controller.signal.removeEventListener("abort", aborted);
          };
          this.video.addEventListener("loadeddata", loaded);
          this.video.addEventListener("error", failed);
          controller.signal.addEventListener("abort", aborted, { once: true });
          Promise.resolve().then(() => { check(); return this.video.play(); }).then(() => { played = true; loaded(); }, finish);
        });
        check();
        return stream;
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        if (generation === this.generation) this.stop();
        throw error;
      }
    })();
    this.pending = task;
    const clear = () => { if (this.pending === task) this.pending = null; };
    task.then(clear, clear);
    return task;
  }

  flip() { return this.start(this.facing === "environment" ? "user" : "environment"); }

  stop() {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.pending = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }
}
