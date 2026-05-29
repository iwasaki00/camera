let activeStream = null;

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
    throw new Error("Camera is not available. Open this page in iPhone Safari over HTTPS.");
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

  videoElement.srcObject = activeStream;
  await videoElement.play();
  console.log("[camera] stream started", activeStream);

  return activeStream;
}

export function captureFrame(videoElement, canvasElement) {
  if (!videoElement.videoWidth || !videoElement.videoHeight) {
    throw new Error("Camera video is not ready yet.");
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
