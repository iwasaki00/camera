export const BOARD_INPUT_SIZE = 900;

export function calculateCenteredSquareCrop(width, height) {
  if (!(width > 0) || !(height > 0)) {
    throw new Error("画像サイズを取得できませんでした。");
  }

  const size = Math.min(width, height);
  return {
    x: (width - size) / 2,
    y: (height - size) / 2,
    size
  };
}

export function isSupportedImageFile(file) {
  const supportedMimeTypes = ["image/png", "image/jpeg", "image/webp"];
  if (supportedMimeTypes.includes(file.type)) return true;
  if (file.type) return false;
  return /\.(png|jpe?g|webp)$/i.test(file.name || "");
}

export async function loadImageBlobIntoCanvas(blob, outputCanvas, size = BOARD_INPUT_SIZE) {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("画像を読み込めませんでした。")), { once: true });
      image.src = objectUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const crop = calculateCenteredSquareCrop(width, height);
    outputCanvas.width = size;
    outputCanvas.height = size;

    const context = outputCanvas.getContext("2d");
    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      size,
      size
    );
    context.restore();

    return { width, height, crop, outputSize: size };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
