# Genius Filter Camera

React + Vite + MediaPipe Face Landmarker で作る、iPhone Safari 向けの「考えている風・天才風フィルター」です。

## 機能

- 前面カメラのリアルタイム表示
- 顔周辺へ数式オーバーレイを表示
- 球体ワイヤーフレーム、円錐断面、XYZ 軸、幾何学図形、ベクトル矢印を重ねる
- 鼻を基準にした顔追従
- 口が閉じる、または眉間が寄ると「考え中モード」で数式量を増やす
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
- 顔認識モデルは初回起動時に CDN から取得します
