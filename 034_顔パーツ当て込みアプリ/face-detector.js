// Lazy local assets; this module is loaded only after the user enables tracking with the camera on.
const vendor = new URL('./vendor/mediapipe-0.10.21/', import.meta.url);
export async function createFaceDetector() {
  const { FaceLandmarker, FilesetResolver } = await import(new URL('vision_bundle.mjs', vendor).href);
  const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', vendor).href);
  const detector = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('./models/face_landmarker.task', import.meta.url).href, delegate: 'CPU' },
    runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .55,
    minFacePresenceConfidence: .55, minTrackingConfidence: .55,
    outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false
  });
  return {
    detect: (image,time) => detector.detectForVideo(image,time).faceLandmarks[0] || null,
    close: () => detector.close()
  };
}
