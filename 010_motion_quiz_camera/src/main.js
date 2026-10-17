import { MotionQuizApp } from "./app.js?v=20261017a";

const app = new MotionQuizApp();
app.init().catch(error => console.error("アプリの初期化に失敗しました", error));
// Page lifecycle is handled by the app; pagehide may enter the back-forward cache.
