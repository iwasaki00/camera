import { CameraController } from "./camera.js";
import { PoseDetector } from "./pose.js";
import { PoseRenderer } from "./renderer.js?v=20261017a";
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
    this.state="idle";
    this.captureGeneration=0;
    this.cameraGeneration=0;
    this.view="capture";
    this.saving=false;
    this.cameraReady=false;
    this.poseReady=false;
    this.lastDetectionAt=0;
    this.recorder.oninterrupt=()=>{if(this.recording)this.finishCapture();};
  }

  async init() {
    this.bindEvents();
    await this.refreshLibrary();
    if(!navigator.mediaDevices?.getUserMedia) this.message("このブラウザはカメラ撮影に対応していません。",true);
  }

  bindEvents() {
    $$('[data-view]').forEach(button=>button.addEventListener("click",()=>this.showView(button.dataset.view)));
    $("#startCameraButton").addEventListener("click",()=>this.startCamera());
    $("#flipCameraButton").addEventListener("click",()=>this.flipCamera());
    $("#recordButton").addEventListener("click",()=>this.beginCapture());
    $("#cancelCountdownButton").addEventListener("click",()=>this.cancelCountdown());
    $("#closeReviewButton").addEventListener("click",()=>this.closeReview());
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
    $("#reviewDialog").addEventListener("cancel",event=>{event.preventDefault();if(!this.saving)this.closeReview();});
    $("#reviewDialog").addEventListener("close",()=>this.stopReviewMedia());
    $("#detailDialog").addEventListener("close",()=>this.stopDetailMedia());
    document.addEventListener("visibilitychange",()=>{if(document.hidden)this.suspend();else this.resume();});
    window.addEventListener("pagehide",()=>this.suspend());
    window.addEventListener("pageshow",()=>this.resume());
  }

  get recording(){return this.state==="recording";}

  setState(state) {
    this.state=state;
    const available=this.cameraReady&&!document.hidden;
    const waiting=["idle","error"].includes(state);
    $("#startCameraButton").disabled=this.cameraReady||document.hidden||this.saving||["recording","finalizing","review"].includes(state);
    $("#recordButton").disabled=!available||!waiting||this.saving;
    $("#flipCameraButton").disabled=!available||!["idle","error","countdown"].includes(state)||this.saving;
    $("#stopButton").disabled=state!=="recording";
    $("#countdown").hidden=state!=="countdown";
    $("#recordingHud").hidden=state!=="recording";
    for(const id of ["#durationSelect","#difficultySelect"])$(id).disabled=!waiting;
    $("#readyLabel").textContent=({idle:available?"録画できます":"カメラを開始してください",countdown:"開始まで…（キャンセルできます）",recording:"録画中",finalizing:"録画を処理中",review:"撮影結果を確認してください",error:"もう一度お試しください"})[state];
  }

  resetPoseFrames(){this.latestLandmarks=[];this.lastDetectionAt=0;this.detector.reset();}

  stopCamera() {
    this.cameraGeneration++;
    this.cancelCountdown();
    this.cameraReady=false;
    cancelAnimationFrame(this.raf);
    this.camera.stop();this.resetPoseFrames();
    $("#emptyCamera").hidden=false;
    $(".live-pill").classList.remove("is-on");
    $("#cameraStatus").textContent="CAMERA OFF";
    $("#startCameraButton").disabled=false;
    this.setState(this.state);
  }

  async startCamera(facingMode) {
    if(document.hidden||this.view!=="capture"||this.saving||["recording","finalizing","review"].includes(this.state))return;
    this.stopCamera();
    const generation=this.cameraGeneration;
    $("#startCameraButton").disabled=true;
    $("#cameraStatus").textContent="STARTING";
    try {
      await this.camera.start(facingMode);
      if(generation!==this.cameraGeneration||document.hidden||this.view!=="capture")return;
      this.cameraReady=true;this.resetPoseFrames();
      $("#appNotice").hidden=true;
      this.stage.style.aspectRatio=`${this.video.videoWidth} / ${this.video.videoHeight}`;
      this.applyMirroring();
      $("#emptyCamera").hidden=true;
      $(".live-pill").classList.add("is-on");
      $("#cameraStatus").textContent=this.camera.facingMode==="user"?"FRONT CAMERA":"BACK CAMERA";
      this.setState("idle");
      this.loop();
      if(!this.poseReady)await this.startPose();
      if(generation!==this.cameraGeneration)return;
      this.camera.stream?.getVideoTracks().forEach(track=>track.addEventListener("ended",()=>{
        if(generation===this.cameraGeneration){this.suspend();this.message("カメラが中断されました。カメラを開始し直してください。",true);}
      },{once:true}));
    }catch(error){
      if(generation!==this.cameraGeneration)return;
      this.stopCamera();this.setState("error");
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
      this.poseReady=false;
      $("#poseStatus").textContent="AI 利用不可";
      $("#detectedLabel").textContent="通常録画のみ利用できます";
      this.message("姿勢AIを読み込めませんでした。骨格クイズは作成できません。通信状態を確認し、カメラを開始し直すと再試行できます。",true);
    }
  }

  async flipCamera() {
    if(!this.cameraReady||["recording","finalizing","review"].includes(this.state)||this.saving)return;
    await this.startCamera(this.camera.facingMode==="environment"?"user":"environment");
  }

  applyMirroring() {
    const mirrored=this.camera.facingMode==="user";
    this.video.classList.toggle("is-mirrored",mirrored);
    $("#poseCanvas").classList.toggle("is-mirrored",mirrored);
  }

  loop=()=>{
    if(!this.cameraReady||document.hidden||this.view!=="capture")return;
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

  cancelCountdown() {
    this.captureGeneration++;
    this.cancelWait?.();this.cancelWait=null;
    if(this.state==="countdown")this.setState("idle");
  }

  countdownWait() {
    return new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);if(this.cancelWait===finish)this.cancelWait=null;resolve();};
      const timer=setTimeout(finish,1000);this.cancelWait=finish;
    });
  }

  async beginCapture() {
    if(!this.cameraReady||!["idle","error"].includes(this.state)||this.saving||document.hidden||this.view!=="capture")return;
    if(!window.MediaRecorder){this.message("このブラウザでは動画録画を利用できません。",true);return;}
    const generation=++this.captureGeneration;
    const valid=()=>generation===this.captureGeneration&&this.cameraReady&&!document.hidden&&this.view==="capture"&&this.state==="countdown";
    this.setState("countdown");
    try {
      for(const number of [3,2,1]){
        $("#countdownNumber").textContent=number;
        await this.countdownWait();
        if(!valid())return;
      }
      if(!valid())return;
      this.motionData=[];this.resetPoseFrames();
      this.renderer.difficulty=$("#difficultySelect").value;
      this.renderer.render(this.video,[]);
      this.recorder.start(this.camera.stream,this.renderer.recordCanvas,TARGET_FPS);
      this.recordStart=performance.now();
      this.setState("recording");
      $("#elapsedTime").textContent="00:00.0";
      $("#detectedLabel").textContent=this.poseReady?"動いてください！":"AI利用不可：元動画のみ撮影";
      this.autoStop=setTimeout(()=>this.finishCapture(),Number($("#durationSelect").value)*1000);
    }catch(error){this.setState("error");this.message(friendlyError(error),true);}
  }

  finishCapture() {
    if(this.state==="finalizing")return this.finalizing;
    if(!this.recording)return Promise.resolve();
    clearTimeout(this.autoStop);
    const durationSec=Math.max(.1,(performance.now()-this.recordStart)/1000);
    const motionData=this.motionData.slice();
    const metadata={durationSec,difficulty:this.renderer.difficulty,cameraFacing:this.camera.facingMode,width:this.renderer.width,height:this.renderer.height};
    // Take a frame before suspend() releases the camera. A missing thumbnail must not lose video.
    let thumbnail=null;
    try{thumbnail=this.renderer.renderOriginalFrame(this.video);}catch{}
    this.setState("finalizing");
    this.finalizing=(async()=>{
      try {
        const {errors,...blobs}=await this.recorder.stop();
        let thumbnailBlob=null;
        if(thumbnail)try{thumbnailBlob=await Promise.race([canvasToBlob(thumbnail),sleep(1500).then(()=>null)]);}catch{}
        if(!blobs.originalBlob&&!blobs.skeletonBlob&&!motionData.some(frame=>frame.landmarks?.length))throw new Error("録画データを取得できませんでした。撮影し直してください。");
        this.pending={...blobs,motionData,thumbnailBlob,...metadata};
        const warnings=[...errors];
        if(!motionData.some(frame=>frame.landmarks?.some(point=>(point.visibility??1)>=.42)))warnings.push("有効な姿勢データがないため、骨格クイズとして再生できません。");
        if(!thumbnailBlob)warnings.push("サムネイルは取得できませんでした。");
        const available=[blobs.originalBlob?"元動画":null,blobs.skeletonBlob?"骨格動画":null,motionData.length?"姿勢JSON":null].filter(Boolean).join("・");
        this.reviewNotice=warnings.length?warnings.join("\n")+"\n保存可能: "+available:"元動画・骨格動画・姿勢データを端末内に保存します。";
        this.setState("review");
        if(!document.hidden)this.openReview();
      }catch(error){this.setState("error");this.interruptionNotice=friendlyError(error);this.message(this.interruptionNotice,true);}
    })();
    return this.finalizing;
  }

  suspend() {
    this.detailGeneration=(this.detailGeneration||0)+1;
    this.libraryGeneration=(this.libraryGeneration||0)+1;
    this.cancelCountdown();
    if(this.recording){this.interruptionNotice="画面中断により録画を停止しました。取得できたデータを確認して保存してください。強制終了時の保存は保証できません。";this.finishCapture();}
    this.stopCamera();
    this.stopReviewMedia();this.stopDetailMedia();
    this.revokeLibraryUrls();
  }

  resume() {
    if(document.hidden)return;
    if(this.interruptionNotice){this.message(this.interruptionNotice,true);this.interruptionNotice=null;}
    if(this.pending&&this.state==="review"&&!$("#reviewDialog").open)this.openReview();
    if(this.view==="library")this.refreshLibrary();
    this.setState(this.state);
  }

  openReview() {
    $("#titleInput").value="";$("#answerInput").value="";$("#hintInput").value="";
    $("#reviewNotice").textContent=this.reviewNotice||"";
    this.setReviewMode(this.pending?.motionData.some(frame=>frame.landmarks?.length)?"skeleton":"original");
    if(!$("#reviewDialog").open)$("#reviewDialog").showModal();
  }

  setReviewMode(mode) {
    $$('[data-review-mode]').forEach(button=>button.classList.toggle("is-active",button.dataset.reviewMode===mode));
    const video=$("#reviewVideo"),canvas=$("#reviewSkeleton");
    this.stopReviewMedia();
    if(mode==="original"){
      canvas.hidden=true;video.hidden=false;
      this.setBlobVideo(video,this.pending?.originalBlob);video.play().catch(()=>{});
    } else {
      video.hidden=true;canvas.hidden=false;
      this.reviewPlayer.load(this.pending?.motionData,this.pending?.difficulty,this.pending?.width,this.pending?.height);
      this.reviewPlayer.play();
    }
  }

  stopReviewMedia(){this.reviewPlayer.stop();this.clearBlobVideo($("#reviewVideo"));}

  closeReview(){
    if(this.saving)return;
    this.stopReviewMedia();$("#reviewDialog").close();this.pending=null;this.pendingId=null;this.setState("idle");
  }

  async savePending() {
    if(!this.pending||this.saving)return;
    const title=$("#titleInput").value.trim(),answer=$("#answerInput").value.trim();
    if(!title||!answer)return;
    this.saving=true;
    const saveButton=$("#saveButton");saveButton.disabled=true;saveButton.textContent="保存中…";
    $("#retakeButton").disabled=true;$("#closeReviewButton").disabled=true;
    $$('[data-view]').forEach(button=>button.disabled=true);
    this.pendingId ||= makeId();
    try {
      const work={...this.pending,id:this.pendingId,title,answer,hint:$("#hintInput").value.trim(),createdAt:Date.now()};
      await this.store.put(work);
      this.stopReviewMedia();$("#reviewDialog").close();this.pending=null;this.pendingId=null;
      this.setState("idle");
      this.saving=false;this.showView("library");
    }catch(error){
      const text="保存できませんでした。端末の空き容量とブラウザの保存設定を確認してください。入力と撮影結果は保持しています。 "+friendlyError(error);
      $("#reviewNotice").textContent=text;this.message(text,true);
      if(document.hidden)this.interruptionNotice=text;
    }finally{
      this.saving=false;saveButton.disabled=false;saveButton.textContent="端末に保存";
      $("#retakeButton").disabled=false;$("#closeReviewButton").disabled=false;
      $$('[data-view]').forEach(button=>button.disabled=false);this.setState(this.state);
    }
  }

  showView(name) {
    if(this.saving||this.state==="finalizing")return;
    if(name!==this.view)this.closeDetail();
    if(name!=="capture"){if(this.recording)this.finishCapture();this.stopCamera();}
    this.view=name;
    $$(".view").forEach(view=>view.classList.toggle("is-active",view.id===`${name}View`));
    $$(".nav-button").forEach(button=>button.classList.toggle("is-active",button.dataset.view===name));
    if(name==="library")this.refreshLibrary();
  }

  async refreshLibrary() {
    const generation=this.libraryGeneration=(this.libraryGeneration||0)+1;
    let works;
    try{works=await this.store.all();}
    catch(error){this.message("作品を読み込めません。端末内の保存領域（IndexedDB）とブラウザの設定を確認してください。 "+friendlyError(error),true);return;}
    if(generation!==this.libraryGeneration||document.hidden)return;
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
    const generation=this.detailGeneration=(this.detailGeneration||0)+1;
    this.stopDetailMedia();
    let work;
    try{work=await this.store.get(id);}catch(error){this.message(friendlyError(error),true);return;}
    if(!work||generation!==this.detailGeneration||document.hidden)return;
    this.currentWork=work;$("#detailTitle").textContent=work.title;$("#detailAnswer").textContent=work.answer;
    $("#detailHint").textContent=work.hint?`ヒント：${work.hint}`:"ヒントはありません";
    $("#answerBox").classList.remove("is-visible");$("#revealButton").textContent="答えを見る";
    $("#motionSummary").textContent=JSON.stringify({id:work.id,createdAt:new Date(work.createdAt).toISOString(),durationSec:work.durationSec,cameraFacing:work.cameraFacing,difficulty:work.difficulty,frameCount:work.motionData?.length||0,landmarksPerFrame:work.motionData?.[0]?.landmarks?.length||0},null,2);
    $("#speedSelect").value="1";$("#loopToggle").checked=true;
    this.setPlaybackSpeed(1);this.setLoop(true);
    this.setDetailMode("skeleton");if(!$("#detailDialog").open)$("#detailDialog").showModal();
  }

  setDetailMode(mode) {
    $$('[data-detail-mode]').forEach(button=>button.classList.toggle("is-active",button.dataset.detailMode===mode));
    this.detailMode=mode;const video=$("#detailVideo"),canvas=$("#detailCanvas");
    this.stopDetailMedia();
    if(mode==="original") { canvas.hidden=true;video.hidden=false;this.setBlobVideo(video,this.currentWork?.originalBlob);video.playbackRate=Number($("#speedSelect").value);video.loop=$("#loopToggle").checked; }
    else { video.hidden=true;canvas.hidden=false;this.detailPlayer.load(this.currentWork?.motionData,this.currentWork?.difficulty,this.currentWork?.width,this.currentWork?.height); }
    $("#bigPlayButton").hidden=false;
  }

  toggleDetailPlayback() {
    if(this.detailMode==="original") {
      const video=$("#detailVideo");
      if(!video.dataset.objectUrl){this.setBlobVideo(video,this.currentWork?.originalBlob);video.playbackRate=Number($("#speedSelect").value);video.loop=$("#loopToggle").checked;}
      video.play().catch(()=>{});
    }
    else {this.detailPlayer.play();$("#bigPlayButton").hidden=true}
  }
  setPlaybackSpeed(speed){$("#speedSelect").value=String(speed);$("#detailVideo").playbackRate=speed;this.detailPlayer.speed=speed}
  setLoop(loop){$("#loopToggle").checked=loop;$("#detailVideo").loop=loop;this.detailPlayer.loop=loop}
  revealAnswer(){const visible=$("#answerBox").classList.toggle("is-visible");$("#revealButton").textContent=visible?"答えを隠す":"答えを見る"}
  stopDetailMedia(){this.detailPlayer.stop();this.clearBlobVideo($("#detailVideo"));}
  closeDetail(){this.detailGeneration=(this.detailGeneration||0)+1;this.stopDetailMedia();$("#detailDialog").close();this.currentWork=null}

  async deleteCurrent() {
    if(!this.currentWork||!confirm(`「${this.currentWork.title}」を削除しますか？`))return;
    try{await this.store.delete(this.currentWork.id);this.closeDetail();await this.refreshLibrary();}
    catch(error){this.message("削除できませんでした。"+friendlyError(error),true);}
  }

  clearBlobVideo(video){video.pause();video.removeAttribute("src");video.load();if(video.dataset.objectUrl)URL.revokeObjectURL(video.dataset.objectUrl);delete video.dataset.objectUrl;}

  setBlobVideo(video,blob) {
    this.clearBlobVideo(video);
    if(!blob)return;
    const url=URL.createObjectURL(blob);video.dataset.objectUrl=url;video.src=url;video.loop=true;video.muted=true;
  }

  message(text,isError=false) {
    const notice=$("#appNotice");notice.textContent=text;notice.hidden=false;
    const node=$("#stageMessage");node.textContent=text;node.style.borderColor=isError?"rgba(255,102,92,.5)":"";node.classList.add("is-visible");
    clearTimeout(this.messageTimer);this.messageTimer=setTimeout(()=>node.classList.remove("is-visible"),4500);
  }

  revokeLibraryUrls(){(this.libraryUrls||[]).forEach(URL.revokeObjectURL);this.libraryUrls=[]}
  destroy(){this.suspend();this.detector.close();this.revokeLibraryUrls();}
}
