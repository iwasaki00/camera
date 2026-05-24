let stream = null;

function stopCurrentStream() {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
  stream = null;
}

export function isCameraSupported() {
  return Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export async function initializeCamera(videoElement) {
  if (!isCameraSupported()) {
    throw new Error(
      "このブラウザではカメラ機能を利用できません。iPhone の Safari で HTTPS 配信されているページを開いてください。"
    );
  }

  stopCurrentStream();

  const preferredConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
  } catch (error) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true
      });
    } catch (fallbackError) {
      const originalMessage = error instanceof Error ? error.message : "";
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "";
      throw new Error(
        "カメラを起動できませんでした。Safari で HTTPS のページを開き、カメラ権限を許可しているか確認してください。" +
          (originalMessage || fallbackMessage ? ` (${originalMessage || fallbackMessage})` : "")
      );
    }
  }

  videoElement.srcObject = stream;

  try {
    await videoElement.play();
  } catch {
    stopCurrentStream();
    throw new Error("カメラ映像の再生を開始できませんでした。");
  }

  return stream;
}

export function captureBoardImage(videoElement, canvasElement) {
  if (!stream || !videoElement.videoWidth || !videoElement.videoHeight) {
    throw new Error("カメラ映像の準備ができていません。カメラ起動後にもう一度試してください。");
  }

  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;

  const context = canvasElement.getContext("2d");
  context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

  return canvasElement.toDataURL("image/png");
}

export function shutdownCamera(videoElement) {
  if (videoElement) {
    videoElement.pause();
    videoElement.srcObject = null;
  }

  stopCurrentStream();
}
