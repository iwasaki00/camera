# 振り返ればヤツガイル

**Version 0.5.0 — SURVIVE**

iPhoneの背面カメラと方向センサーによる疑似ARホラーです。相対Yawと仮想方位を使い、現実空間の認識は行いません。映像の保存・送信はありません。

## 起動

GitHub PagesなどのHTTPS環境で `013_something_behind_you/` をiPhone Safariから開き、縦持ちでSTARTをタップします。カメラとモーション・方向へのアクセスを許可し、測定後にゆっくり左右を見回してください。背面カメラを優先します。権限要求はSTART操作内で開始します。

実機にはHTTPSが必要です。権限拒否・非対応・HTTPS問題・センサー未取得は画面に案内します。方向データが途絶えると遭遇を停止します。タブを隠すと演出を片付け、復帰後に再び待機します。

## SURVIVE

`READY → STARTING → PLAYING → CLEAR / GAME_OVER` のGame Stateを、既存のEncounter・Presenceとは別に管理します。カメラ等の初期化後、最初の正常な方位でPLAYINGへ移ります。通常HUDは `SURVIVE 01:00` の残り時間だけで、距離・HPは表示しません。

`survival.js` の `SURVIVAL_CONFIG` に制限時間60秒、捕獲距離5、CLEAR演出350ms、GAME OVER演出800msを集約しています。生存時間はフレーム数ではなく経過ミリ秒を積算します。残り時間0でCLEAR、距離5以下でGAME_OVER。同じ更新で両方成立した場合は捕獲を優先します。自然終了とDEBUG強制終了は同じ終了処理を使用し、重複終了を防ぎます。

終了すると接近・遭遇・気配音・BAIT・アニメーションを停止します。CLEARは静かな暗転、GAME OVERは画面端の影と暗転のみで、大音量や新しい効果音はありません。結果はSURVIVED / CAUGHT、生存秒数、最終距離、最接近距離を表示します。演出中はRESTART・テスト・SET操作をロックします。

RESTARTはリロードせず、時間・距離85・最接近距離・相対Yaw・履歴・Director・BAIT・結果表示を初期化します。旧カメラを停止して再取得し、新しい正常方位を基準に開始します。AudioContextは再利用します。

タブ非表示、カメラ停止／ミュート、方向データ未取得／途絶、モーション権限拒否ではタイマーと接近を一時停止します。復帰後は新しい方向データを待ち、非表示中の時間を取り戻しません。権限拒否時の既存映像確認は維持しますが、生存時間は進めません。センサー／カメラ異常時は遭遇を片付け、再開待機の時刻も補正します。ゲーム用の新規intervalや描画ループは追加していません。

**バランス上の注意:** 0.4.0の初期距離85・接近速度・猶予を維持すると、見ないまま距離5に達する最短時間は約79.6秒です。通常の60秒ゲームでは自然な捕獲に到達しません。捕獲動作はDEBUGと自動テストで検証し、難度調整は実機確認後の課題として残しています。

## PRESENCE AUDIO

外部音源・API・マイクは使わず、Web Audioによる4種類の短い検証用合成音を使用します。正式素材へ差し替える場合は `audio.js` の合成処理だけを変更でき、方向・距離・抽選ロジックは `presence.js` に独立しています。

| 音 | 長さ | 音色・用途 |
|---|---|---|
| RUSTLE | 220ms | フィルター付きノイズ。短い衣擦れ・気配。 |
| FOOTSTEP | 180ms | 90→45Hzの低い三角波。一歩だけの軋み。 |
| TAP | 120ms | 340→170Hzの短い正弦波。小さな接触音。 |
| BREATH | 700ms | 650Hz中心のノイズ。言葉を含まない空気音。 |

Presence Directorは `IDLE → WAITING → PLAYING → COOLDOWN → WAITING`（停止時はIDLE）の独立した責務です。待機の25%で7秒の静寂を追加し、再生後は1.8〜3.5秒のクールダウンを入れます。同じ音は最大2回、BREATHは連続不可かつ最低12秒空けます。連続抑制後は残った重みで再抽選するため、実出現比率は下表と異なります。

| 距離 | RUSTLE | FOOTSTEP | TAP | BREATH | 基本待機 |
|---|---:|---:|---:|---:|---|
| FAR | 70 | 20 | 10 | 0 | 8〜18秒 |
| MID | 50 | 30 | 18 | 2 | 6〜14秒 |
| NEAR | 35 | 35 | 20 | 10 | 4〜10秒 |
| DANGER | 25 | 30 | 20 | 25 | 3〜8秒 |

音方位はentityYaw±15°。相対Yawとの差が35°以内ならFRONT、125°以上ならBEHIND、それ以外は符号でLEFT／RIGHTです。パンは `sin(angleDiff) × 0.7`（最大±0.7）。再生中に振り向くとパンを更新します。StereoPanner非対応ではモノラルへフォールバックします。本体スピーカーやモノラル出力では左右差が弱くなることがあります。

距離が近いほど連続的に音量を上げ、背後は音量を0.75倍・ローパスを1200Hzにします。前方等は距離に応じ2600〜4800Hz。音源ごとのフィルター・短いアタック／減衰エンベロープを通し、同時に1音だけ再生します。マスター初期55%、最大ゲイン設定0.12（初期マスターGainは0.066）。これらは `PRESENCE_CONFIG` に集約しています。実際の音圧は端末・イヤホン・OS音量によるため、安全な音圧を保証する値ではありません。必ず低い端末音量から確認してください。

LOOKING中は待機完了時の35%だけ発音候補にし、残りは新しい待機へ送ります。PASS／FLY_BY／CLOSE_CALLの実行中は新しいPresenceを開始せず、音を溜めません。PEEKとの重複は許可します。方向センサー・カメラ・モーションが利用できない場合は通常Presenceも停止します。

### 音 → PEEKの誘導

entityが46°より外側にいる状態で発音に成功した場合、30%をBAITにします。有効時間3.2秒、最初の250msはPEEKを出しません。有効時間内に音方位とentity方位の両方から46°以内へ振り向き、映像DirectorがIDLEまたは未選択のARMINGならPEEKを準備します。entityYaw自体は変更しません。映像実行中・クールダウンは割り込まず、PEEKの3連続も禁止し、消費は1回だけです。再配置・SOUND OFF・停止・非表示でBAITを破棄します。音を無視しても追加ペナルティはありません。非BAIT音はPEEKを強制せず、通常Encounter抽選とは独立です。

### SOUNDと復帰

通常画面のSOUNDでON/OFFします。初期設定ONですが、ロード時はAudioContextを作りません。STARTタップの同期処理で初期化／resumeを開始します。START前にOFFへ切り替えると無音で開始できます。suspended／interrupted等の場合はSOUND RETRYをタップして復帰します。非対応ブラウザはNO AUDIOを表示し、映像ゲームを維持します。

SOUND OFF・非表示・カメラ停止・再START・pagehideで音源をstopして全音声ノードを切断します。Contextは再利用し、Presence用タイマー／intervalは追加していません。復帰時は新しい方向データを待ち、新規WAITINGから再開します。溜まった音をまとめて鳴らしません。

## Encounter Director

`encounters.js` のDirectorが `IDLE → ARMING → EVENT → COOLDOWN → IDLE` を管理します。ARMINGでランダム待機して種類を抽選し、PEEKは対象方位へ近づくまで待ちます。他3種類はすぐ再生します。終了時に描画を片付け、現在方向から78°以上離して再配置します。1件ずつ実行し、実行中の抽選と強制テストを禁止します。新規タイマーを作らず、requestAnimationFrameで終了時刻を確認します。

抽選重み・次回待機時間は距離段階で切り替わります。同一種類は最大2回連続、CLOSE_CALLは連続不可です。除外後は残った重みで再抽選するため、実際の出現比率は少し変わります。

## STALKERの距離

距離は1本だけで初期85、最小5、最大100です。`abs(angleDiff) <= 35°` をLOOKINGとし、接近を停止します。見るだけで距離は回復しません。NOT_LOOKINGが連続1.2秒続いてから、経過秒数に応じて距離を減らします。LOOKINGに戻ると猶予時間をリセットします。

| 段階 | 距離 | 接近速度 / 秒（10減る目安） | PEEK / PASS / FLY_BY / CLOSE_CALL | 次回待機 |
|---|---|---|---|---|
| FAR | 75〜100 | 0.67（14.9秒） | 65 / 25 / 8 / 2 | 5〜13秒 |
| MID | 45以上75未満 | 0.87（11.5秒） | 50 / 30 / 15 / 5 | 4〜10秒 |
| NEAR | 20以上45未満 | 1.25（8秒） | 40 / 30 / 20 / 10 | 3〜8秒 |
| DANGER | 5以上20未満 | 1.67（6秒） | 30 / 25 / 25 / 20 | 2.5〜6秒 |

速度の目安は同じ段階内での値です。境界を越えた時点から次段階の速度になります。PLAYING中に距離5へ到達するとGAME OVERです。

実際の発見判定でPEEKがSPOTTED→ESCAPEへ移ったときだけ距離を15増加させます（最大100）。PEEKの時間切れ逃走、見失い、視界待ち終了、PASS／FLY_BY／CLOSE_CALLでは回復しません。RELOCATEは距離を保持し、STARTし直すと85へ戻ります。

START前、カメラ失敗・停止、モーション権限拒否・非対応、方向データ未取得・途絶、タブ非表示、pagehideでは接近を停止します。非表示時は猶予もリセットし、復帰後は新しい方向データを待ちます。1フレームの距離計算は最大100msで、バックグラウンド経過分の追いつき処理はしません。

PEEKの最大表示量での画面外押し出し基準はFAR85%／MID70%／NEAR55%／DANGER42%。角度別の3段階表示を加算し、近い段階ほど大きく・深く画面端へ侵入します。他3演出も段階別サイズ倍率を使い、時間・方向・部分クリップは維持します。演出開始時の段階を保持するため、実行中のDEBUG距離変更は現在のアニメーションを壊しません。

| 遭遇 | 発生条件・表示時間・表示方法 |
|---|---|
| PEEK | 抽選後、角度差46°以内で画面端へ出現。36°・24°を境に3段階で表示量を増加。素早く向くとSPOTTED→ESCAPE。最大6.5秒で逃走し、16秒視界に入らなければ終了。 |
| PASS | 280ms。細長い影の断片が画面端を高速で斜め上へ横切り、画面外へ抜ける。 |
| FLY_BY | 340ms。手前の大きな影が斜め奥へ縮小しながら飛び去る。 |
| CLOSE_CALL | 160ms。巨大な頭部断片だけが端に入り、即座に外へ抜ける。 |

## 設定値

距離・段階別速度／重み／間隔／サイズ倍率は `stalker.js` の `STALKER_CONFIG`、遭遇共通設定は `encounters.js` の `ENCOUNTER_CONFIG`、既存角度・センサー設定は `app.js` の `CONFIG` に集約しています。

| 設定 | 初期値 |
|---|---|
| weights / minEncounterDelay / maxEncounterDelay | 上記の距離段階別設定を使用 |
| cooldownMin / cooldownMax | 1800 / 4200ms |
| quietChance / quietExtraDelay | 20% / 8000ms追加 |
| consecutiveLimit | 2（CLOSE_CALLは連続不可） |
| peekMaxDuration / peekArmingTimeout | 6500 / 16000ms |
| peekThresholds | 36° / 24° |
| peekSizes | 0.96 / 1.00 / 1.04倍 |
| peekTranslations | 91 / 79 / 67%の差分を段階別押し出し基準に加算 |
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

ON時はボタンが「DEBUG ON」となり、STATUS、Game Test／Encounter Test／Distance Test／Audio Test／Direction Testを表示します。OFFにすると即座に隠れます。START前・ゲーム中・遭遇演出中でも切替可能で、カメラ・センサー・距離・遭遇状態・実行中アニメーション・音はリセットしません。START前のGame／Encounter／Audio Testは無効です。

Game STATUSはGame State、残り時間、生存時間、最接近距離、捕獲閾値、一時停止状態を表示します。TEST CLEAR／TEST GAME OVERはPLAYING時のみ有効です。終了後は各テストと距離SETを無効にします。任意項目の10秒モードは追加していません。

Audio TestはTEST RUSTLE／FOOTSTEP／TAP／BREATHを現在のentity方位・距離で鳴らします。検証用なのでTEST BREATHはFARでも可能です（通常抽選はFARで0）。Direction TestはRUSTLEをLEFT -90°／RIGHT +90°／BEHIND 180°／FRONT 0°で鳴らし、entityYawやBAITを変更しません。音再生中や強い映像実行中は音テストを無効にします。操作欄は縦スクロールで下のグループへ移動できます。

Presence STATUSにはenabled、AudioContext状態、現在／前回の音、Director状態、方向、pan、推定出力Gain、次回待機、BAITと残り時間を表示します。推定出力Gainは音圧や実際の波形ピークの測定値ではありません。

Distance TestのSET FAR 85／SET MID 60／SET NEAR 35／SET DANGER 10はDEBUG ON時だけ操作できます。距離・段階・重み・次回待機範囲を即時更新します。待機中なら次回時刻を新しい範囲で再設定し、実行中・クールダウン中の演出や時刻は保持します。START前にも距離設定を確認できますが、STARTでは85へリセットします。

距離DEBUGにはDISTANCE、RANGE、LOOKING／NOT_LOOKING／PAUSED、連続NOT_LOOKING秒数、猶予中か、現在の接近速度、次境界、抽選重み、待機範囲を表示します。情報欄と操作欄は高さを制限して縦スクロールでき、狭い画面でも横にあふれない2列ボタン配置です。

既存のVersion・方位・角度差・速度・状態・左右・権限・Peripheralガイドに、Director state、current/previous encounter、次回待機、event elapsed time、PEEK level、PASS/FLY_BY direction、CLOSE_CALL activeを追加しました。

START後、センサー取得が始まったら画面下のTEST PEEK / TEST PASS / TEST FLY_BY / TEST CLOSE_CALLをタップできます。実行中は無効です。PEEKテストは現在方向の右40°に対象を置きます。右へゆっくり向いて3段階を確認し、最後に素早く向いてESCAPEを確認します。他3種類は即座に再生します。通常のカメラ・センサーを使用します。

reduced-motionでは装飾アニメーションと短時間演出のblurを削減し、必要な移動を維持します。描画要素は再利用し、終了・タブ非表示時にはアニメーションをキャンセルします。

実機ではPEEKの見える量、PASSの正体不明感、FLY_BYの背後から奥へ飛ぶ感覚、CLOSE_CALLの強さ、左右と振り向き反応、静かな時間の自然さを確認してください。恐怖の感じ方はiPhoneでの確認・調整が必要です。

## ファイルとテスト

- `index.html`: 画面とDEBUG／TEST操作
- `app.js`: カメラ・権限・方向センサー・旧状態遷移・描画
- `encounters.js`: 抽選・待機・重複防止・遭遇設定
- `stalker.js`: 単一距離・接近・猶予・段階別プロファイル
- `survival.js`: Game State・実時間タイマー・最接近距離・勝敗判定
- `presence.js`: 音の段階別設定・抽選・方向・短命BAIT
- `audio.js`: ユーザー操作起点のContext・合成音・パン／フィルター・音声cleanup
- `logic.js`: 角度・左右・再配置計算（変更なし）
- `style.css`: iPhone UI・クリップ・reduced-motion
- `assets/entity-silhouette.svg`: 差し替え可能な素材
- `tests/logic.test.mjs`: 角度境界・速度・左右・再配置
- `tests/encounters.test.mjs`: Director遷移・重複抑制・2万回抽選
- `tests/stalker.test.mjs`: 境界・35°判定・猶予・速度・フレームレート非依存・上下限・停止・回復
- `tests/survival.test.mjs`: 初期化・タイマー・一時停止・勝敗競合・最接近距離・重複終了・再開始
- `tests/presence.test.mjs`: 4万回抽選・段階別設定・静寂・方向・パン・BAIT期限・停止
- `tests/audio.test.mjs`: AudioContext初期化・4音・有限終了・ゲイン・パン・停止・復帰・フォールバック
- `tests/fake-audio.mjs`: 自動テスト用Web Audioスタブ
- `tests/audio-browser.html`: カメラ不要の実ブラウザ音声スモークテスト（4音の出力と自然終了）
- `tests/app.test.mjs`: DOM整合・4遭遇・権限拒否・nullセンサー・距離設定・発見回復・非表示復帰・自然／強制勝敗・終了後停止・RESTART連打・Context再利用・カメラ異常

Node.js 20以降でこのフォルダから `npm test` を実行します。依存ライブラリのインストールは不要です。

実機は低い音量でSTART→DEBUG ON→SET FAR／DANGER→各Audio Testを比較し、Direction Testで左右・背後を確認してください。通常プレイでは音へ振り向いたときのPEEK／空振りの自然さ、DANGERの静寂、タブ切替やSOUND OFFで確実に無音になるかも確認します。合成音の質感・前後定位・Safariの実機復帰は実機調整が必要です。

## 未実装

正式な録音音源・音量スライダー・本格3D音響／独自HRTF・台詞・マイク入力・振動・HP・スコア・ランキング・アイテム・ステージ・難易度選択は未実装です。WebXR・空間認識・撮影・録画・保存・オンラインAPI・PWAも追加していません。
