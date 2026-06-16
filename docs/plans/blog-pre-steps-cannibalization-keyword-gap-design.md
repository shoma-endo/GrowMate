# ブログ作成フロー: カニバリゼーション/キーワードギャップ プレステップ追加 基本設計

作成日: 2026-06-10
ステータス: 設計レビュー待ち（実装未着手）

## 1. 背景・目的

ブログ作成フロー（現行 step1〜step7）の前段に、スキップ可能な2つのチェックステップを追加する。

| 順序 | ステップ | 入力/出力 | 案内メッセージ |
|---|---|---|---|
| 0a | カニバリゼーションチェック（スキップ可） | キーワード入力 → 自社既存記事とのカニバリ分析を出力 | 「キーワードを入力してください。まとめてある場合は、まとめて入力してください。」 |
| 0b | キーワードギャップチェック（スキップ可） | （キーワード自動引き継ぎ）→ 競合分析・差別化案を出力 | 「競合分析と差別化できる内容を出力します。」 |
| 1〜7 | 従来フロー（顕在/潜在ニーズ確認〜本文作成） | 変更なし | 「現在のステップ: 1.〜7.」の番号表示は不変 |

各ステップの LLM プロンプト本文はユーザーが別途用意し、DB（`prompt_templates`）に登録する。

## 2. SerpAPI 調査結論: 導入不要

| 用途 | 採用データソース | 理由 |
|---|---|---|
| カニバリチェック | **GSC 連携データ（既存）** | カニバリ判定の標準手法は「同一検索クエリに自社の複数 URL がヒットしているか」。`gsc_query_metrics` テーブル（`supabase/migrations/20251202093000_create_gsc_query_metrics.sql`）が query × URL × 平均順位 × 表示回数を保持しており、これは自社サイトに関する Google の実データ。追加コストゼロ。 |
| キーワードギャップチェック | **Anthropic web_search ツール（既存実装）** | `app/api/chat/anthropic/stream/route.ts:44-49, 265-279` に `enableWebSearch` / `webSearchConfig` が実装済み（Canvas 編集フロー `app/api/chat/canvas/stream/route.ts` で稼働実績あり）。リクエストにフラグを渡すだけで有効化できる。従量 $10/1,000 検索。 |

### SerpAPI と Anthropic web_search の違い

- **SerpAPI**（$25/月〜、$0.025/検索）: Google の実 SERP（正確な順位・PAA・関連検索）を構造化取得できる。順位そのものが必要な分析に向くが、固定費と新規 API 統合（キー管理・サービス層実装）が必要。
- **Anthropic web_search**: Brave 系インデックスのため Google の正確な順位は取れないが、LLM が自律的に検索→競合上位ページの内容を読んで分析できる。競合コンテンツの内容分析・差別化案という定性的な用途には十分。

順位精度が必要なカニバリ判定は GSC（Google 実データ）で賄い、ギャップ分析は web_search で行うため、SerpAPI を導入する理由がない。

## 3. 設計方針: `step0a` / `step0b` をステップ配列の先頭に追加（最小侵襲）

- 既存 step1〜7 の ID・保存済みデータ（`chat_messages.model`）・プロンプトテンプレート名は**一切変更しない** → DB マイグレーション不要・完全後方互換。
- 現在ステップは「最新アシスタントメッセージの `model`（例: `blog_creation_step1`）」から導出される既存機構（`src/lib/canvas-content.ts` の `extractBlogStepFromModel` / `findLatestAssistantBlogStep`）のため、新ステップも `blog_creation_step0a` / `blog_creation_step0b` という model 名を持たせるだけで同じ機構に乗る。
- スキップ/バックボタンは `BLOG_STEP_IDS.indexOf` ベースのインデックス計算（`StepActionBar.tsx` の `handleManualStepShift`）で動くため、配列先頭への追加で自動的に機能する。
- step0a/0b の出力はチャット履歴にのみ残す。`content_annotations` への新カラム追加は MVP では行わない。

### 検討した代替案（不採用）

| 案 | 不採用理由 |
|---|---|
| 既存ステップを step3〜9 に振り直し | `chat_messages.model` に保存済みの値と不整合。データ移行・テンプレート名変更が必要で破壊的。 |
| プレフロー専用の別フェーズ型を新設 | 状態管理レイヤーが二重化し、プレ→本フローの遷移ロジックが複雑化。既存機構に乗る step0a/0b 案より工数・リスクとも大きい。 |

## 4. 詳細設計

### 4.1 `src/lib/constants.ts`（単一の正本。大半がここから派生）

- `BlogStepId` 型（line 124）に `'step0a' | 'step0b'` を追加。
- `BLOG_STEP_DEFINITIONS`（line 169）の先頭に2件追加:
  - `step0a`: label「カニバリゼーションチェック（スキップ可）」/ placeholder「キーワードを入力してください。まとめてある場合は、まとめて入力してください。」
  - `step0b`: label「キーワードギャップチェック（スキップ可）」/ placeholder「競合分析と差別化できる内容を出力します。」
- `BLOG_STEP_LABELS`（line 181）: 現在は `${i + 1}. ${label}` で配列順に番号付けしており、先頭追加で既存の番号がズレる。`BlogStepDef` に任意の表示番号（`number?: number`）を持たせ、プレステップは番号なし・step1〜7 は 1〜7 固定に変更する。
- `BLOG_STEP_ACTION_BAR_FULL_TEXT`（line 215）に2件追加（step1〜7 の文言は不変）:
  - `step0a`: 「現在のステップ: カニバリゼーションチェック（スキップ可）／キーワードを送信するとカニバリ分析を出力します」
  - `step0b`: 「現在のステップ: キーワードギャップチェック（スキップ可）／送信すると競合分析と差別化案を出力します」
- `MODEL_CONFIGS`（line 62）に追加:
  - `blog_creation_step0a: { ...ANTHROPIC_BASE, maxTokens: 5000 }`
  - `blog_creation_step0b: { ...ANTHROPIC_BASE, maxTokens: 8000 }`（Web 検索結果を踏まえた出力のためやや大きめ）
- `STEP5_ID` / `STEP6_ID`（line 203, 206）: `BLOG_STEP_IDS[4]` / `[5]` の固定インデックス参照が先頭追加で壊れるため、`BLOG_STEP_IDS.indexOf('step5')` 等の ID 検索（または定義配列からの find）に変更。
- `FIRST_BLOG_STEP_ID`（line 209）は `BLOG_STEP_IDS[0]` のままで自動的に `step0a` になる＝新規ブログセッションはカニバリチェックから開始。

### 4.2 `src/lib/canvas-content.ts`

- line 23: ステップ抽出正規表現 `/^(step[1-7])(?:_|$)/` → `/^(step0[ab]|step[1-7])(?:_|$)/`。
- `getResponseModelForBlogCreation`（line 58）: `^blog_creation_step(\d+)$` に不一致の場合は requestModel をそのまま返す（1:1 保存）ため、`blog_creation_step0a` でも正しい挙動。挙動確認のうえコメント追記のみ。
- 新規ヘルパー追加: セッションメッセージから「最新の step0a ユーザーメッセージ（= 入力キーワード）」を抽出する関数（4.6 のキーワード引き継ぎで使用）。

### 4.3 `src/lib/prompts.ts`

- `BLOG_STEP_PATTERN`（line 939）は `BLOG_STEP_IDS` から動的生成されるため**変更不要**（constants 更新で自動対応）。
- `generateBlogCreationPromptByStep`（line 788）: step0a のとき GSC カニバリデータをテンプレ変数 `{{gscCannibalizationData}}` として注入する（step7 の `{{canonicalUrls}}` 注入と同パターン）。
  - `supabaseService` に新メソッドを追加: 直近90日の `gsc_query_metrics` から「同一 `query_normalized` に複数の `normalized_url` がヒット」している行を集約し、クエリ／URL／平均順位／表示回数を整形（上限 ~100 クエリ。トークン量キャップ）。
  - GSC 未連携ユーザーは空文字を注入し、プロンプト側で「ユーザー入力キーワードと既存記事情報（既存のコンテンツ変数で注入済みの WordPress データ）で判定」にフォールバックする旨を記述。

### 4.4 Web 検索の有効化（step0b）

- `src/hooks/useChatSession.ts` の `handleStreamingMessage`（line 133〜）: `model === 'blog_creation_step0b'` のとき fetch body に `enableWebSearch: true, webSearchConfig: { maxUses: 3 }` を付与。
- サーバー側（`app/api/chat/anthropic/stream/route.ts`）は実装済みのため**変更不要**。

### 4.5 `app/chat/components/StepActionBar.tsx`

- line 146: `const isStep1 = displayStep === 'step1'` → `displayStep === FIRST_BLOG_STEP_ID` に変更。バックボタンを step0a でのみ非表示にし、step1 では step0b へ戻れるようにする。
- スキップボタン・次ステップ計算は既存のインデックスロジックのまま step0a/0b でも機能（変更不要）。

### 4.6 キーワード自動引き継ぎ（`ChatLayoutContent.tsx` / `InputArea.tsx`）

- step0a で入力されたキーワードを step0b / step1 へ自動引き継ぐ。
- 方式: 4.2 のヘルパーでセッション履歴からキーワードを抽出し、step0b / step1 に遷移して入力欄が空のとき**入力欄にプリフィル**する（ユーザーが編集・確認してから送信できる透明な方式。growmate-ui-ux の「AI 挙動の透明化」に準拠）。
- step0a をスキップした場合はプリフィルなし＝従来どおり step1 でキーワードを手入力。

### 4.7 プレースホルダー表示の整合

`InputArea.tsx` のプレースホルダーは「表示中ステップの次ステップの placeholder」を表示する既存規約のため、constants 追加だけで以下になる:

- 新規セッション（ステップ未検出）→ step0a の placeholder「キーワードを入力してください。…」
- step0a 表示中 → step0b の placeholder「競合分析と差別化できる内容を出力します。」
- step0b 表示中 → step1 の placeholder（現行文言のまま。キーワードはプリフィル済み）

### 4.8 DB: `prompt_templates` に2行追加（スキーマ変更なし）

| name | 内容 |
|---|---|
| `blog_creation_step0a` | カニバリチェック用プロンプト。`{{gscCannibalizationData}}` を参照。GSC データ空時のフォールバック指示を含む。 |
| `blog_creation_step0b` | キーワードギャップ用プロンプト。Web 検索を使った競合上位分析・差別化案の出力を指示。 |

プロンプト本文はユーザー支給待ち。未登録の間は `SYSTEM_PROMPT` フォールバック（既存挙動）で動作自体は可能。

## 5. 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/lib/constants.ts` | BlogStepId 型 / BLOG_STEP_DEFINITIONS / ラベル番号 / アクションバー文言 / MODEL_CONFIGS / STEP5・6 ID 導出 |
| `src/lib/canvas-content.ts` | ステップ抽出正規表現 / キーワード抽出ヘルパー追加 |
| `src/lib/prompts.ts` | step0a への GSC カニバリデータ変数注入 |
| `src/server/services/supabaseService.ts` | カニバリ候補集約クエリの新メソッド |
| `src/hooks/useChatSession.ts` | step0b 送信時の enableWebSearch 付与 |
| `app/chat/components/StepActionBar.tsx` | バック非表示判定を FIRST_BLOG_STEP_ID 基準に |
| `app/chat/components/ChatLayoutContent.tsx` / `InputArea.tsx` | キーワードプリフィル |
| DB `prompt_templates` | 2行追加（コード変更なし・データ登録） |

## 6. 影響なし（確認済み）

- 既存セッションの再開: 最新メッセージの model が step1〜7 ならそのステップ表示（変更なし）。
- `chat_messages` / `content_annotations` のスキーマ変更なし。
- step6→7 の見出し単位生成フロー・本文生成・タイトルメタ生成: 変更なし。
- 「現在のステップ: 1.〜7.」の既存表示文言: 変更なし。

## 7. 検証計画

1. `npm run lint` / `npm run build` / `npm run knip`
2. 手動確認（新規ブログセッション）:
   - 初期表示が「カニバリゼーションチェック（スキップ可）」、placeholder がキーワード入力案内になる
   - キーワード送信 → GSC データ入りプロンプトでカニバリ分析が出力される（GSC 未連携アカウントでも動作）
   - スキップ → step0b（キーワードプリフィル確認）→ 送信で Web 検索付き競合分析が出力される
   - step0a/0b 両方スキップ → step1 で従来どおりキーワード手入力
   - step1 で「現在のステップ: 1. 顕在ニーズ・潜在ニーズ確認」が不変、バックで step0b へ戻れる、step0a ではバック非表示
   - 既存セッション読み込みで表示ステップが従来どおり
3. `git diff` 確認＋日本語1行コミットメッセージ案の提示

## 8. 未確定事項（実装前にユーザー支給/確認）

- step0a / step0b のプロンプト本文（ユーザー用意）
- step1 の placeholder 文言（キーワード自動引き継ぎ前提の文言に微調整するか。現行のままでも動作上問題なし）
- step0b の Web 検索 `maxUses`（本設計では 3。コスト/精度のバランスで調整可）
