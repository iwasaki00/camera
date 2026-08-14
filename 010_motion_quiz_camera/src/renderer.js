import { CONNECTIONS, DIFFICULTIES } from "./config.js";

function visible(point) { return point && (point.visibility ?? 1) >= .42; }

export class PoseRenderer {
  constructor(previewCanvas) {
    this.previewCanvas = previewCanvas;
    this.recordCanvas = document.createElement("canvas");
    this.mode = "overlay";
    this.difficulty = "normal";
    this.width = 640;
    this.height = 480;
  }

  resize(video) {
    const width = Math.min(video.videoWidth || 640, 960);
    const height = Math.round(width * (video.videoHeight || 480) / (video.videoWidth || 640));
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    [this.previewCanvas, this.recordCanvas].forEach(canvas => { canvas.width=width; canvas.height=height; });
  }

  render(video, landmarks = []) {
    this.resize(video);
    const pctx = this.previewCanvas.getContext("2d");
    pctx.clearRect(0,0,this.width,this.height);
    if (this.mode === "skeleton") { pctx.fillStyle="#020504"; pctx.fillRect(0,0,this.width,this.height); }
    this.drawSkeleton(pctx, landmarks, this.difficulty);

    const rctx = this.recordCanvas.getContext("2d");
    rctx.fillStyle="#020504"; rctx.fillRect(0,0,this.width,this.height);
    this.drawSkeleton(rctx, landmarks, this.difficulty);
  }

  renderOriginalFrame(video) {
    const canvas = document.createElement("canvas");
    canvas.width=320; canvas.height=Math.round(320*this.height/this.width);
    const ctx=canvas.getContext("2d");
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    return canvas;
  }

  drawSkeleton(ctx, landmarks, difficulty = "normal", width = this.width, height = this.height) {
    const style = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    ctx.save();
    ctx.lineWidth=Math.max(3,width/145); ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.strokeStyle="#53f0b2"; ctx.fillStyle="#eafff6"; ctx.shadowColor="rgba(83,240,178,.45)"; ctx.shadowBlur=10;
    if (style.lines) {
      CONNECTIONS.forEach(([a,b]) => {
        if (!visible(landmarks[a]) || !visible(landmarks[b])) return;
        ctx.beginPath(); ctx.moveTo(landmarks[a].x*width,landmarks[a].y*height); ctx.lineTo(landmarks[b].x*width,landmarks[b].y*height); ctx.stroke();
      });
    }
    if (style.points) {
      const allowed = style.joints ? new Set(style.joints) : null;
      landmarks.forEach((point,index) => {
        if (!visible(point) || (allowed && !allowed.has(index))) return;
        ctx.beginPath(); ctx.arc(point.x*width,point.y*height,Math.max(3,width/115),0,Math.PI*2); ctx.fill();
      });
    }
    ctx.restore();
  }
}
