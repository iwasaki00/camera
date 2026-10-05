# v0.5.2 OCR Accuracy Tuning Results

測定日: 2026-10-05  
環境: Windows / Chrome / Tesseract.js 5 / 英語数字 whitelist `123456789`

正解JSONは結果評価だけに使用し、OCR入力、空欄判定、数字判定には使用していない。

## BASELINE

sample-01、既存CURRENT、PSM SINGLE_CHAR、240px、Crop 20%、Paddingなし、空欄事前判定なし。

| Digit | Blank | Overall | Time |
|---:|---:|---:|---:|
| 27/30 (90.0%) | 51/51 (100.0%) | 78/81 (96.3%) | 32.1s |

同じv0.5.1条件の以前の実行では30/30だったため、Tesseractの実行間変動も確認された。

## Experiment A: Preprocess

| Sample | RAW | CURRENT | GRAYSCALE | CONTRAST |
|---|---:|---:|---:|---:|
| 01 | 26/30 | 27/30 | 26/30 | 26/30 |
| 02 | 26/30 | 30/30 | 26/30 | 30/30 |

## Experiment B: PSM

各サンプルのExperiment A最良前処理を固定。

| Sample | SINGLE_CHAR | SINGLE_WORD | SINGLE_BLOCK |
|---|---:|---:|---:|
| 01 / CURRENT | 27/30 | 30/30 | 27/30 |
| 02 / CONTRAST | 30/30 | 30/30 | 30/30 |

## Experiment C: OCR input size

| Sample | 120 | 180 | 240 | 320 | 480 |
|---|---:|---:|---:|---:|---:|
| 01 / CURRENT + WORD | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |
| 02 / CONTRAST + BLOCK | 30/30 | 30/30 | 30/30 | 25/30 | 20/30 |

## Experiment D: Outer crop

| Sample | 10% | 15% | 20% | 25% | 30% |
|---|---:|---:|---:|---:|---:|
| 01 | 30/30 | 30/30 | 30/30 | 22/30 | 13/30 |
| 02 | 30/30 | 30/30 | 30/30 | 30/30 | 15/30 |

25～30%は数字欠けが増えるため不採用。15%を共通候補とした。

## Experiment E: Threshold

| Sample | 二値化なし | Fixed 150 | Fixed 180 | Mean | Otsu |
|---|---:|---:|---:|---:|---:|
| 01 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |
| 02 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |

撮影条件の明るさ変化へ固定値より追従しやすいOtsuを候補とした。

## Experiment F: White padding

| Sample | 0% | 12.5% | 25% |
|---|---:|---:|---:|
| 01 | 30/30 | 30/30 | 15/30 |
| 02 | 30/30 | 30/30 | 30/30 |

25%はsample-01で数字が小さくなりすぎた。12.5%を採用。

## Experiment G: Conservative blank detection

暗画素率0.3%未満だけを明白な空欄としてTesseract処理から除外。

| Sample | OFF | ON | Digit false negative |
|---|---:|---:|---:|
| 01 | 14.8s | 9.1s | 0 |
| 02 | 54.0s | 30.0s | 0 |

両サンプルともAccuracyはDigit 100%、Blank 100%、Overall 100%を維持した。

## FINAL CANDIDATE cross-validation

- Preprocess: grayscale + contrast 1.35 + Otsu binary
- PSM: SINGLE_WORD
- OCR size: 240px
- Outer crop: 15%
- Padding: 12.5% white margin
- Blank detection: grayscale < 160の暗画素率が0.3%未満なら空欄

| Sample | Digit | Blank | Overall | Time |
|---|---:|---:|---:|---:|
| sample-01 | 30/30 (100.0%) | 51/51 (100.0%) | 81/81 (100.0%) | 3.8s |
| sample-02 | 30/30 (100.0%) | 51/51 (100.0%) | 81/81 (100.0%) | 8.7s |

平均Digit Accuracy: **100.0%**

## Normal OCR regression after adoption

| Sample | Digit | Blank | Overall | Time |
|---|---:|---:|---:|---:|
| sample-01 | 30/30 | 51/51 | 81/81 | 2.5s |
| sample-02 | 30/30 | 51/51 | 81/81 | 1.7s |

Single Cell OCR、手修正、既存4方式Benchmarkもブラウザで回帰確認済み。
