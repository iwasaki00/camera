# face_effect 顔エフェクトカメラ

iPhone の Safari で使う前提の、静的 HTML / CSS / JavaScript だけで作った Web アプリです。  
インカメラ映像を `canvas` に描画し、MediaPipe Tasks Vision の顔ランドマークと手ランドマークを使って、次のエフェクトを切り替えられます。

- 白目
- つながり眉
- 数式
- おそろしい子

`おそろしい子` モードでは、顔を検出すると昭和少女漫画風の演出をそのまま表示します。

## ファイル構成

- `index.html`
- `style.css`
- `main.js`
- `README.md`

## 起動方法

1. `face_effect` フォルダをローカルサーバーで公開します
2. ブラウザで `face_effect/index.html` を開きます
3. エフェクトを選びます
4. 「カメラ開始」を押します
5. カメラ権限を許可します
6. 顔が映ると、選択中のエフェクトが重なります

## iPhone で試す方法

1. iPhone と PC を同じ Wi-Fi に接続します
2. VSCode の Live Server などで `face_effect` を配信します
3. PC のローカル IP アドレスを確認します
4. iPhone の Safari で `http://PCのIPアドレス:ポート/face_effect/` を開きます

例:

```text
http://192.168.1.10:5500/face_effect/
```

補足:
iPhone で `localhost` を開くと iPhone 自身を見に行くため、PC のサーバーには接続できません。

## GitHub Pages で公開する方法

1. GitHub にリポジトリを作成します
2. `index.html` / `style.css` / `main.js` / `README.md` を Push します
3. GitHub のリポジトリ画面で `Settings` を開きます
4. `Pages` を開きます
5. `Source` を `Deploy from a branch` にします
6. `Branch` を `main`、folder を `/root` にします
7. `Save` を押します
8. 数分後に表示される URL を iPhone で開きます
9. カメラ権限を許可します

URL 例:

```text
https://<username>.github.io/<repository>/face_effect/
```

GitHub Pages は HTTPS で配信されるため、iPhone のカメラ検証に向いています。

## カメラ権限について

- このアプリは `navigator.mediaDevices.getUserMedia()` を使うため、カメラ権限が必要です
- iPhone Safari で「カメラ開始」を押したら、カメラの使用を許可してください
- 以前に拒否した場合は、Safari のサイト設定または iPhone の設定から権限を見直してください

## HTTPS 環境について

- iPhone では HTTPS 環境でないとカメラが動かない可能性があります
- `file://` 直開きではカメラは動きません
- 公開して試す場合は GitHub Pages の HTTPS URL を使ってください

## 実装メモ

- カメラ取得は `getUserMedia()` を使用
- 顔検出には `FaceLandmarker` を使用
- `おそろしい子` モードでは、顔検出時に白目、吹き出し、集中線を常時表示
- 吹き出し、集中線、白目はすべて `canvas` 描画のみで表現
- プロトタイプ優先で、判定はシンプルな閾値ベースにしています
