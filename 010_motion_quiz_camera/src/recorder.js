import { selectMimeType } from "./utils.js";

function createRecorder(stream, mimeType) {
  const options = mimeType ? { mimeType, videoBitsPerSecond:2_000_000 } : { videoBitsPerSecond:2_000_000 };
  return new MediaRecorder(stream, options);
}

function startOne(stream) {
  if (!stream || !window.MediaRecorder) return null;
  const mimeType=selectMimeType();
  const recorder=createRecorder(stream,mimeType);
  const chunks=[];
  recorder.ondataavailable=event => { if(event.data.size) chunks.push(event.data); };
  recorder.start(250);
  return { recorder, chunks, mimeType:recorder.mimeType || mimeType };
}

function stopOne(entry) {
  if (!entry) return Promise.resolve(null);
  return new Promise(resolve => {
    entry.recorder.onstop=()=>resolve(new Blob(entry.chunks,{type:entry.mimeType || "video/mp4"}));
    if(entry.recorder.state==="inactive") resolve(new Blob(entry.chunks,{type:entry.mimeType || "video/mp4"}));
    else entry.recorder.stop();
  });
}

export class DualRecorder {
  start(cameraStream, skeletonCanvas, fps=20) {
    this.original=startOne(cameraStream);
    let skeletonStream=null;
    try { skeletonStream=skeletonCanvas.captureStream?.(fps) || null; } catch {}
    try { this.skeleton=startOne(skeletonStream); } catch { this.skeleton=null; }
  }
  async stop() {
    const [originalBlob,skeletonBlob]=await Promise.all([stopOne(this.original),stopOne(this.skeleton)]);
    this.original=null; this.skeleton=null;
    return { originalBlob,skeletonBlob };
  }
}
