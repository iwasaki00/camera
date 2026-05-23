# 変顔メーカー

React + Vite + TypeScript + MediaPipe Face Landmarker を使った、iPhone Safari 向けの変顔アプリです。

## 機能

- 前面カメラ起動
- 顔ランドマーク検出
- `眉 / 目 / 耳 / 頬 / 鼻 / 口 / 頭 / 顎` のパーツ変形
- 画面下部のタブとスライダーで調整
- スクリーンショット保存
- リセット
- ランダム変顔
- 3 つのプリセット
  - `びっくり顔`
  - `宇宙人顔`
  - `おじさん顔`
- `🎲 ランダム事故`
  - `軽い事故`
  - `大事故`
  - `宇宙人事故`
  - `ホラー事故`
  - `ギャグ事故`
  - `イケメン事故`
- 0.5 秒のガチャ演出
- 変顔診断結果表示

## 使い方

```bash
cd henface_maker
npm install
npm run dev
```

## build

```bash
npm run build
```

`dist/` が出力されます。

## GitHub Pages

`vite.config.ts` で `base: "./"` を指定しているので、GitHub Pages に載せやすい構成です。

手順例:

1. `cd henface_maker`
2. `npm install`
3. `npm run build`
4. `dist/` を Pages 用に公開する、または GitHub Actions で deploy する

既存の `face_effect` と同じように workflow を分ければ、別アプリとして公開できます。

## 注意

- iPhone Safari では HTTPS 環境で開いてください
- カメラ許可が必要です
- 最初は 1 人の顔のみ対応です
- 完全なメッシュ変形ではなく、パーツ単位の簡易変形です
