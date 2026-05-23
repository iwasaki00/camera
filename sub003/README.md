# sub003 白目カメラ

iPhone の Safari / Chrome から使う前提で作った、静的 HTML / CSS / JavaScript のみの Web アプリです。  
インカメラ映像を `canvas` に描画し、MediaPipe Face Landmarker で検出した目の位置へ白い楕円と小さな黒目を重ねて、白目っぽく見せます。

## ファイル構成

- `index.html`
- `style.css`
- `main.js`
- `README.md`

## 仕様メモ

- ビルド環境なしで GitHub Pages にそのまま置ける構成です
- `@mediapipe/tasks-vision` は CDN から読み込みます
- 顔認識ではなく顔ランドマーク検出を使っています
- カメラ取得は `navigator.mediaDevices.getUserMedia()` を使います
- `file://` 直開きではカメラ機能が動かないため、必ず HTTPS またはローカルサーバー経由で開いてください

## 起動方法

1. この `sub003` フォルダ配下をローカルサーバーで公開します
2. ブラウザで `sub003/index.html` を開きます
3. 「カメラ開始」を押します
4. カメラ許可ダイアログで許可します
5. 顔が映ると、両目に白い楕円が重なります

## VSCode の Live Server での起動方法

1. VSCode で `camera` リポジトリを開きます
2. 拡張機能 `Live Server` をインストールします
3. `sub003/index.html` を開きます
4. 右下の `Go Live` を押します
5. PC のブラウザで `http://localhost:5500/sub003/` のような URL が開けば準備完了です

補足:
Live Server は通常 `localhost` または `127.0.0.1` で開きます。PC 上での確認には使えますが、iPhone から使う場合は PC のローカル IP でアクセスする必要があります。

## iPhone で PC のローカルサーバーにアクセスする方法

1. iPhone と PC を同じ Wi-Fi に接続します
2. PC のローカル IP アドレスを確認します
3. Live Server などで `sub003` を配信したままにします
4. iPhone の Safari で `http://PCのIPアドレス:ポート/sub003/` を開きます

例:

```text
http://192.168.1.10:5500/sub003/
```

補足:
iPhone で `localhost` を開いても iPhone 自身を見に行くだけなので、PC のサーバーには接続できません。

## GitHub Pages で公開する手順

1. GitHub にリポジトリを作成します
2. `index.html` / `style.css` / `main.js` / `README.md` を Push します
3. GitHub のリポジトリ画面で `Settings` を開きます
4. `Pages` を開きます
5. `Source` を `Deploy from a branch` にします
6. `Branch` を `main`、folder を `/root` にします
7. `Save` を押します
8. 数分後に表示される URL を iPhone で開きます
9. カメラ許可を許可します

`sub003` フォルダをそのまま公開する場合の URL 例:

```text
https://<username>.github.io/<repository>/sub003/
```

GitHub Pages は HTTPS で配信されるため、iPhone のカメラ機能を使う公開先として相性が良いです。

## カメラが映らない場合の確認項目

- `file://` で直接開いていないか
- HTTPS または `localhost` / ローカルサーバー経由で開いているか
- iPhone Safari でカメラ許可を拒否していないか
- iPhone と PC が同じネットワークに接続されているか
- GitHub Pages の公開 URL を開いているか
- Face Landmarker の CDN とモデル URL にアクセスできるネットワークか
- 画面に顔全体が入る距離までカメラを引いているか

## HTTPS でないと動かない可能性について

このアプリはカメラ API を使うため、iPhone では HTTPS でないと動かない可能性があります。  
公開用途では GitHub Pages の HTTPS URL を使ってください。  
ローカル検証では `localhost` やローカルサーバーで動く場合がありますが、iPhone 実機では HTTPS の方が確実です。

## iPhone Safari でカメラ許可を確認すること

1. iPhone でページを開きます
2. 「カメラ開始」を押します
3. カメラ許可ダイアログが出たら `許可` を選びます
4. 以前に拒否していた場合は Safari のサイト設定または iPhone の設定からカメラ許可を見直してください

## 実装内容

- `navigator.mediaDevices.getUserMedia()` でインカメラを取得
- `canvas` にミラー表示の映像を描画
- MediaPipe Face Landmarker を `VIDEO` モードで実行
- 一般的な目周辺ランドマークと虹彩ランドマークから白目の位置と大きさを計算
- 顔未検出時はカメラ映像のみを表示
- エラー時は画面上にメッセージを表示
