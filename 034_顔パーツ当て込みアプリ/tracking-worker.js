// Classic worker: MediaPipe's WASM loader uses importScripts. ES-module workers cannot run it.
let detector;
self.onmessage = async event => {
  const {id,type,image,time}=event.data;
  try {
    if(type==='init') {
      const {createFaceDetector}=await import('./face-detector.js?v=0.7.1');
      detector=await createFaceDetector();self.postMessage({id,ready:true});
    } else if(type==='detect') {
      const start=performance.now(),landmarks=detector.detect(image,time);
      self.postMessage({id,landmarks,ms:performance.now()-start});
    }
  } catch(error) {self.postMessage({id,error:error.message||String(error)});}
  finally {image?.close();}
};
