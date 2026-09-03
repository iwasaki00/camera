import { FACE_MODEL, getFileset, getVision } from "./vision.js";

const clamp = (value) => Math.max(0, Math.min(1, value));

export class FaceMode {
  constructor() { this.landmarker = null; }

  async init() {
    const [{ FaceLandmarker }, fileset] = await Promise.all([getVision(), getFileset()]);
    const options = {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    };
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    } catch (_) {
      options.baseOptions.delegate = "CPU";
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    }
  }

  detect(video, now) {
    const result = this.landmarker?.detectForVideo(video, now);
    const landmarks = result?.faceLandmarks?.[0];
    if (!landmarks) return { detected: false, landmarks: null, scores: {} };

    const categories = result.faceBlendshapes?.[0]?.categories || [];
    const blend = Object.fromEntries(categories.map((item) => [item.categoryName, item.score]));
    const faceWidth = Math.max(0.001, Math.abs(landmarks[454].x - landmarks[234].x));
    const lipGap = Math.abs(landmarks[14].y - landmarks[13].y) / faceWidth;
    const eyeDx = landmarks[263].x - landmarks[33].x;
    const eyeDy = landmarks[263].y - landmarks[33].y;
    const roll = Math.atan2(eyeDy, eyeDx);

    return {
      detected: true,
      landmarks,
      scores: {
        mouthOpen: clamp(Math.max((lipGap - 0.025) * 7, blend.jawOpen || 0)),
        winkLeft: clamp((blend.eyeBlinkLeft || 0) - (blend.eyeBlinkRight || 0) * 0.55),
        winkRight: clamp((blend.eyeBlinkRight || 0) - (blend.eyeBlinkLeft || 0) * 0.55),
        smile: clamp(((blend.mouthSmileLeft || 0) + (blend.mouthSmileRight || 0)) / 2),
        tiltLeft: clamp(roll / 0.3),
        tiltRight: clamp(-roll / 0.3),
      },
    };
  }

  draw(ctx, landmarks) {
    if (!landmarks) return;
    // CSSのobject-fit: coverによる切り抜き量も含めて映像上へ重ねる。
    const point = (index) => {
      const map = ctx.videoMap || { width: ctx.canvas.width, height: ctx.canvas.height, x: 0, y: 0 };
      return { x: map.x + map.width * (1 - landmarks[index].x), y: map.y + map.height * landmarks[index].y };
    };
    const paths = [
      [33, 160, 158, 133, 153, 144, 33], [362, 385, 387, 263, 373, 380, 362],
      [61, 13, 291, 14, 61], [10, 338, 297, 332, 284, 454, 152, 234, 54, 103, 67, 10],
    ];
    ctx.strokeStyle = "rgba(216,255,69,.9)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(216,255,69,.65)";
    ctx.shadowBlur = 6;
    paths.forEach((path) => {
      ctx.beginPath();
      path.forEach((index, i) => { const p = point(index); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
  }

  close() { this.landmarker?.close(); this.landmarker = null; }
}

export const FACE_THRESHOLDS = {
  mouthOpen: 0.48, winkLeft: 0.48, winkRight: 0.48,
  smile: 0.52, tiltLeft: 0.58, tiltRight: 0.58,
};
