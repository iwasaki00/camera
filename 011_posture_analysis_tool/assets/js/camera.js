export class CameraController{
  constructor(video){this.video=video;this.stream=null;this.facing="environment"}
  async start(facing=this.facing){this.stop();this.facing=facing;if(!navigator.mediaDevices?.getUserMedia)throw new Error("このブラウザはカメラ撮影に対応していません。");this.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:1920},frameRate:{ideal:24,max:30}}});this.video.srcObject=this.stream;await this.video.play();await new Promise(r=>this.video.readyState>=2?r():this.video.addEventListener("loadeddata",r,{once:true}));return this.stream}
  flip(){return this.start(this.facing==="environment"?"user":"environment")}
  stop(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null}
}
