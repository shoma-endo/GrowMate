# 要件定義: AI 要約一括実行のバックグラウンド化

## メタデータ

- 文書名: AI 要約一括実行のバックグラウンド化
- ステータス: `draft`
- 作成日: 2026-09-04
- 最終更新日: 2026-09-04
- 作成者: Claude（Cloud セッション。下書き）
- 承認者: 未確定
- 対象リリース: 未確定
- 関連する依頼・Issue・PR:
  - 親仕様: `docs/plans/content-annotation-bulk-ai-summary-spec.md`（同期実行版。本仕様はその実行モデルを差し替える）
  - 共有UI契約: `docs/plans/analytics-bulk-actions-impl-note.md`
  - 先行 PR: shoma-endo/GrowMate#515（同期実行版の実装。本仕様は別スコープ・別 PR）

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - `/analytics` の「AIで要約」を利用者（`paid` / `admin`）が実行すると、**1回で完了するのは約24件**にとどまる。Vercel 関数の実行枠（`app/analytics/page.tsx` の `maxDuration = 800` 秒、うち時間予算は 760 秒＝`CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS`）を、1件あたり実測約30秒の直列処理で使い切るため。新規着手の実効打ち切りは経過約 640 秒。
  - 実測: 327件を選択した実行で「24件成功 / スキップ60件 / **未実行243件**」。残りを消化するには同じ操作を約10回繰り返す必要があり、1回あたり約12分の待機が発生する。クライアントから「めちゃ手間」との申告あり（2026-09-04）。
- 放置した場合の影響:
  - 記事数100〜300件規模の利用者が、初期セットアップ（要約の一括生成）を完了できず、要約を前提とする後続機能（評価・提案）の価値に到達しない。
  - 待機中はブラウザのタブを閉じられない。閉じると成功分は保存済みだが、未実行分の再開は利用者の手動操作に依存する。

### 目的

- この開発で実現する状態:
  - 利用者は「AIで要約」を**1回押すだけ**で、選択した全件（最大1000件）が完了まで処理される。押した直後に画面は応答を返し、タブを閉じてよい。
  - 完了したらメールで通知が届く。
- 利用者・事業にとっての価値:
  - 初期セットアップの所要操作が「10回の再実行・約2時間の張り付き」から「1回の操作・放置」に変わる。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 300件の要約完了に必要な利用者の操作回数 | 約10回 | **1回** | 実データでの手動確認 | リリース直後 |
| 300件の要約完了までの所要時間 | 約2時間（張り付き） | **約30〜60分**（放置可） | cron 実行ログの `batch_completed` | リリース直後 |
| 実行後にタブを開いたまま待つ必要 | あり（約12分/回） | なし | 手動確認 | リリース直後 |

> **「約30〜60分」の前提（F-17 / F-18）**: 未要約267件・1起動あたり60〜70件・単独利用者。1起動は最大約12.2分（730秒）かかるため 10 分間隔でも実質は直列化し、`4起動 × max(10分, 12.2分) ≒ 49分`（算式は §11 ALT-002）。claim は `p_limit default 1`（§9）なので、**複数の利用者が同時に起票した場合、後発のジョブは先発の完走まで待つ**（1000件なら数時間）。この指標は単独利用者を前提にした目安であり、時刻を保証しない（R-B03）。

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | `paid` / `admin` ロールの利用者 | 一覧から対象を選び実行する。完了はメールで受け取る |
| 運用担当 | GrowMate 運用 | cron の失敗を GitHub Actions の通知で検知する |
| 管理者・承認者 | PO | 対象範囲・通知方針の承認 |
| 外部サービス・連携先 | Anthropic API / WordPress / Resend / GitHub Actions | 要約生成・本文取得・メール送信・定期起動 |

### 主な利用シナリオ

1. **`paid` の利用者が**、**WordPress インポート直後（未要約が267件ある状態）で**、一覧の全選択から「AIで要約」を実行し、画面を閉じる。
2. **同じ利用者が**、**約30〜60分後に届いたメールで**、成功・失敗・スキップの件数を確認する。
3. **同じ利用者が**、**処理中に `/analytics` を開いたとき**、実行中である旨と進捗（処理済み/全体）を確認する。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
利用者 → [AIで要約] 押下
        → Server Action が同期実行（最大760秒）
        → 時間予算切れで打ち切り、「24件を要約しました（未実行243件）」を表示
        → 利用者が同じ操作を繰り返す（約10回）
```

### 導入後（To-Be）

```text
利用者 → [AIで要約] 押下
        → Server Action はジョブを1件起票して即応答（「バックグラウンドで実行します」）
        → 利用者はタブを閉じてよい

10分ごと → GitHub Actions → /api/cron/content-annotation-summary
        → 未通知で終了済み（completed / failed）のジョブがあれば完了メールを送る（BR-B06 の掃き出し）
        → 未処理ジョブを1件 claim（排他。job_token を発行）
        → 時間予算(760秒。新規着手の実効打ち切りは経過約640秒)の範囲で、配列順に3件ずつのチャンクで処理
        → チャンクに着手する直前に、その3件を取り直して「8項目がすべて空・WordPress 連携済み・user_id 一致」を再判定（BR-B08）
        → チャンクの3件が揃って完了した時点でカーソル（processed_count）と件数を保存（BR-B09）
        → 全件終わっていなければ pending に戻し、次回の起動で続きから処理
        → 全件終わったら completed にし、その場で完了メールを1通送信（送れなければ次回の掃き出しで再送）
```

### 業務ルール

- ルール ID: **BR-B01 実行単位はジョブ**
  - ルール: 「AIで要約」の押下は、対象記事 ID の集合を持つ**ジョブを1件作る**ことを意味する。要約処理そのものは cron が行う。
  - 例外: なし。
- ルール ID: **BR-B02 対象の解決は起票時に1回だけ**
  - ルール: 全選択（`mode: 'all'`）の母集団解決（親仕様 BR-05 / 評価親 BR-07）は**起票時に1回**行い、解決した ID 配列をジョブに保存する。cron は保存済みの ID だけを処理する。
  - 理由: 母集団は `updated_at` 降順・上限1000件で解決されるため、実行のたびに `updated_at` が動く現行方式では、再実行のたびに対象が入れ替わり同じ記事を処理し続ける（親仕様 R-006）。起票時に固定すれば、この問題は本仕様の範囲では発生しない。
  - 例外: 起票後に削除された記事は、処理時点で「所有者不一致・不在」として失敗に計上する（親仕様の `NOT_OWNED` を踏襲）。
  - 補足: **ID を固定するのは「対象集合」だけで、「要約してよいか」の判定は固定しない。** 実行可否は実行直前に再判定する（BR-B08）。
- ルール ID: **BR-B03 同時に走るジョブは1利用者につき1件**
  - ルール: `pending` または `processing` のジョブを持つ利用者は、新しいジョブを起票できない。実行中である旨を返す。
  - 理由: 二重起票は同じ記事への二重課金と、進捗表示・完了メールの意味の破壊を招く。
- ルール ID: **BR-B04 1回の cron 起動で使う時間は現行の予算を踏襲する**
  - ルール: 1回の起動で使える時間予算は **760 秒**（`CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS` = `maxDuration` 800秒 − 返却バッファ40秒）。次の1件に着手してよいかは既存の `computeSummaryItemBudgetMs(elapsedMs)`（`src/server/lib/content-annotation-bulk-summary.ts`）の戻り値で判定し、**`null`（残り予算が着手下限を割る）なら着手しない**。関連定数（LLM後バッファ30秒、着手下限90秒＝本文取得60秒＋LLM最低30秒、1件あたりの上限240秒＝LLMタイムアウト180秒＋本文取得60秒）は変更しない。
  - 導出値（閾値ではない）: 上記の結果、**新規着手の実効打ち切りは経過約 640 秒**（`760 − 640 − 30 = 90`）、着手済み1件を含めた最遅完了は経過 **730 秒**。730 秒は `maxDuration` 800 秒に対する余裕の説明であり、**実装が比較する閾値ではない**。「経過 730 秒を超えたら打ち切る」と事後判定で実装すると、経過 729 秒で着手した1件が最大 240 秒走って経過 969 秒に達し、`maxDuration` 800 秒でハードキルされる。
  - 例外: 着手できない時点で未処理が残っていれば、ジョブを `pending` に戻し、**直近に完了したチャンクの末尾**までのカーソル位置と件数を保存する（着手判定も保存もチャンク単位。BR-B05 / BR-B09）。
- ルール ID: **BR-B05 並列数は3。並列は「3件のチャンク」単位で区切る**
  - ルール: 未処理の記事を**配列順に3件ずつのチャンク**へ区切り、チャンク内の3件を `Promise.all` で同時に処理する。**次のチャンクには、前のチャンクの3件がすべて完了してから着手する**（時間予算の判定もチャンクの先頭で行う）。並列数3は既存の `GscEvaluationService.EVALUATION_CONCURRENCY = 3`（`src/server/services/gscEvaluationService.ts:20`）と揃える。
  - 理由: チャンク境界を作らずに「1件終わるたびに次を投入する」形にすると、完了順が配列順と入れ替わるため進捗カーソルを安全に進められない（BR-B09 の理由）。既存の並列処理も `for (i += CONCURRENCY)` + `Promise.all` のチャンク形（`gscEvaluationService.ts:97-118`）であり、同型を踏襲する。
  - 例外: Anthropic のレート制限（429）が観測された場合の調整は定数1箇所で行える形にする。
- ルール ID: **BR-B06 通知はジョブが終了した時点で1通だけ**
  - ルール: ジョブが **`completed` または `failed`** になった時点で、成功・失敗・スキップ・未実行の件数と失敗理由の内訳をメールで1通送る（`failed` の場合は「途中まで」である旨を添える）。送信は `EmailService` に追加する専用メソッド `sendContentAnnotationSummaryCompletion(to, subject, htmlContent)` で行い、本文は **HTML で専用に組む**。失敗理由のラベルは既存の `FAILURE_LABELS` / `describeFailures`（`src/lib/content-annotation-bulk-summary-display.ts`。現在は未 export のため `export` を付ける）を共用する。
  - 理由: 既存の `getBulkSummaryToastMessage` は**プレーンテキスト1行**を返し、`stoppedReason === 'time_budget'` のとき「未実行分はもう一度実行すると続きから進みます」＝**手動再実行を促す文面**になる。背景実行では cron が続きを処理するため誤案内になり、かつ同期版トースト（`app/analytics/AnalyticsClient.tsx`）と共用したまま分岐を足すと同期版の文面を壊す。共用するのは**ラベル辞書だけ**にする。
  - 起動経路: 送信は (1) cron が同じ起動内でジョブを `completed` / `failed` にしたときのその場の送信と、(2) cron ルートが claim の前に行う**未通知ジョブの掃き出し**（`status in ('completed','failed')` かつ `notified_at is null`）の2経路で行う。**(2) が無いと、claim RPC が `attempt_count >= 3` で `failed` に落とした行（アプリ層が一度も見ない）と、送信に失敗した行に通知が届かない**（詳細は §9「完了メールの起動経路」）。
  - 例外: `users.email` が未登録の利用者には送らない（送信スキップとしてログに残す）。cron の再実行で二重送信しないよう `notified_at` で冪等にする。
- ルール ID: **BR-B07 途中経過は画面に出す**
  - ルール: 実行中のジョブがある利用者が `/analytics` を開いたとき、「要約中...（処理済み N / 対象 M 件）」を表示する。N は `processed_count`、M は `total_count`（＝起票時に固定した対象ID数。§9 の定義）。**分母語は「対象」とし「全」は使わない**（同じ画面のツールバーの「全 M 件」は利用者の全記事数を指すため。§6 UI用語）。
  - 例外: 自動更新（ポーリング）はしない。ページを再読み込みしたときに最新化される。
- ルール ID: **BR-B08 実行直前に対象条件を再判定する（親仕様 BR-01 の継承）**
  - ルール: cron は、**チャンク（最大3件）に着手する直前にその3件の対象記事を取り直し**（＝`generateSummary` 呼び出しの直前）、**親仕様 BR-01 / BR-02 の条件（8項目がすべて空・WordPress 連携済み・`user_id` 一致）**を再判定する。満たさない件は `generateSummary` を呼ばず `skipped_count` に計上する（`user_id` 不一致・不在だけは `NOT_OWNED` として失敗に計上。BR-B02 例外）。判定には既存の純関数 `isSummaryEmpty` / `isWordPressLinkedForSummary`（`src/server/lib/content-annotation-bulk-summary.ts`）を使う。
  - 理由: 親仕様 BR-01 は「単記事コアは充填チェックを持たず `contentAnnotationSummaryService.saveSummary` は無条件 UPDATE なので、取り直さないと手入力値を黙って上書きし、履歴が無く復旧できない」ためにこの再判定を置いている。同期版は「起票＝実行」で間隔が実質ゼロだったが、**背景化により起票から実行まで 30〜60 分（cron 遅延・他利用者のジョブ待ちならさらに長い）開く**。その間に利用者が `/analytics` で8項目を手入力しうるため、再判定を落とすと親仕様が防いでいた事故がそのまま起きる。BR-B09 の再開時の二重 LLM 課金も、この再判定が併せて抑止する。
  - 例外: なし。起票時のフィルタ結果を根拠に再判定を省略してはならない。また、**ジョブ全体の対象記事をループ前に一括取得して振り分ける形（同期版 `src/server/actions/contentAnnotationBulkSummary.actions.ts:188-246`）は採らない**。採ると再判定が最大12分前（1起動分）のスナップショットに基づくことになり、「直前」の要件を満たさない（§14 手順2）。
- ルール ID: **BR-B09 進捗はチャンク境界で保存し、カーソルを着手済みの記事より先へ進めない**
  - ルール: `processed_count` / `succeeded_count` / `failed_count` / `skipped_count` / `failed_by_code` は、**BR-B05 のチャンク（最大3件）が全件完了した時点でまとめて**ジョブ行へ書き戻す（1件ごとでも、予算切れ時にまとめてでもない）。`processed_count` は**完了したチャンクの末尾の位置**を指すカーソルであり、**処理中（in-flight）の記事を跨いで先へ進めない**。更新は claim 時に発行した `job_token` を `.eq('job_token', ...)` で条件に付け、別起動に回収済みのジョブへ書き込まない。
  - 理由: (1) 「予算切れ時のみ保存」だと、`maxDuration` によるハードキルや想定外例外で**1起動分（最大約70件）の進捗が丸ごと失われる**。(2) 逆に「1件処理するたびに `processed_count` を加算」すると、並列3では完了順が配列順と一致しないため事故になる。配列 index 0/1/2 を同時に走らせ 1 と 2 が先に完了した時点で `processed_count = 2` になり、その瞬間にハードキルまたは20分スタック回収（§8）が起きると、**再開位置が index 2 になって未処理の index 0 が永久に飛ばされる**。ジョブはやがて `completed` になり、完了メールは「全件終わった」意味の件数を返す（＝§1 の成功指標が利用者にも運用にも見えない形で破れる）。チャンク境界でのみ前進させれば、異常終了で失われるのは**高々1チャンク（3件）**に閉じ、その3件は再開時に再処理されても BR-B08 の再判定でスキップになるため、LLM 課金も件数の二重加算も起きない。
  - 例外: なし。

## 4. 対象範囲と Non-goals

### 対象範囲

- 画面・操作: `/analytics` の「AIで要約」ボタンの挙動変更（同期実行 → ジョブ起票）、実行中の進捗表示、`ui-text.md` 辞書への新規用語追記（詳細は「6. 機能要件」の画面設計）
- サーバー: ジョブ起票用 Server Action（戻り値の変更・`SUMMARY_BULK_ALREADY_RUNNING` の追加）、cron ルート、ジョブ処理サービス、完了メール送信（`EmailService` への新規メソッド追加）、`generateSummary` の `cookieStore` 任意化、`FAILURE_LABELS` / `describeFailures` の `export` 追加
- データ・DB: ジョブテーブル1つと、排他取得用 RPC 1つ（マイグレーション）、`npm run supabase:types` の再生成
- 権限・ロール: 起票は `admin` / `paid` のみ（`canWriteGa4` 流用）。進捗の閲覧は起票者本人のみ。cron は `CRON_SECRET` + Service Role + `user_id` 明示スコープ（§6 権限）
- 定期実行: 10分間隔の GitHub Actions ワークフロー1本、`CRON_CONFIGS` への登録（値は §9）
- 運用・監視: 既存の cron 観測基盤（`cron-observability.ts` / `invoke-cron.sh` の `count-batch` profile）に載せる。専用の監視ダッシュボードは作らない（Non-goals の停止機構と同じ理由）

### Non-goals（今回の対象外）

- **キャンセル・停止導線**: 実行中ジョブを利用者が止める手段は作らない。クライアント判断（2026-09-04）で「不要」と合意済み。BR-B03 の1利用者1ジョブ制限により、暴走の上限は「1ジョブ＝最大1000件」に閉じる。
- **Claude Sonnet 5 への移行**: 判断を保留（クライアント指示: 一旦ステイ。→ OPEN-B01）。本仕様は現行の `claude-sonnet-4-6` のまま実装する。移行する場合も本仕様の構造は変わらないため、別途決定してよい。
- **進捗のリアルタイム更新**: WebSocket / SSE / 自動ポーリングは作らない。BR-B07 のとおり再読み込み時の表示にとどめる。
- **Message Batches API（50%割引）の利用**: 投入・ポーリング・結果回収が別実装になるため今回は採らない。コスト削減が要件化された場合に再検討する（→ OPEN-B02）。
- **評価サイクル一括開始のバックグラウンド化**: LLM を使わず1回で1000件処理できるため不要（→ OPEN-B03）。
- **停止機構（feature flag / 環境変数 / 専用設定テーブル）**: 要件・クライアント合意になく、既存手段（デプロイ巻き戻し、当該ボタンの非表示）で止められるため作らない（`CLAUDE.md` Core Rules / MVP 最優先）。
- **複数ジョブの同時実行・優先度制御**: BR-B03 により1利用者1ジョブ。利用者間の順序は claim 順（作成日時順）とし、優先度は持たない。
- **失敗した記事の自動リトライ**: 決定的失敗（本文サイズ超過など）は再実行しても同じ結果になるため、自動リトライはしない。利用者が再度実行する。ジョブ単位の `attempt_count` 上限3（既存雛形の踏襲）は、想定外の例外で無限に claim され続けるのを止めるための上限であり、記事単位のリトライ機構ではない。
- **本文サイズ超過時の自動削減**: 80,000文字を超える本文を切り詰めて再試行する処理は作らない（§8「本文サイズ超過時の扱い」。既存挙動を変更しない）。

## 5. 開発工数（概算）

### 前提

- 換算: **8時間 = 1人日**。
- 見積の状態: **`仮置き`**（2026-09-04 時点。合意者・合意日は未確定）。確認質問 Q-B01 / Q-B02 の回答で振れる。
- 含めるもの: 実装、ユニットテスト、本書に書いた範囲の UI / Server Action / cron ルート / migration / 完了メール。
- 含めないもの: 仕様レビューの往復、クライアント確認待ち、本番へのマイグレーション適用とデプロイ（§13 リリース方針の運用作業）。
- 既存の同型実装（`GscSuggestionJobService` + `claim_gsc_suggestion_jobs` + cron ルート + `CRON_CONFIGS`）を雛形として流用できる。
- 実データ検証には実 LLM 課金が発生する（§8 コスト）。

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 仕様確定 | 本書のレビュー・確認質問（Q-B01〜Q-B03）の解消 | 4 | 0.5 |
| DB | ジョブテーブル + claim RPC のマイグレーション、`supabase:types` 再生成 | 2 | 0.25 |
| サーバー | ジョブ処理サービス（claim・チャンク直前の再判定・並列3のチャンク処理・時間予算・チャンク境界の進捗保存）、cron ルート（レスポンス形・未通知ジョブの掃き出し）、`CRON_CONFIGS` 追加 | 12 | 1.5 |
| 起票 | Server Action の差し替え（同期実行 → 起票）、二重起票の防止（事前検出 + ユニーク制約違反の捕捉） | 4 | 0.5 |
| 通知 | 完了メール（`EmailService` の新規メソッド + HTML 本文 + `notified_at` による冪等） | 4 | 0.5 |
| 画面 | 実行直後のトースト、進捗表示、UI 文言辞書の更新 | 4 | 0.5 |
| CI/CD | 10分間隔ワークフロー追加、cron 整合性テスト更新（複数ワークフロー対応） | 2 | 0.25 |
| テスト | ユニット追加・更新 | 6 | 0.75 |
| 検証 | `npm run verify`、実データでの通し確認（並列数の実測含む） | 6 | 0.75 |
| **合計** |  | **44** | **5.5** |

幅: **36〜52時間（4.5〜6.5人日）**。幅の理由は確認質問 Q-B01（WordPress.com の Cookie 無し取得可否の実データ検証と、成立しない場合の分岐実装）と Q-B02（429 の扱いが `retry-after` 待機になる場合の追加実装）。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: `spec-review` サイクル1で 🔴2件 / 🟡13件を反映済み。Q-B01〜Q-B03 の回答が揃うまで `approved` にはならない（§16）。
- クライアント確認・たたき台合意の見込み: Q-B01（実データ検証 + PO）・Q-B02（PO）・Q-B03（PO / クライアント）。回答予定日は未確定。
- 希望リリース時期との関係: 希望時期は未確定。Q-B01 の回答が遅れる場合、WordPress.com 分岐を後続チケットに切り出してスコープを削る余地がある（self-hosted 利用者だけでも価値が出るため）。
- 実データ検証は cron の起動を待つため、最短でも10分単位の待ち時間が入る（`workflow_dispatch` での手動起動は可能）。
- 本番へのマイグレーション適用は別途調整（§13 リリース方針の手順1。完了条件には含めない。§15）。

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-B01 | 「AIで要約」の押下でジョブを1件起票し、即座に応答を返す | Must | クライアント申告 2026-09-04（「めちゃ手間」。§1 背景）／BR-B01 | AC-B01 |
| FR-B02 | 起票時に対象IDを解決して配列で固定する | Must | 親仕様 BR-05 / R-006（`updated_at` 降順で対象が入れ替わる）／BR-B02 | AC-B01 |
| FR-B03 | cron が未処理ジョブを排他 claim し、カーソル位置から続きを処理する | Must | 既存 `claim_gsc_suggestion_jobs` 踏襲／BR-B01 | AC-B02 |
| FR-B04 | `generateSummary` の直前に BR-B02 条件（8項目すべて空・WordPress 連携済み・`user_id` 一致）を再判定する | Must | **親仕様 BR-01**（手入力値の無音上書き防止。履歴が無く復旧不能）／BR-B08 | AC-B13 |
| FR-B05 | 時間予算内で並列3で処理し、着手できなければ `pending` に戻す | Must | 既存 `computeSummaryItemBudgetMs` / `GscEvaluationService.EVALUATION_CONCURRENCY = 3`／BR-B04 / BR-B05 | AC-B03 |
| FR-B06 | 進捗をチャンク（最大3件）境界で `job_token` 条件付きに保存し、カーソルを着手済み・未完了の記事より先へ進めない | Must | ハードキル・想定外例外での進捗ロスト対策（`spec-review` 指摘 F-06）と、並列3で完了順が入れ替わったときの記事の飛ばし防止（同 F-20）／BR-B05 / BR-B09 | AC-B03 / AC-B14 |
| FR-B07 | ジョブ終了（`completed` / `failed`）時に完了メールを1通送る（冪等）。同一起動で終了させられなかったジョブは、次回起動の掃き出しで送る | Must | クライアント合意 2026-09-04（完了時にメール1通）／BR-B06。掃き出しが無いと claim RPC が `failed` に落とした行に通知が届かない（`spec-review` 指摘 F-21） | AC-B04 / AC-B05 / AC-B06 / AC-B15 |
| FR-B08 | 1利用者1未完了ジョブに制限し、二重起票を拒否する | Must | BR-B03（二重課金と件数集計の破壊を防ぐ） | AC-B07 |
| FR-B09 | 実行中の進捗を `/analytics` に表示する（自動更新なし） | Should | BR-B07（放置前提のため状況が見えないと再実行を招く）／Non-goals でリアルタイム更新は対象外 | AC-B08 |
| FR-B10 | 起票は `admin` / `paid` のみ。UI だけでなくサーバー側でも検証する | Must | `CLAUDE.md` Core Rules（新規機能は `admin` / `paid`）／既存 `canWriteGa4` | AC-B09 |
| FR-B11 | 1件の失敗でジョブを止めず、失敗理由コードごとに計上する | Must | 親仕様の `BulkSummaryResult` 4区分を踏襲 | AC-B10 / AC-B12 |
| FR-B12 | 対象上限1000件を超える起票を拒否する | Must | 既存 `MAX_BULK_SUMMARY_TARGETS = 1000` 踏襲／`db-max-rows = 1000` と整合 | AC-B11 |
| FR-B13 | `processing` のまま20分以上動いていないジョブを次回の claim で回収する | Must | 既存 `claim_gsc_suggestion_jobs` のスタック回収を踏襲（しきい値のみ `maxDuration` に合わせて延長。§9）／R-B05 | 手動確認（§13） |

> 優先度はすべて Must（FR-B09 のみ Should）。Should の FR-B09 を落とすと「放置してよい」体験が成立しないため、MVP では実装する前提だが、工数が溢れた場合の最初の削減候補である。

### 入力・出力・状態遷移

- **入力値・形式・必須条件（起票時）**: 現行 Server Action と同じ。`{ mode: 'ids', contentAnnotationIds: string[] }` または `{ mode: 'all', excludedIds?: string[] }`。zod スキーマ（`src/server/actions/contentAnnotationBulkSummary.actions.ts`）は現行を流用する。
- **正常時の出力（起票 Server Action）**: `ServerActionResult<{ jobId: string; totalCount: number }>`。同期実行版が返していた `BulkSummaryResult` は**返さない**（結果は完了メールと進捗表示で受け取る）。呼び出し元 `app/analytics/AnalyticsClient.tsx` は `getBulkSummaryToastMessage(result.data)` の呼び出しをやめ、固定文言のトーストへ差し替える。
- **エラー時の出力**: `ServerActionResult` の `success: false` + `error`。文言は `ERROR_MESSAGES.WORDPRESS.*` 経由（`nextjs-server` 規約）。

  | 条件 | メッセージキー | 状態 |
  | --- | --- | --- |
  | 対象が0件 | `SUMMARY_BULK_TARGETS_REQUIRED` | 既存 |
  | 1001件以上 | `SUMMARY_BULK_TARGETS_LIMIT_EXCEEDED` | 既存 |
  | 母集団解決の不整合 | `SUMMARY_BULK_POPULATION_MISMATCH` | 既存 |
  | 未完了ジョブが既にある | **`SUMMARY_BULK_ALREADY_RUNNING`**「すでに要約を実行中です。完了までお待ちください。」 | **新規追加** |
  | 上記以外の失敗 | `SUMMARY_BULK_FAILED` | 既存 |

- **二重起票の検出は2段構え**: 事前 SELECT で未完了ジョブを見つけた場合も、部分ユニークインデックス違反（同時2クリック・二重送信での競合）を捕捉した場合も、**同じ `SUMMARY_BULK_ALREADY_RUNNING` を返す**。ユニーク制約違反を汎用の `SUMMARY_BULK_FAILED`（「AI要約の一括実行に失敗しました」）に落とすと、AC-B07 の期待表示と食い違う。
- **状態と遷移条件**:

```text
（起票）→ pending
pending --[cron が claim / job_token 発行]--> processing
processing --[着手できる残り予算が無く、未処理あり]--> pending（カーソル・件数保存、次回続行）
processing --[全件処理済み]--> completed（同じ起動内で完了メール送信）
processing --[想定外の例外]--> failed（同じ起動内で完了メール送信。件数は途中まで）
processing --[試行上限（attempt_count >= 3）に達した行を次回の claim RPC が回収]--> failed（アプリ層を経由しないため、完了メールは次回起動の掃き出しで送信。§9）
```

- **冪等性・重複実行時の挙動**:
  - 起票: 1利用者につき未完了ジョブは1件（部分ユニークインデックス。BR-B03）。
  - claim: `for update skip locked` で排他。回収されたジョブへの遅延書き込みは `job_token` 条件で弾く（BR-B09）。
  - 進捗: チャンク（最大3件）境界で保存するため、再開時に再処理されうるのは**直近の未完了チャンクの最大3件だけ**で、それ以前の範囲は処理し直さない（BR-B09）。再処理された記事は BR-B08 の再判定でスキップになり、LLM 課金は発生しない。
  - メール: `notified_at` が非 NULL なら送らない（BR-B06 / AC-B05）。送信成功後に `.is('notified_at', null)` を条件に印を付ける。起動の重なりによる二重送信は workflow の `concurrency`（§10）で抑止する。

**集計の定義（完了メール / 進捗表示で使う）**: 現行の `BulkSummaryResult` と同じ4区分（成功・失敗・スキップ・未実行）＋失敗理由の内訳（`failed_by_code`）。**文言生成関数 `getBulkSummaryToastMessage` は共用しない**（理由は BR-B06）。共用するのは失敗ラベル辞書 `FAILURE_LABELS` / `describeFailures` のみ。

**分母の定義**: 進捗表示と完了メールの分母 `total_count` は **起票時に固定した対象ID数**（`target_annotation_ids` の長さ）であり、「要約が生成される見込み件数」ではない。`mode: 'all'` の母集団は親仕様 BR-05 のとおり**利用者が所有する全記事**（`analyticsContentService.resolveAllAnnotationIds` は `user_id` のみで絞り `updated_at` 降順・上限1000件。未要約では絞らない）なので、既に要約済みの記事や WordPress 未連携の記事も `total_count` に含まれ、実行時に BR-B08 でスキップへ計上される。したがって `mode: 'all'` では「分母1000・実際に要約されるのは267件・残り733件は短時間でスキップ」という形になり、進捗の伸びは不連続になる。**この挙動を仕様として許容する**（分母を「見込み件数」に作り替えるのは、起票時に8項目と連携状態を全件判定する追加処理になり、MVP の範囲を超えるため）。UI 文言は「処理済み N / **対象** M 件」とし、分母語に「全」を使わない（既存ツールバーの「全 M 件」＝利用者の全記事数と同じ語で別の母数を指さないため。§6 UI用語）。

### 画面設計

対象は `/analytics`（`app/analytics/AnalyticsClient.tsx`）。既存のチェック列・ツールバーは変更しない。

#### 画面一覧

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| コンテンツ分析 | `/analytics` | 既存（変更） | 「AIで要約」押下時の挙動を同期実行からジョブ起票へ変更。実行直後トースト、実行中の進捗表示、二重起票時のトーストを追加。進捗はサーバーコンポーネント `app/analytics/page.tsx` で取得して props で渡す |

#### `/analytics`

- 概要: 既存のツールバー付近に、実行中ジョブの進捗ラベルを1行追加する。
- 状態別UI:

  | 内部状態 | ユーザー向け表示 | 主操作 | 操作制限 |
  | --- | --- | --- | --- |
  | 起票直後（Server Action が成功） | トースト「バックグラウンドで実行します。完了したらメールでお知らせします。」 | なし（画面を閉じてよい） | 既存の実行中トーストを置き換える |
  | 未完了ジョブあり（`pending` / `processing`）でページを開いた | ツールバー付近に「要約中...（処理済み N / 対象 M 件）」 | 再読み込みで最新化 | 自動更新なし（BR-B07） |
  | 未完了ジョブありで再度「AIで要約」を押した | トースト「すでに要約を実行中です。完了までお待ちください。」 | なし | 新規ジョブは作られない（BR-B03） |
  | 未完了ジョブなし（`completed` / `failed` / ジョブ無し） | 通常表示（進捗ラベルは出さない） | 通常操作 | 結果はメールで確認する |

- 「実行中」の表示中もチェック列と他のボタン（評価サイクル開始）は従来どおり使える。
- UI用語:
  - 「要約中...（処理済み N / 対象 M 件）」は `ui-text.md` §3「進行中の状態表現」の**ラベル**として扱う（`<動詞>中...` の形）。説明文ではないので `要約を実行中` とはしない。
  - **「対象」と「全」を使い分ける**: 進捗ラベルの分母は「対象 M 件」＝起票時に固定した対象ID数（`total_count`）。既存ツールバーの「選択中 N 件 / 全 M 件」（`app/analytics/AnalyticsClient.tsx:457-460` の `annotationTotalCount`）の「全」は**利用者の全記事数**であり、意味が違う。進捗ラベルはそのツールバー付近に出るため（本節冒頭）、全記事1200件の利用者が全選択すると `1000 / 全 1200 件` と `要約中...（処理済み 45 / 対象 1000 件）` が同じ視野に並ぶ。同じ語で別の母数を指さないよう、分母語を分ける（`growmate-ui-ux` の用語一貫性）。
  - トースト2件（「バックグラウンドで実行します。完了したらメールでお知らせします。」「すでに要約を実行中です。完了までお待ちください。」）は説明文として普通の日本語で書く。
  - **辞書に無い新規用語**: 「バックグラウンド」。`.agents/skills/growmate-ui-ux/ui-text.md` の辞書へ追記し、`scripts/check-ui-text.sh` を通す（この追記も対象範囲に含む）。

#### 誤読しやすい罠

- 分母「対象 M 件」は「未要約件数」ではなく「起票時に選択した件数」。`mode: 'all'` では要約されない記事も分母に入る（上の「分母の定義」）。ツールバーの「全 M 件」（全記事数）とは別の母数なので、同じ「全」という語を使わない（上の UI用語）。
- 「未実行」と「スキップ」は別区分。未実行は次回の cron で進むが、スキップは再実行しても変わらない（親仕様 §6 の4区分の意味を踏襲）。

### 権限

新規機能の対象ロールは `admin` / `paid`（`CLAUDE.md` Core Rules。既存の `canWriteGa4` = `GA4_ALLOWED_ROLES = ['admin', 'paid']` を流用）。`trial` / `unavailable` は例外なく対象外。

| ロール | 閲覧（進捗表示） | 作成・実行（起票） | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| `admin` | 自分のジョブのみ | ○ | 不可（更新は cron の Service Role のみ） | 不可（キャンセル導線は Non-goals） |
| `paid` | 自分のジョブのみ | ○ | 不可 | 不可 |
| `trial` | 不可 | ✕（Server Action で拒否。AC-B09） | 不可 | 不可 |
| `unavailable` | 不可 | ✕ | 不可 | 不可 |

- ジョブ起票: UI だけでなく Server Action 側でも `canWriteGa4` を検証する。
- 進捗の閲覧: **起票者本人のみ**。`admin` でも他人のジョブは表示しない（進捗表示に管理用途はない）。
- cron 実行: 既存 cron と同じ `CRON_SECRET` の Bearer 認証（`/api/cron/*` の共通ガード）。処理は Service Role で行い、**ジョブ行の `user_id` を明示的にスコープ**して他人の記事に触れない。
- **画面側の読み取りも Service Role**: `app/analytics/page.tsx` からの進捗取得は `SupabaseService`（Service Role）経由で RLS をバイパスするため、クエリに `.eq('user_id', userId)` を必ず含める。RLS は多層防御であり、**実際のセキュリティ境界はアプリ層の `user_id` スコープ**（`.agents/skills/supabase/service-usage.md` 運用ルール3）。

## 7. Gherkin受け入れ条件

```gherkin
機能: AI要約一括のバックグラウンド実行

  シナリオ: AC-B01 実行するとすぐに応答が返る
    前提 paid ロールの利用者が /analytics を開いている
    かつ 未要約の記事を300件選択している
    もし 「AIで要約」を押す
    ならば 3秒以内に「バックグラウンドで実行します」と表示される
    かつ pending 状態のジョブが1件作られる
    かつ そのジョブは選択した300件の記事IDを保持している

  シナリオ: AC-B02 cron が続きから処理する
    前提 processed_count が 24 のジョブが pending である
    もし cron が起動する
    ならば 25件目から処理が始まる
    かつ 既に成功した24件は再処理されない
    かつ 処理順は起票時に固定した target_annotation_ids の配列順である（実行時に並べ替えない）

  シナリオ: AC-B03 残り予算が着手下限を割ったら次回に持ち越す
    前提 未処理が残っているジョブを cron が処理している
    もし 次の1件の予算算出（computeSummaryItemBudgetMs）が null を返す
    ならば その1件には着手せずジョブは pending に戻る
    かつ そこまでの成功・失敗・スキップ件数が保存されている
    かつ 完了メールは送信されない

  シナリオ: AC-B04 全件終わるとメールが1通届く
    前提 未処理が残り1件のジョブを cron が処理している
    もし その1件の処理が終わる
    ならば ジョブは completed になる
    かつ 利用者のメールアドレス宛に完了メールが1通送られる
    かつ メール本文に成功・失敗・スキップの件数と失敗理由の内訳が含まれる

  シナリオ: AC-B05 メールは二重送信されない
    前提 completed かつ送信済みのジョブがある
    もし cron が再び起動する
    ならば そのジョブに対してメールは送られない

  シナリオ: AC-B06 メール未登録なら送信をスキップする
    前提 users.email が未登録の利用者のジョブが完了した
    もし 完了処理が走る
    ならば メールは送られない
    かつ ジョブは completed のまま残る

  シナリオ: AC-B07 二重起票を拒否する
    前提 pending または processing のジョブを持つ利用者がいる
    もし その利用者が「AIで要約」を押す
    ならば 新しいジョブは作られない
    かつ 「すでに要約を実行中です」と表示される

  シナリオ: AC-B08 実行中は進捗が見える
    前提 267件を選択して（mode: ids）起票したジョブがある
    かつ そのジョブは processed_count が 45 / total_count が 267 である
    もし 利用者が /analytics を開く
    ならば 「要約中...（処理済み 45 / 対象 267 件）」が表示される
    かつ 分母は起票時に選択した件数であって未要約件数ではない
    かつ 分母語は「対象」であり、同じ画面のツールバーの「全 M 件」（全記事数）と語が重ならない

  シナリオ: AC-B09 trial ロールは実行できない
    前提 trial ロールの利用者がいる
    もし ジョブ起票の Server Action を直接呼ぶ
    ならば 権限エラーが返る
    かつ ジョブは作られない

  シナリオ: AC-B10 1件の失敗でジョブは止まらない
    前提 本文を取得できない記事が対象に含まれている
    もし cron がその記事を処理する
    ならば その記事は失敗として計上される
    かつ 残りの記事の処理は続行される

  シナリオ: AC-B11 対象上限を超える起票は拒否する
    前提 利用者が 1001 件を指定してジョブ起票を呼ぶ
    もし Server Action を実行する
    ならば 上限超過のエラーが返る
    かつ ジョブは作られない

  シナリオ: AC-B12 他人のジョブは処理しない
    前提 利用者Aのジョブを cron が処理している
    もし 対象IDに利用者Bの記事が含まれている（起票後の所有権変更など）
    ならば その記事は失敗として計上される
    かつ 利用者Bの記事は更新されない

  シナリオ: AC-B13 起票後に手入力された記事は上書きしない
    前提 起票後に利用者が対象記事の8項目を手入力した
    もし cron がその記事を処理する
    ならば その記事に対して要約は生成されない
    かつ 手入力された8項目の値はそのまま保持される
    かつ その記事はスキップとして計上される

  シナリオ: AC-B14 進捗はチャンク境界で保存され、着手済みの記事が飛ばされない
    前提 cron が対象を配列順に3件ずつのチャンク（1〜3 / 4〜6 / 7〜9 / 10〜12 …）で処理している
    かつ 4つ目のチャンクで10件目と12件目が先に完了し、11件目が未完了のまま関数が異常終了する
    もし 次の起動が同じジョブを claim する
    ならば 保存されている processed_count は 9（直近に完了したチャンクの末尾）である
    かつ 3つ目のチャンクまでの成功・失敗・スキップ件数が保存されている
    かつ 処理は10件目から再開される
    かつ 着手済みで未完了だった11件目は飛ばされない
    かつ 再処理される10件目・12件目は BR-B08 の再判定でスキップに計上され、要約は再生成されない

  シナリオ: AC-B15 失敗で終わったジョブも1通だけ通知する
    前提 試行回数が上限（3回）に達し、claim RPC によって failed に落とされたジョブがある
    かつ そのジョブは notified_at が未設定である
    もし 次の cron が起動する
    ならば claim の前の掃き出しで、途中までの件数を含むメールが1通送られる
    かつ さらに cron が起動しても同じジョブにメールは送られない
```

### シナリオ対応表

| AC | 検証方法 | 対応する機能要件 | 対応する業務ルール |
| --- | --- | --- | --- |
| AC-B01 | 実画面 + ユニット | FR-B01 / FR-B02 | BR-B01 / BR-B02 |
| AC-B02 | ユニット（カーソル） | FR-B03 | BR-B01 |
| AC-B03 | ユニット（`computeSummaryItemBudgetMs` のモック） | FR-B05 / FR-B06 | BR-B04 / BR-B09 |
| AC-B04 | 実データ + ユニット | FR-B07 | BR-B06 |
| AC-B05 | ユニット | FR-B07 | BR-B06 |
| AC-B06 | ユニット | FR-B07 | BR-B06 |
| AC-B07 | 実画面 + ユニット | FR-B08 | BR-B03 |
| AC-B08 | 実画面 | FR-B09 | BR-B07 |
| AC-B09 | ユニット | FR-B10 | 権限（§6） |
| AC-B10 | ユニット | FR-B11 | BR-B01 |
| AC-B11 | ユニット | FR-B12 | BR-B02 |
| AC-B12 | ユニット | FR-B11 | 権限（§6） |
| AC-B13 | ユニット | FR-B04 | BR-B08 |
| AC-B14 | ユニット | FR-B06 | BR-B09 |
| AC-B15 | ユニット | FR-B07 | BR-B06 |

## 8. 非機能要件

| 項目 | 要件 | 根拠・備考 |
| --- | --- | --- |
| 1回の cron 起動の実行時間 | `maxDuration = 800` 秒、時間予算 **760 秒**（`CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS` = `(800 - 40) * 1000`）。次の1件に着手してよいかは `computeSummaryItemBudgetMs(elapsedMs)` が `null` を返さないことで判定する | 既存 `CONTENT_ANNOTATION_BULK_SUMMARY_*` を数値ごと踏襲する。実効の着手打ち切りは経過約 **640 秒**、着手済み1件を含む最遅完了は **730 秒**（BR-B04 の導出値であり、実装が比較する閾値ではない） |
| 起動間隔 | 10分（`*/10 * * * *`） | 267件を約30〜60分で完了させるため（算式は §11 ALT-002） |
| 1回の処理件数 | 並列3で 60〜70件（1件約30秒の実測ベース）。**目安であり保証値ではない** | 実測値: 730秒 ÷ 24件 ≒ 30.4秒/件（直列時）。BR-B05 のチャンク境界で3件が揃うのを待つため、実効スループットは理論値（並列3の連続投入）より落ちる。実データ検証で実測する（§13） |
| 1ジョブの上限 | 1000件（`MAX_BULK_SUMMARY_TARGETS`） | 既存の上限を踏襲。`db-max-rows = 1000`（`docs/context/db-row-limits-and-data-truncation.md`）とも整合 |
| LLM のレート制限 | Anthropic のレート上限は**組織単位**で、チャット・GSC提案 cron 等と共有する。Sonnet 4.x の上限は Sonnet 4.6 と 4.5 の**合算**バケット | 公式（確認日 2026-09-04、https://platform.claude.com/docs/en/api/rate-limits ）。Start tier の Sonnet 4.x は 1,000 RPM / 2,000,000 ITPM / 400,000 OTPM。月次 spend cap は Start $500 / Build $1,000。**GrowMate の組織 usage tier は未確認**（Q-B02 の判断材料。§12） |
| 429 到達時の挙動 | 公式は 429 とともに `retry-after` ヘッダを返す。GrowMate としての扱い（失敗に計上 / 未処理として次回 / `retry-after` を待って同一起動内で再試行）は**未決定** | → 確認質問 Q-B02。実装者が裁量で決めない |
| LLM の入出力量 | 1件の入力は本文最大 80,000 文字（`CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS`）＋プロンプト、出力は `maxTokens: 8000`。並列3なので同時実行は最大3件、1件約30秒なら分あたり最大6件 | 概算で 480,000 ITPM / 48,000 OTPM 程度（80,000文字 ≒ 80,000 トークンの上限ケース）。Start tier の上限に対して余裕はあるが、**実測ではないため実データ検証で確認する**（§13）。他機能と共有する組織上限であることに注意 |
| 本文サイズ超過時の扱い | 80,000 文字を超える記事は**削減・切り詰めをせず** `SUMMARY_CONTENT_TOO_LARGE` として失敗に計上する（既存挙動を変更しない） | `llm-context-memory` の「上限超過時の削減順序」に対する明示的な選択。本文の機械的な切り詰めは要約品質を保証できず、利用者にも見えないため。再実行しても同じ結果になる決定的失敗として `FAILURE_LABELS` で案内済み |
| LLM コスト | 1件あたり 4〜13円（`claude-sonnet-4-6`）。267件で約1,860円、1000件で約6,980円（≒ $46） | 入力 $3 / 出力 $15 per 1M。公式（確認日 2026-09-04、https://platform.claude.com/docs/en/about-claude/pricing ）の Claude Sonnet 4.6 の単価と一致。本文8,000字換算で1件約7円。**`mode: 'all'` で1000件を起票しても、LLM 課金が発生するのは BR-B08 の再判定を通過した未要約分のみ**（§6「分母の定義」）。1000件実行1回は月次 spend cap（Start $500）に対して約 $46 |
| ジョブ行のサイズ | 対象ID配列は最大1000件（約16KB） | 配列で保持する。別テーブルへの正規化はしない（MVP） |
| 失敗時の再実行 | 着手予算切れは次回起動で続行。想定外の例外は試行回数上限（`attempt_count >= 3`。最大3回試行）で `failed`。`processing` のまま **20分**以上動いていない行は次回 claim で回収する | 雛形 `claim_gsc_suggestion_jobs` と同型だが、**しきい値は15分から20分へ延ばす**。雛形の cron は `maxDuration` 300秒（余裕10分）だが本仕様は 800秒（13.3分）で、15分のままだと余裕が1.7分しかなく、稼働中のジョブが「スタック」と誤判定されて二重に claim され、同じ記事へ二重課金・件数の二重加算が起きる |
| 外部依存が壊れたときの表示 | 失敗理由コードごとの内訳を完了メールに出す（`FAILURE_LABELS` を共用） | 停止機構は作らない（Non-goals 参照） |

### AI機能の追加観点

- プロンプト・モデル・出力形式は現行のまま変更しない（`content_annotation_ai_summary` テンプレート、`claude-sonnet-4-6`、`maxTokens: 8000`）。
- 本文サイズ上限（80,000文字）も変更しない（超過時は削減せず失敗。上表参照）。
- 1件あたりの LLM タイムアウトは残り時間から算出する現行ロジック（`computeSummaryItemBudgetMs`）を流用する。
- 人間の確認・上書き: 生成結果は8項目に保存され、利用者が `/analytics` で上書きできる。**逆に、利用者が先に手入力した値を要約が上書きしないよう BR-B08 の再判定を必ず行う**（親仕様 BR-01）。
- モデル・プロバイダ障害時: 記事単位で失敗として計上し、ジョブは止めない（AC-B10）。失敗理由は完了メールの内訳に出る。停止機構は作らない（Non-goals）。
- **脚注（Sonnet 5 移行を後で判断するときの根拠）**: 公式（確認日 2026-09-04、https://platform.claude.com/docs/en/about-claude/pricing ）で Claude Sonnet 5 は $2 / $10 per MTok（Sonnet 4.6 は $3 / $15）。またレート制限の公式ページには「Claude Sonnet 5 has a separate rate limit and is not part of this combined bucket.」とあり、**Sonnet 4.x とは別のレート上限バケット**を持つ。移行はクライアント指示でステイ（Non-goals / OPEN-B01）だが、単価とレート枠の両面で有利になる可能性がある。

## 9. データ・外部連携

### データ

**新規テーブル `content_annotation_summary_jobs`**（所有者は起票した利用者。実行履歴であり保持期間の定めは置かない）

| カラム | 型 | 説明 | 根拠・出典 |
| --- | --- | --- | --- |
| `id` | uuid PK | ジョブID | 新規 |
| `user_id` | uuid not null | 所有者。処理時・進捗取得時のスコープに必ず使う | `supabase` skill 運用ルール3 |
| `status` | text not null | `pending` / `processing` / `completed` / `failed` | 既存 `gsc_suggestion_jobs` 踏襲 |
| `job_token` | uuid | claim 時に発行する実行トークン。進捗更新の条件に使う（BR-B09） | 既存 `gsc_suggestion_jobs.suggestion_job_token` と同型（`gscSuggestionJobService.ts:78,96,140`） |
| `target_annotation_ids` | uuid[] not null | 起票時に解決した対象（BR-B02）。**cron はこの配列順で処理し、実行時に並べ替えない**（下の「処理順」） | 新規（BR-B02） |
| `total_count` | integer not null | **起票時に固定した対象ID数**（`target_annotation_ids` の長さ）。要約される見込み件数ではない（§6「分母の定義」） | BR-B07 / AC-B08 |
| `processed_count` | integer not null default 0 | 処理済み位置（`target_annotation_ids` の配列 index を指すカーソル兼用）。**完了したチャンクの末尾までしか進めない**（BR-B09） | 既存 `gsc_suggestion_jobs` 踏襲 |
| `succeeded_count` / `failed_count` / `skipped_count` | integer not null default 0 | 集計。チャンク（最大3件）ごとに更新（BR-B09） | 親仕様の `BulkSummaryResult` 4区分 |
| `failed_by_code` | jsonb not null default '{}' | 失敗理由コードごとの件数 | 親仕様の `failedByCode` |
| `attempt_count` | integer not null default 0 | claim 回数。**3に達したら `failed`（`>= 3`。最大3回試行）** | 既存 `gsc_suggestion_jobs` 踏襲。雛形は `suggestion_attempt_count >= 3` で `failed` に落とし、claim 条件は `< 3`（`supabase/migrations/20260611000000_add_gsc_suggestion_jobs.sql:47,58,64`）＝最大3回試行。同値に揃える |
| `last_error` | text | 直近の想定外エラー。運用担当が失敗原因を追うために持つ | 既存 `gsc_suggestion_jobs` 踏襲 |
| `notified_at` | timestamptz | 完了メール送信済み（BR-B06 の冪等） | BR-B06 / AC-B05 |
| `created_at` / `started_at` / `finished_at` | timestamptz | 時刻。所要時間の測定（§1 成功指標）に使う | 既存 `gsc_suggestion_jobs` 踏襲 |

- **処理順**: `target_annotation_ids` の配列順で固定する。既存の `orderTargetsForProcessing`（`src/server/lib/content-annotation-bulk-summary.ts:60`。親仕様の `updated_at` 昇順・`id` タイブレーク）は**使わない**。`processed_count` が配列 index を指すカーソルであるため、起動のたびに並べ替えるとカーソルの意味が壊れ、同じ記事を処理し続けて前進しない（親仕様 R-006 と同型の罠）。親仕様の処理順からの意図的な変更点であり、親仕様側の追従は不要（本仕様が実行モデルを差し替えることはメタデータに記載済み）。
- 未実行件数は `total_count - processed_count` から導出する（専用カラムは持たない）。
- インデックス: `(status, created_at)` の部分インデックス（`pending` / `processing`）。
- 一意制約: 1利用者につき未完了ジョブは1件（`status in ('pending','processing')` の部分ユニークインデックス。BR-B03 をDB側でも担保）。違反時のエラーは Server Action で捕捉して `SUMMARY_BULK_ALREADY_RUNNING` に変換する（§6）。
- RLS: 利用者は自分の行のみ参照可、書き込みは Service Role のみ。**ただし本リポジトリのサーバー読み取りは `SupabaseService`（Service Role）経由で RLS をバイパスするため、RLS はセキュリティ境界ではなく多層防御**。実際の境界は、`app/analytics/page.tsx` と cron 双方のクエリに `.eq('user_id', userId)` を必ず付けること（`.agents/skills/supabase/service-usage.md` 運用ルール3）。
- 移行・既存データ: 新規テーブルのみ。既存の要約結果（`content_annotations` の8項目）には触れない。

**進捗の読み取り経路**: `app/analytics/page.tsx`（サーバーコンポーネント）で `SupabaseService` から自分の未完了ジョブを1件取得し、`AnalyticsClient` に props で渡す。Server Action / API は増やさない（自動更新をしないため。Non-goals）。

**新規 RPC `claim_content_annotation_summary_jobs(p_limit integer default 1)`**

- `for update skip locked` で最大 `p_limit` 件（既定1件）を排他取得し、`processing` に更新して `attempt_count` を加算し、**新しい `job_token` を発行して返す**。
- `processing` のまま **20分**以上動いていない行は回収対象に含める（関数がハードキルされた場合の復旧。しきい値の根拠は §8「失敗時の再実行」）。
- `attempt_count` が**3に達している行（`>= 3`）**は claim せず `failed` に落とす（最大3回試行。雛形と同値）。雛形と同じく**この経路で `failed` になった行は `return query` で返さない**ため、アプリ層はその行を一度も見ない。完了メールは下の「完了メールの起動経路」の掃き出しが送る（AC-B15）。
- `security definer` / `set search_path = public`、実行権限は `service_role` のみ（`anon` 不可を migration 内で検査する。`20260831010000` の前例に倣う）。
- `p_limit default 1` なので**1起動につき1ジョブ**。複数利用者のジョブは直列化する（§1 成功指標の注記 / Non-goals「複数ジョブの同時実行」）。

**cron 定義値**（`src/server/lib/cron-definitions.ts` の `CRON_CONFIGS` へ追加。既存エントリは全項目必須で、`tests/unit/server/lib/cron-config-consistency.test.ts` が workflow / route / `invoke-cron.sh` との一致を検査する）

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| キー | `contentAnnotationSummary` | 既存の命名（camelCase） |
| `name` | `content_annotation_summary` | 既存の命名（snake_case） |
| `workflowId` | `content-annotation-summary` | workflow matrix の `id` と一致させる |
| `routePath` | `/api/cron/content-annotation-summary` | 既存 `/api/cron/*` と同型 |
| `profile` | `count-batch` | 既存 profile は `gsc-batch` / `gsc-suggestions` / `count-batch` の3つのみ（`scripts/invoke-cron.sh`）。件数集計＋メール送信型なので `count-batch`（`ga4ContentEvaluate` / `googleAdsNegativeKeywords` と同じ） |
| `maxDuration` | `800` | route の `export const maxDuration` と一致必須 |
| `maxTime` | `820` | `maxTime > maxDuration`。`googleAdsNegativeKeywords`（`maxDuration: 800`）の前例と同値 |
| `maxRetries` | `1` | **メール送信バッチのため再実行しない**（既存の慣例。`ga4ContentEvaluate` / `googleAdsNegativeKeywords` のコメント）。既定の3にすると 504（`maxDuration` 超過）でリトライが走り、同じジョブが並走して二重課金・メール重複を招く |
| `timeoutMinutes`（workflow 側） | `20` | `maxTime × maxRetries` を収める。既存エントリと同値 |

**cron ルートのレスポンス形（実装契約）**

`scripts/invoke-cron.sh` の `validate_count_batch()`（`:123-158`）が読むのは `success` / `data.failed` / `data.skipped` / `data.skippedDueToLimit` / `data.stoppedReason` の5キーで、**job を FAIL にするのは `success != true` と `data.failed > 0` の2つだけ**（他は `::warning::` 止まり）。本機能は記事単位の失敗が正常系（AC-B10 / R-B01: WordPress.com 利用者のジョブが全件失敗しうる）なので、記事単位の失敗数を素直に `data.failed` に載せると**1件でも失敗した起動がすべて GitHub Actions の job 失敗**になり、運用担当（§2）への通知が常時鳴る。逆にキーを載せなければジョブ処理そのものの故障も検知できない。そこで次の形で返す（新規 profile は追加せず、`count-batch` のセマンティクスにレスポンスを合わせる）。

| キー | 内容 | 検証スクリプトでの扱い |
| --- | --- | --- |
| `success` | claim・進捗保存・メール送信・ジョブ単位の想定外例外で**運用が気づくべき失敗が1件も無ければ** `true` | `false` なら job FAIL |
| `data.failed` | **ジョブ処理そのものの失敗数**（claim 失敗、進捗保存失敗、メール送信失敗、ジョブ単位の想定外例外）。**記事単位の失敗は含めない** | `> 0` なら job FAIL |
| `data.articleSucceeded` / `data.articleFailed` / `data.articleSkipped` | この起動で処理した**記事単位**の集計（正常系） | 参照されない（実行ログとして残る） |
| `data.processedJobs` / `data.notified` | この起動で処理したジョブ数（`0` は空振り＝正常）と送信した完了メール数 | 参照されない |
| `data.skipped` / `data.skippedDueToLimit` / `data.stoppedReason` | **キーを載せない**。時間予算での持ち越しは本仕様の正常系（BR-B04）であり、載せると毎起動で `::warning::` が出て慢性化する。持ち越しは `data.carriedOver`（boolean）に載せる | 省略時は 0 / 空として扱われ、警告は出ない |

**マイグレーション/ロールバック**

- 適用: テーブル + インデックス + RPC を1ファイルで追加。`npm run supabase:types` で型を再生成する。
- ロールバック: `drop function` → `drop table`。ジョブは実行履歴であり、失われても記事データ（要約結果）には影響しない。

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Anthropic API | 要約生成 | 既存の `llmChat` 経由（`claude-sonnet-4-6`）。レート上限は組織単位で他機能と共有 | 記事単位で失敗に計上し、ジョブは続行（AC-B10）。429 の扱いは未決定（Q-B02） | https://platform.claude.com/docs/en/api/rate-limits ・ https://platform.claude.com/docs/en/about-claude/pricing （確認日 2026-09-04。引用は §8 / §12） |
| WordPress（self-hosted / WordPress.com） | 本文取得 | `fetchWpPostContentLive`。**cron 実行時はブラウザの Cookie が無い** | 本文取得失敗は `SUMMARY_CONTENT_FETCH_FAILED` として失敗に計上（LLM 呼び出し前なので LLM 課金は発生しない） | **未照合**（`developer.wordpress.com` / `developer.wordpress.org` が実行環境の egress proxy にブロックされ取得不可。§16）。以下は実コードのみを根拠とする |
| Resend | 完了メール | 既存 `EmailService` に**新規メソッドを追加**。宛先は `public.users.email` | 送信失敗時は `notified_at` を更新せず、次回の cron 起動の**掃き出し経路**が再送する（下の「完了メールの起動経路」） | **未照合**（`resend.com` がブロック。§16） |
| GitHub Actions | 10分間隔の起動 | 新規ワークフロー1本（`CRON_SECRET` を渡して `scripts/invoke-cron.sh` を実行） | 失敗は GitHub Actions の通知で運用担当が検知する（§2）。何を失敗とみなすかは上の「cron ルートのレスポンス形」 | **一部確認済み**: リポジトリが public であることは 2026-09-04 に GitHub API で確認（§10）。`schedule` の遅延・ドロップ・60日無活動での自動停止の挙動は**未照合**（`docs.github.com` がブロック。§16 / §10 制約条件） |

**cron からの `generateSummary` 呼び出し経路（実装契約）**

- 現行 `contentAnnotationSummaryService.generateSummary` の `cookieStore: ReadonlyRequestCookies` は**必須**で、`withAuth` が供給している（`src/server/services/contentAnnotationSummaryService.ts:110-113`、`:150` で `getCookie: name => cookieStore.get(name)?.value` として `fetchWpPostContentLive` へ渡る）。cron にはセッションが無い。
- 対応: **`cookieStore` を任意化する**（または `getCookie: (name: string) => string | undefined` を注入できるようにする）。cron からは cookie を持たない `getCookie`（常に `undefined` を返す）を渡し、**DB 保存トークン経路のみ**を使う。cron ルートで `cookies()` を呼んで空の cookieStore を渡すような場当たりの実装はしない。
- 既存のフォールバック経路（実コードで確認済み）: `wordpressContext.ts:38` は `getCookie(WPCOM_TOKEN_COOKIE_NAME) || wpSettings.wpAccessToken || ''`、`wordpressContentSync.ts:176-178` は Cookie が無ければ `refreshWpComAccessToken(userId, supabase, wpSettings)` を呼ぶ。ただし `refreshWpComAccessToken` は「`wpAccessToken` があり、かつ `wpTokenExpiresAt` が60秒以内」のときしかリフレッシュせず、`wpAccessToken` が空なら即 `null`（＝`SUMMARY_CONTENT_FETCH_FAILED`）を返す。**「実際には失効しているのに `wpTokenExpiresAt` が NULL / 未来日」のケースはリフレッシュされない**。→ Q-B01。
- **失効時に利用者へ何と伝えるか（未定義だった論点）**: 現在の `FAILURE_LABELS.SUMMARY_CONTENT_FETCH_FAILED` は「WordPress から本文を取得できない（連携先と違うサイトの記事か、記事が削除・非公開）」で、**トークン失効という実態と食い違う**。完了メールで再連携導線に誘導するかを含め、Q-B01 の回答（実データで該当利用者が存在するか）を待って決める。存在しないなら現行ラベルのままとする。

**`EmailService` への追加（実装契約）**

- 既存の公開メソッドは `sendGoogleAdsAnalysis` / `sendGoogleAdsNegativeKeywords` / `sendGa4ContentEvaluation` の3つのみで、いずれも `htmlContent: string` を受ける。**汎用の送信口は無いため新規メソッドが必須**。
- 追加: `sendContentAnnotationSummaryCompletion(to: string, subject: string, htmlContent: string)`（既存3メソッドと同じ引数形）。
- 件名・差出人: 既定の差出人は `GrowMate <noreply@mail.growmate.tokyo>`（`DEFAULT_EMAIL_FROM`。`EMAIL_FROM` 環境変数で上書き可）。**件名の文言と差出人表記は未確定** → Q-B03。
- 本文構成: (1) 対象件数（`total_count`）、(2) 成功・失敗・スキップ・未実行の件数、(3) `describeFailures(failed_by_code)` による失敗内訳、(4) `failed` で終わった場合は「途中までの結果である」旨、(5) `/analytics` へのリンク。

**完了メールの起動経路（実装契約）**

ジョブを `failed` に落とす主体（claim RPC。SQL 内で完結する）とメールを送る主体（アプリ層）が別なので、**アプリ層が一度も見ないまま終了するジョブが存在する**。BR-B06 の「終了時に1通」を成立させるため、起動経路を次の2つに分けて定義する。

1. **同一起動内での送信**: cron がジョブを最後まで処理して `completed` にした場合、または想定外の例外で `failed` にした場合は、その起動の中で完了メールを送り、成功したら `notified_at` を更新する（AC-B04）。
2. **未通知ジョブの掃き出し**: cron ルートは claim の**前**に、`status in ('completed','failed')` かつ `notified_at is null` のジョブを `created_at` 昇順で**最大10件**取得し、完了メールを送る。これが (a) claim RPC が `attempt_count >= 3` で `failed` に落とした行（AC-B15）、(b) 経路1で送信に失敗した行の再送（外部連携 Resend 行）、(c) 送信直前のハードキル、をまとめて拾う。これが無いと、`completed` かつ `notified_at is null` の行は claim 対象（`pending` / `processing`）に含まれないため二度と拾われない。
   - 取得は Service Role で行い全利用者のジョブが対象になるが、**宛先は取得した行の `user_id` から解決（`public.users.email`）し、他の `user_id` の情報を混ぜない**（`supabase` skill 運用ルール3）。
   - 冪等: 送信成功後に `.is('notified_at', null)` を条件にした更新で印を付ける（AC-B05）。起動の重なりによる二重送信は workflow の `concurrency`（§10）で抑止する。
   - 最大10件は1起動の時間予算（BR-B04）を圧迫しないための件数上限。残りは次回の起動で送る。

## 10. 制約・前提・依存関係

### 技術前提

- Vercel Pro（関数の `maxDuration` 最大800秒）。**公式ドキュメントは未照合**（`vercel.com` が実行環境の egress proxy にブロック。§16）。既存 `app/analytics/page.tsx` と `googleAdsNegativeKeywords` cron が 800 秒で運用できている実績を根拠とする。
- cron は GitHub Actions からの HTTP 起動（既存 `.github/workflows/hourly-cron.yml` と同じ方式。`scripts/invoke-cron.sh` を呼ぶ）。10分間隔は別ワークフローとして追加する。
- 既存の cron 観測基盤（`src/server/lib/cron-definitions.ts` / `cron-observability.ts`）と、その整合性テスト（`tests/unit/server/lib/cron-config-consistency.test.ts`）に載せる。

#### 再利用する既存実装

| 用途 | 既存実装 | 扱い |
| --- | --- | --- |
| ジョブ雛形 | `src/server/services/gscSuggestionJobService.ts` / `supabase/migrations/20260611000000_add_gsc_suggestion_jobs.sql` | **拡張**（スタック回収を15分→20分。理由は §8） |
| 時間予算・1件予算 | `src/server/lib/content-annotation-bulk-summary.ts` の `computeSummaryItemBudgetMs` | **再利用**（定数・挙動とも変更しない） |
| 対象条件の判定 | 同ファイルの `isSummaryEmpty` / `isWordPressLinkedForSummary` | **再利用**（BR-B08 の再判定で使う） |
| 並列度 | `src/server/services/gscEvaluationService.ts:20` `EVALUATION_CONCURRENCY = 3` | **再利用**（同値を別定数で持つ） |
| 並列処理の形 | 同ファイル `:97-118`（`for (i += CONCURRENCY)` + `Promise.all` のチャンク処理。時間予算の判定もチャンク先頭） | **再利用**（BR-B05 のチャンク境界・BR-B09 の保存粒度はこの既存形と同型） |
| 処理順の整列 | `src/server/lib/content-annotation-bulk-summary.ts:60` の `orderTargetsForProcessing` | **使わない**（配列順で固定。理由は §9「処理順」） |
| 要約本体 | `src/server/services/contentAnnotationSummaryService.ts` の `generateSummary` | **拡張**（`cookieStore` の任意化。§9） |
| 失敗ラベル | `src/lib/content-annotation-bulk-summary-display.ts` の `FAILURE_LABELS` / `describeFailures` | **拡張**（`export` を付けて共用。`getBulkSummaryToastMessage` 自体は共用しない） |
| メール送信 | `src/server/services/emailService.ts` | **拡張**（新規メソッド追加。§9） |
| 権限判定 | `src/server/lib/ga4-permissions.ts` の `canWriteGa4` | **再利用** |
| cron ルート | `app/api/cron/ga4-content-evaluate/route.ts` の共通ガード（`CRON_SECRET` の Bearer 認証） | **再利用**（同型で新規ルートを作る） |

### 制約条件

- GitHub Actions のスケジュールは数分程度ずれることがある（10分間隔は「おおむね10分」）。高負荷時の遅延・ドロップ、および60日無活動時の自動無効化の条件は**公式未照合**（§16）。
- **リポジトリは public であることを確認済み**（2026-09-04、GitHub API の repository オブジェクトで `private=false` / `visibility=public`）。したがって §11 ALT-002 の前提どおり、空振り起動（1日約144回）の実行時間は課金されない。将来 private 化する場合の再検討条件と算術は ALT-002「将来変更する条件」に置く。
- **新規ワークフローにも `concurrency` を張る**: 起動間隔10分 < 1回の最大実行13.3分なので実行が重なりうる。既存 `hourly-cron.yml` と同型に `concurrency: { group: ..., cancel-in-progress: false }` を設定する。
- **`if` の schedule 文字列も新しい cron 式に合わせる**: 既存 `.github/workflows/hourly-cron.yml` は各ステップに `if: github.event_name == 'workflow_dispatch' || github.event.schedule == '0 * * * *'` を置いている（`:73` / `:79`）。同型でコピーして `'0 * * * *'` のままにすると、**`workflow_dispatch` では動くのに定期実行だけ何もしない**ワークフローになる。新規ワークフローでは `github.event.schedule == '*/10 * * * *'` に直す（検証は §14 チェックポイント「手順3完了時」）。
- **整合性テストの前提が変わる**: `tests/unit/server/lib/cron-config-consistency.test.ts` は `readFileSync('.github/workflows/hourly-cron.yml')` をハードコードし、`CRON_CONFIGS` の宣言と workflow matrix を `toStrictEqual` で突き合わせる。10分間隔を別ファイルにすると新エントリが matrix に見つからず必ず失敗するため、**同テストを複数ワークフロー対応に更新する**（§13）。
- Anthropic の組織レート制限はチャット・GSC提案 cron 等と共有する。並列3は実測で調整する前提とする（§8）。
- ジョブ処理・進捗取得はともに Service Role で行うため、`user_id` スコープの明示が必須（`supabase` skill の運用ルール3）。
- **`app/analytics/page.tsx` の `maxDuration = 800` は削らない**。背景化後も Instagram 手動同期のために独立して必要（`page.tsx:20-23` のコメント）。`CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC` の帰属は cron ルート側へ移すが、`tests/unit/server/lib/analytics-max-duration.test.ts` が同定数と `page.tsx` のリテラルを突き合わせているため、**定数の帰属先とテストの突き合わせ先を実装時に決めて同テストを更新する**（§13 / §14 手順3）。

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| 先行 PR shoma-endo/GrowMate#515（同期実行版） | `summarizeContentAnnotationsBulk` と周辺の純ロジック（`computeSummaryItemBudgetMs` / `FAILURE_LABELS` / 定数）がマージ済み | main に含まれていること | 本仕様の土台が無く着手できない |
| 確認質問 Q-B01 | WordPress.com の Cookie 無し取得可否と、成立しない利用者の扱いの決定 | PO 回答 + 実データ検証 | WordPress.com 利用者のジョブが全件失敗しうる（R-B01） |
| 確認質問 Q-B02 | 429 の扱いの決定 | PO 回答 | 完了メールの件数の意味が実装者裁量で決まる |
| 確認質問 Q-B03 | 完了メールの件名・差出人表記 | PO / クライアント回答 | 実装後に文面差し替えの手戻り |

## 11. トレードオフ判断

### ALT-001: 実行モデル（同期のまま並列化 vs バックグラウンド化）

- 判断: 「1回押すだけで全件終わる」を満たす実行モデルを選ぶ。
- 比較した案:
  - 案A: 同期実行のまま並列化する。
  - 案B: ジョブテーブル + cron によるバックグラウンド化。
- 採用案: **案B（バックグラウンド化）**。
- 採用理由: 並列化だけでは1回60〜70件が上限で、267件なら依然4回の操作が必要。「1回で完了」という要件を満たさない。
- 却下した案と理由: 案A は工数が小さい（1.5〜2人日）が、要件そのものを満たさない。
- 影響: DB・cron・通知の実装が増える（本方式は5.5人日）。運用対象の cron が1本増える。
- 将来変更する条件: Vercel の関数実行上限が大幅に伸び、1回で1000件を処理できるようになった場合。
- 判断者・判断日: 未確定（本書は下書き。§16 承認表）。

### ALT-002: 起動間隔（毎時 vs 10分）

- 判断: 新規 cron の起動間隔。
- 比較した案:
  - 案A: 既存の毎時 cron（`hourly-cron.yml`）に相乗りする。
  - 案B: 10分間隔の新規ワークフローを1本追加する。
- 採用案: **案B（10分間隔の新規ワークフロー）**。
- 採用理由: 案A では267件で約11時間かかり（4起動分の処理を1時間おきに実行）、「その日のうちに終わる」体験にならない。
- 算式（§1 成功指標の根拠）: `267件 ÷ 60〜70件/起動 ≒ 4起動`。1起動は最大 730 秒 ≒ 12.2分かかるため 10 分間隔でも実質は直列化し、`4 × max(10分, 12.2分) ≒ 49分`。よって目安は **約30〜60分**。
- 却下した案と理由: 案A は追加ワークフローが不要だが、所要時間が要件に合わない。
- 影響: ワークフローが1本増える。空振り起動が1日約144回発生する（pending 0件なら即座に返る）。**リポジトリが public であることは確認済み（2026-09-04、GitHub API で `visibility=public`）なので、この空振りの実行時間は課金されない**（§10 制約条件）。
- 将来変更する条件: **リポジトリを private 化する場合**（1日144回 × 30日 = 4,320 job-run/月。分単位切り上げ課金なら概算 4,320 分/月となり、Free 2,000 分 / Pro・Team 3,000 分の月次無料枠を既存 `hourly-cron.yml` の 96 job-run/日と合わせて超えるため、10分間隔そのものを再検討する）。または利用者数が増えて claim の直列化が問題になった場合（`p_limit` の引き上げか間隔短縮を検討）。
- 判断者・判断日: 未確定。

### ALT-003: 対象IDの保持方法（起票時に固定 vs 実行時に再解決）

- 判断: cron が処理する対象集合の決め方。
- 比較した案:
  - 案A: 実行のたびに母集団を再解決する。
  - 案B: 起票時に解決して配列で保存する。
- 採用案: **案B（起票時に固定して配列で保存）**。
- 採用理由: 案A は `updated_at` 降順の母集団が処理のたびに入れ替わり、同じ記事を処理し続けて前進しない（親仕様 R-006 と同じ罠）。
- 却下した案と理由: 案A は起票後に追加された記事も拾えるが、前進しないという致命的な欠陥がある。
- 影響: 起票後に追加された記事は対象に入らない（利用者は次回の実行で拾う）。**「対象集合」は固定するが「要約してよいか」の判定は固定しない**（BR-B08）。
- 将来変更する条件: 母集団の解決順序が `updated_at` 非依存になった場合。
- 判断者・判断日: 未確定。

### ALT-004: 通知手段（画面のみ vs メール）

- 判断: 完了をどう知らせるか。
- 比較した案:
  - 案A: 画面の進捗表示のみ。
  - 案B: 完了時にメール1通。
- 採用案: **案B（完了時にメール1通）**。**クライアント合意済み（2026-09-04）**。
- 採用理由: 放置が前提の機能なので、画面に戻ってこない利用者に結果が届かない。
- 却下した案と理由: 案A は実装が軽いが、要件（放置してよい）と噛み合わない。
- 影響: `users.email` 未登録の利用者には届かない（AC-B06 でスキップと定義）。`EmailService` に新規メソッドが必要（§9）。
- 将来変更する条件: アプリ内通知の仕組みが別途導入された場合。
- 判断者・判断日: クライアント（2026-09-04 合意）。

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-B01 | cron 実行時に Cookie が無く、WordPress.com の本文取得が失敗する利用者がいる | `wp_access_token` が空、または実際には失効しているのに `wp_token_expires_at` が NULL / 未来日の利用者。そのジョブが全件失敗する（本文取得失敗は LLM 呼び出し前なので LLM 課金は発生しない）。失敗ラベルも実態と食い違う（§9） | 実装前に「`wp_type = 'wordpress_com'` かつ `wp_access_token` が NULL、または `wp_token_expires_at` が過去」の利用者を実データで数える。存在する場合の扱いは Q-B01 | 実装者 + PO | 未対応（Q-B01 待ち） |
| R-B02 | 並列3で Anthropic の 429 が増える | 組織単位のレート上限を他機能と共有する（§8）。失敗件数が増え、利用者に「失敗」として見える | 並列数を定数1箇所で変更可能にし、実測で調整。429 の扱いは Q-B02（公式は `retry-after` を返すため「待って再試行」も選択肢） | 実装者 + PO | 未対応（Q-B02 待ち） |
| R-B03 | GitHub Actions のスケジュール遅延 | 完了までの時間が想定より延びる | 「約30〜60分」は目安として案内する。厳密な時刻保証はしない | 実装者 | 対応済（仕様に明記） |
| R-B04 | 誤って1000件を起票した場合、停止できない | 最大約7,000円（≒ $46）の LLM 課金 | キャンセル導線は作らない合意（Non-goals）。BR-B03 で1ジョブに限定し、上限1000件で頭打ちにする。BR-B08 の再判定により、既に要約済みの記事には課金が発生しない | PO | 対応済（合意） |
| R-B05 | ジョブが `processing` のままスタックする | 利用者が再実行できない（BR-B03 に阻まれる） | claim RPC で**20分**以上動いていない行を回収する（`maxDuration` 13.3分に対する余裕。§8） | 実装者 | 対応済（仕様に明記） |
| R-B06 | 稼働中のジョブが二重に claim され、二重課金・件数の二重加算が起きる | 回収しきい値が `maxDuration` に近すぎる場合、または `maxRetries` を既定の3にした場合 | 回収しきい値20分、`maxRetries: 1`、`job_token` 条件付きの進捗更新（BR-B09）、workflow の `concurrency` の4点で防ぐ（§8 / §9 / §10） | 実装者 | 対応済（仕様に明記） |
| R-B07 | GitHub Actions の課金前提（public リポジトリ）が誤っている | **現時点では発生条件が成立しない**。将来 private 化した場合のみ、概算 4,320 分/月で無料枠（Free 2,000 / Pro・Team 3,000 分）を超える | 2026-09-04 に GitHub API の repository オブジェクトで `private=false` / `visibility=public` を確認済み。private 化する場合の再検討条件は ALT-002「将来変更する条件」に移した | 実装者 | **対応済（前提を確認）** |

### 確認質問

回答が出るまで実装に進めない事項。**本ランでは解消できず、`spec-review` のブロッカーとして残る。**

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-B01 | cron 実行（Cookie 無し）で WordPress.com 連携の本文取得が成立するか。成立しない利用者がいる場合、(a) 起票時に検証して拒否する / (b) 実行して失敗に計上し完了メールで理由を伝える / (c) 該当記事だけスキップに計上する のどれを採るか。あわせて、トークン失効時に完了メールで再連携へ誘導するか | 利用者に見える結果が「実行できません」か「全件失敗のメール」かで正反対になる挙動変更。現在の失敗ラベル（「連携先と違うサイトの記事か、記事が削除・非公開」）はトークン失効という実態と食い違う | PO（+ 実データ検証） | 未定 | **未回答（クライアント確認中）** |
| Q-B02 | Anthropic の 429 に当たった記事を (a) 失敗に計上する / (b) 未処理として次回の起動に回す / (c) 公式が返す `retry-after` を待って同一起動内で再試行する のどれにするか | 完了メールの4区分の意味（再実行で進むのか否か）が変わる。実装者の裁量で決めてはならない。判断には GrowMate の組織 usage tier と実測の分あたり消費量が必要（§8） | PO | 未定 | **未回答（クライアント確認中）** |
| Q-B03 | 完了メールの件名・差出人表記の指定はあるか。既存3種のメール（Google Ads 分析 / 除外キーワード / GA4 コンテンツ評価）と体裁を揃えるか | 利用者に届く成果物の文面。未確定のまま実装すると差し替えの手戻りになる | PO / クライアント | 未定 | **未回答（クライアント確認中）** |

- Q-B02 の判断材料（公式一次情報。https://platform.claude.com/docs/en/api/rate-limits 、確認日 2026-09-04）:

  > If you exceed any of the rate limits you will get a [429 error](...) describing which rate limit was exceeded, along with a `retry-after` header indicating how long to wait.

  解釈（引用と分離）: 公式が `retry-after` の返却を明記しているため、選択肢 (c)「待って同一起動内で再試行」は技術的に成立する。ただし1件あたりの時間予算（BR-B04）を圧迫するため、待機の上限も併せて決める必要がある。

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-B01 | Claude Sonnet 5 への移行 | クライアント指示で一旦ステイ。移行しても本仕様の構造（ジョブ・cron・通知）は変わらず、モデル ID の差し替えで完結する | 単価・レート枠の見直しを行うとき（判断材料は §8 の脚注） | PO / クライアント |
| OPEN-B02 | Message Batches API によるコスト半減 | 投入・ポーリング・結果回収が現行と別実装になり、本仕様の cron モデルを作り直すことになる。MVP 最優先の範囲を超える | LLM コスト削減が要件として上がったとき | PO |
| OPEN-B03 | 評価サイクル一括開始のバックグラウンド化 | LLM を使わず1回で1000件処理できるため、現時点で困っていない | 評価一括で時間超過の申告が出たとき | PO |

## 13. テスト・リリース・ロールバック

### テスト方針

- ユニット（新規）:
  - ジョブ状態遷移（`pending` → `processing` → `pending` / `completed` / `failed`）
  - カーソル前進と再開（AC-B02。処理順が `target_annotation_ids` の配列順で、実行時に並べ替えられないこと）
  - **チャンク境界での進捗保存と異常終了後の再開**（AC-B14）: 並列3で**完了順が配列順と入れ替わった**状態（チャンク内の後ろの記事が先に完了）で異常終了させ、`processed_count` が直近に完了したチャンクの末尾で止まること、再開時に**着手済みで未完了だった記事が飛ばされず全件処理される**こと
  - 着手予算切れの打ち切りと件数保存（AC-B03。`computeSummaryItemBudgetMs` が `null` を返すケースをモックする。**経過秒数の閾値比較ではなく戻り値で判定していることを検証する**）
  - **実行直前の再判定（AC-B13）**: 起票後に8項目が埋まった記事は `generateSummary` を呼ばずスキップに計上し、既存の値を更新しないこと
  - 完了メールの冪等（AC-B05）、メール未登録時のスキップ（AC-B06）、`failed` 終了時の送信（AC-B15。**claim RPC が `attempt_count >= 3` で `failed` に落とした行が、次回起動の掃き出しで通知されること**）
  - 送信に失敗した場合に `notified_at` が更新されず、次回起動の掃き出しで再送されること（§9「完了メールの起動経路」）
  - cron ルートのレスポンスが §9 の契約どおりであること（**記事単位の失敗が `data.failed` に載らない**。`data.skipped` / `data.stoppedReason` を載せない）
  - 二重起票の拒否（AC-B07。**事前検出とユニーク制約違反の両方**で `SUMMARY_BULK_ALREADY_RUNNING` が返ること）、上限超過（AC-B11）、権限（AC-B09）
  - 並列実行時の件数集計が直列時と一致すること
  - 進捗取得クエリに `.eq('user_id', ...)` が付いていること（§6 権限）
- 既存テストの更新:
  - `tests/unit/server/actions/contentAnnotationBulkSummary.actions.test.ts`（同期実行前提の記述 → 起票の戻り値 `{ jobId, totalCount }` へ）
  - `tests/unit/server/lib/cron-config-consistency.test.ts`（cron 定義の追加。**`readFileSync('.github/workflows/hourly-cron.yml')` のハードコードを複数ワークフロー対応にする**。§10）
  - `tests/unit/server/lib/analytics-max-duration.test.ts`（`CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC` の帰属先が cron ルートへ移るため、突き合わせ先を更新する。**`app/analytics/page.tsx` の `maxDuration = 800` は Instagram 手動同期のために残す**）
  - `tests/unit/lib/content-annotation-bulk-summary-display.test.ts`（`FAILURE_LABELS` / `describeFailures` の `export` 追加に伴う確認。`getBulkSummaryToastMessage` の既存挙動は変えない）
- 手動確認（`quality-gate` の実画面確認に対応）:
  - 実データで50件程度のジョブを流し、複数回の cron 起動をまたいで完了すること
  - 完了メールが1通だけ届き、件数が画面の集計と一致すること
  - 実行中の進捗表示、二重起票の拒否
  - **`processing` のまま20分放置した行が次回 claim で回収されること**（R-B05 / FR-B13）
  - 並列3実行時の Anthropic 消費量（ITPM / OTPM）を実測し、§8 の概算と突き合わせる
- 静的: `npm run verify`（audit / lint / test / build / knip）、`bash scripts/check-ui-text.sh`

### リリース方針

1. マイグレーションを本番へ適用（`supabase db push`）し、型を再生成する。**この作業は PR マージ後の運用作業であり、完了条件（§15）には含めない。**
2. アプリをデプロイする。
3. GitHub Actions のワークフローを有効化する（マージ時点で有効になるため、順序に注意）。
   - アプリ未デプロイの状態で cron が動いてもジョブが存在しないため空振りで終わる（安全側）。

### ロールバック方針

- アプリ: デプロイ巻き戻し。実行中ジョブは `processing` のまま残るが、cron が動かなければ処理は進まない。
- cron: ワークフローを無効化する。
- DB: テーブルと RPC を drop する（実行履歴のみで、要約結果には影響しない）。
- ロールバック判断者: 運用担当（`/analytics` の一括要約が動かない、または完了メールが誤配信された場合）。

## 14. 実装手順・チェックポイント

### 手順

1. マイグレーション（テーブル + `job_token` + インデックス + RPC + 権限検査）と型再生成。
2. ジョブ処理サービス（claim → **配列順に3件ずつのチャンクで処理** → **チャンク着手の直前にその3件を再取得して BR-B08 を再判定** → **チャンクが揃ってから `job_token` 条件付きで進捗保存** → 完了判定 → 完了メール）。ジョブ雛形は既存 `GscSuggestionJobService`、チャンク処理の形は `GscEvaluationService`（`:97-118`）と同型にする。
   - `contentAnnotationSummaryService.generateSummary` の `cookieStore` を任意化し、cron からは cookie 無しの `getCookie` を渡す（§9）。
   - 処理順は `target_annotation_ids` の配列順で固定し、`orderTargetsForProcessing` は使わない（§9「処理順」）。
   - **対象記事の取得は、着手するチャンク（最大3件）ごとに行う。** ジョブ全体をループ前に `chunkIds(ID_QUERY_CHUNK_SIZE)` で一括取得して振り分ける同期版の形（`src/server/actions/contentAnnotationBulkSummary.actions.ts:188-246`）は採らない。採ると BR-B08 の再判定が最大12分前（1起動分）のスナップショットに基づくことになり、「`generateSummary` の直前」を満たさないため。1回の取得は最大3 ID なので PostgREST の `db-max-rows = 1000` にも触れない。
3. cron ルート追加（**レスポンス形は §9 の契約に合わせる**。未通知ジョブの掃き出しを claim の前に置く）、`CRON_CONFIGS` へ登録（値は §9 の表）、10分間隔ワークフロー追加（`concurrency` 付き。**各ステップの `if` の schedule 文字列を `*/10 * * * *` にする**。§10）。`CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC` の帰属先を決め、`analytics-max-duration.test.ts` を更新する。
4. 完了メール（`EmailService` の新規メソッド + HTML 本文 + `notified_at` による冪等 + `failed` 時の文面 + **未通知ジョブの掃き出し**。§9「完了メールの起動経路」）。
5. Server Action を起票に差し替え、二重起票を拒否（`SUMMARY_BULK_ALREADY_RUNNING` を `ERROR_MESSAGES` に追加）。
6. 画面（実行直後のトースト、進捗ラベル、`page.tsx` での進捗取得、UI 文言辞書の更新）。
7. テスト追加・更新、`npm run verify`、実データ確認。

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 着手前 | Q-B01 / Q-B02 / Q-B03 の回答が揃っている（リポジトリ visibility は public を確認済みのため確認不要。§10） | PO / 実装者 | 未確認 |
| 手順1完了時 | `anon` から RPC を実行できない | 実装者 | 未確認 |
| 手順3完了時 | `workflow_dispatch` で手動起動し、pending 0件で即座に返る。**さらに初回の `schedule` 起動が実際に発火し、`if` ガードでステップがスキップされていないことを実行ログで確認する**（§10） | 実装者 | 未確認 |
| 手順5完了時 | 起票が3秒以内に返る（AC-B01）。同時2クリックで `SUMMARY_BULK_ALREADY_RUNNING` が返る | 実装者 | 未確認 |
| 手順7完了時 | 実データで複数回の起動をまたいで完了し、メールが1通である。起票後に手入力した記事が上書きされない（AC-B13） | 実装者 | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - [ ] AC-B01〜AC-B15 をすべて満たす
  - [ ] `npm run verify` が exit 0、`scripts/check-ui-text.sh` が緑
  - [ ] 実データで50件以上のジョブが、複数回の cron 起動をまたいで完了する
  - [ ] 完了メールが1通だけ届き、件数が画面の集計と一致する
  - [ ] **ローカル／ステージングでマイグレーションを適用し、`anon` から RPC を実行できないことを確認済み**（本番適用は §13 リリース方針の運用作業であり、完了条件には含めない）
  - [ ] README 更新の要否を `spec-to-pr` の `readme_sync` が判断済み（🏗️アーキテクチャ図・📁プロジェクト構成が候補）
- 検証方法・証跡: `npm run verify` の出力、`/analytics` の実画面確認（実行直後・実行中・二重起票）、受信した完了メール、cron 実行ログ（`batch_completed`）。
- 完了確認者・確認日: 未確定。

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 1 | 2026-09-04 | 2 / 13 / 4 | 全19件を反映（`docs/plans/.workflow/content-annotation-bulk-summary-background-spec/review/03-revise.md`） | 下記「残置合意」を参照 |
| 2 | 2026-09-04 | 0 / 5 / 4 | 全9件（F-20〜F-28）を反映。1周目の反映によって生じた矛盾の解消が中心（並列3とカーソルの両立不能、`failed` 通知の起動経路欠落、`count-batch` の判定セマンティクス、public 確定、UI 分母語の二義） | 下記「2周目で決めた設計判断」を参照 |

**残置合意した論点と理由**

- **`mode: 'all'` の進捗分母（F-04）**: 分母 `total_count` は「起票時に固定した対象ID数」であり、「要約される見込み件数」ではない。分母を見込み件数にするには起票時に全件の8項目と WordPress 連携状態を判定する追加処理が必要で、MVP の範囲を超える。**挙動を仕様として明記するに留め、実装は変えない**（§6「分母の定義」）。
- **`failed` 終了時の完了メール（F-09）**: 状態遷移図が当初から「`failed` でも完了メール送信」としていたのに BR-B06 が `completed` のみを定義しており自己矛盾していた。**新機能を足すのではなく、既に本文にあった記述（状態遷移図）へ BR と AC を揃える**ことで解消した（BR-B06 / AC-B15）。放置前提の機能で失敗時に何も届かないと、利用者が待ち続けるため。
- **クライアント合意済みで変更しない3点**: キャンセル導線を作らない / 通知は全件完了後にメール1通 / Claude Sonnet 5 移行はステイ（いずれも 2026-09-04 合意）。
- **`getBulkSummaryToastMessage` の共用取りやめ（F-09）**: 当初の「文面を共用する」方針は、プレーンテキスト・誤った再実行案内・同期版トーストの破壊という3点で成立しない。ラベル辞書のみの共用に変更した（`EmailService` の新規メソッド追加は既存に汎用送信口が無いため不可避で、過剰実装ではない）。
- **`job_token` カラムと回収しきい値20分の追加（F-05 / F-06）**: 新規の安全機構ではなく、雛形 `gsc_suggestion_jobs`（`suggestion_job_token`・スタック回収）の同型踏襲。しきい値だけ `maxDuration` 800秒に合わせて15分→20分へ延ばした。

**2周目（cycle 2）で決めた設計判断と理由**

いずれも「仕様の矛盾を解消するために契約を1つ確定させた」ものであり、要件外の安全機構は追加していない（`CLAUDE.md` Core Rules / MVP 最優先）。

- **進捗の持ち方をチャンク境界にした（F-20）**: 「並列3」「`processed_count` が単一カーソル」「1件ごとの加算保存」は同時に成立しない（完了順が配列順と入れ替わると、着手済みで未完了の記事を飛ばしたまま `completed` になる）。採った案は**チャンク境界でのみカーソルと集計を進める**形（BR-B05 / BR-B09）。カーソル用カラムの追加や完了済み集合の保持ではなく既存 `GscEvaluationService`（`:97-118`）と同じ `for (i += CONCURRENCY)` + `Promise.all` の形で、**新規カラム・新規機構を増やさずに済む最小の設計**であるため。失われる幅は高々3件で、再処理分は BR-B08 の再判定でスキップになる。
- **完了メールの起動経路を2つに分けた（F-21）**: claim RPC は雛形（`20260611000000_add_gsc_suggestion_jobs.sql:41-48`）と同じく `failed` に落とした行を返さないため、アプリ層が見ないまま終了するジョブが存在し、AC-B15 が実装できない状態だった。claim RPC の戻り値を雛形から変える案ではなく、**cron ルート内に「未通知ジョブの掃き出し」を1ステップ置く案**を採った。送信失敗時の再送（§9 外部連携 Resend 行）も同じ経路で成立し、雛形からの逸脱が無いため。
- **cron ルートのレスポンス形を定義した（F-22）**: `scripts/invoke-cron.sh` の `count-batch` は `data.failed > 0` を job FAIL にするため、記事単位の失敗（本仕様では正常系）を `data.failed` に載せると運用通知が常時鳴る。**新規 profile を足さず**、`data.failed` を「ジョブ処理そのものの失敗」に限定し、記事単位は別キーに載せる契約を §9 に置いた。
- **進捗ラベルの分母語を「対象」にした（F-24）**: 既存ツールバーの「全 M 件」（＝利用者の全記事数 `annotationTotalCount`）と同じ語で別の母数を指す状態を避けるため。実装への影響は文言のみ。
- **処理順を配列順に固定した（F-25）**: 親仕様の `updated_at` 昇順（`orderTargetsForProcessing`）からの意図的な変更。`processed_count` が配列 index を指すカーソルであるため、実行時に並べ替えると前進しなくなる。親仕様側の追従は不要。
- **`attempt_count` の上限表現を `>= 3`（最大3回）に揃えた（F-26）**: 「既存雛形踏襲・同値」という根拠列と実コード（`suggestion_attempt_count >= 3`）に合わせた。
- **BR-B08 の再判定をチャンク単位の再取得と定義した（F-28）**: 同期版のループ前一括取得をそのまま持ち込むと、再判定が最大12分前のスナップショットになる。取得単位を最大3 ID にすることで「直前」を満たし、`db-max-rows` の懸念も生じない。

**未解決のブロッカー（次サイクルへ持ち越し）**

- Q-B01 / Q-B02 / Q-B03 が未回答（クライアント確認中）。3件の回答が揃うまで verdict は `approved` にならず `approved_with_questions` 止まり。
- 承認表（本節）が空欄。ステータスは `draft` のままで、承認者・対象リリースが未確定。
- （解消済み）リポジトリ visibility は 2026-09-04 に **public** を確認したためブロッカーから外した。GitHub Actions で未照合のまま残るのは `schedule` の遅延・高負荷時のドロップ・60日無活動での自動停止の挙動のみ（`docs.github.com` が egress ブロックのため）。

#### 公式ドキュメント照合

- 実施 / 未実施: **実施（一部未確認）**。確認日 2026-09-04、取得手段 WebFetch（リポジトリ visibility のみ GitHub API の repository オブジェクト）。
- 照合済み:

  | 対象 | URL | 結果 |
  | --- | --- | --- |
  | Claude 価格 | https://platform.claude.com/docs/en/about-claude/pricing | 照合済み。Sonnet 4.6 は $3 / $15 per MTok で §8 の記述と一致。Sonnet 5 は $2 / $10 |
  | Claude レート制限 | https://platform.claude.com/docs/en/api/rate-limits | 照合済み。組織単位・Sonnet 4.x は 4.6/4.5 合算・429 に `retry-after` |
  | Message Batches API | https://platform.claude.com/docs/en/build-with-claude/batch-processing | 照合済み。「reducing costs by 50%」「most batches finishing in less than 1 hour」。Non-goals の記述と一致 |
  | リポジトリ visibility（公式ドキュメントではなく GitHub API の1次情報） | GitHub API の repository オブジェクト（`shoma-endo/GrowMate`） | 確認日 2026-09-04。`private=false` / `visibility=public`。§10 / ALT-002 / R-B07 の課金前提はこれで確定（`docs.github.com` の課金ページ自体は引き続き未照合） |

- **未確認（実行環境の egress proxy にブロックされ取得不可。実装前に照合し、verbatim 引用と確認日をここへ追記すること）**:

  | 対象 | URL | 影響する記述 |
  | --- | --- | --- |
  | WordPress.com OAuth2 | https://developer.wordpress.com/docs/oauth2/ | R-B01 / Q-B01（トークン期限・リフレッシュ挙動）。現状は実コードのみを根拠にしている |
  | WordPress.com REST（本文取得） | https://developer.wordpress.com/docs/api/ | §9 外部連携 |
  | WordPress REST API（posts） | https://developer.wordpress.org/rest-api/ | §9 外部連携（self-hosted） |
  | Resend 送信 API | https://resend.com/docs/api-reference/emails/send-email | §9（送信レート・冪等キーの有無。`notified_at` 自前冪等の妥当性） |
  | GitHub Actions `schedule` | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule | §10 制約条件（最小間隔・遅延・ドロップ・60日無活動での自動停止）。**課金前提は visibility の確定により解消済み**（下記） |
  | Vercel Functions duration | https://vercel.com/docs/functions/configuring-functions/duration | §10 技術前提（Pro の `maxDuration` 800秒） |
  | Supabase RLS / `security definer` | https://supabase.com/docs/guides/database/postgres/row-level-security | §9（判断は `.agents/skills/supabase/*` を正本として実施済み） |

- 未確認項目について、記憶・二次情報による代替の照合は行っていない。

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 | 未確定 | 未承認 |  | Q-B01〜Q-B03 の回答待ち |
| 技術レビュー | 未確定 | 未承認 |  | ステータス `draft`・対象リリース未確定 |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-04 | 初版作成 | クライアント合意（キャンセル導線なし / 完了時にメール1通 / Sonnet 5 移行はステイ）を反映 | Claude（Cloud セッション） |
| 2026-09-04 | `spec-review` サイクル1の指摘19件を反映（BR-B08 / BR-B09 / FR 表 / AC-B13〜B15 / cron 定義値 / 時間予算の数値訂正ほか） | 🔴 F-01（親 BR-01 の実行直前再検証の欠落）・🔴 F-02（時間予算730秒と既存定数760秒の矛盾）を含む監査指摘の解消 | Claude（spec-review revise） |
| 2026-09-04 | `spec-review` サイクル2の指摘9件（F-20〜F-28）を反映（BR-B05 / BR-B09 をチャンク境界に再定義、完了メールの起動経路、cron ルートのレスポンス形、public 確定、進捗ラベルの分母語、処理順の固定、`attempt_count >= 3`、`schedule` ガード、BR-B08 の再取得粒度） | サイクル1の反映によって生じた矛盾（並列3と単一カーソルの両立不能で記事を飛ばす／`failed` 通知に起動経路が無い／`count-batch` が記事単位の失敗で job を FAIL にする）の解消 | Claude（spec-review revise） |
