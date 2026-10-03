let activeStream = null;

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

export async function startCamera(videoElement) {
  if (!isCameraSupported()) {
    throw new Error("カメラを利用できません。iPhone SafariでHTTPSページとして開いてください。");
  }

  stopTracks(activeStream);
  activeStream = null;
  const preferredConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  console.log("[camera] requesting camera", preferredConstraints);
  try {
    activeStream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
  } catch (preferredError) {
    console.warn("[camera] preferred constraints failed; retrying with default video", preferredError);
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }

  videoElement.autoplay = true;
  videoElement.muted = true;
  videoElement.playsInline = true;
  videoElement.setAttribute("autoplay", "");
  videoElement.setAttribute("muted", "");
  videoElement.setAttribute("playsinline", "");
  videoElement.setAttribute("webkit-playsinline", "");
  videoElement.srcObject = activeStream;

  try {
    const playPromise = videoElement.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => console.warn("[camera] play() rejected; stream remains available", error));
    }
  } catch (error) {
    console.warn("[camera] play() threw; stream remains available", error);
  }

  console.log("[camera] stream attached; capture UI may be enabled", activeStream);
  return activeStream;
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

  console.log("[camera] guide crop geometry", {
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

  console.log("[camera] guide area captured", {
    outputWidth: outputCanvas.width,
    outputHeight: outputCanvas.height,
    sourceCrop: sourceRect
  });
  return sourceRect;
}

export function stopCamera(videoElement) {
  if (videoElement) {
    videoElement.pause();
    videoElement.srcObject = null;
  }
  stopTracks(activeStream);
  activeStream = null;
  console.log("[camera] stream stopped");
}
