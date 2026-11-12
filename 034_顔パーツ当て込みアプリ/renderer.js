import { orderedParts, sourceForDisplay } from './parts.js?v=0.7.0';
import { activeCorrection, ColorProcessor } from './composite-color.js?v=0.7.0';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function sourceRect(videoWidth, videoHeight, aspect, source, mirror) {
  let width = videoWidth * 0.6 / source.zoom;
  let height = width / aspect;
  if (height > videoHeight) { height = videoHeight; width = height * aspect; }
  const visualX = clamp(source.x * videoWidth - width / 2, 0, videoWidth - width);
  return { x: mirror ? videoWidth - visualX - width : visualX,
    y: clamp(source.y * videoHeight - height / 2, 0, videoHeight - height), width, height,
    visualX };
}

// One reusable mask/patch pair per part; model and viewport state stay separate.
export class PartRenderer {
  constructor(createCanvas = () => document.createElement('canvas'), colorPass = false) {
    this.patch = createCanvas(); this.mask = createCanvas(); this.maskKey = '';
    this.createCanvas = createCanvas;
    this.colorPass = colorPass;
  }

  prepareMask(width, height, part) {
    const key = [width, height, part.shape, part.feather].join(':');
    if (key === this.maskKey) return;
    this.maskKey = key;
    this.patch.width = this.mask.width = width;
    this.patch.height = this.mask.height = height;
    const ctx = this.mask.getContext('2d');
    const image = ctx.createImageData(width, height);
    const a = width / 2, b = height / 2;
    const feather = Math.min(a, b) * part.feather / 100;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = Math.abs(x + 0.5 - a), dy = Math.abs(y + 0.5 - b);
      const distance = part.shape === 'oval'
        ? (1 - Math.hypot(dx / a, dy / b)) * Math.min(a, b)
        : Math.min(a - dx, b - dy);
      const t = feather > 0 ? clamp(distance / feather, 0, 1) : clamp(distance + 0.5, 0, 1);
      const offset = (y * width + x) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(255 * t * t * (3 - 2 * t));
    }
    ctx.putImageData(image, 0, 0);
  }

  draw(ctx, video, part, source, mirror, guide, appearance = null) {
    const targetWidth = Math.max(2, Math.round(ctx.canvas.width * part.width / 100));
    const targetHeight = Math.max(2, Math.round(ctx.canvas.height * part.height / 100));
    const settings = activeCorrection(appearance?.composite, appearance?.part);
    // Pixel readback may switch a browser canvas from GPU to CPU rasterization.
    // Keep the legacy patch untouched so returning to ORIGINAL retains its exact sampling.
    if(settings && !this.colorPass) {
      this.corrected ||= new PartRenderer(this.createCanvas, true);
      return this.corrected.draw(ctx,video,part,source,mirror,guide,appearance);
    }
    const scale = settings ? Math.min(1, 320 / Math.max(targetWidth, targetHeight)) : 1;
    const width = Math.max(2, Math.round(targetWidth * scale)), height = Math.max(2, Math.round(targetHeight * scale));
    ctx.save();
    ctx.translate(ctx.canvas.width * part.x / 100, ctx.canvas.height * part.y / 100);
    ctx.rotate(part.rotation * Math.PI / 180);
    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const amount = settings ? appearance.composite.blendStrength * settings.blendStrength / 10000 : 0;
      this.prepareMask(width, height, settings ? {...part, feather:clamp(part.feather + settings.edgeSoftness * amount,0,100)} : part);
      const patch = this.patch.getContext('2d',this.colorPass ? {willReadFrequently:true} : undefined);
      patch.clearRect(0, 0, width, height);
      const crop = source.crop || sourceRect(video.videoWidth, video.videoHeight, width / height, source, mirror);
      patch.save();
      if (mirror) { patch.translate(width, 0); patch.scale(-1, 1); }
      if(source.crop) {
        patch.translate(width/2,height/2);patch.scale(width/crop.width,height/crop.height);
        patch.rotate(-crop.angle);patch.drawImage(video,-crop.x,-crop.y);
      } else patch.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      patch.restore();
      if(settings) {
        this.color ||= new ColorProcessor(this.createCanvas);
        this.color.apply(this.patch,part,settings,appearance.composite,appearance.background,appearance.time);
      }
      patch.globalCompositeOperation = 'destination-in';
      patch.drawImage(this.mask, 0, 0);
      patch.globalCompositeOperation = 'source-over';
      if(settings)ctx.drawImage(this.patch,-targetWidth/2,-targetHeight/2,targetWidth,targetHeight);
      else ctx.drawImage(this.patch, -width / 2, -height / 2);
    }
    if (guide) {
      ctx.strokeStyle = '#24e3cd'; ctx.lineWidth = Math.max(2, ctx.canvas.width / 500);
      ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
      ctx.beginPath();
      if (part.shape === 'oval') ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
      else ctx.rect(-width / 2, -height / 2, width, height);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class CompositeRenderer {
  constructor(createRenderer = () => new PartRenderer()) { this.renderers = new Map(); this.createRenderer = createRenderer; }
  draw(ctx, video, parts, mirror, trackedCrops = null, appearance = null) {
    let correctedVideo=video;
    if(video?.readyState>=2 && appearance && parts.some(p=>p.enabled&&(!trackedCrops||trackedCrops[p.id])&&activeCorrection(appearance.composite,p.appearance))) {
      // One CPU-readable camera snapshot per composite, rather than four GPU→CPU video copies.
      this.frameCanvas ||= document.createElement('canvas');
      if(this.frameCanvas.width!==video.videoWidth||this.frameCanvas.height!==video.videoHeight){this.frameCanvas.width=video.videoWidth;this.frameCanvas.height=video.videoHeight;}
      const frameContext=this.frameCanvas.getContext('2d',{willReadFrequently:true});
      frameContext.globalCompositeOperation='copy';frameContext.drawImage(video,0,0);
      this.frameCanvas.videoWidth=video.videoWidth;this.frameCanvas.videoHeight=video.videoHeight;this.frameCanvas.readyState=video.readyState;
      correctedVideo=this.frameCanvas;
    } else if(!video&&this.frameCanvas){this.frameCanvas.width=this.frameCanvas.height=0;}
    for (const [id, renderer] of this.renderers) if (!parts.some(p => p.id === id)) {
      if (renderer.patch) renderer.patch.width = renderer.patch.height = renderer.mask.width = renderer.mask.height = 0;
      this.renderers.delete(id);
    }
    for (const part of orderedParts(parts)) {
      if(trackedCrops && !trackedCrops[part.id])continue;
      if (!this.renderers.has(part.id)) this.renderers.set(part.id, this.createRenderer());
      this.renderers.get(part.id).draw(ctx, activeCorrection(appearance?.composite,part.appearance) ? correctedVideo : video,
        { ...part.targetRect, rotation: part.rotation, shape: part.shape, feather: part.feather },
        { ...sourceForDisplay(part, mirror), ...(trackedCrops ? {crop:trackedCrops[part.id]} : {}) }, mirror, false,
        appearance ? { ...appearance, part:part.appearance } : null);
    }
  }
}
