# content_annotations AI要約生成 設計書

> 改訂履歴
> - 2026-07-02: 初版。ヒアリングの結果を反映（LLM要約方式を採用、basic_structureのみ機械抽出に分離）。
> - 2026-07-02: サブエージェントレビューを反映。(1) 生HTML取得経路が既存共有関数には無かったため追加、(2) 書き込み先を`updateContentAnnotationFields`から`upsertContentAnnotationBySession`方式（スタッフ共有アクセス対応）に変更、(3) `liffAccessToken`引数を削除、(4) HTMLエンティティのデコード方針を追加、(5) `maxTokens`を4000→8000に見直し、(6) フォーム表示への反映導線を未確定事項に追加。
> - 2026-07-02: レビュー指摘（P2）を反映。`upsertContentAnnotationBySession`は`impressions`を渡さないと`null`で上書きする実装のため、対象外のはずの既存`impressions`値が消える問題を修正（既存値を明示的に引き継ぐよう8.2手順3・12を修正）。あわせて8.2で使っていた宙に浮いた「10-A」等の節参照を実在する参照先に修正。
> - 2026-07-02: 要約ボタンの配置を`AnnotationFormFields`上部から`AnnotationPanel`のアクション行（キャンセル/保存と同じ行、視覚的に差別化）へ変更。この変更でボタンが保存操作と誤認されやすくなるリスクに対応するため、§2.3が参照していた「3.2の警告文言」（未記載だった）を追加し、受け入れ条件にも常時表示の上書き警告を追加。
> - 2026-07-02: `admin/prompts`の表示先を確認。既存の「AIチャット・生成」タブはチャット作成フロー専用プロンプト群のためのものであり本機能とは用途が異なるため、`PromptsClient.tsx`に新カテゴリを追加する方針に変更（7.2、工数表#4、受け入れ条件12を更新）。タブラベルは他カテゴリ（GSC改善提案／Google Ads分析）の命名（対象＋機能）に揃え、機能表示名（`content_annotation_ai_summary`のdisplay_name「コンテンツ情報のAI要約」）とも一貫するよう「コンテンツ情報要約」に確定。
> - 2026-07-09: プロンプト文言をユーザー指定内容に合わせて改訂。8フィールドJSON構造・`basic_structure`機械抽出方針は維持しつつ、`needs`を顕在／潜在ニーズの明示的な切り分けに、`persona`を単一ペルソナ限定＋6項目詳細に、`goal`を読者到達点／書き手（CV）到達点の分離に変更。「本文にない設定を創作しない」「不明な箇所は断定しない」の制約を追加（7.2）。

## 1. 目的

WordPress連携済みの記事（`content_annotations`）について、記事本文から評価・記事作成に必要な項目を自動生成する。現状は全項目手動入力のみで、入力負荷が高い。

自動生成後に内容が事実と異なる場合は、ユーザーが既存の編集UI（`AnnotationFormFields`）でそのまま手動修正する運用とする。

## 2. スコープ

### 2.1 対象フィールド（`content_annotations`）

| カラム | 表示名 | 生成方式 |
|---|---|---|
| `main_kw` | 主軸kw | Claude（JSON構造化出力） |
| `kw` | kw（参考） | Claude（本文から連想。既存記事のGSC実クエリではない） |
| `needs` | ニーズ | Claude |
| `persona` | デモグラ・ペルソナ | Claude |
| `goal` | ゴール | Claude |
| `prep` | PREP | Claude |
| `opening_proposal` | 書き出し案 | Claude |
| `basic_structure` | 基本構成 | **機械抽出**（HTMLの実`h2`/`h3`/`h4`タグをパース。Claude不使用） |

**対象外**: `impressions`（表示回数・検索Volは記事本文から得られない実測値のため対象外。GSC連携等、別経路の話）。

### 2.2 対象UI

`app/chat/components/AnnotationPanel.tsx`（`AnnotationFormFields` 使用、chat画面の右パネル）に「要約」ボタンを追加する。

`app/gsc-dashboard/components/SuggestionDataReadiness.tsx` は対象外（今回のスコープでは変更しない）。

### 2.3 トリガー・上書き方針

- ボタン1つ・都度手動実行（一括自動実行はしない）。
- 実行すると対象8項目（2.1参照）を**確認ダイアログなしで全て上書き**する。
- 既存の手動入力値がある場合も上書きされる（ユーザーは要約前に必要ならメモしておく想定。UI側での警告文言は3.2参照）。

### 2.4 非対象（今回やらないこと）

- 一括インポート時の自動実行（WordPress一括インポート画面 `app/wordpress-import/page.tsx` の挙動は変更しない）。
- `SuggestionDataReadiness.tsx` への同機能追加。
- 生成結果の履歴保存（`content_annotations` は現状どおり最新値のみ保持。バージョン管理は本設計の対象外）。

## 3. 画面設計

### 3.1 要約ボタン

配置: `AnnotationFormFields` 内ではなく、`AnnotationPanel.tsx` のアクションボタン行（`app/chat/components/AnnotationPanel.tsx:124-153`、「キャンセル」「保存」と同じ `border-t` で区切られた行）に配置する。

配置をこの階層にする理由:
- `AnnotationPanel` は `initialData`（`wp_post_id` を含む `AnnotationRecord`）を直接propsで保持しているため、活性化条件の判定に `AnnotationFormFields` への新規prop受け渡しが不要になる（`AnnotationFormFields` は経由しない）。
- アクション行に置くことで発見しやすくなる。

**「保存」ボタンとの見た目の差別化が必須**: 要約ボタンは「保存」とは性質が異なる（2.3のとおり、現在フォームに入力中の未保存内容を無視してWordPress本文から生成し直し、確認ダイアログなしで即DB上書きする）。同じ行・同じ見た目で並べると「AIで保存する」の一種と誤解され、未保存の手入力が黙って消えるリスクがある。対策として、アイコン（lucide-reactの `Sparkles` 等、AI生成の慣習的アイコン）を付与し、`variant` を「キャンセル」「保存」と分け、行内で左寄せに配置するなど視覚的に分離する（`キャンセル`/`保存` は現状 `flex justify-end gap-2` で右寄せのため、要約ボタンは同じ行の左側＝`justify-between` に変更して配置する想定）。

条件:
- `wp_post_id` または `canonical_url` のいずれかが解決できる（WordPress連携済み）場合のみ活性化。
- 未連携時はボタンを disabled にし、「WordPress連携後に利用できます」等の説明を添える。

### 3.2 状態表示（`growmate-ui-ux` AI連携UIの鉄則に準拠）

- **上書き警告（常時表示・必須）**: ボタン近傍に「WordPress本文から生成し直します。現在入力中の未保存内容も含めて上書きされます」等のインライン警告文言を、hoverやtooltipに頼らず**常時表示**する。3.1のとおり要約ボタンは「保存」と同じアクション行に配置され保存操作と誤認されやすいため、確認ダイアログを設けない方針（2.3）のもとではこの常時表示テキストが唯一の事前告知手段になる。ボタンのdisabled/活性状態にかかわらず表示する。
- クリック直後: ボタンを disabled + ローディング表示（「要約中…」）にし、連打を防止する。
- 30秒を超える場合の進捗表示は必須としない（想定処理時間は本文取得+Claude 1回呼び出しで数秒〜十数秒程度）。
- 成功時: 各フォームフィールドの表示値を更新し、toast で成功を通知（「AIによる要約でフィールドを更新しました」）。
- 失敗時: toast でエラーメッセージを表示し、原因に応じた次アクションを示す（後述 9. エッジケース）。**失敗時は既存の`content_annotations`の値を変更しない**（Memory Write Policy: 失敗時に正本を消さない）。
- モーダル on モーダルは発生しない（`AnnotationPanel` 自体は既存のサイドパネルであり、追加モーダルは出さない）。

## 4. 処理フロー

```
「要約」ボタンクリック
  ↓
Server Action: summarizeContentAnnotation(sessionId)
  ↓
認証・アクセス権チェック（get_accessible_user_ids 経由。オーナー/スタッフ共有アクセスに対応。8.2参照）
  ↓
content_annotations 取得（session_id 起点。既存 getContentAnnotationBySession 相当。wp_post_id / canonical_url / impressions を含めて取得）
  ↓
WordPress本文取得（1回のWordPress REST API呼び出しから2種類を得る。8.1参照）
  ├─ contentText: HTMLタグ除去済みプレーンテキスト（従来どおり wp_content_text としてキャッシュ）
  └─ contentHtml: 生HTML（DBには保存しない。このリクエスト内でのみ使用しbasic_structure抽出に渡す）
  ↓
本文サイズガード（上限超過ならAI呼び出し前にエラー終了。9.参照）
  ↓
┌─────────────────────────┬─────────────────────────────┐
│ basic_structure（機械抽出）│ 他7項目（Claude JSON出力）      │
│ contentHtmlのh2/h3/h4タグを│ contentText（プレーンテキスト）  │
│ パース→`h2 見出し`形式に整形│ を prompt_templates経由でllmChat│
│ （HTMLエンティティはパーサーの│  → ```json``` ブロック抽出・パース│
│  text抽出でデコード。6.参照）│                               │
│ → extractHeadingsFromMarkdown│                               │
│   で検証（0件なら空文字許容）│                               │
└─────────────────────────┴─────────────────────────────┘
  ↓
両方の結果を統合し、upsertContentAnnotationBySession({ session_id, ...8項目, impressions: 取得済みの既存値 }) で一括更新
（session所有者解決込みの既存の手動保存と同一の書き込み経路。8.2参照。
 impressionsは対象外だが、upsertContentAnnotationBySessionは渡さなければnullで上書きするため
 前段の content_annotations 取得で得た既存値を明示的に引き継ぐ）
  ↓
更新後の content_annotations を返却 → クライアントがフォーム表示を更新（12.の未確定事項参照）
```

**設計判断: basic_structureをClaudeに書かせない理由**

- 記事の実見出し構造をそのまま転記する作業であり、要約（自由記述の生成）とは性質が異なる。
- Step7見出し単位生成フロー（`docs/specs/step7-heading-flow-spec.md`）が `basic_structure` を `h2`/`h3`/`h4` 厳密フォーマットで読むため、フォーマット逸脱のリスクを構造的に排除する必要がある。
- 参考: `docs/plans/google-ads-evaluation-design.md` Section 16.2 の未実装フェーズ2設計でも、`basic_structure`・`opening_proposal` はJSON構造化出力に含めず別経路で生成しており、「構造出力とフリーテキスト出力を混在させない」方針は本設計と整合する（ただし同設計は既存記事の構造抽出ではなく新規構成案の生成が目的であり、そのままの流用はしない。10.参照）。

## 5. Context Assembly Contract（LLM呼び出し）

`docs/context/llm-context-memory-engineering.md` の様式に従う。

| 項目 | 内容 |
|---|---|
| 経路 | content_annotations AI要約生成（`content_annotation_ai_summary`） |
| 目的 | WordPress記事本文から `main_kw`/`kw`/`needs`/`persona`/`goal`/`prep`/`opening_proposal` の7項目を生成する |
| 入力要素 | system: prompt_templates固定テンプレート／user: 記事本文（プレーンテキスト化した`content.rendered`全文）+ 記事タイトル |
| 注入条件 | 「要約」ボタンクリック時のみ。常時注入・自動実行は行わない |
| 上限 | 入力: 本文サイズガードで上限文字数を超える記事はAI呼び出し前に拒否（9.参照、正確な閾値は8.2で確定）。出力: `MODEL_CONFIGS['content_annotation_ai_summary'].maxTokens` |
| 削減順序 | なし。本文全文を渡す前提のため要約・truncateは行わない（ユーザー合意済み）。上限超過時は呼び出し自体を止める（4以下参照） |
| 禁止情報 | `.env`/secret/token類は渡さない。WordPress認証情報（アプリケーションパスワード等）は本文取得にのみ使用しプロンプトに含めない |
| ログ方針 | 本文全文・LLM出力全文は常時ログに出さない。エラー時はエラー要因（HTTPステータス、パース失敗種別等）のみログ化する |

### Memory Taxonomy上の位置づけ

- 生成対象の `content_annotations` は **User Fact Memory**（ユーザー固有の記事情報）に分類される。管理者正本ナレッジ（Semantic Memory）ではない。
- LLM生成値をそのまま保存する設計だが、**書き込み主体は明示的なユーザー操作（ボタンクリック）** であり、自動正本化（バックグラウンドでの無断保存）ではない。
- 誤り訂正の運用導線は既存の手動編集フォーム（`AnnotationFormFields`）がそのまま担う。追加の削除・ロールバックUIは不要。

## 6. basic_structureの機械抽出仕様

- 入力: `content.rendered`（生HTML）。
- 処理: `<h2>`/`<h3>`/`<h4>` タグ（属性・入れ子インライン要素を含みうる）を検出し、タグ内テキストのみ抽出（インラインHTML除去）。出現順に `h2 見出しテキスト` / `h3 見出しテキスト` / `h4 見出しテキスト` の行として連結する。
- HTML解析には軽量パーサーの導入を推奨する（正規表現によるHTMLタグ解析は入れ子構造で誤爆しやすいため）。**新規依存の追加が必要**（例: `node-html-parser`。jsdom程重くない）。依存追加はCheck-Firstルール上、実装計画の承認時に明示する。
- **HTMLエンティティのデコード**: `&amp;`/`&#8217;` 等のエンティティは、見出しテキストとして誤ってそのまま保存してはならない（Step7の `stripLeadingMatchingHeadingFromBody` 等がLLM生成見出し・機械抽出見出しを正規化比較する際、デコード済みテキストと生エンティティ文字列が不一致になり自己修復ロジックが機能しなくなるため）。正規表現ではなく実パーサーの `.text`/`.textContent` 相当のAPIでテキスト抽出することで、パーサー側のデコード機能に乗せる（`node-html-parser` 等、主要パーサーは標準でエンティティデコードを行う）。
- **見出しテキストの単一行化**: `<br>` やネストしたブロック要素により見出しテキストに改行が混入する場合がある。`extractHeadingsFromMarkdown` は `\n` で行分割するため、改行を含んだまま `h2 見出し` 行を生成すると2行目以降が見出しとして認識されない。抽出したテキストは保存前に改行を除去・1行化する。
- 見出しタグの中身が空（例: `<h2><img></h2>` のみ）の場合、抽出テキストが空文字になり `extractHeadingsFromMarkdown` 側で当該見出しは無視される（`heading-extractor.ts` の仕様どおり）。実際の見出し数より少なく抽出される可能性がある既知の制約として許容する。
- 生成結果は `extractHeadingsFromMarkdown`（`src/lib/heading-extractor.ts`、既存関数）で検証する。0件の場合はエラーにせず `basic_structure` を空文字のまま保存する（元記事に見出しがない場合は正当な結果のため）。他7項目の保存は独立して継続する。

## 7. データ設計

### 7.1 `MODEL_CONFIGS` 追加（`src/lib/constants.ts`）

```ts
content_annotation_ai_summary: {
  ...ANTHROPIC_BASE,
  maxTokens: 8000, // JSON構造化出力・7項目。近い前例のgsc_insight_persona_rebuild（単一フィールドで5000）より
                    // フィールド数が多くJSONエスケープのオーバーヘッドもあるため、単純比例より余裕を持たせた値。
                    // 実装時に実測のうえ調整する（stop_reason: 'max_tokens' はllmService.ts側で警告ログ済み）。
  label: 'コンテンツ情報のAI要約',
},
```

### 7.2 `prompt_templates` 新規マイグレーション

`supabase/migrations/` に追加（既存 `20251215000001_add_gsc_insight_persona_rebuild_prompt.sql` と同形式）。

```sql
-- Add content_annotation_ai_summary prompt template
INSERT INTO prompt_templates (name, display_name, content, variables) VALUES
(
  'content_annotation_ai_summary',
  'コンテンツ情報のAI要約',
  'あなたはSEOコンテンツ戦略の専門家です。
以下のWordPress記事本文を読み、記事作成・評価に必要な情報を抽出してください。

【記事タイトル】
{{wpPostTitle}}

【記事本文】
{{wpContentText}}

【抽出する項目】
- main_kw: この記事が最も強く狙っていると思われる主軸キーワード（1つ）
- kw: 本文から連想される参考キーワード（最大5件、改行区切り。実際の検索クエリデータではなく、本文内容からの連想でよい）
- needs: 読者のニーズ。「顕在ニーズ」（読者が自覚し、検索窓に打ち込んでいる欲求。検索キーワードになる言葉）と「潜在ニーズ」（読者が言葉にできていない不安・面倒・本当の目的。検索語にはならない感情・状況・見落としている損得）を必ず切り分け、混ぜずに箇条書きで記載する（各3〜5個）。潜在ニーズには、なぜそれが本文の内容で満たされるかを一言添える
- persona: 想定読者をたった1人に絞ったデモグラフィック・ペルソナ（複数併記は禁止）。年齢層／性別、居住地・状況、職業・立場、家族構成、検索シーン（デバイス・場面・時間帯）、心理状態（何に困り、何を避けたいか）の6項目を記載する
- goal: この記事のゴール。「読者の到達点」（読者がこの記事を読んで得られる状態、1〜2文）と「書き手（CV）の到達点」（記事がどの行動に読者を誘導しているか、1〜2文）を分けて記載する
- prep: PREP法（Point/Reason/Example/Point）で整理した場合の要点
- opening_proposal: 書き出し（導入部）の方向性や冒頭で伝えている内容の要約

【制約】
- 本文に書かれている事実だけを根拠にする。本文にない設定を創作しない
- needs・persona・goalについて断定できない箇所は「（本文からは不明）」と書く。推測で埋めない

【出力形式】
説明文なしで、以下のJSON形式のみを ```json ``` ブロックで出力してください。needs・persona・goalは、項目内に改行を含む1つの文字列値としてよい。

```json
{
  "main_kw": "...",
  "kw": "...",
  "needs": "■ 顕在ニーズ\n・...\n\n■ 潜在ニーズ\n・...（なぜ満たされるか一言）",
  "persona": "・年齢層／性別：...\n・居住地・状況：...\n・職業・立場：...\n・家族構成：...\n・検索シーン：...\n・心理状態：...",
  "goal": "・読者：...\n・書き手（CV）：...",
  "prep": "...",
  "opening_proposal": "..."
}
```',
  '[
    {"name": "wpPostTitle", "description": "WordPress記事タイトル"},
    {"name": "wpContentText", "description": "WordPress記事本文（プレーンテキスト化済み）"}
  ]'::jsonb
);

-- Rollback instructions:
-- DELETE FROM prompt_templates WHERE name = 'content_annotation_ai_summary';
```

初版投入後は `admin/prompts` 画面で運用者が文言調整可能（既存の仕組みをそのまま利用）。

**確認済み**: `app/admin/prompts/PromptsClient.tsx` の `fetchPrompts()` はDBの全`prompt_templates`行を無条件取得しており、allowlist等の制限はない。表示タブは名前prefixによる振り分け（`PROMPT_CATEGORIES`）のみ。

**カテゴリタブを新設する**: 既存の「AIチャット・生成」タブは `blog_creation_step1〜7`・`ad_copy_creation`・`lp_draft_creation`・`blog_title_meta_generation` など、チャット作成フロー内でボタン操作に応じて新規コンテンツを生成するプロンプト群のためのものであり、チャットのステップフローと無関係に既存WordPress記事を読んで既存フィールドを埋め直す本機能とは用途が異なる。「GSC改善提案」（`gsc_*`）もGSC順位変化をトリガーにした提案という別文脈であり不適。そのため `PROMPT_CATEGORIES` に新しいカテゴリを追加する。

- Target: `app/admin/prompts/PromptsClient.tsx`
- Action: `PROMPT_CATEGORIES` に以下のエントリを追加し、`chat` カテゴリのfilterから当該prefixを除外して二重表示を防ぐ

```ts
// 追加
{
  id: 'content_annotation',
  label: 'コンテンツ情報要約',
  filter: template => template.name.startsWith('content_annotation_'),
},
// 既存 'chat' フィルタを修正（二重表示防止）
{
  id: 'chat',
  filter: template =>
    !template.name.startsWith('gsc_') &&
    !template.name.startsWith('google_ads_') &&
    !template.name.startsWith('content_annotation_'),
},
```

  `PromptCategory` 型（`'chat' | 'gsc' | 'google_ads'`）に `'content_annotation'` を追加することも忘れないこと。
- Risk: 低（表示分岐の追加のみ。既存カテゴリの対象範囲が変わるのは `content_annotation_*` prefixの新規テンプレートのみで、既存テンプレートの表示には影響しない）

任意（ブロッカーではない）: `src/lib/prompt-descriptions.ts` にテンプレート名ごとの補足説明を追加すればadmin/prompts画面での説明表示が親切になるが、既存の`gsc_insight_persona_rebuild`等も未登録のまま運用されており必須ではない。

### 7.3 `ERROR_MESSAGES` 追加（`src/domain/errors/error-messages.ts`）

`WORDPRESS` 名前空間に追加想定（正式なキー名・文言は実装時に確定）:

- `SUMMARY_SOURCE_NOT_LINKED`: WordPress連携がない記事で実行しようとした場合
- `SUMMARY_CONTENT_FETCH_FAILED`: WordPress本文取得に失敗した場合
- `SUMMARY_CONTENT_TOO_LARGE`: 本文サイズガード超過
- `SUMMARY_AI_FAILED`: Claude呼び出し失敗
- `SUMMARY_PARSE_FAILED`: JSON抽出・パース失敗

## 8. サーバー実装

### 8.1 ファイル構成（新規）

| ファイル | 責務 |
|---|---|
| `src/server/actions/contentAnnotationSummary.actions.ts` | `'use server'`。認証・所有者チェック・全体オーケストレーション |
| `src/server/services/contentAnnotationSummaryService.ts` | 本文取得〜Claude呼び出し〜JSON抽出〜見出し機械抽出の実処理 |
| `src/lib/html-content-extractor.ts` | HTML→見出しリスト抽出／HTML→プレーンテキスト変換の共通ユーティリティ |

**リファクタ（重複排除・レビュー反映で修正）**: WordPress本文取得ロジック（`gscSuggestionService.ts` の private `fetchWpPostData`）を共有関数として切り出す。

サブエージェントレビューで判明した問題: `fetchWpPostData` が内部で呼ぶ `extractPostFields` は生HTML（`content.rendered`）をその場で `stripHtml` により除去し、除去後のプレーンテキストしか呼び出し元に返さない（`gscSuggestionService.ts:395-417`）。`wp_content_text` として永続化されるのもこのプレーンテキストのみで、生HTMLを保持するDBカラムは存在しない（`wp_content_cache`は型定義のみで対応マイグレーションなし＝未使用のデッドフィールド）。そのため元設計の「共有関数をそのまま使う」だけでは6.のbasic_structure機械抽出に必要な生HTMLが得られない。

- Target: `src/server/services/gscSuggestionService.ts`（`fetchWpPostData`/`extractPostFields` を切り出し元）、新規 `src/server/services/wordpressContentSync.ts`（切り出し先）
- Action: 切り出す共有関数の戻り値を `{ contentText, contentHtml, title, excerpt }` に拡張する。`contentHtml`（生HTML）はDBに永続化せず、呼び出し元のリクエスト内でのみ使う一時値とする。`gscSuggestionService.ts` 側は従来どおり `contentText` のみ使用し挙動を変えない。`contentAnnotationSummaryService.ts` は `contentHtml` を見出し機械抽出に、`contentText` をClaude入力に使う
- Risk: 低〜中（`extractPostFields` の戻り値型変更が既存呼び出し元に影響しないことをテストで確認する必要あり）

### 8.2 `summarizeContentAnnotation` 処理ステップ

サブエージェントレビューで判明した問題を反映し、以下の2点を元設計から変更する。

- **書き込み経路の変更**: `content_annotations` のRLSはオーナー本人だけでなく `get_accessible_user_ids` によるスタッフ共有アクセスにも対応している（`supabase/migrations/20260107000002_update_rls_policies.sql`）。`AnnotationPanel` の既存の手動保存は `upsertContentAnnotationBySession`（session起点でオーナーIDを解決し `accessibleIds` を確認してから書き込む）を使っており、スタッフ共有時も正しく動作する。一方 `updateContentAnnotationFields` は実行ユーザー自身の `user_id` で直接フィルタするのみで、この共有アクセス解決を行わない（GSCダッシュボード＝オーナー本人限定の文脈向けに書かれたもの）。要約結果の保存にこれをそのまま使うと、オーナーの記事を編集中のスタッフが要約を実行した際にレコードが見つからず失敗する。**`updateContentAnnotationFields` ではなく `upsertContentAnnotationBySession` と同じオーナー解決パターンを使う**。
- **識別子を `annotationId` から `sessionId` に変更**: 上記の書き込み経路変更に合わせ、読み取りも `getContentAnnotationBySession`（session起点、`get_accessible_user_ids` 経由でスタッフ共有に対応済み）を使う。`AnnotationPanel` は元々 `sessionId` を保持しているため、コンポーネント側の呼び出しも自然になる。
- **`liffAccessToken` 引数を削除**: 現行の認証は `withAuth`（cookieベース）のみで完結しており、`updateContentAnnotationFields`（`annotationId, fields` の2引数）を含む既存の同種Server Actionは `liffAccessToken` を取らない。LINE LIFF時代の名残であり本機能では不要。

```ts
export async function summarizeContentAnnotation(
  sessionId: string
): Promise<ServerActionResult<AnnotationRecord>>
```

1. 認証（既存 `withAuth` パターン）
2. `sessionId` を zod で検証
3. `content_annotations` を `session_id` 起点・`get_accessible_user_ids` 経由で取得（`getContentAnnotationBySession` 相当。オーナー/スタッフ共有アクセスに対応）。`impressions` を含めて取得し、手順12の上書き防止に使う
4. `wp_post_id` / `canonical_url` のいずれも無ければ `SUMMARY_SOURCE_NOT_LINKED` を返す
5. 本文取得（8.1のリファクタ後の共有関数を利用し `{ contentText, contentHtml }` を得る。`contentText` は必要ならキャッシュ確認→WordPress REST API呼び出し→`wp_content_text`更新。`contentHtml` は都度取得の一時値）。失敗時は `SUMMARY_CONTENT_FETCH_FAILED`
6. 本文サイズガード（閾値は実装時にトークン見積りベースで確定。超過時は `SUMMARY_CONTENT_TOO_LARGE` を返しAI呼び出しを行わない）
7. `contentHtml` から `basic_structure` を機械抽出（6.参照。エンティティデコード・単一行化を含む）
8. `contentText` をClaude入力として使用（追加のHTML→テキスト変換は不要。手順5で取得済みのプレーンテキストをそのまま使う）
9. `PromptService.getTemplateByName('content_annotation_ai_summary')` 取得 → `PromptService.replaceVariables(template.content, { wpPostTitle, wpContentText: contentText })`
10. `llmChat('anthropic', 'claude-sonnet-4-6', messages, MODEL_CONFIGS['content_annotation_ai_summary'])` 実行。失敗時は `SUMMARY_AI_FAILED`
11. 応答から ` ```json ... ``` ` ブロックを抽出・パース（`googleAdsAiAnalysisService.ts` の抽出手法を踏襲）。失敗時は `SUMMARY_PARSE_FAILED`（この時点でDB書き込みは行わない＝既存値は保持される）
12. パース結果の7項目 + 手順7の`basic_structure` + 手順3で取得済みの`impressions`（変更せずそのまま）を統合し、`upsertContentAnnotationBySession({ session_id: sessionId, ...8項目, impressions: 既存値 })` で一括更新（オーナー解決込みの既存書き込み経路を再利用）。
    **注意**: `upsertContentAnnotationBySession`（`wordpress.actions.ts:689`）は `impressions: payload.impressions ?? null` という全項目upsert実装であり、部分パッチではない。`impressions`をペイロードに含めずに呼び出すと`undefined ?? null`で既存値が`null`に上書きされる（スコープ外のはずのimpressionsが消える）。**必ず手順3で取得した既存値を明示的に含めて呼び出すこと。**
13. 更新後の `content_annotations` を返却

## 9. エッジケース

| ケース | 挙動 |
|---|---|
| WordPress未連携の記事で実行 | ボタン自体をdisabledにし、実行不可（3.1参照） |
| 本文取得失敗（WP API障害・認証切れ等） | エラーtoast表示、既存値は変更しない。原因文言は既存の`isWordPressAuthError`判定パターンを踏襲 |
| 本文が極端に大きい記事 | サイズガードでAI呼び出し前に拒否。「本文が大きすぎるため要約できません」等を表示 |
| 記事に見出し（h2/h3/h4）が1つもない | `basic_structure`は空文字で保存。他7項目は正常に生成・保存される |
| Claude応答がJSON形式に従わない | パース失敗として扱い、DB更新せずエラー表示。再試行導線は「もう一度要約ボタンを押す」のみ（同一UIでの再実行） |
| 出力が`maxTokens`で打ち切られた場合 | `llmService.ts`の既存ログ（`stop_reason === 'max_tokens'`時の`console.warn`）で検知。ユーザー向けにはパース失敗と同様の扱い（JSON末尾が欠けてパース不能になるため自然に9行目のケースに合流する） |
| 要約実行中に画面遷移・別セッションへ移動 | Server Actionの完了を待たずに離脱した場合の扱いは既存の同種操作（他のAI生成ボタン）と同一方針に従う。DB更新自体はサーバー側で完了する |

## 10. 既存機能との関係

- `docs/plans/google-ads-evaluation-design.md` Section 16（フェーズ2、開発未着手・一旦区切り中）は、Google Ads提案を起点に同じ `content_annotations` 8項目相当（`main_kw`/`kw`/`impressions`/`needs`/`persona`/`goal`/`prep` + `basic_structure`/`opening_proposal`）を生成する設計を既に持つ。ただし目的が異なる（**既存記事の内容抽出**ではなく**新規記事のための構成案生成**）ため、プロンプト・生成手法は共有しない。
- 差分:
  - 本設計は**既存記事の実内容を要約**する。フェーズ2は**未執筆記事のための新規提案**を生成する。
  - 本設計は確認ダイアログなしで直接`content_annotations`を上書きする。フェーズ2は`google_ads_blog_suggestions`に一旦保持し、確認モーダル経由でのみ確定する2段階方式（Section 16.12に設計根拠あり）。
  - フェーズ2再開時、`prompt_templates`・`MODEL_CONFIGS`のキー命名が衝突しないよう本設計のキー（`content_annotation_ai_summary`）と明確に区別すること。
- `app/gsc-dashboard/components/SuggestionDataReadiness.tsx` の「改善提案に必要なデータ」判定ロジックには影響しない（読み取り専用の依存関係のみで、本設計はこの判定ロジック自体を変更しない）。

## 11. 受け入れ条件

1. WordPress連携済みの記事で「要約」ボタンを押すと、`main_kw`/`kw`/`needs`/`persona`/`goal`/`prep`/`opening_proposal`/`basic_structure` の8項目が更新される
2. WordPress未連携の記事ではボタンが disabled になる
3. `basic_structure` は元記事の実際の見出しタグから機械的に生成され、Claudeの自由生成は含まれない
4. 生成された `basic_structure` が空でない場合、`extractHeadingsFromMarkdown` で1件以上の見出しとして抽出できる
5. AI呼び出し・パースいずれかが失敗した場合、`content_annotations` の既存値は変更されない
6. 実行中はボタンが disabled になり連打できない
7. 成功時・失敗時ともにtoastでユーザーに結果が通知される
8. `kw` は改行区切りで最大5件程度に収まる（プロンプトで上限を明示）
9. 本文取得ロジックの共通化後も、既存のGSC改善提案フロー（`gscSuggestionService.ts`）の挙動に変化がないことを確認する
10. 既存の `impressions` 値がある記事で要約を実行しても、実行後に `impressions` の値が変化しない（`null`化されない）
11. 要約ボタン近傍に、上書き・未保存内容破棄を告知する警告文言が常時表示されている（hover操作なしで視認できる）
12. `admin/prompts` 画面で `content_annotation_ai_summary` が新設の「コンテンツ情報要約」タブに表示され、「AIチャット・生成」「GSC改善提案」タブには重複表示されない

## 12. 未確定・実装時に確定すべき事項

- 本文サイズガードの具体的な閾値（文字数 or トークン数）
- HTML解析ライブラリの選定（`node-html-parser` 等の新規依存追加の可否・承認）
- `ERROR_MESSAGES` の正式なキー名・日本語文言
- **要約結果をUI表示へ反映する具体的な導線**: `useAnnotationForm`（`src/hooks/useAnnotationForm.ts`）は現状 `updateField`（1フィールドずつの更新）のみを公開しており、8項目を一括で表示反映するAPIがない。一方 `initialFields` プロパティが変わると `useEffect` でフォーム全体を再同期する仕組みは既にある。`AnnotationPanel` に渡る `initialData` は `ChatLayout`/`ChatLayoutContent` 経由で、`onSaveSuccess` 相当の既存の保存後リフレッシュ経路が `content_annotations` の再取得・再受け渡しを行っているかを実装時に確認し、それで賄えない場合は `ChatLayout` 内の `setAnnotationData`（既存・現状 `AnnotationPanel` まで届いていない）を新たに露出するかを判断する
- `MODEL_CONFIGS['content_annotation_ai_summary'].maxTokens`（暫定8000）は実測のうえで調整する
- 連打・二重送信によるLLM呼び出しの重複実行防止をボタンdisabled以外に設けるか（GSC改善提案の`suggestion_job_token`のようなジョブトークン方式を採用するか）は、コスト影響を見て判断する

## 13. 開発工数

前提: 実装者1名フルタイム換算の人日。レビュー待ち時間・クライアント合意待ちは含まない。

| # | 作業項目 | 標準 | 余裕込み |
|---|---|---|---|
| 1 | `node-html-parser`導入＋見出し抽出ユーティリティ（entity decode・単一行化） | 0.5日 | 1日 |
| 2 | `fetchWpPostData`/`extractPostFields`リファクタ（`contentHtml`追加）＋GSC提案フロー回帰確認 | 0.5日 | 1日 |
| 3 | `prompt_templates`マイグレーション＋プロンプト初版〜反復調整 | 0.5日 | 1.5日 |
| 4 | `MODEL_CONFIGS`／`ERROR_MESSAGES`追加、`admin/prompts`新カテゴリタブ追加 | 0.5日 | 0.75日 |
| 5 | `contentAnnotationSummaryService`（本文取得〜JSON抽出〜検証） | 1日 | 1.5日 |
| 6 | Server Action（`summarizeContentAnnotation`、認可・エラーハンドリング） | 0.5日 | 1日 |
| 7 | UI: 要約ボタン（ローディング/disabled/toast） | 0.5日 | 1日 |
| 8 | UI: フォーム反映導線（12.の未確定事項。ChatLayout/ChatLayoutContent/AnnotationPanelにまたがる可能性あり） | 0.5日 | 1.5日 |
| 9 | `wp_post_id`受け渡し（ボタン活性化条件） | 0.25日 | 0.5日 |
| 10 | 結合・手動確認（self-hosted/WordPress.com、スタッフ共有、見出しなし記事、エンティティ含む見出し等） | 1日 | 1.5日 |
| 11 | quality-gate（lint/build/knip）＋GSC画面動作確認 | 0.5日 | 0.5日 |
| **合計** | | **約6.5日** | **約12日** |

余裕を多めに積んだ項目とその理由:

- **#3 プロンプト反復**: JSON出力の安定性・`maxTokens`実測調整は事前に回数が読めない
- **#8 フォーム反映導線**: 12.で未確定のまま残した箇所。既存の保存後リフレッシュで足りるか、複数ファイルにまたがる新規配線が要るかで工数が倍近く変わる
- **#2 リファクタ**: GSC改善提案フローは既存本番機能のため、回帰があれば当該部分は仕様通り動くまでやり直し

**結論**: 標準約6.5人日、余裕を持った工数として **12人日** 前後を見込む。
