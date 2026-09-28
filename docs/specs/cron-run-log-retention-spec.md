# cron 実行記録の Supabase 保存（90日保持）

## メタデータ

- 文書名: cron 実行記録の Supabase 保存（90日保持）
- ステータス: `implemented`
- 作成日: 2026-09-25
- 最終更新日: 2026-09-25
- 作成者: shoma-endo（Claude Code で作成）
- 承認者: 未承認
- 対象リリース: 未定（spec-review 通過後）
- 関連する依頼・Issue・PR:
  - grill-to-gherkin の実行記録: `.takt/runs/20260924-230540-cron-supabase-90-api-cron-5-cr/reports/`（`01-grill.md`〜`06-estimate-confirmation.md`）
  - 関連 PR: #565（cron の起動元を Vercel Cron へ移す）。本仕様はそれと独立して実装できる

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - 運用担当（開発チーム）が cron の失敗や遅れを後から調べるとき、手がかりは Vercel の runtime log だけで、Pro では1日で消える。公式（`https://vercel.com/docs/logs/runtime`、last_updated 2026-08-28、確認日 2026-09-25）の表: "**Pro** | 1 day of logs"。
    - この「1日」は Observability Plus を使わない場合の値。当チームは Observability Plus を有効にしていない前提とする（ALT-001 で費用を理由に使わないと判断）。公式（`https://vercel.com/docs/observability/observability-plus`、last_updated 2026-07-06、確認日 2026-09-25）の原文: "For teams created or upgraded to Paid Pro on or after April 3, 2026, Observability Plus is enabled by default."、Limitations 表の Runtime logs: "Pro: 1 day"（Observability）/ "30 days, max selection window of 14 consecutive days"（Observability Plus）。
  - cron の構造化ログ（`src/server/lib/cron-observability.ts` の `log()`）は console にしか出ていない。
- 放置した場合の影響: 障害に1日以上気づかないと、原因を調べる材料が残らない。2026-08-26 からの GitHub Actions `schedule` の欠落も、発生から約1か月後に GitHub API の run 履歴から逆算して特定した。

### 目的

- この開発で実現する状態: 5本の cron の構造化ログを、実行環境とともに Supabase のテーブルへ保存し、90日残す。Supabase の SQL エディタで後から調べられる。
- 利用者・事業にとっての価値: cron の不具合の原因調査が、発生から90日以内なら可能になる。利用者から見える変化は無い。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| cron ログを調べられる期間 | 1日（Vercel runtime log） | 90日 | 本番で保存された行の `logged_at` の最古と最新の差 | migration 適用から91日後 |
| 保存漏れ | 未計測 | 本番の cron 1起動につき `batch_started` の行が1行以上ある | cron の起動記録（現状は GitHub Actions の run 履歴〔`.github/workflows/hourly-cron.yml`・`content-annotation-summary-cron.yml`〕、#565 のマージ後は Vercel Cron の実行履歴）と、SQL エディタで取り出した `batch_started` の行を突き合わせる | 本番反映の翌日 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | `admin` / `paid` / `trial` / `unavailable` のすべて | 変化なし。記録を見ることも書くこともできない |
| 運用担当 | GrowMate 開発チーム | SQL エディタで cron の実行記録を調べる |
| 管理者・承認者 | shoma-endo | 本仕様の承認、migration の適用（共有プロジェクト） |
| 外部サービス・連携先 | Supabase（Pro、プロジェクト `rnmljzdsncucvkcmoaun`、本番と開発で共有） | テーブルへの保存と pg_cron による定期削除 |

### 主な利用シナリオ

1. **運用担当**が、**cron の失敗や遅れに気づいたとき（発生から90日以内）**に、SQL エディタで対象 cron の `batch_started` / `batch_failed` / `job_failed` などの行を時刻順に並べ、いつ起動し、何件処理して何件失敗し、何秒かかり、タイムアウトしたかを確認する。
2. **運用担当**が、**ローカルで手動実行した記録を除いて**本番の記録だけを見る（実行環境の列で絞り込む）。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
cron の Route Handler（手動実行の Server Action からは現状 `log()` は出ない）
  -> CRON_DEFINITIONS.<name>.log(level, event, details)
  -> console[level](JSON.stringify({ source: 'cron', cron, event, ...details }))
  -> Vercel runtime log（Pro は1日で消える）
```

### 導入後（To-Be）

```text
cron の Route Handler（手動実行の Server Action からは現状 `log()` は出ない）
  -> CRON_DEFINITIONS.<name>.log(level, event, details)
  -> console[level](...)（従来どおり）
  -> after が使えるか判定
       使える: その場で insert を開始し、after(insertPromise) に渡す（await しない）
               失敗したら console.error('[cron-observability] ...')
       使えない（ユニットテスト・スクリプト）: 保存しない。例外も出さない
  -> Supabase の cron_run_logs に1行（90日を超えた行は pg_cron が毎日削除）
```

### 業務ルール

| ID | ルール | 例外 |
| --- | --- | --- |
| BR-01 | 保存は cron 本体の処理を止めず、待たせない（D-06、D-08） | なし |
| BR-02 | 例外メッセージとスタックは保存しない（D-04） | なし |
| BR-03 | 記録は Service Role だけが読み書きする（D-10） | なし |
| BR-04 | 90日を超えた行は削除する（D-11） | なし |
| BR-05 | リクエストの外（`after` が使えない場所）では保存しない（D-07、ユーザー判断 A2） | なし |

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。

### 対象範囲

- 画面・操作: 対象外（UI は作らない。閲覧は Supabase の SQL エディタ）。
- API・外部連携: 対象外（新しい API は作らない）。
- データ・DB:
  - migration 1本で、テーブル `public.cron_run_logs` と、90日を超えた行を消す pg_cron ジョブを追加する（FR-004、FR-005）。
  - `src/types/database.types.ts` を再生成する（migration の適用後）。適用前は `database.types.pending.ts` に暫定型を置く（`.agents/skills/supabase/service-usage.md` §6）。
- 権限・ロール: 利用者ロールには一切の権限を与えない。Service Role だけが読み書きする（FR-004）。
- 運用・監視: `src/server/lib/cron-observability.ts` の `log()` に保存処理を足す（FR-001〜FR-003）。insert 本体は `SupabaseService` の static メソッドに置く（§9）。呼び出し側（5サービスの17か所、`runBatch` の2か所、`logRouteFailure` の1か所）は変えない。

### Non-goals（今回の対象外）

| 対象外にするもの | 対象外にする理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| Vercel Observability Plus / Drains | 費用を理由にユーザーが使わないと判断した（2026-09-25。ALT-001） | 費用の判断が変わったとき |
| 例外メッセージとスタックの保存 | 外部 API のエラー文に利用者の情報が混じるおそれがあり、保存するなら事前の確認とマスキングが要る | 要約だけでは原因を特定できない事例が出たとき |
| 閲覧画面・集計ダッシュボード・アラート | MVP 外。SQL エディタで足りる | 調査の頻度が上がり、SQL では手間になったとき |
| cron 以外の通常リクエストのログ | 目的は cron の原因調査に限る | なし |
| 既存の console 出力の廃止 | Vercel の runtime log での即時確認は今後も使う（D-12） | なし |
| 書き込みによる実行時間の増加の実測と対策 | `await` しないので時間予算を消費しない。コネクション数への影響は R-002 で監視する | R-002 が顕在化したとき |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `合意済み`（2026-09-25、shoma-endo。grill-to-gherkin の estimate_confirm で着手承認。`.takt/runs/20260924-230540-cron-supabase-90-api-cron-5-cr/reports/06-estimate-confirmation.md`）
- 含めるもの: 仕様書、migration、型の更新、`log()` の拡張、単体テスト、DB と権限の手動確認、`npm run verify`、リリース準備
- 含めないもの: spec-review の往復、管理者による migration の適用とその待ち時間、CON-002 の実測

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 設計 | 本仕様書 | 4〜8 | 0.5〜1.0 |
| DB | migration、型の更新 | 2.8〜6 | 0.35〜0.75 |
| 実装 | `log()` の拡張 | 4〜8 | 0.5〜1.0 |
| テスト | 単体テスト、DB と権限の手動確認 | 6〜16 | 0.75〜2.0 |
| 品質・リリース | `npm run verify`、レビュー、リリース準備 | 4〜8 | 0.5〜1.0 |
| **合計** |  | **20.8〜46** | **2.6〜5.75**（概算の丸め: 2.5〜6.0） |

幅の理由: 単体テスト（既存テストが `@/env` などを import した時点で失敗しないようにする対応の量。R-005）と、型の生成が migration の適用と CLI 認証を待つこと。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: spec-review 1〜2回。
- クライアント確認: 不要（利用者から見える変化が無い）。
- 希望リリース時期: 急がない。PR #565 と独立して進める。

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | `log()` が呼ばれたとき、`after` が使える場合は、その場で `cron_run_logs` への insert を開始し、`after(insertPromise)` に渡す。`await` しない。`log()` のシグネチャ（戻り値 `void`）は変えない | Must | D-05、D-06 | Rule 1、Rule 2 |
| FR-002 | 保存する項目は、cron 名・イベント名・レベル・時刻（`log()` を呼んだ時刻）・詳細（`CronLogDetails` の10キーだけを `jsonb` 1列に）・実行環境。例外メッセージとスタックは保存しない | Must | D-01〜D-04、D-09 | Rule 1 |
| FR-003 | insert が失敗しても cron 本体は止めない。`console.error` に `[cron-observability]` ラベル付きの英語の固定文（`'[cron-observability] Failed to persist cron log'`）とエラー内容を出す。`after` が使えない場所（リクエストの外）では insert を開始せず、例外も出さず、console 出力は従来どおり出す。リクエストの中でも `after()` の登録が例外で失敗した場合は、理由を問わず insert を開始せず、例外を外に出さない | Must | D-07、D-08、D-12、ユーザー判断 A2 | Rule 2 |
| FR-004 | テーブル `public.cron_run_logs` を追加する。RLS を有効にしてポリシーは作らず、`anon` / `authenticated` から全権限を剥がす | Must | D-10 | Rule 3 |
| FR-005 | pg_cron ジョブ `cleanup-cron-run-logs-ttl` を毎日 `0 0 * * *`（UTC）に実行し、`created_at` が90日より前の行を削除する | Must | D-11 | Rule 4 |
| FR-006 | 実行環境は `VERCEL_ENV` から決める。`production` → `production`、`preview` → `preview`、それ以外（`development` または未設定）→ `local`。`VERCEL_ENV` は `process.env` から直接読む（`VERCEL_URL` と同じ扱い。`@/env` の Zod スキーマには足さない。足すと `cron-observability.ts` が `@/env` を静的に import することになり R-005 とぶつかるため） | Must | D-09、Q-001（作成時に公式照合で回答） | Rule 1「実行環境を区別して保存する」 |

### 入力・出力・状態遷移

- 入力値・形式・必須条件: `log(level, event, details)` の既存の引数。変更なし。
- 正常時の出力: console への従来の出力と、`cron_run_logs` への1行。
- エラー時の出力: `console.error('[cron-observability] Failed to persist cron log', ...)`。cron 本体には何も返さない。
- 状態と遷移条件: 状態は持たない（追記だけのテーブル）。
- 冪等性・重複実行時の挙動: 追記だけで、重複の排除はしない。同じ cron が同時に2回動けば、両方の行が残る（調査にはその方が役立つ）。
- `after` が使えるかの判定: 保存を始める前に判定する（D-06 と A2 を両立させるため）。`after` はリクエストの外で呼ぶと例外 E468 を投げる（`node_modules/next/dist/server/after/after.js:16-22`）。リクエストの中でも E1376（onClose の失敗）、E91（`waitUntil` が無い）、E50（引数が Promise でも関数でもない）を同期で投げうる（`node_modules/next/dist/server/after/after-context.js:50-91, 170-175`、Next 16.3.3）ので、FR-003 のとおり登録の失敗は理由を問わず同じ扱いにする。判定の具体的な手段は実装で決める。
- テーブル定義（OPEN-001 を作成時に決定。spec-review で確認する）:

  | 列 | 型 | 制約・既定値 | 内容 |
  | --- | --- | --- | --- |
  | `id` | `uuid` | `primary key default gen_random_uuid()` | |
  | `cron_name` | `text` | `not null` | `CRON_CONFIGS` の `name`（例 `gsc_evaluate`） |
  | `event` | `text` | `not null` | `CronEvent` の10種 |
  | `level` | `text` | `not null check (level in ('info','warn','error'))` | |
  | `environment` | `text` | `not null check (environment in ('production','preview','local'))` | FR-006 |
  | `details` | `jsonb` | `not null default '{}'::jsonb` | `CronLogDetails` の10キーのうち値のあるもの |
  | `logged_at` | `timestamptz` | `not null` | `log()` を呼んだ時刻（アプリ側） |
  | `created_at` | `timestamptz` | `not null default timezone('utc', now())` | 行を作った時刻（削除の基準） |

  - 索引: `(cron_name, logged_at desc)`。調査は cron ごとに時刻順で見るため。
  - 名前の根拠: 既存テーブル（`admin_action_logs` など）の snake_case・複数形に揃えた。

### 画面設計

対象外（UI を作らない）。

### 権限

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| `admin` / `paid` / `trial` / `unavailable`（anon / authenticated の経路） | 不可 | 不可 | 不可 | 不可 |
| Service Role（サーバー側の `log()`、SQL エディタ） | 可 | 可 | 可 | 可 |

- 利用者が操作するサーバー側の入口（Server Action / Route Handler）は作らないので、Server Action の認可は該当なし。
- 既存の前例: `supabase/migrations/20260716000000_add_admin_action_logs_and_fix_prompt_templates_updated_by_fk.sql:12-26`（RLS 有効・ポリシー無し・`revoke all ... from anon, authenticated`）。

## 7. Gherkin受け入れ条件

承認済みの `02-gherkin.md`（`.takt/runs/20260924-230540-cron-supabase-90-api-cron-5-cr/reports/02-gherkin.md`）を変更せずに転記した。

```gherkin
Feature: cron 実行記録の保存と保持
  運用担当として、Vercel runtime log の保持期間（1日）を過ぎた後も
  cron の実行記録を Supabase SQL エディタで調べたい。

  Rule: 対象の cron が出す構造化ログは、実行環境とともに保存される

    Scenario Outline: 対象 cron の構造化ログが保存される
      Given cron "<cron名>" がリクエスト処理の中で実行されている
      When その cron が構造化ログを1件記録する
      Then そのログのイベント名、cron 名、レベル、時刻、詳細項目が1行として保存される
      And 保存された cron 名は "<cron名>" である

      Examples:
        | cron名                        |
        | gsc_evaluate                  |
        | gsc_suggestions               |
        | google_ads_negative_keywords  |
        | content_annotation_summary    |
        | ga4_content_evaluate          |

    Scenario Outline: 実行環境を区別して保存する
      Given cron が実行環境 "<実行環境>" のリクエスト処理の中で実行されている
      When その cron が構造化ログを1件記録する
      Then 保存された行の実行環境は "<実行環境>" である

      Examples:
        | 実行環境   |
        | production |
        | preview    |
        | local      |

    Scenario: 保存される詳細項目は既存の構造化ログの詳細項目に限られる
      Given cron が詳細項目 durationMs=1500 と total=3 を付けて構造化ログを記録する
      When その行が保存される
      Then 保存された行の詳細項目は durationMs=1500 と total=3 だけである

    Scenario: 例外メッセージとスタックは保存されない
      Given cron の処理が例外で失敗する
      When その失敗が構造化ログとして記録される
      Then 保存された行に例外メッセージは含まれない
      And 保存された行にスタックトレースは含まれない

    Scenario: 保存を追加しても既存の console 出力は変わらない
      Given cron が構造化ログを1件記録する
      When 保存処理が行われる
      Then console には従来と同じ構造化ログが出力される

  Rule: ログの保存は記録した時点で始まり、cron の処理を止めず、待たせない

    Scenario: 保存はログを記録した時点で始まる
      Given cron がリクエスト処理の中で実行されている
      When cron が構造化ログを1件記録する
      Then そのログの保存処理は、エンドポイントが応答を返す前の記録した時点で開始される

    Scenario: cron は保存の完了を待たずに処理を続ける
      Given ログの保存先の応答が遅い
      When cron が構造化ログを1件記録する
      Then cron は保存の完了を待たずに次の処理へ進む

    Scenario: 応答を返した後も保存処理は続く
      Given cron が構造化ログを記録し、その保存がまだ完了していない
      When cron のエンドポイントが応答を返す
      Then 応答を返した後も保存処理は続き、行が保存される

    Scenario: ログの保存に失敗しても cron は続き、失敗が console に記録される
      Given cron がリクエスト処理の中で実行されている
      When 構造化ログの保存に失敗する
      Then cron 本体の処理は続く
      And console.error に "[cron-observability]" のラベルで始まる英語の固定文が出力される

    Scenario: リクエストの外で記録したログは保存されず、呼び出し元も失敗しない
      Given 応答後の処理を登録できない、リクエストの外の文脈で構造化ログが記録される
      When ログの記録が行われる
      Then 保存処理は開始されず、実行記録は保存されない
      And 記録の呼び出し元に例外は伝わらない
      And console には従来と同じ構造化ログが出力される

  Rule: 実行記録を読み書きできるのは Service Role だけである

    Scenario Outline: 利用者向けの経路からは読み書きできない
      Given cron の実行記録が保存されている
      When "<経路>" の権限で実行記録の "<操作>" を試みる
      Then その操作は許可されない

      Examples:
        | 経路          | 操作 |
        | anon          | 参照 |
        | anon          | 追加 |
        | anon          | 更新 |
        | anon          | 削除 |
        | authenticated | 参照 |
        | authenticated | 追加 |
        | authenticated | 更新 |
        | authenticated | 削除 |

    Scenario: Service Role の担当者は SQL エディタで詳細項目を個別に取り出せる
      Given 詳細項目 durationMs=1500 を持つ cron の実行記録が保存されている
      When Service Role を使う担当者が Supabase SQL エディタでその行の詳細項目を参照する
      Then 詳細項目から durationMs の値 1500 を個別に取り出せる

  Rule: 90日を超えた実行記録は定期削除される

    Scenario: 作成から90日を超えた行は定期削除で消える
      Given 作成から90日を超えた実行記録がある
      When 定期削除が実行される
      Then その行は削除される

    Scenario: 作成から90日以内の行は定期削除で消えない
      Given 作成から90日以内の実行記録がある
      When 定期削除が実行される
      Then その行は残る
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 対象 cron の構造化ログが保存される（5本） | FR-001、FR-002 | D-01、D-02、D-05 |
| 実行環境を区別して保存する（3値） | FR-002、FR-006 | D-09 |
| 保存される詳細項目は既存の構造化ログの詳細項目に限られる | FR-002 | D-02、D-03 |
| 例外メッセージとスタックは保存されない | FR-002 | D-04 |
| 保存を追加しても既存の console 出力は変わらない | FR-003 | D-12 |
| 保存はログを記録した時点で始まる | FR-001 | D-06 |
| cron は保存の完了を待たずに処理を続ける | FR-001 | D-06 |
| 応答を返した後も保存処理は続く | FR-001 | D-06 |
| ログの保存に失敗しても cron は続き、失敗が console に記録される | FR-003 | D-08 |
| リクエストの外で記録したログは保存されず、呼び出し元も失敗しない | FR-003 | D-07、ユーザー判断 A2 |
| 利用者向けの経路からは読み書きできない（8通り） | FR-004 | D-10 |
| Service Role の担当者は SQL エディタで詳細項目を個別に取り出せる | FR-002、FR-004 | D-02、D-10 |
| 作成から90日を超えた行は定期削除で消える | FR-005 | D-11 |
| 作成から90日以内の行は定期削除で消えない | FR-005 | D-11 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | cron の処理時間を延ばさない（insert を `await` しない） | 単体テスト（保存の完了を待たずに次へ進む） | FR-001 |
| 可用性・信頼性 | 保存の失敗で cron を止めない | 単体テスト（insert 失敗時） | FR-003。時間切れ直前の数行が欠けうる（R-001、受容） |
| セキュリティ・プライバシー | 例外メッセージ・スタックを保存しない。利用者の経路からは読めない | 単体テスト、手動 SQL（§13） | FR-002、FR-004 |
| 認証・認可 | Service Role だけ | 手動 SQL（anon / authenticated で4操作ずつ） | FR-004 |
| 監査・ログ | 本仕様そのもの。保持は90日 | 手動 SQL | FR-005 |
| 障害対応 | 保存に失敗したら `console.error`。記録が無い区間は Vercel の runtime log（1日）を見る | 単体テスト | FR-003 |
| バックアップ・復旧 | 対象外。調査用の記録で、失っても業務は止まらない。既存の週次 Supabase バックアップ（`supabase-backup.yml`）の対象には含まれる | なし | |
| 運用・監視 | 閲覧は SQL エディタ。監視・アラートは作らない | なし | Non-goals |
| 拡張性・互換性 | 現状の起動頻度（毎時4本と10分ごと1本）でバッチ単位の行だけなら90日で約4.3万行。ジョブ単位の行を含めても90日で数十万行の見込みで、90日で削除するので上限がある | 本番反映の1週間後に行数を確認する | 利用者が増えてジョブ単位のログが1桁以上増えたら見直す（R-003） |
| アクセシビリティ | 対象外（UI が無い） | なし | |
| コスト | Supabase は Pro で、この量なら追加費用は無い見込み | なし | Vercel の Observability Plus（$1.20 / 100万イベント）を使わない代わりの手段（ALT-001） |

### AI機能の追加観点

対象外（AI 機能を追加・変更しない）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: `cron_run_logs` への追記と、pg_cron による90日超の削除。既存テーブルは変えない。
- データの所有者: システム（利用者に紐づかない。`user_id` 列は持たない）。
- 保持期間・削除条件: `created_at` から90日（FR-005）。
- 移行・既存データとの互換性: 新規テーブルのため移行は無い。過去のログはさかのぼって入らない。
- RLS・Service Role・ユーザー境界: RLS 有効・ポリシー無し・`anon` / `authenticated` から全権限を剥がす。書き込みは `SupabaseService`（`src/server/services/supabaseService.ts`）に足す static メソッドから行い、`withServiceRoleClient`（`:180-206`）で Service Role クライアントを得て、`asPendingClient` を通して insert する（`.agents/skills/supabase/service-usage.md` §1・§3・§6、運用ルール1）。`log()` からはこのサービスを保存するときにだけ遅延 import で呼ぶ（R-005。`supabaseService.ts` は `server-only`・`@/lib/client-manager` などを静的に import するため）。前例: 同じ Service Role 専用のログテーブル `admin_action_logs` の insert も `SupabaseService` に置いている（`supabaseService.ts:2409`）。

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Supabase（PostgreSQL、pg_cron） | 保存と定期削除 | Service Role での insert。pg_cron の `cron.schedule` | insert 失敗は `console.error` だけ。cron は続く | 既存 migration の前例（`20251227204537_add_employee_invitations.sql:42-61`） |
| Next.js `after` | 応答後も insert を続ける | `after(promise)` | リクエストの外では例外 E468。事前に判定して保存しない。リクエストの中での登録の失敗（E1376 / E91 / E50）も同じ扱い（FR-003） | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`（同梱ドキュメント）。"`after` will run for the platform's default or configured max duration of your route."。Promise を直接受け取れる（`after.d.ts:1`） |
| Vercel システム環境変数 `VERCEL_ENV` | 実行環境の判定 | 環境変数の読み取り | 未設定なら `local` | 下記 |

`VERCEL_ENV` の公式照合（`https://vercel.com/docs/environment-variables/system-environment-variables`、last_updated 2026-07-15、確認日 2026-09-25。原文）:
- "**Available at:** Both build and runtime"
- "The environment that the app is deployed and running on. The value can be either production, preview, or development."
- システム環境変数は、プロジェクト設定の「Enable access to System Environment Variables」で公開される。GrowMate はすでに `VERCEL_URL` を実行時に読んでいる（`src/server/middleware/authMiddlewareGuards.ts:84`）ので、公開されている前提とする。本番で `environment='production'` の行が入ることを §13 で確かめる。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: Next.js（App Router）の `after`、Supabase（Pro、本番と開発で共有）、pg_cron。依存パッケージは追加しない。
- 再利用する既存実装:

  | 区分 | 内容 | 根拠 path |
  | --- | --- | --- |
  | 拡張 | `log()` の console 出力の後に保存処理を足す。`runBatch`（`:117, :122`）と `logRouteFailure`（`:131`）も同じ `log` を通るので、呼び出し側は変えない | `src/server/lib/cron-observability.ts:108-110` |
  | 拡張 | `SupabaseService` に `cron_run_logs` への insert を行う static メソッドを足す。`withServiceRoleClient` と `asPendingClient` を使う。`log()` からは遅延 import で呼ぶ（R-005） | `src/server/services/supabaseService.ts:180-206`、`.agents/skills/supabase/service-usage.md` §6 |
  | 再利用 | Service Role 専用テーブルの migration の形（RLS 有効・ポリシー無し・revoke・冒頭の Rollback コメント） | `supabase/migrations/20260716000000_add_admin_action_logs_and_fix_prompt_templates_updated_by_fk.sql:12-26` |
  | 再利用 | pg_cron による TTL 削除と、`cron.unschedule` のロールバックコメント | `supabase/migrations/20251227204537_add_employee_invitations.sql:42-61` |
  | 新規 | `after` を使えるかの事前判定、`VERCEL_ENV` からの実行環境の判定 | コード内に前例なし |

- README 更新の予告: `README.md` の「`src/env.ts` に含まれないが `process.env` 直接参照」表に `VERCEL_ENV` の行（Vercel が自動設定 / `src/server/lib/cron-observability.ts` の実行環境の判定）を足す見込み。最終判断は spec-to-pr の `readme_sync`。
- `after` の制約（同梱ドキュメント）: ルートの `maxDuration` を超えては動かない。リクエストの外で呼ぶと例外 E468（`node_modules/next/dist/server/after/after.js:16-22`）。

### 制約条件

- 納期・予算・人員: 1名。急がない。
- 法令・契約・審査: 該当なし（利用者の個人情報を保存しない。FR-002）。
- 変更できない既存仕様: `log()` のシグネチャ、既存の console 出力。

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| migration の適用 | 管理者（shoma-endo）が共有プロジェクトに適用する（D-13。README「Supabase 注意」） | SQL エディタでテーブルと pg_cron ジョブがあることを確認 | テーブルが無いと insert が毎回失敗し、`console.error` が出続ける（cron は止まらない） |
| 型の再生成 | migration の適用後に `npm run supabase:types`（Supabase CLI の認証はユーザーが行う） | `database.types.ts` に `cron_run_logs` がある | 適用前は `database.types.pending.ts` の暫定型で実装する |
| Vercel のシステム環境変数の公開 | `VERCEL_ENV` が実行時に読める | §13 本番確認 | 読めないと本番の行が `local` になる |

## 11. トレードオフ判断

### ALT-001: cron ログを長期保持する手段

- 判断: 1日で消える Vercel の runtime log の代わりに、cron のログをどこに残すか。
- 比較した案:
  - 案A: Vercel Observability Plus（runtime log を30日保持。$1.20 / 100万イベント）
  - 案B: Vercel Drains で外部サービスへ転送（$0.50 / GB ＋転送先の費用）
  - 案C: Supabase のテーブルに保存
- 採用案: 案C
- 採用理由: 追加費用がほぼ無い（Supabase は Pro）。保持期間（90日）を自分で決められ、実行環境で絞り込め、SQL で集計できる。
- 却下した案と理由: 案A・案Bは費用を理由にユーザーが使わないと判断した（2026-09-25）。案Aは開発ゼロで全ログが残る利点があることを伝えたうえでの判断。
- 影響: 開発 2.5〜6人日。残るのは cron の構造化ログだけで、ログの全文は残らない。
- 将来変更する条件: 費用についての判断が変わったとき。
- 判断者・判断日: shoma-endo、2026-09-25

### ALT-002: 書き込み方式

- 判断: `log()` からどう書き込むか。
- 比較した案:
  - 案A: insert を `await` する
  - 案B: 呼び出し時に insert を開始し、`after(insertPromise)` に渡す（`await` しない）
  - 案C: `after` のコールバックの中で、応答後にまとめて insert する
- 採用案: 案B
- 採用理由: cron の時間予算を消費せず、`log()` のシグネチャ（`void`）も変えずに済む。記録した時点で書き始めるので、途中で関数が止まっても、それまでの行は残る。
- 却下した案と理由: 案Aは時間予算を削り、`log()` を非同期にする必要があって D-05（呼び出し側を変えない）と矛盾する。案Cは時間切れで関数が止まったときに、その起動の記録がすべて消える。原因を調べたいのはまさにそういうときなので採らない。
- 影響: 時間切れ直前の数行は欠けうる（R-001）。
- 将来変更する条件: R-001 の欠落が調査の妨げになると分かったとき。
- 判断者・判断日: shoma-endo、2026-09-25

### ALT-003: 書き込みの集約点

- 判断: 保存処理をどこに入れるか。
- 比較した案:
  - 案A: `log()` の1か所
  - 案B: 呼び出し側（20か所）に個別に書く
- 採用案: 案A
- 採用理由: 変更が1か所で済み、書き漏れが起きない。
- 却下した案と理由: 案Bは変更面が大きく（工数 +2〜2.5人日）、書き漏れも起きやすい。
- 影響: なし。
- 将来変更する条件: なし。
- 判断者・判断日: shoma-endo、2026-09-25

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 時間切れ直前のログが保存されない（CON-001） | cron が `maxDuration`（300 / 800秒）いっぱいまで動いて強制終了したとき、直前の数行が欠けうる | 受け入れる（ユーザー判断 2026-09-25）。欠けた区間は Vercel の runtime log（1日以内なら）で補う | 実装者 | 受容 |
| R-002 | 書き込みで実行時間とコネクション数が増える（CON-002） | ジョブ単位のイベントが大量に出たとき。未測定 | `await` しないので時間予算は消費しない。本番反映の1週間後に行数とエラーの有無を確認する | 実装者 | 監視 |
| R-003 | データ量と定期削除の負荷（CON-003） | 利用者が増えてジョブ単位のログが膨らんだとき | 90日で削除するので上限がある。`created_at` の削除に索引が要るかは、本番反映の1週間後の行数で判断する | 実装者 | 監視 |
| R-004 | 共有プロジェクトへの削除 migration の適用（CON-004） | ジョブ名の衝突、削除対象の誤り | ジョブ名は既存と重ならない `cleanup-cron-run-logs-ttl`。削除は `cron_run_logs` だけを対象にする。適用時に `select * from cron.job` で確認する | shoma-endo | 対応済（仕様に明記） |
| R-005 | 既存テストが import した時点で失敗する（CON-006） | `log()` が Service Role クライアントや `@/env` を import すると、env を持たないユニットテストで zod の検証が落ちうる（`vitest.config.ts` に env の設定が無い） | 保存処理のモジュール（`SupabaseService`。§9）は保存するときにだけ読み込む（遅延 import）など、import しただけでは env を検証しない形にする。リクエストの外では保存しない（FR-003）ので、テストから insert は出ない | 実装者 | 対応方針あり |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 実行環境の3値（production / preview / local）をどう判定するか（CON-005） | FR-006 の実装 | 一次情報照合 | 仕様書作成時 | 回答済み（2026-09-25、作成者が Vercel 公式で照合。§9。`VERCEL_ENV` の `production` / `preview` はそのまま、`development` と未設定は `local`） |

### 未決定事項（今は決めない）

なし。OPEN-001（テーブル名・列名・時刻の付け方・pg_cron のジョブ名）と OPEN-002（失敗時の英語固定文）は、仕様書の作成時に作成者が決めた（§6 テーブル定義、FR-003、FR-005）。spec-review で確認する。

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認:
  - 単体テスト（`cron-observability`）: 保存する項目と実行環境の3値、詳細は10キーだけ、例外メッセージを含まない、console 出力が変わらない、insert を待たない、insert 失敗時の `console.error`、`after` が使えないときに insert を始めず例外も出さない。
  - 手動 SQL（DB）: anon / authenticated で参照・追加・更新・削除がすべて拒否されること。Service Role で `details->>'durationMs'` を取り出せること。`created_at` を91日前にした行が削除され、89日前の行が残ること（pg_cron のジョブ本体の SQL を直接実行して確認）。
- Gherkinシナリオとの対応: §7 シナリオ対応表。「応答を返した後も保存処理は続く」は本番の確認（下記）で確かめる。
- 外部API・失敗系・境界条件: insert 失敗、リクエストの外、90日の前後。
- セキュリティ・権限・RLS: 上記の手動 SQL。
- 非機能要件の測定: R-002 / R-003（本番反映の1週間後）。

### リリース方針

- リリース単位・段階展開: 1つの PR。
- Feature Flag / allowlist: 使わない。
- データベース変更の適用順序: migration を先に適用してから、アプリをデプロイする（逆だと、適用までの間 insert が失敗し続ける。cron は止まらない）。
- 本番確認項目:
  1. `cron_run_logs` と pg_cron ジョブ `cleanup-cron-run-logs-ttl` がある。
  2. 本番の cron の起動ごとに `environment='production'` の行が入っている。各起動の最後のイベント（`batch_completed` など）の行も入っている（シナリオ「応答を返した後も保存処理は続く」の確認）。
  3. Vercel の runtime log に `[cron-observability] Failed to persist cron log` が出ていない。
  4. 1週間後に行数を確認する（R-002 / R-003）。

### ロールバック方針

- アプリケーションの戻し方: PR を revert する（`log()` が保存しなくなるだけ）。
- DB変更の戻し方・逆マイグレーション: migration の冒頭コメントに `select cron.unschedule('cleanup-cron-run-logs-ttl');` と `drop table if exists public.cron_run_logs;` を書く。
- データ不整合時の復旧: 対象外（調査用の追記データで、他のテーブルと関係しない）。
- ロールバック判断者: shoma-endo

## 14. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. Gherkin受け入れ条件の確定（`02-gherkin.md`、`.takt/workflows/grill-to-gherkin.yaml`）
3. 仕様レビュー通過（`.takt/workflows/spec-review.yaml`）
4. 実装（`.takt/workflows/spec-to-pr.yaml`）。migration と `database.types.pending.ts` の暫定型、`log()` の拡張、単体テスト
5. 品質ゲート通過（`npm run verify`）
6. PR作成・レビュー
7. 管理者が migration を適用する（本番デプロイより前。§13「データベース変更の適用順序」）
8. マージ（本番デプロイ）
9. 型を再生成して暫定型を消す（`database.types.pending.ts` のまま実装を完了してよい。`.agents/skills/supabase/service-usage.md` §6）
10. 本番確認（§13）

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 実装前 | 既存テストが import 時点で失敗しない形（R-005）で実装できるか | 実装者 | 未確認 |
| マージ前 | `npm run verify` が通る | 実装者 | 未確認 |
| migration 適用時 | テーブル・ジョブ・権限（§13 の手動 SQL） | shoma-endo | 未確認 |
| 本番反映後 | §13 本番確認項目 1〜3 | shoma-endo | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - FR-001〜FR-006 が実装され、§7 のシナリオが単体テスト・手動 SQL・本番確認（§13。「応答を返した後も保存処理は続く」）のいずれかで確認されている。
  - `npm run verify` が通る。
  - migration が適用され、§13 本番確認項目 1〜3 を満たす。
- 検証方法・証跡（テスト結果・画面確認・ログ等）: `npm run verify` の結果、手動 SQL の結果、本番の `cron_run_logs` の行。
- 完了確認者・確認日: shoma-endo、本番反映の翌日

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 1 | 2026-09-25 | 0 / 4 / 4 | 🟡4件・🟢4件をすべて反映。🟡: 書き込みを `SupabaseService` の static メソッド経由に変更（§9・§10。既存規約 `service-usage.md` と `admin_action_logs` の前例に合わせた）、`VERCEL_ENV` は `process.env` 直接参照と明記し README 更新を予告（FR-006・§10）、保存漏れの測定方法を起動元に依存しない書き方に修正（§1）、§14 の手順を「migration 適用 → マージ（デプロイ）」の順に修正。🟢: `after()` 登録失敗全般の扱いを FR-003 に追加、As-Is / To-Be 図の起点を修正、本番確認項目2と DoD に応答後の保存の確認を追加、§1 に Observability Plus を使わない前提を追記 | なし |

#### 公式ドキュメント照合

- 実施（作成時。spec-review 1回目の audit でも WebFetch で再照合し、仕様書との矛盾なし。確認日 2026-09-25）
- 参照 URL と確認日:
  - `https://vercel.com/docs/logs/runtime`（2026-09-25）
  - `https://vercel.com/docs/environment-variables/system-environment-variables`（2026-09-25）
  - `https://vercel.com/docs/observability/observability-plus`（2026-09-25。ALT-001 の比較と §1 の前提のため）
  - `https://vercel.com/docs/drains`（2026-09-25。ALT-001 の比較のため）
  - Next.js `after`: 同梱ドキュメント `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`（2026-09-25）と web 版 `https://nextjs.org/docs/app/api-reference/functions/after`（version 16.3.6、2026-09-25）。原文: "`after` will run for the platform's default or configured max duration of your route."
  - `https://supabase.com/docs/guides/cron/quickstart`（2026-09-25。FR-005）。原文: "Attempting to create a second Job with the same name (and case) will overwrite the first Job."、例のコメント "daily at midnight (GMT)"
  - `https://supabase.com/docs/guides/database/postgres/row-level-security`（2026-09-25。FR-004）。原文: "Once RLS is enabled, no data is accessible through the API when using a publishable key, until you create policies."、"A secret key authorizes access through the `service_role` Postgres role, which has the `bypassrls` attribute."
  - `https://supabase.com/docs/guides/platform/manage-your-usage/disk-size`（2026-09-25。§8 コスト）。原文: "The primary database of your project gets provisioned with an 8 GB disk."、"$0.000171 per GB-Hr ($0.125 per GB per month)"

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-25 | 初版 | grill-to-gherkin（`.takt/runs/20260924-230540-cron-supabase-90-api-cron-5-cr`）の引き継ぎから作成。confirm でのユーザー判断（A2、保存は記録した時点で始める、CON-005 と CON-001 の扱い）を反映した。Q-001 は作成時に Vercel 公式で照合して回答し、OPEN-001 / OPEN-002 は作成者が決めた | shoma-endo（Claude Code） |
| 2026-09-25 | spec-review 1回目の指摘（🟡4 / 🟢4）を反映 | §16 レビュー記録の1回目を参照 | spec-review（revise） |
