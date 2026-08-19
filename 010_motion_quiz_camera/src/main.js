import { MotionQuizApp } from "./app.js?v=20260820c";

const app = new MotionQuizApp();
app.init().catch(error => console.error("アプリの初期化に失敗しました", error));
window.addEventListener("pagehide", () => app.destroy());
