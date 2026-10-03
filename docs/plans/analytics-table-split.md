# AnalyticsTable.tsx を行・セル・フックに分ける

## メタデータ

- 文書名: AnalyticsTable.tsx を行・セル・フックに分ける
- ステータス: `approved`
- 作成日: 2026-10-03
- 最終更新日: 2026-10-03
- 作成者: shoma-endo（Claude Code 支援）
- 承認者: shoma-endo（§16 の要件承認で確定する）
- 対象リリース: 機能リリースと独立。PR #596 のマージ後に着手し、`develop` へマージ後の通常デプロイに乗る
- 関連する依頼・Issue・PR: 2026-10-03 可読性レビュー。`npm run hotspots`（develop 4fd6ae2e）の第 3 位で、churn は全ファイル中 1 位（90 日で 34 回）。前提 PR #596。同時に起こした `docs/plans/chat-layout-split.md` / `docs/plans/client-page-boundary.md`

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか: `src/components/AnalyticsTable.tsx` は PR #596 の版（ce60787c）で 1,747 行、実行行 1,563（`scripts/hotspots.sh` の数え方）。1 つのコンポーネントに次の 5 つが同居している。
  - フィルター: カテゴリと 3 つの状態、URL との同期、localStorage からの復元。`:412-899` のうち約 450 行
  - 行の操作: チャット起動、編集ダイアログ、削除
  - 並べ替え
  - 行の描画: 編集ダイアログを行ごとに持つ
  - データ列の描画: `switch` で 224 行
  
  90 日の churn は 34 回で、全ファイル中もっとも多く触られている。ブログ一覧の小さな変更でも、フィルターの effect の順序に依存するコメント（`:629-631`）まで含めた 1,500 行を読む必要がある
- 放置した場合の影響: Instagram タブ（PR #596）のように、一覧の部品を別の画面で使うたびにこのファイルへ export が増える。#596 では選択列・操作列・起動ボタンの 7 つが export された（`app/analytics/components/InstagramMediaTable.tsx:42-50`）

### 目的

- この開発で実現する状態: `@/components/AnalyticsTable` の import パス、default export、named export を保ったまま、フィルター・行の操作・行・データ列を別ファイルへ移す。各ファイルを実行行 500 以下にする
- 利用者・事業にとっての価値: エンドユーザーへの価値はない（内部整理）。開発側は、フィルターなら `useAnalyticsTableFilters.ts`、列の表示なら `AnalyticsTableDataCells.tsx` だけ読めば済むようになる

### 成功指標

| 指標 | 現状（ce60787c） | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| `AnalyticsTable.tsx` 実行行数 | 1,563 | 500 以下 | `npm run hotspots` | マージ時 |
| 新規ファイルの実行行数 | – | すべて 500 以下 | `npm run lint` で新規ファイルに `max-lines` の warn が 0 件 | マージ時 |
| 呼び出し側・テストの変更 | – | 0（`app/analytics/` と `tests/` に差分がない） | `git diff --stat "${B}" -- app/analytics tests`（`B` は §13 の基準コミット） | PR レビュー時 |
| `eslint-suppressions.json` の件数 | `AnalyticsTable.tsx` に `no-arbitrary-values: 11` / `no-inline-styles: 9` / `no-raw-colors: 27` | ルールごとの合計が同じ（11 / 9 / 27）で、`AnalyticsTable.tsx` と `src/components/analytics-table/` 以外のエントリに差分がない | `git diff "${B}" -- eslint-suppressions.json`（`B` は §13 の基準コミット）とルール別の合計 | PR レビュー時 |
| 既存テスト | 全件 pass | `npm run verify` が緑 | `npm run verify` | PR 作成時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | 該当なし（見た目・挙動は変わらない） | – |
| 運用担当 | 開発者（本人）・AI 実装者 | 関心ごとに 1 ファイルを読めば済む |
| 管理者・承認者 | shoma-endo | 移動のみの証跡（§7）と手動確認の結果を見てマージを判断する |
| 外部サービス・連携先 | 該当なし | – |

### 主な利用シナリオ

1. **AI 実装者が**、**ブログ一覧に状態フィルターを 1 つ足すとき**、`src/components/analytics-table/useAnalyticsTableFilters.ts`（新規）と、フィルターのタグを描く `AnalyticsTable.tsx` の `ActiveFilterBar` だけを読む
2. **AI 実装者が**、**一覧に GA4 の列を 1 つ足すとき**、`src/components/analytics-table/AnalyticsTableDataCells.tsx`（新規）の `switch` に `case` を足す

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
app/analytics/AnalyticsClient.tsx:8              import AnalyticsTable（default）
app/analytics/components/InstagramTab.tsx:9      import { ActiveFilterBar, FilterTag }
app/analytics/components/InstagramMediaTable.tsx:42-50  import 選択列・操作列・LaunchChatButton など 7 つ
  → src/components/AnalyticsTable.tsx 1,747 行（部品 + フィルター + 行操作 + 並べ替え + 行 + データ列）
```

### 導入後（To-Be）

```text
呼び出し側 3 ファイル                              無変更
src/components/AnalyticsTable.tsx                  入口。Props、ActiveFilterBar / FilterTag、並べ替え、フックの呼び出し、table と thead の描画、
                                                   7 つの部品の再 export
src/components/analytics-table/（新規ディレクトリ）
  AnalyticsTableCells.tsx                          選択列・操作列・LaunchChatButton と、操作列の開閉状態のフック
  useAnalyticsTableFilters.ts                      フィルターの state・URL 同期・復元
  useAnalyticsTableLaunch.ts                       チャット起動
  useAnalyticsTableEdit.ts                         編集ダイアログの state と保存
  useAnalyticsTableDelete.ts                       削除ダイアログの state と削除
  AnalyticsTableRow.tsx                            1 行（選択セル・操作セル・編集ダイアログ・詳細・削除）
  AnalyticsTableDataCells.tsx                      データ列の switch と表示用の値
```

### 業務ルール

- ルール ID: BR-01
- ルール: 本体は移動のみ。マークアップ、クラス、文言、`title` / `aria-*`、ハンドラ・useMemo・useEffect の本文、依存配列、メモ化の有無、URL の組み立て、localStorage のキーを変えない。変えてよい行は FR-010 に列挙したものだけ
- 例外: なし。気づいた改善は §12 の OPEN に記録する

- ルール ID: BR-02
- ルール: effect の実行順を変えない。現行の順は、操作列の開閉状態（`useAnalyticsOpsColumnState` の effect `:196`）→ ChatService の生成（`:483-487`）→ フィルターの effect（`:535` 以降）。加えて `pushFilterQuery`（`:568-649`）は、子の `FieldConfigurator` の effect が親の effect より先に走ることを前提にしている（`:629-631` のコメント）。フィルターのフックは `AnalyticsTable` の中で呼び、`FieldConfigurator` の親であり続ける
- 例外: なし。effect を持たないフック（FR-004・FR-005）は位置を動かしてよい

- ルール ID: BR-03
- ルール: 描画される DOM を変えない。行とデータ列を子コンポーネントにしても、出力される `<tr>` / `<td>` の並びと属性は現行と同じにする。`key` は現行の `<tr>` から `<AnalyticsTableRow>` へ移す
- 例外: なし

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。要件に無い機能は入れない。

### 対象範囲

- 画面・操作: `/analytics` のブログタブと Instagram タブ（部品を使っている）。見た目・操作は変わらない
- API・外部連携: 該当なし
- データ・DB: 該当なし
- 権限・ロール: 該当なし
- 運用・監視: `eslint-suppressions.json` の件数をファイル間で付け替える（Q-001・ALT-002）

### Non-goals（今回の対象外）

- 対象外にするもの:
  - lint 違反（生の色・任意値・inline style）の解消。理由: 色クラスを変えると見た目が変わり、growmate-ui-ux の「色クラスを自分の判断で変えない」（`.agents/skills/growmate-ui-ux/SKILL.md:24`）に反する
  - `ActiveFilterBar` / `FilterTag` の移動。理由: growmate-ui-ux が「`AnalyticsTable.tsx` の `ActiveFilterBar` / `FilterTag`」を共通部品の実例として名指ししている（同 `:22` / `:35`）。入口に残せばこの記述を書き換えずに済む
  - 並べ替え（`:1093-1118`、約 30 行）の切り出し。理由: 500 行の目標に必要ない
  - 編集ダイアログ（`:1364-1454`）を行から別ファイルへ出すこと。理由: 行のファイルは約 240 行で、500 行の目標に必要ない
  - 行内の値 `hasUnreadSuggestion`（`:1290`）が同名の prop を隠している点と、`annotation.session_id` を `?.` なしで読んでいる点（`:1419`）の修正 → OPEN-001
  - `src/hooks/useAnnotationForm.ts` との統合。理由: 似た編集フォームだが、統合すると挙動が変わる
  - 既存の仕様書（`docs/specs/*`、および PR #596 自身の仕様 `docs/plans/instagram-high-engagement-blog-draft-spec.md`）にある `AnalyticsTable.tsx` の行番号の更新。理由: 行番号は書いた時点の版を指す記録で、当時の行番号のままでよい
  - `features/` 構成への移行、`app/api` の更新系 Route の Server Action 化、jsx-a11y の導入。理由は `docs/plans/client-page-boundary.md` §4 と同じ
- 対象外にする理由: 本仕様の価値は「差分を移動だけにして、churn がもっとも多いファイルの読む単位を小さくする」こと
- 将来検討する条件・時期: §12 の OPEN を参照

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-03、Claude 案）
- 含めるもの: 移動・抑制記録の付け替え・`npm run verify`・§7 の行比較・手動確認
- 含めないもの: 仕様レビューの往復、PR #596 のマージ待ち

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 移動 | 新規 7 ファイル、`AnalyticsTable.tsx` の書き換え | 2.5 | 0.3 |
| 抑制記録 | `eslint-suppressions.json` の付け替え（ALT-002） | 0.5 | 0.1 |
| 検証 | `npm run verify`・§7 の行比較・§13 の手動確認 | 1.5 | 0.2 |
| **合計** |  | 4.5 | 0.6 |

幅: 4〜6 時間。上限側は、行コンポーネントへ渡す値が想定より多かった場合（R-001）。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: `spec-review` 1 回
- クライアント確認・たたき台合意の見込み: 該当なし（内部作業）
- 希望リリース時期との関係: §10 の依存（PR #596 のマージ）を満たしたあと

## 6. 機能要件

行番号はすべて PR #596 の版（`feat/instagram-blog-draft` の ce60787c）の `src/components/AnalyticsTable.tsx`。#596 がこのあとさらに変わった場合は、着手時に §13 の基準コミット `B`（マージ後の `origin/develop` との merge-base）で行番号を読み替える（§14 手順 1）。

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | `src/components/analytics-table/AnalyticsTableCells.tsx`（新規）に `:73-123`（選択列の定数と 3 部品）、`:163-189`（`LaunchChatButtonProps` と `LaunchChatButton`）、`:191-275`（`useAnalyticsOpsColumnState`、操作列の定数・型・`getAnalyticsOpsColumnStyle`、2 部品）を移す。`useAnalyticsOpsColumnState` はこのファイルからは export するが、入口からは再 export しない（現行どおり外部非公開） | Must | §3 To-Be | 入口の named export が現行の 9 つ（`ANALYTICS_SELECTED_ROW_CLASS`・`AnalyticsSelectionCheckbox`・`AnalyticsSelectionHeaderCell`・`AnalyticsSelectionCell`・`LaunchChatButton`・`AnalyticsOpsHeaderCell`・`AnalyticsOpsCell`・`ActiveFilterBar`・`FilterTag`）と一致する |
| FR-002 | `src/components/AnalyticsTable.tsx` は FR-001 の 7 つを `export { … } from './analytics-table/AnalyticsTableCells'` で再 export する。`ActiveFilterBar` / `FilterTag` / `FILTER_TAG_TONE_CLASSES`（`:294-374`）は入口に残す | Must | 呼び出し側無変更 | `app/analytics/` に差分がなく `npm run build` が通る |
| FR-003 | `src/components/analytics-table/useAnalyticsTableFilters.ts`（新規）に、フィルターの ref（`:412-416`）、state と派生値（`:418-468`）、`allCategories`（`:489-504`）、保存・URL 同期・復元・変更・解除のハンドラと effect（`:506-899`）を移す。`router` / `pathname` / `searchParams` は引数で受け取る。`visibleColumnIdsRef` はこのフックが持ち、並べ替えの `handleFieldConfigChange`（`:1113-1118`）が書けるよう戻り値に含める。`AnalyticsTable` は戻り値を分割代入で受け取り、`filters.visibleColumnIdsRef.current = …` のように戻り値のオブジェクト経由で書き換えない（`react-hooks/immutability` が error にする） | Must | §3 To-Be | BR-02 を満たす |
| FR-004 | `src/components/analytics-table/useAnalyticsTableLaunch.ts`（新規）に `LaunchPayload`（`:152-161`）、`pendingRowKey`（`:393`）、`handleLaunch`（`:901-946`）を移す。`router` は引数で受け取る（FR-003 と同じ。`handleLaunch` が `:933` で使う） | Must | §3 To-Be | – |
| FR-005 | `src/components/analytics-table/useAnalyticsTableEdit.ts`（新規）に `createEmptyForm`（`:288-292`）、編集の state（`:394-401`）、`openEdit` / `closeEdit` / `handleSave` / `handleSummarySuccess`（`:948-1026`）を移す。`router` は引数で受け取る（FR-003 と同じ。`:1004` / `:1023` で使う） | Must | §3 To-Be | – |
| FR-006 | `src/components/analytics-table/useAnalyticsTableDelete.ts`（新規）に削除の state と `chatServiceRef`（`:402-411`）、ChatService を作る effect（`:483-487`）、`handleDeleteClick` / `handleDeleteConfirm`（`:1028-1091`）を移す。`router` は引数で受け取る（FR-003 と同じ。`:1079` で使う） | Must | §3 To-Be | – |
| FR-007 | `src/components/analytics-table/AnalyticsTableRow.tsx`（新規）に、`items.map` のコールバック本体（`:1277-1727`）を移す。ただし FR-008 へ移す部分を除く。行は、`item`・`selection`・`unreadAnnotationIds`・操作列の開閉状態・`orderedIds`・`visibleSet`・FR-004〜006 の戻り値（フックごとに 1 つのオブジェクト `launch` / `edit` / `del`。ref を含まないので R-001 のまとめ方で immutability の問題は起きない）を props で受け取る。行の関数の冒頭で props と `launch` / `edit` / `del` を分割代入し（例: `const { pendingRowKey, handleLaunch } = launch;`）、移した本文の参照名は 1 つも変えない（存在しないキーを分割代入すると `npm run build` の型エラーになり、別のフックの値との取り違えが残らない）。入口に残る本文（`DeleteChatDialog` の描画など）が使うフックの値も、入口で同じく分割代入して参照名を変えない。`selection` の型（現行は入口の `interface Props` の中 `:140-149`）は `AnalyticsTableRow.tsx` に `export interface AnalyticsTableSelection` として移し、入口の `Props` は `selection?: AnalyticsTableSelection;` とする | Must | §3 To-Be | BR-03 を満たす |
| FR-008 | `src/components/analytics-table/AnalyticsTableDataCells.tsx`（新規）に、`formatPercent` / `formatSeconds`（`:277-286`）、データ列だけが使う値（`ga4Summary` `:1279`、`updatedAt` `:1287-1289`、`avgEngagementSeconds` / `readRate` / `cvr` `:1293-1311`、コメントを含む）、列の描画（`:1502-1725`）を移す。データ列は `item`・`orderedIds`・`visibleSet`・`rowCanonicalUrl` を props で受け取る。`rowCanonicalUrl` は行でも使うので、行で求めて渡す。`annotation` は `const annotation = item.annotation;` をデータ列の中でも書く（FR-010 (e)）。props は FR-007 と同じく関数の冒頭で分割代入し、移した本文の参照名を変えない | Must | §3 To-Be | BR-03 を満たす |
| FR-009 | `AnalyticsTable` はフックを `useAnalyticsOpsColumnState` → `useAnalyticsTableDelete` → `useAnalyticsTableFilters` の順で呼ぶ（effect を持つ 3 本）。`useAnalyticsTableLaunch` と `useAnalyticsTableEdit` は任意の位置でよい | Must | BR-02 | – |
| FR-010 | 移動元と移動先で内容が変わってよいのは次の行だけ: (a) 新ファイルの `'use client'`・import・関数の宣言・props の型と分割代入（FR-007 の `launch` / `edit` / `del` の分割代入を含む）・return 文（新ファイルから export するのは、別のファイルが import するものだけにする。props の型・戻り値の型・`LaunchPayload`・`formatPercent`・`createEmptyForm` などファイル内でしか使わないものは export しない。`npm run knip` が未使用の export で落ちるため）、(b) 入口の import と再 export、フックの呼び出しと戻り値の分割代入、(c) 行とデータ列を `<AnalyticsTableRow … />` / `<AnalyticsTableDataCells … />` の呼び出しに置き換えた行と `items.map` の行、(d) フックの引数になった値を依存配列に足す行（useState の setter・`useRef` の戻り値・`router` など、現行でもコンポーネント内で安定している値に限る）、(e) データ列の中の `const annotation = item.annotation;` の 1 行（行の中の同じ行と重複する）、(f) `selection` の型の置き場の変更（`AnalyticsTableRow.tsx` の `export interface AnalyticsTableSelection {` と、入口の `selection?: AnalyticsTableSelection;`。FR-007）。移した本文の参照名の変更（例: `pendingRowKey` → `launch.pendingRowKey`）は許さない | Must | BR-01 | §7 の行比較で差分が §13 に列挙した行の種類に収まる |
| FR-011 | `eslint-suppressions.json` の `src/components/AnalyticsTable.tsx` の件数を、移動した違反の分だけ新規ファイルのエントリへ付け替える。ルールごとの合計は変えない。付け替えは JSON を直接編集して行い、`--suppress-all` / `--suppress-rule` は使わない（ALT-002。Q-001 で承認済み） | Must | AGENTS.md「件数は増やさない」 | 成功指標の「`eslint-suppressions.json` の件数」を満たし、`npm run lint` が通る |

### 入力・出力・状態遷移

該当なし（変更なし）。

### 画面設計

見た目は変えない（BR-03）。マークアップとクラスを移動するだけなので、growmate-ui-ux の「UI 既存パターン対照表」は該当なし。

### 権限

変更なし。新規機能ではないため、「新規機能は admin / paid だけ」のルール（`AGENTS.md` Core Rules）は適用しない。

## 7. Gherkin受け入れ条件

```gherkin
Feature: AnalyticsTable.tsx を行・セル・フックに分ける

  Rule: 呼び出し側は不変

    Scenario: 呼び出し側 3 ファイルが無変更で動く
      Given AnalyticsClient.tsx が default export を、InstagramTab.tsx と InstagramMediaTable.tsx が named export を import している
      When npm run build を実行する
      Then 型エラーが 0 件で、app/analytics 配下に差分がない

    Scenario: lint の抑制件数の合計が変わらない
      When npm run lint を実行する
      Then lint が通り、eslint-suppressions.json のルール別合計が no-arbitrary-values 11・no-inline-styles 9・no-raw-colors 27 のまま、AnalyticsTable.tsx と analytics-table 配下以外のエントリに差分がない

  Rule: 挙動を変えない

    Scenario: 移動のみであることを行の多重集合で示す
      Given §13 の基準コミット ${B}（#596 マージ後の origin/develop との merge-base）の AnalyticsTable.tsx
      And 実装後の AnalyticsTable.tsx と src/components/analytics-table/ 配下を連結したもの
      When §13 の norm で import ブロック・空行・閉じ括弧だけの行を除き、行頭の空白を落として sort して比べる
      Then 差分が §13 に列挙した行の種類（FR-010 の許可行）だけである

    Scenario: DOM が変わらない
      Given 同じデータで /analytics のブログタブを開き、ダイアログをすべて閉じている
      When 基準コミット ${B} と実装後のブランチで、table 要素の outerHTML を取得して比べる
      Then 差分がない

    Scenario: フィルターの URL 同期と復元が変わらない
      Given ブログタブでカテゴリと「改善提案あり」で絞り込んでいる
      When ページを再読み込みし、そのあと別画面から URL のクエリなしで /analytics に戻る
      Then 再読み込み後も同じ絞り込みが URL に残り、クエリなしで戻ったときは保存済みのフィルターが復元される

    Scenario: 行の操作が変わらない
      Given ブログタブに記事が表示されている
      When 1 行でチャット起動、別の行で編集の保存、さらに別の行で削除を行う
      Then それぞれ現行と同じ遷移・保存・削除になり、削除ダイアログの文言も現行と同じである
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 呼び出し側 3 ファイルが無変更で動く | FR-001 / FR-002 | – |
| lint の抑制件数の合計が変わらない | FR-011 | ALT-002 / Q-001 |
| 移動のみであることを行の多重集合で示す | FR-010 | BR-01 |
| DOM が変わらない | FR-007 / FR-008 | BR-03 |
| フィルターの URL 同期と復元が変わらない | FR-003 / FR-009 | BR-02 |
| 行の操作が変わらない | FR-004〜FR-007 | BR-01 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 現行と同等。行を子コンポーネントにしても、行の state は親のフックにあるので再描画の範囲は変わらない（`React.memo` は付けない） | §7 の DOM 比較 | BR-01 |
| 可用性・信頼性 | 対象外 | – | 対象外 |
| セキュリティ・プライバシー | 対象外 | – | 対象外 |
| 認証・認可 | 対象外 | – | 対象外 |
| 監査・ログ | ログ出力は不変 | §7 の行比較 | BR-01 |
| 障害対応 | 保存・削除の失敗時の表示は不変 | §13 の手動確認 | BR-01 |
| バックアップ・復旧 | 対象外 | – | 対象外 |
| 運用・監視 | `npm run hotspots` の月次確認で効果を見る | `docs/runbooks/monthly-maintenance.md` §4 | 既存の運用を使う |
| 拡張性・互換性 | localStorage のキーと保存形式は不変（既存ユーザーの保存済みフィルターがそのまま復元される） | §7 のフィルターのシナリオ | BR-01 |
| アクセシビリティ | 対象外（DOM を変えない） | – | BR-03 |
| コスト | 対象外 | – | 対象外 |

### AI機能の追加観点

対象外（AI 機能を含まない）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: 該当なし
- 移行・既存データとの互換性: localStorage に保存済みのフィルターはそのまま読む（キーを変えない）

### 外部連携

該当なし。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: ESLint の一括抑制（`eslint-suppressions.json`）は、ファイルとルールごとに件数を記録する。違反のあるマークアップを別ファイルへ移すと、移動先には記録がないため lint が落ち、移動元には記録が余るため lint が落ちる（`eslint.config.mjs:185-188`）
- 再利用する既存実装:
  - 既存の部品と、部品を共有する流儀（growmate-ui-ux `SKILL.md:22`）。`ActiveFilterBar` / `FilterTag` は入口に残す
  - ディレクトリで所属を示す前例: `src/server/services/supabase/`（`docs/plans/supabase-service-split.md` の ALT。承認済みで未実装）
- 既存規約からの乖離とその理由: `src/components/` の下に `ui/` 以外のサブディレクトリを作るのは初めて（ALT-001）

### 制約条件

- 納期・予算・人員: なし
- 法令・契約・審査: なし
- 変更できない既存仕様: `@/components/AnalyticsTable` の default export と named export 9 つ、localStorage のキー、URL クエリの形

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| PR #596（`feat/instagram-blog-draft`） | develop にマージ済み。本仕様の行番号はこの PR の版（ce60787c）で取っている。`shoma-endo/blog-draft-types` は #596 の祖先なので別途待つ必要はない | `gh pr view 596 --json state` が `MERGED` | 選択列・操作列の部品がまだ develop になく、FR-001 の対象が存在しない。先行すると #596 と大量に衝突する。`MERGED` でなければ実装に進まず ABORT する（独自の判断で部品を作ったり移したりしない） |
| その他 `AnalyticsTable.tsx` を変更中の PR | マージ済み、またはなし | 着手前に `gh pr list --state open --json number,files --jq '.[] \| select(.files[].path == "src/components/AnalyticsTable.tsx") \| .number'` が空 | 衝突する |

## 11. トレードオフ判断

### ALT-001: 新規ファイルの置き場所（Claude 案。§16 の要件承認で確定する）

- 判断: 分けたファイルをどこに置くか
- 比較した案:
  - 案A: `src/components/analytics-table/`（新規ディレクトリ）
  - 案B: `src/components/` 直下に並べ、フックは `src/hooks/` へ
  - 案C: `app/analytics/components/` と `app/analytics/hooks/`
- 採用案: 案A
- 採用理由: 7 ファイルが 1 つの部品にしか属さないことを、ディレクトリ名で示せる。案B だと、1 つの部品の内部（部品・行・データ列のコンポーネント 3 本とフック 4 本）が `src/components/` の 32 ファイルと `src/hooks/` に分かれる。`src/hooks/` には `ChatLayout` 専用のフックも置かれているが（`docs/plans/chat-layout-split.md` ALT-002）、あちらはフックだけを足すのに対し、こちらはコンポーネントとフックを同時に足すので、1 か所にまとめるほうが読みやすい。ディレクトリ名は `project-naming` の kebab-case に合わせる
- 却下した案と理由: 案C は `src/components/AnalyticsTable.tsx` が `app/` を import することになり、依存の向きが逆になる
- 影響: `src/components/` に `ui/` 以外のサブディレクトリが初めてできる
- 将来変更する条件: 同じ形のサブディレクトリが増え、置き方の規約を `project-naming` に書く必要が出たとき
- 判断者・判断日: shoma-endo・2026-10-03（Claude 案を承認）

### ALT-002: lint の抑制件数の扱い

- 判断: 違反のあるマークアップを新しいファイルへ移すとき、`eslint-suppressions.json` をどう扱うか
- 比較した案:
  - 案A: 件数をファイル間で付け替える。ルールごとの合計は変えない。JSON を直接編集する
  - 案B: 違反を直してから移す（生の色をトークンに置き換えるなど）
  - 案C: 違反のあるマークアップはすべて入口に残す
- 採用案: 案A
- 採用理由: `AGENTS.md` の「`eslint-suppressions.json` の件数は増やさない」と、`eslint.config.mjs:185-188` の「`--suppress-*` で記録を増やして黙らせない」が防ぎたいのは、新しい違反が増えること。案A は違反の数が変わらず、記録の場所だけが変わる。調査時点の見込みは次のとおり。ルール別の合計は現行と一致する
  - 入口: arbitrary 9 / raw 8 / inline 0
  - `AnalyticsTableCells`: 1 / 7 / 9
  - `AnalyticsTableRow`: 1 / 7 / 0
  - `AnalyticsTableDataCells`: 0 / 5 / 0
  
  実際の件数は実装後に `npx eslint <新規ファイル> -f json` で数える
- 却下した案と理由:
  - 案B は色クラスが変わり、見た目が変わる。BR-03 と growmate-ui-ux（`SKILL.md:24`）に反する
  - 案C は行とデータ列を入口から出せず、500 行に届かない
- 影響: 本仕様のマージ後、`eslint-suppressions.json` に新規ファイル 3 件のエントリが増える（件数の合計は同じ）
- 将来変更する条件: 違反を解消する仕様ができたとき
- 判断者・判断日: shoma-endo・2026-10-03（Q-001 で案A を承認）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 行コンポーネントへ渡す値が多く、props の型が長くなる | 編集だけで約 15 の値を使う | FR-007 でフックの戻り値をフックごとに 1 つのオブジェクトとして渡す（`launch` / `edit` / `del`）。props は約 8 つになる見込み | 実装者 | 対策済み |
| R-002 | テストがないため、移動の誤りが自動検証では見つからない | 参照名の取り違え、effect の順序 | 参照名は FR-007 / FR-008 の分割代入で変えず（存在しないキーは `npm run build` の型エラーになる）、FR-010 で参照名の変更を許さないので、取り違えは §7 の行比較に許可外の行として出る。effect の順序は BR-02 / FR-009。加えて §7 の DOM 比較、§13 の手動確認 | 実装者 | 対策済み |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 違反の数を変えずに、`eslint-suppressions.json` の記録をファイル間で付け替えてよいか（ALT-002 案A） | `AGENTS.md` と `eslint.config.mjs:185-188` は記録を増やすことを禁じているが、付け替えについては書いていない。認められない場合は分割の形が変わる（案C では 500 行に届かない） | shoma-endo | spec-review の前 | 回答済み（2026-10-03 shoma-endo: 付け替えを認める） |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 行内の `hasUnreadSuggestion`（`:1290`）が prop を隠している点と、`annotation.session_id` の `?.` 抜け（`:1419`）を直すか | 挙動に関わる可能性があり、移動のみの本仕様には混ぜない | 本仕様のマージ後、ブログ一覧を次に変更するとき | shoma-endo |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体テスト: 追加しない。`tests/` は `environment: 'node'`（`vitest.config.ts`）で、コンポーネントを描画するテストの基盤がない。基盤を足すのは本仕様の範囲を超える（Claude 案。§16 の要件承認で確定する。仕様レビューのブロッカーにしない）
- カバレッジ: 移動のみで、未テストの行が増えも減りもしないので、閾値には影響しない
- 自動検証: `npm run verify`
- 基準コミット: ローカルの `develop` は `origin/develop` より古いことがあり、#596 より前の版（1,679 行）と比べると成り立たないため、比較の基準は下のコマンドの `B` に統一する。§1 の成功指標、§7、§14 の `git diff` も同じ `B` を使う
- DOM 比較: §7 のとおり、同じデータで基準コミット `B` と実装後の `table` の outerHTML を比べる（ブラウザの開発者ツールで取得）。Radix の DialogTrigger は開いているときだけ `useId` 由来の `aria-controls` を出し、行をコンポーネントにすると `useId` の値が変わるため、ダイアログをすべて閉じた状態で取る
- 移動の証跡: 次の `norm` で移動前と移動後を比べ、出力を PR 本文に貼る。複数行の import と再 export は、`import` / `export {` で始まり `;` で終わる行までを 1 ブロックとして落とす。zsh では `$B:s` の `:s` が修飾子として解釈されるため、`${B}:src` と書く

```bash
git fetch origin develop
B=$(git merge-base origin/develop HEAD)
norm() { awk '/^(import|export \{.*\} from|export \{$)/{imp=1} imp{ if (/;[[:space:]]*$/) imp=0; next } {print}' "$@" \
  | sed -E 's/^[[:space:]]+//' | grep -vE '^$|^[]\)\}>;,]+$' | sort; }
diff <(git show ${B}:src/components/AnalyticsTable.tsx | norm) \
     <(norm src/components/AnalyticsTable.tsx src/components/analytics-table/*)
```

行比較で出てよい行の種類（FR-010 の許可行）。これ以外の行（参照名を変えた行など）が出たら FR-010 の範囲外の変更がある。

- `'use client';`
- 新規ファイルの関数の宣言（`export function AnalyticsTableRow({` など）
- props の型と戻り値の型の行
- 分割代入の行（props、`launch` / `edit` / `del`、入口でのフックの戻り値）
- return 文の行（フックが返すオブジェクトの行を含む）
- フックの呼び出しの行（入口）
- `<AnalyticsTableRow` / `<AnalyticsTableDataCells` の呼び出しの行（属性の行を含む）
- `items.map` の行
- `const annotation = item.annotation;`（データ列で 1 行増える）
- `export interface AnalyticsTableSelection {` と `selection?: AnalyticsTableSelection;`、およびこれに置き換わる現行の `selection?: {`
- 依存配列に値を足した行（FR-010 (d)）
- 手動確認（ローカルの dev サーバー）:
  1. ブログタブ: カテゴリ・状態 3 種で絞り込む → タグで個別に解除 → 全解除 → 再読み込み → クエリなしで戻って復元
  2. 列の並べ替え、列の表示・非表示（非表示の列で並べ替えていたら解除される）
  3. 行の選択と全選択、操作列の開閉
  4. チャット起動、編集の保存（WordPress 連携あり／なしの行）、要約、詳細への遷移、削除
  5. Instagram タブ: 選択列・操作列・起動ボタン・フィルターのタグが現行どおり表示される

### リリース方針

- 通常デプロイに乗せる。段階リリースやフラグは使わない

### ロールバック方針

- PR を revert する。データ変更はない（localStorage の形式も変わらない）

## 14. 実装手順・チェックポイント

### 手順

1. §10 の依存確認を実行する。`gh pr view 596 --json state` が `MERGED` でなければ、ここで実装に進まず ABORT する。マージ済みなら、§13 の基準コミット `B` の `AnalyticsTable.tsx` を ce60787c 版と比べ（`git diff ce60787c "${B}" -- src/components/AnalyticsTable.tsx`）、変わっていれば §6 の行番号を読み替える
2. FR-001 / FR-002（部品）を移し、`npm run build` を通す
3. FR-004 → FR-005 → FR-006 → FR-003 の順にフックへ移す。1 本移すごとに `npm run build` を通す
4. FR-008 → FR-007 の順に、データ列と行を子コンポーネントへ移す
5. FR-011 の抑制記録を付け替え、`npm run lint` を通す
6. `npm run verify` を実行する
7. §13 の `norm` の行比較と DOM 比較を実行し、出力を PR 本文に貼る
8. §13 の手動確認を行い、結果を PR 本文に書く

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| CP-1 spec-review 前 | Q-001 の回答（`docs/plans/client-page-boundary.md` の Q-001 と同じ論点） | shoma-endo | 確認済み（2026-10-03） |
| CP-2 着手前 | PR #596 がマージ済み（`gh pr view 596 --json state` が `MERGED`。そうでなければ実装に進まず ABORT する）で、§6 の行番号を読み替えた。実装前ゲートであり、仕様レビューのブロッカーにしない | 実装者 | 未確認 |
| CP-3 PR 作成時 | `git diff --stat "${B}"`（`B` は §13 の基準コミット）の変更が `src/components/AnalyticsTable.tsx`・`src/components/analytics-table/`・`eslint-suppressions.json`（と `vitest.config.ts` の閾値ラチェット）だけ | 実装者 | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - §1 の成功指標をすべて満たす
  - §7 のシナリオをすべて満たす
  - `npm run verify` が緑
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - `norm` の行比較の出力、DOM 比較の結果、§13 の手動確認 5 項目の結果を PR 本文に書く
- 完了確認者・確認日: shoma-endo・PR のマージ時

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 0（起票時のセルフレビュー） | 2026-10-03 | 1 / 3 / 4 | 全件反映（🔴 の Q-001 は 2026-10-03 に承認済み） | なし |
| 1（spec-review audit） | 2026-10-03 | 0 / 5 / 2 | 全件反映。ARCH-NEW-analytics-table-split-L352（§13 に基準コミット `B` と `norm` を書き写し、§1・§7・§14 の `develop` を `B` に統一）、-L165（FR-007 / FR-008 で分割代入と参照名の不変を定め、FR-010 から参照名の変更を削除。§13 に行比較で出てよい行の種類を列挙。R-002 の対策を更新）、-L159（FR-004〜006 に `router` を引数で受け取ると明記。`selection` の型を `AnalyticsTableRow.tsx` の `AnalyticsTableSelection` に置き、FR-010 (f) に追加）、-L282（§10・§14 手順 1・CP-2 に「#596 が `MERGED` でなければ ABORT」、CP-2 は実装前ゲートで仕様レビューのブロッカーにしない）、-L299（ALT-001 とテスト方針を「§16 の要件承認で確定」、承認者・完了確認者を shoma-endo に、CP-1 を Q-001 だけにして確認済み）、-L113（growmate-ui-ux の引用を `SKILL.md:24` に修正）、-L210（フィルター名を「改善提案あり」に修正） | なし |

#### 公式ドキュメント照合

- 実施 / 未実施: 対象外（外部サービス連携なし。spec-review の identify でも対象外と判定）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-03 | 起票 | 可読性レビュー | shoma-endo（Claude Code 支援） |
| 2026-10-03 | 比較の基準コミットと `norm` を本仕様に記載、参照名の変更を禁止して分割代入に統一、`router` と `selection` の型の置き場を明記、#596 未マージ時の ABORT を追加、承認者を確定、引用行とフィルター名を修正 | spec-review audit 回 1 の指摘 | shoma-endo（Claude Code 支援） |
