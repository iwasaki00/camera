# 振り返ればヤツガイル

**Version 0.2.1 — DEBUG BUTTON**

iPhoneの背面カメラと方向センサーによる疑似ARホラーです。相対Yawと仮想方位を使い、現実空間の認識は行いません。映像の保存・送信はありません。

## 起動

GitHub PagesなどのHTTPS環境で `013_something_behind_you/` をiPhone Safariから開き、縦持ちでSTARTをタップします。カメラとモーション・方向へのアクセスを許可し、測定後にゆっくり左右を見回してください。背面カメラを優先します。権限要求はSTART操作内で開始します。

実機にはHTTPSが必要です。権限拒否・非対応・HTTPS問題・センサー未取得は画面に案内します。方向データが途絶えると遭遇を停止します。タブを隠すと演出を片付け、復帰後に再び待機します。

## Encounter Director

`encounters.js` のDirectorが `IDLE → ARMING → EVENT → COOLDOWN → IDLE` を管理します。ARMINGでランダム待機して種類を抽選し、PEEKは対象方位へ近づくまで待ちます。他3種類はすぐ再生します。終了時に描画を片付け、現在方向から78°以上離して再配置します。1件ずつ実行し、実行中の抽選と強制テストを禁止します。新規タイマーを作らず、requestAnimationFrameで終了時刻を確認します。

抽選重みは50/30/15/5。同一種類は最大2回連続、CLOSE_CALLは連続不可です。除外後は残った重みで再抽選するため、実際の出現比率は少し変わります。

| 遭遇 | 発生条件・表示時間・表示方法 |
|---|---|
| PEEK | 抽選後、角度差46°以内で画面端へ出現。36°・24°を境に3段階で表示量を増加。素早く向くとSPOTTED→ESCAPE。最大6.5秒で逃走し、16秒視界に入らなければ終了。 |
| PASS | 280ms。細長い影の断片が画面端を高速で斜め上へ横切り、画面外へ抜ける。 |
| FLY_BY | 340ms。手前の大きな影が斜め奥へ縮小しながら飛び去る。 |
| CLOSE_CALL | 160ms。巨大な頭部断片だけが端に入り、即座に外へ抜ける。 |

## 設定値

遭遇設定は `encounters.js` の `ENCOUNTER_CONFIG`、既存角度・センサー設定は `app.js` の `CONFIG` に集約しています。

| 設定 | 初期値 |
|---|---|
| weights | PEEK 50 / PASS 30 / FLY_BY 15 / CLOSE_CALL 5 |
| minEncounterDelay / maxEncounterDelay | 3000 / 11000ms |
| cooldownMin / cooldownMax | 1800 / 4200ms |
| quietChance / quietExtraDelay | 20% / 8000ms追加 |
| consecutiveLimit | 2（CLOSE_CALLは連続不可） |
| peekMaxDuration / peekArmingTimeout | 6500 / 16000ms |
| peekThresholds | 36° / 24° |
| peekSizes | 0.96 / 1.00 / 1.04倍 |
| peekTranslations | 91 / 79 / 67%（画面外への押し出し量） |
| passDuration / passSpeed | 280ms / 1倍（実時間はduration÷speed） |
| flyByDuration / flyByScale | 340ms / 2.3→0.18倍 |
| closeCallDuration / closeCallSize | 160ms / 2.8倍 |
| peripheralZonePercent | 左右18% |
| peripheralEnterAngle / peripheralExitAngle | 46° / 58° |
| spottedAngle | 15° |
| fastTurnThreshold / minimumApproachSpeed | 46 / 14°/s |
| escapeDuration / relocateMinimumAngle | 180ms / 78° |
| entitySizeVw | 54vw（上限290px） |

クールダウン＋次回待機に、ときどき8秒の静かな時間を追加します。PEEKの視界待ちもあるため一定周期にはなりません。

## 既存0.1.0への影響

カメラ・権限・相対Yaw・角度計算・左右判定・SPOTTED・ESCAPE・RELOCATEを維持しています。旧PeripheralをPEEKへ整理し、その外側にDirectorを追加しました。

`initialYaw` は開始後の最初の正常方位、`currentYaw` は平滑化した方位、`relativeYaw` は開始からの最短符号付き角度差です。`entityYaw` は仮想キャラクター方位。`angleDiff` はentityYaw−relativeYawを-180°〜180°へ正規化し、正は右、負は左です。359°↔0°も最短差を使います。

PEEK中、角度差15°以内・回転速度46°/s以上・接近速度14°/s以上でSPOTTEDとなり、元の180msの逃走を使用します。表示しっぱなしを防ぐため最大表示時間も設けています。

## DEBUGと実機調整

通常URL `013_something_behind_you/` を開き、画面右上の **DEBUG** ボタンをタップしてON/OFFします。初期状態はOFFで、再読み込み後もOFFに戻ります。URLパラメータは不要で、旧 `?debug=1` を付けても初期状態はOFFです。

ON時はボタンが「DEBUG ON」となり、情報・ガイド・4つのTEST操作を表示します。OFFにすると即座に隠れます。START前・ゲーム中・遭遇演出中でも切替可能で、カメラ・センサー・遭遇状態・実行中アニメーションはリセットしません。START前のTEST操作は無効です。Version 0.2.0の遭遇確率・待機時間・角度判定・演出・逃走・再配置は変更していません。

既存のVersion・方位・角度差・速度・状態・左右・権限・Peripheralガイドに、Director state、current/previous encounter、次回待機、event elapsed time、PEEK level、PASS/FLY_BY direction、CLOSE_CALL activeを追加しました。

START後、センサー取得が始まったら画面下のTEST PEEK / TEST PASS / TEST FLY_BY / TEST CLOSE_CALLをタップできます。実行中は無効です。PEEKテストは現在方向の右40°に対象を置きます。右へゆっくり向いて3段階を確認し、最後に素早く向いてESCAPEを確認します。他3種類は即座に再生します。通常のカメラ・センサーを使用します。

reduced-motionでは装飾アニメーションと短時間演出のblurを削減し、必要な移動を維持します。描画要素は再利用し、終了・タブ非表示時にはアニメーションをキャンセルします。

実機ではPEEKの見える量、PASSの正体不明感、FLY_BYの背後から奥へ飛ぶ感覚、CLOSE_CALLの強さ、左右と振り向き反応、静かな時間の自然さを確認してください。恐怖の感じ方はiPhoneでの確認・調整が必要です。

## ファイルとテスト

- `index.html`: 画面とDEBUG／TEST操作
- `app.js`: カメラ・権限・方向センサー・旧状態遷移・描画
- `encounters.js`: 抽選・待機・重複防止・遭遇設定
- `logic.js`: 角度・左右・再配置計算（変更なし）
- `style.css`: iPhone UI・クリップ・reduced-motion
- `assets/entity-silhouette.svg`: 差し替え可能な素材
- `tests/logic.test.mjs`: 角度境界・速度・左右・再配置
- `tests/encounters.test.mjs`: Director遷移・重複抑制・2万回抽選
- `tests/app.test.mjs`: DOM整合・4遭遇・終了処理・権限拒否・nullセンサー

Node.js 20以降でこのフォルダから `npm test` を実行します。依存ライブラリのインストールは不要です。

## 未実装

0.3.0の距離・接近（FAR/MID/NEAR/DANGER）、0.4.0の音響、GAME OVER・クリア・HP・スコア・制限時間・ステージ・難易度は未実装です。WebXR・空間認識・撮影・録画・保存・オンラインAPI・PWAも追加していません。
