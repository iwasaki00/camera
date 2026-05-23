# sub002 白目カメラ

iPhone の Safari / Chrome で使う前提の、静的 HTML / CSS / JavaScript だけで構成した簡易 Web アプリです。  
インカメラ映像を取得し、MediaPipe Face Landmarker で顔ランドマークを検出して、両目に白い楕円と小さな黒目を重ねます。

## ファイル構成

- `index.html`
- `style.css`
- `main.js`
- `README.md`

## 起動方法

このアプリは `file://` 直開きでは動作しません。  
`navigator.mediaDevices.getUserMedia()` を使うため、`HTTPS` または `localhost` / ローカルサーバー経由で開いてください。

### ローカルで起動する

1. `camera/sub002` を VSCode で開く
2. ローカルサーバーで `index.html` を配信する
3. ブラウザで `http://localhost:xxxx/sub002/` または対応 URL を開く
4. 「カメラ開始」を押してカメラ許可を許可する

## VSCode の Live Server での起動方法

1. VSCode で `camera` フォルダを開く
2. 拡張機能 `Live Server` をインストールする
3. `sub002/index.html` を開く
4. 右下の `Go Live` を押す
5. PC のブラウザで表示確認する

補足:
Live Server は通常 `http://127.0.0.1:5500/...` や `http://localhost:5500/...` で起動します。  
PC 上の確認では動いても、iPhone から別端末アクセスする場合は `http` ではなく `https` が必要になることがあります。

## iPhone で PC のローカルサーバーにアクセスする方法

1. iPhone と PC を同じ Wi-Fi に接続する
2. PC のローカル IP アドレスを確認する
3. Live Server などでアプリを起動する
4. iPhone の Safari で `http://PCのIPアドレス:ポート/sub002/` を開く

例:

```text
http://192.168.1.10:5500/sub002/
```

重要:
iPhone では `localhost` は iPhone 自身を指すため、PC の `localhost` はそのまま使えません。  
また、iPhone のブラウザではカメラ利用に `HTTPS` が必要になる場合があります。ローカル確認で動かない場合は GitHub Pages での確認を優先してください。

## GitHub Pages で公開する手順

1. GitHub にリポジトリを作成する
2. `index.html` / `style.css` / `main.js` / `README.md` を Push する
3. GitHub のリポジトリ画面で `Settings` を開く
4. `Pages` を開く
5. `Source` を `Deploy from a branch` にする
6. `Branch` を `main`、folder を `/root` にする
7. `Save`
8. 数分後に表示される URL を iPhone で開く
9. カメラ許可を許可する

補足:
この `sub002` だけでなく `camera` ルートごと公開する場合、公開 URL は次のようになります。

```text
https://<username>.github.io/<repository>/sub002/
```

GitHub Pages は `HTTPS` で配信されるため、iPhone のカメラ機能確認に向いています。

## カメラが映らない場合の確認項目

- `file://` で直接開いていないか
- `HTTPS` または `localhost` / 適切なローカルサーバー経由で開いているか
- iPhone の Safari でカメラ許可を拒否していないか
- ページを開いている URL が GitHub Pages などの安全な配信元か
- iPhone と PC が同じネットワークに接続されているか
- インカメラが別アプリで占有されていないか
- 画面に顔が十分な大きさで映っているか

## HTTPS について

このアプリはカメラ API を使うため、iPhone では `HTTPS` でないと動かない可能性があります。  
GitHub Pages 公開後の URL は `HTTPS` なので、本番確認先として適しています。

## iPhone Safari でカメラ許可を確認する

1. iPhone で対象ページを開く
2. `カメラ開始` を押す
3. カメラ許可ダイアログで `許可` を選ぶ
4. 以前に拒否している場合は Safari のサイト設定または iPhone の設定からカメラ許可を見直す

## 実装メモ

- `navigator.mediaDevices.getUserMedia()` でインカメラを取得
- `@mediapipe/tasks-vision` を CDN から読み込み
- Face Landmarker の `VIDEO` モードで毎フレーム検出
- 一般的な Face Mesh の目周辺ランドマーク番号を使って目位置を計算
- 顔未検出時はカメラ映像だけ表示
