const cancelled = () => new DOMException("カメラ起動を中断しました。", "AbortError");
const release = (stream) => stream?.getTracks().forEach((track) => track.stop());

export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.generation = 0;
    this.startPromise = null;
    this.controller = null;
    this.acquisition = Promise.resolve();
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.stream) return Promise.resolve();
    const generation = ++this.generation;
    const controller = this.controller = new AbortController();
    const { signal } = controller;
    const check = () => {
      if (signal.aborted || generation !== this.generation) throw cancelled();
    };
    const work = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザはカメラAPIに対応していません。");
      }
      // 未完了の権限要求を重ねず、古い取得結果は採用前に解放する。
      const acquire = this.acquisition.catch(() => {}).then(async () => {
        check();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 720 },
            height: { ideal: 1280 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        if (signal.aborted || generation !== this.generation) {
          release(stream);
          throw cancelled();
        }
        return stream;
      });
      this.acquisition = acquire.then(() => {}, () => {});
      const stream = await acquire;
      try { check(); } catch (error) { release(stream); throw error; }
      this.stream = stream;
      this.video.srcObject = stream;
      try { await this.video.play(); }
      catch (cause) {
        throw new Error("カメラ映像を再生できませんでした。再試行してください。", { cause });
      }
      check();
      await new Promise((resolve, reject) => {
        let timer;
        const finish = (error) => {
          clearTimeout(timer);
          this.video.removeEventListener("loadeddata", ready);
          this.video.removeEventListener("error", failed);
          signal.removeEventListener("abort", aborted);
          error ? reject(error) : resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error("カメラ映像を読み込めませんでした。"));
        const aborted = () => finish(cancelled());
        if (signal.aborted) return aborted();
        if (this.video.error) return failed();
        if (this.video.readyState >= 2) return ready();
        this.video.addEventListener("loadeddata", ready);
        this.video.addEventListener("error", failed);
        signal.addEventListener("abort", aborted, { once: true });
        timer = setTimeout(() => finish(new Error("カメラ映像の読み込みがタイムアウトしました。再試行してください。")), 15000);
      });
      check();
    };
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
    });
    const request = Promise.race([work(), interrupted]).catch((error) => {
      if (generation === this.generation) this.stop();
      throw error;
    }).finally(() => {
      signal.removeEventListener("abort", abort);
      if (this.startPromise === request) this.startPromise = null;
    });
    this.startPromise = request;
    return request;
  }

  stop() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.startPromise = null;
    release(this.stream);
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }
}
