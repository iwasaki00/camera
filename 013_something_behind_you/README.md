# 振り返ればヤツガイル

iPhone の背面カメラと方向センサーを使い、視界の端に現れた人影が振り向いた瞬間に逃げるように見せる疑似 AR ホラー Web ゲームです。現実空間の認識は行わず、開始時からの相対 Yaw と仮想キャラクターの方位を使います。

**Version 0.1.0 — SOMETHING BEHIND YOU**

## 対応想定環境

- iPhone の最新 Safari（縦持ちを推奨）
- カメラと方向センサーを利用できる HTTPS 環境
- GitHub Pages などの静的ホスティング

`getUserMedia()` と iOS のセンサー許可には Secure Context が必要です。実機確認は HTTPS で配信してください。映像は端末上にのみ表示され、保存・送信されません。

## iPhone Safari での利用手順

1. HTTPS で配信した `013_something_behind_you/` を Safari で開きます。
2. iPhone を縦向きに持ち、「START」をタップします。
3. カメラ、およびモーションと画面の向きへのアクセスを許可します。
4. 起動時に向いていた方向を基準の `0°` として、ゆっくり左右を見回します。
5. 視界端の人影に気づいたら、その方向へ素早く振り向きます。

拒否した権限は、iPhone の「設定」または Safari の Web サイト設定から変更してください。方向センサーイベントが届かない場合は、Safari の「モーションと画面の向きのアクセス」も確認してください。

## DEBUG モード

URL 末尾に `?debug=1` を付けます。

```text
013_something_behind_you/?debug=1
```

DEBUG モードでは Version、カメラ方位、開始方位、相対 Yaw、キャラクター方位、角度差、回転速度、状態、検出側、各権限状態、左右 18% の Peripheral Zone を表示します。通常 URL ではすべて非表示です。

## Version 0.1.0 の実装範囲

- 背面カメラの全画面表示
- START 操作を起点としたカメラ／方向センサー／モーション権限要求
- 開始時方位を基準にした相対 Yaw と 0°／360° 境界を跨ぐ角度計算
- 1体の差し替え可能な SVG シルエットと `entityYaw`
- `HIDDEN → STALKING → PERIPHERAL → SPOTTED → ESCAPE → RELOCATE → STALKING` の状態遷移
- 角度差に応じた画面端からの侵入量
- 素早い振り向きに反応する、約 180ms の画面外への逃走演出
- 現在方向から最低 78° 離した再配置とランダムな待機時間
- 権限拒否、非対応、センサー値欠落、カメラ取得失敗の案内
- portrait-first、safe-area、スクロール／選択／意図しない拡大の抑制

## 角度判定

- `initialYaw`: ゲーム開始後、最初に正常取得した端末方位
- `currentYaw`: センサーノイズを平滑化した現在方位
- `relativeYaw`: `initialYaw` からの最短符号付き角度差。右方向を正として扱います
- `entityYaw`: 開始方向を基準とした仮想空間内のキャラクター方位
- `angleDiff`: `entityYaw - relativeYaw` を `-180°～180°` に正規化した値
- `turnSpeed`: フレーム間の方位差を `°/s` に換算して平滑化した値
- Peripheral: `|angleDiff| ≤ 46°` で進入し、`58°` を超えると非表示へ戻ります
- SPOTTED: `|angleDiff| ≤ 15°`、回転速度 `46°/s` 以上、かつ人影へ近づく速度 `14°/s` 以上で成立します

## 調整可能パラメータ

`app.js` 冒頭の `CONFIG` に集約しています。

| パラメータ | 現在値 | 用途 |
|---|---:|---|
| `peripheralZonePercent` | 18% | DEBUG の左右視界端ガイド |
| `peripheralEnterAngle` | 46° | PERIPHERAL へ入る角度 |
| `peripheralExitAngle` | 58° | 視界端から離れたときの解除角度 |
| `spottedAngle` | 15° | SPOTTED の近接角度 |
| `fastTurnThreshold` | 46°/s | 素早い振り向きの最低速度 |
| `minimumApproachSpeed` | 14°/s | 人影へ近づいているとみなす速度 |
| `escapeDuration` | 180ms | 逃走演出時間 |
| `minStalkDelay` / `maxStalkDelay` | 2200ms / 5200ms | 次に出現可能になるまでの待機 |
| `relocateMinimumAngle` | 78° | 再配置時の最低角度差 |
| `entitySizeVw` | 54vw | キャラクター基準幅 |

## ファイル構成

```text
013_something_behind_you/
├── index.html                    画面と各レイヤー
├── style.css                     portrait-first UI と逃走演出
├── app.js                        権限、カメラ、センサー、状態、描画、DEBUG
├── logic.js                      角度計算などの純粋関数
├── package.json                  ローカルテスト設定（依存パッケージなし）
├── assets/entity-silhouette.svg  差し替え可能なキャラクター素材
└── tests/logic.test.mjs          角度と再配置の自動テスト
```

## 今回未実装の主要機能

WebXR、ARKit 相当機能、SLAM、平面／壁／家具／人物／画像認識、深度推定、LiDAR、マイク、撮影・録画・保存、複数キャラクター、スコア、HP、ゲームオーバー、クリア条件、ステージ、セーブ、ランキング、オンライン機能、サーバー、データベース、PWA、課金、広告は意図的に実装していません。

## 実機で確認するポイント

- 人影が中央ではなく視界端にいると感じられるか
- 人影へ近づくほど見える量が自然に増えるか
- 素早く振り向いた瞬間の反応が遅すぎないか
- 約 180ms の逃走速度と、逃げる左右方向が自然か
- シルエットの大きさと見える量が「確認できそうでできない」範囲か
