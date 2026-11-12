# Version 0.8.0 — SHORT VIDEO CREATOR

ローカルv0.7.1を基点に、録画専用の画角・タイトル・演出とカウントダウンを追加。3タブ、既存の編集座標・ズーム・パン・合成処理・PNGは維持。公開、commit、pushは未実施。

## 実装

- `recording-output.js`：出力用設定の正規化、FIT／FILL、切り取り中心、タイトル期間判定・改行・縮小、映像フェード。タイトルレイアウトは最大8件キャッシュし、毎フレームの再計算を避ける。
- `recording.js`：録画資源・マイク・MediaRecorder生成後にCOUNTDOWNへ移行。単調時計で3秒を測定し、終了後に実際の`MediaRecorder.start()`を呼ぶ。従来どおりこの呼出し時点から録画経過時間を測る。カウント中の多重開始を防ぎ、キャンセル・トラック消失・カメラ停止時は資源を解放して既存結果を保持。
- 合成済みCanvasから録画専用Canvasへ一度転送し、出力用の変換・文字・フェードを適用。顔検出・パーツ色補正の二重実行なし。録画用Canvasとバッファを継続利用し、サイズは開始時に確定。
- 元画像比率：従来の長辺720px／24fps、低負荷480px／15fps。9:16：360×640／24fps、低負荷270×480／15fps。いずれも偶数画素。15／30／60秒、音声ON/OFF、MP4優先／WebMフォールバックを維持。
- FITは全画像＋暗い単色余白、FILLは縦横比を維持して覆い、余剰部分のX／Y位置を0〜100%で調整。編集データには作用しない。
- タイトルは空欄／表示なしが初期値。冒頭2秒・全編・指定時間の最後2秒。一般テキストとしてCanvasへ描画し、HTMLにはしない。160文字以内。背景帯、左右8%と下端10%の余白、改行・縮小を利用。極端に小さい元画像比率では最低文字サイズを優先し、省略が生じる場合がある。
- フェードは初期OFF。指定時間内の映像だけを約0.4秒でフェード。手動停止時に終端を追加せず、音声波形は加工しない。
- `recording-ui.js`：D.録画設定へ一時設定と出力プレビューを収納。プレビューは録画と同じ関数を使い、開いている時だけ最大5Hz。確認時点を動かしてタイトル／フェードを確認。カウントの数字はDOM上にのみ表示し、録画に混入しない。
- カウント中のタブ切替は継続。画面非表示／ページ離脱／カメラ停止はカウントをキャンセル。録画中の停止処理は従来の最終dataavailable→stop完了を待つ方式と未保存動画保護を維持。
- 画角・タイトル・演出・カウント設定はページ内の一時設定。IndexedDB／ZIPスキーマ3には追加せず、既存テンプレートとの互換性を維持。カメラ映像や音声はサーバーへ送信しない。

## テスト結果

結果と性能表は本ファイル末尾の実行結果を参照。モックによる単体テストと、ネイティブMediaRecorder／実Face Landmarkerを使うテストを区別する。

実動画は `reports/v0.8.0-*.mp4` と `.webm`、解析結果は `v0.8.0-{chrome,edge}-short-video.json`、`v0.8.0-chrome-recording.json`、`v0.8.0-performance.json`。各動画をffprobeで解析し、ffmpegで復号して画素・フレーム数・映像の変化を検証。ブラウザでの実再生も確認。FILLの左右端は中央のライブ口が画角外になるため、その2例の静止表示は意図した結果。

音声ONの実ファイルは音声トラックを検証。既存録画テストではAAC音声、RMS、開始時刻差・音声映像の長さ差も確認。自動音源によるPCテストであり、人間の発話やiPhoneの同期品質は未検証。

今回の実時間の自動停止は15秒で確認。30／60秒の自動停止は単体テストで確認し、v0.8.0での30／60秒の実録画は再実施していない。

## iPhone Safariでの確認手順（未実施）

1. 公開した場合は上部・フッターのv0.8.0を確認。HTTPSで画像を読み込み、カメラを開始する。
2. 「調整」→「D.録画設定」で15秒・マイクOFF・9:16・FITを選択。出力プレビューで元画像全体と余白を確認。X/Yを変えてもFITの見た目が変わらず、FILLでは範囲が変わることを確認。
3. 日本語の短いタイトル／160文字程度の長文を入力し、冒頭・全編・最後を切替。確認時点を動かし、文字が枠外へ出ないことを確認。フェードの0秒・0.2秒・0.4秒・終了直前も確認。
4. カウントONで録画し、3・2・1の後に経過時間が進むことを確認。数字や編集枠が動画に映らないことを確認。カウントのキャンセル、タブ切替、カメラ停止、ホーム画面へ戻った場合も試す。
5. 録画を再生し、縦長で歪みがないこと、15秒前後で終わること、FIT／FILL／切り取り位置がプレビューと一致することを確認。
6. マイクONでは許可後にカウントが始まることを確認。拍手または口の動きと同時に短い音を出し、再生時に同期を観察。音声が聞こえることとマイク使用表示が停止後に消えることを確認。
7. 保存リンクからMP4またはWebMをファイルに保存し、保存先の動画を再生。ファイル共有が可能なら共有も試す。共有キャンセル後も動画が残ることを確認。「写真」への直接保存は保証しない。
8. NATURAL＋自動追従＋9:16で録画し、追従・発話・まばたき・音声同期・温度／バッテリーを確認。低負荷設定との比較と30／60秒録画も実施。
9. 「E.詳細・診断・ヘルプ」→診断でログをコピー。端末型番、iOS、Safari、Version、録画時間／画質／比率／画角、音声・タイトル・フェード、停止理由、保存／再生の結果を記録。映像・音声・顔画像をログへ添付する必要はない。

## 制限と次期候補

- Windows WebKitではMediaRecorder／captureStreamが利用できず、実録画はChrome／Edgeで検証。WebKit描画・UI成功をiPhone Safari実機成功とは扱わない。
- MP4／WebMの可用性、文字のフォント、共有先・OS保存操作、発話同期、画面ロック・通話割込みからの復帰は環境依存。
- 途中停止では指定終了時刻向けのタイトル・フェードを後付けしない。音声はフェードしない。ブラウザの停止時刻・動画コンテナ時間には小さな差が生じる。
- 録画結果は一時Blob。OSやSafariの強制終了後の復元は保証せず、自動永続保存は追加しない。
- iPhone性能・熱・長時間動作は未計測。PCの単一環境・短時間の比較で性能を保証しない。
- v0.8.1候補：iPhone実測に基づくショート動画の録画・共有調整。高画質化は実機負荷を確認してから検討。

## 変更ファイル一覧

- `README.md`
- `app.js`
- `composite-ui.js`
- `diagnostics.js`
- `docs/SHORT_VIDEO_CREATOR_v0.8.0.md`
- `editor.js`
- `index.html`
- `magnifier.js`
- `package.json`
- `parts.js`
- `recording-output.js`
- `recording-ui.js`
- `recording.js`
- `renderer.js`
- `screen-ui.js`
- `style.css`
- `template-images.js`
- `template-schema.js`
- `template-store.js`
- `template-ui.js`
- `template-zip.js`
- `tests/browser-check.mjs`
- `tests/diagnostic-check.mjs`
- `tests/recording-check.mjs`
- `tests/recording-output.test.mjs`
- `tests/recording.test.mjs`
- `tests/screens-check.mjs`
- `tests/short-performance.mjs`
- `tests/short-video-check.mjs`
- `tests/template.test.mjs`
- `tests/tracking-check.mjs`
- `tests/webkit-picker.mjs`
- `tests/webkit-short.mjs`
- `tracking-geometry.js`
- `tracking-worker.js`
- `tracking.js`
- `viewport.js`

このほか、検証用の動画・解析JSON・スクリーンショットを `reports/v0.8.0-*` に作成。複数モジュールはキャッシュ識別子の更新のみ。スキーマVersionは3のまま。

## 実行結果（2026-11-13 JST）

| 実行 | 件数 | 結果 |
|---|---:|---|
| `node --test tests/*.test.mjs`（モック含む） | 208 | PASS / FAIL 0 |
| Chrome 既存関連ブラウザテスト | 48グループ | PASS |
| Chrome 3タブ・直接編集・録画中切替 | 16グループ | PASS |
| Chrome 既存実録画・失敗復帰・保存保護 | 11グループ、動画8本 | PASS |
| Chrome ショート動画 | 12グループ、動画6本 | PASS |
| Edge ショート動画 | 12グループ、動画6本 | PASS |
| Chrome 画像／ZIP実クリック | 13グループ | PASS |
| WebKit ショート動画用Canvas・UI | 4グループ | PASS |
| WebKit 3タブ・タッチ | 6グループ | PASS |
| WebKit 録画非対応の案内 | 1グループ | PASS（実録画不可） |
| 実Face Landmarker Worker／代替方式と性能比較 | 14関連グループ＋7条件 | PASS |

ブラウザは計137グループPASS（独立した上記コマンドの合算、実モデル再確認分を含む）。性能比較ではさらに5本の実動画を生成・解析。ファイル解析は計25本（Chrome14、Edge6、性能比較5）で、3タブ検証でも別途3録画を再生・比較。ネイティブMediaRecorder／captureStreamを使用し、映像入力は動く合成テスト映像・音声はブラウザのテスト音源。実カメラ・実マイク・iPhoneではない。

### PC同条件の性能比較

Desktop Chrome, actual local Face Landmarker Worker; same 640x480 NASA face translated +/-8px at 10Hz, camera30fps, four parts, background400x600, diagnostics ON, output preview closed, seven sequential 5.5s samples after 1s settling. Encoded fps = decoded video frame count / file duration. Not iPhone results.

| 条件 | 描画fps | 検出/秒 | 合成平均ms | 転送平均ms | 実動画fps | 時間s | ファイルKiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| ORIGINAL・録画OFF | 29.8 | 8.9 | 1.0 | — | — | — | — |
| 元画像比率・ORIGINAL | 30.0 | 9.4 | 1.2 | 0.07 | 24.2 | 6.65 | 265.4 |
| 9:16 FIT・ORIGINAL | 30.0 | 10.0 | 0.9 | 0.06 | 24.2 | 6.64 | 248.4 |
| 9:16 FILL・ORIGINAL | 30.0 | 9.6 | 1.3 | 0.08 | 24.2 | 6.65 | 269.1 |
| 9:16＋タイトル | 30.0 | 9.8 | 1.2 | 0.23 | 24.3 | 6.59 | 273.5 |
| NATURAL・録画OFF | 30.0 | 9.4 | 11.9 | — | — | — | — |
| 9:16＋NATURAL＋追従 | 30.0 | 7.1 | 13.3 | 0.06 | 24.2 | 6.64 | 215.4 |

測定中は他のブラウザ試験を並行せず、出力プレビューは閉じた状態。描画・検出は5.5秒間の実カウント、合成は診断の直近5秒、転送は当該録画全体の平均、実動画fpsは復号フレーム数÷ファイル時間。24fpsを少し超える値は始端／終端フレームと短い計測時間によるもの。NATURALの推論頻度差には既存の適応負荷制御・時系列の変動も含む。順次1回のPC比較で、iPhone性能や統計的な改善は保証しない。

### スクロールと操作領域

375px／390px × 844pxの絵画画面で、v0.7.1と同じページ高877px、スクロール可能量33px、主要録画ボタン44pxを維持。3タブ試験で横画面・低い画面・PC幅、編集座標、ズーム・パン、拡大鏡の復帰もPASS。新項目は内部スクロールするD.録画設定に収納し、メイン画面には常時展開しない。
