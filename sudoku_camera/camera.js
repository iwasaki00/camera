let activeStream = null;

function waitForVideoReady(videoElement, timeoutMs = 4000) {
  if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const handleReady = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      videoElement.removeEventListener("loadedmetadata", handleReady);
      videoElement.removeEventListener("loadeddata", handleReady);
      videoElement.removeEventListener("canplay", handleReady);
      videoElement.removeEventListener("playing", handleReady);
    };

    videoElement.addEventListener("loadedmetadata", handleReady, { once: true });
    videoElement.addEventListener("loadeddata", handleReady, { once: true });
    videoElement.addEventListener("canplay", handleReady, { once: true });
    videoElement.addEventListener("playing", handleReady, { once: true });
  });
}

function stopTracks(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function isCameraSupported() {
  return Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export async function startCamera(videoElement) {
  if (!isCameraSupported()) {
    throw new Error("\u30ab\u30e1\u30e9\u3092\u5229\u7528\u3067\u304d\u307e\u305b\u3093\u3002iPhone Safari \u3067 HTTPS \u30da\u30fc\u30b8\u3068\u3057\u3066\u958b\u3044\u3066\u304f\u3060\u3055\u3044\u3002");
  }

  stopTracks(activeStream);
  activeStream = null;

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  console.log("[camera] requesting camera", constraints);

  try {
    activeStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    console.warn("[camera] preferred constraints failed", error);
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true
    });
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
      playPromise.catch((error) => {
        console.warn("[camera] play() rejected but continuing with metadata wait", error);
      });
    }
  } catch (error) {
    console.warn("[camera] play() threw synchronously", error);
  }

  waitForVideoReady(videoElement).then((becameReady) => {
    if (!becameReady) {
      console.warn("[camera] video readiness timeout; stream is active but metadata is delayed");
      return;
    }
    console.log("[camera] video metadata became ready");
  });

  console.log("[camera] stream started", activeStream);

  return activeStream;
}

export function captureFrame(videoElement, canvasElement) {
  if (!videoElement.videoWidth || !videoElement.videoHeight) {
    throw new Error("\u30ab\u30e1\u30e9\u6620\u50cf\u306e\u6e96\u5099\u304c\u307e\u3060\u5b8c\u4e86\u3057\u3066\u3044\u307e\u305b\u3093\u3002");
  }

  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;

  const context = canvasElement.getContext("2d");
  context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

  console.log("[camera] frame captured", {
    width: canvasElement.width,
    height: canvasElement.height
  });

  return canvasElement.toDataURL("image/png");
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
