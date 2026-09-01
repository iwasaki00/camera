const APP_DETAILS = {
  "posture-lens": {
    number: "011",
    type: "POSTURE TOOL",
    title: "Posture Lens｜姿勢解析ツール",
    description: "カメラや写真から全身の骨格を捉え、正面・側面の傾きや左右差を見える化します。解析結果の保存とBefore / After比較にも対応。日々の姿勢チェックに使えるツールです。",
    tech: "MediaPipe Pose · Canvas · Local Storage",
    icon: "./assets/app-icons/posture-lens.webp"
  },
  "motion-quiz": {
    number: "010",
    type: "MOTION GAME",
    title: "Motion Quiz Camera",
    description: "人の動きを骨格だけのアニメーションに変えて、「何の動きでしょう？」クイズを作れます。録画した作品、答え、ヒントは端末内に保存できます。",
    tech: "MediaPipe Pose · MediaRecorder · IndexedDB",
    icon: "./assets/app-icons/motion-quiz.webp"
  },
  "miniature-camera": {
    number: "009",
    type: "EFFECT CAMERA",
    title: "ミニチュアカメラ",
    description: "風景の一部だけにピントを残し、周囲をなめらかにぼかすティルトシフト風カメラです。写真・動画・タイムラプスをジオラマのような雰囲気で保存できます。",
    tech: "WebGL · Canvas · MediaRecorder",
    icon: "./assets/app-icons/miniature-camera.webp"
  },
  "fighting-plus": {
    number: "008",
    type: "AR EFFECTS PLUS",
    title: "格闘アニメ演出AR Plus",
    description: "格闘アニメ演出ARの拡張版。追加エフェクトや演出の細かな調整を別メニューで試し、カメラ映像をさらに派手なバトルシーンへ変えられます。",
    tech: "HTML · CSS · JavaScript · Camera API",
    icon: "./assets/app-icons/fighting-anime-plus.webp"
  },
  "fighting-anime": {
    number: "007",
    type: "AR EFFECTS",
    title: "格闘アニメ演出AR",
    description: "カメラ映像に集中線、衝撃波、オーラ、必殺技カットインなどを重ねるAR風アプリ。日常の動きを格闘アニメのワンシーンへ変えます。",
    tech: "HTML · CSS · JavaScript · Camera API",
    icon: "./assets/app-icons/fighting-anime.webp"
  },
  "lightsaber": {
    number: "006",
    type: "HAND TRACKING AR",
    title: "ライトセーバーAR",
    description: "前面カメラに映した両手のグーを近づけると、光る剣が伸びて手元に追従します。端末だけでライトセーバー風のアクションを楽しめます。",
    tech: "MediaPipe Hands · Canvas 2D · Camera API",
    icon: "./assets/app-icons/lightsaber.webp"
  },
  "ice-magic": {
    number: "005",
    type: "HAND TRACKING AR",
    title: "氷の魔法ポーズAR",
    description: "左右の手と手のひらの向きを認識し、構えたポーズに合わせて雪の粒子や氷の魔法を表示します。iPhone Safariで遊べるAR風カメラです。",
    tech: "React · Vite · MediaPipe Hands",
    icon: "./assets/app-icons/ice-magic.webp"
  },
  "sudoku-camera": {
    number: "004",
    type: "PUZZLE OCR",
    title: "ナンプレOCRカメラ",
    description: "カメラで撮ったナンプレ盤面を長方形に切り出し、9×9のマスへ分割して数字を読み取るOCRテストです。認識結果と各マスの画像も確認できます。",
    tech: "HTML · CSS · JavaScript · Tesseract.js",
    icon: "./assets/app-icons/sudoku-camera.webp"
  },
  "henface-maker": {
    number: "003",
    type: "FACE GAME",
    title: "変顔メーカー",
    description: "眉・目・耳・頬・鼻・口などの顔パーツを自由に変形。プリセットやランダム生成、変顔診断まで楽しめて、できあがった顔は画像で保存できます。",
    tech: "React · Vite · TypeScript · MediaPipe Face",
    icon: "./assets/app-icons/henface-maker.webp"
  },
  "face-effect": {
    number: "002",
    type: "FACE EFFECT CAMERA",
    title: "顔エフェクトカメラ",
    description: "顔の動きに追従して数式、幾何学図形、ハート目、つながり眉などを重ねます。眉間を寄せると数式が増える「考え中モード」も楽しめます。",
    tech: "React · Vite · MediaPipe Face · Canvas",
    icon: "./assets/app-icons/face-effect.webp"
  },
  "browser-camera": {
    number: "001",
    type: "BASIC CAMERA",
    title: "iPhone Browser Camera",
    description: "Safariから背面カメラを起動し、その場で静止画を撮影するシンプルなカメラです。撮り直しとPNG画像の保存に対応しています。",
    tech: "HTML · CSS · JavaScript · MediaDevices",
    icon: "./assets/app-icons/browser-camera.webp"
  }
};

const dialog = document.querySelector("#app-detail");
const dialogClose = dialog.querySelector("[data-dialog-close]");
const detailIcon = dialog.querySelector("#detail-icon");
const detailNumber = dialog.querySelector("#detail-number");
const detailType = dialog.querySelector("#detail-type");
const detailTitle = dialog.querySelector("#detail-title");
const detailDescription = dialog.querySelector("#detail-description");
const detailTech = dialog.querySelector("#detail-tech");
const detailLink = dialog.querySelector("#detail-link");
const interactionStatus = document.querySelector("#interaction-status");
const HOLD_DURATION = 540;
const MOVE_TOLERANCE = 12;

let holdTimer = 0;
let activeLink = null;
let pointerStart = null;
let suppressNextClick = false;

function showDetails(card) {
  const app = APP_DETAILS[card.dataset.app];
  const link = card.querySelector(".app-link");

  if (!app || !link) return;

  detailIcon.src = app.icon;
  detailIcon.alt = `${app.title}のアイコン`;
  detailNumber.textContent = `APP ${app.number}`;
  detailType.textContent = app.type;
  detailTitle.textContent = app.title;
  detailDescription.textContent = app.description;
  detailTech.textContent = app.tech;
  detailLink.href = link.href;
  interactionStatus.textContent = `${app.title}の詳細を表示しました。`;

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }

  dialogClose.focus({ preventScroll: true });
}

function clearHold() {
  window.clearTimeout(holdTimer);
  holdTimer = 0;

  if (activeLink) {
    activeLink.classList.remove("is-holding");
    activeLink = null;
  }

  pointerStart = null;
}

function beginHold(event, link) {
  if (event.pointerType === "mouse" && event.button !== 0) return;

  clearHold();
  suppressNextClick = false;
  activeLink = link;
  pointerStart = { x: event.clientX, y: event.clientY };
  link.classList.add("is-holding");

  holdTimer = window.setTimeout(() => {
    const card = link.closest(".app-card");
    suppressNextClick = true;
    link.classList.remove("is-holding");
    link.classList.add("is-long-pressed");
    window.setTimeout(() => link.classList.remove("is-long-pressed"), 220);

    if (navigator.vibrate) navigator.vibrate(18);
    showDetails(card);
  }, HOLD_DURATION);
}

document.querySelectorAll(".app-card").forEach((card) => {
  const link = card.querySelector(".app-link");
  const detailButton = card.querySelector("[data-detail-button]");

  link.addEventListener("pointerdown", (event) => beginHold(event, link));

  link.addEventListener("pointermove", (event) => {
    if (!pointerStart || activeLink !== link) return;

    const distance = Math.hypot(
      event.clientX - pointerStart.x,
      event.clientY - pointerStart.y
    );

    if (distance > MOVE_TOLERANCE) clearHold();
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    link.addEventListener(eventName, clearHold);
  });

  link.addEventListener("click", (event) => {
    if (!suppressNextClick) return;
    event.preventDefault();
    suppressNextClick = false;
  });

  link.addEventListener("contextmenu", (event) => {
    if (event.pointerType === "touch" || suppressNextClick) event.preventDefault();
  });

  detailButton.addEventListener("click", () => showDetails(card));
});

dialogClose.addEventListener("click", () => {
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
});

dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;

  const bounds = dialog.getBoundingClientRect();
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom;

  if (!inside && typeof dialog.close === "function") dialog.close();
});

window.addEventListener("blur", clearHold);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearHold();
});
