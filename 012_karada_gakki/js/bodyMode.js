import { POSE_MODEL, getFileset, getVision } from "./vision.js";

const clamp = (value) => Math.max(0, Math.min(1, value));
const visible = (point) => (point?.visibility ?? 1) > 0.45;

export class BodyMode {
  constructor() { this.landmarker = null; }

  async init() {
    const [{ PoseLandmarker }, fileset] = await Promise.all([getVision(), getFileset()]);
    const options = {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.48,
      minPosePresenceConfidence: 0.48,
      minTrackingConfidence: 0.48,
    };
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options);
    } catch (_) {
      options.baseOptions.delegate = "CPU";
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options);
    }
  }

  detect(video, now) {
    const result = this.landmarker?.detectForVideo(video, now);
    const p = result?.landmarks?.[0];
    if (!p) return { detected: false, landmarks: null, scores: {} };

    const torso = Math.max(0.08, Math.abs(((p[23].y + p[24].y) / 2) - ((p[11].y + p[12].y) / 2)));
    const handScore = (wrist, shoulder) => visible(p[wrist]) && visible(p[shoulder])
      ? clamp((p[shoulder].y - p[wrist].y) / torso * 0.85 + 0.3) : 0;
    let leftHand = handScore(15, 11);
    let rightHand = handScore(16, 12);
    const bothHands = Math.min(leftHand, rightHand);
    // 両手成立中は両手アクションだけを優先し、3音同時発音を避ける。
    if (bothHands >= 0.55) { leftHand = 0; rightHand = 0; }

    const legScore = (knee, ankle, otherKnee, otherAnkle) => {
      if (![knee, ankle, otherKnee, otherAnkle].every((i) => visible(p[i]))) return 0;
      const lift = (p[otherKnee].y - p[knee].y) + (p[otherAnkle].y - p[ankle].y) * 0.45;
      return clamp(lift / torso * 0.8);
    };

    return {
      detected: true,
      landmarks: p,
      scores: {
        leftHand, rightHand, bothHands,
        leftLeg: legScore(25, 27, 26, 28),
        rightLeg: legScore(26, 28, 25, 27),
      },
    };
  }

  draw(ctx, landmarks) {
    if (!landmarks) return;
    const links = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
    const point = (index) => {
      const map = ctx.videoMap || { width: ctx.canvas.width, height: ctx.canvas.height, x: 0, y: 0 };
      return { x: map.x + map.width * (1 - landmarks[index].x), y: map.y + map.height * landmarks[index].y };
    };
    ctx.strokeStyle = "rgba(216,255,69,.88)";
    ctx.fillStyle = "#d8ff45";
    ctx.lineWidth = 3;
    links.forEach(([a, b]) => {
      if (!visible(landmarks[a]) || !visible(landmarks[b])) return;
      const one = point(a), two = point(b);
      ctx.beginPath(); ctx.moveTo(one.x, one.y); ctx.lineTo(two.x, two.y); ctx.stroke();
    });
    [11,12,13,14,15,16,23,24,25,26,27,28].forEach((i) => {
      if (!visible(landmarks[i])) return;
      const p = point(i); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    });
  }

  close() { this.landmarker?.close(); this.landmarker = null; }
}

export const BODY_THRESHOLDS = {
  leftHand: 0.55, rightHand: 0.55, bothHands: 0.55, leftLeg: 0.36, rightLeg: 0.36,
};
