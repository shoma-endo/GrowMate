# supabaseService.ts のドメイン別分割

## メタデータ

- 文書名: supabaseService.ts のドメイン別分割
- ステータス: `draft`
- 作成日: 2026-09-03
- 最終更新日: 2026-09-03
- 作成者: shoma-endo（Claude Code 支援）
- 承認者: shoma-endo
- 対象リリース: 機能リリースと独立。`develop` へマージ後、次の通常デプロイに乗る
- 関連する依頼・Issue・PR: 2026-09 hotspot レビュー第 1 位（`npm run hotspots`）。`docs/runbooks/monthly-maintenance.md` §4

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか: `src/server/services/supabaseService.ts` は 2,829 行（実行行 2,353）、メンバー 79（public 68・protected 4・private 6・constructor）、10 ドメイン（users / chat / wordpress / gsc / googleAds / contentInventory / brief / userDeletion / instagram / 基盤）が 1 クラスに同居している。直近 90 日の churn は 26 回で全ファイル中 2 位。仕様起点の実装（`spec-to-pr`）でこのファイルを触るたびに、無関係ドメインの差分衝突とレビュー範囲の肥大が起きる
- 放置した場合の影響: 新規テーブル追加のたびに末尾へメソッドが増え続ける（`.agents/skills/supabase/service-usage.md` 運用ルール 1 がこのファイルへの追加を基本としている）。eslint `max-lines`（500）の warn 最大件で、月次 hotspot レビューの上位に居座り続ける

### 目的

- この開発で実現する状態: 同じ import パス・同じクラス名・同じ protected API を保ったまま、ドメインごとに 500 行以下のファイルへ分かれている
- 利用者・事業にとっての価値: エンドユーザーへの価値は無い（純粋な内部整理）。開発側では、AI 実装者・レビュアーが 1 ドメイン分だけ読めば済むようになり、`spec-to-pr` の review → fix ループが短くなる

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| `supabaseService.ts` 実行行数 | 2,353 | 30 以下（facade のみ） | `npm run hotspots` | マージ時 |
| 分割後の各ファイル実行行数 | – | 全て 500 以下 | `npm run lint` で `max-lines` warn が新規ファイルに 0 件 | マージ時 |
| 呼び出し側・テストの変更ファイル数 | – | 0（`git diff --stat develop -- src app tests` の変更が `src/server/services/supabase/*.ts`（新規）と `src/server/services/supabaseService.ts` のみ。`tests/` に差分なし） | `git diff --stat develop -- src app tests` | PR レビュー時 |
| 既存テスト | 652 件 pass | 652 件 pass、テストコード無変更 | `npm run test:coverage` | PR 作成時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | 該当なし（エンドユーザー影響なし） | – |
| 運用担当 | 開発者（本人）・AI 実装者 | ドメイン単位でファイルを読める。追加先が迷わず決まる |
| 管理者・承認者 | shoma-endo | 挙動不変の証跡（テスト・行数総和）を見てマージ判断する |
| 外部サービス・連携先 | Supabase | 呼び出し内容は不変 |

### 主な利用シナリオ

1. **AI 実装者が**、**仕様起点で Instagram 関連のメソッドを追加するとき**、`src/server/services/supabase/instagram.ts`（新規）だけを読んで追加する
2. **レビュアーが**、**PR の差分を読むとき**、対象ドメインのファイルだけで判断できる

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
import { SupabaseService } from '@/server/services/supabaseService'
  → 1 ファイル 2,829 行の class SupabaseService（10 ドメイン + 基盤ヘルパー）
  → 6 クラスが extends（protected supabase / success / failure / fetchAllPaged / static withServiceRoleClient を利用）
  → 51 ファイルが new SupabaseService()
  → 20 テストが vi.mock('@/server/services/supabaseService') で差し替え
```

### 導入後（To-Be）

```text
import { SupabaseService } from '@/server/services/supabaseService'   ← パス・クラス名・型 export は不変
  → supabaseService.ts は facade: export class SupabaseService extends SupabaseInstagramService {} と export type { SupabaseResult }
  → src/server/services/supabase/ 配下にドメイン別クラスを線形継承チェーンで配置（各 500 行以下）
  → 6 サブクラス・51 呼び出し側・20 テストは無変更
```

### 業務ルール

- ルール ID: BR-01
- ルール: 公開 API（メソッド名・シグネチャ・戻り値・エラー文言・ログ出力）を 1 つも変えない。メソッド本文は移動のみ
- 例外: なし。改善したい箇所があっても本仕様では触らず、§12 の OPEN に記録する

- ルール ID: BR-02
- ルール: protected / protected static メンバー（`supabase` / `success` / `failure` / `fetchAllPaged` / `withServiceRoleClient`）と public `getClient` はチェーン全体から従来どおり見える
- 例外: なし

- ルール ID: BR-03
- ルール: 分割後の各ファイルは実行行数 500 以下（eslint `max-lines` の基準）
- 例外: なし。超える場合は §6 の分割境界で更に分ける

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`CLAUDE.md` Core Rules）。要件に無い機能は入れない。

### 対象範囲

- 画面・操作: 該当なし
- API・外部連携: 該当なし（Supabase 呼び出し内容は不変）
- データ・DB: 該当なし（migration なし）
- 権限・ロール: 該当なし
- 運用・監視: `.agents/skills/supabase/service-usage.md` の実ファイルパス記載（3 箇所）を分割後の構成に合わせて更新する。`npm run verify:agent-skills` を通す

### Non-goals（今回の対象外）

- 対象外にするもの: 呼び出し側 51 ファイルをドメインクラス直参照へ移行すること / テスト 20 件の mock 対象パス変更 / メソッドの振る舞い・命名・エラーメッセージの改善 / テスト追加のための export 追加や責務分割（`docs/specs/testing-strategy.md` Phase 1〜2 の方針） / 新規テストの追加
- 対象外にする理由: 本仕様の価値は「差分ゼロで読む単位を小さくする」こと。呼び出し側を触ると検証範囲が 71 ファイルに広がり、挙動不変の証跡が弱くなる
- 将来検討する条件・時期: §12 OPEN-001

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-09-03、shoma-endo）
- 含めるもの: 移動実装・型の分離・skill 文書更新・verify
- 含めないもの: 仕様レビュー往復、呼び出し側移行（Non-goal）

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 基盤・型の分離 | `supabase/base.ts`（新規）、`ExtendedDatabase` のドメイン分離 | 2 | 0.25 |
| ドメイン別ファイルへの移動 | 12 ファイル（新規） | 3 | 0.4 |
| facade・skill 文書・verify | `supabaseService.ts` の facade 化、`service-usage.md` 更新、`npm run verify` | 1 | 0.1 |
| **合計** |  | 6 | 0.75 |

幅: 5〜8 時間。上限側は `ExtendedDatabase` 分離時の型エラー対応（ALT-002）。

### 内訳（任意・複雑なら必須）

該当なし（サマリーで足りる）。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: `spec-review` 1 回
- クライアント確認・たたき台合意の見込み: 該当なし（内部作業）
- 希望リリース時期との関係: 制約なし。進行中の機能仕様（`docs/plans/` の `draft` / `review`）が `supabaseService.ts` を変更中なら、その PR のマージ後に着手する（衝突回避）

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | 基盤クラス `SupabaseBaseService` を `src/server/services/supabase/base.ts`（新規）に置き、`supabase` フィールド・`success`・`failure`・`fetchAllPaged`・`getClient`・`withServiceRoleClient`・`SupabaseResult` / `SupabaseErrorInfo` 型を移す | Must | §3 To-Be | 6 サブクラスが無変更で `npm run build` を通る |
| FR-002 | 各ドメインをクラス 1 つ・ファイル 1 つとし、線形継承チェーンで積む（下表） | Must | ALT-001 | 各ファイル実行行数 ≤500、`npm run lint` で新規ファイルに `max-lines` warn なし |
| FR-003 | `src/server/services/supabaseService.ts` を facade にする: `export class SupabaseService extends <チェーン末端> {}` と `export type { SupabaseResult }` のみ | Must | §3 To-Be | 呼び出し側 51 ファイル・テスト 20 件が無変更で pass |
| FR-004 | `ExtendedDatabase` は **未反映 migration の型ではない**。3 表（`google_ads_evaluation_settings` / `google_ads_negative_keywords_settings` / `admin_action_logs`）は生成型 `src/types/database.types.ts` に既に存在し、`ExtendedDatabase` は `status` 等をリテラル union に絞る**型絞り込みオーバーレイ**である。これをドメインごとに分け、`googleAds.ts` にファイル内ローカル型 `GoogleAdsDatabase`（2 表分）、`userDeletion.ts` に `AdminActionLogDatabase` を定義し、`src/types/database.types.pending.ts` の `asPendingClient<TDatabase>(this.supabase)` で取得する。`database.types.pending.ts` 自体は変更しない（PROVISIONAL ブロックを足さない）。3 表の `Row/Insert/Update` 本文と `AdminActionLogStatus` union は現行から移動のみ | Must | ALT-002 | 併合型 `ExtendedDatabase` が消え、各ドメインファイルが自ドメインの表しか型付けしない。`updateAdminActionLogStatus` の引数型（`Extract<AdminActionLogStatus, ...>`）が不変 |
| FR-005 | `.agents/skills/supabase/service-usage.md` の実ファイルパス記載を更新し、「新規テーブル追加時はドメインファイルへ追加、該当ドメインが無ければ新規ファイルをチェーンに挿入」を運用ルールに追記する | Must | §4 対象範囲 | `npm run verify:agent-skills` pass |
| FR-006 | private ヘルパー（`mapGoogleAdsEvaluationSettingsRow` 等の row mapper、`get*Client`）は使うドメインのファイルへ一緒に移す | Must | 結合の局所化 | ドメイン間で private を参照しない |
| FR-007 | `import 'server-only'` は `base.ts`（新規）の先頭に置く。`SupabaseErrorInfo` は export しない（`base.ts` 内でのみ使用。export すると `npm run knip` の未使用 export になる）。`SupabaseResult` だけ `base.ts` から export し、facade が再 export する | Must | knip ゲート | `npm run knip` pass |

### チェーン構成（FR-002）

継承順は下から上へ。順序自体に意味は無い（どのドメインも他ドメインのメソッドを呼ばない。Explore 調査で cross-domain 呼び出し 0 件）。行数は現在の行範囲からの概算。

| 順 | ファイル | クラス | 移すメソッド（現在の行） | 概算行 |
| ---: | --- | --- | --- | ---: |
| 0 | `src/server/services/supabase/base.ts`（新規） | `SupabaseBaseService` | constructor, success, failure, fetchAllPaged, getClient, withServiceRoleClient, `SupabaseResult` / `SupabaseErrorInfo` 型（1–304 のうち googleAds / admin の型を除く） | 200 |
| 1 | `src/server/services/supabase/users.ts`（新規） | `SupabaseUsersService` | getUserById … getAllUsers（305–417） | 115 |
| 2 | `src/server/services/supabase/chatSession.ts`（新規） | `SupabaseChatSessionService` | createChatSession … updateSessionLastMessageAt（418–686）、deleteChatSession（2321–2381） | 330 |
| 3 | `src/server/services/supabase/chatMessage.ts`（新規） | `SupabaseChatMessageService` | createChatMessage … countUserMessagesBetween（687–845） | 160 |
| 4 | `src/server/services/supabase/wordpress.ts`（新規） | `SupabaseWordPressService` | getWordPressSettingsByUserId … refreshWpComToken（846–1057） | 215 |
| 5 | `src/server/services/supabase/gscCredential.ts`（新規） | `SupabaseGscCredentialService` | getGscCredentialByUserId（1058–1107）、upsertGscCredential / updateGscCredential / deleteGscCredential（1474–1648） | 230 |
| 6 | `src/server/services/supabase/gscMetrics.ts`（新規） | `SupabaseGscMetricsService` | upsertGa4PageMetricsDaily / listGa4SyncTargets（1649–1757）、upsertGscQueryMetrics … hasOldGscQueryMetrics（1783–1898）、cleanupOldGscPageMetrics（2300–2320） | 250 |
| 7 | `src/server/services/supabase/gscRanking.ts`（新規） | `SupabaseGscRankingService` | resolveGscPropertyUri / getGscDataFreshness / getRankingSnapshotByUserId / getRankingForQueries（2058–2299） | 245 |
| 8 | `src/server/services/supabase/googleAds.ts`（新規） | `SupabaseGoogleAdsService` | saveGoogleAdsCredential … updateGoogleAdsCustomerId（1108–1473、admin 用 client getter を除く）、deleteGoogleAdsCredential（1758–1782）、googleAds 2 表の型 | 450 |
| 9 | `src/server/services/supabase/contentInventory.ts`（新規） | `SupabaseContentInventoryService` | getContentInventoryByUserId … hasContentInventory（1899–2057）、deleteContentAnnotation（2382–2407） | 190 |
| 10 | `src/server/services/supabase/brief.ts`（新規） | `SupabaseBriefService` | saveBrief / getBrief（2408–2447） | 45 |
| 11 | `src/server/services/supabase/userDeletion.ts`（新規） | `SupabaseUserDeletionService` | deleteUserFully … deleteAuthUser（2448–2670）、`AdminActionLog*` 型、`getAdminActionLogsClient` | 260 |
| 12 | `src/server/services/supabase/instagram.ts`（新規） | `SupabaseInstagramService` | mapInstagramCredentialRow … deleteInstagramCredential（2671–2829）、`InstagramCredential*Row` 型 | 165 |
| 13 | `src/server/services/supabaseService.ts` | `SupabaseService extends SupabaseInstagramService` | facade のみ | 15 |

googleAds が 500 を超えた場合は `googleAdsCredential.ts`（credential + customerId）と `googleAdsSettings.ts`（evaluation settings + negative keywords）に分ける（いずれも新規）。

### 入力・出力・状態遷移

- 入力値・形式・必須条件: 該当なし（API 不変）
- 正常時の出力: 不変
- エラー時の出力: 不変（`failure()` の文言・ログ形式を含む）
- 状態と遷移条件: 該当なし
- 冪等性・重複実行時の挙動: 不変

### 画面設計

該当なし（UI を持たない）。

### 権限

該当なし（認可ロジックを含まない。既存の Service Role 利用範囲は不変）。

## 7. Gherkin受け入れ条件

```gherkin
Feature: supabaseService.ts のドメイン別分割

  Rule: 公開 API と import パスは不変

    Scenario: 既存の呼び出し側が無変更で動く
      Given src と app の 51 ファイルが '@/server/services/supabaseService' から SupabaseService を import している
      When 分割後のブランチで npm run build を実行する
      Then 型エラーが 0 件で、呼び出し側のファイルに差分が無い

    Scenario: 既存のテストが無変更で通る
      Given tests 配下の 20 ファイルが '@/server/services/supabaseService' を vi.mock している
      And 1 ファイルが実クラスを import している
      When npm run test:coverage を実行する
      Then 652 件が pass し、tests 配下に差分が無い

    Scenario: 継承サブクラスが protected API を使い続けられる
      Given 6 クラスが SupabaseService を extends し、supabase / success / failure / fetchAllPaged / withServiceRoleClient を使う
      When 分割後のブランチで npm run build を実行する
      Then 6 クラスに差分が無く、型エラーが 0 件である

  Rule: 分割後の各ファイルは 500 行以下

    Scenario: hotspot 上位から外れる
      When npm run hotspots を実行する
      Then supabaseService.ts と src/server/services/supabase/ 配下のファイルが上位 5 件に入らない

    Scenario: max-lines の warn が増えない
      When npm run lint を実行する
      Then src/server/services/supabase/ 配下と supabaseService.ts に max-lines の warn が 0 件である

  Rule: 挙動を変えない

    Scenario: 移動のみであることを行の多重集合で示す
      Given 分割前の supabaseService.ts と、分割後の supabase/*.ts と facade を連結したもの
      When それぞれから import / export / class 宣言 / 閉じ括弧のみ / 空行を除いた行を sort して比べる
      Then 差分が FR-004 のローカル型宣言行だけである
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 既存の呼び出し側が無変更で動く | FR-003 | ALT-001 |
| 既存のテストが無変更で通る | FR-003 | ALT-001 |
| 継承サブクラスが protected API を使い続けられる | FR-001 | ALT-001 |
| hotspot 上位から外れる | FR-002 | BR-03 |
| max-lines の warn が増えない | FR-002 | BR-03 |
| 移動のみであることを行の多重集合で示す | FR-006 | BR-01 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 対象外。クラス階層が深くなるがメソッド解決はプロトタイプチェーンで定数時間。インスタンス生成コストは不変（フィールド 1 つ） | – | 対象外 |
| 可用性・信頼性 | 対象外（呼び出し内容不変） | – | 対象外 |
| セキュリティ・プライバシー | Service Role クライアントの露出範囲を広げない。`getClient` の可視性は public のまま（既存どおり） | コードレビュー | 現状維持 |
| 認証・認可 | 対象外 | – | 対象外 |
| 監査・ログ | `failure()` のログ出力形式不変 | 既存テスト | 現状維持 |
| 障害対応 | 対象外 | – | 対象外 |
| バックアップ・復旧 | 対象外 | – | 対象外 |
| 運用・監視 | `npm run hotspots` と `max-lines` warn 件数で分割効果を月次確認 | `docs/runbooks/monthly-maintenance.md` §4 | 本仕様で導入 |
| 拡張性・互換性 | 新規ドメインはチェーン末端の直前に 1 ファイル挿入で追加できる | `service-usage.md` 運用ルール | FR-005 |
| アクセシビリティ | 対象外 | – | 対象外 |
| コスト | 対象外 | – | 対象外 |

### AI機能の追加観点

対象外（AI 機能を含まない）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: 該当なし
- データの所有者: 該当なし
- 保持期間・削除条件: 該当なし
- 移行・既存データとの互換性: 該当なし
- RLS・Service Role・ユーザー境界: 不変

### 外部連携

該当なし。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: TypeScript のクラス継承（static メンバーも継承される）。`.agents/skills/supabase/service-usage.md` の「継承で拡張する」方針
- 再利用する既存実装:
  - 再利用: `src/types/database.types.pending.ts` の `asPendingClient()`。根拠: `src/server/actions/gscDashboard.actions.ts` と `src/server/services/ga4ContentEvaluationBatchService.ts` が同じ用途で使用済み
  - 再利用: 既存の継承サブクラス（`src/server/services/briefService.ts` 等 6 件）は触らない
  - 新規が必要: `src/server/services/supabase/` ディレクトリ（新規）。GrowMate にサービスのサブディレクトリ前例は無いが、`services/` 直下に 13 ファイルを並べると他サービスと混ざるため採用

### 制約条件

- 納期・予算・人員: なし
- 法令・契約・審査: なし
- 変更できない既存仕様: import パス `@/server/services/supabaseService`、クラス名 `SupabaseService`、`SupabaseResult` 型の export、protected API

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| `supabaseService.ts` を変更中の他仕様 | 当該 PR がマージ済み | `git log develop -- src/server/services/supabaseService.ts` | rebase で大量衝突。着手を後ろへ |

## 11. トレードオフ判断

### ALT-001: 分割方式

- 判断: ドメイン別ファイルへの分け方
- 比較した案:
  - 案A: 線形継承チェーン（base → users → … → instagram → facade）
  - 案B: ドメインクラスを合成する facade（72 本の委譲メソッドを facade に書く）
  - 案C: 呼び出し側をドメインクラス直参照へ移行し、facade を廃止
- 採用案: 案A
- 採用理由: import パス・クラス名・protected API・`vi.mock` 対象が完全に不変で、検証が「tsc + 既存テスト + 行数総和」で閉じる。AI 実装で人がコードを読まない前提では、差分の局所性が最重要
- 再調査: GrowMate 内のサービス分割前例（0 件）、TS mixin パターン（protected の型付けが崩れる） / より良い案なし
- 却下した案と理由: 案B は boilerplate 72 本と protected の喪失。案C は 71 ファイル変更で挙動不変の証跡が弱い。案C は Phase 2（OPEN-001）に残す
- 影響（コスト・納期・品質・運用・拡張性）: チェーンが 13 段で「ドメイン順に意味が無い」違和感が残る。運用上は末端直前に挿入するだけ
- 将来変更する条件: 呼び出し側の移行を決めたとき（OPEN-001）
- 判断者・判断日: shoma-endo・2026-09-03

### ALT-002: 型絞り込みオーバーレイ `ExtendedDatabase` の扱い

- 判断: `ExtendedDatabase`（googleAds 2 表 + admin_action_logs を生成型の上にリテラル union で絞る併合型）をどう分けるか
- 比較した案:
  - 案A: ドメインごとのファイル内ローカル型（`GoogleAdsDatabase` / `AdminActionLogDatabase`）に分け、`asPendingClient<T>()` でクライアントを取得
  - 案B: 併合型を `base.ts` に残して全ドメインから参照
  - 案C: オーバーレイを捨てて生成型（`status: string`）をそのまま使う
- 採用案: 案A
- 採用理由: base が特定ドメインの表を知らなくなる。`asPendingClient<TDatabase>(client)` の型引数は任意の Database 形なので、未反映 migration 用でなくても使える（`src/server/actions/gscDashboard.actions.ts` に前例）
- 再調査: 3 表が `src/types/database.types.ts` に生成済みであることを確認（17 / 647 / 682 行）。よって `database.types.pending.ts` に PROVISIONAL ブロックを足す対象ではない / より良い案なし
- 却下した案と理由: 案B は base がドメイン知識を持ち続け、分割の意味が薄れる。案C は `updateAdminActionLogStatus` の引数型が緩み BR-01 に反する
- 影響: 型の書き換えで最大 2 時間の上振れ
- 将来変更する条件: 生成型側で `status` が enum になりオーバーレイが不要になったとき
- 判断者・判断日: shoma-endo・2026-09-03

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 移動時にメソッド本文が改変される | AI 実装者が「ついでに」直す | BR-01 と行数総和 ±5% の完了条件。self_review で「移動のみ」を確認 | 実装者 | 対策済 |
| R-002 | private ヘルパーの取り違え | 別ドメインの row mapper を参照 | FR-006。tsc で private 参照エラーになる | 実装者 | 対策済 |
| R-003 | 進行中の機能 PR との衝突 | 同ファイルを変更中の仕様がある | §10 依存関係。着手前に `git log` で確認 | 承認者 | 未確認 |

### 確認質問

該当なし（内部作業で外部回答を要しない）。

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 呼び出し側 51 ファイルをドメインクラス直参照へ移行し、チェーンを平坦化するか。平坦化するとサブクラスが他ドメインの public メソッドを `this.` で呼んでいる箇所（`headingFlowService` → `createChatMessage` / `updateSessionLastMessageAt`、`ga4ContentEvaluationService` → `getGscCredentialByUserId`）の扱いを決める必要がある | 本仕様の効果（レビュー範囲縮小）が出るかを先に見る | 本 PR マージ後 1 か月の月次メンテ hotspot レビュー | shoma-endo |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認: 新規テストは書かない。既存 652 件を無変更で通す。実画面確認は不要（呼び出し内容不変）
- Gherkinシナリオとの対応: §7 の全シナリオを `npm run verify` と `npm run hotspots`、`git diff --stat` で確認
- 外部API・失敗系・境界条件: 対象外（不変）
- セキュリティ・権限・RLS: 対象外（不変）
- 非機能要件の測定: `npm run hotspots`、`npm run lint` の `max-lines` 件数

### リリース方針

- リリース単位・段階展開: 1 PR。段階展開なし
- Feature Flag / allowlist: なし
- データベース変更の適用順序: なし
- 本番確認項目: デプロイ後にチャット送信・GSC ダッシュボード表示・設定保存の 3 操作をスモーク確認（各ドメインのメソッドが解決されることの確認）

### ロールバック方針

- アプリケーションの戻し方: PR revert
- DB変更の戻し方・逆マイグレーション: なし
- データ不整合時の復旧: 該当なし
- ロールバック判断者: shoma-endo

## 14. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. Gherkin受け入れ条件の確定（§7 に記載済み。`grill-to-gherkin` は省略）
3. 仕様レビュー通過（`.takt/workflows/spec-review.yaml`）
4. 実装（`.takt/workflows/spec-to-pr.yaml`）: base → 各ドメイン → facade → skill 文書の順。1 ドメイン移すごとに `npx tsc --noEmit` で確認
5. 品質ゲート通過（`npm run verify`、`npm run verify:agent-skills`）
6. PR作成・レビュー・マージ

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| CP-1 着手前 | `supabaseService.ts` を変更中の他 PR が無い（R-003） | shoma-endo | 未確認 |
| CP-2 PR 作成時 | `git diff --stat develop -- src app tests` の変更が `src/server/services/supabase/*.ts` と `src/server/services/supabaseService.ts` のみ（`tests/` 差分なし）。それ以外は `.agents/skills/supabase/service-usage.md` と、workflow が書く仕様書ステータス・`vitest.config.ts` の閾値ラチェット・README 同期に限る | spec-to-pr self_review | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - `npm run verify` 緑（audit / lint / test:coverage / build / knip）
  - `npm run verify:agent-skills` 緑
  - `npm run lint` で `src/server/services/supabase/` 配下と facade に `max-lines` warn が 0 件
  - `npm run hotspots` の上位 5 件に `supabaseService.ts` と `src/server/services/supabase/` 配下が入らない
  - `git diff --stat develop -- src app tests` の変更が `src/server/services/supabase/*.ts`（新規）と `src/server/services/supabaseService.ts` のみ。`tests/` に差分なし
  - 移動のみの機械確認: 次の 2 つの出力の差分が FR-004 のローカル型宣言行だけである

    ```bash
    filt() { grep -vE '^\s*(import |export |class |\}\s*$|$)' | sort; }
    git show develop:src/server/services/supabaseService.ts | filt > /tmp/before.txt
    cat src/server/services/supabase/*.ts src/server/services/supabaseService.ts | filt > /tmp/after.txt
    diff /tmp/before.txt /tmp/after.txt
    ```
  - `tests/unit/server/services/supabaseService.negativeKeywordsDue.test.ts`（唯一実クラスを使うテスト）が無変更で pass
- 検証方法・証跡（テスト結果・画面確認・ログ等）: PR 本文に verify のログ末尾、hotspots の表、`git diff --stat` を貼る
- 完了確認者・確認日: shoma-endo・未

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| – | – | – | 未実施 | – |

#### 公式ドキュメント照合

- 実施 / 未実施: 対象外（外部サービス連携の変更なし）
- 参照 URL と確認日: 該当なし

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 | shoma-endo | 未承認 |  |  |
| 技術レビュー | spec-review | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-03 | 初版 | hotspot レビュー第 1 位の分割 | shoma-endo（Claude Code 支援） |
