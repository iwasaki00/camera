import { CameraController } from "./camera.js";
import { PoseDetector } from "./pose.js";
import { PoseRenderer } from "./renderer.js";
import { DualRecorder } from "./recorder.js";
import { MotionStore } from "./storage.js";
import { MotionPlayer } from "./player.js";
import { DIFFICULTIES, TARGET_FPS } from "./config.js";
import { $, $$, canvasToBlob, formatDate, formatTime, friendlyError, makeId, sleep } from "./utils.js";

export class MotionQuizApp {
  constructor() {
    this.video=$("#cameraVideo");
    this.stage=$("#stage");
    this.camera=new CameraController(this.video);
    this.detector=new PoseDetector();
    this.renderer=new PoseRenderer($("#poseCanvas"));
    this.recorder=new DualRecorder();
    this.store=new MotionStore();
    this.reviewPlayer=new MotionPlayer($("#reviewSkeleton"));
    this.detailPlayer=new MotionPlayer($("#detailCanvas"));
    this.latestLandmarks=[];
    this.motionData=[];
    this.recording=false;
    this.cameraReady=false;
    this.poseReady=false;
    this.lastDetectionAt=0;
    this.objectUrls=[];
  }

  async init() {
    this.bindEvents();
    await this.store.open();
    await this.refreshLibrary();
    if(!navigator.mediaDevices?.getUserMedia) this.message("このブラウザはカメラ撮影に対応していません。",true);
  }

  bindEvents() {
    $$('[data-view]').forEach(button=>button.addEventListener("click",()=>this.showView(button.dataset.view)));
    $("#startCameraButton").addEventListener("click",()=>this.startCamera());
    $("#flipCameraButton").addEventListener("click",()=>this.flipCamera());
    $("#recordButton").addEventListener("click",()=>this.beginCapture());
    $("#stopButton").addEventListener("click",()=>this.finishCapture());
    $("#difficultySelect").addEventListener("change",event=>this.renderer.difficulty=event.target.value);
    $$('[data-preview]').forEach(button=>button.addEventListener("click",()=>this.setPreview(button.dataset.preview)));
    $$('[data-review-mode]').forEach(button=>button.addEventListener("click",()=>this.setReviewMode(button.dataset.reviewMode)));
    $("#reviewForm").addEventListener("submit",event=>{event.preventDefault();this.savePending();});
    $("#retakeButton").addEventListener("click",()=>this.closeReview());
    $("#closeDetailButton").addEventListener("click",()=>this.closeDetail());
    $$('[data-detail-mode]').forEach(button=>button.addEventListener("click",()=>this.setDetailMode(button.dataset.detailMode)));
    $("#bigPlayButton").addEventListener("click",()=>this.toggleDetailPlayback());
    $("#detailVideo").addEventListener("play",()=>$("#bigPlayButton").hidden=true);
    $("#detailVideo").addEventListener("pause",()=>$("#bigPlayButton").hidden=false);
    $("#revealButton").addEventListener("click",()=>this.revealAnswer());
    $("#speedSelect").addEventListener("change",event=>this.setPlaybackSpeed(Number(event.target.value)));
    $("#loopToggle").addEventListener("change",event=>this.setLoop(event.target.checked));
    $("#deleteButton").addEventListener("click",()=>this.deleteCurrent());
    $("#reviewDialog").addEventListener("close",()=>this.reviewPlayer.pause());
    $("#detailDialog").addEventListener("close",()=>this.stopDetailMedia());
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&!this.recording)this.detailPlayer.pause();});
  }

  async startCamera(facingMode) {
    try {
      $("#startCameraButton").disabled=true;
      $("#cameraStatus").textContent="STARTING";
      await this.camera.start(facingMode);
      this.cameraReady=true;
      this.stage.style.aspectRatio=`${this.video.videoWidth} / ${this.video.videoHeight}`;
      this.applyMirroring();
      $("#emptyCamera").hidden=true;
      $(".live-pill").classList.add("is-on");
      $("#cameraStatus").textContent=this.camera.facingMode==="user"?"FRONT CAMERA":"BACK CAMERA";
      $("#flipCameraButton").disabled=false;
      $("#recordButton").disabled=false;
      $("#readyLabel").textContent="録画できます";
      $("#detectedLabel").textContent="AIを準備中…";
      this.loop();
      if(!this.poseReady) await this.startPose();
    } catch(error) {
      $("#startCameraButton").disabled=false;
      $("#cameraStatus").textContent="CAMERA ERROR";
      this.message(friendlyError(error),true);
    }
  }

  async startPose() {
    $("#poseStatus").textContent="AI 読み込み中";
    try {
      await this.detector.init();
      this.poseReady=true;
      $("#poseStatus").textContent="AI READY";
      $("#poseStatus").classList.add("is-ready");
      $("#detectedLabel").textContent="人を探しています";
    } catch(error) {
      console.error("姿勢推定を開始できませんでした",error);
      $("#poseStatus").textContent="AI 利用不可";
      $("#detectedLabel").textContent="通常録画のみ利用できます";
      this.message("姿勢AIを読み込めませんでした。通信状態を確認してください。",true);
    }
  }

  async flipCamera() {
    if(this.recording)return;
    $("#flipCameraButton").disabled=true;
    try { await this.camera.flip(); this.stage.style.aspectRatio=`${this.video.videoWidth} / ${this.video.videoHeight}`; this.applyMirroring(); $("#cameraStatus").textContent=this.camera.facingMode==="user"?"FRONT CAMERA":"BACK CAMERA"; }
    catch(error){this.message(friendlyError(error),true)}
    finally{$("#flipCameraButton").disabled=false}
  }

  applyMirroring() {
    const mirrored=this.camera.facingMode==="user";
    this.video.classList.toggle("is-mirrored",mirrored);
    $("#poseCanvas").classList.toggle("is-mirrored",mirrored);
  }

  loop=()=>{
    if(!this.cameraReady)return;
    const now=performance.now();
    if(this.poseReady&&now-this.lastDetectionAt>=1000/TARGET_FPS){
      this.lastDetectionAt=now;
      try {
        const landmarks=this.detector.detect(this.video,now);
        if(landmarks){
          this.latestLandmarks=landmarks;
          const detected=landmarks.length>0;
          $("#detectedLabel").textContent=detected?"全身を検出中":"人を探しています";
          if(this.recording) this.motionData.push({time:(now-this.recordStart)/1000,landmarks:landmarks.map(p=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility}))});
        }
      } catch(error){console.warn("姿勢推定フレームをスキップしました",error)}
    }
    this.renderer.render(this.video,this.latestLandmarks);
    if(this.recording) $("#elapsedTime").textContent=formatTime((now-this.recordStart)/1000);
    this.raf=requestAnimationFrame(this.loop);
  };

  setPreview(mode) {
    this.renderer.mode=mode;
    this.stage.classList.toggle("preview-video",mode==="video");
    this.stage.classList.toggle("preview-skeleton",mode==="skeleton");
    $$('[data-preview]').forEach(button=>button.classList.toggle("is-active",button.dataset.preview===mode));
  }

  async beginCapture() {
    if(!this.cameraReady||this.recording)return;
    if(!window.MediaRecorder){this.message("このブラウザでは動画録画を利用できません。",true);return}
    $("#recordButton").disabled=true;$("#flipCameraButton").disabled=true;
    try {
      $("#countdown").hidden=false;
      for(const number of [3,2,1]){$("#countdown").textContent=number;await sleep(760)}
      $("#countdown").textContent="GO";await sleep(330);$("#countdown").hidden=true;
      this.motionData=[];
      this.renderer.difficulty=$("#difficultySelect").value;
      this.recorder.start(this.camera.stream,this.renderer.recordCanvas,TARGET_FPS);
      this.recordStart=performance.now();this.recording=true;
      $("#recordingHud").hidden=false;$("#stopButton").disabled=false;
      $("#readyLabel").textContent="録画中";$("#detectedLabel").textContent="動いてください！";
      const duration=Number($("#durationSelect").value);
      this.autoStop=setTimeout(()=>this.finishCapture(),duration*1000);
    } catch(error) {
      $("#countdown").hidden=true;$("#recordButton").disabled=false;$("#flipCameraButton").disabled=false;
      this.message(friendlyError(error),true);
    }
  }

  async finishCapture() {
    if(!this.recording)return;
    clearTimeout(this.autoStop);this.recording=false;
    $("#stopButton").disabled=true;$("#recordingHud").hidden=true;
    $("#readyLabel").textContent="録画を処理中";
    try {
      const blobs=await this.recorder.stop();
      const durationSec=Math.max(.1,(performance.now()-this.recordStart)/1000);
      const thumbCanvas=this.renderer.renderOriginalFrame(this.video);
      const thumbnailBlob=await canvasToBlob(thumbCanvas);
      this.pending={...blobs,motionData:this.motionData.slice(),thumbnailBlob,durationSec,difficulty:$("#difficultySelect").value,cameraFacing:this.camera.facingMode,width:this.renderer.width,height:this.renderer.height};
      this.openReview();
    } catch(error){this.message(friendlyError(error),true)}
    finally{$("#recordButton").disabled=false;$("#flipCameraButton").disabled=false;$("#readyLabel").textContent="録画できます";$("#detectedLabel").textContent=this.poseReady?"全身を検出中":"通常録画のみ利用できます"}
  }

  openReview() {
    $("#titleInput").value="";$("#answerInput").value="";$("#hintInput").value="";
    this.setReviewMode("skeleton");
    $("#reviewDialog").showModal();
  }

  setReviewMode(mode) {
    $$('[data-review-mode]').forEach(button=>button.classList.toggle("is-active",button.dataset.reviewMode===mode));
    const video=$("#reviewVideo"),canvas=$("#reviewSkeleton");
    this.reviewPlayer.pause();video.pause();
    if(mode==="original"){
      canvas.hidden=true;video.hidden=false;
      this.setBlobVideo(video,this.pending?.originalBlob);video.play().catch(()=>{});
    } else {
      video.hidden=true;canvas.hidden=false;
      this.reviewPlayer.load(this.pending?.motionData,this.pending?.difficulty,this.pending?.width,this.pending?.height);
      this.reviewPlayer.play();
    }
  }

  closeReview(){this.reviewPlayer.stop();$("#reviewVideo").pause();$("#reviewDialog").close();this.pending=null}

  async savePending() {
    if(!this.pending)return;
    const saveButton=$("#saveButton");saveButton.disabled=true;saveButton.textContent="保存中…";
    try {
      const work={id:makeId(),title:$("#titleInput").value.trim(),answer:$("#answerInput").value.trim(),hint:$("#hintInput").value.trim(),createdAt:Date.now(),...this.pending};
      if(!work.title||!work.answer)return;
      await this.store.put(work);
      $("#reviewDialog").close();this.pending=null;
      await this.refreshLibrary();this.showView("library");
    } catch(error){this.message(`保存できませんでした。空き容量をご確認ください。 ${friendlyError(error)}`,true)}
    finally{saveButton.disabled=false;saveButton.textContent="端末に保存"}
  }

  showView(name) {
    $$(".view").forEach(view=>view.classList.toggle("is-active",view.id===`${name}View`));
    $$(".nav-button").forEach(button=>button.classList.toggle("is-active",button.dataset.view===name));
    if(name==="library")this.refreshLibrary();
  }

  async refreshLibrary() {
    const works=await this.store.all();
    this.revokeLibraryUrls();
    $("#workCount").textContent=`${works.length}作品`;
    $("#emptyLibrary").hidden=works.length>0;
    const grid=$("#workGrid");grid.replaceChildren();
    works.forEach(work=>{
      const button=document.createElement("button");button.type="button";button.className="work-card";
      const image=document.createElement("img");image.alt="";
      if(work.thumbnailBlob){image.src=URL.createObjectURL(work.thumbnailBlob);this.libraryUrls??=[];this.libraryUrls.push(image.src)}
      const tag=document.createElement("span");tag.className="difficulty-tag";tag.textContent=DIFFICULTIES[work.difficulty]?.label||"ふつう";
      const copy=document.createElement("div"),title=document.createElement("b"),date=document.createElement("small");
      title.textContent=work.title;date.textContent=`${formatDate(work.createdAt)} ・ ${Math.round(work.durationSec)}秒`;copy.append(title,date);button.append(image,tag,copy);
      button.addEventListener("click",()=>this.openDetail(work.id));grid.append(button);
    });
  }

  async openDetail(id) {
    const work=await this.store.get(id);if(!work)return;
    this.currentWork=work;$("#detailTitle").textContent=work.title;$("#detailAnswer").textContent=work.answer;
    $("#detailHint").textContent=work.hint?`ヒント：${work.hint}`:"ヒントはありません";
    $("#answerBox").classList.remove("is-visible");$("#revealButton").textContent="答えを見る";
    $("#motionSummary").textContent=JSON.stringify({id:work.id,createdAt:new Date(work.createdAt).toISOString(),durationSec:work.durationSec,cameraFacing:work.cameraFacing,difficulty:work.difficulty,frameCount:work.motionData?.length||0,landmarksPerFrame:work.motionData?.[0]?.landmarks?.length||0},null,2);
    $("#speedSelect").value="1";$("#loopToggle").checked=true;
    this.setDetailMode("skeleton");$("#detailDialog").showModal();
  }

  setDetailMode(mode) {
    $$('[data-detail-mode]').forEach(button=>button.classList.toggle("is-active",button.dataset.detailMode===mode));
    this.detailMode=mode;const video=$("#detailVideo"),canvas=$("#detailCanvas");
    this.stopDetailMedia();
    if(mode==="original") { canvas.hidden=true;video.hidden=false;this.setBlobVideo(video,this.currentWork?.originalBlob); }
    else { video.hidden=true;canvas.hidden=false;this.detailPlayer.load(this.currentWork?.motionData,this.currentWork?.difficulty,this.currentWork?.width,this.currentWork?.height); }
    $("#bigPlayButton").hidden=false;
  }

  toggleDetailPlayback() {
    if(this.detailMode==="original") $("#detailVideo").play().catch(()=>{});
    else {this.detailPlayer.play();$("#bigPlayButton").hidden=true}
  }
  setPlaybackSpeed(speed){$("#detailVideo").playbackRate=speed;this.detailPlayer.speed=speed}
  setLoop(loop){$("#detailVideo").loop=loop;this.detailPlayer.loop=loop}
  revealAnswer(){const visible=$("#answerBox").classList.toggle("is-visible");$("#revealButton").textContent=visible?"答えを隠す":"答えを見る"}
  stopDetailMedia(){this.detailPlayer.stop();$("#detailVideo").pause()}
  closeDetail(){this.stopDetailMedia();$("#detailDialog").close();this.currentWork=null}

  async deleteCurrent() {
    if(!this.currentWork||!confirm(`「${this.currentWork.title}」を削除しますか？`))return;
    await this.store.delete(this.currentWork.id);this.closeDetail();await this.refreshLibrary();
  }

  setBlobVideo(video,blob) {
    if(!blob)return;
    if(video.dataset.objectUrl)URL.revokeObjectURL(video.dataset.objectUrl);
    const url=URL.createObjectURL(blob);video.dataset.objectUrl=url;video.src=url;video.loop=true;video.muted=true;
  }

  message(text,isError=false) {
    const node=$("#stageMessage");node.textContent=text;node.style.borderColor=isError?"rgba(255,102,92,.5)":"";node.classList.add("is-visible");
    clearTimeout(this.messageTimer);this.messageTimer=setTimeout(()=>node.classList.remove("is-visible"),4500);
  }

  revokeLibraryUrls(){(this.libraryUrls||[]).forEach(URL.revokeObjectURL);this.libraryUrls=[]}
  destroy(){cancelAnimationFrame(this.raf);clearTimeout(this.autoStop);this.camera.stop();this.detector.close();this.reviewPlayer.stop();this.detailPlayer.stop();this.revokeLibraryUrls()}
}
