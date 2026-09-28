# cron 定期起動の Vercel Cron への移行

## メタデータ

- 文書名: cron 定期起動の Vercel Cron への移行
- ステータス: `approved`
- 作成日: 2026-09-24
- 最終更新日: 2026-09-24
- 作成者: shoma-endo（Claude Code で作成）
- 承認者: 未承認
- 対象リリース: 未定（spec-review 通過後、最短で）
- 関連する依頼・Issue・PR:
  - grill-to-gherkin の実行記録: `.takt/runs/20260924-113606-task/reports/`（`01-grill.md`〜`06-estimate-confirmation.md`）
  - 更新する既存仕様書: `docs/specs/content-annotation-bulk-summary-background-spec.md`
  - 影響を受ける未実装の仕様書: `docs/plans/ga4-sync-cron-spec.md`（§10 依存関係）

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - GitHub Actions の `schedule` が **2026-08-26 UTC 15時頃から** ほとんど起動していない。毎時の cron 4本と10分間隔の cron 1本が、仕様どおりに動いていない。
  - `hourly-cron.yml` の1日あたりの起動回数（GitHub API の `actions/workflows/hourly-cron.yml/runs?event=schedule` の `total_count` を日別に集計した）:

    | 期間 | 1日あたりの起動回数 |
    | --- | --- |
    | 2026-08-20〜08-25 | 22〜23回 |
    | 2026-08-26 | 16回（UTC 15時以降に急減） |
    | 2026-08-27〜09-23 | 2〜8回 |

  - `content-annotation-summary-cron.yml`（`*/10 * * * *`、本来は1日144回）は、2026-09-10〜09-23 に1日5〜8回しか起動していない。
  - 原因はリポジトリ側ではない。
    - 障害が始まった時点で、`main` 上の workflow は変わっていない（GA4 評価ジョブが `main` に入ったのは 2026-08-27 04:14 UTC で、障害開始より後）。
    - 各 run は `created_at == run_started_at` で、ランナーの空き待ちではない。起動イベントそのものが遅れるか、発生していない。
    - GitHub Community の #207346 / #206019 に、同じ日付からの同じ症状が報告されている。#207346 は「The start of this lines up exactly with the Actions incidents on 2026-08-26」と書いており、private リポジトリでの報告である。cron 時刻の変更・ファイル名の変更・無効化と再有効化・`main` への push では直らないとの報告がある。GitHub の公式回答は無い（2026-09-24 確認）。
  - 週次・月次の workflow（active-users / db-stats / vercel-stats / supabase-backup / api-changelog）は、数時間遅れながらも毎回起動している。
- 放置した場合の影響:
  - 利用者（`paid` / `admin`）: GSC 評価・GA4 評価・除外キーワード提案メール・GSC 改善提案が、1日約6回しか処理されない。処理の遅れと、配信時刻のずれが続く。
  - AI 要約一括（`docs/specs/content-annotation-bulk-summary-background-spec.md`）: 「267件で約30〜60分」の目安を満たせず、完了まで数時間かかる。
  - リポジトリを private 化すると、Actions の無料枠（Free 2,000分/月）を正常時の起動回数で超える（§8 コスト）。

### 目的

- この開発で実現する状態:
  - `/api/cron/*` の5ルートを Vercel Cron が現行の頻度（UTC）で起動する。
  - GitHub Actions の2つの cron workflow は定期起動をやめ、手動実行の手段としてだけ残す。
  - Vercel Cron が同じ起動を2回届けても、利用者にメールが二重に届かず、LLM の二重課金も起きない。
- 利用者・事業にとっての価値:
  - 評価・提案・要約が、仕様どおりの頻度で処理される。
  - private 化したときの Actions 分数の問題も同時に解消する（private 化そのものは対象外。§4）。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 毎時 cron 4本の起動 | 1日2〜8回（2026-08-27〜） | 本番デプロイ以降、確認時点までの全区間で、4本それぞれ起動間隔が1時間を大きく超えて空く区間が無い | Vercel のログ（`requestPath:/api/cron/<route>`）で起動時刻を数える | 本番デプロイから24時間以内（R-08） |
| 10分 cron の起動 | 1日5〜8回 | 本番デプロイ以降、確認時点までの全区間で、起動間隔が20分以上空く区間が無い | 同上（`/api/cron/content-annotation-summary`） | 本番デプロイから24時間以内（R-08） |
| 二重起動による二重送信 | 未計測 | 0件 | FR-006 / FR-007 の単体テスト。本番では Resend の送信履歴と `gsc_article_evaluation_history` で、同一ユーザー・同一対象・同日の重複が無いこと（Vercel のログは1日で消えるため、1週間の確認には使わない。R-08） | 実装時 / 本番デプロイ後1週間 |

- 起動回数を「ちょうど24回・144回」で判定しない理由: Vercel 公式は配信を「best effort」としている（§9 外部連携）。起動の抜けで判定する。
- 起動間隔の測定を「本番デプロイから24時間以内」に行う理由: Pro の runtime log の保持は1日で（§9 外部連携）、翌日以降に見ると最初の起動のログが消えている（R-08）。

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | `paid` / `admin` の利用者 | 画面・操作は変わらない。評価・提案・要約が現行の頻度で届く |
| 運用担当 | GrowMate 開発チーム | 失敗を Vercel のログで毎日確認する（ログの保持は1日。R-08）。必要なら GitHub Actions の `workflow_dispatch` で手動実行する |
| 管理者・承認者 | PO | 本仕様の承認 |
| 外部サービス・連携先 | Vercel Cron / GitHub Actions | Vercel Cron が定期起動する。GitHub Actions は手動実行と週次・月次の処理を担う |

### 主な利用シナリオ

1. **Vercel Cron** が、**UTC の毎時0分と10分ごと**に、5ルートを `Authorization: Bearer <CRON_SECRET>` 付きの GET で呼び出す。
2. **運用担当**が、**cron の失敗や遅れに気づいたとき**に、Vercel のログで該当ルートの起動とエラーを確認し、必要なら GitHub Actions から手動で実行する。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
GitHub Actions schedule（hourly-cron.yml: 0 * * * * / content-annotation-summary-cron.yml: */10 * * * *）
  -> scripts/invoke-cron.sh が curl で GET /api/cron/<route>（Bearer CRON_SECRET）
  -> 応答を profile ごとに判定し、失敗なら job を赤にする（GitHub から失敗メール）
  -> concurrency グループで同じルートの重複起動を待たせる
※ 2026-08-26 から schedule がほぼ起動しない
```

### 導入後（To-Be）

```text
Vercel Cron（vercel.json の crons。UTC）
  -> GET /api/cron/<route>（CRON_SECRET を Authorization: Bearer で自動付与）
  -> ルートは既存どおり認証し、処理する。例外は console.error（logRouteFailure）と HTTP 500
  -> 失敗は Vercel のログ（Settings > Cron Jobs > View Logs）で確認する
  -> 同じ起動が2回届いても、各処理の claim（条件付き更新 / skip locked）で1回分しか処理しない

手動実行（運用担当）
  -> GitHub Actions の workflow_dispatch（hourly-cron.yml / content-annotation-summary-cron.yml）
  -> 従来どおり invoke-cron.sh が呼び出し、応答を判定する
```

### 業務ルール

| ID | ルール | 例外 |
| --- | --- | --- |
| BR-01 | 5ルートの定期起動元は Vercel Cron だけにする。GitHub Actions の `schedule` と併用しない（ALT-002） | なし |
| BR-02 | 起動頻度は現行と同じにする。4本は `0 * * * *`、要約は `*/10 * * * *`（UTC） | なし |
| BR-03 | 同じルートが同時に2回起動されても、利用者へのメール・LLM 呼び出し・評価履歴の保存が二重にならない（FR-006、FR-007） | GSC 評価のうち評価行を更新しないエラー経路（一括取込の失敗 `import_failed`、`system_error`）のエラー履歴は、重複を許容する（R-07） |
| BR-04 | 失敗の検知は Vercel のログで行う。新しい通知経路は作らない（ALT-003）。ログの保持は1日なので、運用担当が毎日確認する（R-08） | なし |

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。

### 対象範囲

- 画面・操作: 対象外（UI の変更は無い）。
- API・外部連携:
  - `vercel.json` を新設し、`crons` に5ルートを登録する（FR-001）。
  - ルートの認証コードは変えない（FR-002）。
- データ・DB: 対象外（テーブル・RPC・migration の追加は無い）。二重起動対策は既存テーブルへの条件付き更新で行う（FR-006）。
- 権限・ロール: 対象外（認証の契約を変えない。§6 権限）。
- 運用・監視:
  - GitHub Actions の `hourly-cron.yml` / `content-annotation-summary-cron.yml` から `schedule` と `github.event.schedule` の条件を外し、`workflow_dispatch` を残す（FR-003）。
  - `CRON_CONFIGS` に `schedule` を足し、整合性テストで `vercel.json` と照合する（FR-004 / FR-005）。
- 二重起動対策（CON-003 のユーザー判断 B。2026-09-24）:
  - 除外キーワード提案の `markAttempt` を条件付き更新に変える（FR-006）。
  - 残り4ルートの二重起動時の挙動を §6 で1本ずつ確認し、二重送信・二重課金が起きうるものだけ同じ方式で直す（FR-007）。
- ドキュメント:
  - `docs/specs/content-annotation-bulk-summary-background-spec.md` の、GitHub Actions を起動元とする記述をすべて更新する（FR-008。CON-007 のユーザー判断 B）。目安は28か所で、§2、§10、ALT-002、R-B03、R-B07、スループット試算、§14 の手順を含む。
  - ルート内コメントの起動元の記述を更新する（FR-009。OPEN-001 を作成者が「対象にする」と決めた。3ファイル6行で、放置するとコードのコメントが実態と食い違うため）。
  - `docs/PROJECT_OVERVIEW.md` の cron の記述（2か所）を更新する（FR-009）。
  - README 更新予告: `README.md:299`（「デプロイと運用」の「GitHub Actions: 毎時 Cron（…4ルート）、10 分間隔 Cron（`content-annotation-summary`…）」）が、起動元の変更に伴う更新の候補になる。更新するかどうかは spec-to-pr の `readme_sync` が判定する。

### Non-goals（今回の対象外）

| 対象外にするもの | 対象外にする理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| cron 失敗時の新しい通知（Lark・メール） | MVP 優先。Vercel のログで確認できる（ALT-003） | ログだけでは見逃しが実際に起き、運用上の損失が出た場合 |
| `scripts/invoke-cron.sh` の応答判定とリトライの Vercel 側への移植 | 要件に無い安全機構になる。各処理は次の起動で拾い直す（ALT-003） | 同上 |
| ロック基盤（Redis 等）による同時起動の排他 | 二重起動の害（二重送信・二重課金）は既存テーブルの条件付き更新で防げる。新しい基盤は要らない | 条件付き更新では防げない処理が新しく増えた場合 |
| 週次・月次 workflow の移行 | 数時間遅れながらも毎回起動している（§1） | 週次・月次でも起動の欠落が起きた場合 |
| リポジトリの private 化 | GitHub の設定変更だけで済み、コードの変更が無い。本仕様のマージ後に別途判断する | 本仕様のマージ後 |
| 外部 scheduler、Ubicloud runner、GitHub の復旧待ち | ALT-001 で却下 | ALT-001「将来変更する条件」 |
| 要約処理そのものの要件の変更 | 起動元の移行と無関係 | なし |
| 実装済み仕様書（`docs/specs/ga4-content-evaluation-spec.md`、`docs/specs/google-ads-negative-keywords-suggestion-design.md`）の起動元記述の更新 | 実装時点の設計記録として残す。起動元の正本は本仕様書とする。要約仕様書だけは更新対象にした（CON-007 のユーザー判断） | 当該機能を改修するとき |
| 未実装の `docs/plans/ga4-sync-cron-spec.md` の書き直し | 別仕様の設計変更になる。§10 依存関係に影響を書く | 同仕様の実装に着手するとき |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態（基本分と追加分で分けて書く）:
  - 基本分（EST-001〜EST-010）: `合意済み`（2026-09-24、合意者 shoma-endo。grill-to-gherkin の estimate_confirm で着手承認。`.takt/runs/20260924-113606-task/reports/06-estimate-confirmation.md`）。この承認の時点では CON-003 は A 案で、重複起動の防止（`markAttempt` の修正を含む）は対象外だった。同ファイルは、方針を変えて `markAttempt` を直す場合の参考値を +0.5〜1.0人日としている。
  - 追加分（EST-011、+1.0〜2.0人日）: `合意済み`（2026-09-24、合意者 shoma-endo。spec-review 1回目の後に、合計 2.85〜5.95人日として合意）。着手承認の後に、ユーザーが 2026-09-24 に CON-003 を B に変えたことによる追加で、§6 の確認で対象が3ルートになったため、上の参考値より大きい。
- 含めるもの: 仕様書、実装、単体テスト、`npm run verify`、本番での確認
- 含めないもの: 仕様レビューの往復、ユーザー確認の待ち時間

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 設計 | 本仕様書（EST-001）、要約仕様書の更新（EST-002） | 6〜12 | 0.75〜1.5 |
| 実装 | `vercel.json`、`CRON_CONFIGS`、workflow 2本、コメント（EST-003〜006） | 2〜5.6 | 0.25〜0.7 |
| 二重起動対策 | 除外キーワード提案・GSC 評価・GA4 評価の条件付き確保（EST-011） | 8〜16 | 1.0〜2.0 |
| テスト | 整合性テスト、`npm run verify`（EST-007〜008） | 2.8〜6 | 0.35〜0.75 |
| レビュー | spec-review での公式照合（EST-009） | 2〜4 | 0.25〜0.5 |
| リリース準備 | 本番での確認（EST-010） | 2〜4 | 0.25〜0.5 |
| **合計** |  | **22.8〜47.6** | **2.85〜5.95** |

幅の理由: 要約仕様書の更新（28か所、試算の書き直しを含む）と、EST-011 の GA4 評価（クールダウンを進めない場合の巻き戻しがある）。

### 内訳

| ID | 内容 | 工数（人日） |
| --- | --- | ---: |
| EST-001 | 本仕様書の作成 | 0.25〜0.5 |
| EST-002 | 要約仕様書の起動元記述の更新（FR-008） | 0.5〜1.0 |
| EST-003 | `vercel.json` の新設（FR-001） | 0.1〜0.25 |
| EST-004 | `CRON_CONFIGS` に `schedule` を追加（FR-004） | 0.05〜0.1 |
| EST-005 | workflow 2本から schedule を外す（FR-003） | 0.1〜0.25 |
| EST-006 | ルート内コメントと `PROJECT_OVERVIEW.md` の更新（FR-009） | 0〜0.1 |
| EST-007 | 整合性テストの更新（FR-005） | 0.25〜0.5 |
| EST-008 | `npm run verify` | 0.1〜0.25 |
| EST-009 | spec-review での Vercel 公式照合 | 0.25〜0.5 |
| EST-010 | 本番での確認（§13 本番確認項目） | 0.25〜0.5 |
| EST-011 | 二重起動対策（FR-006 / FR-007。3ルート）。テスト込み | 1.0〜2.0 |

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: 本仕様の spec-review 1〜2回。
- クライアント確認・たたき台合意の見込み: 不要（利用者から見た仕様の変更が無い）。
- 希望リリース時期との関係: 障害が続いているため、最短でリリースする。スコープは削らない。

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | `vercel.json` の `crons` に5ルートを登録する。`0 * * * *`: gsc-evaluate / ga4-content-evaluate / google-ads-negative-keywords-suggestion / gsc-suggestions。`*/10 * * * *`: content-annotation-summary | Must | D-01 | Rule「5つの cron エンドポイントは…」 |
| FR-002 | 5ルートの認証（GET、`Authorization: Bearer ${CRON_SECRET}`、不一致は 401、未設定は 500）を変えない | Must | D-06 | Rule「cron ルートの認証契約は…」 |
| FR-003 | `hourly-cron.yml` / `content-annotation-summary-cron.yml` から `on.schedule` と、ステップの `if` にある `github.event.schedule` の条件を外す。`workflow_dispatch`、matrix、`invoke-cron.sh` の呼び出し、`concurrency` は残す。書き換え後の実態と合わなくなる workflow 内のコメント（`content-annotation-summary-cron.yml:3` の「10分ごとに起動する」と、`:9-11` の `if` の schedule 文字列についての注意書き）も直す | Must | D-02、ALT-002 | Rule「2つの cron workflow は…」 |
| FR-004 | `CRON_CONFIGS`（`src/server/lib/cron-definitions.ts`）の5件に `schedule` を追加する | Must | D-04、ALT-004 | Rule「cron の宣言と Vercel の cron 定義の整合性…」 |
| FR-005 | 整合性テスト（`tests/unit/server/lib/cron-config-consistency.test.ts`）を更新する。`vercel.json` の `{path, schedule}` の集合と `CRON_CONFIGS` の `{routePath, schedule}` の集合が一致すること、`invoke-cron.sh` を呼ぶ workflow に `schedule` が残っていないことを検証する。既存の検証のうち、matrix の一致・`maxDuration` の一致と `maxTime > maxDuration`・profile・503/504 の分類・`concurrency` は残す。`if` ガードと schedule の一致の検証だけを置き換える | Must | D-04 | 同上 |
| FR-006 | 除外キーワード提案の `markAttempt`（`src/server/services/googleAdsNegativeKeywordsSuggestionService.ts:517`）を条件付き更新にする。更新の条件は「`last_attempted_on IS NULL` または `last_attempted_on` が当日以外」で（列は NULL を許す。`supabase/migrations/20260803000000_add_last_attempted_on_to_negative_keywords_settings.sql:16`。初めて送る利用者は NULL）、`.eq('user_id', userId)` を必ず付ける。更新できた場合だけ処理を続ける。結果の扱いは次のとおり。(1) 0行更新（もう一方の起動が先に確保した）は `{ success: true, skipped: true }` を返し、バッチの `summary.skipped` に数える（既存のスキップの返し方。`:258-262`、`:418-420`）。(2) DB エラーは現行どおり `NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED` を返し、送信しない。(3) 共有メソッド `supabaseService.updateGoogleAdsNegativeKeywordsSettings`（`supabaseService.ts:1294-1324`。0行更新を `SETTINGS_NOT_FOUND` の失敗として返し、Server Action `googleAdsNegativeKeywordsSuggestion.actions.ts:136` と共有）の契約は変えず、確保には専用の条件付き更新を使う（具体的な方法は plan で決める）。(4) 手動実行の `force: true` 経路（`googleAdsNegativeKeywordsSuggestion.actions.ts:181`。`markAttempt` を通らない。Service `:134`）は対象外で、変えない | Must | CON-003 のユーザー判断 B（2026-09-24）、BR-03 | Rule「同じ起動が2回届いても二重に処理しない」 |
| FR-007 | gsc-evaluate と ga4-content-evaluate を、FR-006 と同じ方式（既存の列への条件付き更新で記事ごとに確保し、確保できた起動だけが処理する）で直す。確保の条件は NULL を扱う（抽出時の値が NULL なら `IS NULL`、そうでなければ「抽出時の値と等しい」）。対象の経路・確保に負けたときの集計先・対象外の経路は §6「冪等性・重複実行時の挙動」 | Must | 同上。§6 の確認結果 | 同上 |
| FR-008 | `docs/specs/content-annotation-bulk-summary-background-spec.md` の、GitHub Actions を起動元とする記述をすべて移行後の構成に直す。要約処理の要件は変えない | Should | D-05、CON-007 のユーザー判断 B | Rule「一括要約の仕様書は…」 |
| FR-009 | ルート内コメント（`gsc-evaluate/route.ts:8,16,48`、`ga4-content-evaluate/route.ts:8,53`、`content-annotation-summary/route.ts:9,58`）と `docs/PROJECT_OVERVIEW.md` の起動元の記述を直す | Could | OPEN-001 を作成者が決定 | なし（シナリオ化しない。レビューで確認する） |

### 入力・出力・状態遷移

- 入力値・形式・必須条件: Vercel Cron からの GET。`Authorization: Bearer <CRON_SECRET>`。パラメータ無し。
- 正常時の出力: 各ルートの既存の JSON 応答（変更なし）。
- エラー時の出力: 既存どおり。認証不一致は 401、`CRON_SECRET` 未設定は 500、処理中の例外は `logRouteFailure` を通して 500。
- 状態と遷移条件: 既存どおり（本仕様で状態は増やさない）。
- 冪等性・重複実行時の挙動:
  - 前提: Vercel 公式は「Cron delivery can also occasionally invoke the same scheduled run more than once.」としている（§9）。移行後は、同じルートが同時に2回起動されうる。これまでは Actions の `concurrency` が重なりを防いでいた。
  - 5ルートの確認結果:

    | ルート | 二重起動時の挙動 | 判定 | 対応 |
    | --- | --- | --- | --- |
    | google-ads-negative-keywords-suggestion | `markAttempt` が `last_attempted_on` を条件なしで UPDATE する（`googleAdsNegativeKeywordsSuggestionService.ts:130-142,517-526`）。2つの起動がともに「確保できた」と判断し、同じユーザーにメールが2通届く | 二重になりうる | FR-006 |
    | gsc-evaluate | 対象の抽出は通常の SELECT で、確保（claim）が無い（`gscEvaluationService.ts:452-466`）。評価行の更新は条件なしの UPDATE（`:348-358`。`:313-322`、`updateCooldown` `:605-614` も同じ）で、その後に `gsc_article_evaluation_history` へ INSERT する（`:365-381`）。同テーブルには一意制約が無い（`supabase/migrations/20251123090000_create_gsc_metrics_and_evaluations.sql:80-98`）。2つの起動が同じ記事を処理すると履歴が2行でき、各行が `suggestion_status='pending'` なので gsc-suggestions が2回 LLM を呼ぶ（二重課金。利用者には提案が2件見える）。エラー時の履歴（no_metrics `:251-263`、position が null `:285-297`、system_error `:172-184`）も二重になる。エラー行は `suggestion_status` を持たないので LLM 呼び出しの対象にはならない | 二重になりうる | FR-007 |
    | ga4-content-evaluate | 対象の抽出は RPC `list_due_ga4_content_evaluations`（`supabase/migrations/20260826000300_harden_list_due_ga4_content_evaluations.sql:21-63`）で、ロックの無い SELECT。`start_ga4_content_evaluation`（`20260826000100_…sql:54-73`）は実行中の重なりだけを防ぎ、先の起動が終わった後に同じ記事へ来た起動は通す。記事ごとに LLM で説明文を作り（`ga4ContentEvaluationService.ts:433,485`）、履歴行を作り、評価メールを送る。メールの重複防止（`ga4_last_notified_history_id` と Resend の Idempotency-Key。`ga4ContentEvaluationBatchService.ts:631-632,697-711,755-759`）は履歴 ID が鍵なので、別の履歴 ID を持つ2回目は止まらない。クールダウンの前進も条件なしの UPDATE（`advanceCooldown` `:589-611`） | 二重になりうる（LLM・履歴・メール） | FR-007 |
    | gsc-suggestions | RPC `claim_gsc_suggestion_jobs`（`supabase/migrations/20260611000000_add_gsc_suggestion_jobs.sql:50-92`）が `for update skip locked` で確保し、トークンを付け替える。`processing` の行を取り直すのは15分後で、`maxDuration` 300秒より長い。書き込みはトークンで守られている（`gscSuggestionService.ts:210-216`、`gscSuggestionJobService.ts:84-99,129-142`） | 安全（ただし gsc-evaluate が作った重複行はそのまま処理する。gsc-evaluate の対策で解消） | なし |
    | content-annotation-summary | RPC `claim_content_annotation_summary_jobs` が `for update skip locked` で確保し、`job_token` を付け替える（`supabase/migrations/20260904000000_add_content_annotation_summary_jobs.sql:124-152`）。1利用者1件の部分一意インデックス（`:49`）。進捗・完了の書き込みは `job_token` で守られる（`contentAnnotationSummaryJobService.ts:340-350,378-385`）。完了メールの掃き出しは2つの起動が同時に試みうるが、Resend の Idempotency-Key がジョブ ID なので重複しない（`:727-733`） | 安全 | なし |

  - 確認日: 2026-09-24（コードと migration を読んで確認。実行しての確認はしていない）。
  - FR-007 で直すのは gsc-evaluate と ga4-content-evaluate の2本。方式は FR-006 と同じで、既存の列を条件付きで更新し、更新できた起動だけがその記事を処理する。
    - 確保の条件（両ルート共通）: 対象の列は NULL を許し（`last_evaluated_on`: `supabase/migrations/20251123090000_create_gsc_metrics_and_evaluations.sql:51`、`ga4_last_evaluated_on`: `20260826000000_merge_ga4_content_evaluation_into_gsc_cycle.sql:24`）、NULL の行（初回評価前の記事）も抽出の対象になる（`gscEvaluationService.ts:571`、`src/types/database.types.pending.ts` の `Ga4DueEvaluationRow` のコメント）。`=` の比較だけで書くと NULL の行は必ず確保に失敗し、スキップ扱いのままログにも出ずに永久に処理されない。このため、抽出時の値が NULL なら `IS NULL`、そうでなければ「抽出時の値と等しい」を条件にする。更新には既存どおり `.eq('user_id', userId)` を付ける。
    - gsc-evaluate: 確保の対象は、評価行を更新する経路に限る。
      - 対象の経路: 初回のベースライン記録（`:313`）、評価成功（`:348`。現行でも履歴 INSERT より前）、メトリクスが無い no_metrics（`:251-276` の `bulkImportFailed === false` の場合）、position が null（`:282-309`）。no_metrics と position が null の2経路は、`updateCooldown`（`:605-614`）を履歴 INSERT より前に移し、条件付きにする。
      - 評価行の更新を条件付きにし、更新できなければ履歴を INSERT せず、その記事をスキップする。
      - 対象外の経路: 一括取込に失敗した経路（`:251-276` の `bulkImportFailed === true`。履歴を INSERT するが評価行を更新しない）と system_error（`:130-133` → `logSystemError` `:165-192`）。エラー行は `suggestion_status` を持たず、LLM 呼び出しの対象にならないため、§4 の「二重送信・二重課金が起きうるもの」に当たらない。この2経路のエラー履歴の重複は許容する（R-07）。
      - 手動実行の経路: `processEvaluation` は手動実行の経路（`gscDashboard.actions.ts:1199` の `force: true`、`gscImport.actions.ts:87`、`app/api/gsc/evaluate/route.ts:29`）と共有されているので、同じ確保がこれらにも効く。
      - 確保に負けた記事の集計: エラー（`skippedSystemError`）にも処理済み（`processed` / `improved` / `advanced` / `baselineInitialized`）にも数えず、スキップとして数える（バッチの `totalSkipped` に合算する。ユーザー単位の結果で専用の件数を持つかは plan で決める）。
    - ga4-content-evaluate: 記事ごとの処理（`runDueArticle` の呼び出し。`ga4ContentEvaluationBatchService.ts:304`）の前に、`ga4_last_evaluated_on` を抽出時の値から当日へ条件付きで更新して確保する。確保できなければスキップする。処理の結果クールダウンを進めない場合（`shouldAdvanceCooldown === false`）は、確保で書いた値を抽出時の値へ戻す（戻す更新は「`ga4_last_evaluated_on` が当日である場合だけ」の条件付きにする。`updated_at` は同じ行を毎時0分に GSC 評価も更新するため、確保の識別に使わない）。これで「次の毎時に再試行する」現行の挙動を保つ。
      - 確保に負けた記事の集計: `articlesEvaluated` にも `articlesFailed` にも数えず、スキップとして数え、`batch_completed` ログの `skipped` に含める（結果オブジェクトでの件数名は plan で決める）。
      - no_progress 判定（`:379-385`。`usersAttempted > 0 && articlesEvaluated + articlesFailed === 0` のとき `articlesFailed += 1`）には、確保に負けた記事を「進捗なし」として含めない。重複して届いた2回目の起動が全記事の確保に負けた場合、その起動は失敗ではなく、スキップだけで終わった実行として扱う（`failed` を増やさない）。
      - 対象外の経路: 取込失敗の分岐（`:294-301`）は確保の位置（`:304`）より前にあり、確保の対象外とする。この経路の接続切れ通知は2つの起動の両方で送信が試みられるが、重複送信は Resend の Idempotency-Key `ga4-connection-lost:${userId}:${todayJst}`（`:671`）が防ぐ。Resend 公式は "Idempotency keys are kept in the system for **24 hours**."（§9 外部連携）としており、同日内の2回の起動はこの保持期間に収まる。
      - 手動の「今すぐ評価を実行」（`ga4ContentEvaluation.actions.ts` の `runGa4ContentEvaluation`）はバッチを通らないため対象外で、変えない。
  - 具体的な実装方法は spec-to-pr の plan で確定する。上の方式で直せない形だと分かった場合は、§14 のチェックポイントで止める。

### 画面設計

対象外（UI の変更は無い）。

### 権限

対象外。認証の契約（Bearer `CRON_SECRET`）を変えない（FR-002）。cron ルートは `proxy.ts` の matcher が `api/` を除外しているため、ログイン認証の proxy を通らない（`proxy.ts:269`）。この構成も変えない。

## 7. Gherkin受け入れ条件

承認済みの `02-gherkin.md`（`.takt/runs/20260924-113606-task/reports/02-gherkin.md`）をそのまま反映し、CON-003 のユーザー判断 B に対応する Rule「同じ起動が2回届いても二重に処理しない」を末尾に追加した（シナリオ3本。grill-to-gherkin の承認後に足したもので、spec-review の確認対象）。

- 追加 Rule の用語: 「前回の評価がある記事」は、初回のベースライン記録（GSC は `last_seen_position` が NULL、GA4 は `ga4_last_seen_content_score` が NULL）を除く記事を指す。ベースライン記録は履歴もメールも作らない（`gscEvaluationService.ts:311-329`、`ga4ContentEvaluationBatchService.ts:470-471,511-533`）。「評価結果の履歴」は、GSC では `outcome_type = 'success'` の行（改善提案の対象になる行）、GA4 では評価の実行で作られる履歴行を指す。GSC の一括取込失敗・system_error のエラー履歴は含めない（重複を許容する。R-07）。

```gherkin
Feature: cron 定期起動を Vercel Cron に移行する
  運用担当として
  GitHub Actions の定期起動の欠落に左右されずに5つの cron を現行の頻度で動かしたい
  そのために定期起動を Vercel Cron に移し、手動実行と週次・月次の処理は GitHub Actions に残す

  Rule: 5つの cron エンドポイントは Vercel から UTC 基準の現行頻度で呼び出される

    Scenario Outline: 本番環境で Vercel Cron が対象ルートを定期的に呼び出す
      Given Vercel の本番デプロイに "<route>" の cron 定義がある
      When UTC のスケジュール "<schedule>" の時刻になる
      Then Vercel は "<route>" を GET で呼び出す
      And リクエストに Authorization: Bearer <CRON_SECRET> ヘッダーを含める

      Examples:
        | schedule     | route                                             |
        | 0 * * * *    | /api/cron/gsc-evaluate                            |
        | 0 * * * *    | /api/cron/ga4-content-evaluate                    |
        | 0 * * * *    | /api/cron/google-ads-negative-keywords-suggestion |
        | 0 * * * *    | /api/cron/gsc-suggestions                         |
        | */10 * * * * | /api/cron/content-annotation-summary              |

    Scenario: Vercel の cron 定義は移行対象の5ルートだけを含む
      Given 移行が完了している
      When Vercel の cron 定義を確認する
      Then 登録されたルートは移行対象の5ルートと一致する
      And 各ルートのスケジュールは現行の GitHub Actions の頻度と同じ cron 式である

  Rule: cron ルートの認証契約は移行で変わらない

    Scenario Outline: 正しい Bearer トークンを持つ呼び出しは処理される
      Given サーバーに CRON_SECRET が設定されている
      When "<route>" に Authorization: Bearer <CRON_SECRET> 付きで GET リクエストが届く
      Then ルートは認証エラーを返さずに cron 処理を実行する

      Examples:
        | route                                             |
        | /api/cron/gsc-evaluate                            |
        | /api/cron/ga4-content-evaluate                    |
        | /api/cron/google-ads-negative-keywords-suggestion |
        | /api/cron/gsc-suggestions                         |
        | /api/cron/content-annotation-summary              |

    Scenario Outline: Bearer トークンが一致しない呼び出しは拒否される
      Given サーバーに CRON_SECRET が設定されている
      When "<route>" に CRON_SECRET と一致しない Authorization ヘッダーで GET リクエストが届く
      Then ルートは HTTP 401 を返す
      And cron 処理は実行されない

      Examples:
        | route                                             |
        | /api/cron/gsc-evaluate                            |
        | /api/cron/ga4-content-evaluate                    |
        | /api/cron/google-ads-negative-keywords-suggestion |
        | /api/cron/gsc-suggestions                         |
        | /api/cron/content-annotation-summary              |

    Scenario Outline: CRON_SECRET が未設定のときは処理しない
      Given サーバーに CRON_SECRET が設定されていない
      When "<route>" に GET リクエストが届く
      Then ルートは HTTP 500 を返す
      And cron 処理は実行されない

      Examples:
        | route                                             |
        | /api/cron/gsc-evaluate                            |
        | /api/cron/ga4-content-evaluate                    |
        | /api/cron/google-ads-negative-keywords-suggestion |
        | /api/cron/gsc-suggestions                         |
        | /api/cron/content-annotation-summary              |

  Rule: 2つの cron workflow は定期起動をやめ、手動実行だけを受け付ける

    Scenario Outline: 移行後の cron workflow は定期起動されない
      Given 移行が完了している
      When "<workflow>" の起動トリガーを確認する
      Then 定期スケジュールによる起動トリガーは含まれない
      And 定期スケジュールの種類で処理を分ける実行条件も含まれない

      Examples:
        | workflow                            |
        | hourly-cron.yml                     |
        | content-annotation-summary-cron.yml |

    Scenario Outline: 運用担当は cron workflow を手動実行できる
      Given "<workflow>" に手動実行トリガー workflow_dispatch が設定されている
      When 運用担当が "<workflow>" を手動実行する
      Then workflow は "<routes>" への cron 呼び出し処理を実行する

      Examples:
        | workflow                            | routes                                                                                                                                 |
        | hourly-cron.yml                     | /api/cron/gsc-evaluate, /api/cron/ga4-content-evaluate, /api/cron/google-ads-negative-keywords-suggestion, /api/cron/gsc-suggestions |
        | content-annotation-summary-cron.yml | /api/cron/content-annotation-summary                                                                                                   |

  Rule: 週次・月次の workflow は GitHub Actions に残す

    Scenario: 週次・月次 workflow は移行の影響を受けない
      Given active-users、db-stats、vercel-stats、supabase-backup、api-changelog の workflow がある
      When cron 定期起動の移行が完了する
      Then それらの workflow は移行前と同じトリガーで GitHub Actions から実行される

  Rule: cron の失敗は Vercel のログで確認し、新しい通知は追加しない

    Scenario: cron 処理が失敗すると Vercel のログに記録される
      Given Vercel Cron が対象ルートを呼び出す
      When cron 処理が例外で失敗する
      Then ルートは HTTP 500 と失敗を示す応答を返す
      And 失敗のログを Vercel のログで確認できる

    Scenario: 移行で新しい失敗通知経路は追加されない
      Given 移行が完了している
      When cron 処理が失敗する
      Then Lark やメールなど新しい失敗通知は送られない

  Rule: cron の宣言と Vercel の cron 定義の整合性を自動テストで保つ

    Scenario: 宣言と Vercel の cron 定義が一致していればテストは成功する
      Given cron の宣言に5ルートのパスとスケジュールがある
      And Vercel の cron 定義に同じ5ルートのパスとスケジュールがある
      When 設定整合性テストを実行する
      Then テストは成功する

    Scenario: Vercel の cron 定義に宣言済みルートが無ければテストは失敗する
      Given cron の宣言にあるルートの1つが Vercel の cron 定義に無い
      When 設定整合性テストを実行する
      Then テストは失敗し、一致しないルートを示す

    Scenario: 宣言と Vercel の cron 定義でスケジュールが異なればテストは失敗する
      Given cron の宣言と Vercel の cron 定義で、あるルートのスケジュールが異なる
      When 設定整合性テストを実行する
      Then テストは失敗する

    Scenario: 手動実行用 workflow の呼び出し設定の整合性は引き続き検証される
      Given 手動実行用 workflow の呼び出し設定がある
      When 設定整合性テストを実行する
      Then 宣言と workflow の呼び出し対象・判定種別・待ち時間・試行回数が一致することを検証する
      And 各ルートの最大実行時間が宣言と一致し、呼び出しの待ち時間が最大実行時間より長いことを検証する

    Scenario: cron workflow に定期スケジュールが残っていればテストは失敗する
      Given cron 呼び出しを行う workflow に定期スケジュールのトリガーが残っている
      When 設定整合性テストを実行する
      Then テストは失敗する

  Rule: 一括要約の仕様書は移行後の起動元を記述する

    Scenario: 一括要約の仕様書が定期起動元として Vercel Cron を記述している
      Given 移行が完了している
      When 一括要約の仕様書で定期起動元の記述を確認する
      Then 定期起動元は Vercel Cron と記述されている
      And 手動起動の手段として GitHub Actions の workflow_dispatch が記述されている
      And スケジューラの移行と無関係な要約処理の要件は変わっていない

  Rule: 同じ起動が2回届いても二重に処理しない

    Scenario: 除外キーワード提案が同時に2回起動されてもメールは1通だけ送られる
      Given あるユーザーが当日まだ除外キーワード提案を受け取っていない
      When 除外キーワード提案の cron が同時に2回起動される
      Then そのユーザーの当日分の処理を確保できるのは一方の起動だけである
      And そのユーザーに送られる提案メールは1通だけである
      And 確保できなかった起動は、そのユーザーをエラーではなくスキップとして扱う

    Scenario Outline: 評価の cron が同時に2回起動されても同じ記事を二重に評価しない
      Given 前回の評価がある記事が "<評価>" の評価対象になっている
      When "<route>" が同時に2回起動される
      Then その記事の当日の評価を確保できるのは一方の起動だけである
      And その記事の評価結果の履歴は1件だけ作られる
      And 確保できなかった起動は、その記事をエラーではなくスキップとして扱う

      Examples:
        | 評価          | route                          |
        | GSC 順位評価  | /api/cron/gsc-evaluate         |
        | GA4 内容評価  | /api/cron/ga4-content-evaluate |

    Scenario: GA4 内容評価が同時に2回起動されても評価メールは1通だけ送られる
      Given 前回の評価がある記事が GA4 内容評価の評価対象になっている
      When /api/cron/ga4-content-evaluate が同時に2回起動される
      Then その記事の評価結果のメールは1通だけ送られる
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 本番環境で Vercel Cron が対象ルートを定期的に呼び出す | FR-001、FR-002 | D-01、D-06 |
| Vercel の cron 定義は移行対象の5ルートだけを含む | FR-001 | D-01 |
| 正しい Bearer トークンを持つ呼び出しは処理される | FR-002 | D-06 |
| Bearer トークンが一致しない呼び出しは拒否される | FR-002 | D-06 |
| CRON_SECRET が未設定のときは処理しない | FR-002 | D-06 |
| 移行後の cron workflow は定期起動されない | FR-003 | D-02 |
| 運用担当は cron workflow を手動実行できる | FR-003 | D-02 |
| 週次・月次 workflow は移行の影響を受けない | （変更しないことの確認） | D-03 |
| cron 処理が失敗すると Vercel のログに記録される | FR-002 | D-07 |
| 移行で新しい失敗通知経路は追加されない | （追加しないことの確認） | D-07 |
| 宣言と Vercel の cron 定義が一致していればテストは成功する | FR-004、FR-005 | D-04 |
| Vercel の cron 定義に宣言済みルートが無ければテストは失敗する | FR-005 | D-04 |
| 宣言と Vercel の cron 定義でスケジュールが異なればテストは失敗する | FR-005 | D-04、D-01 |
| 手動実行用 workflow の呼び出し設定の整合性は引き続き検証される | FR-005 | D-04 |
| cron workflow に定期スケジュールが残っていればテストは失敗する | FR-005 | D-02、D-04 |
| 一括要約の仕様書が定期起動元として Vercel Cron を記述している | FR-008 | D-05 |
| 除外キーワード提案が同時に2回起動されてもメールは1通だけ送られる | FR-006 | CON-003（ユーザー判断 B） |
| 評価の cron が同時に2回起動されても同じ記事を二重に評価しない | FR-007 | CON-003（ユーザー判断 B）、§6 の確認結果 |
| GA4 内容評価が同時に2回起動されても評価メールは1通だけ送られる | FR-007 | 同上 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 対象外。各ルートの `maxDuration`（300秒 / 800秒）と処理内容は変えない | なし | 起動元の移行だけで処理は変わらない |
| 可用性・信頼性 | §1 成功指標の起動間隔。Vercel は失敗した起動をリトライしない | 本番のログ | Vercel 公式「Vercel will not retry an invocation if a cron job fails.」。各処理は次の起動で拾い直す（ALT-003） |
| セキュリティ・プライバシー | `CRON_SECRET` による Bearer 認証を維持する | 既存のルートの単体テスト、本番ログに 401 が出ないこと | FR-002。秘密情報は新しく扱わない |
| 認証・認可 | 対象外（§6 権限） | なし | 契約を変えない |
| 監査・ログ | 失敗は既存の `logRouteFailure` / `console.error` で Vercel の runtime log に出る | 本番ログ | HTTP 200 で返る部分失敗がログに出るかは R-02 |
| 障害対応 | 検知は Vercel のログ。復旧は次の起動、または `workflow_dispatch` による手動実行 | 手動実行の確認（§13） | ALT-003 |
| バックアップ・復旧 | 対象外 | なし | データを新しく持たない |
| 運用・監視 | Vercel ダッシュボードの Settings > Cron Jobs と runtime log。runtime log の保持は Pro で1日なので、運用担当が毎日確認する | 本番確認 | 新しい監視は作らない（Non-goals）。保持期間は R-08 で許容する |
| 拡張性・互換性 | cron の件数は5件で、Vercel の上限（1プロジェクト100件）に対して十分小さい。起動頻度は現行と同じ | なし | Vercel 公式 usage-and-pricing |
| アクセシビリティ | 対象外 | なし | UI の変更が無い |
| コスト | Vercel Cron は全プランに含まれ、課金は関数の実行分だけ（現行と同じ関数を同じ頻度で呼ぶので増えない）。Actions の分数は、schedule を外すことで月約9,000分（正常時の実測から試算）が0になる | なし | Vercel 公式「Cron jobs are included in all plans.」。Actions の試算は §11 ALT-001 |

### AI機能の追加観点

対象外（AI 機能の追加・変更は無い）。二重起動による LLM の二重課金は、BR-03 / FR-006 / FR-007 で扱う。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: 新規のテーブル・列は無い。FR-006 / FR-007 は既存の列への更新条件を変えるだけ。
- データの所有者: 変更なし。
- 保持期間・削除条件: 変更なし。
- 移行・既存データとの互換性: 既存データの移行は無い。
- RLS・Service Role・ユーザー境界: 変更なし（cron は既存どおり Service Role で動く）。

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Vercel Cron | 5ルートの定期起動 | `vercel.json` の `crons: [{ path, schedule }]`。`CRON_SECRET` を Authorization ヘッダーに自動付与 | リトライしない。失敗は runtime log に残る。次の起動で拾い直す | 下記（2026-09-24 照合） |
| GitHub Actions | 手動実行（`workflow_dispatch`）と、週次・月次の処理 | 変更なし | 変更なし | 変更なし |

Vercel 公式の照合結果（`https://vercel.com/docs/cron-jobs/manage-cron-jobs`（last_updated 2026-08-11）、`https://vercel.com/docs/cron-jobs/usage-and-pricing`（last_updated 2026-07-15）。行の中に別の URL を書いたものはその URL。確認日 2026-09-24。引用は原文のまま）:

| 項目 | 原文 | 本仕様での扱い |
| --- | --- | --- |
| 認証ヘッダー | "The value of the variable will be automatically sent as an `Authorization` header when Vercel invokes your cron job." / "The `authorization` header will have the `Bearer` prefix for the value." | ルートの認証コードを変えない（FR-002） |
| HTTP メソッド | "To trigger a cron job, Vercel makes an HTTP GET request to your project's production deployment URL, using the `path` provided in your project's `vercel.json` file."（`https://vercel.com/docs/cron-jobs`、last_updated 2026-09-16、確認日 2026-09-24） | 5ルートとも既に `GET` なので変えない（FR-002）。Q-01 は回答済み |
| タイムゾーン | "The timezone is always UTC"（`https://vercel.com/docs/cron-jobs`、last_updated 2026-09-16、確認日 2026-09-24） | BR-02 の cron 式を UTC で書く |
| リトライ | "Vercel will not retry an invocation if a cron job fails." | 次の起動で拾い直す（ALT-003） |
| 起動の欠落 | "Cron job delivery is best effort. ... In those cases, your function does not execute, and no runtime log is created for that scheduled run." | 成功指標を「抜け」で判定する（§1） |
| 二重起動 | "Cron delivery can also occasionally invoke the same scheduled run more than once. Because of this, cron jobs should be resilient to both missed runs and duplicate runs." | BR-03、FR-006、FR-007 |
| 実行の重なり | "If your cron job runs longer than the interval between invocations, Vercel can trigger a second instance while the first is still running." | 要約（10分間隔・最大13.3分）は重なりうる（R-03） |
| プラン | Pro: Minimum interval "Once per minute"、Scheduling precision "Per-minute"。Hobby: "Once per day" | Pro が前提（§10 依存関係） |
| 精度 | "For all other teams, cron jobs will be invoked within the minute specified." | 毎時0分・10分ごとの分単位で起動する |
| 定義の形式 | `vercel.json` の `"crons": [{ "path": "/api/...", "schedule": "0 5 * * *" }]` | FR-001 |
| ロールバック | "If you Instant Rollback to a previous deployment, active cron jobs **will not** be updated." | §13 ロールバック方針 |
| 本番のみ | "Vercel invokes cron jobs only for production deployments and not for preview deployments"（`https://vercel.com/docs/cron-jobs/quickstart`、last_updated 2026-08-11） | プレビューでは確認できない（R-04） |
| ログの保持と上限 | Retention time の表の "**Pro** \| 1 day of logs"、"The maximum number of logs is 256 lines *per request*"、"If you exceed the log entry limits, you can only query the most recent logs."（`https://vercel.com/docs/logs/runtime`、last_updated 2026-08-28、確認日 2026-09-24） | 失敗のログは1日で消える。運用担当が毎日確認し、成功指標の起動間隔は本番デプロイから24時間以内に測る（R-08） |

Resend 公式の照合結果（`https://resend.com/docs/dashboard/emails/idempotency-keys`。確認日 2026-09-24。引用は原文のまま）:

| 項目 | 原文 | 本仕様での扱い |
| --- | --- | --- |
| Idempotency-Key の保持期間 | "Idempotency keys are kept in the system for **24 hours**." | 要約の完了メール（キーはジョブ ID）と GA4 の接続切れ通知（キーは `ga4-connection-lost:${userId}:${todayJst}`）の重複防止は、同日内の2回の起動がこの保持期間に収まることで成り立つ（§6 冪等性） |

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準:
  - Next.js App Router の Route Handler（`app/api/cron/*/route.ts`）。本番は Vercel。
  - 依存パッケージは追加しない（`vercel.ts` 用の `@vercel/config` は使わない）。
- 再利用する既存実装:

  | 区分 | 内容 | 根拠 path |
  | --- | --- | --- |
  | 拡張 | `CRON_CONFIGS` に `schedule` を足し、`vercel.json` と照合する元にする。`defineCronDefinitions` が使うのは `name` だけなので影響は無い | `src/server/lib/cron-definitions.ts`、`src/server/lib/cron-observability.ts:139-160` |
  | 再利用 | 整合性テストの既存の検証（matrix の一致、`maxDuration`、profile、503/504 の分類、`concurrency`）を残し、`if` ガードと schedule の一致の検証だけ置き換える | `tests/unit/server/lib/cron-config-consistency.test.ts:57-125` |
  | ネイティブ | Vercel Cron の組み込み認証（`CRON_SECRET` を Bearer で自動付与）をそのまま使う | `app/api/cron/*/route.ts`、`proxy.ts:269` |
  | 新規 | `vercel.json`（`crons` のみ） | 既存の Vercel 設定ファイルは無い |
  | 再利用 | 手動実行のために workflow の `concurrency` ブロックと matrix を残す | `.github/workflows/hourly-cron.yml`、`.github/workflows/content-annotation-summary-cron.yml` |
  | 再利用 | 二重起動対策は、要約で使っている「条件付き更新で確保できたものだけ処理する」方式に揃える | `supabase/migrations/20260904000000_add_content_annotation_summary_jobs.sql`（claim の `for update skip locked`） |

### 制約条件

- 納期・予算・人員: 障害が続いているため最短。1名。
- 法令・契約・審査: 該当なし。
- 変更できない既存仕様: ルートの認証契約（FR-002）、各処理の要件、週次・月次 workflow。

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| Vercel の Pro プラン | 10分間隔（`*/10`）の cron が使える | 確認済み（2026-09-24、shoma-endo が Vercel ダッシュボードでチーム「shoma-endo's projects」が Pro であることを確認。Q-02） | Hobby だった場合、デプロイが失敗する（公式「Expressions that run more frequently will fail deployment.」）。ALT-001 から検討し直す |
| 本番の `CRON_SECRET` | Vercel の本番環境変数に設定されている | 現行の Actions からの呼び出しが 401 にならず処理されていることからの推定（env は読んでいない） | 全ルートが 500 を返す。本番確認（§13）で検出する |
| `docs/plans/ga4-sync-cron-spec.md`（未実装） | 同仕様は `hourly-cron.yml` への追加と、`invoke-cron.sh` の応答判定（失敗を Actions の赤で検知する）を前提に書かれている | 同仕様の実装着手時に、起動元を Vercel Cron に読み替えて見直す | 見直さずに実装すると、手動実行でしか動かない cron になる。本仕様の整合性テスト（FR-005）が `vercel.json` との不一致で検出する |

## 11. トレードオフ判断

### ALT-001: 定期起動の移行先

- 判断: 5ルートの定期起動をどこに移すか。
- 比較した案:
  - 案A: Vercel Cron
  - 案B: 外部 scheduler から GitHub の `workflow_dispatch` を叩く
  - 案C: Ubicloud 等の外部ランナーへ移す
  - 案D: GitHub の復旧を待つ
- 採用案: 案A
- 採用理由: ルートはすでに Vercel で動いており、認証の契約もそのまま合う（§9 照合結果）。Actions の分数を使わない。
- 却下した案と理由:
  - 案B: 外部サービスに GitHub の PAT を預けることになる。起動は Actions で動くため、private 化すると分数が無料枠を超える。
  - 案C: ランナーを変えても、`schedule` イベントが発生しない問題は直らない。
  - 案D: 2026-09-24 時点で約1か月続いており、復旧時期が分からない。回避策も効かないと報告されている。
- 影響: Actions の分数は正常時で月約9,000分（毎時4ジョブ約3,200分＋10分間隔約5,600分＋CI。2026-08-20〜25 の正常時の起動回数と job の実所要から試算）から、CI 等だけになる。失敗時の GitHub の失敗メールが無くなる（ALT-003）。
- 将来変更する条件: Vercel が Hobby だった場合、または Vercel Cron の件数・間隔の上限に当たった場合。
- 判断者・判断日: shoma-endo、2026-09-24

### ALT-002: 移行後の Actions workflow の扱い

- 判断: `hourly-cron.yml` / `content-annotation-summary-cron.yml` をどうするか。
- 比較した案:
  - 案A: `schedule` だけ外し、`workflow_dispatch` を残す
  - 案B: workflow を削除する
  - 案C: `schedule` を残して併用する
- 採用案: 案A
- 採用理由: 手動実行の手段と、`invoke-cron.sh` の応答判定を残せる。
- 却下した案と理由: 案Bは手動実行の手段が無くなる。案Cは GitHub の障害が復旧したときに同じ起動が二重になり、メールが重複しうる。
- 影響: 手動実行と Vercel Cron が重なると二重起動になる。BR-03 / FR-006 / FR-007 で害を防ぐ。
- 将来変更する条件: 手動実行が不要になった場合。
- 判断者・判断日: shoma-endo、2026-09-24

### ALT-003: 失敗の検知と再試行

- 判断: 移行後、失敗をどう検知し、再試行するか。
- 比較した案:
  - 案A: Vercel のログだけで確認し、再試行は次の起動に任せる
  - 案B: `invoke-cron.sh` と同等の応答判定とリトライを移植する
  - 案C: 新しい通知（Lark・メール）を作る
- 採用案: 案A
- 採用理由: MVP を優先し、要件に無い安全機構は作らない（`AGENTS.md` Core Rules）。既存の JSON ログ（`src/server/lib/cron-observability.ts:108-110`）で足りる。
- 却下した案と理由: 案B・案Cは要件に無い安全機構になる。
- 影響: GitHub の失敗メールが無くなる。HTTP 200 で返る部分失敗はログにしか出ない（R-02）。
- 将来変更する条件: ログだけでは見逃しが実際に起き、運用上の損失が出た場合。
- 判断者・判断日: shoma-endo、2026-09-24

### ALT-004: 整合性テストで schedule をどこに宣言するか

- 判断: `vercel.json` と照合する期待値の置き場所。
- 比較した案:
  - 案A: `CRON_CONFIGS` に `schedule` を足す
  - 案B: テストに期待値を直接書く
- 採用案: 案A
- 採用理由: 既存の宣言元（`routePath`、`maxDuration`、matrix の値）に揃えられる。
- 却下した案と理由: 案Bは同じ値が `vercel.json`、テスト、コメントの3か所に散らばる。
- 影響: なし。
- 将来変更する条件: なし。
- 判断者・判断日: shoma-endo、2026-09-24

### ALT-005: 二重起動の害をどう防ぐか（CON-003）

- 判断: Vercel Cron の二重配信と、手動実行との重なりによる二重送信・二重課金をどう扱うか。
- 比較した案:
  - 案A: 1回限りの重複として許容し、手動実行は定期起動の時刻を避ける運用にする
  - 案B: 既存テーブルへの条件付き更新で、1回分しか処理しないようにする
  - 案C: ロック基盤（Redis 等）で同時起動そのものを排他する
- 採用案: 案B
- 採用理由: Vercel 公式が二重配信を明記しており（§9）、手動実行を避けても二重起動は起きる。有料の利用者に同じメールが2通届くのは利用者に見える不具合になる。要約はすでにこの方式で守られており、同じ方式に揃えるだけで済む。
- 却下した案と理由: 案Aは Vercel 側の二重配信を防げない。案Cは新しい基盤が要り、MVP の範囲を超える。
- 影響: 工数 +1.0〜2.0人日（EST-011）。§6 の確認で、直す対象は除外キーワード提案・GSC 評価・GA4 評価の3ルートになった。
- 将来変更する条件: 条件付き更新では防げない処理が増えた場合は案Cを検討する。
- 判断者・判断日: shoma-endo（grill-to-gherkin の承認後、2026-09-24 に B を選択）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-01 | 切り替え時の二重起動・空白 | Actions の `schedule` はマージで止まり、Vercel Cron は本番デプロイで有効になる。GitHub の障害が復旧していると両方が動く時間帯がありうる。逆に間が空くと起動が抜ける | 両方を同じ PR で入れる（§13）。二重起動の害は BR-03 で防ぐ。抜けは次の起動で拾い直す | 実装者 | 対応済（仕様に明記） |
| R-02 | HTTP 200 で返る部分失敗を見逃す（CON-002） | `invoke-cron.sh` は `success:false`、`data.failed>0`、`terminalFailed>0` を失敗扱いにし、`stoppedReason` 等で警告していた（`scripts/invoke-cron.sh:123-182`）。移行後は service の `console.error/warn` を通る失敗しかログに出ない | 許容する（ALT-003）。本番確認（§13）でログの見え方を確認する | 実装者 | 許容 |
| R-03 | 要約の起動の重なりで直列化が崩れる（CON-004） | 10分間隔で1回最大13.3分のため、重なった起動が別の pending ジョブを取る。「後から登録したジョブは前のジョブの完走を待つ」（要約仕様書 `:44`）が崩れ、LLM の同時実行が一時的に倍（並列3×2）になりうる。同じジョブの二重処理と完了メールの重複は起きない（claim は20分より前の `processing` 行を取り直さない。完了メールはジョブ ID を冪等キーにしている） | 許容する（ユーザー判断 2026-09-24）。要約仕様書の R-B03 と所要時間の目安を書き直す（FR-008） | 実装者 | 許容 |
| R-04 | プレビュー環境で cron を確認できない（CON-005） | Vercel Cron は本番デプロイでだけ動く | 本番で確認する（§13）。単体テストは整合性テストと FR-006 のテストで行う | 実装者 | 許容 |
| R-05 | 失敗後、次の起動まで再試行されない（CON-005） | Vercel はリトライしない。回復まで最大1時間（要約は10分） | 許容する（ALT-003）。急ぐ場合は `workflow_dispatch` で手動実行する | 運用担当 | 許容 |
| R-06 | GitHub の障害が復旧した後に、誤って `schedule` を戻す | 併用になり二重起動が常態化する | 整合性テスト（FR-005）が、`invoke-cron.sh` を呼ぶ workflow に `schedule` が残っていると失敗する | 実装者 | 対応済（テストで検出） |
| R-07 | GSC 評価のエラー履歴が二重に保存される | 一括取込に失敗した経路（`gscEvaluationService.ts:251-276` の `bulkImportFailed === true`）と system_error（`:130-133` → `:165-192`）は評価行を更新しないため、FR-007 の確保の対象外。同じ記事に2回の起動が来ると、`outcome_type = 'error'` の履歴が2行できる。エラー行は `suggestion_status` を持たず、LLM 呼び出し・メール送信の対象にならない | 許容する（§6 冪等性。BR-03 の例外） | 実装者 | 許容 |
| R-08 | cron の失敗ログが確認前に消える | Vercel の runtime log の保持は Pro で1日（"**Pro** \| 1 day of logs"、1リクエスト256行まで。§9 外部連携）。失敗の検知をログだけに頼る（BR-04）ため、確認が1日以上空くと失敗を見逃す。成功指標の起動間隔も、翌日以降に見ると最初の起動のログが消えている | 新しい仕組みは足さずに許容する（ALT-003）。運用担当が毎日ログを確認する。成功指標の起動間隔は本番デプロイから24時間以内に測る（§1、§13 本番確認項目 5）。1週間の重複確認は Resend の送信履歴と DB で行う（§13 本番確認項目 6） | 運用担当 | 許容 |
| R-09 | CON-006: grill-to-gherkin で `confirm-reply.md` を読めていなかった | 未反映の決定事項が残っていると、仕様書の内容が合意と食い違う | 同ファイルが前回の実行向けの古いメモで、今回の決定と食い違う内容が無いことを作成者が確認した（変更履歴 2026-09-24） | shoma-endo | 解消 |
| R-10 | GA4 評価の確保後に関数が落ちると、再試行が次の評価周期まで遅れる | 確保で `ga4_last_evaluated_on` に当日を書いてから評価するため、評価の途中で関数が落ちる（`maxDuration` 超過・デプロイ）と当日のまま残る。`releaseClaim` の失敗も同じ（`console.error` のみ）。その記事は次の毎時ではなく次の評価周期（既定30日）まで再評価されない | 許容する。着手打ち切りの時間予算で途中終了を起きにくくしている。コードに上限と切り替え条件をコメントした（`ga4ContentEvaluationBatchService.ts` の確保の直前）。頻発したら確保を期限付きの状態列（リース）に替える | 実装者 | 許容 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-01 | Vercel Cron が GET で呼ぶことを、公式の文として確認できるか | 5ルートは GET だけを受ける。別のメソッドで呼ばれると 405 になる | 一次情報照合（spec-review の audit） | spec-review 完了まで | 回答済み（2026-09-24 audit）。`https://vercel.com/docs/cron-jobs` に "Vercel makes an HTTP GET request to your project's production deployment URL" とある（§9 外部連携） |
| Q-02 | GrowMate の Vercel チームが Pro プランであることを確認できるか（Vercel の API ではプランを取得できなかった） | Hobby だと `*/10` と毎時の cron がデプロイで失敗する | shoma-endo（Vercel ダッシュボードで確認） | spec-review 完了まで | 回答済み（2026-09-24、shoma-endo が Vercel ダッシュボードで確認: Pro。§10 依存関係に反映） |

### 未決定事項（今は決めない）

なし（OPEN-001 は作成者が「対象にする」と決め、FR-009 に入れた。CON-006 はリスク R-09 に解消として記録した）。

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認:
  - 整合性テスト（FR-005）: `vercel.json` と `CRON_CONFIGS` の一致、`schedule` が残っていないこと、既存の検証。
  - FR-006: `markAttempt` の条件付き更新。2回目の確保が0行更新になり、その起動がメールを送らず `{ success: true, skipped: true }` を返して `summary.skipped` に数えること。`last_attempted_on` が NULL の利用者を確保できること。確保の DB エラーでは `SETTINGS_UPDATE_FAILED` を返して送信しないこと。
  - FR-007: gsc-evaluate と ga4-content-evaluate で、確保に失敗した起動が履歴の INSERT・LLM 呼び出し・メール送信を行わずスキップすること。抽出時の値が NULL の行（初回評価前の記事）を確保できること。gsc-evaluate は、no_metrics と position が null の経路でも確保に負けた起動がエラー履歴を INSERT しないこと、確保に負けた記事がエラーに数えられないこと。ga4-content-evaluate は、クールダウンを進めない結果のときに確保の値が抽出時の値へ戻ること、全記事の確保に負けた起動が no_progress にならず `failed` を増やさないこと。
  - 実画面確認は対象外（UI の変更が無い）。
- Gherkinシナリオとの対応: §7 シナリオ対応表。本番で起動を確認するシナリオ（Rule 1 の Outline）は §13 本番確認項目で確かめる。
- 外部API・失敗系・境界条件: 認証の 401 / 500 は既存テストを使う。
- セキュリティ・権限・RLS: 認証の契約を変えない（FR-002）。
- 非機能要件の測定: §1 成功指標（本番デプロイから24時間以内。R-08）。

### リリース方針

- リリース単位・段階展開: 1つの PR で、`vercel.json` の追加と `schedule` の撤去を同時に入れる（R-01）。段階展開はしない。
- Feature Flag / allowlist: 使わない。
- データベース変更の適用順序: 対象外（migration が無い）。
- 本番確認項目（本番デプロイの後）:
  1. Vercel ダッシュボードの Settings > Cron Jobs に5件が登録されている。
  2. 初回の起動（10分以内と、次の毎時0分）が各ルートの runtime log に出ている。401 / 500 が出ていない（出たら `CRON_SECRET` を確認する）。
  3. GitHub Actions の2つの workflow が `schedule` で起動していない。
  4. `workflow_dispatch` で2つの workflow を手動実行でき、ジョブが成功する。
  5. 本番デプロイから24時間以内に（ログの保持が1日のため。R-08）、デプロイ以降の全区間で §1 成功指標の起動間隔を満たしている。
  6. 1週間、除外キーワード提案メールと GA4 評価メールが、同じユーザー・同じ対象で2通届いていない（Resend の送信履歴）。`gsc_article_evaluation_history` に、同じ記事・同じ評価日の `outcome_type = 'success'` の行が2件できていない（エラー履歴の重複は R-07 で許容）。

### ロールバック方針

- アプリケーションの戻し方: PR を revert する（`vercel.json` を削除し、workflow の `schedule` を戻す）。
  - 注意: Vercel の Instant Rollback では cron の登録が戻らない（公式「active cron jobs **will not** be updated」）。cron を止めるときは、revert して再デプロイするか、Vercel ダッシュボードの「Disable Cron Jobs」を使う。
- DB変更の戻し方・逆マイグレーション: 対象外。
- データ不整合時の復旧: 対象外（FR-006 / FR-007 は更新の条件を狭めるだけで、データを壊す方向の変更は無い）。
- ロールバック判断者: shoma-endo

## 14. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. Gherkin受け入れ条件の確定（`02-gherkin.md`、`.takt/workflows/grill-to-gherkin.yaml`）
3. 仕様レビュー通過（`.takt/workflows/spec-review.yaml`）
4. 実装（`.takt/workflows/spec-to-pr.yaml`）
5. 品質ゲート通過（`npm run verify`）
6. PR作成・レビュー・マージ
7. 本番確認（§13 本番確認項目）

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| spec-review 完了時 | Q-02 に回答がある（Q-01 は 2026-09-24 audit で回答済み）。EST-011 の追加見積が合意されている（§5） | shoma-endo | 完了（2026-09-24。Q-02 = Pro、EST-011 合意、spec-review 通過） |
| FR-007 の実装前 | gsc-evaluate と ga4-content-evaluate が、§6 の方式（条件付き更新での確保）で直せる形か。直せないものがあれば止めて相談する | 実装者 | 未確認 |
| マージ前 | `npm run verify` が通る。`vercel.json` の追加で build / knip が落ちない | 実装者 | 未確認 |
| 本番デプロイ後 | §13 本番確認項目 1〜4 | shoma-endo | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - FR-001〜FR-009 が実装され、§7 のシナリオ（本番で確かめるものを除く）がテストで確認されている。
  - `npm run verify` が通る。
  - §13 本番確認項目 1〜5 を満たす。
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - `npm run verify` の結果、Vercel の runtime log、GitHub Actions の run 一覧。
- 完了確認者・確認日: shoma-endo、本番デプロイから24時間以内（§13 本番確認項目 5。R-08）

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 1 | 2026-09-24 | 0 / 7 / 4 | 🟡 7件・🟢 4件をすべて反映した（Q-01 を回答済みに更新、確保条件の NULL の扱い、FR-006 のスキップ・エラー・共有メソッド・force 経路、GSC の確保対象の経路と R-07、GA4 の no_progress と取込失敗経路、README 更新予告、ログ保持1日と R-08、FR-003 の workflow コメント、追加 Rule の Given、EST-011 の見積の状態、CON-006 の R-09） | 残置合意した 🟡 は無い。対象スコープの未解決事項として Q-02（Vercel チームが Pro プランか。shoma-endo が確認中）と、EST-011 の追加見積の合意（§5）が残る（2回目の後に解消。回2を参照） |
| 2 | 2026-09-24 | 0 / 0 / 0 | 1回目の11件の解消を確認した。`approved_with_questions`（Q-02 と EST-011 の合意が未解決） | 残置合意した 🟡 は無い。Q-02 は 2026-09-24 に shoma-endo が Pro と回答した（§12 確認質問・§10 依存関係）。EST-011 は同日に合意済み（§5）。変更履歴の 2026-09-24「Q-02 を回答済み（Pro）にし…」の行を参照 |
| 3 | 2026-09-24 | 0 / 1 / 0 | 🟡 1件（本レビュー記録が Q-02・EST-011 の解消と2回目の結果を反映していなかった）を反映した。回2・回3の行と、公式ドキュメント照合の3回目の項目を追記した | 残置合意した論点と未解決事項は無い |

#### 公式ドキュメント照合

- 実施（作成時に照合し、spec-review の1回目 audit（2026-09-24）と3回目 audit（2026-09-24）で再照合した）。
  - audit は Vercel の公式ページ6件（`/docs/cron-jobs`、`/docs/cron-jobs/manage-cron-jobs`、`/docs/cron-jobs/usage-and-pricing`、`/docs/cron-jobs/quickstart`、`/docs/logs/runtime`、`/docs/functions/limitations`）と Resend の本文を取得して照合した。GitHub は抽出結果だけを確認した（仕様書は URL を挙げているだけで引用していない）。
  - Supabase の `update()`（`https://supabase.com/docs/reference/javascript/update`）は、取得した内容が2回で食い違ったため**未確認**。FR-006 / FR-007 の条件付き更新で更新行を検知する方法は、公式ではなく既存の書き方（`supabaseService.ts:1299-1307` の `.update().eq().select('id').maybeSingle()`）を根拠にする。
  - `https://vercel.com/docs/functions/limitations` には Hobby で 800 秒を指定したときにデプロイが失敗するという記述が無く、Q-02 はこのページでは確定できなかった。
  - revise（2026-09-24）で `/docs/cron-jobs`、`/docs/logs/runtime`、Resend の Idempotency Keys のページを取得し直し、§9 に引用した原文と一致することを確認した。
  - spec-review 3回目の audit（2026-09-24）で `/docs/cron-jobs`、`/docs/cron-jobs/manage-cron-jobs`、`/docs/cron-jobs/usage-and-pricing`、`/docs/cron-jobs/quickstart`、`/docs/logs/runtime`、Resend の Idempotency Keys を取得し直し、§9 外部連携と §10 依存関係の引用が原文と一致することを確認した。Supabase の `update()` は取得したが応答が要約を経たもので原文の引用として扱っておらず、上記の未確認の扱いは変わらない。GitHub の `schedule` のページは3回目では取得していない。
- 参照 URL と確認日:
  - `https://vercel.com/docs/cron-jobs`（2026-09-24。GET で呼ぶこと、UTC）
  - `https://vercel.com/docs/logs/runtime`（2026-09-24。ログの保持1日と行数の上限）
  - `https://resend.com/docs/dashboard/emails/idempotency-keys`（2026-09-24。Idempotency-Key の保持24時間）
  - `https://vercel.com/docs/cron-jobs/manage-cron-jobs`（2026-09-24）
  - `https://vercel.com/docs/cron-jobs/usage-and-pricing`（2026-09-24）
  - `https://vercel.com/docs/cron-jobs/quickstart`（2026-09-24）
  - `https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows`（2026-09-24。`schedule` の遅延・ドロップの記述）
  - `https://github.com/orgs/community/discussions/207346`（2026-09-24。公式ではなくコミュニティの報告）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-24 | 初版 | grill-to-gherkin（`.takt/runs/20260924-113606-task`）の引き継ぎから作成。CON-003 はその後のユーザー判断で A から B に変更した。CON-001 は作成時に公式照合した。CON-006（`confirm-reply.md` が読めなかった件）は、同ファイルが前回の実行向けの古いメモで今回の決定と食い違う内容が無いことを作成者が確認し、解消とした | shoma-endo（Claude Code） |
| 2026-09-24 | spec-review 1回目の指摘を反映した。Q-01 を公式本文で回答済みにした。FR-006 / FR-007 に確保条件の NULL の扱い・0行更新とDBエラーの扱い・共有メソッドと手動実行の経路・集計先を書いた。GSC の確保対象を評価行を更新する経路に限り、エラー履歴の重複を R-07 で許容した。GA4 の no_progress 判定と取込失敗経路の扱いを書いた。ログ保持1日を R-08 として成功指標・本番確認の測定時期を直した。README 更新予告、FR-003 の workflow コメント、追加 Rule の Given / Then、EST-011 の見積の状態、CON-006（R-09）を足した | spec-review（`.takt/runs/20260924-115930-docs-plans-vercel-cron-migrati`）の audit 指摘 | shoma-endo（Claude Code） |
| 2026-09-24 | Q-02 を回答済み（Pro）にし、§10 依存関係と §14 チェックポイントを更新した。EST-011 の見積の状態を `合意済み` にした | spec-review 1回目のラン（レビュー記録の回2の audit）が approved_with_questions で止まったため、残っていた2点にユーザーが回答した | shoma-endo（Claude Code） |
| 2026-09-24 | §6 の GA4 の確保の戻し条件を「確保時の `updated_at` のまま」に変え、R-10 を足した | 実装後の差分レビューで、「当日である場合だけ」の条件では手動実行が進めたクールダウンまで戻すことが分かったため | shoma-endo（Claude Code） |
| 2026-09-25 | §6 の GA4 の確保の戻し条件を「`ga4_last_evaluated_on` が当日のまま」に戻した | PR #565 の Codex レビュー: `updated_at` は GSC 評価も同じ行で毎時0分に更新するため、GSC が先に書くと確保が戻らず、再試行が次の評価周期まで飛ぶ。前回懸念した手動実行との競合は、`already_running` の判定から戻すまでの間に手動実行が完了した場合だけで、幅がごく小さい | shoma-endo（Claude Code） |
| 2026-09-24 | §16 レビュー記録に2回目・3回目の行を足し、1回目の行に解消の追記をした。公式ドキュメント照合に3回目 audit の再照合を足した。前の変更履歴の行の「spec-review 1回目」が、レビュー記録の回2の audit を指すことを書き足した。要件の本文は変えていない | spec-review 2回目のラン（`.takt/runs/20260924-121811-docs-plans-vercel-cron-migrati`。レビュー記録の回3の audit）の指摘 ARCH-NEW-spec-L729 | shoma-endo（Claude Code） |
