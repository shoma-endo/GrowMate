# ChatLayout.tsx の状態とハンドラをフックへ分ける

## メタデータ

- 文書名: ChatLayout.tsx の状態とハンドラをフックへ分ける
- ステータス: `implemented`
- 作成日: 2026-10-03
- 最終更新日: 2026-10-04
- 作成者: shoma-endo（Claude Code 支援）
- 承認者: shoma-endo（Claude 案・未確認。Q-001 の回答者で、ロールバック判断者でもあるため）
- 対象リリース: 機能リリースと独立。`develop` へマージ後、次の通常デプロイに乗る
- 関連する依頼・Issue・PR: 2026-10-03 可読性レビュー。`npm run hotspots`（develop 4fd6ae2e）の第 2 位。同時に起こした `docs/plans/analytics-table-split.md` / `docs/specs/client-page-boundary.md`

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか: `app/chat/components/ChatLayout.tsx` は 1,920 行（実行行 1,651）。1 つのコンポーネントに useState 14 個、useRef 15 個、useEffect 6 本、ハンドラ約 20 本が同居している。扱っているのは、ブログ作成ステップ、Step 7 の見出しフロー、Canvas の表示内容・バージョン・ナビゲーション、Canvas の AI 編集ストリーミング（`handleCanvasSelectionEdit` だけで 349 行、`:1444-1792`）、注釈パネルである。表示はすでに `ChatLayoutContent.tsx` と `CanvasPanel.tsx` に分かれており、JSX は 2 つの子の呼び出しだけ（`:1796-1919`）。肥大化の原因は状態とハンドラにある。Step 7 を 1 か所直すだけでも、1,600 行の中から関係する ref と effect を探すことになる
- 放置した場合の影響: ブログ作成フローの仕様（例: `docs/plans/instagram-high-engagement-blog-draft-spec.md` は `ChatLayout.tsx:1091-1098` / `:1144-1146` / `:900-906` を引用している）が来るたびに、このファイルが読む範囲の起点になる。テストがない（`tests/` から参照 0 件）ため、読み違いがそのまま不具合になる

### 目的

- この開発で実現する状態: `ChatLayout` の import パス・export・props を保ったまま、状態とハンドラを関心ごとのフックへ移す。新しいファイルは実行行 500 以下、`ChatLayout.tsx` は 600 以下にする（ALT-003）
- 利用者・事業にとっての価値: エンドユーザーへの価値はない（内部整理）。開発側は、Step 7 なら `useStep7Heading*`、Canvas の AI 編集なら `useCanvasSelectionEditStream` だけ読めば済むようになる

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| `ChatLayout.tsx` 実行行数 | 1,651 | 600 以下（500 を超えた分の `max-lines` の warn は残してよい。ALT-003） | `npm run hotspots`（`scripts/hotspots.sh` の数え方） | マージ時 |
| 新規ファイルの実行行数 | – | すべて 500 以下 | `npm run lint` で新規ファイルに `max-lines` の warn が 0 件 | マージ時 |
| `max-lines` の warn 件数 | 基準コミット `${B}`（§13）の件数 | 増えない（`ChatLayout.tsx` の 1 件は残っても減ってもよい） | `docs/runbooks/monthly-maintenance.md` §4 の数え方 | PR 作成時 |
| 呼び出し側・テストの変更 | – | 0（`app/chat/ChatClient.tsx` と `tests/` に差分がない） | `git diff --stat ${B} -- app/chat/ChatClient.tsx tests`（`B` は §13） | PR レビュー時 |
| `eslint-suppressions.json` | `ChatLayout.tsx` に `no-arbitrary-values: 1` | 差分なし | `git diff ${B} -- eslint-suppressions.json` が空（`B` は §13） | PR レビュー時 |
| 既存テスト | 全件 pass | `npm run verify` が緑 | `npm run verify` | PR 作成時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | 該当なし（見た目・挙動は変わらない） | – |
| 運用担当 | 開発者（本人）・AI 実装者 | 関心ごとに 1 ファイルを読めば済む |
| 管理者・承認者 | shoma-endo（Claude 案・未確認。メタデータの承認者と同じ） | 移動のみの証跡（§7）と手動確認の結果を見てマージを判断する |
| 外部サービス・連携先 | Anthropic（Canvas 編集の SSE） | 呼び出し内容は不変 |

### 主な利用シナリオ

1. **AI 実装者が**、**Step 7 の見出し保存の仕様を変えるとき**、`src/hooks/useStep7HeadingActions.ts`（新規）を読む。保存処理は `handleSaveHeadingClick` で、現行 `:850-944` にある
2. **レビュアーが**、**Canvas の AI 編集の差分を読むとき**、`src/hooks/useCanvasSelectionEditStream.ts`（新規）の 1 ファイルで判断できる

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
app/chat/ChatClient.tsx → <ChatLayout chatSession isMobile initialStep />（:95-99）
  ChatLayout.tsx 1,920 行
    状態（useState/useRef 約 30）・派生値・既存フック 7 本の呼び出し
    → effect 6 本（:374 → :548 → :585 → :1049 → :1079 → :1235 の順に宣言）
    → ハンドラ約 20 本
    → JSX: <div data-testid="chat-layout"> <ChatLayoutContent ctx={…}/> {canvasPanelOpen && <CanvasPanel …/>} </div>
```

### 導入後（To-Be）

```text
app/chat/ChatClient.tsx                    無変更
app/chat/components/ChatLayout.tsx         状態・ref の宣言、派生値、既存フック、新フックの呼び出し、handleOpenAnnotation、JSX（ルート div を含む）
src/hooks/（既存ディレクトリ。ChatLayout の既存フック 7 本と同じ場所）
  useStep7HeadingView.ts                   見出しの表示位置・stale 判定（effect :374 / :548）
  useCanvasPanelContent.ts                 Canvas の表示内容・バージョン一覧・タイル（effect :585）
  useBlogFlowControls.ts                   ステップ・モデル切替、セッション切替時のリセット（effect :1049 / :1079）、送信
  useStep7HeadingActions.ts                見出しの保存・結合・生成開始
  useCanvasSelectionEditStream.ts          Canvas の AI 編集（SSE）
  useCanvasNavigation.ts                   Canvas を開く・バージョン選択・ステップ切替（effect :1235）
src/lib/step7-lead.ts（新規）              Step 6 → Step 7 の書き出し文を求める純関数
```

### 業務ルール

- ルール ID: BR-01
- ルール: 本体は移動のみ。ハンドラ・useMemo・useEffect の本文、依存配列、メモ化の有無（`useCallback` の付け外し）、文言、ログ、`fetch` 先を変えない。変えてよい行は FR-010 に列挙したものだけ
- 例外: なし。気づいた改善は §12 の OPEN に記録する

- ルール ID: BR-02
- ルール: effect の実行順を変えない。現行の順は、既存フック内の effect（`useServiceSelection` → `useSessionTitle` → `useHeadingFlow` → `useCanvasVersions` → `useWordpressSync`。`useBlogTitleMetaGeneration` は effect を持たない）のあと、`:374` → `:548` → `:585` → `:1049` → `:1079` → `:1235`
- 例外: なし。effect を持たないフック（`useHeadingCanvasState`・`useBlogTitleMetaGeneration`・FR-005・FR-006）は位置を動かしてよい

- ルール ID: BR-03
- ルール: 次の 5 つの性質を保つ
  1. `openCombinedCanvasRef.current = handleOpenCombinedCanvas`（`:1305`）は毎回の描画で実行する。`handleBuildCombinedOnly`（`:989`）が await のあとにこの ref から最新のクロージャを呼ぶため。この代入文は `ChatLayout` に残し、FR-007 のフック呼び出しの直後に置く（FR-007）。フックの引数で受け取った ref へ描画中に代入すると `react-hooks/immutability` が error にするため（2026-10-04 の spec-to-pr implement で、`src/hooks/useCanvasNavigation.ts` に移した代入が “This value cannot be modified” で失敗したことを観測）。`ChatLayout` が自分で作った ref への描画中の代入は、develop の現行コードと同じ形で lint を通る
  2. `canvasContent` の useMemo（`:601-779`）は描画中に ref へ書く（`:624-626`・`:641-644`）。これと、`.current` を依存配列に入れないことを保つ。ref が引数になったことで `react-hooks/exhaustive-deps` が ref オブジェクト自体の追加を求めた場合は、FR-010 (d) で足してよい（ref オブジェクトの同一性は変わらないので、メモ化の結果は変わらない）
  3. `effectiveViewingHeadingIndex`（`:331-334`）は描画中に `pendingViewingIndexRef.current` を読む。state にキャッシュしない
  4. ref はすべて `ChatLayout` で 1 回だけ作り、`RefObject` として各フックへ渡す。フック内で `useRef` を新しく作らない
  5. フックは引数を関数の引数部で分割代入して受け取る。`args.xRef.current = …` のように引数オブジェクト経由で書き換えない（`react-hooks/immutability` が error にする）
- 例外: 4 について、ほかの関心から参照されない `prevStep6SessionIdRef`（`:421`）は FR-002 のフック内で作る（ALT-001）
- 5 の前提の確認: 観測した事実は次の 2 つで、結果が食い違っている。
  - 2026-10-03 のプローブ（Claude 実施）: 本リポジトリの `eslint.config.mjs` と同じ設定で `eslint --stdin --stdin-filename src/hooks/useProbe.ts`（未実装。検証用）に検証用のフックを渡した。分割代入で受け取った ref への `.current` 書き込みは、`useCallback`・`useMemo`・`useEffect` の中でも描画中でも error にならなかった（`react-hooks/refs` は off）。`args.barRef.current = …` は `react-hooks/immutability` の error になった
  - 2026-10-04 の spec-to-pr implement（実ファイル）: 分割代入で受け取った ref への描画中の代入（`:1305` を `src/hooks/useCanvasNavigation.ts` に移したもの）が `react-hooks/immutability` の error になった（BR-03 の 1）
  - 両者の差の原因は未確認
  - 残るリスク: 移す範囲の中で描画中に引数の ref へ書く箇所は、FR-003 の `canvasContent` の useMemo 内の `:625`・`:643` だけである。これが error になると、R-003 によりこの useMemo（`:601-779`、約 180 行）を `ChatLayout` に残すことになり、ALT-003 の見込み（約 520〜550 行）と合わせて 600 行を超え、R-003 の ABORT になる見込み
  - 実ファイルでの重大度は、spec-to-pr の implement が `npm run lint` で確かめる。error になった場合の扱いは §12 R-003

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。要件に無い機能は入れない。

### 対象範囲

- 画面・操作: `/chat`。見た目・操作は変わらない
- API・外部連携: 該当なし（Canvas 編集の SSE の呼び出し先 `app/api/chat/canvas/stream/route.ts` は無変更）
- データ・DB: 該当なし
- 権限・ロール: 該当なし
- 運用・監視: 該当なし

### Non-goals（今回の対象外）

- 対象外にするもの:
  - 重複したロジックの統合。`hasContentForViewingHeading`（`:440-491`）と `hasContentForActiveHeading`（`:494-542`）はほぼ同じ処理だが、そのまま残す → OPEN-001
  - 不要コードの削除: `onHeadingSaved`（`:293-306`。`useHeadingCanvasState` は受け取っても使わない: `src/hooks/useHeadingCanvasState.ts:13,18-21`）、常に早期 return する effect（`:585-599`。`fallbackMessageIdRef` には `null` しか入らない: `:593`・`:1171`）、未使用の `useAuth` import（`:6`） → OPEN-002
  - `CanvasPanel` の描画（`:1884-1917`）を別コンポーネントに切り出すこと。理由: JSX は 2 つの子の呼び出しだけで、500 行の目標に必要ない
  - `ChatLayoutContent.tsx`（417 行）・`CanvasPanel.tsx`（1,268 行、churn 1）・`InputArea.tsx` の分割。理由: 500 行以下か、または `docs/runbooks/monthly-maintenance.md` §4 の「今回は放置」（大きいが churn が低い）に当たる
  - `ChatLayoutCtx` の props 束（`src/types/chat-layout.ts:28`）の見直し
  - 新規テストの追加 → §13
  - 既存の仕様書・設計書（`docs/plans/*`・`docs/specs/*`）にある `ChatLayout.tsx` の行番号の更新。理由: 行番号は書いた時点の版を指す記録で、`scripts/check-doc-paths.sh` もパスの実在しか見ない。2026-10-03 時点の引用は `docs/plans/instagram-high-engagement-blog-draft-spec.md`（PR #596 自身の仕様）と `docs/plans/google-ads-evaluation-design.md:812`
  - `features/` 構成への移行、`app/api` の更新系 Route の Server Action 化、jsx-a11y の導入と `shadcn/no-raw-colors` の解消。理由は `docs/specs/client-page-boundary.md` §4 と同じ
- 対象外にする理由: 本仕様の価値は「差分を移動だけにして、読む単位を小さくする」こと。テストがないため、挙動の変更を混ぜると手動確認だけでは証跡が足りない
- 将来検討する条件・時期: §12 の OPEN を参照

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-03、Claude 案）
- 含めるもの: 移動・`npm run verify`・§7 の行比較・手動確認
- 含めないもの: 仕様レビューの往復

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 移動 | 新規 7 ファイル（フック 6 本と `src/lib/step7-lead.ts`）、`ChatLayout.tsx` の書き換え | 3 | 0.4 |
| 検証 | `npm run verify`・§7 の行比較・§13 の手動確認 | 2 | 0.25 |
| **合計** |  | 5 | 0.65 |

幅: 4〜8 時間。上限側は、フックの引数に setter を渡したことで `react-hooks/exhaustive-deps` が出す警告への対応（§12 R-002）。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: `spec-review` 1 回
- クライアント確認・たたき台合意の見込み: 該当なし（内部作業）
- 希望リリース時期との関係: §10 の依存を満たしたあと

## 6. 機能要件

行番号はすべて develop 4fd6ae2e の `app/chat/components/ChatLayout.tsx`。FR-002〜FR-007 で移す範囲から、§12 R-003 で `ChatLayout` に残した宣言は除く。

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | `src/lib/step7-lead.ts`（新規）に、純関数 `resolveStep6ToStep7Lead(msgs: ChatMessage[])` を作る。関数の本体は `step6ToStep7Lead` の useMemo 本体のうち `:151-191`（`const msgs = …` の `:150` を除く）をそのまま移す。`ChatLayout` 側は `:149`・`:150`・`:192` を `useMemo(() => resolveStep6ToStep7Lead([...(chatSession.state.messages ?? []), ...optimisticMessages]), [chatSession.state.messages, optimisticMessages])` に置き換える | Must | 行数目標 | useMemo の依存配列が現行と同じ |
| FR-002 | `src/hooks/useStep7HeadingView.ts`（新規）に `:286-341`（`useHeadingCanvasState` の呼び出しと inline クロージャ、表示位置の派生値）と `:372-582`（同期 effect、stale 判定、2 つの `hasContentFor*`、stale effect）をそのまま移す。`:372-582` には `isStep6ContentStale` の useState（`:420`）と `prevStep6SessionIdRef`（`:421`）の宣言も含まれ、宣言ごとこのフックへ移る。戻り値に `isStep6ContentStale` と `setIsStep6ContentStale` を含める（FR-003・FR-005・JSX が使うため。ALT-001） | Must | §3 To-Be | `:293-323` の inline クロージャがメモ化されないまま残る |
| FR-003 | `src/hooks/useCanvasPanelContent.ts`（新規）に `deriveTileFromContent`（`:62-80`、モジュール関数のまま）、`:585-599` の effect、`:601-837`（`canvasContent`・表示フラグ・`canvasVersionsWithMeta`・`canvasStepOptions`・`combinedTiles`）を移す | Must | §3 To-Be | BR-03 の 2 を満たす |
| FR-004 | `src/hooks/useBlogFlowControls.ts`（新規）に `:1006-1047`（`stepActionBarRef` の宣言を除く）、effect `:1049-1088`、`handleSendMessage` と `handleSaveStep7UserLead`（`:1091-1128`）を移す | Must | §3 To-Be | – |
| FR-005 | `src/hooks/useStep7HeadingActions.ts`（新規）に `viewingSection`（`:843-848`）、`handleSaveHeadingClick`（`:850-944`）、`handleBuildCombinedOnly`（`:947-1004`）、`handleStartHeadingGeneration`（`:1132-1155`）を移す。`openCombinedCanvasRef` は引数で受け取る。`isStep6ContentStale` と `setIsStep6ContentStale` は FR-002 の戻り値を引数で受け取る。`setIsStep6ContentStale` が引数になったことで `handleSaveHeadingClick` の依存配列に足すことは FR-010 (d) で許可している | Must | §3 To-Be | BR-03 の 1 を満たす |
| FR-006 | `src/hooks/useCanvasSelectionEditStream.ts`（新規）に `CANVAS_ANTHROPIC_RETRY_TOAST_ID`（`:58`）と `handleCanvasSelectionEdit`（`:1444-1792`、内側の `processEventBlock` を含む）を移す。名前は既存の `src/hooks/useCanvasSelection.ts`（`CanvasPanel` が使う）と区別する | Must | §3 To-Be | – |
| FR-007 | `src/hooks/useCanvasNavigation.ts`（新規）に `:1158-1304`（`handleShowCanvas`、自動で開く effect、`handleOpenCombinedCanvas`）と `:1348-1442`（バージョン選択、`effective*`、ステップ切替）を移し、戻り値に `handleOpenCombinedCanvas` を含める。`:1305` の ref 代入（`openCombinedCanvasRef.current = handleOpenCombinedCanvas;`）は移さず、`ChatLayout` の中で `useCanvasNavigation` の呼び出しの直後に置く。`openCombinedCanvasRef` は `useCanvasNavigation` の引数にしない | Must | §3 To-Be / BR-03 の 1 | `src/hooks/useCanvasNavigation.ts` に `openCombinedCanvasRef` が現れず、`ChatLayout` の代入文が `useCanvasNavigation` の呼び出しより後にある |
| FR-008 | `handleOpenAnnotation`（`:1308-1346`）は React のフックを使わない普通の関数なので、`ChatLayout` に残す。`CanvasPanel` の `dynamic` import（`:60`）と未使用の `useAuth` import（`:6`）も `ChatLayout` に残す（OPEN-002） | Must | YAGNI / BR-01 | – |
| FR-009 | `ChatLayout` は新フックを FR-002 → FR-003 → FR-004 → FR-005 → FR-006 → FR-007 の順で呼ぶ。`useCanvasVersions` と `useWordpressSync`（`:343-370`）は FR-002 より前に呼ぶ（effect を持たない `useHeadingCanvasState` が後ろへ動くだけになる）。ルート div（`:1797`）と JSX は `ChatLayout` に残す | Must | BR-02 | 宣言順の前方参照がない（2026-10-03 に確認済み: FR-006 の範囲は FR-007 のハンドラと `handleOpenAnnotation` を参照せず、FR-004 の範囲は FR-005 の値を参照しない） |
| FR-010 | 移動元と移動先で内容が変わってよいのは次の行だけ: (a) 新ファイルの import・フック関数と純関数の宣言・引数の分割代入・return 文・引数と戻り値の interface（export しない。既存の `UseHeadingFlowParams`（`src/hooks/useHeadingFlow.ts:15`）と同じ形）。新ファイルから export するのは、別のファイルが import するものだけにする（`npm run knip` が未使用の export で落ちるため）、(b) `ChatLayout` の import、新フックの呼び出しと戻り値の分割代入、(c) FR-001 で `:149`・`:150`・`:192` を `resolveStep6ToStep7Lead` の呼び出しに置き換えた行、(d) フックの引数になった setter・ref オブジェクトを依存配列に足す行（useState の setter と `useRef` の戻り値に限る。§12 R-002）、(e) §12 R-003 で `ChatLayout` に残した宣言の行（範囲ごとの比較では移動先にない行として出る。行の多重集合の比較では差分にならない）。FR-002〜FR-007 の各範囲の直前にある、その関数・effect の説明コメント（`:584`・`:839-842`・`:946`・`:1048`・`:1090`・`:1130-1131`・`:1157`）も範囲と一緒に移す | Must | BR-01 | §7 の行比較で差分がこの範囲に収まる |

### 入力・出力・状態遷移

該当なし（変更なし）。

### 画面設計

見た目は変えない。JSX は移動しないため、growmate-ui-ux の「UI 既存パターン対照表」は該当なし。

### 権限

変更なし。新規機能ではないため、「新規機能は admin / paid だけ」のルール（`AGENTS.md` Core Rules）は適用しない。

## 7. Gherkin受け入れ条件

```gherkin
Feature: ChatLayout.tsx の状態とハンドラをフックへ分ける

  Rule: 呼び出し側と lint の記録は不変

    Scenario: 呼び出し側が無変更で動く
      Given app/chat/ChatClient.tsx が ChatLayout を chatSession・isMobile・initialStep 付きで描画している
      When npm run build を実行する
      Then 型エラーが 0 件で、ChatClient.tsx に差分がない

    Scenario: lint の抑制記録が動かない
      When npm run lint を実行する
      Then 新しいフック 6 本と src/lib/step7-lead.ts に max-lines の warn がなく、ChatLayout.tsx の実行行が 600 以下で、eslint-suppressions.json に差分がない

  Rule: 挙動を変えない

    Scenario: 移動のみであることを行の多重集合で示す
      Given 基準コミット ${B}（§13）の ChatLayout.tsx
      And 実装後の ChatLayout.tsx・新しいフック 6 本・src/lib/step7-lead.ts を連結したもの
      When §13 の norm で import ブロック・空行・閉じ括弧だけの行を除き、sort して比べる
      Then 差分が FR-010 の許可行だけである

    Scenario: 各範囲が位置を保ったまま移っている
      Given 基準コミット ${B} の ChatLayout.tsx から切り出した FR-002〜FR-007 の各行範囲（§13）
      When 移動先のフックと diff -wB で比べる
      Then 差分が FR-010 (a)(d)(e) の行だけである

    Scenario: 依存配列の警告が増えない
      When §13 の「依存配列の検証」を実行する
      Then 新しいフック 6 本と src/lib/step7-lead.ts の react-hooks/exhaustive-deps の warn が 0 件で、ChatLayout.tsx の件数が ${B} より増えない

    Scenario: effect の順序が保たれる
      Given 実装後の ChatLayout.tsx
      When フック呼び出しの並びを読む
      Then useCanvasVersions と useWordpressSync のあとに useStep7HeadingView → useCanvasPanelContent → useBlogFlowControls → useStep7HeadingActions → useCanvasSelectionEditStream → useCanvasNavigation の順で呼ばれている

    Scenario: ブログ作成の見出しフローが変わらない
      Given Step 6 まで進んだブログ作成チャットを開く
      When Step 7 で見出しの生成を始め、1 つ目の見出しを保存し、すべて保存したあと結合する
      Then 見出しごとに Canvas が自動で開き、保存後は次の見出しへ進み、結合後は結合済みの本文が Canvas に表示される

    Scenario: Canvas の AI 編集が変わらない
      Given Canvas に本文が表示されている
      When 本文の一部を選んで AI 編集を指示する
      Then 編集結果がストリーミングで Canvas に表示され、完了後に新しいバージョンとして選べる

    Scenario: セッションを切り替えると表示がリセットされる
      Given Canvas と注釈パネルを開いている
      When サイドバーで別のセッションを選ぶ
      Then Canvas と注釈パネルが閉じ、選んだセッションの内容が表示される
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 呼び出し側が無変更で動く | FR-009 | – |
| lint の抑制記録が動かない | FR-009 | ALT-001 |
| 移動のみであることを行の多重集合で示す | FR-010 | BR-01 |
| 各範囲が位置を保ったまま移っている | FR-002〜FR-007 / FR-010 | BR-01 |
| 依存配列の警告が増えない | FR-010 (d) | BR-01 / R-002 |
| effect の順序が保たれる | FR-009 | BR-02 |
| ブログ作成の見出しフローが変わらない | FR-002 / FR-005 / FR-007 | BR-03 |
| Canvas の AI 編集が変わらない | FR-006 | – |
| セッションを切り替えると表示がリセットされる | FR-004 | BR-02 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 現行と同等。メモ化の有無と依存配列を変えないので、再描画の回数も変わらない。React Compiler は無効（`next.config.ts`・`package.json` に設定なし）なので、メモ化は手書きの依存配列だけで決まる | §13 の範囲ごとの比較（`diff -wB`）と「依存配列の検証」。行の多重集合の比較は依存配列の要素と同じ文字列の行を区別できないので、これだけでは根拠にしない | BR-01 |
| 可用性・信頼性 | 対象外 | – | 対象外 |
| セキュリティ・プライバシー | 対象外（データの流れは変わらない） | – | 対象外 |
| 認証・認可 | 対象外 | – | 対象外 |
| 監査・ログ | `console.error` などのログ出力は不変 | §7 の行比較 | BR-01 |
| 障害対応 | Canvas 編集の SSE が失敗したときの表示（トースト `canvas-anthropic-retry` など）は不変 | §13 の範囲ごとの比較で、FR-006 の範囲（409・非 ok・retry・error イベント・catch / finally を含む `:1444-1792`）がそのまま移ったことを確かめる。失敗を起こす手動確認は行わない | BR-01 |
| バックアップ・復旧 | 対象外 | – | 対象外 |
| 運用・監視 | `npm run hotspots` の月次確認で効果を見る | `docs/runbooks/monthly-maintenance.md` §4 | 既存の運用を使う |
| 拡張性・互換性 | 対象外 | – | 対象外 |
| アクセシビリティ | 対象外（JSX を変えない） | – | 対象外 |
| コスト | 対象外 | – | 対象外 |

### AI機能の追加観点

対象外（AI 機能の挙動を変えない。移動するのは呼び出し側のコードだけ）。

## 9. データ・外部連携

### データ

該当なし。

### 外部連携

該当なし（呼び出し内容は不変）。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: React 19。カスタムフックへ移しても、フック呼び出しの順序が同じなら state と effect の対応は変わらない
- 再利用する既存実装:
  - フックの置き場所: `src/hooks/`（`ChatLayout` の既存フック 7 本と同じ。ALT-002）
  - Canvas 系の純関数を置く場所: `src/lib/canvas-content.ts` / `src/lib/canvas-mode.ts`（`src/lib/step7-lead.ts` も同じ場所に置く）
  - 既存フック 7 本（`src/hooks/useServiceSelection.ts` ほか）はそのまま使い、触らない
- 既存規約からの乖離とその理由: なし。フックのファイル名は `project-naming` の「Hooks: `camelCase.ts`（例: `useChatSession.ts`）」（`.agents/skills/project-naming/SKILL.md:23`）に合わせる

### 制約条件

- 納期・予算・人員: なし
- 法令・契約・審査: なし
- 変更できない既存仕様: `import { ChatLayout } from './components/ChatLayout'`（`app/chat/ChatClient.tsx:8`）、`ChatLayoutProps`（`src/types/chat-layout.ts:9-13`）、`data-testid="chat-layout"`

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| `ChatLayout.tsx` を変更中の PR | マージ済み、またはなし（2026-10-03 時点で、オープン PR #596 は `app/chat/` を変更していない） | 着手前に `gh pr list --state open --json number,files --jq '.[] \| select(.files[].path == "app/chat/components/ChatLayout.tsx") \| .number'` が空 | rebase で大量に衝突する |

## 11. トレードオフ判断

### ALT-001: どこまでフックへ出すか（Claude 案・2026-10-03 shoma-endo 承認済み）

- 判断: 状態の宣言と JSX をどこに置くか
- 比較した案:
  - 案A: useState / useRef の宣言と JSX は `ChatLayout` に残し、ハンドラ・派生値・effect だけをフックへ移す
  - 案B: 関心ごとに state もフックの中へ移す
- 採用案: 案A。ただし `isStep6ContentStale` と `prevStep6SessionIdRef` だけは FR-002 のフック内で宣言する。`prevStep6SessionIdRef` はほかの関心から参照されない。`isStep6ContentStale` は FR-003（`:669`・`:773`）・FR-005（`:852`・`:932`）・JSX（`:1864`）からも読まれるが、書き込むのは FR-002 の effect と FR-005（`:893`・`:916`）だけなので、FR-002 で宣言して値と setter を返す
- 採用理由: `setCanvasStreamingContent` は 12 の関数（17 行）から、`setCanvasPanelOpen` は 7 の関数（8 行）から、`pendingViewingIndexRef` は 7 か所から書かれ、関心をまたいでいる（2026-10-03 の調査）。案B では、どのフックが state を持つかによって呼び出し順の制約が増え、BR-02 / BR-03 を保つのが難しくなる。ルート div には `shadcn/no-arbitrary-values` の抑制記録がある（`eslint-suppressions.json:179-183`、`:1797` の `h-[calc(100dvh-3.5rem)]`）。JSX を残せば抑制記録も動かない
- 却下した案と理由: 案B は state の持ち主が増え、移動のみの証跡が取りにくい
- 影響: `ChatLayout` に宣言が約 30 行残り、フックの引数が多くなる（setter・ref を受け取るため）
- 将来変更する条件: OPEN-001 で重複ロジックを統合するとき
- 判断者・判断日: shoma-endo・2026-10-03（Claude 案を Q-001 で承認）

### ALT-002: 新しいフックの置き場所（Claude 案・2026-10-03 shoma-endo 承認済み）

- 判断: `src/hooks/` に置くか、`app/chat/hooks/`（新規）に置くか
- 比較した案:
  - 案A: `src/hooks/`
  - 案B: `app/chat/hooks/`（前例: `app/analytics/[annotationId]/hooks/useGscDashboard.ts`）
- 採用案: 案A
- 採用理由: `ChatLayout` が使う既存フック 7 本（`useHeadingFlow`・`useCanvasVersions` など）は、`ChatLayout` からしか使われていないのにすべて `src/hooks/` にある。README の「📁 プロジェクト構成」も `src/hooks/` をチャット・キャンバス・見出しフローのフックの置き場と書いている。案B だと `ChatLayout` のフックが 2 つのディレクトリに分かれる
- 却下した案と理由: 案B は上記のとおり置き場が割れる。既存 7 本も移すと移動のみの範囲を超える
- 影響: README の更新は不要
- 判断者・判断日: shoma-endo・2026-10-03（Claude 案を Q-001 で承認）

### ALT-003: `ChatLayout.tsx` の目標行数（Claude 案・2026-10-03 shoma-endo 承認済み）

- 判断: `ChatLayout.tsx` の実行行を 500 以下にするか、600 以下で止めるか
- 前提: 残る行の実行行は約 315（import を整理した後）。ここに新しいフック 6 本の呼び出しが加わる。各フックは setter と ref を 20〜25 個受け取り、1 行に 1 つずつ並ぶため、呼び出しだけで約 200〜230 行になる。合計の見込みは約 520〜550（2026-10-03 のレビューでの見積もり）
- 比較した案:
  - 案A: 600 以下を目標にし、`ChatLayout.tsx` の `max-lines` の warn は残してよいとする
  - 案B: 500 以下にするため、state と ref をまとめるフック（`useChatLayoutState` など）を足し、各フックへオブジェクトで渡す
  - 案C: 500 以下にするため、JSX（`CanvasPanel` の描画）も切り出す
- 採用案: 案A
- 採用理由: 目的は読む単位を小さくすることで、1,651 → 約 550 で達成できる。案B は引数オブジェクト経由の ref の書き換えが `react-hooks/immutability` で落ちるため、書き方の制約が増え、移動のみの証跡も取りにくい。案C は Non-goal（JSX は 2 つの子の呼び出しだけで、切り出しても読みやすくならない）
- 却下した案と理由: 上記
- 影響: `max-lines` の warn が `ChatLayout.tsx` に 1 件残る（develop でも 1 件あるので、件数は増えない）
- 将来変更する条件: OPEN-001 で重複を統合し、引数が減ったとき
- 判断者・判断日: shoma-endo・2026-10-03（Claude 案を Q-001 で承認）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | テストがないため、移動の誤りが自動検証では見つからない | クロージャの取り違え、ref の二重生成、呼び出し順の誤り | BR-02 / BR-03 と §7 の行比較で構造を確かめ、§13 の手動確認で振る舞いを確かめる | 実装者 | 対策済み |
| R-002 | setter と ref をフックの引数で受け取ると、`react-hooks/exhaustive-deps` が依存配列への追加を求める | 依存配列を書き換えると、メモ化の結果が変わるおそれがある | 追加してよいのは、useState の setter と `useRef` の戻り値（どちらも安定した値）だけ（FR-010 (d)）。それ以外の追加が要ると言われたら、依存配列を変えずに ABORT し、本仕様へ戻す（警告の文面は implement の記録に残す）。lint の抑制コメントで黙らせない | 実装者 | 対策済み |
| R-003 | `react-hooks/*`（`immutability` など）が、フックへ移した文を error にする | 2026-10-04 の implement で、`:1305` の ref 代入をフックへ移すと `react-hooks/immutability` が error になった（FR-007 で `ChatLayout` に残すよう修正済み）。同じことがほかの文でも起きうる | 抑制コメントや、ref を setter 関数に置き換えるなどの構造変更で回避しない（BR-01 に反する）。error になった文を含むトップレベルの宣言（代入文・ハンドラ・useMemo・useEffect）は移さず、`ChatLayout` の同じ相対位置（その宣言が使う値を返すフック呼び出しの後、宣言を使うフック呼び出しの前）に残す。effect を残す場合は BR-02 の順序を保つ。残した宣言は FR-010 (e) の許可行になる。残した宣言・lint の error 文・置いた位置を PR 本文に書く。次のどちらかの場合は ABORT し、本仕様へ戻す: 残した結果 `ChatLayout.tsx` の実行行が 600 を超える場合、条件を満たす位置がない場合（同じフックの前の項目を使い、後ろの項目に使われる宣言など） | 実装者 | 対策済み |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | ALT-001（state・ref の宣言と JSX は `ChatLayout` に残す）、ALT-002（新しいフックは `src/hooks/` に置く）、ALT-003（`ChatLayout.tsx` は実行行 600 以下で止め、`max-lines` の warn 1 件は残す）の Claude 案でよいか | 3 つとも Claude 案で、承認者の確認待ち（§11）。案が変わると FR-002〜FR-009 の分け方・置き場所・行数目標が変わる | shoma-endo | spec-review の前（CP-1） | 回答済み（2026-10-03 shoma-endo: 3 つとも Claude 案で承認） |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | `hasContentForViewingHeading` と `hasContentForActiveHeading` の重複を統合するか | 挙動に関わる変更で、移動のみの本仕様には混ぜない | 本仕様のマージ後、Step 7 を次に変更するとき | shoma-endo |
| OPEN-002 | 不要コード（`onHeadingSaved`、`:585-599` の effect、`useAuth` の import）を消すか | 同上 | 同上 | shoma-endo |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体テスト: 追加しない。`tests/` は `environment: 'node'`（`vitest.config.ts`）で、フックや画面を描画するテストの基盤がない。基盤を足すのは本仕様の範囲を超える（Claude 案・未確認）。`src/lib/step7-lead.ts` は純関数なのでテストを書けるが、移動のみの本仕様では追加しない（`docs/specs/testing-strategy.md` の方針に従い、数値合わせのテストは書かない）
- カバレッジ: 移動のみで、未テストの行が増えも減りもしないので、`vitest.config.ts` の閾値には影響しない（分母は `src/**` と `app/**` の全ファイル）
- 自動検証: `npm run verify`
- 基準コミット: ローカルの `develop` は `origin/develop` より古いことがあるため、比較の基準は次の `B` に統一する。§1 の成功指標、§7、§14 CP-2 の `${B}` もこれを指す。zsh では `$B:app` の `:a` が修飾子として解釈されるため、`${B}:app` と書く。`git fetch origin develop` が失敗した場合（TAKT の worktree から `FETCH_HEAD` に書けないことがある）は、既存の `origin/develop` で続行する
- 移動の証跡: 次の 3 つを実行し、出力を PR 本文に貼る。`norm` の書き方は `docs/specs/client-page-boundary.md` §13 を出典とする

```bash
git fetch origin develop
B=$(git merge-base origin/develop HEAD)
F=app/chat/components/ChatLayout.tsx

# 1. 行の多重集合の比較。複数行の import は、import で始まり ; で終わる行までを 1 ブロックとして落とす
norm() { awk '/^(import|export \{.*\} from|export \{$)/{imp=1} imp{ if (/;[[:space:]]*$/) imp=0; next } {print}' "$@" \
  | sed -E 's/^[[:space:]]+//' | grep -vE '^$|^[]\)\}>;,]+$' | sort; }
diff <(git show ${B}:$F | norm) \
     <(norm $F src/hooks/useStep7HeadingView.ts src/hooks/useCanvasPanelContent.ts src/hooks/useBlogFlowControls.ts \
            src/hooks/useStep7HeadingActions.ts src/hooks/useCanvasSelectionEditStream.ts src/hooks/useCanvasNavigation.ts \
            src/lib/step7-lead.ts)

# 2. 範囲ごとの比較（位置を保つ。依存配列の要素も行の位置で比べる）。範囲は FR-002〜FR-007 と、FR-010 で一緒に移す説明コメント
rng() { git show ${B}:$F | sed -n "$1"; }
diff -wB <(rng '286,341p;372,582p')        src/hooks/useStep7HeadingView.ts
diff -wB <(rng '62,80p;584,837p')          src/hooks/useCanvasPanelContent.ts
diff -wB <(rng '1006,1030p;1033,1128p')    src/hooks/useBlogFlowControls.ts
diff -wB <(rng '839,1004p;1130,1155p')     src/hooks/useStep7HeadingActions.ts
diff -wB <(rng '58p;1444,1792p')           src/hooks/useCanvasSelectionEditStream.ts
diff -wB <(rng '1157,1304p;1348,1442p')    src/hooks/useCanvasNavigation.ts

# 3. 依存配列の検証（react-hooks/exhaustive-deps の warn 件数）
git show ${B}:$F | npx eslint --stdin --stdin-filename $F | grep -c 'react-hooks/exhaustive-deps'
npx eslint $F | grep -c 'react-hooks/exhaustive-deps'
npx eslint src/hooks/useStep7HeadingView.ts src/hooks/useCanvasPanelContent.ts src/hooks/useBlogFlowControls.ts \
  src/hooks/useStep7HeadingActions.ts src/hooks/useCanvasSelectionEditStream.ts src/hooks/useCanvasNavigation.ts \
  src/lib/step7-lead.ts | grep -c 'react-hooks/exhaustive-deps'
```

期待結果:

- 1: 差分が FR-010 の許可行だけ
- 2: 6 本とも、差分が FR-010 (a)（import・フック関数の宣言・引数の分割代入・return 文・引数と戻り値の interface）と (d)（依存配列に足した setter・ref）と (e)（R-003 で `ChatLayout` に残した宣言。移動先にない行として出る）の行だけ。FR-004 の範囲は `stepActionBarRef` の宣言とその説明コメント（`:1031-1032`）を除く
- 3: 1 行目より 2 行目が大きくない。3 行目が `0`
- 手動確認（ローカルの dev サーバー、デスクトップ幅とモバイル幅の両方）:
  1. 新しいチャットでメッセージを送る
  2. ブログ作成で Step 1 から Step 6 まで、ステップ操作バーで進める。モデルを切り替える
  3. Step 7 で見出しの生成を始める → 保存 → 過去の見出しを表示 → 結合 → 結合済みの本文を Canvas で開く
  4. Canvas でバージョンとステップを切り替える。本文の一部を選んで AI 編集する（ストリーミング表示と完了後のバージョン追加）
  5. 注釈パネルを開く。WordPress の記事を読み込む
  6. Canvas と注釈パネルを開いたまま、別のセッションに切り替える
  7. 途中で切れた応答の「続き」を実行する（`onContinueFromTruncation`）

### リリース方針

- 通常デプロイに乗せる。段階リリースやフラグは使わない
- 本番確認項目: 該当なし（Claude 案・未確認）。見た目・挙動を変えないため、§13 の手動確認（ローカル）で代える

### ロールバック方針

- PR を revert する。データ変更はない
- ロールバック判断者: shoma-endo

## 14. 実装手順・チェックポイント

### 手順

1. §10 の依存確認を実行する
2. FR-001 の純関数を切り出し、`npm run build` を通す
3. FR-006（最も大きく、依存が閉じている）→ FR-003 → FR-002 → FR-004 → FR-005 → FR-007 の順に、1 本移すごとに `npm run lint` と `npm run build` を通す
4. FR-009 の呼び出し順を確かめる
5. `npm run verify` を実行する
6. §13 の行比較（`norm`・範囲ごとの比較・依存配列の検証）を実行し、出力を PR 本文に貼る
7. §13 の手動確認を行い、結果を PR 本文に書く

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| CP-1 spec-review 前 | §12 Q-001（ALT-001 / ALT-002 / ALT-003 の Claude 案でよいか）に回答がある | shoma-endo | 確認済み（2026-10-03） |
| CP-2 PR 作成時 | `git diff --stat ${B} -- . ':(exclude)docs'`（`B` は §13。docs の差分は対象外）の変更が `app/chat/components/ChatLayout.tsx`・新しいフック 6 本・`src/lib/step7-lead.ts`（と `vitest.config.ts` の閾値ラチェット）だけ | 実装者 | 確認済み（2026-10-04。docs を除く変更は ChatLayout.tsx・新しいフック 6 本・src/lib/step7-lead.ts だけで、vitest.config.ts の変更なし） |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - §1 の成功指標をすべて満たす
  - §7 のシナリオをすべて満たす
  - `npm run verify` が緑
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - §13 の行比較（`norm`・範囲ごとの比較・依存配列の検証）の出力と、§13 の手動確認 7 項目の結果を PR 本文に書く。§12 R-003 で `ChatLayout` に残した宣言があれば、その記録も書く
- 完了確認者・確認日: shoma-endo（Claude 案・未確認。承認者・ロールバック判断者と同じ）。確認日は PR のマージ時に書く

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 0（起票時のセルフレビュー） | 2026-10-03 | 0 / 5 / 7 | 全件反映 | なし |
| 1（spec-review audit） | 2026-10-03 | 0 / 5 / 3 | 全件反映。比較の基準を `${B}`（`git merge-base origin/develop HEAD`）に統一し、`norm` の定義・範囲ごとの比較・依存配列の検証を §13 に直接書いた。SSE 失敗時の確認は手動手順を足さず範囲ごとの比較で行う（§8）。ALT-001〜003 の承認は §12 Q-001 にまとめた | なし。Q-001 は 1 回目の時点で回答待ちだったが、その後 2026-10-03 に回答済み。CP-1 は確認済み |
| 2（spec-review audit） | 2026-10-03 | 0 / 6 / 1 | 全件反映。FR-001 の関数の引数と ChatLayout 側の呼び出しを確定し、FR-010 の許可行に純関数の宣言と interface・`:149`/`:150`/`:192` の置き換えを足した。ALT-001 の理由を実コードに合わせ、FR-002 の戻り値に `isStep6ContentStale` / `setIsStep6ContentStale` を足した。BR-03 の 5 の lint 前提をプローブで確かめ、外れた場合の ABORT を R-003 に書いた。CP-2 から docs の差分を除いた。§11 の見出しを承認済みに直した。承認者・完了確認者・本番確認項目を埋めた（Claude 案・未確認） | なし。Q-001 は 2026-10-03 に回答済み。CP-1 は確認済み。未解決の確認質問・承認ゲートはない |
| 3（spec-review audit。承認後の 114e169a の変更に対する回） | 2026-10-04 | 0 / 3 / 3 | 全件反映。BR-03 の 5 の前提を、プローブ（error にならない）と 2026-10-04 の実ファイル（error になった）の両方の観測に書き直し、差の原因は未確認とした。`:625`・`:643` が error になった場合の帰結（600 行超で ABORT の見込み）を書いた。FR-010 に (e)（R-003 で残した宣言）を足し、§7・§13 の期待結果 2 を (a)(d)(e) にした。§6 の冒頭で FR-002〜FR-007 の範囲から残した宣言を除いた。R-003 に PR 本文への記録と、位置がない場合の ABORT を足した。R-002 の「見直す」を ABORT に直した。§13 に fetch 失敗時の続行を足した。最終更新日と変更履歴の順序を直した | なし。未解決の確認質問・承認ゲートはない |

#### 公式ドキュメント照合

- 実施 / 未実施: 対象外（外部サービス連携の変更なし）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-03 | 起票 | 可読性レビュー | shoma-endo（Claude Code 支援） |
| 2026-10-03 | Q-001 に回答（ALT-001〜003 を承認）。§1 の表の改行抜けを修正 | spec-review の ABORT（承認待ち） | shoma-endo（Claude Code 支援） |
| 2026-10-03 | 比較の基準・`norm`・範囲ごとの比較・依存配列の検証を §13 に追加。Q-001・ロールバック判断者を追加。相互参照を修正 | spec-review audit 1 回目 | Claude Code（spec-review revise） |
| 2026-10-03 | FR-001・FR-002・FR-005・FR-010・ALT-001・BR-03・CP-2 を修正。R-003 を追加。§11 の見出し、承認者、完了確認者、本番確認項目を更新 | spec-review audit 2 回目 | Claude Code（spec-review revise） |
| 2026-10-04 | BR-03 の 1・FR-007・R-003 を修正（`:1305` の ref 代入を `ChatLayout` に残す。lint error 時は文を移さず残す） | spec-to-pr implement が `react-hooks/immutability` で ABORT | shoma-endo（Claude Code 支援） |
| 2026-10-04 | BR-03 の 5・§6 冒頭・FR-010 (e)・§7・R-002・R-003・§13（fetch 失敗時、期待結果 2）・§15 を修正。最終更新日と変更履歴の順序を修正 | spec-review audit 3 回目 | Claude Code（spec-review revise） |
