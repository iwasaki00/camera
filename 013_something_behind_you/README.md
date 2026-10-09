# 振り返ればヤツガイル

**Version 1.0.0 — PRESENCE EXPERIENCE**

「カメラ越しに、何かが見えるかもしれない。」

iPhoneの背面カメラ越しに周囲を見回す、疑似AR怪奇現象体験アプリです。何もいない時間、ときどき聞こえる物音、視界端の影を楽しむ作品です。制限時間・勝敗・クリア・ゲームオーバー・スコアはありません。実空間の認識、映像の保存・送信、マイク入力もありません。

## 対応環境・権限

iPhone Safari、HTTPS、縦持ちを推奨します。GitHub Pages等で `013_something_behind_you/` を開き、STARTをタップしてください。背面カメラを優先し、カメラとモーション・方向へのアクセスをSTART操作内で要求します。権限拒否・非対応・HTTPS問題・方向センサー未取得は画面で案内します。

権限確認後、新しい正常方位を基準にゆっくり左右を見回します。方向センサー未取得時は演出を待機します。モーション権限拒否時は既存の映像確認ができますが、距離の自動変化と通常Presenceは停止します。safe-area、タップ操作、長押し選択抑制、ダブルタップ拡大抑制、ページスクロール防止を維持しています。

## START / STOP

状態は `READY → STARTING → RUNNING → STOPPED`。STOPPEDからSTARTで再開できます。RUNNINGは時間制限なく継続します。START連打は無視し、STOPは初期化中にも利用できます。

STOPでカメラトラックと映像を停止し、方向センサーのリスナーを解除します。Encounter、Presence、音源、BAIT、アニメーション、センサー待機タイマーを片付け、START画面へ戻ります。遅れて返るカメラ取得結果は、その古いストリームだけを停止します。

再STARTは距離85、Yaw、各Directorの履歴を初期化してカメラを再取得します。AudioContextは再利用します。通常画面はカメラ・演出・STOP・SOUND・DEBUGだけです。内部情報はDEBUG内だけに表示します。

タブ非表示時は音と演出を停止します。復帰時は新しい方向データを待ち、古いイベントをまとめて発生させません。カメラ停止／ミュート、方向データ途絶時も演出を待機します。distanceの循環時間は有効フレームだけ積算し、バックグラウンド分を追いつき処理しません。pagehideはSTOPと共通の後処理です。既存の単一requestAnimationFrameを再利用し、循環用intervalは追加していません。

## 4種類の映像演出

| Encounter | 演出 |
|---|---|
| PEEK | 端から部分的に覗く。46°以内で出現、36°・24°で侵入量が変化。素早く向くとSPOTTED→ESCAPE、180msで画面外へ逃走。最大6.5秒、視界待ち上限16秒。 |
| PASS | 280ms。影の断片が端を高速で横切る。 |
| FLY_BY | 340ms。手前の影が奥へ縮小しながら飛び去る。 |
| CLOSE_CALL | 160ms。巨大な頭部の断片が端へ一瞬現れる。 |

部分クリップ、左右・奥行き・縮小・逃走を維持し、全身を見せ続ける演出は追加していません。Encounter DirectorはIDLE→ARMING→EVENT→COOLDOWNを1件ずつ管理します。同種は最大2連続、CLOSE_CALLは連続不可。再配置は現在方向から78°以上離します。

initialYawは最初の正常方位、relativeYawは開始からの最短符号付き角度差、entityYawは仮想方位です。angleDiffはentityYaw−relativeYawを−180°〜180°へ正規化し、正は右、負は左。359°↔0°も最短差を使います。PEEK発見条件は15°以内・回転速度46°/s以上・接近速度14°/s以上です。

## distance：内部演出値

初期85、下限5、上限100。サイズ、視界端への侵入量、音量・音色、映像・音の抽選傾向を決めます。通常画面には表示せず、罰や勝敗判定には使用しません。

| 段階 | 距離 | 接近速度/秒 | 映像待機 | 音待機 |
|---|---|---|---|---|
| FAR | 75〜100 | 0.67 | 12〜24秒 | 12〜26秒 |
| MID | 45以上75未満 | 0.87 | 10〜20秒 | 10〜22秒 |
| NEAR | 20以上45未満 | 1.25 | 8〜16秒 | 8〜18秒 |
| DANGER | 5以上20未満 | 1.67 | 8〜14秒 | 8〜16秒 |

- 35°以内のLOOKING中は接近しません。見ていない状態が1.2秒続くと少しずつ近づきます。
- PEEKが逃走すると距離を15増やします（上限100）。発見だけでなく時間切れ逃走も対象です。
- 有効な体験時間25〜45秒ごとに35／60／85から、現在値と10より大きく異なる候補へ自然変化します。固定周期ではありません。
- DANGERが8秒続いたら80〜95へ戻ります。LOOKING中にも離脱は有効です。
- CLOSE_CALL終了時は70%で80〜95へ戻ります。他の演出は再配置のみです。

循環は各Directorとは独立です。段階変更時、未選択のEncounter待機を新しい範囲へ更新します。実行中の映像は開始時の段階・サイズを維持します。

静寂のため映像はクールダウン3〜7秒に上表の待機を加え、35%で12秒の静寂を追加します。音は40%で10秒を追加します。PEEKの視界待ちやLOOKING中の音抑制もあり、毎回必ず現象が起こるわけではありません。STALKER_CONFIG／ENCOUNTER_CONFIG／PRESENCE_CONFIGで調整可能です。

## 4種類の音とSOUND

外部音源・APIを使わず、既存Web Audio合成音を使います。

| Presence | 長さ | 音 |
|---|---|---|
| RUSTLE | 220ms | 衣擦れのようなノイズ |
| FOOTSTEP | 180ms | 低い一歩の軋み |
| TAP | 120ms | 小さな接触音 |
| BREATH | 700ms | 言葉を含まない空気音 |

音方位はentityYaw±15°、パンはsin(angleDiff)×0.7。振り向くと更新します。35°以内はFRONT、125°以上はBEHIND、それ以外はLEFT／RIGHT。近いほど音量を増やし、背後は音量0.75倍・ローパス1200Hz、その他は2600〜4800Hz。StereoPanner非対応はモノラルになります。

同時に1音だけ再生。同種は最大2連続、BREATHは連続不可・最低12秒空けます。LOOKING時は候補の35%だけ発音し、強い映像実行中は新しい音を開始しません。クールダウンは1.8〜3.5秒です。

視界外の音の30%がBAITとなり、音方位へ振り向くとPEEKを誘導することがあります。有効3.2秒、最初の250msは誘導せず1回だけ消費します。映像実行中やクールダウンへの割り込み、3連続PEEKは禁止。非BAIT音は映像を強制しないため「音はしたが何もいない」体験も残ります。再配置・STOP・非表示・SOUND OFFでBAITを破棄します。

SOUNDは初期ON。ロード時にContextを作らず、STARTタップ内で初期化／resumeします。START前のOFFで無音開始できます。Context中断時はSOUND RETRYをタップします。非対応はNO AUDIOで映像を維持します。

マスター初期55%、最大Gain設定0.12（初期マスターGain 0.066）は従来値です。音圧は端末・イヤホン・OS音量で異なり、安全性を保証する値ではありません。必ず低い端末音量から確認してください。停止時は音源をstopしてノードを切断します。

## DEBUG

右上DEBUGでON/OFF。初期OFF、URLパラメータ不要。切替は演出をリセットしません。情報・操作欄は高さ制限と縦スクロールを備えた2列構成です。

- Encounter Test：TEST PEEK／PASS／FLY_BY／CLOSE_CALL。
- Distance Test：SET FAR 85／MID 60／NEAR 35／DANGER 10。
- Audio Test：TEST RUSTLE／FOOTSTEP／TAP／BREATH。
- Direction Test：SOUND LEFT／RIGHT／BEHIND／FRONT。
- STATUS：アプリ状態、方位、角度、権限、距離・循環・DANGER継続時間、各Director、音・pan・Gain・BAIT。Gainは音圧測定値ではありません。

映像／音テストはRUNNING・正常方位取得後に使えます。実行中の重複を防ぎます。SETはSTARTING中以外で使えますが、STARTで85へ初期化します。勝敗テスト・残り時間・生存時間・結果情報はありません。

## ファイルとテスト

- app.js：カメラ・権限・センサー・START/STOP・描画と連携。
- stalker.js：内部距離・循環・段階別プロファイル。
- encounters.js／presence.js：既存映像／音Director。
- audio.js／logic.js：合成音・cleanup／共通角度計算。
- index.html／style.css／assets/entity-silhouette.svg：UI・素材。
- tests/logic.test.mjs／encounters.test.mjs／stalker.test.mjs／presence.test.mjs／audio.test.mjs：共通ロジック回帰テスト。
- tests/app.test.mjs：4映像、4音、BAITと空振り、START/STOP30回、音声後処理、カメラ競合、センサー・タイマー・DOM増殖防止、非表示停止。
- tests/experience.test.mjs：2時間模擬運転、距離上下限・循環・DANGER離脱、Encounter／Presence継続。
- tests/audio-browser.html：カメラ不要の実ブラウザ音声テスト。

Node.js 20以降、依存追加なし。このフォルダで `npm test`（ルートから `npm test --prefix 013_something_behind_you`）。ゲーム専用survival.jsとテストは撤去し、距離・角度・Audioの共通処理とテストを再利用しています。

## iPhone実機確認

1. HTTPSで縦持ち・低い音量でSTART。権限を許可し、左右を見回す。
2. DEBUG ONで各映像テスト。PEEKは右へゆっくり向いて表示量を確認し、最後に素早く向いて逃走を確認。
3. 各音・方向テストでパン・背後の音色・距離音量を確認。イヤホンとスピーカーで比較。
4. SET DANGER後、有効8秒で遠距離へ戻ること、数分の体験で静寂と不規則な現象が続くことを確認。
5. STOP直後のカメラ停止・無音、再STARTの方位初期化、START/STOP連打、権限確認中STOPを確認。
6. Safariタブ切替・画面ロックと復帰で残留音や古いイベントのまとめ再生がないことを確認。
7. 320×568／390×844相当でSTART・STOP・SOUND・DEBUGが隠れず、横スクロールしないことを確認。

自動テストは実カメラ・センサー・Safari固有の権限と音響を再現しません。定位、表示量、恐怖の強さ、長時間の発熱・電池消費はiPhone実機で確認・調整が必要です。

## 追加しないもの

HP・スコア・ランキング・ミッション・アイテム・ステージ・難易度選択、撮影・録画、WebXR・空間認識、マイク・音声認識・AI連携、新キャラクター・新映像イベント・新音イベントはありません。既存4映像・4音と静寂による体験です。
