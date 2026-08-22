# GA4 日次取込の自動実行（cron 化）

## メタデータ

- 文書名: GA4 日次取込の自動実行（cron 化）
- ステータス: `review`（仕様レビューの指摘を反映済み。Q-001〜Q-004 はすべて回答済みで、未解決の確認事項は無い。§11 / §16 レビュー記録）
- 作成日: 2026-08-21
- 最終更新日: 2026-08-21
- 作成者: shoma-endo
- 承認者: 未承認
- 対象リリース: 未定（`feature/ga4-content-evaluation` のフェーズ3実装より前）。実装ブランチは `feature/ga4-content-evaluation`（§9 依存関係。窓分割の実装が同ブランチにしか無いため）
- 関連する依頼・Issue・PR: `docs/plans/ga4-content-evaluation-spec.md`（本仕様は同仕様書フェーズ3の前提条件）

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - GA4 を連携した `paid` / `admin` ユーザーが、`/ga4-dashboard` と記事評価でデータを見られない。GA4 取込は**手動トリガーしか存在しない**（`Ga4SetupClient` の「GA4日次同期を実行」と `Ga4BackfillButton` の「過去90日を再取込」だけが `/api/ga4/sync` を叩く）。ユーザーが自分でボタンを押し続けない限り取込は進まない。
  - 本番 DB の実測（2026-08-21 取得、`gsc_credentials` で `ga4_property_id` が非 NULL の行）:

    | ロール | 人数 | `ga4_last_synced_at` の状態 |
    | --- | --- | --- |
    | `paid` | 15 | 一度も取込なし 6 / 2026-02-26〜07-22 で停止 8 / 直近（08-20）1 |
    | `admin` | 2 | 直近（08-19, 08-20）2。いずれも開発チームが手動で回した分 |
    | `unavailable` | 3 | 一度も取込なし 1 / 03-07・03-21 で停止 2 |

  - 対象ロール（`admin` / `paid`）17 人のうち **15 人の取込が停止**している。うち 6 人は連携直後から一度も取り込まれていない。
- 放置した場合の影響:
  - 有料ユーザーが「連携したのに何も出ない」状態で放置され続ける。実際に 2026-02 から半年間気づかれていない。
  - `docs/plans/ga4-content-evaluation-spec.md` のコンテンツ評価は取込済みデータを入力にするため、取込が止まっているユーザーでは全記事が「データ蓄積中」（BR-08、期間合計 `sessions < 30`）になる。**評価機能を実装しても動かない。**
  - 停止に気づく手段が存在しない。取込失敗もカーソル停止も、誰にも通知されずログにも残らない。

### 目的

- この開発で実現する状態:
  - GA4 を連携した `admin` / `paid` ユーザーの取込が、ユーザー操作なしで前日ぶんまで自動で進む。
  - 取込が失敗したとき、GitHub Actions の cron ジョブが赤くなって開発チームが気づく。
- 利用者・事業にとっての価値:
  - 連携作業だけで価値が出る（現状は「連携＋毎回ボタンを押す」が必要で、その説明もしていない）。
  - コンテンツ評価機能の前提が満たされる。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 対象ロールで `ga4_last_synced_at` が前日より 2 日以上古いユーザー数 | 15 / 17 | 0 / 17 | 本番 DB を `gsc_credentials` × `users.role` で集計 | リリース後 3 日 |
| GA4 を連携済みで一度も取り込まれていない対象ユーザー数（カーソルが NULL のまま） | 6 | 0 | 同上（`ga4_last_synced_at is null`） | リリース後 3 日 |
| 取込失敗が検知されるまでの時間 | 検知手段なし（実績: 半年間未検知） | 1 時間以内（毎時 cron の失敗として GitHub Actions に出る。**典型値であり保証ではない** — 下の注記） | `hourly-cron.yml` の実行結果 | リリース後 1 週間 |

- **「1 時間以内」は典型値であり、保証された上限ではない。** GitHub 公式は `schedule` について "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped." と明記している（`https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows`、2026-08-21 確認）。引用から導いた解釈（引用そのものではない）: 既存 `hourly-cron.yml` の `schedule: '0 * * * *'` は公式が名指しする高負荷時間帯（毎正時）に該当するため、実行が遅延あるいはドロップして検知が 1 時間を超えることはありうる。ドロップしても次の毎時実行が同じ起点から回収するため取込自体に欠損は生じない（BR-C03）。**スケジュール時刻は既存 cron 3 本と共有しているため、本仕様では変更しない**（変更は 3 本すべてに影響するため本仕様のスコープ外）。
- **「カーソルが前日に到達している」と「`ga4_page_metrics_daily` に行が入っている」は別の指標である。** GA4 側に該当期間のランディングページ単位セッションが無いユーザー（データストリーム未設定・プロパティ ID の設定違いを含む）は、取込が正常に完走してもカーソルだけが前日へ到達し、行数は 0 のままになる（BR-C03b）。上表の指標はいずれもカーソルの到達を測るものであり、行が入っていることは保証しない。行数 0 のまま到達したユーザーは、リリース後 3 日のチェックポイント（§13）で GA4 側の設定を個別に確認する。
- 実測で「一度も取込なし」の 6 人が GA4 レポートで行を返すかは未検証（本仕様の時点では GA4 API を叩いていないため）。この 6 人が行数 0 で到達する可能性がある。

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | GA4 連携済みの `admin` / `paid` ユーザー | 連携後は操作せずに `/ga4-dashboard` が最新になる |
| 運用担当 | 開発チーム | GitHub Actions の失敗を確認し、再認証が必要なユーザーへ連絡する |
| 管理者・承認者 | shoma-endo | 本仕様の承認、リリース判断 |
| 外部サービス・連携先 | Google Analytics Data API v1（`runReport`）、Google OAuth 2.0（`refresh_token`）、GitHub Actions | 前日ぶんまでの日次指標を返す／アクセストークンを再発行する／毎時 HTTP を発火する |

### 主な利用シナリオ

1. **GA4 を連携した `paid` ユーザー**が、**連携直後に**、何も操作せず翌日以降に `/ga4-dashboard` を開いてデータを見たい。
2. **開発チーム**が、**毎時 cron の実行結果で**、取込が全ユーザーぶん成功しているか（失敗が何件あるか）を確認する。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
ユーザーが GA4 を連携
  -> /setup/ga4 の「GA4日次同期を実行」を押した場合のみ取込が走る
     - 初回: 前日から遡って 30 日（INITIAL_SYNC_DAYS）
     - 2回目以降: ga4_last_synced_at の翌日 〜 前日
  -> 押さなければ何も起きない。押したことを忘れると永久に止まる
  -> 停止していることは誰にも通知されない
```

### 導入後（To-Be）

```text
GitHub Actions（hourly-cron.yml、毎時0分）
  -> GET /api/cron/ga4-sync（Authorization: Bearer CRON_SECRET）
  -> Ga4ImportService.runBatch()
     -> 対象ユーザーを取得（ga4_property_id 非 NULL かつ users.role in (admin, paid)、
        ga4_last_attempted_at 昇順・NULL 先頭、最大 MAX_USERS_PER_BATCH 件）
        ※ 並び順は「取込済みカーソル」ではなく「最終試行時刻」。恒久的に失敗する
          ユーザーが列の先頭に居座って他を餓死させるのを防ぐ（BR-C08）
     -> あわせて「遅れているユーザー数」を数える（staleTargets。BR-C09）
     -> ユーザーごとに syncUser()
        -> 何よりも先に ga4_last_attempted_at を現在時刻へ更新（成功・失敗を問わない）
        -> カーソルが前日に到達済みなら upToDate（GA4 API を叩かない。警告対象外）
        -> それ以外は [カーソル - (RESYNC_OVERLAP_DAYS - 1) .. 前日] を 30 日窓に分割し、
           古い順に 窓ごとに取得 -> upsert -> カーソルを窓の最終日まで前進（前進のみ）
           - 0 行の窓も「取得成功」として前進させる
           - 窓が失敗したらそのユーザーの残りの窓を打ち切り、failed に計上（カーソルは
             直前に成功した窓の最終日で止まる。残り期間は次回の毎時実行が回収する）
     -> 集計を返す { processed, attempted, failed, skipped, upToDate, skippedDueToLimit,
                    staleTargets, stoppedReason? }
  -> invoke-cron.sh の count-batch プロファイルが failed > 0 を FAIL 判定、
     staleTargets > 0 を WARN 判定
```

### 業務ルール

| ID | ルール | 例外 |
| --- | --- | --- |
| BR-C01 | 取込の対象ロールは `admin` / `paid` のみ。`trial` / `unavailable` は cron の対象外とする（`canAccessGa4` と一致させる）。 | なし。ロールが対象外に変わったユーザーの既存取込データは削除せず、そのまま残す |
| BR-C02 | 取込済みカーソル（`ga4_last_synced_at`）は**前進のみ**とする。窓単位で更新する際も、既存値より古い日付には戻さない。 | なし |
| BR-C03 | 窓は**古い順**に処理する。カーソルを更新するのは、その窓のレポート取得と upsert が**いずれも成功したとき**だけとする。ある窓が失敗した時点でそのユーザーの以降の窓処理を打ち切り、カーソルは直前に成功した窓の最終日で止める。打ち切られたユーザーは `failed` に計上し、残り期間は次回の毎時実行が同じ起点から再開する。 | なし |
| BR-C03b | 「レポート取得は成功したが 0 行」は失敗に含めない。0 行の窓でもカーソルはその窓の最終日まで前進させる。GA4 の 0 行は異常だけでなく正常状態（当該期間にランディングページ単位のセッションが無い／データストリーム未設定／プロパティ ID の設定違い）でも発生し、0 行でカーソルを止めると `already_synced` にもならず毎時 GA4 API を呼び直し続け、対象人数が処理能力に近づいたときに無駄な枠を消費し続けるため（並び順自体は BR-C08 により最終試行時刻ベースなので先頭に固定はされない）。 | なし。**既存実装（全窓合計 `upserted > 0` のときだけ 1 回カーソルを更新する）からの意図的な変更であり、FR-003 で置き換える** |
| BR-C04 | 増分取込の起点は「カーソルの翌日」ではなく「カーソルから `RESYNC_OVERLAP_DAYS - 1` 日前」とする。GA4 は取得後もデータが変動するため、確定前に取り込んだ日を取り直す。upsert なので重複は生じない。 | 手動の「過去90日を再取込」（`backfillDays` 指定）は従来どおり期間を固定し、overlap を適用しない |
| BR-C05 | バッチは失敗したユーザー数を戻り値に含める。1 人でも失敗したら cron ジョブを失敗させる。 | 時間予算による打ち切り（`skippedDueToLimit`）は失敗ではなく警告とする。次の毎時実行が回収するため |
| BR-C06 | `stoppedReason` は打ち切りが発生したときだけ返す。正常完了時は返さない（`invoke-cron.sh` の `count-batch` が非空文字列であることだけで警告を出すため、常時返すと毎時警告になる）。**対象取得が `MAX_USERS_PER_BATCH` に達しただけの状態は打ち切りに含めず、`stoppedReason` を返さない**（最終試行時刻の昇順で対象を選ぶため〔BR-C08〕、溢れた分は次の毎時実行が確実に回収する。§7 対象人数と処理能力の関係）。**ただし対象人数が処理能力を超えた状態は無警告のままになるため、別 signal として `staleTargets` を返す〔BR-C09〕** | なし |
| BR-C07 | 定常状態で毎時発生する正常な出来事を、`invoke-cron.sh` が警告を出すフィールド（`skipped` / `skippedDueToLimit` / `stoppedReason`）に載せない。載せると毎時警告が出続け、本当の障害を見落とす（R-003 の狼少年化）。 | なし。カーソルが前日に到達済みのユーザー数は警告対象外の `upToDate` で返す（FR-005） |
| BR-C08 | バッチ対象の並び順は**取込済みカーソル（`ga4_last_synced_at`）ではなく、最終試行時刻（`ga4_last_attempted_at`）の昇順**とする。`ga4_last_attempted_at` は `syncUser()` の入口で、**成功・失敗を問わず**現在時刻へ更新する。カーソル昇順で並べると、恒久的に失敗するユーザー（トークン失効・連携解除）はカーソルが前進しないまま列の先頭に固定され、`MAX_USERS_PER_BATCH` 件のスロットを毎時占有して他ユーザーを永久に処理させなくなる。実測で `ga4_last_synced_at` が NULL のユーザーが 6 人おり、NULL は常に先頭に並ぶため、恒久失敗が `MAX_USERS_PER_BATCH` 人に達した時点でバッチ全体が停止する。 | なし。`ga4_last_synced_at` は引き続き「どこまで取り込めたか」を表す値として残し、**取得期間の決定（BR-C02 / BR-C04）と遅延判定（BR-C09 の `staleTargets`）に使う。バッチの並び順には使わない。** 2 列の役割は排他で、`ga4_last_attempted_at` は並び順の決定にのみ使う（FR-008） |
| BR-C09 | バッチは「遅れているユーザー数」（`staleTargets` = 対象ロールのうち `ga4_last_synced_at` が前日より 3 日以上古い、または NULL の人数）を戻り値に含め、`invoke-cron.sh` が 0 より大きいときに警告する。`MAX_USERS_PER_BATCH` を超えて溢れた人数そのものは警告しない（対象が上限を超えること自体は正常で、毎時警告になるため。BR-C07）。**「1 回の実行で溢れたか」ではなく「日をまたいで追いつけていないか」を signal にする。** 閾値を §1 成功指標（`ga4_last_synced_at` が前日より 2 日以上古い人数）より 1 日緩めているのは、成功指標がリリース後 3 日の一発確認であるのに対し、こちらは毎時発火する常設警告であり、BR-C07 の狼少年化を避けるため。定常状態ではどちらの閾値でも 0 になるため矛盾しない。 | なし。追いつき期間中（リリース直後）は `staleTargets > 0` が続くが、これは事実であり抑制しない |

## 4. 対象範囲と Non-goals

### 対象範囲

- 画面・操作: なし（UI を持たないバッチ機能）。既存の手動導線（`/setup/ga4` の「GA4日次同期を実行」、`/ga4-dashboard` の「過去90日を再取込」）は**変更せず残す**。
- API・外部連携:
  - 新規: `GET /api/cron/ga4-sync`（`CRON_SECRET` Bearer 認証、`maxDuration = 300`）
  - 変更: `Ga4ImportService.runBatch()` / `syncUser()` / `SupabaseService.listGa4SyncTargets()` / `resolveGa4SyncRange()`
  - 設定: `src/server/lib/cron-definitions.ts` に `ga4Sync` を追加、`.github/workflows/hourly-cron.yml` の `matrix.include` に 1 件追加、`scripts/invoke-cron.sh` の `validate_count_batch` に `staleTargets` の警告判定を 1 件追加（既存 3 本は当該フィールドを返さないため `// 0` の既定値で影響を受けない）。**あわせて `hourly-cron.yml` 冒頭の `count-batch` プロファイル説明コメント（WARN 対象フィールドを `data.skipped` / `data.skippedDueToLimit` / `data.stoppedReason` と列挙している箇所）へ `data.staleTargets` を追記する**（追記しないとコメントが実装と食い違う）
- データ・DB: **`gsc_credentials` に `ga4_last_attempted_at timestamptz`（NULL 許容）を追加するマイグレーションが 1 本発生する**（BR-C08）。既存行は NULL で開始し、NULL は並び順の先頭になるため初回実行から順次埋まる。書き込むのは既存の `ga4_page_metrics_daily`（upsert）、`gsc_credentials.ga4_last_synced_at`、新設の `gsc_credentials.ga4_last_attempted_at`。
- 権限・ロール: `admin` / `paid`（BR-C01）。cron エンドポイント自体はユーザー認証ではなく `CRON_SECRET` で保護する。
- 運用・監視: GitHub Actions の毎時ジョブ結果と、`cron-observability` の構造化ログ（`source: "cron"`, `cron: "ga4_sync"`）。
- **壊れたときユーザーに何が見えるか**: 取込が失敗し続けている間、ユーザーには `/ga4-dashboard` の**古いデータがそのまま表示され、失敗した事実は画面に出ない**（無言で古い値が出る）。気づくのは cron の `failed` を見た開発チームで、対応はユーザーへの個別連絡になる（R-002 / R-004、§13 チェックポイント「リリース前」）。失敗をユーザー向けに表示する作り込みは Non-goal とし、新規 UI・通知は追加しない。
- README への影響予告（更新要否は断定しない）: 📋環境変数の `CRON_SECRET` 行（`README.md`。用途欄が対象 cron 名を `gsc-evaluate` / `gsc-suggestions` / `google-ads-negative-keywords-suggestion` と列挙している）と、🛠️技術スタックの GitHub Actions 毎時 Cron 一覧（同じ 3 本を列挙）に `ga4-sync` が加わる可能性がある。**最終判断は実装時の `spec-to-pr` の `readme_sync` が全差分を見て行う。**

### Non-goals（今回の対象外）

| 対象外にするもの | 理由 | 将来検討する条件 |
| --- | --- | --- |
| Kill Switch / feature flag / 環境変数による停止機構 | `hourly-cron.yml` の `matrix.include` から 1 行消して push すれば止まる。GrowMate は MVP 最優先（`CLAUDE.md`）で、要件に無い安全機構は作らない | 停止判断が頻発し、デプロイ待ちが問題になったとき |
| `needsReauth` の永続化・失効通知（メール・LINE） | リフレッシュ失敗は cron の `failed` として開発チームに見える。ユーザー向けの再認証導線は `/setup/ga4` に既存。GSC・Instagram も同じ扱いで、GA4 だけ先行させる理由がない | 再認証を要するユーザーが常態化し、個別連絡が回らなくなったとき |
| 同期状況の管理画面・監視ダッシュボード | 構造化ログと GitHub Actions の実行履歴で足りる。専用画面は要件に無い | 対象ユーザーが増えてログ確認が実務にならなくなったとき |
| ユーザーごとの取込頻度設定 | 全ユーザー日次固定で要件を満たす | なし |
| 初回取込の遡り日数を 30 日から 90 日へ広げること（`INITIAL_SYNC_DAYS` の変更） | `INITIAL_SYNC_DAYS` の意味を変える変更で、GSC 側の初回取込とも整合を取る必要がある。初回 30 日でも既存の「過去90日を再取込」で補える（Q-003 の回答をここへ移設） | 初回連携ユーザーの評価開始待ちが実運用で問題になったとき |
| 90 日を超える遡り取込 | 評価入力の期間上限が 90 日（`GA4_EVALUATION_DEFAULT_DAYS`）で、それ以上遡る用途が無い | なし |
| WordPress 同期・Instagram 同期の自動化 | 本仕様のスコープ外。GA4 取込の停止だけが今回の課題 | 同様の停止が実測されたとき |
| GA4 以外の取込項目追加（`engagement_rate` / `active_users` 等） | `docs/plans/ga4-content-evaluation-spec.md` §4.1.1 の担当。本仕様は**取込を回す仕組みだけ**を対象とし、取込内容は変更しない | なし |
| Vercel Cron への移行 | 既存 3 本が GitHub Actions で動いており、実行基盤を混在させない | なし |

## 5. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | `GET /api/cron/ga4-sync` を追加し、`Authorization: Bearer ${CRON_SECRET}` が一致する場合のみ `Ga4ImportService.runBatch()` を実行する。不一致は 401、`CRON_SECRET` 未設定は 500 | Must | 既存 `app/api/cron/gsc-evaluate/route.ts` と同一パターン | AC-01 |
| FR-002 | `listGa4SyncTargets()` の対象を `users.role in ('admin','paid')` に限定する | Must | `CLAUDE.md`（新規機能は `admin` / `paid`。サーバー側でも認可を検証する）／`canAccessGa4` | AC-02 |
| FR-008 | `gsc_credentials.ga4_last_attempted_at`（`timestamptz`、NULL 許容）を追加し、`listGa4SyncTargets()` の並び順を `ga4_last_synced_at` 昇順から **`ga4_last_attempted_at` 昇順・NULL 先頭**へ変更する。`syncUser()` は処理の入口で、**成功・失敗・`already_synced`・`not_connected` のいずれであっても**この列を現在時刻へ更新する。**`ga4_last_attempted_at` は並び順の決定にのみ使い、取得期間（BR-C02 / BR-C04）にも遅延判定（BR-C09 の `staleTargets`）にも使わない。** 恒久失敗ユーザーも毎時試行されてこの列が更新されるため、これで遅延を測ると値が常に 0 になり R-008 の signal が死ぬ | Must | BR-C08。カーソル昇順のままだと、恒久失敗ユーザーがスロットを毎時占有して他ユーザーを餓死させる。既存 `google_ads_negative_keywords_suggestion` の「直近の配信試行日（JST）。成功・失敗を問わず更新し、cron の同日重複実行を防ぐ」（`src/types/google-ads-negative-keywords-suggestion.ts:6`）と同じ考え方 | AC-14 |
| FR-009 | `runBatch()` の戻り値に `staleTargets`（対象ロールのうち `ga4_last_synced_at` が前日より 3 日以上古い、または NULL の人数）を追加し、`scripts/invoke-cron.sh` の `validate_count_batch` に `staleTargets > 0` で `::warning::` を出す判定を追加する（FAIL にはしない）。**`staleTargets` は `MAX_USERS_PER_BATCH` の `limit` に影響されない独立した件数クエリ（`count: 'exact', head: true`）で取得する。バッチ対象の取得行から数えてはならない**（`listGa4SyncTargets(limit)` は `.limit(limit)` を掛けた行を返すため、戻り値から数えると `MAX_USERS_PER_BATCH = 30` で頭打ちになる。行を全件取って数える実装でも PostgREST の `db-max-rows = 1000` で 1000 に頭打ちになる。`docs/context/db-row-limits-and-data-truncation.md:14` / 同 `:75`「`items.length >= limit` での検知は不可。必ず `count:'exact'` の総件数と比較する」）。**過小カウントが起きるのは対象人数が上限を超えた場面そのもの＝この signal が最も必要な場面であるため、頭打ちは許容できない** | Must | BR-C09。`MAX_USERS_PER_BATCH` の上限超過を無警告にした（BR-C06）結果、対象人数が処理能力を超えても誰も気づかない状態が生じるため、「日をまたいで追いつけていない」を別 signal として出す。既存 3 本は当該フィールドを返さず `// 0` の既定値になるため影響しない | AC-15 |
| FR-010 | `MAX_USERS_PER_BATCH` を 10 から **30** へ引き上げる。時間予算（`MAX_DURATION_MS = 280_000`）による打ち切りは従来どおり残す | Should | 判断 6。時間予算の方が先に効く設計であり、10 は時間予算から導かれた値ではない。JST 日付切り替え後に全対象が「1 日遅れ」になるため、全員が前日ぶんに追いつくまで `ceil(対象人数 / MAX_USERS_PER_BATCH)` 時間かかる（§7 拡張性） | AC-16 |
| FR-003 | `syncUser()` のカーソル更新を 30 日窓ごとに行う。窓を古い順に処理し、取得と upsert が成功した窓の最終日まで前進させる（前進のみ）。取得行数が 0 の窓も成功として前進させる。窓が失敗した時点でそのユーザーの残りの窓を処理せず打ち切り、カーソルは直前に成功した窓の最終日で止め、そのユーザーを `failed` に計上する | Must | BR-C02 / BR-C03 / BR-C03b。実測で 7/22 停止のユーザーは 6 窓ぶんあり、全窓成功後にしかカーソルが進まない現行実装では時間予算超過のたびに最初からやり直しになる。打ち切らずに後続窓を処理すると、失敗した窓の期間を飛び越えてカーソルが前進し、その期間が二度と取得されず欠損が恒久固定化する | AC-03 / AC-04 / AC-11 / AC-12 |
| FR-004 | 増分取込の起点を `カーソル - (RESYNC_OVERLAP_DAYS - 1)` とする。**`RESYNC_OVERLAP_DAYS = 3`**（＝起点は「カーソルの 2 日前」）。カーソルの翌日が前日を超えている場合は従来どおり `already_synced` として GA4 API を呼ばない | Must | BR-C04。GA4 は取得後も数値が変動する（§8 外部連携）。値 3 は判断 4（Q-004 の回答、2026-08-21 確定）。公式上限 "24-48 hours" が保証ではないため、最終取り直しを +72 時間に置いて 24 時間の余裕を取る | AC-05 / AC-06 |
| FR-005 | `runBatch()` の戻り値を `{ processed, attempted, failed, skipped, upToDate, skippedDueToLimit, staleTargets, stoppedReason? }` とし、各フィールドを次のとおり定義する。`attempted` は**実際に `syncUser()` を呼んだ人数**（時間予算で未着手のまま残ったユーザーを含めない。**既存実装は `attempted += 1` を時間予算チェックより前に置いており（`ga4ImportService.ts:85-91`）、加算位置を後ろへ移す**）。`processed` は `syncUser()` が例外を投げずに完了した人数（`upToDate` / `skipped` を含む）。`failed` は `syncUser()` が例外を投げた人数。`upToDate` は `already_synced`（カーソルが前日到達済み）の人数、`skipped` は `not_connected` の人数のみ。`skippedDueToLimit` は**取得済みの対象のうち時間予算で未着手のまま残った人数**（対象取得の上限で最初から取得されなかったユーザーは含まない）で、`skippedDueToLimit = 取得した対象数 - attempted`。`stoppedReason` は時間予算による打ち切り時のみ `'time_limit'` を返し、それ以外はフィールド自体を含めない（`MAX_USERS_PER_BATCH` 到達だけでは返さない。既存実装は正常時も `'completed'` を返すため、この点も変更する） | Must | BR-C05 / BR-C06 / BR-C07。`already_synced` は FR-004 により定常状態では毎回発生する正常系であり、`invoke-cron.sh` が WARN を出す `.data.skipped` に載せると 1 日 24 回中ほぼ毎回警告が出続ける（R-003 の狼少年化）。警告対象外の `upToDate` に分離する | AC-07 / AC-08 / AC-13 |
| FR-006 | `cron-definitions.ts` に `ga4Sync`（`name: 'ga4_sync'`, `workflowId: 'ga4-sync'`, `routePath: '/api/cron/ga4-sync'`, `profile: 'count-batch'`, `maxDuration: 300`, `maxTime: 310`, `maxRetries: 3`）を追加し、`hourly-cron.yml` の `matrix.include` に `{ id: ga4-sync, path: /api/cron/ga4-sync, profile: count-batch, interval: hourly, maxTime: 310, maxRetries: 3, timeoutMinutes: 20 }` を追加する | Must | `hourly-cron.yml` 冒頭の追加手順コメント（必須キーは `id` / `path` / `profile` / `interval` / `maxTime` / `maxRetries` / `timeoutMinutes`）。`workflowId` は `CRON_CONFIGS` の既存 3 件がすべて保持し、`cron-config-consistency.test.ts` が `workflowId` を含む `toStrictEqual` 比較を行うため必須 | AC-09 |
| FR-007 | 既存の手動導線（`/setup/ga4` の日次同期、`/ga4-dashboard` の過去90日再取込）の挙動を変えない。`backfillDays` 指定時は overlap を適用せず、期間は従来どおり「前日から 90 日」固定とする。**ただし FR-008 の `ga4_last_attempted_at` 更新は手動導線からの `syncUser()` 呼び出しでも発生する**（`POST /api/ga4/sync` が同じ `syncUser()` を呼ぶため）。**影響は cron の並び順で後ろへ回ることだけで、取得期間・レスポンス・UI は不変**。直前に手動同期したユーザーを後回しにするのは意図した挙動であり、FR-007 が守る「挙動を変えない」の対象外とする | Must | BR-C04 例外。取込項目追加後の穴埋め導線として仕様書 §4.1.2 が依存している | AC-10 |

### 入力・出力・状態遷移

- 入力値・形式・必須条件:
  - HTTP `GET`、ヘッダ `Authorization: Bearer <CRON_SECRET>`。リクエストボディなし。
  - 環境変数 `CRON_SECRET`（既存。GitHub Secrets と Vercel の両方に設定済み）。
- 正常時の出力: `200` / `{ "success": true, "data": { "processed": <n>, "attempted": <n>, "failed": 0, "skipped": 0, "upToDate": <n>, "skippedDueToLimit": 0, "staleTargets": 0 } }`
- エラー時の出力:
  - `401` / `{ "success": false, "error": "Unauthorized" }`（Bearer 不一致）
  - `500` / `{ "success": false, "error": "Cron secret not configured" }`（`CRON_SECRET` 未設定）
  - `500` / `{ "success": false, "error": "<message>" }`（対象一覧の取得に失敗するなどバッチ全体の失敗）
  - 個別ユーザーの失敗はバッチを止めず、`failed` に計上して `console.error` へ記録する（`CLAUDE.md`／既存方針: サイレント処理の禁止）
- 状態と遷移条件:

  | 内部状態 | 遷移条件 | カーソル |
  | --- | --- | --- |
  | 未連携 | `ga4_property_id` が NULL | 変化なし（対象外） |
  | 対象外ロール | `users.role` が `admin` / `paid` 以外 | 変化なし（対象外） |
  | 未取込 | `ga4_last_synced_at` が NULL | 前日から 30 日（`INITIAL_SYNC_DAYS`）を取込み、成功した窓ごとに前進 |
  | 追いつき中 | カーソル + 1 <= 前日 | `[カーソル - 2 .. 前日]`（＝`カーソル - (RESYNC_OVERLAP_DAYS - 1)`、`RESYNC_OVERLAP_DAYS = 3`。FR-004 / BR-C04）を 30 日窓に分割。成功した窓ごとに前進 |
  | データ無し | 窓の取得は成功したが 0 行（GA4 側に該当セッションが無い） | **その窓の最終日まで前進する**（BR-C03b）。`ga4_page_metrics_daily` への書き込みは 0 行 |
  | 窓の失敗 | 窓のレポート取得または upsert が例外を投げた | 直前に成功した窓の最終日で**停止**。以降の窓は処理せず、当該ユーザーを `failed` に計上（BR-C03） |
  | 最新 | カーソル + 1 > 前日 | `already_synced`。GA4 API を呼ばず `upToDate` に計上（`skipped` には計上しない。BR-C07） |
  | 連携解除（実行中） | 対象取得の後、`syncUser()` の時点で `ga4_property_id` が消えている | 変化なし。`skipped` に計上（`not_connected`）。対象取得で除外済みのため通常は発生しない |
- 冪等性・重複実行時の挙動:
  - `ga4_page_metrics_daily` は `(user_id, property_id, date, normalized_path)` 相当の upsert で書き込むため、同一期間を何度取り込んでも行は増えず値が上書きされる。overlap による重複取得はこの性質に依存する。
  - 毎時実行しても、カーソルが前日に到達しているユーザーは GA4 API を呼ばない。実質的に JST 日付が変わった直後の 1 回だけが実データ取得になる。
  - `maxRetries: 3` によるリトライは安全（メール送信等の非冪等な副作用が無い）。

### 画面設計

該当なし。本仕様は UI を持たないバッチ機能であり、新規画面・既存画面の変更を行わない。ユーザーから見える変化は「`/ga4-dashboard` のデータが操作なしで更新される」ことのみで、画面の構造・文言は変わらない。

### 権限

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| `admin` | 既存どおり（`/ga4-dashboard`） | cron の自動取込対象 | 同左 | 該当なし |
| `paid` | 既存どおり | cron の自動取込対象 | 同左 | 該当なし |
| `trial` | 対象外（既存どおり `canAccessGa4` で拒否） | 対象外（BR-C01） | 対象外 | 該当なし |
| `unavailable` | 対象外 | 対象外（BR-C01。実測で 3 人該当） | 対象外 | 該当なし |

- サーバー側の認可:
  - cron エンドポイントはユーザーセッションを持たないため、`CRON_SECRET` の Bearer 一致で保護する（既存 3 本と同一）。
  - ロール判定は UI ではなく `listGa4SyncTargets()` の DB クエリで行う（`gsc_credentials` から `users` を内部結合し `role` で絞る）。cron 経由でのみ実行されるため、ここが唯一の認可点になる。
  - 既存の `POST /api/ga4/sync` は `authMiddleware` + `canWriteGa4` で保護済み。本仕様では変更しない。

## 6. Gherkin受け入れ条件

```gherkin
Feature: GA4 日次取込の自動実行

  Rule: cron エンドポイントは CRON_SECRET でのみ実行できる

    Scenario: AC-01 正しい Bearer トークンでバッチが実行される
      Given 環境変数 CRON_SECRET が設定されている
      When GitHub Actions が Authorization ヘッダに正しい Bearer トークンを付けて GET /api/cron/ga4-sync を呼ぶ
      Then HTTP 200 と success=true が返る
      And data に processed, attempted, failed, skipped, upToDate, skippedDueToLimit, staleTargets が含まれる

    Scenario: AC-01b 不正な Bearer トークンは拒否される
      Given 環境変数 CRON_SECRET が設定されている
      When Authorization ヘッダが CRON_SECRET と一致しないリクエストが届く
      Then HTTP 401 が返る
      And GA4 の取込は 1 件も実行されない

  Rule: 取込対象は admin / paid のロールに限る

    Scenario: AC-02 対象外ロールのユーザーは取り込まれない
      Given GA4 を連携済みで role が unavailable のユーザーが存在する
      And GA4 を連携済みで role が paid のユーザーが存在する
      When 自動取込バッチが実行される
      Then paid のユーザーだけが取込対象になる
      And unavailable のユーザーの取込済み最終日は変化しない

  Rule: 取込済み最終日は成功した窓の単位で前進する

    Scenario: AC-03 長期間停止したユーザーが途中まで進む
      Given 取込済み最終日が前日より 175 日前のユーザーが存在する
      When 自動取込バッチが実行され、6 つある 30 日窓のうち 2 つ目まで成功した時点で時間予算を超過する
      Then 2 つ目の窓の最終日までが取込済み最終日として記録される
      And 次回の実行は 3 つ目の窓から再開する

    Scenario: AC-04 取込済み最終日は過去に戻らない
      Given 取込済み最終日が前日のユーザーが存在する
      When 過去 90 日の再取込が実行される
      Then 取込済み最終日は前日のまま変わらない

    Scenario: AC-11 窓が失敗したら以降の窓を処理せず打ち切る
      Given 取込済み最終日が前日より 175 日前のユーザーが存在する
      When 自動取込バッチが実行され、2 つ目の窓の取得が失敗する
      Then 3 つ目以降の窓は取り込まれない
      And 取込済み最終日は 1 つ目の窓の最終日で止まる
      And そのユーザーは失敗件数に計上される

    Scenario: AC-12 取得できた行が 0 件でも取込済み最終日は前進する
      Given 取込対象のユーザーが存在する
      And GA4 のレポート取得は成功するが行が 1 件も返らない
      When 自動取込バッチが実行される
      Then 取込済み最終日はその窓の最終日まで前進する
      And 次回の実行では同じ期間を取得し直さない

  Rule: 確定前のデータを取り直す

    Scenario: AC-05 直近の取込済み日を取り直す
      Given 取込済み最終日が前々日のユーザーが存在する
      When 自動取込バッチが実行される
      Then 取得期間の開始日は「取込済み最終日の 2 日前」になる
      And 取得期間の終了日は前日になる

    Scenario: AC-05b 取り直しは日付をさかのぼりすぎない
      Given 取込済み最終日が 100 日前のユーザーが存在する
      When 自動取込バッチが実行される
      Then 取得期間の開始日は「取込済み最終日の 2 日前」になる
      And 取込済み最終日より前の日は、それ以上さかのぼって取得されない

    Scenario: AC-06 前日まで取込済みなら GA4 を呼ばない
      Given 取込済み最終日が前日のユーザーが存在する
      When 自動取込バッチが実行される
      Then GA4 のレポート取得は 1 回も行われない
      And そのユーザーは「前日まで取込済み」の件数に計上される
      And そのユーザーはスキップ件数には計上されない

  Rule: 失敗はバッチの結果に現れる

    Scenario: AC-07 個別ユーザーの失敗が失敗件数に計上される
      Given 取込対象のユーザーが 3 人存在する
      And そのうち 1 人はアクセストークンの再発行に失敗する
      When 自動取込バッチが実行される
      Then 残り 2 人の取込は完了する
      And 失敗件数が 1 になる
      And 失敗したユーザーの識別子がエラーログに記録される

    Scenario: AC-08 正常完了時は打ち切り理由を返さない
      Given 取込対象のユーザーが全員時間内に処理できる
      When 自動取込バッチが実行される
      Then 応答に打ち切り理由が含まれない

    Scenario: AC-13 1 回あたりの上限まで処理しただけでは打ち切り理由を返さない
      Given 取込対象のユーザーが 1 回あたりの処理上限を超えて存在する
      When 自動取込バッチが実行され、上限ぶんのユーザーを時間内にすべて処理する
      Then 応答に打ち切り理由が含まれない
      And 処理されなかったユーザーは時間予算による未着手件数に計上されない

  Rule: 既存の手動導線は変わらない

    Scenario: AC-09 毎時 cron から呼び出される
      Given hourly-cron.yml に ga4-sync のジョブが登録されている
      When 毎時 0 分のスケジュールが発火する
      Then GET /api/cron/ga4-sync が呼ばれる
      And 失敗件数が 1 以上のときジョブが失敗する

    Scenario: AC-10 過去90日の再取込は従来どおり動く
      Given 取込済み最終日が 3 か月前のユーザーが存在する
      When ユーザーが「過去90日を再取込」を実行する
      Then 取得期間は前日から遡って 90 日になる
      And 取込済み最終日の位置は取得期間の決定に影響しない

  Rule: 恒久的に失敗するユーザーが他のユーザーを妨げない

    Scenario: AC-14 失敗したユーザーも順番が最後尾へ回る
      Given 取込対象が 1 回の実行で処理できる上限より多く存在する
      And そのうち数人はアクセストークンの再発行に必ず失敗する
      When 自動取込バッチが連続して実行される
      Then 失敗したユーザーは同じ実行内で最終試行時刻が更新される
      And 次の実行では、まだ試行されていないユーザーが優先して処理される
      And 失敗し続けるユーザーが処理枠を占有し続けることはない

  Rule: 追いつけていないことが運用者に見える

    Scenario: AC-15 遅れているユーザー数が結果に出る
      Given 取込済み最終日が前日より 3 日以上古いユーザーが 5 人存在する
      And 取込済み最終日が一度も記録されていないユーザーが 2 人存在する
      When 自動取込バッチが実行される
      Then 遅れているユーザー数として 7 が返る
      And cron ジョブは警告を出すが失敗にはならない

    Scenario: AC-15b 全員が追いついていれば警告は出ない
      Given すべての取込対象の取込済み最終日が前日である
      When 自動取込バッチが実行される
      Then 遅れているユーザー数として 0 が返る
      And cron ジョブは警告を出さない

  Rule: 1 回の実行で処理する人数に上限を置く

    Scenario: AC-16 上限を超えた対象は次の実行へ回る
      Given 取込対象が 1 回の実行の上限より 5 人多く存在する
      When 自動取込バッチが実行される
      Then 上限ぶんのユーザーが処理される
      And 残りの 5 人は打ち切り理由として報告されない
      And 次の実行でその 5 人が処理される
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| AC-01 / AC-01b | FR-001 | 判断 3（GitHub Actions を継続利用） |
| AC-02 | FR-002 | BR-C01 |
| AC-03 | FR-003 | BR-C03 / 判断 2 |
| AC-04 | FR-003 | BR-C02 |
| AC-11 | FR-003 | BR-C03 |
| AC-12 | FR-003 | BR-C03b |
| AC-05 / AC-05b / AC-06 | FR-004 | BR-C04 / 判断 4 |
| AC-14 | FR-008 | BR-C08 / 判断 5 |
| AC-15 / AC-15b | FR-009 | BR-C09 |
| AC-16 | FR-010 | BR-C06 / 判断 6 |
| AC-07 | FR-005 | BR-C05 |
| AC-08 | FR-005 | BR-C06 |
| AC-13 | FR-005 | BR-C06 / BR-C07 |
| AC-09 | FR-006 | 判断 1（毎時実行） |
| AC-10 | FR-007 | BR-C04 例外 |

## 7. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 1 回の実行は 280 秒以内に自発的に打ち切る（`MAX_DURATION_MS`）。route の `maxDuration` は 300 秒、`invoke-cron.sh` の `--max-time` は 310 秒 | 本番の cron 実行時間をログの `durationMs` で確認 | 既存 `MAX_DURATION_MS = 280_000` を流用。route/maxTime の大小関係は `hourly-cron.yml` 冒頭のルールに従う。**打ち切り判定の粒度はユーザー単位ループの先頭のみ**（既存 `runBatch()` の実装）であり、最後に着手した 1 ユーザーぶんは 280 秒を超え得る。超過して `maxDuration` に達しても 504 として最大 3 回リトライされ、upsert は冪等、進捗は窓単位カーソルに保存済みのため実害は無いと判断し、判定粒度は変更しない |
| 可用性・信頼性 | 1 回の実行で処理しきれなくても、次の毎時実行が続きから再開する。`maxRetries: 3` | AC-03 / 本番ログ | FR-003 の窓単位カーソルにより再開位置が保存される |
| セキュリティ・プライバシー | `CRON_SECRET`・OAuth トークンをレスポンスとログに出さない。ログに出すユーザー識別子は `user_id`（UUID）のみ | コードレビュー・`npm run verify` | 既存 cron 3 本と同一方針 |
| 認証・認可 | cron は `CRON_SECRET` Bearer。取込対象は `admin` / `paid`（BR-C01）。DB アクセスは Service Role で、常に `user_id` でスコープする | AC-01b / AC-02 / 単体テスト | `CLAUDE.md`（サーバー側でも認可を検証する） |
| 監査・ログ | `cron-observability` の構造化ログ（`source: "cron"`, `cron: "ga4_sync"`, `batch_started` / `batch_completed` / `batch_failed`）。個別失敗は `console.error` に `user_id` 付きで記録 | 本番ログ | `CRON_DEFINITIONS.ga4Sync.runBatch()` でラップする（§13 手順 3）。**`runBatch()` が自動で出すのは `batch_started` と、例外時の `batch_failed` だけである**（`src/server/lib/cron-observability.ts:109-122` を 2026-08-21 に実読）。`batch_completed` はラップだけでは出力されず、既存 3 サービスと同じくサービス側で `log('info', 'batch_completed', …)` を明示的に呼んで初めて出る（`gscEvaluationService.ts:556` / `gscSuggestionJobService.ts:34,52` / `googleAdsNegativeKeywordsSuggestionService.ts:519`） |
| 障害対応 | 検知は GitHub Actions のジョブ失敗（`failed > 0` で FAIL）。復旧は次回毎時実行による自動再試行。恒久的な失敗（再認証待ち）はユーザーへの連絡で解消 | AC-07 / AC-09 | RTO/RPO は「翌日分のデータが 1 日遅れる」程度で、明示目標は置かない（MVP） |
| バックアップ・復旧 | 対象外。取込データは GA4 が原本で、`ga4_page_metrics_daily` は再取込で復元できる（「過去90日を再取込」） | 該当なし | データ固有のバックアップ要件は発生しない |
| 運用・監視 | 毎時ジョブの成否（`failed > 0` で FAIL）。`skippedDueToLimit > 0` が慢性化したらスケール限界のサイン（`invoke-cron.sh` の警告）。定常状態では `skipped` / `skippedDueToLimit` / `stoppedReason` のいずれも 0・未設定になり、WARN は出ない設計とする（BR-C07） | GitHub Actions の実行履歴 | 専用ダッシュボードは Non-goal。カーソル到達済みユーザー数は WARN 対象外の `upToDate` で確認する |
| 拡張性・互換性 | 下表のとおり、対象人数 N に対して**全員が前日ぶんに追いつくまで `ceil(N / MAX_USERS_PER_BATCH)` 時間**かかる。`MAX_USERS_PER_BATCH = 30`（FR-010）での上限は **720 人**で、それを超えると遅れが毎日累積する。現在の対象は 17 人 | 実測（2026-08-21）＋下記の計算 | JST 0 時に全対象が「1 日遅れ」になるため、毎時の消化本数で追いつき時間が決まる。**上限への接近は `staleTargets`（FR-009）では検知できない**（N ≤ 720 では遅れが最大 1 日で閾値 3 日に届かず、恒常的に 0 になる）。`staleTargets` は上限超過後の事後 signal である。**接近を継続的に検知する signal は持たない**（現在 17 人 / 上限 720 人で余裕が 2 桁あり、常設の容量監視は要件外。残置合意として §16 に記録） |
| アクセシビリティ | 対象外（UI なし） | 該当なし | 画面を持たない |
| コスト | GA4 Data API は 1 プロパティあたり 1 日 200,000 トークン（標準プロパティ）。1 リクエストは概ね 10 トークン以下。1 ユーザー 1 日あたり数リクエストのため誤差。Vercel の関数実行は毎時 1 回・最大 300 秒 | §8 外部連携の根拠 | 追加課金は発生しない見込み |

### 対象人数と処理能力の関係

JST 0 時に `endDate`（前日）が進むため、その瞬間に**全対象が一斉に「1 日遅れ」**になる。毎時 `MAX_USERS_PER_BATCH` 件ずつ消化するので、全員が前日ぶんに追いつくまでの時間は `ceil(N / MAX_USERS_PER_BATCH)` 時間になる。

| 対象人数 N | 追いつき完了（JST） | 状態 |
| --- | --- | --- |
| 17（2026-08-21 実測） | 01:00 | 余裕あり |
| 100 | 04:00 | 早朝に見たユーザーは前々日までのデータ |
| 300 | 10:00 | 午前中いっぱい遅れが残る |
| 720 | 24:00 | **次の日付切り替えと同着。余裕ゼロ** |
| 720 超 | 追いつかない | 遅れが毎日 1 日ずつ累積する |

- 上の表は `MAX_USERS_PER_BATCH = 30`（FR-010）を前提とする。10 のままなら上限は 240 人。
- **720 は安全余裕ではなく上限そのもの。** そして **`staleTargets`（FR-009）は上限への接近を検知しない。** 上表のとおり N ≤ 720 では全対象が JST 24:00 までに前日ぶんへ追いつくため、カーソルの遅れは最大 1 日にとどまり、閾値「前日より 3 日以上古い」に達しない。**N = 700 でも N = 720 ちょうどでも `staleTargets` は恒常的に 0 で、警告は一切出ない。** 警告が出るのは N が 720 を超えて遅れが実際に 3 日ぶん累積した後であり、超過の何日後に発火するかは超過幅（N と 720 の差）に依存する。
- したがって `staleTargets` は**上限超過を事後に検知する signal** であって、余裕の残量を示すものではない。**「警告が無い＝上限まで余裕がある」とは読めない。**
- **上限への接近を継続的に検知する signal は本仕様では持たない**（残置合意。§16）。理由: 現在の対象は 17 人で上限 720 人に対して 2 桁の余裕があり、対象人数は連携ユーザーの増加ぶんしか増えないため、接近は年単位で緩やかにしか起きない。ここに常設の容量監視を足すのは要件に無い監視機構の新設にあたり、MVP 最優先（`CLAUDE.md`）に反する。対象人数の把握は、リリース後チェックポイント（§13）と、以後 GA4 連携ユーザー数が大きく動いたタイミングでの `gsc_credentials` の件数確認で足りると判断する。
- 閾値を接近検知の側へ下げる案（2 日以上）は、N が上限に近いとき毎時 WARN が出て BR-C07（狼少年化の回避）と衝突するため採らず、**閾値 3 日は維持し、記述側を実態へ合わせた**。
- 追いつき遅延は正しさの問題ではない（データは欠けず、順に埋まる）。ユーザーから見ると「朝は前々日までしか出ない」という鮮度の劣化として現れる。
- 上限に達した場合の打ち手は `MAX_USERS_PER_BATCH` の引き上げ（時間予算が許す範囲）か、実行間隔の短縮。いずれも本仕様のスコープ外で、`staleTargets` の警告が出てから判断する。

### AI機能の追加観点

該当なし。本仕様に LLM 呼び出しは含まれない（取込のみ。評価の文章化は `docs/plans/ga4-content-evaluation-spec.md` の担当）。

## 8. データ・外部連携

### データ

- 作成・更新・削除するデータ:
  - `ga4_page_metrics_daily`: upsert（作成・更新）。削除しない。
  - `gsc_credentials.ga4_last_synced_at`: 更新のみ（前進方向）。
  - `gsc_credentials.access_token` / `access_token_expires_at`: リフレッシュ時に既存 `ensureValidAccessToken` が更新する（本仕様では変更しない）。
- データの所有者: 各ユーザー（`user_id` で分離）。
- 保持期間・削除条件: 既存どおり。本仕様で保持ポリシーは変えない。
- 移行・既存データとの互換性:
  - `gsc_credentials.ga4_last_attempted_at` の追加のみ（NULL 許容・既定値なし）。既存行は NULL で開始し、並び順では NULL が先頭に来るため初回実行から順次埋まる。他の既存列・既存行はそのまま利用する。
  - カーソルが古いユーザー（最古 2026-02-26）は、リリース後の初回実行から 30 日窓ずつ前進する。2026-02-26 停止のユーザーは約 176 日ぶん＝6 窓のため、時間予算次第で数回の実行に分かれる。**データが欠落したまま固定される状態は生じない**。根拠は BR-C03 の打ち切り規則（窓を古い順に処理し、失敗した窓より後ろの窓へ進まないため、カーソルより過去に未取得期間が残らない）である。
  - `ga4_last_synced_at` が NULL の 6 人は `INITIAL_SYNC_DAYS = 30` に従い、前日から 30 日ぶんだけ取り込む。それ以前は取り込まれない（既存仕様どおり。必要なら「過去90日を再取込」で補う）。
- RLS・Service Role・ユーザー境界: cron はユーザーセッションを持たないため Service Role で動く。クエリは必ず `user_id` と `property_id` でスコープする（既存 `syncUser()` の実装がそうなっている）。

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Google Analytics Data API v1 | 日次指標の取得（`runReport`） | `https://www.googleapis.com/auth/analytics.readonly`（`GA4_SCOPE`）。スコープ欠落時は `syncUser()` が例外を投げる | 当該ユーザーを `failed` に計上し、カーソルを進めずに次のユーザーへ進む。次回毎時実行で再試行 | クォータ: `https://developers.google.com/analytics/devguides/reporting/data/v1/quotas`（2026-08-21 確認）。verbatim: 標準プロパティの "Core Tokens Per Property Per Day" は **200,000**／"While most requests will charge 10 or fewer tokens, more complex requests will consume more."（引用から導いた解釈: 1 ユーザー 1 日あたり数リクエストでは上限に対して誤差。ただし "more complex requests will consume more" とあるとおり 10 トークンは上限の保証ではない） |
| Google OAuth 2.0 | アクセストークンの再発行 | `refresh_token` によるサーバー間リフレッシュ（ユーザーセッション不要） | リフレッシュ失敗（トークン失効・連携解除）は例外となり `failed` に計上。ユーザーは `/setup/ga4` を開いた時点で `needsReauth` の表示を受け取る（既存） | `https://developers.google.com/identity/protocols/oauth2`（2026-08-21 取得） |
| GitHub Actions | 毎時の HTTP 発火 | `hourly-cron.yml` の `schedule: '0 * * * *'`。`CRON_SECRET` / `NEXT_PUBLIC_SITE_URL` は既存 Secrets | ジョブ失敗として履歴に残る。次の毎時実行が回収する | 既存 3 本と同一構成 |

- **GA4 のデータ確定遅延について**（公式一次情報で確認済み）:
  - 参照 URL: `https://support.google.com/analytics/answer/11198161`（ページタイトル: `[GA4] Data freshness - Analytics Help`）
  - 確認日: 2026-08-21
  - 公式ページ本文の verbatim 引用:
    - "Data freshness describes how recently data has been collected, processed, and reported in your property."
    - "Data processing can take 24-48 hours."
    - "This is the typical processing time that most data is usually available by. This is not a guarantee, nor an SLA or an SLO."
  - 引用から導いた解釈（引用そのものではない）:
    - 取込後もデータが変動しうるため FR-004 の overlap を置く判断は、公式記述と整合する。
    - `RESYNC_OVERLAP_DAYS = 2` の場合、日 D のデータを最後に取り直すのは D+3 の JST 日付切り替え直後の実行になり、**日 D 終了時点からちょうど +48 時間**にあたる。公式の上限 "24-48 hours" と同着で、余裕が無い。
    - 公式は上記を "not a guarantee, nor an SLA or an SLO" と明記しているため、48 時間を超える遅延は仕様上ありえる。上限と同着の設計は、公式が明示的に否定している前提に依存することになる。
    - `RESYNC_OVERLAP_DAYS = 3` なら最終取り直しが **+72 時間**となり、公式上限に対して 24 時間の余裕を持つ。
  - この解釈にもとづき、**overlap 値は 3 に確定した**（Q-004 の回答。判断 4 / §11）。overlap を置くこと自体は確認結果に依存しない（取り直しが無害な upsert であり、置かない場合の欠損リスクだけが一方的に残るため）。

## 9. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準:
  - cron 基盤は GitHub Actions（`.github/workflows/hourly-cron.yml` + `scripts/invoke-cron.sh` + `CRON_SECRET`）。Vercel Cron は使っていない。
  - `invoke-cron.sh` の `count-batch` プロファイル（`validate_count_batch`）の判定は次のとおり（2026-08-21 に実読）。戻り値の形はこれに合わせる。
    - FAIL: `.success != true`、または `.data.failed > 0`
    - WARN: `.data.skipped > 0`（`// 0` の既定つき数値比較）、`.data.skippedDueToLimit > 0`（同）、`.data.stoppedReason` が**非空文字列**（`// ""` の既定つき `[ -n ]` 判定）
    - 上記いずれのフィールドも参照しない名前（例: `upToDate`）は WARN も FAIL も引き起こさない。
- 再利用する既存実装:
  - `Ga4ImportService.runBatch()` / `syncUser()` / `importWindow()`（`runBatch` は「本番投入後の Cron 実装時に使用予定」とコメント済みの未使用メソッド）
  - `SupabaseService.listGa4SyncTargets()`
  - `resolveGa4SyncRange()` / `splitGa4SyncRange()`（`src/server/lib/ga4-sync-range.ts`。純関数のため単体テスト対象）
  - `defineCronDefinitions()` / `CronObserver.runBatch()`（`src/server/lib/cron-observability.ts`）
  - `app/api/cron/gsc-evaluate/route.ts`（route の雛形）

### 制約条件

- 納期・予算・人員: `docs/plans/ga4-content-evaluation-spec.md` フェーズ3の着手前に完了させる。
- 法令・契約・審査: 該当なし。
- 変更できない既存仕様:
  - `endDate` は常に「前日（JST）」。当日は取り込まない。
  - `MAX_DAYS_PER_WINDOW = 30` / `MAX_TOTAL_ROWS = 50_000`。1 レポートあたりの行数上限を日数で有界化する既存方針を変えない。
  - 取込ディメンションは `landingPage` 軸。本仕様では変更しない。

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| `CRON_SECRET` | GitHub Secrets と Vercel の環境変数に設定済み | 既存 cron 3 本が動作している | 未設定なら 500 を返して cron が失敗する（fail-closed） |
| `NEXT_PUBLIC_SITE_URL` | GitHub Secrets に設定済み | 同上 | ワークフローが起動時に失敗する |
| `gsc_credentials` と `users` の外部キー | PostgREST の埋め込み結合（`users!inner(role)`）が使える | 2026-08-21 に本番で実測し、`.in('users.role', [...])` で 20 件→17 件に絞れることを確認済み | 使えない場合は 2 クエリに分ける（対象が数十人規模のため実害は小さい） |
| `src/server/lib/ga4-sync-range.ts` | `resolveGa4SyncRange()` / `splitGa4SyncRange()` が存在すること | **`develop` には存在せず、`feature/ga4-content-evaluation` にのみある**（2026-08-21 確認）。本仕様の実装は同ブランチ上で行う | `develop` を基点にすると窓分割そのものが無い旧実装が対象になり、FR-003 が成立しない |
| `tests/unit/server/lib/cron-config-consistency.test.ts` | `CRON_CONFIGS` と `hourly-cron.yml` の matrix、route の `maxDuration`、`invoke-cron.sh` の profile 定義が一致していること | 既存テスト。`ga4Sync` を `CRON_CONFIGS` に追加した時点で自動的に検査対象になる | 片方だけ追加すると既存テストが落ちるため、取りこぼしは起きない |

## 10. トレードオフ判断

### 判断 1: 実行頻度を「毎時」にする

- 判断: 日次ではなく毎時の cron に載せる。
- 比較した案:
  - 案A: 1 日 1 回（JST 早朝）の専用スケジュール
  - 案B: 既存の毎時ワークフローに相乗り
- 採用案: 案B
- 採用理由: `endDate` が常に前日固定のため、カーソルが前日に到達しているユーザーは GA4 API を呼ばずに `upToDate` に計上される（FR-004 / FR-005）。毎時にしても実データ取得は JST 日付が変わった後の 1 回だけで、追加コストがほぼ無い。一方で、時間予算で打ち切られたユーザーを同日中に回収できる利点が大きい（対象 17 人のうち 15 人が停止中で、初期は複数回に分かれる）。
- 却下した案と理由: 案A は追加のワークフロー定義が必要で、打ち切りの回収が翌日になる。
- 影響: 毎時 1 回の関数起動と DB クエリが増える。GA4 API 呼び出しは増えない。
- 将来変更する条件: 対象ユーザーが数百人規模になり、毎時のスキップ判定自体が負荷になったとき。
- 判断者・判断日: shoma-endo / 2026-08-21

### 判断 2: カーソルを窓単位で進める

- 判断: `ga4_last_synced_at` を 30 日窓ごとに更新する（現行は全窓成功後に 1 回だけ）。
- 比較した案:
  - 案A: 現行どおり全窓成功後に 1 回だけ更新し、cron 側で 1 回の取込期間を 30 日に制限する
  - 案B: 窓ごとに更新する（前進のみ）
- 採用案: 案B
- 採用理由: 案A でも追いつけるが、手動の「過去90日を再取込」が 3 窓を全部成功させないと 1 日も進まない問題が残る。案B は手動・自動の両方で途中経過が保存され、Vercel の関数がハードキルされた場合にも進捗が失われない。
- 却下した案と理由: 案A は cron 専用の分岐が増え、手動導線の脆さが残る。
- 影響: `updateGscCredential` の呼び出しが窓数ぶん増える（最大 6 回／ユーザー／実行）。前進のみの制約（BR-C02）を守らないと、90 日再取込がカーソルを過去へ戻してしまうため、テストで固定する（AC-04）。
- 将来変更する条件: なし。
- 判断者・判断日: shoma-endo / 2026-08-21

### 判断 3: GitHub Actions を継続利用する

- 判断: Vercel Cron に移行せず、既存の `hourly-cron.yml` に 1 件追加する。
- 比較した案:
  - 案A: Vercel Cron（`vercel.json`）
  - 案B: 既存の GitHub Actions ワークフロー
- 採用案: 案B
- 採用理由: 既存 3 本が案B で動いており、検証プロファイル（`invoke-cron.sh`）・タイムアウト規約・Secrets 管理がすべて揃っている。追加作業は `matrix.include` 1 件と `CRON_CONFIGS` 1 件で済む。実行基盤を混在させると障害時の確認先が 2 か所になる。
- 却下した案と理由: 案A は結果検証（`failed > 0` で赤くする）の仕組みを新たに作る必要がある。
- 影響: なし（既存構成の踏襲）。
- 将来変更する条件: GitHub Actions の無料枠・信頼性に問題が出たとき。
- 判断者・判断日: shoma-endo / 2026-08-21

### 判断 4: 取り直し日数を 3 日にする

- 判断: `RESYNC_OVERLAP_DAYS = 3`（カーソル日とその 2 日前までを取り直す）。
- 比較した案:
  - 案A: 取り直さない（現行）
  - 案B: 2 日
  - 案C: 3 日
  - 案D: 7 日
- 採用案: 案C
- 採用理由:
  - GA4 は取得後もデータが変動するため、現行の「取り込んだら二度と見ない」では確定前の値が固定される。これまで表面化しなかったのは、人間が「過去90日を再取込」を押していたためで、自動化するとその上書きが無くなる。
  - 公式は処理時間を "Data processing can take 24-48 hours." としたうえで "This is not a guarantee, nor an SLA or an SLO." と明記している（§8 に URL・確認日・verbatim）。**上限は保証ではない**ため、上限と同着で設計すると、公式が明示的に否定している前提に依存することになる。
  - overlap = 3 なら、日 D の最終取り直しが D 終了時点から **+72 時間**になり、公式上限に対して 24 時間の余裕を持つ。
  - 追加コストは 1 ユーザーあたり 1 日 1 レポート（**定常状態では 3 日ぶん → 4 日ぶん**）。定常状態ではカーソルが前々日で固定されるため、起点は常に前 4 日・終端は常に前日となり期間は 4 日ぶんに固定される（overlap = 2 なら 3 日ぶん）。追いつき中は 30 日窓ぶんになるが一時的である。対象 17 人で、GA4 の Core Tokens Per Property Per Day = 200,000 に対して無視できる。upsert のため行数も増えない。
- 却下した案と理由:
  - 案A は自動化と同時に欠陥になる（取り直しが一切行われなくなる）。
  - 案B（2 日）は日 D の最終取り直しが D 終了時点の **+48 時間ちょうど**にあたり、公式上限と同着で余裕が無い。上限が保証されていない以上、余裕ゼロの設計は成立しない。
  - 案D（7 日）は毎日 7 日ぶんを取り直すことになり、対象 17 人ぶんの API 呼び出しとバッチ時間が増える。+72 時間を超えて変動する根拠が公式に無い以上、追加の 4 日ぶんは正当化できない。
- 影響: 1 ユーザーあたり 1 日 1 回、定常状態では 4 日ぶんのレポート取得。upsert なので行数は増えない。バッチ時間は 1 ユーザーあたり数百 ms 程度の増加で、`MAX_DURATION_MS = 280_000` に対して影響しない。
- 将来変更する条件: **本番運用で「カーソル通過後に GA4 側の数値が変わり、`ga4_page_metrics_daily` の値が実データとずれている」ことが観測されたとき**（当初の「確定遅延が 48 時間を超えると判明したとき」は、公式表記が "24-48 hours" である以上発火しないため無効。この条件へ書き換えた）。定数 1 か所（`GA4_RESYNC_OVERLAP_DAYS`）の変更で対応する。
- 判断者・判断日: shoma-endo / 2026-08-21（案B から案C へ変更。Q-004 の回答として確定）

### 判断 5: バッチの並び順を「取込済みカーソル」から「最終試行時刻」へ変える

- 判断: `listGa4SyncTargets()` の `order by` を `ga4_last_synced_at` から新設の `ga4_last_attempted_at` へ変える（BR-C08 / FR-008）。
- 比較した案:
  - 案A: `ga4_last_synced_at` 昇順のまま（当初案）
  - 案B: `ga4_last_attempted_at` を新設して昇順にする
  - 案C: 失敗回数を数え、閾値を超えたユーザーを対象から除外する
- 採用案: 案B
- 採用理由:
  - 案A には**先頭固定による餓死**がある。カーソルは成功時にしか前進しない（BR-C03）ため、トークン失効・連携解除で恒久的に失敗するユーザーはカーソルが動かず、毎時必ず先頭に並ぶ。恒久失敗が `MAX_USERS_PER_BATCH` 人に達した時点で、他のユーザーは一切処理されなくなる。実測で `ga4_last_synced_at` が NULL のユーザーが 6 人おり、NULL は常に先頭に並ぶ。停止が 2026-02〜07 の 11 人にトークン失効が含まれていれば、**対象 17 人の現状でも起こりうる**。
  - 案B は 1 列の追加と `order by` の変更だけで、失敗しても順番が最後尾へ回る。リポジトリ内に同じ考え方の先例がある（`src/types/google-ads-negative-keywords-suggestion.ts:6`「直近の配信試行日（JST）。成功・失敗を問わず更新し、cron の同日重複実行を防ぐ」）。
- 却下した案と理由: 案C は失敗回数カラム・閾値・除外解除の導線が要り、除外されたユーザーが今度は**永久に処理されない**別の穴を作る。MVP 最優先（`CLAUDE.md`）に照らして重い。
- 影響: マイグレーション 1 本（`gsc_credentials.ga4_last_attempted_at`）が発生し、当初の「スキーマ変更なし」が崩れる。§4 対象範囲・§8・§12 を更新した。既存行は NULL で開始し、NULL 先頭のため初回実行から順次埋まる。
- 将来変更する条件: 恒久失敗ユーザーが多数を占め、毎時のスロットが実質的に失敗の再試行だけで埋まるようになったとき（そのときは案C 相当のバックオフを検討する）。
- 判断者・判断日: shoma-endo / 2026-08-21

### 判断 6: `MAX_USERS_PER_BATCH` を 10 から 30 へ引き上げる

- 判断: `MAX_USERS_PER_BATCH = 30`（FR-010）。時間予算 `MAX_DURATION_MS = 280_000` による打ち切りは残す。
- 比較した案:
  - 案A: 10 のまま（既存値）
  - 案B: 30
  - 案C: 上限を撤廃し時間予算だけで制御する
- 採用案: 案B
- 採用理由: 10 は時間予算から導かれた値ではなく既定値で、実際には時間予算の方がはるかに緩い。30 なら追いつき上限が 240 人から 720 人になり、JST 0 時からの追いつき時間も 1/3 になる。上限そのものは残すので、1 回の実行が想定外に長引く事態は時間予算と二重に防げる。
- 却下した案と理由: 案A は上限 240 人で、`staleTargets` の警告が出る前提でも余裕が小さい。案C は上限が消えることで、`listGa4SyncTargets()` が返す行数が対象人数に比例して増え、`db-max-rows = 1000`（`docs/context/db-row-limits-and-data-truncation.md`）に将来ぶつかる。
- 影響: 1 回の実行時間が最大 3 倍になりうる。定常状態は 1 ユーザーあたり 1 レポート程度で、30 人でも時間予算 280 秒に対して余裕がある想定だが、**実測はしていない**（無人運用の検証対象外）。リリース後に `durationMs` をログで確認する（§12 本番確認項目）。
- 将来変更する条件: `staleTargets` の警告が慢性化したとき（引き上げ）、または `stoppedReason = 'time_limit'` が常態化したとき（引き下げ、あるいは実行間隔の短縮）。
- 判断者・判断日: shoma-endo / 2026-08-21

## 11. リスク・未確定事項・確認質問

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | リリース直後の初回実行が重い | 停止中 15 人のうち複数が 100 日超の遅れを持つ。1 回の実行で全員を処理できず、時間予算で打ち切られる | FR-003 の窓単位カーソルにより進捗が保存され、毎時実行で追いつく。`skippedDueToLimit` は WARN 扱いで FAIL にしない | 開発チーム | 対策済み（設計に織り込み） |
| R-002 | リフレッシュトークンが失効しているユーザーで毎時 `failed` が出続ける | 実測で `unavailable` を除いても最古 2026-02-26 停止のユーザーがいる。公式 OAuth ドキュメント（`https://developers.google.com/identity/protocols/oauth2`、2026-08-21 確認）はリフレッシュトークンが失効する条件として verbatim で "The refresh token has not been used for six months." / "The user has revoked your app's access." を挙げる。**2026-02-26 停止は 2026-08-21 時点で約 5.8 か月であり、6 か月の失効境界に接近している** | `failed` にユーザー数を計上し、ログに `user_id` を残す。恒久的に失敗するユーザーは開発チームが個別に再認証を依頼する。**通知の自動化は Non-goal**。この運用（開発チームが失敗を検知し、ユーザーへ個別に再認証を依頼する）は `docs/context/client-vision-from-lark.md:69`「実装上の制約やトレードオフ（例: トークン上限による制御）は事前共有が必須」／同 `:150`「水面下で起こってることが一番の問題」に従い、リリース前にクライアントへ事前共有する | 開発チーム | 受容 |
| R-003 | cron が毎時 FAIL し続けて狼少年になる | R-002 が解消されないまま放置されると、GitHub Actions が常時赤になり本当の障害を見落とす | リリース後 1 週間で `failed` の内訳を確認し、恒久失敗のユーザーが残る場合は再認証依頼を完了させる（§13 チェックポイント） | 開発チーム | 監視中 |
| R-004 | GA4 側の連携解除を検知できない | ユーザーが Google 側でアクセス権を削除した場合、リフレッシュが 4xx で失敗する。cron からはトークン失効と区別できない（公式は両者を同じ失効条件の並びで挙げている。R-002 の引用参照） | R-002 と同じ扱い（`failed` として可視化し、個別に確認する）。検知の作り込みは Non-goal。R-002 と同じくクライアントへ事前共有する対象に含める | 開発チーム | 受容 |
| R-007 | 恒久失敗ユーザーがバッチ枠を占有し、他ユーザーが永久に処理されない | カーソル昇順で対象を選ぶと、成功時にしか前進しないカーソルの性質上、トークン失効・連携解除のユーザーが毎時先頭に固定される。恒久失敗が `MAX_USERS_PER_BATCH` 人に達するとバッチ全体が停止する。**実測で `ga4_last_synced_at` が NULL のユーザーが 6 人おり、2026-02〜07 停止の 11 人にトークン失効が含まれれば対象 17 人の現状でも成立しうる** | FR-008 / BR-C08 で並び順を `ga4_last_attempted_at`（成功・失敗を問わず更新）へ変更する。AC-14 で固定する | 開発チーム | 対策済み（設計に織り込み） |
| R-008 | 対象人数が処理能力を超えても気づかない | BR-C06 で `MAX_USERS_PER_BATCH` 到達を打ち切り扱いにしないため、対象が上限を超えても無警告になる。`MAX_USERS_PER_BATCH = 30` では 720 人が上限で、超えると遅れが毎日累積する（§7 対象人数と処理能力の関係） | FR-009 の `staleTargets`（前日より 3 日以上遅れている人数）を別 signal として返し、`invoke-cron.sh` が警告する。AC-15 / AC-15b で固定する。**ただしこれは上限超過を事後に検知する signal であり、上限への接近は検知しない**（N ≤ 720 では遅れが最大 1 日で閾値 3 日に届かず、恒常的に 0 になる。§7 対象人数と処理能力の関係）。**接近を継続的に検知する signal は持たない**ことを残置合意として受容する（§16。現在 17 人 / 上限 720 人で余裕が 2 桁あり、常設の容量監視は要件外） | 開発チーム | 対策済み（設計に織り込み） |
| R-005 | 窓単位カーソルの前進が「過去90日を再取込」でカーソルを巻き戻す | BR-C02（前進のみ）を実装し損ねると、再取込のたびにカーソルが 90 日前へ戻り、以後の増分同期が毎回 90 日ぶんを取り直す | AC-04 を単体テストで固定する | 開発チーム | 対策済み（AC で担保） |
| R-006 | GA4 側にデータが無いユーザーが「正常完了・行数 0」で放置される | BR-C03b により 0 行でもカーソルが前進するため、データストリーム未設定やプロパティ ID の設定違いがあっても cron は成功する。実測で「一度も取込なし」の 6 人が該当しうる（未検証） | 成功指標を「カーソル到達」と「行が入っていること」に分け、リリース後 3 日のチェックポイント（§13）で行数 0 のまま到達したユーザーを洗い出して GA4 側の設定を個別に確認する。自動検知の作り込みは Non-goal | 開発チーム | 監視中 |

### 解決済みの確認事項

| ID | 質問・未確定事項 | 回答が必要な理由 | 回答者 | 状態 |
| --- | --- | --- | --- | --- |
| Q-001 | `unavailable` の 3 人が持つ既存の取込データを削除するか | BR-C01 で取込対象からは外すが、既に入っているデータの扱いは別問題 | shoma-endo | **回答済み（2026-08-21）**: 残す（削除はロール復帰時に不可逆な損失になるため）。BR-C01 の例外欄へ業務ルールとして反映済み。異論があれば別仕様で扱う |
| Q-002 | GA4 のデータ確定遅延の公式な記述（逐語） | `RESYNC_OVERLAP_DAYS` の値の根拠 | 開発チーム | **回答済み（2026-08-21）**: 公式 `[GA4] Data freshness`（`https://support.google.com/analytics/answer/11198161`）の逐語確認により確定。URL・確認日・verbatim 引用は §8 に記載。**この確認結果から Q-004 が発生し、こちらも回答済み** |
| Q-003 | `ga4_last_synced_at` が NULL の 6 人に対し、初回 30 日ではなく 90 日を遡るか | 評価入力の期間上限は 90 日。初回 30 日だと評価開始まで待たせる可能性がある | shoma-endo | **回答済み（2026-08-21）**: 既存どおり 30 日。§4 Non-goals へ理由・将来検討条件つきで移設済み |
| Q-004 | `RESYNC_OVERLAP_DAYS` を 2 のまま維持するか、3 へ変更するか | Q-002 の公式確認により、overlap = 2 では日 D の最終取り直しが D 終了時点の +48 時間ちょうどにあたり、公式上限 "24-48 hours" と同着で余裕が無いことが判明した。公式は同時に "not a guarantee, nor an SLA or an SLO." とも明記している | shoma-endo | **回答済み（2026-08-21）: 3 にする。** 公式が上限を保証していない以上、同着の設計は公式が明示的に否定している前提に依存する。overlap = 3 なら最終取り直しが +72 時間となり 24 時間の余裕を持つ。追加コストは 1 ユーザーあたり 1 日 1 レポートで、対象 17 人・Core Tokens 200,000/日に対して無視できる。判断 4・FR-004・AC-05・§8 解釈・§13 手順 3 へ反映済み |

### 未確定事項（確定前・レビュー完了のブロッカー）

現時点で未回答の確認事項はない（Q-001〜Q-004 はすべて上表で回答済み）。

## 12. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認:
  - `resolveGa4SyncRange()`（純関数）: overlap 適用の起点（`RESYNC_OVERLAP_DAYS = 3` で「カーソルの 2 日前」になること。AC-05）、`already_synced` の境界、`backfillDays` 指定時に overlap を適用しないこと、**overlap がカーソルより前へ 2 日を超えてさかのぼらないこと（AC-05b）**。境界値はカーソル = 前日 / 前々日 / 前々々日 / 100 日前。
  - カーソル前進ロジック: 窓ごとの更新、前進のみの制約（既存値より古い日付を渡しても更新されない）、**0 行の窓でもカーソルが前進すること（AC-12）**、**途中の窓が失敗したら以降の窓を処理せずカーソルが直前の成功窓で止まり `failed` に計上されること（AC-11）**。
  - `runBatch()`: `processed` / `attempted` / `failed` / `skipped` / `upToDate` / `skippedDueToLimit` の集計、**`already_synced` が `skipped` ではなく `upToDate` に計上されること（AC-06）**、正常完了時に `stoppedReason` を含めないこと、**対象取得の上限に達しただけでは `stoppedReason` を含めないこと（AC-13）**、1 人が例外を投げても残りを処理すること。**対象 35 人・`MAX_USERS_PER_BATCH = 30` のとき 30 人が処理され、残り 5 人が `skippedDueToLimit` にも `stoppedReason` にも計上されず、次回実行で先頭に来ること（AC-16。AC-13 の「上限到達では打ち切り理由を返さない」と AC-14 の並び順と合わせて担保する）**。
  - `runBatch()` の時間予算まわりの境界値（FR-005 の `attempted` の定義を固定する）: **対象 10 人・2 人目の処理に入る前に時間予算を超過 → `attempted = 1` / `skippedDueToLimit = 9` / `stoppedReason = 'time_limit'`**。既存実装の加算位置（時間予算チェックより前に `attempted += 1`）のままだと `attempted = 2` / `skippedDueToLimit = 8` となり 1 人ぶんずれるため、このテストで固定する。
  - `listGa4SyncTargets()`: ロール絞り込み（`admin` / `paid` のみ返す）、**並び順が `ga4_last_attempted_at` 昇順・NULL 先頭であること（AC-14）**、`staleTargets` の件数（前日より 3 日以上古い＋NULL）が正しいこと（AC-15 / AC-15b。境界値は前日 / 2 日前 / 3 日前 / NULL）。**対象人数が `MAX_USERS_PER_BATCH` を超えても `staleTargets` が上限で頭打ちにならないこと（例: 対象 35 人・全員 stale → 35 が返る）**。バッチ対象の取得行から数える実装だとこの境界で 30 に頭打ちになるため、独立した件数クエリであることをこのテストで固定する（FR-009）。
  - 恒久失敗ユーザーの餓死しないこと: `syncUser()` が例外を投げても `ga4_last_attempted_at` が更新され、次回の並び順で最後尾へ回ること（AC-14）。
  - route: `CRON_SECRET` 未設定で 500、Bearer 不一致で 401、一致で `runBatch` を 1 回呼ぶ。
  - 実画面確認は不要（UI 変更なし）。ただしリリース後に `/ga4-dashboard` が更新されることを 1 アカウントで確認する。
- Gherkinシナリオとの対応: AC-01〜AC-16（AC-01b・AC-05b・AC-15b を含む全 19 シナリオ）のすべてに単体テストを対応させる。AC-09 は既存の `tests/unit/server/lib/cron-config-consistency.test.ts` が担保する（`CRON_CONFIGS` に `ga4Sync` を追加した時点で、`hourly-cron.yml` の matrix・route の `maxDuration`・`invoke-cron.sh` の profile 定義との一致が自動検査される）。新規テストは不要。
- 外部API・失敗系・境界条件: GA4 API とトークンリフレッシュはモックする。実通信は無人運用の検証対象外（`spec-to-pr` の規約どおり）。
- セキュリティ・権限・RLS: AC-01b と AC-02。Service Role 利用箇所が `user_id` でスコープされていることをレビューで確認する。
- 非機能要件の測定: 本番の初回実行で `durationMs` と `skippedDueToLimit` をログで確認する。

### リリース方針

- リリース単位・段階展開: 1 PR で完結。段階展開はしない（対象 17 人・データは upsert で冪等・スキーマ変更は NULL 許容列の追加 1 本のみで後方互換のため、部分展開の利点が無い）。
- Feature Flag / allowlist: 使わない（Non-goal）。
- データベース変更の適用順序: **`gsc_credentials.ga4_last_attempted_at` の migration を先に適用してからデプロイする**（列が無い状態で新コードが動くと `listGa4SyncTargets()` の `order by` が失敗するため）。列は NULL 許容の追加のみで、既存コードは参照しないため、migration だけ先に当たっても既存動作に影響しない。
- 本番確認項目:
  1. デプロイ後、GitHub Actions の `hourly-cron` を `workflow_dispatch` で手動発火し、`ga4-sync` ジョブが緑になること。
  2. 実行後、対象ロール 17 人の `ga4_last_synced_at` が前進していること（一度で追いつかない場合は数回ぶん進んでいること）。
  3. `unavailable` の 3 人の `ga4_last_synced_at` が変化していないこと（AC-02 の本番確認）。
  4. 3 日後に、対象 17 人全員のカーソルが前日に到達していること。
  5. 3 日後に、カーソルが前日へ到達したのに `ga4_page_metrics_daily` の行数が 0 のままのユーザーがいないこと。いる場合は GA4 側の設定（データストリーム・プロパティ ID）を個別に確認する（R-006）。

### ロールバック方針

- アプリケーションの戻し方: `.github/workflows/hourly-cron.yml` の `matrix.include` から `ga4-sync` の 1 件を削除して push する。これだけで自動実行は止まり、手動導線は従来どおり残る。コード自体の revert は不要。
- DB変更の戻し方・逆マイグレーション: `alter table public.gsc_credentials drop column if exists ga4_last_attempted_at;`。ただし cron を止める（matrix の 1 行削除）だけで自動実行は停止するため、通常は列を残したままでよい。列が残っていても既存の手動導線には影響しない。
- データ不整合時の復旧: `ga4_page_metrics_daily` は upsert のため、誤った値が入った場合は「過去90日を再取込」で上書きする。カーソルが不正に進んだ場合も同じ導線で埋め直せる。
- ロールバック判断者: shoma-endo

## 13. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. 仕様レビュー通過（`.takt/workflows/spec-review.yaml`）
3. 実装（`.takt/workflows/spec-to-pr.yaml`）
   - `src/lib/constants.ts` に `GA4_RESYNC_OVERLAP_DAYS = 3` を追加（値は Q-004 で確定済み。判断 4）
   - `resolveGa4SyncRange()` に overlap を実装（`backfillDays` 指定時は適用しない）
   - `gsc_credentials.ga4_last_attempted_at`（`timestamptz`、NULL 許容）を追加する migration ファイルを**作成する**（FR-008）。**適用（`supabase db push`）は管理者が手動で行う運用のため、実装エージェントは適用しない**（`.agents/skills/supabase/service-usage.md` §6）
   - 適用と `npm run supabase:types` の再生成が済むまでの間は、`src/types/database.types.pending.ts` に `gsc_credentials` の `Row` / `Update` を暫定定義し、`asPendingClient()` 経由でアクセスする（`database.types.ts` の直接編集は禁止。同 §6 の運用ルール）。**適用後に暫定定義を削除し、呼び出し側を生成型へ切り替える**
   - `syncUser()` の入口で `ga4_last_attempted_at` を現在時刻へ更新（成功・失敗を問わない）
   - `listGa4SyncTargets()` の `order by` を `ga4_last_attempted_at` 昇順・NULL 先頭へ変更（FR-008）
   - `staleTargets` の件数取得を**別メソッド**（例: `countStaleGa4SyncTargets()`）として追加する（FR-009）。`listGa4SyncTargets()` の戻り値から数えない（`count: 'exact', head: true` の独立クエリ。理由は FR-009）
   - `MAX_USERS_PER_BATCH` を 10 から 30 へ変更（FR-010）
   - `scripts/invoke-cron.sh` の `validate_count_batch` に `staleTargets > 0` の警告判定を追加（FR-009）
   - `Ga4ImportService.syncUser()` のカーソル更新を窓単位・前進のみに変更
   - `SupabaseService.listGa4SyncTargets()` にロール絞り込みを追加
   - `Ga4ImportService.runBatch()` の戻り値を `count-batch` プロファイルに合わせる（`processed` / `attempted` / `skippedDueToLimit` / `stoppedReason` の定義は FR-005。`attempted += 1` を時間予算チェックの**後**へ移す）
   - `app/api/cron/ga4-sync/route.ts` を新規追加
   - `src/server/lib/cron-definitions.ts` に `ga4Sync` を追加
   - `Ga4ImportService.runBatch()` の本体を `CRON_DEFINITIONS.ga4Sync.runBatch(startedAt => …)` でラップし、**完了時に `CRON_DEFINITIONS.ga4Sync.log('info', 'batch_completed', { durationMs, total, succeeded, failed, skipped })` を明示的に呼ぶ**（既存 3 サービスと同一構成。ラップだけでは `batch_completed` が出力されないため。§7 監査・ログ）
   - `.github/workflows/hourly-cron.yml` の `matrix.include` に 1 件追加
   - 単体テストを `tests/unit/server/lib/ga4-import.test.ts` に追加（既存の GA4 取込テストの集約先）
4. 品質ゲート通過（`npm run verify`）
5. PR作成・レビュー・マージ
6. デプロイ後の本番確認（§12 本番確認項目）

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 仕様レビュー完了 | Non-goals の切り方に異論がないか。未解決の確認事項が残っていないか | shoma-endo | 未確認 |
| Q-002（GA4 の確定遅延の逐語確認） | 公式ページの URL・確認日・verbatim 引用を §8 に記録する | 開発チーム | **完了（2026-08-21）** |
| 実装前 | `GA4_RESYNC_OVERLAP_DAYS = 3` で AC-05 / AC-05b の期待値（起点＝カーソルの 2 日前）と実装が一致していること | 開発チーム | 未確認 |
| マージ前 | `hourly-cron.yml` の `maxTime`（310）> route の `maxDuration`（300）になっているか | 開発チーム | 未確認 |
| マージ前 / デプロイ前 | `gsc_credentials.ga4_last_attempted_at` の migration が本番へ**適用済み**で、`npm run supabase:types` の再生成が反映されていること。**未適用のままデプロイすると `listGa4SyncTargets()` の `order by` が失敗して cron が毎時 500 になるだけでなく、FR-008 の入口書き込みにより既存の手動導線 `POST /api/ga4/sync` まで壊れる**（FR-007 に反する）。適用は管理者の手動作業のため、この確認なしにデプロイしない | shoma-endo | 未確認 |
| リリース前 | R-002 / R-004 の運用（取込失敗を開発チームが検知し、該当ユーザーへ個別に再認証を依頼する。自動通知は行わない）をクライアントへ事前共有したか。**新規の通知機構は追加せず、追跡点のみを置く**（`client-vision-from-lark.md:69` / `:150`） | 開発チーム | 未確認 |
| リリース後 3 日 | 対象 17 人のカーソルが前日に到達しているか。到達していないユーザーの失敗理由。カーソル到達済みで行数 0 のユーザーがいないか（R-006） | 開発チーム | 未確認 |
| リリース後 1 週間 | `failed` が恒久的に出続けるユーザーがいないか（R-003） | 開発チーム | 未確認 |

## 14. 完了条件

- Definition of Done（すべて満たして完了）:
  - AC-01〜AC-16（AC-01b・AC-05b・AC-15b を含む全 19 シナリオ）に対応する単体テストが存在し、`npm run verify` が成功する
  - `gsc_credentials.ga4_last_attempted_at` の migration が本番へ適用され、`npm run supabase:types` の再生成後に `src/types/database.types.pending.ts` の暫定定義が削除され、呼び出し側が生成型へ切り替わっている（`.agents/skills/supabase/service-usage.md` §6）
  - `GET /api/cron/ga4-sync` が `CRON_SECRET` 認証で動作し、`hourly-cron.yml` から毎時呼ばれている
  - 本番で `workflow_dispatch` による手動発火が緑で完了する
  - 実行後、対象ロール（`admin` / `paid`）17 人の `ga4_last_synced_at` が前進している
  - `unavailable` の 3 人の `ga4_last_synced_at` が変化していない
  - リリース後 3 日時点で、対象 17 人の `ga4_last_synced_at` が前日に到達している（到達しない場合は理由が特定され、再認証依頼などの対応方針が決まっている）
  - **カーソルの到達は「データが入っていること」を意味しない**（BR-C03b により GA4 側にデータが無い期間でもカーソルは前進する）。カーソル到達済みで `ga4_page_metrics_daily` の行数が 0 のユーザーは、GA4 側の設定確認まで完了して初めて完了とみなす（R-006）
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - `npm run verify` の出力
  - GitHub Actions の `hourly-cron` 実行履歴（`ga4-sync` ジョブ）
  - 本番 DB の `gsc_credentials` 集計（リリース前後の比較）
  - `cron-observability` の構造化ログ（`cron: "ga4_sync"`）
- 完了確認者・確認日: shoma-endo / 未実施

## 15. 承認・変更履歴

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 | shoma-endo | 未承認 |  | Q-001〜Q-004 は回答済み。承認のブロッカーは残っていない |
| 技術レビュー | 未定 | 未承認 |  | 仕様レビュー（`.takt/workflows/spec-review.yaml`）の指摘は 1 回目 8 件・2 回目 🟡 4 件＋🟢 4 件・3 回目 🟡 4 件＋🟢 4 件をいずれも 2026-08-21 に反映済み。§16 参照 |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-08-21 | 初版作成 | 本番 DB の実測で、GA4 連携済みの対象ロール 17 人中 15 人の取込が停止していることが判明したため | shoma-endo |
| 2026-08-21 | 仕様レビュー指摘の反映（BR-C03 の打ち切り規則化・BR-C03b/BR-C07 追加、FR-003/FR-005/FR-006 の具体化、AC-11〜AC-13 追加、§8 の GA4 確定遅延を公式一次情報の逐語引用へ差し替え、Q-001〜Q-003 のクローズ、Q-004 の新設） | `.takt/workflows/spec-review.yaml` の audit で 🔴 2 件・🟡 6 件の指摘を受けたため | spec-review / revise |
| 2026-08-21 | スケール耐性の見直し（BR-C08 / BR-C09 追加、FR-008〜FR-010 追加、判断 5・判断 6 追加、R-007 / R-008 追加、AC-14〜AC-16 追加、§7 に「対象人数と処理能力の関係」を新設、`gsc_credentials.ga4_last_attempted_at` の migration 追加にともない §4・§12 の「マイグレーションなし」を撤回） | **カーソル昇順の並び順では、恒久失敗ユーザーが処理枠を占有して他ユーザーを永久に処理させない欠陥があると判明した**（対象 17 人の現状でも成立しうる）。あわせて BR-C06 で上限超過を無警告にした結果、処理能力を超えても検知できない穴が残っていた | shoma-endo |
| 2026-08-21 | Q-004 に回答し `RESYNC_OVERLAP_DAYS` を 2 → **3** に確定（判断 4 を案B から案C へ差し替え、FR-004・AC-05 の期待値を「カーソルの 2 日前」へ更新、AC-05b を追加、§8 解釈・§13 手順 3・チェックポイント・承認表・§16 を同期）。ステータスを `in_review` → `review` へ | 公式が処理時間の上限を保証していない以上、overlap = 2（+48 時間同着）は公式自身が否定している前提に依存するため。判断者は shoma-endo | shoma-endo |
| 2026-08-21 | 2 回目 spec-review の指摘 🟡 4 件を反映。①§5 状態遷移表「追いつき中」のカーソル欄に残っていた overlap = 2 前提の `[カーソル - 1 .. 前日]` を `[カーソル - 2 .. 前日]` へ修正。②§7 監査・ログの根拠を実読どおり（`runBatch()` のラップだけでは `batch_completed` は出ない）へ修正し、§13 手順 3 に `CRON_DEFINITIONS.ga4Sync.runBatch()` でのラップと `batch_completed` の明示ログを追加。③FR-005 に `processed` / `attempted` / `skippedDueToLimit` / `stoppedReason` の定義（`attempted` の加算位置を時間予算チェックの後へ移すことを含む）を追記し、§12 に境界値テストを追加。④§13 チェックポイントに「リリース前: R-002 / R-004 の運用をクライアントへ事前共有したか」を追加。あわせて 🟢 4 件（判断 4 の日数幅表記、§8 クォータの verbatim、成功指標の `schedule` 遅延注記、§4 の「壊れたときユーザーに何が見えるか」）も反映 | `.takt/workflows/spec-review.yaml` の 2 回目 audit で 🟡 4 件（🔴 0 件）の指摘を受けたため。いずれも既に仕様書が要求・宣言している事項の記述欠落であり、新規要件の追加ではない | spec-review / revise |
| 2026-08-21 | 3 回目 spec-review の指摘 🟡 4 件・🟢 4 件を反映。①§13 手順 3 の migration「作成・適用」を「ファイル作成のみ（適用は管理者の手動運用）」へ改め、pending types による暫定実装を明記。§13 チェックポイントに「マージ前 / デプロイ前: migration 適用済み」を追加し、§14 完了条件に適用と暫定定義削除を追加。②FR-009 に `staleTargets` を `count:'exact'` の独立クエリで取得する旨を明記し、§13 手順 3 を 2 項目へ分割、§12 に上限超過時の境界値テストを追加。③§7 2 か所と R-008 の「上限接近を `staleTargets` で検知できる」という過大主張を実態（事後 signal）へ訂正し、接近検知を持たないことを §16 残置合意へ記録。④BR-C08 例外欄と FR-008 で `ga4_last_synced_at`（取得期間＋遅延判定）と `ga4_last_attempted_at`（並び順のみ）の役割を排他に再定義。あわせて 🟢 4 件（§4 への `hourly-cron.yml` コメント同期、§12 の AC-16 テスト項目、FR-007 への手動導線の副作用注記、BR-C09 の閾値根拠）も反映 | `.takt/workflows/spec-review.yaml` の 3 回目 audit で 🟡 4 件・🟢 4 件（🔴 0 件）の指摘を受けたため。いずれも記述の定義欠落・実態との食い違いの訂正であり、新規要件の追加ではない。クライアント確認を要する論点は発生していない | spec-review / revise |

## 16. レビュー記録

`.takt/workflows/spec-review.yaml` の audit（1 回目・2 回目・3 回目とも 2026-08-21）に対する対応記録。**後続の audit 再実行および `spec-to-pr` は本セクションを正本として参照する。**

### 公式ドキュメント照合の状況

- **実施済み**（1 回目・2 回目・3 回目とも失敗 URL なし）。
- 1 回目 audit: WebFetch 3 件すべて取得成功。
  - `https://support.google.com/analytics/answer/11198161`（[GA4] Data freshness、2026-08-21）— §8 に verbatim 引用を反映
  - `https://developers.google.com/analytics/devguides/reporting/data/v1/quotas`（2026-08-21）— §7 コスト欄と一致（矛盾なし）
  - `https://developers.google.com/identity/protocols/oauth2`（2026-08-21）— R-002 に verbatim 引用を反映
- 2 回目 audit: WebFetch 5 URL＋GitHub Actions ドキュメントを取得成功（2026-08-21）。上記 3 件の verbatim が公式本文に実在することを再照合したうえで、`.../reporting/data/v1`（非推奨・提供終了告知なし）と `.../oauth2/scopes`（`GA4_SCOPE` が `src/lib/constants.ts:8` と一致）を追加確認。
- revise 側の独自再取得（2026-08-21、いずれも本ステップで WebFetch を実行して verbatim を確認）:
  - `https://support.google.com/analytics/answer/11198161` — "Data processing can take 24-48 hours." が本文に存在することを確認のうえ §8 に転記（1 回目 revise で実施）。
  - `https://developers.google.com/analytics/devguides/reporting/data/v1/quotas` — "While most requests will charge 10 or fewer tokens, more complex requests will consume more." を 2 回の独立取得で同一文言と確認し、§8 クォータ欄へ verbatim として転記（🟢-2 の解消）。
  - `https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows` — `schedule` の遅延・ドロップに関する verbatim を確認し、§1 成功指標の注記へ転記（🟢-3 の解消）。
- 3 回目 audit: WebFetch 6 URL すべて取得成功（2026-08-21、未確認 URL なし）。§8 の Data freshness 3 件・クォータ 2 件、§1 の GitHub `schedule`、R-002 の OAuth 失効条件 2 件を含む verbatim 8 件すべてが公式本文に実在することを再照合し、**公式との矛盾 0 件**。あわせて `.../reporting/data/v1`（`runReport` の実在・非推奨告知なし）と `.../oauth2/scopes`（`analytics.readonly` = "View your Google Analytics data" が `src/lib/constants.ts:8` の `GA4_SCOPE` と一致）を再確認。3 回目 revise では本文の外部サービス記述を変更していないため、revise 側の独自再取得は行っていない。
- audit が「1 回しか再現できなかった」として不採用にした late-arriving events に関する記述は、本仕様の根拠に**採用していない**。

### 2 回目 audit（2026-08-21）の指摘と対応

🔴 は 0 件。🟡 4 件・🟢 4 件はいずれも**本文修正で解消済み**であり、残置合意にした 🟡 は無い。

| 指摘 | 対応 | 反映先 |
| --- | --- | --- |
| 🟡 §5 状態遷移表「追いつき中」に overlap = 2 前提の `[カーソル - 1 .. 前日]` が残存し、FR-004 と起点が二重定義 | 修正済み。`[カーソル - 2 .. 前日]`（＝`カーソル - (RESYNC_OVERLAP_DAYS - 1)`）へ統一 | §5 状態遷移表 |
| 🟡 §7 が求める `batch_completed` に対応する実装手順が無く、根拠欄「既存 `defineCronDefinitions` を利用」が実装と食い違う | 修正済み。`cron-observability.ts:109-122` を実読し、`runBatch()` が出すのは `batch_started` と例外時 `batch_failed` のみであること、`batch_completed` はサービス側の明示 `log()` が必要であることを根拠欄へ反映。§13 手順 3 にラップと明示ログの項目を追加 | §7 監査・ログ／§13 手順 3 |
| 🟡 FR-005 の `processed` / `attempted` / `stoppedReason` が未定義で、実装者裁量になる（既存実装は `attempted += 1` が時間予算チェックより前にあり `skippedDueToLimit` が 1 人ぶんずれる） | 修正済み。FR-005 に 7 フィールドすべての定義と加算位置の変更を明記し、§12 に境界値テスト（対象 10 人・2 人目で予算超過 → `attempted = 1` / `skippedDueToLimit = 9`）を追加 | FR-005／§12 テスト方針 |
| 🟡 R-002 / R-004 が宣言したクライアントへの事前共有に追跡点が無く、未実施でも誰も気づかない | 修正済み。§13 チェックポイントに「リリース前」の 1 行を追加。**新規の通知機構は追加せず、追跡点のみ**（Non-goal 維持） | §13 チェックポイント |
| 🟢-1 判断 4 の「3〜4 日ぶん」幅表記 | 修正済み。定常状態では常に 4 日ぶんに固定される旨へ書き換え（コスト結論は不変） | 判断 4 |
| 🟢-2 §8 クォータ行に verbatim 引用が無く `external-services.md`「引用規約」を満たさない | 修正済み。revise で公式ページを 2 回独立取得し、同一文言を確認のうえ verbatim を追記 | §8 外部連携 |
| 🟢-3 成功指標「1 時間以内」が GitHub の `schedule` 遅延・ドロップ記述と整合しない | 修正済み。公式 verbatim つきで「典型値であり保証ではない」注記を追加。**スケジュール時刻は既存 3 本と共有のため変更しない** | §1 成功指標 |
| 🟢-4 「壊れたときユーザーに何が見えるか」が未記述 | 修正済み。§4 対象範囲に 1 項目追加。新規 UI・通知は追加しない | §4 対象範囲 |

上記のうち FR-005 と §13 手順 3 の変更は、**既存実装の挙動を変える**（`attempted` の加算位置、`stoppedReason` を正常時に返さない）。実装時はこの 2 点を必ず反映すること。

### 3 回目 audit（2026-08-21）の指摘と対応

🔴 は 0 件。🟡 4 件・🟢 4 件で、**いずれも本文修正で解消済み**。クライアント確認を要する論点は含まれず、未解決の実装判断・外部入力・承認ゲートも発生していない。公式ドキュメント照合は 3 回目 audit でも**実施済み**（WebFetch 6 URL すべて取得成功。verbatim 8 件が公式本文に実在することを再照合し、矛盾 0 件）。

| 指摘 | 対応 | 反映先 |
| --- | --- | --- |
| 🟡 §13 手順 3 が migration を「作成・**適用**」と書くが、適用は管理者の手動運用であり無人実装エージェントは実行できない。生成型未反映時の正規の回避手段（`database.types.pending.ts` + `asPendingClient()`）に言及が無く、§14 に適用確認も無い | 修正済み。手順 3 を「migration ファイルを作成する（適用は管理者が `supabase db push` で手動実行）」へ変更し、pending types による暫定実装と適用後の切り替えを明記。§13 チェックポイントへ「マージ前 / デプロイ前: migration 適用済みかつ `npm run supabase:types` 反映済み」（確認者 shoma-endo）を追加。§14 完了条件へ「migration 適用と暫定定義の削除」を追加。未適用デプロイ時に手動導線 `POST /api/ga4/sync` まで壊れることも明記 | §13 手順 3／§13 チェックポイント／§14 |
| 🟡 `staleTargets` の算出方法が未定義。`listGa4SyncTargets(limit)` の戻り値から数えると `MAX_USERS_PER_BATCH = 30` で頭打ちになり、全件取得でも `db-max-rows = 1000` で頭打ちになる。**過小カウントが起きるのは signal が最も必要な場面そのもの** | 修正済み。FR-009 に「`limit` に影響されない独立した件数クエリ（`count: 'exact', head: true`）で取得し、バッチ対象の取得行から数えない」を明記（根拠: `docs/context/db-row-limits-and-data-truncation.md:14` / `:75`）。§13 手順 3 を `order by` 変更と件数取得メソッド追加（例: `countStaleGa4SyncTargets()`）の 2 項目へ分割。§12 に「対象 35 人・全員 stale → 35 が返る」の境界値テストを追加 | FR-009／§13 手順 3／§12 |
| 🟡 §7 拡張性欄・§7 箇条書き・R-008 の「上限に達したことは `staleTargets` で警告される」が設計から導けない。N ≤ 720 では遅れが最大 1 日で閾値 3 日に届かず、**N = 720 ちょうどでも警告は出ない**。運用者が「警告が無い＝余裕がある」と誤読する | 修正済み。3 か所を実態（上限超過後の**事後** signal であり接近は検知しない）へ書き換え、「警告が無い＝余裕がある」とは読めない旨を明記。閾値を 2 日へ下げる案は BR-C07（狼少年化）と衝突するため採らず、**閾値 3 日は維持し記述側を実態へ合わせた**。接近検知の常設 signal を持たないことは下の残置合意へ記録 | §7 拡張性欄／§7 箇条書き／R-008 |
| 🟡 BR-C08 例外欄が `ga4_last_synced_at` を「取得期間の決定にのみ使う」と normative に書くが、同じ仕様書内で `staleTargets` 判定・§1 成功指標・§12 本番確認でも使われており、字義どおり読むと FR-009 が BR-C08 違反に見える。`ga4_last_attempted_at` で stale を測ると恒久失敗ユーザーも毎時更新されるため値が常に 0 になり R-008 の signal が死ぬ | 修正済み。BR-C08 例外欄を「取得期間の決定（BR-C02 / BR-C04）と遅延判定（BR-C09 の `staleTargets`）に使う。並び順には使わない」へ書き換え、FR-008 へ「`ga4_last_attempted_at` は並び順の決定にのみ使い、取得期間・遅延判定には使わない」と誤用時に signal が死ぬ理由を追記。2 列の役割を排他に定義した | BR-C08／FR-008 |
| 🟢 `hourly-cron.yml` 冒頭の `count-batch` プロファイル説明コメントが WARN 対象フィールドを列挙しており、`staleTargets` 追加で実装と食い違う | 修正済み。§4 対象範囲へコメント追記を明記 | §4 対象範囲 |
| 🟢 AC-16 だけ §12 に個別のテスト項目が無く、包括文にしか現れない | 修正済み。§12 `runBatch()` 行へ「対象 35 人・上限 30 → 30 人処理、残り 5 人は `skippedDueToLimit` にも `stoppedReason` にも計上されず次回先頭」を追記（AC-13 / AC-14 と合わせて担保） | §12 テスト方針 |
| 🟢 FR-008 の `ga4_last_attempted_at` 更新は手動導線からも発生するため、FR-007「手動導線の挙動を変えない」と字面が衝突する | 修正済み。FR-007 へ「更新は手動導線でも発生するが、影響は cron の並び順が後ろへ回ることだけで取得期間・レスポンス・UI は不変」を追記 | FR-007 |
| 🟢 §1 成功指標（2 日以上）と BR-C09（3 日以上）で同一列に 2 つの閾値が理由なく併存 | 修正済み。BR-C09 へ「成功指標はリリース後 3 日の一発確認、BR-C09 は毎時発火する常設警告のため BR-C07 の狼少年化回避で 1 日緩めている。定常状態ではどちらも 0」を追記 | BR-C09 |

### 理由付きで残置合意とした論点

| 論点 | 残置とする理由 |
| --- | --- |
| 時間予算（280 秒）の判定粒度がユーザー単位ループ先頭のみで、最後の 1 ユーザーぶん超過し得る（audit 🟢-1） | 超過しても 504 で最大 3 回リトライされ、upsert は冪等、進捗は窓単位カーソルに保存済みで実害が無い。判定粒度を細かくすると窓ループ内に時間管理を持ち込むことになり、MVP 最優先（`CLAUDE.md`）に反する。§7 性能・レイテンシ欄に粒度の注記のみ追加した |
| 失効・連携解除の**通知機構を新設しない**（Non-goals 2 行目、R-002 / R-004） | 要件に無い安全機構であり、`CLAUDE.md` Core Rules および growmate knowledge facet の MVP 最優先方針に従い Non-goal を維持する。失敗は cron の `failed` として 1 時間以内に開発チームへ可視化され、ユーザー向け再認証導線は `/setup/ga4` に既存。audit もこの是非を確認質問として起こしていない。ただし「開発チームが検知して個別に依頼する」という運用そのものは、水面下仕様にしないためクライアントへ事前共有する（R-002 の対策欄） |
| Kill Switch / feature flag / 専用設定テーブル / 監視ダッシュボードを新設しない（§4 Non-goals） | 同上。`hourly-cron.yml` の `matrix.include` から 1 行削除すれば停止できることを実読で確認済み（audit の `mvp-scope-discipline-contract` 行）。過剰実装の混入も無しと判定されている |
| **処理能力の上限（720 人）への接近を継続的に検知する signal を持たない**（3 回目 audit 🟡「`staleTargets` は事後 signal」の派生。§7 対象人数と処理能力の関係 / R-008） | `staleTargets` の記述を実態（上限超過後の事後 signal）へ訂正したうえで、接近検知そのものは作らない。現在の対象は 17 人で上限 720 人に対して 2 桁の余裕があり、対象人数は GA4 連携ユーザーの増加ぶんしか増えないため接近は年単位でしか進行しない。ここに常設の容量監視を足すのは**要件に無い監視機構の新設**にあたり、`CLAUDE.md` Core Rules および growmate knowledge facet の MVP 最優先方針に反する。閾値を 2 日へ下げて接近検知に転用する案は、N が上限に近いとき毎時 WARN が出て BR-C07（狼少年化の回避）と正面衝突するため却下した。超過が起きた場合も `staleTargets` が事後に発火し、打ち手（`MAX_USERS_PER_BATCH` 引き上げ・実行間隔短縮）は遅れが数日ぶん溜まった段階でも間に合う（データは欠けず順に埋まるため。§7 箇条書き 3 点目） |

### レビュー中に差し戻し、その後に解決した論点

- **Q-004: `RESYNC_OVERLAP_DAYS` を 2 のまま維持するか 3 へ変更するか**（§11 / 判断 4）。公式確認で「+48 時間同着」が判明した結果として新たに発生した実装判断。revise では確定させず判断者へ差し戻したが、**2026-08-21 に shoma-endo が 3 を選択して解決済み**。決め手は「公式が上限を保証していないため、同着の設計は公式自身が否定している前提に依存する」点。判断 4・FR-004・AC-05・AC-05b・§8 解釈・§11・§13 へ反映済みで、レビュー完了のブロッカーは残っていない。
