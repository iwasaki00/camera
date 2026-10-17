# Genius Filter Camera

React + Vite + MediaPipe Face Landmarker で作る、iPhone Safari 向けの顔エフェクトカメラです。

## 機能

- 前面カメラのリアルタイム表示
- 顔周辺へ数式オーバーレイを表示
- 球体ワイヤーフレーム、円錐断面、XYZ 軸、幾何学図形、ベクトル矢印を重ねる
- 白目、つながり眉、目隠し、ハート目、目元モザイクを切り替え
- 目隠し、ハート目、目元モザイクは目周辺のランドマークに追従
- 眉間が寄ると「考え中モード」で数式量を増やす
- Canvas 合成結果のスクリーンショット保存

## 使用技術

- React
- Vite
- MediaPipe Tasks Vision
- Canvas API
- requestAnimationFrame

## セットアップ

```bash
npm install
npm run dev
```

Vite の開発サーバーが起動したら、表示された URL を iPhone Safari で開いてください。

## ビルド

```bash
npm run build
```

`dist/` を GitHub Pages へ配置できます。

## GitHub Pages

このプロジェクトは `vite.config.js` で `base: "./"` を設定しています。GitHub Pages にそのまま配置しやすい構成です。

標準的な公開手順:

1. `npm install`
2. `npm run build`
3. `dist/` の中身を公開ブランチへ配置

## 注意点

- iPhone Safari ではカメラ利用時に HTTPS 配信が必要です
- `file://` 直開きではカメラ許可が出ない場合があります
- 顔認識モデルの初回取得には外部通信が発生します。MediaPipe の WASM は jsDelivr CDN、モデルは Google のストレージから取得します（ブラウザのキャッシュ状況により再取得されます）。
- カメラ映像・撮影画像・顔ランドマークはブラウザ内で処理し、外部サービスやサーバーへ送信しません。顔画像を localStorage 等へ自動保存する機能やアクセス解析はありません。
- タブの切り替えや画面の中断時にはカメラを停止します。復帰後は「カメラ起動」で再開してください。起動中に停止した場合、ブラウザの取得要求が完了するまで次の起動を待ちます。
- スクリーンショットはエフェクト合成後の PNG です。Safari でダウンロードされない場合は、保存後の「画像を開く」から画像の長押し・共有メニューで保存してください。画像リンクは次の撮影・「閉じる」・画面終了まで有効です。

## 関連テスト

```bash
node --test tests/app-lifecycle.test.mjs
npm run build
```

カメラ・モデル・描画・保存の非同期処理はモックで確認します。iPhone 実機の権限表示、モデル取得、映像再生、PNG 保存、バックグラウンド移行は実機での確認が必要です。
