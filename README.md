# トレ管 — トレーニング管理アプリ

筋トレ・体組成・有酸素運動を記録する個人用PWA。スマホで入力、PCで管理、どちらでも全機能が使えます。

```
+------------------------------+
|  静的Webアプリ (GitHub Pages)  |  ← コードのみ公開。サーバー処理なし
+------------------------------+
        |                |
   スマホ(PWA)           PCブラウザ
        |                |
   IndexedDB  <--JSON-->  IndexedDB
   (端末内保存)  手動同期    (端末内保存)
```

## 機能

- 筋トレ記録(種目×重量×回数×セット、セット完了で**即時保存**、レストタイマー+画面スリープ防止)
- **サーキットトレーニング(既定30分)**: マシン10台+階段昇降を時間制で一巡する専用タイマー。各区間の秒数は設定画面で変更可、終了時に筋トレ/有酸素の記録を自動生成
- 体組成記録(体重・体脂肪率、**体重計の写真からOCR読み取り**対応)
- 有酸素記録(時間・距離)
- グラフ4種(体重7日移動平均、種目別重量+推定1RM、週次ボリューム、週次消費カロリー)
- ルールベースのメニュー提案(漸進性過負荷・部位ローテーション・デロード判定)
- METs方式の消費カロリー計算(安静時代謝を除いた**正味**。筋トレは挙上時間とレスト時間を分けて計算)
- JSONエクスポート/インポートによる端末間同期(newer-winsマージ+競合選択)
- 完全オフライン動作(Service Worker)

## プライバシー

- **記録データは端末のブラウザ(IndexedDB)にのみ保存され、外部に一切送信されません**
- GitHub Pagesに置かれるのはアプリのコードだけです(GitHubには通常のWebアクセス記録のみ残ります)
- エクスポートしたJSONは健康データを含みます。チャットアプリ経由で送るとサーバーに残るため、取り扱いに注意してください
- 共有PCではブラウザのプロファイルを分けるか、使用後に設定→「全データを削除」を実行してください

## ⚠ データ消失に注意

- ブラウザの「閲覧データを削除」、PWAアイコンの削除でデータは消えます
- **iPhoneはSafariのまま使うと7日間未使用でデータが消えることがあります。必ず「ホーム画面に追加」してください**
- 設定画面から定期的にエクスポート(バックアップ)することを強く推奨します

## ローカルでの動作確認

```
cd トレーニング管理アプリ
python -m http.server 8000
```

`http://localhost:8000` を開く(ES Modules/Service Workerのため `file://` では動きません)。
スマホ実機でのUI確認はLAN経由(`http://PCのIP:8000`)でも可能ですが、Service Worker/カメラ/PWAの最終確認はGitHub Pagesデプロイ後に行ってください。

## GitHub Pages へのデプロイ

無料プランの GitHub Pages は **Public リポジトリ**になりますが、このアプリは安全です:

- **記録データはリポジトリに入りません**(端末の IndexedDB のみ)。公開されるのはアプリのコードだけ
- コードに秘密情報はありません(APIキーなし、エクスポートにも端末識別子を含めない)
- 誰かが公開URLを開いても、見えるのは「空のアプリ」だけ(他人の端末には自分の空のデータベースしかない)

残るリスクは「個人データを**誤って commit する**人為ミス」だけ。これを下記の3層で機械的に防ぎます。

### 手順

1. github.com でアカウント作成(Settings → Emails → **Keep my email addresses private** を有効化)
2. リポジトリ `training-app`(Public)を作成
3. **誤コミット防止フックを有効化(最初に1回だけ・重要)**: プロジェクトフォルダで
   ```
   git config core.hooksPath .githooks
   ```
   これでコミット時に個人データ・写真が自動チェックされ、混入していれば commit が止まります(`.githooks/pre-commit`)。
   ※ 別のPCにクローンした場合は、そのPCでも1回実行してください(クローンでは自動適用されません)。
4. このフォルダの中身をアップロード(GitHub Desktop推奨。**コミット前に差分一覧でJSON/画像が混ざっていないか目視確認**)
5. リポジトリの Settings → Pages → Source: Deploy from a branch → `main` / `/(root)`
6. 数分後 `https://<ユーザー名>.github.io/training-app/` で公開
7. スマホでURLを開き「ホーム画面に追加」

### 誤コミットを防ぐ3層

1. **`.gitignore`**(常時有効): エクスポートJSON・バックアップ・画像(icons以外)・データ置き場フォルダを除外
2. **pre-commit フック**(手順3で有効化): ファイル名だけでなく**中身**も検査。エクスポートJSONを別名にリネームしても `"app":"training-log"` の署名で検出して止める
3. **目視チェック**(下記チェックリスト)+ データ・写真は**リポジトリ外**(例 `~/Documents/training-data/`)に保存する運用

## リリースチェックリスト(更新時)

- [ ] **`sw.js` の `SHELL_VERSION` を上げたか**(忘れると利用者に更新が届かない)
- [ ] 新規ファイルを追加した場合、`sw.js` の `SHELL_FILES` に追加したか
- [ ] 既定種目(`js/data/default-exercises.js`)を追加した場合、`js/seed.js` の `SEED_VERSION` を上げたか(忘れると既存ユーザーに種目が追加されない)
- [ ] `settings` に新しいキーを追加した場合、`js/logic/sync.js` の `allowedKeys` に入れるか判断したか(端末固有の状態は入れない)
- [ ] `grep -rn "innerHTML" js/views/` がヒットしないか(ユーザーデータのinnerHTML描画は禁止)
- [ ] エクスポートJSON・テスト画像がコミットに混ざっていないか(.gitignore + pre-commitフックで防いでいるが目視確認)
- [ ] `git config core.hooksPath .githooks` を実行済みか(このPCでフックが有効か)
- [ ] GitHub Pagesは `max-age=600` のため反映に最大10分かかる

## コーディング規約(セキュリティ)

- ユーザー由来データ(種目名・メモ・OCR結果・インポートデータ)を `innerHTML` / `insertAdjacentHTML` に渡すこと**禁止**。`js/util.js` の `el()` ビルダー(textContent差し込み)を使う
- `eval` / `new Function` / インラインイベントハンドラ(`onclick="..."`)禁止(CSPでもブロックされる)
- インポートデータは `js/logic/sync.js` の許可リスト方式サニタイザを必ず通す(受信オブジェクトをそのまま`put`しない)
- CSPは `index.html` のmetaタグで設定済み(`script-src 'self' 'wasm-unsafe-eval'` 等)
- HTML/JSのstyle属性は使わない(CSP `style-src 'self'`)。動的スタイルは `el()` の `styles` プロパティ(CSSOM)経由

### 採用しなかった対策(過剰対策)

| 対策 | 不採用の理由 |
|---|---|
| IndexedDB暗号化 / アプリ内PIN | 端末アクセスできる攻撃者には無力。パスフレーズ忘れ=全損リスクの方が大きい |
| エクスポートJSONの暗号化 | 自己受け渡しのみ。復元不能事故の方が痛い |
| DOMPurify導入 | HTMLを保存・表示する機能がない。textContent徹底で完結 |
| SRI | 同一オリジン同梱では検知にならない。取得時ハッシュ記録(下記)が代替 |

## 同梱ライブラリ(vendor/)

すべて公式ソースから取得し、SHA-256を記録。更新は意図的な作業としてのみ行う。

| ファイル | 取得元 | バージョン | SHA-256 |
|---|---|---|---|
| chart.umd.min.js | registry.npmjs.org chart.js tarball | 4.4.9 | `DE315773454B6076B63990BFA05CE5155A37F71992C87D7BB5F9A2EA698697EF` |
| chartjs-adapter-date-fns.bundle.min.js | registry.npmjs.org tarball | 3.0.0 | `EA7AB30D26C38DCF1F2D26BB43E73A94537B58F1906F55E1A546DD09321B5615` |
| tesseract/tesseract.min.js | registry.npmjs.org tesseract.js tarball | 5.1.1 | `A8E29918D098B2B0...`(取得時記録) |
| tesseract/worker.min.js | 同上 | 5.1.1 | `ACA1229639FC9907...` |
| tesseract/tesseract-core-simd-lstm.wasm.js | registry.npmjs.org tesseract.js-core tarball | 5.1.1 | `CE20EDA9533CBED1...` |
| tesseract/tesseract-core-lstm.wasm.js | 同上 | 5.1.1 | `8F04AA0CC81E7BDE...` |
| tesseract/eng.traineddata.gz | github.com/tesseract-ocr/tessdata_fast(gzip圧縮して同梱) | main | `44502D85A12B9598...` |
| tesseract/ssd.traineddata.gz | github.com/Shreeshrii/tessdata_ssd(7セグ特化、gzip圧縮) | master | `D273F5B9039C7DE6...` |

## アーキテクチャ

```
index.html(CSP/シェル)
└── js/app.js(DB初期化→シード→ルータ→SW登録)
    ├── router.js     ハッシュルータ(#/workout 等)
    ├── db.js         IndexedDBラッパ(migrations足場/persist()/単一tx一括書込)
    ├── seed.js       初期データ投入(SEED_VERSION で既定種目を追加補充)
    ├── data/         静的マスタ定義
    │   ├── default-exercises.js  既定種目(固定ID — 端末間マージの前提)
    │   └── circuits.js           サーキット定義+セグメント列生成/順序正規化
    ├── logic/        純ロジック(UI非依存)
    │   ├── suggestion.js  メニュー提案(複合種目は1回2種目まで)
    │   ├── calories.js    METsカロリー(正味・挙上/レスト分離)
    │   ├── stats.js       1RM/週次集計
    │   ├── ocr.js         前処理+Tesseract+数値パース
    │   └── sync.js        エクスポート/インポート/マージ/検証
    ├── views/        画面(home/workout/circuit/cardio/body/ocr-capture/
    │                 history/charts/suggest/exercises/settings/onboarding)
    └── ui/           components(トースト/モーダル)/stepper/rest-timer/icons
```

主要な設計判断:

- **セット完了=即時DB保存**: ジムでの画面ロック・タブ破棄で記録が消えないこと最優先
- **種目マスタは固定ID**(`ex-bench-press`等): 端末間でIDが一致しないとマージが破綻するため
- **tombstone(deletedAt)による論理削除**: 削除がインポートで復活しない
- **SWキャッシュ2分割**: アプリ本体(数百KB)とOCR資材(約20MB)を分離。OCRはオンデマンド取得
- **既定種目の追加は `seed.js` の `SEED_VERSION` バンプで配布**: 起動毎の全件走査を避けつつ、既存ユーザーにも未登録の既定種目だけをID照合で一度補充する(削除済み種目は復活しない)
- **提案に入れる複合種目は1回2種目まで**(`suggestion.js` の `MAX_COMPOUND`): 複合を無制限に優先すると、脚のように複合が多い部位で高重量の多関節が4枠を占有し、補助種目(ハム・カーフ等)が締め出される。1部位1セッションのセット数も過多になる
- **回数が記録されていないセットは提案の材料にしない**(`suggestion.js` の `isCountedSet`): サーキット由来の記録は `reps: null` のため、弾かないと「目標1回〜」や誤ったデロード提案が出る
- **消費カロリーは正味(net)**: `(METs - 1)` で安静時代謝を差し引く。さらに筋トレは挙上時間(`SET_WORK_MINUTES`)とレスト時間(`REST_METS = 2.0`)を分けて計算する。レストまで種目のMETsで計上すると実測の1.8倍程度に膨らむため
- **`workouts.durationMin === 0` は「時間を別レコードに計上済み」の意味**: サーキット由来のマシン記録がこれにあたり、カロリー0として扱う(表示もしない)。`null`(時間未入力=セット数から推定)とは意味が違う

### サーキットトレーニング(`views/circuit.js` / `data/circuits.js`)

```
#/circuit  準備画面                      タイマー画面
+----------------------+          +------------------------+
| マシン10台を▲▼で並替 |  開始→   | ●●●○○○○○○○  進捗ドット |
| 各マシンの重量を入力 |          | マシン 3/10 ・ レスト   |
| (前回値プリフィル)  |          |         0:23           |
+----------------------+          | [⏸][スキップ][終了]    |
                                  +------------------------+
                                            | 完了/終了
1サイクル(既定): マシン60s → レスト30s        ▼
     → 階段昇降60s → レスト30s          workouts × 実施したマシン数(durationMin=0)
     × マシン台数 = 30分(秒数は変更可)   cardio  × 1件(セッション全体 8.0 METs)
```

- **専用画面として独立**: 既存の記録フロー(`workout.js` の `renderSession`)には手を入れていない
- **進行状態は `settings.activeCircuitTimer`**: 当日のものだけ再開可。画面離脱時は自動一時停止(復帰時の大量スキップ防止)
- **カウントダウンは `endTime` 方式**: タブが止まってもズレない。遷移ごとに beep+バイブ、実行中は Screen Wake Lock
- **マシン順は `settings.circuitOrder`、秒数は `settings.circuitTiming`**(どちらも端末間で同期される)。有酸素種目とマシンの顔ぶれはコード固定(v1)
- **1サイクル=4セグメント構成は固定**: 進捗計算が `segIndex / 4` 前提のため、秒数の下限を5秒として「0秒=そのステーションなし」を作らせない(`TIMING_LIMITS`)
- **記録の生成は終了時に一括**: 通過済みセグメントだけを集計するため、途中終了でもそこまでが残る
- **カロリーはセッション全体を1件で計上**: マシン実働+階段の足し算ではレスト時間が丸ごと落ち、3〜4割の過小評価になる。`ex-circuit-training`(8.0 METs、Compendium の "circuit training, general")で所要時間ぶんを1件記録し、マシン側の `workouts` は `durationMin: 0` にして二重計上を防ぐ。マシン記録は重量履歴を残すのが目的
