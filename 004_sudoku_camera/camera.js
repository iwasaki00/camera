let activeStream = null;
let activeVideo = null;
let pendingRequest = null;
let cameraGeneration = 0;

function cancelledError() {
  return new DOMException("カメラの起動を中止しました。", "AbortError");
}

export function isCameraReady(videoElement) {
  return hasLiveCameraStream(videoElement) && !videoElement.paused
    && videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0;
}

function waitForFrame(video, request) {
  return new Promise((resolve, reject) => {
    const check = () => { if (isCameraReady(video)) { cleanup(); resolve(); } };
    const fail = () => { cleanup(); reject(new Error("カメラ映像を再生できません。「カメラ開始」で再試行してください。")); };
    const cleanup = () => {
      clearTimeout(timer);
      for (const event of ["loadeddata", "canplay", "playing", "resize"]) video.removeEventListener(event, check);
      video.removeEventListener("error", fail);
      request.cleanup = null;
    };
    const timer = setTimeout(fail, 15000);
    request.cleanup = cleanup;
    for (const event of ["loadeddata", "canplay", "playing", "resize"]) video.addEventListener(event, check);
    video.addEventListener("error", fail);
    check();
  });
}

function stopTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isCameraSupported() {
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
}

export function startCamera(videoElement) {
  if (pendingRequest?.video === videoElement) return pendingRequest.promise;
  stopCamera(activeVideo);
  if (!isCameraSupported()) {
    return Promise.reject(new Error("カメラを利用できません。iPhone SafariでHTTPSページとして開いてください。"));
  }
  const request = { video: videoElement, generation: cameraGeneration, cleanup: null };
  pendingRequest = request;
  const current = () => request.generation === cameraGeneration;
  const aborted = new Promise((_, reject) => { request.cancel = () => reject(cancelledError()); });
  const setup = async () => {
    let stream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
      } catch (error) {
        if (!current()) throw cancelledError();
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      if (!current()) { stopTracks(stream); throw cancelledError(); }
      activeStream = stream;
      activeVideo = videoElement;
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      for (const attribute of ["autoplay", "muted", "playsinline", "webkit-playsinline"]) videoElement.setAttribute(attribute, "");
      videoElement.srcObject = stream;
      // Acquisition alone does not mean Safari can supply a frame.
      let playTimer;
      request.cleanup = () => clearTimeout(playTimer);
      try {
        await Promise.race([
          videoElement.play(),
          aborted,
          new Promise((_, reject) => {
            playTimer = setTimeout(() => reject(new Error("映像再生がタイムアウトしました。")), 15000);
          })
        ]);
      } finally {
        clearTimeout(playTimer);
      }
      if (!current()) throw cancelledError();
      await Promise.race([waitForFrame(videoElement, request), aborted]);
      if (!current()) throw cancelledError();
      return stream;
    } catch (error) {
      stopTracks(stream);
      if (current()) {
        videoElement.pause();
        videoElement.srcObject = null;
        activeStream = null;
        activeVideo = null;
      }
      if (!current()) throw cancelledError();
      throw new Error("カメラの起動・映像再生に失敗しました。カメラの許可を確認し、「カメラ開始」で再試行してください。", { cause: error });
    }
  };
  request.promise = Promise.race([setup(), aborted]).finally(() => {
    request.cleanup?.();
    if (pendingRequest === request) pendingRequest = null;
  });
  return request.promise;
}

export function hasLiveCameraStream(videoElement) {
  const stream = videoElement?.srcObject;
  if (!stream || typeof stream.getVideoTracks !== "function") return false;
  return stream.getVideoTracks().some((track) => track.readyState === "live");
}

export function getCoverSourceRect(videoElement, guideElement) {
  const videoWidth = videoElement.videoWidth;
  const videoHeight = videoElement.videoHeight;
  if (!videoWidth || !videoHeight) {
    throw new Error("カメラ映像の準備中です。少し待ってからもう一度「読み取り」を押してください。");
  }

  const videoRect = videoElement.getBoundingClientRect();
  const guideRect = guideElement.getBoundingClientRect();
  if (!videoRect.width || !videoRect.height || !guideRect.width || !guideRect.height) {
    throw new Error("画面上のガイド位置を取得できませんでした。");
  }

  const coverScale = Math.max(videoRect.width / videoWidth, videoRect.height / videoHeight);
  const renderedWidth = videoWidth * coverScale;
  const renderedHeight = videoHeight * coverScale;
  const cropLeft = (renderedWidth - videoRect.width) / 2;
  const cropTop = (renderedHeight - videoRect.height) / 2;
  const guideX = guideRect.left - videoRect.left;
  const guideY = guideRect.top - videoRect.top;
  const rawX = (guideX + cropLeft) / coverScale;
  const rawY = (guideY + cropTop) / coverScale;
  const rawWidth = guideRect.width / coverScale;
  const rawHeight = guideRect.height / coverScale;
  const sourceX = clamp(rawX, 0, videoWidth);
  const sourceY = clamp(rawY, 0, videoHeight);
  const sourceRight = clamp(rawX + rawWidth, 0, videoWidth);
  const sourceBottom = clamp(rawY + rawHeight, 0, videoHeight);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("ガイドがカメラ映像の外にあります。画面を再読み込みしてください。");
  }

  console.debug("[camera] guide crop geometry", {
    videoVideoWidth: videoWidth,
    videoVideoHeight: videoHeight,
    videoDisplayWidth: videoRect.width,
    videoDisplayHeight: videoRect.height,
    guideViewportRect: { left: guideRect.left, top: guideRect.top, width: guideRect.width, height: guideRect.height },
    guideInVideoDisplay: { x: guideX, y: guideY, width: guideRect.width, height: guideRect.height },
    objectFitCover: {
      scale: coverScale,
      renderedWidth,
      renderedHeight,
      cropLeft,
      cropRight: cropLeft,
      cropTop,
      cropBottom: cropTop
    },
    sourceCrop: { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight }
  });

  return { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight };
}

export function captureGuideArea(videoElement, guideElement, outputCanvas, outputSize = 900) {
  if (!isCameraReady(videoElement)) throw new Error("カメラ映像の準備が完了していません。もう一度カメラを開始してください。");
  const sourceRect = getCoverSourceRect(videoElement, guideElement);
  const size = Math.max(1, Math.round(outputSize));
  outputCanvas.width = size;
  outputCanvas.height = size;
  const context = outputCanvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.drawImage(
    videoElement,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    size,
    size
  );

  console.debug("[camera] guide area captured", {
    outputWidth: outputCanvas.width,
    outputHeight: outputCanvas.height,
    sourceCrop: sourceRect
  });
  return sourceRect;
}

export function stopCamera(videoElement = activeVideo) {
  cameraGeneration += 1;
  pendingRequest?.cleanup?.();
  pendingRequest?.cancel();
  pendingRequest = null;
  const videos = new Set([videoElement, activeVideo]);
  for (const video of videos) {
    if (!video) continue;
    stopTracks(video.srcObject);
    video.pause();
    video.srcObject = null;
  }
  stopTracks(activeStream);
  activeStream = null;
  activeVideo = null;
}
