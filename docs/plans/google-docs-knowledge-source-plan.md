# テキスト共通 Doc 知識ソース機能 実装可否判断 ＆ 段階的ロードマップ

> **Pro 記憶レイヤーの正本（2026-06）**  
> Pro の「考え方・ノウハウ」は **管理者指定のカオルさん共通 Doc（テキスト保存）** のみ（`**paid` / `admin` への L1 注入**。下記 §L1 注入の対象ユーザー）。ユーザー別哲学プロファイルは **採用しない**。本書が唯一の実装計画。
>
> **仕様変更（2026-07）**: 当初は Google Docs API で外部 Doc を取得する計画だったが、他のプロンプト管理と同様に **アプリ内でテキストベース保存** する方針へ変更する。共通 Doc の考え方（管理者のみが管理し、Pro 生成へ毎回 L1 注入する）は維持し、Google Docs API / サービスアカウント / URL フェッチは MVP から外す。

## Context（なぜ）

### クライアント要望（原文・確定）

> Claude のプロジェクト同様に、指定の Google ドキュメントを読み込むように設定できませんか。  
> ユーザーが個別で設定するのではなく、**あくまでこちら側（管理者）だけで設定**する。NotebookLM のようなやり方。  
> ユーザー側の出力は、**こちらが指定したドキュメントありき**。

**解釈（合意）**


| 項目        | 内容                                                   |
| --------- | ---------------------------------------------------- |
| 誰が設定するか   | **管理者のみ**（ユーザー個別設定なし）                                |
| 何を読むか     | 管理者が保存した共通 Doc テキスト（カオルさんの考え方・ノウハウ）               |
| 誰に効くか     | **有料 Pro ユーザー共通**（`paid` / `admin`。下記 §L1 注入の対象ユーザー） |
| Lite との関係 | NotebookLM 相当を Pro 生成パイプラインに載せる                      |
| 出力の前提     | 指定 Doc ありき（毎回サーバーが注入）                                |


### 背景：GrowMate Lite とのギャップ

- **GrowMate Lite** は NotebookLM にカオルさんの考え方・ノウハウを読み込ませた「カオルさん AI」として提供され、回答精度が評価されている。
- **GrowMate Pro** にはそのレイヤーがなく、ユーザーは Pro で明確な回答が得られない場合 Lite に逃げている。
- 本機能は **Lite の NotebookLM 相当（カオルさん共通の「脳」）を Pro の生成パイプラインに載せる** ことが目的。

### 読み込む内容（確定）

- **カオルさん自身の考え方・ノウハウ** をまとめた共通 Doc テキスト（複数可）。
- **制作物（ブログ／広告／LP）ごとに Doc を分ける要件ではない**（制作物の型は既存 `prompt_templates` が担う）。
- 「運用マニュアル」「禁止表現リスト」などの一般ラベルではなく、**Lite と同種のナレッジ** として扱う。

### 2 レイヤー（Pro の正）

> **記号**: **L1 / L2** = 生成時に連結する **注入レイヤー**（本節）。後述の **M①〜M④（メモリ4タイプ）** とは別体系。


| レイヤー               | 内容                        | 設定者               | 保存・注入                                                    |
| ------------------ | ------------------------- | ----------------- | -------------------------------------------------------- |
| **L1 カオルさん共通 Doc** | 考え方・ノウハウ（本機能）             | **管理者**           | `prompt_templates.content`（専用行） → `**paid`/`admin` の chat 系生成**に自動融合 |
| **L2 制作物プロンプト**    | step 構成・制約・フォーマット ＋ 事業者変数 | 管理者 ＋ ユーザー（事業者情報） | 既存 `prompt_templates` ＋ `replaceTemplateVariables`       |


**ユーザー別「哲学プロファイル」レイヤーは Pro では設けない。**

**融合イメージ（生成時）:**

```
system prompt =
  [L1 カオル共通 Doc ホット層（budget 内）]
  + [L2 選択中テンプレの content（{{company}} {{persona}} 等の事業者変数置換後）]
```

※ L1 の全文は DB（**M② 外部メモリ**）に保持。LLM には **M① コンテキスト内**（budget 内断片）のみ注入。詳細は **カオル Doc メモリ層** を参照。  
※ 事業者情報（5W2H・ペルソナ等）は **ユーザー別の事実データ**（L2 テンプレ変数）。**考え方・ノウハウ** は L1（管理者 Doc）のみ。

NotebookLM 公開 API はない。MVP では **管理者保存テキスト + DB 保存 + プロンプト先頭への自動連結** で再現する。

---

## 結論

**実装可能。** クライアント原文は「指定 Doc ありき」だが、MVP の L1 注入対象は `**paid` / `admin` の有料 Pro ユーザーの出力** に限定する（`trial` は除外・要確認。下記 §L1 注入の対象ユーザー）。

**MVP 正体**: `/admin/prompts` に共通 Doc テキスト管理を統合 → 管理者が本文を保存 → DB 保存 → `**paid`/`admin` の** allowlist 合格 chat 系生成時に L1 Doc + L2 テンプレを自動融合。


| 項目                  | 方針                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| 保存                  | 管理者が `/admin/prompts` で共通 Doc 本文を直接入力・保存                                                       |
| キャッシュ               | DB（`prompt_templates.content` の専用行を生成時に参照）                                                       |
| 反映                  | 管理画面で保存した内容を次回生成から利用。外部 API 同期は行わない                                                       |
| 管理 UI               | **別画面 `/admin/knowledge` は作らない**。`/admin/prompts` に Doc セクション統合（折りたたみ + コンパクト一覧/編集。常時フル展開は ❌） |
| テンプレ別 Doc           | **MVP では不要**（将来拡張）                                                                             |
| `{{knowledgeBase}}` | **管理者に書かせない**。コード側で自動融合                                                                        |
| Doc メモリ層            | **M② 全文 DB（切り詰め禁止）** + **M①** budget 注入。L2 テンプレ・履歴は対象外                                         |
| L1 注入対象             | `**hasPaidFeatureAccess(role)` = `paid` / `admin` のみ**（下記 §L1 注入の対象ユーザー）                       |
| Google 審査           | Google Docs API を使わないため **OAuth アプリ審査不要**                                                        |


Google Docs 連携は採用しない。Ads/GSC の **ユーザー OAuth**（`google-auth.ts`）とは別経路であり、本機能では参照しない。

---

## クライアント合意・確認状況


| 項目                                      | 状態                                                     |
| --------------------------------------- | ------------------------------------------------------ |
| 管理者のみ設定・有料 Pro ユーザー共通（`paid` / `admin`） | ✅                                                      |
| `trial` への L1 注入                        | ⏳ **要クライアント確認**（現行 chat は trial も利用可。下記 §L1 注入の対象ユーザー） |
| 内容 = カオルさんの考え方・ノウハウ（Lite NotebookLM 同種） | ✅                                                      |
| 共通 Doc テキストは **1 専用テンプレート行**               | ✅ 複数の論理 Doc は本文内の見出し・区切りで管理                           |
| URL 登録 + 自動取得                           | ❌ **仕様変更で廃止**                                         |
| UI = 既存プロンプト管理 + 共通 Doc テキスト保存          | ✅                                                      |
| テンプレ別 Doc（制作物ごと）                        | ❌ MVP スコープ外                                            |
| 更新頻度                                    | 管理者が必要時に **手動保存**。定期バッチは不要                                |


---

## 着手前の必須定義（レビュー反映）

実装着手前に以下を計画書正本とする。コードは **allowlist 経由の明示配線のみ** とし、`llmService` 全体フックによる暗黙注入は **禁止**。

### L1 注入の対象ユーザー（Pro 判定）

「Pro」= 本機能の L1 Doc が載る **有料機能利用者** と定義する。現行 `src/types/user.ts` の `hasPaidFeatureAccess(role)` に合わせる。


| ロール           | L1 Doc 注入 | 備考                                         |
| ------------- | --------- | ------------------------------------------ |
| `paid`        | ✅         | 有料契約ユーザー                                   |
| `admin`       | ✅         | 管理者（有料機能と同扱い）                              |
| `trial`       | ❌         | お試しユーザー。chat 自体は利用可（日次上限あり）だが **L1 は載せない** |
| `unavailable` | ❌         | サービス利用不可                                   |


**削除済み `owner` ロール**: 従業員招待に伴う `owner` は **現行アプリから完全削除済み**（`src/types/user.ts` の `UserRole` に存在しない）。レガシー migration に SQL 断片が残っていても本機能の判定対象外。DB に `role='owner'` の行が残存していても L1 は注入しない（`hasPaidFeatureAccess` が false 相当）。データクリーンアップは本件スコープ外。

**判定タイミング**: 各生成入口で `buildKnowledgeSystemBlocksForRequest` を呼ぶ。内部で `hasPaidFeatureAccess` / allowlist を判定し、不合格時は L2 のみ返す。

**クライアント確認事項（未確定）**: trial ユーザーにも Lite 相当の Doc を載せるか。現計画は **除外**（有料差別化・コスト）。載せる場合は上表と middleware 方針を再検討。

**管理者プレビュー**: MVP では別経路なし。管理者が Doc 効果を確認するときは `**paid` / `admin` ロールのアカウントで通常生成** する。

### 共通 Doc テキスト保存仕様


| 項目           | MVP 方針                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| 保存形式         | `prompt_templates.content` の専用行に **プレーンテキスト / Markdown 相当の本文**を保存 |
| 入力者          | 管理者のみ。ユーザー個別設定は作らない                                               |
| 外部取得         | **行わない**。Google Docs API / URL fetch / サービスアカウントは MVP 外               |
| Doc 単位        | MVP は `name='global_knowledge_source'` の **1 行**。複数の論理 Doc は本文内で `---` / 見出し区切りにする |
| 本文編集         | 管理 UI から専用テンプレート行の `content` を更新できるようにする                     |
| 保存時バリデーション   | 専用行 `content` の文字数上限をチェックし、超過時は保存しない                              |
| 反映タイミング      | 管理者が保存した次回生成から反映。外部同期や「再取得」概念は持たない                           |
| リンク・表・箇条書き   | 管理者が Markdown / プレーンテキストで表現する。API 変換による構造落ちは発生しない                |


運用推奨: 共通 Doc は **テキスト中心** で記述する。表・画像依存の重要情報は Markdown 化して保存し、長文化が常態化した場合のみ Doc 分割または将来 RAG を検討する。

### 現ブランチ差分の扱い（2026-07 仕様変更反映）

`origin/develop...HEAD` の差分では、テキストベース化後も使うべき実装と、Google Docs 連携前提で削除してよい実装が混在している。

| 分類 | 対象 | 判断 |
| --- | --- | --- |
| 残す | `src/lib/knowledgeBudget.ts` / `src/lib/knowledgeInjection.ts` | token budget、trim、allowlist、2 block system は保存元に依存しない |
| 残す | chat / canvas / `modelHandlers` / `llmService` の L1 注入配線 | テキスト保存後も生成へ共通 Doc を注入する本体 |
| 見直す | `getGlobalKnowledgeContent()` 相当の取得処理 | `knowledge_sources` ではなく `prompt_templates.name='global_knowledge_source'` から読む |
| 見直す | `/admin/prompts` の共通 Doc UI | localStorage ではなく既存プロンプト保存と同様に Server Action 経由で `prompt_templates.content` に保存 |
| 削除 | `knowledge_sources` migration / 型 / repository / mapper / service | 既存 `prompt_templates` を保存先にするため不要 |
| 削除 | `knowledgeSourceOverride.ts` と localStorage 検証 UI / request override 配線 | 共通 Doc は DB 保存のみ。ブラウザ保存は採用しない |
| 削除 | `src/server/services/googleDocsService.ts` | Google Docs API 取得を廃止するため不要 |
| 削除 | `src/server/lib/googleDocsCredentials.ts` | サービスアカウントを使わないため不要 |
| 削除 | `googleapis` 依存 / `.env.example` の `GOOGLE_DOCS_*` | Google Docs 連携を廃止するため不要 |
| 削除 | `refreshKnowledgeSource()` / `fetchAndStoreContent()` / Docs URL parse | 外部再取得ではなく管理者保存へ変更するため不要 |

### token 推定方式（MVP）

15,000 token budget・40K/60K ガードの判定は **文字数換算ではなく推定 token** を正とする。MVP では API 呼び出しなしの **保守的ヒューリスティック** を採用。

```typescript
// src/lib/knowledgeBudget.ts（案）
/** 日本語混在向け。実測と ±15% 程度ズレうる */
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 1.5;
const TOKEN_ESTIMATE_SAFETY_FACTOR = 1.1;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil((text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN) * TOKEN_ESTIMATE_SAFETY_FACTOR);
}
```


| 項目    | 方針                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| 用途    | `trimKnowledgeForGeneration` の budget 判定、管理 UI の推定 token 表示、step7 ガードの総入力推定                                                   |
| 許容誤差  | MVP は ±15% 程度を許容。**境界付近は安全側**（超過側に倒す）                                                                                         |
| 単体テスト | 14,999 / 15,001 token 相当の文字列で trim 境界を検証                                                                                      |
| 将来置換  | 本番運用でズレが問題化したら Anthropic `**count_tokens` API** または `@anthropic-ai/tokenizer` 等へ移行。移行条件: 実測 3 セッション以上で推定が budget を 10% 以上過小評価 |


### L1 注入 allowlist（誤注入防止）

GSC / Google Ads を ❌ にしても、`llmService.llmChat` 直前の共通フック化すると `**google_ads_ai_evaluation`・`gsc_insight_`* に誤注入** する。注入は `**buildKnowledgeSystemBlocksForRequest()` の呼び出し元** を allowlist で縛る。

```typescript
// src/lib/knowledgeInjection.ts（案）
const KNOWLEDGE_INJECTION_MODEL_KEYS = new Set([
  'ad_copy_creation',
  'lp_draft_creation',
  'blog_title_meta_generation',
  'blog_creation_step1',
  'blog_creation_step2',
  'blog_creation_step3',
  'blog_creation_step4',
  'blog_creation_step5',
  'blog_creation_step6',
  'blog_creation_step7',
  'blog_creation_step7_heading',
]);

export function isKnowledgeInjectionModel(modelKey: string): boolean {
  if (KNOWLEDGE_INJECTION_MODEL_KEYS.has(modelKey)) return true;
  if (/^blog_creation_step7_h\d+/.test(modelKey)) return true;
  if (/^blog_creation_step6_/.test(modelKey)) return true;
  return false;
}

/** allowlist 外 model または hasPaidFeatureAccess=false → L2 templateBlock のみ返す */
export async function buildKnowledgeSystemBlocksForRequest(
  templateBlock: string,
  options: { modelKey: string; userRole: UserRole; budgetTokens?: number }
): Promise<KnowledgeSystemBlocks> { ... }
```


| 注入 ✅                                                                                                          | 注入 ❌（allowlist 外・呼び出さない）                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 上記 model keys + Canvas **編集本体**（`apply_full_text_replacement` の `finalSystemPrompt` 構築時のみ。model key は step 系） | `google_ads_ai_evaluation`, `google_ads_negative_keywords_suggestion`, `gsc_insight_*`, Canvas Web 検索 / 分析段 |
|                                                                                                               | `**llmService.llmChat` 内での自動注入は禁止**                                                                         |


Canvas 編集本体は **経路 allowlist**（`canvas/stream` の編集段のみ `buildKnowledgeSystemBlocksForRequest` 呼び出し）で制御。Web 検索・分析段では呼ばない。

---

## コンテキストエンジニアリング（設計原則）

**参照**: [コンテキストエンジニアリング入門（Qiita）](https://qiita.com/yuji-arakawa/items/da4d5eec968b92ebc26d)

**コンテキストエンジニアリング** = 1 回の LLM 呼び出しに渡す入力全体（system・履歴・user・tool 定義・tool 結果・外部記憶の抜粋等）の **組み立て方**。本機能は L1 Doc 注入だけでなく、**何を渡す / 渡さない / いつ削る** を設計することが核心。

> **混同注意**: 本節の **Memory Taxonomy** は GrowMate 全体の記憶の種類。**M①〜M④**（後述 §カオル Doc メモリ層）は **L1 Doc レイヤー内** のホット/コールド/cache 分類で、別体系。

### Context Assembly Contract（入力構成の契約）


| 要素                   | 例                                   | 注入可否                          | 上限 / 制御                       | 備考                                         |
| -------------------- | ----------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------------ |
| **L1 Kaoru Doc**     | `prompt_templates.name='global_knowledge_source'` の M① hot layer | `paid`/`admin` + allowlist のみ | 15,000 token。長尺時 7,500 / skip | `**replaceVariables` 対象外**。Block A + cache |
| **L2 Template**      | `prompt_templates`                  | 対象生成で必須                       | **原則 trim しない**               | 制作物の型。Block B                              |
| **Business Info**    | brief / service                     | あれば L2 に置換                    | 既存 `replaceTemplateVariables` | L1 と混ぜない                                   |
| **Chat History**     | recent messages / `continueChat` 要約 | chat 継続時                      | 既存件数・文字上限 + **総入力推定**         | overflow 時 **Doc 側だけ譲歩**                   |
| **Canvas Body**      | 編集対象本文                              | Canvas **編集本体**のみ             | 総入力推定に含める                     | Web 検索 / 分析段は L1 なし                        |
| **Tool Definitions** | `web_search` / canvas tools         | 必要経路のみ                        | 総入力推定に含める                     | L1 とは別管理                                   |
| **Tool Results**     | Web 検索結果など                          | 必要最小限                         | 既存 URL allowlist / 要約方針       | **raw 大量投入禁止**                             |


実装者は新経路追加時に **上表の行を増やすか、明示的に ❌ とするか** を決めてから配線する。

### Context Fail 対策

[記事で整理される失敗パターン](https://qiita.com/yuji-arakawa/items/da4d5eec968b92ebc26d)を本機能に映射する。


| 失敗パターン                                          | 本機能での対策                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Context Clash**（矛盾する指示の衝突）                    | L1 は **管理者管理 Doc のみ**（MVP で template 別 Doc は ❌）。Doc 境界・`updated_at` を L1 見出し付近で明示。L1 / L2 を block 分離 |
| **Context Pollution / Distraction**（ノイズで本題が薄れる） | **allowlist 経路のみ** L1 注入。GSC / Ads / Canvas 分析には入れない。L1 は budget trim + 長尺ガード                             |
| **Context Confusion**（境界不明でモデルが混乱）              | L1 / L2 / 履歴要約 / Web 結果を **block 名・順序・区切り** で分離（2 ブロック system + messages 役割）                              |
| **Context Poisoning**（汚染された記憶が正本化）              | 下記 **Memory Write Policy**。**user 入力・LLM 出力を共通 Doc 用 `prompt_templates` 行に書かない**                                  |


### Memory Taxonomy（記憶の種類）

「全部メモリ」と呼ぶと L1 / 事業者情報 / 履歴が混線する。GrowMate での対応:


| 種類                              | GrowMate での対応                    | 書き込み主体    | 注入方法                   |
| ------------------------------- | -------------------------------- | --------- | ---------------------- |
| **Semantic Memory**（意味・ナレッジ）    | `prompt_templates` の共通 Doc 専用行 | **管理者のみ** | L1 hot layer（M①）       |
| **Procedural Memory**（手順・型）     | `prompt_templates`               | 管理者       | L2 template            |
| **Episodic Memory**（会話の出来事）     | chat history / `continueChat` 要約 | ユーザー会話    | messages + system 追記要約 |
| **User Fact Memory**（ユーザー固有の事実） | business info / service          | ユーザー登録    | L2 変数（`{{company}}` 等） |


**原則**: カオルさんの考え方（Semantic）とユーザーの事業者情報（User Fact）と会話履歴（Episodic）を **コード上もプロンプト上も混ぜない**。

### Memory Write Policy（必須）

**Context Poisoning 防止**。LLM 出力やユーザー発話がいつの間にか「カオルさんの正本」に混入する事故を防ぐ。


| ルール          | 内容                                                                   |
| ------------ | -------------------------------------------------------------------- |
| 自動書込禁止       | 共通 Doc 用 `prompt_templates` 行へ user 入力・LLM 応答・Web 検索結果を自動保存しない |
| 更新経路         | `prompt_templates.content` の共通 Doc 専用行更新は **admin 操作によるテキスト保存のみ** |
| LLM 要約の L1 化 | **MVP 外**。将来 `content_summary` 等を導入する場合も **管理者承認必須**                 |
| 保存失敗         | 既存 content を維持。UI にバリデーションエラーを表示する                                      |
| 監査           | 生成ログに L1 全文を毎回出さない（`toSystemPromptDebugString` はデバッグ限定）              |


### Progressive Disclosure（段階的開示）

[記事の「必要なときだけ必要な指示を読む」](https://qiita.com/yuji-arakawa/items/da4d5eec968b92ebc26d)考え方は有効だが、**クライアント要件は「指定 Doc ありきで毎回注入」** のため MVP では全面オンデマンド化しない。


| フェーズ    | 方針                                                              |
| ------- | --------------------------------------------------------------- |
| **MVP** | L1 hot layer を **毎回** 注入（`trimKnowledgeForGeneration` で上限内）     |
| **将来**  | Doc 長文化時に `content_summary` / RAG / Doc セクション別 retrieval（§将来拡張） |
| **要合意** | L1 を完全 JIT（モデルが必要時だけ Doc を読む）にする場合は **クライアント合意 + 要件変更** が必要     |


---

### 方針

1. `/admin/prompts` に **「カオルさん共通 Doc」** セクションを追加（`**/admin/prompts` 統合は維持。UI は常時フル展開にしない** — 下記 §管理 UI 実装方針）。
2. 管理者が入力した本文を `prompt_templates.content` の共通 Doc 専用行に保存する。
3. `**paid`/`admin` の** chat 系生成時に `**buildKnowledgeSystemBlocksForRequest()`** で L1 と L2 を分離。Anthropic は 2 ブロック system で渡す。
4. 管理者はテンプレに変数を追記する必要なし（既存プロンプト編集 UI はそのまま）。

### 管理 UI 実装方針（UX）

**3 層の整理**（混同しない）:


| 層        | 内容                                                   |
| -------- | ---------------------------------------------------- |
| クライアント要件 | 管理者が共通 Doc を設定できること                                  |
| 実装方針     | `/admin/prompts` に統合（別画面 `/admin/knowledge` は MVP 外） |
| UI 表現    | Doc 管理 UI を **常時フル展開しない**（折りたたみ + コンパクト一覧/編集）        |


> `/admin/prompts` 上部に「カオルさん共通 Doc」セクションを追加する。ただし、日常作業であるプロンプト編集を妨げないよう、**初期表示は折りたたみまたはコンパクトサマリー**とする。MVP は専用テンプレート 1 行の本文編集に絞り、最終保存日時・エラー有無・token 詳細を表示する。

**MVP 推奨（A + C）**:


| 状態            | 表示                                                     |
| ------------- | ------------------------------------------------------ |
| **折りたたみ（初期）** | `保存済み / 未設定` / 最終保存日時 / エラー有無（あればバッジ）のみ             |
| **展開時**       | 専用テンプレート 1 件。主列: 表示名・最終保存・状態アイコン                    |
| **行展開 / 編集**  | 本文 textarea・保存・token/文字数警告・バリデーションエラー               |
| **追加**        | 追加行は作らない。複数の論理 Doc は本文内の見出し・区切りで管理                  |


**MVP 外（将来）**: ページ内タブ（「プロンプト」｜「共通 Doc」）— Doc 管理頻度が高くなったら検討。更新頻度が低い前提では折りたたみで十分。

**growmate-ui-ux**: 管理画面は情報密度高めでよいが、**段階的開示**を優先。GSC / Google Ads タブ編集中も Doc セクションは折りたたみ状態でプロンプト編集を主役にする。

### 管理 UI イメージ

```
/admin/prompts
┌─ プロンプト管理（既存 h1）──────────────────────────────┐

┌─ ▶ カオルさん共通 Doc（折りたたみ・初期）───────────────┐  ← 日常はここだけ
│   保存済み · 最終保存 2026-06-16 · ⚠ エラー 0             │
└──────────────────────────────────────────────────────────┘

┌─ ▼ カオルさん共通 Doc（展開時）──────────────────────┐
│ 表示名              最終保存      状態        [▼]          │
│ カオルさん共通 Doc   06-16 14:30  ✅ 保存済み  [▼]          │
│   └─ 行展開: 本文 textarea [保存] token 12,400 / budget ...│
└──────────────────────────────────────────────────────────┘

┌─ 既存: カテゴリ / テンプレ選択 / プロンプト本文 ───────────┐
│ （現行 PromptsClient と同じ — 常に主表示）                 │
└──────────────────────────────────────────────────────────┘
```

GSC / Google Ads カテゴリでは Doc 融合対象外（注入経路も対象外）。

### 運用セットアップ（初回・インフラ）


| #   | 作業                                         | 備考                                           |
| --- | ------------------------------------------ | -------------------------------------------- |
| 1   | `prompt_templates` に共通 Doc 専用行を用意          | 既存 RLS（管理者のみ）を利用                           |
| 2   | `/admin/prompts` で共通 Doc セクションを表示          | 別画面 `/admin/knowledge` は作らない                  |
| 3   | 管理者が本文を入力して保存                            | Google Docs API / Vercel env / SA 共有は不要       |
| 4   | `paid` / `admin` の対象生成で L1 注入を確認          | `trial` は L2 のみ                              |


本機能専用の Google 系環境変数は不要。`.env.example` に `GOOGLE_DOCS_*` は追加しない。

### MVP スコープ


| 区分                    | 内容                                                                                    | やる / やらない                                                              |
| --------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 管理 UI                 | `/admin/prompts` 統合 + **折りたたみ Card** + 本文編集 + 保存・確認ダイアログ                                      | ✅                                                                      |
| 管理 UI                 | 別画面 `/admin/knowledge` / **常時フル展開 Doc フォーム**                                          | ❌                                                                      |
| Google Docs           | URL → document ID → Docs API 取得                                                             | ❌ **仕様変更で廃止**                                                       |
| テキスト保存              | 管理者入力 → `prompt_templates.content` の共通 Doc 専用行へ保存                                      | ✅                                                                      |
| L1 注入ロール              | `paid` / `admin` のみ（`hasPaidFeatureAccess`）                                           | ✅                                                                      |
| 注入 allowlist          | `buildKnowledgeSystemBlocksForRequest` + model/経路 allowlist。`**llmService` フック禁止**    | ✅                                                                      |
| token 推定              | `estimateTextTokens()`（MVP ヒューリスティック）                                                 | ✅                                                                      |
| 認証                    | 管理者権限 + Supabase service role                                                            | ✅                                                                      |
| 融合                    | `buildKnowledgeSystemBlocksForRequest`（allowlist + ロール）+ `trimKnowledgeForGeneration` | ✅                                                                      |
| Doc メモリ層              | M② 全文保存 + M① **共通 budget（15,000 token）** + step7 ガード                                  | ✅                                                                      |
| Anthropic cache       | L1 Doc ブロックのみ `cache_control: ephemeral`（2 ブロック system）                               | ✅ 現ブランチで一部実装済み。DB 保存化後に本番検証 |
| Anthropic Memory Tool | モデル主導 JIT（`/memories`）                                                                | ❌ 不採用（下記スコープ外）                                                         |
| DB                    | 既存 `prompt_templates` の共通 Doc 専用行                                                       | ✅                                                                      |
| 複数 Doc                | MVP は単一行。複数の論理 Doc は `content` 内の見出し・`---` で区切る                               | ✅                                                                      |
| バリデーション               | 警告閾値（UI）+ 保存 **ハード拒否**（部分保存禁止。下記 §M② 保存方針）                                             | ✅                                                                      |
| `businessInfo=null`   | L1 注入対象（`paid`/`admin` + allowlist）なら **事業者情報の有無に依存しない**                              | ✅                                                                      |
| コピペ直接入力               | 本番保存方式として採用                                                                          | ✅                                                                      |
| テンプレ別 Doc             | 制作物別の専用 `prompt_templates` 行を追加する方式                                         | ❌ 将来                                                                   |
| RAG                   | ベクトル検索                                                                                | ❌                                                                      |
| Canvas Doc 注入         | **編集本体**（`getBlogCreationTemplatePrompt` 経由）のみ ✅                                      | Web 検索・分析用 system には ❌                                                 |
| GSC / Google Ads      | 注入対象外                                                                                 | ❌                                                                      |


### DB 保存（既存 `prompt_templates`）

```sql
-- 新規テーブルは作らない。既存 prompt_templates に専用行を追加/更新する。
INSERT INTO prompt_templates (name, display_name, content, variables)
VALUES (
  'global_knowledge_source',
  'カオルさん共通 Doc',
  '',
  '[]'::jsonb
)
ON CONFLICT (name) DO NOTHING;
```

- MVP: `name = 'global_knowledge_source'` の 1 行を L1 正本とする。`content` が空なら L1 は注入しない。
- `source_url` / `last_fetched_at` / `last_fetch_error` は MVP スキーマに作らない。
- 複数の論理 Doc が必要な場合は、同一 `content` 内で Markdown 見出し・`---` 区切りを使う。

### MVP ユーザーフロー

```
[初回] prompt_templates に共通 Doc 専用行を用意 → /admin/prompts に共通 Doc セクションを表示
         ↓
管理者: /admin/prompts で Doc セクションを展開 → 本文入力 → 保存
         ↓
管理者: 同画面で従来どおりテンプレ（プロンプト）を編集・保存
         ↓
有料ユーザー（`paid` / `admin`）: 通常どおり生成
         → allowlist 合格時 [L1 共通 Doc 群] + [L2 テンプレ + 事業者変数] が system prompt に載る
         （`trial` は L2 のみ。trial 含めるかは要クライアント確認）
         ↓
Doc 編集後: 管理者が本文を保存（生成 API は叩かない）
```

### MVP 工数

仕様どおり（2 ブロック cache・allowlist 全経路・総入力 step7 ガード・Canvas 編集本体のみ注入）まで含める場合の **理想人日**。カレンダーは下記「開発計画目安」を参照。


| 項目                                                                                | 残作業目安          |
| --------------------------------------------------------------------------------- | --------------- |
| `prompt_templates` 共通 Doc 専用行の seed / 取得処理                                  | 0.5日            |
| `knowledge_sources` / Google Docs / localStorage override 系の削除・差し替え             | 0.5〜1日          |
| Server Action + `/admin/prompts` UI の DB 保存化（本文保存・バリデーション・未保存表示）             | 1〜1.5日          |
| 既存 L1 注入配線の保存元差し替え + 2 ブロック cache の実測確認                              | 0.5〜1日          |
| テスト + quality-gate（trim / role / allowlist / 保存拒否 / placeholder / cache / 長尺 QA） | 1〜1.5日          |
| **残作業合計**                                                                       | **約 3〜5 理想人日** |


**開発計画目安（カレンダー）**: Google Docs 初回設定・SA 共有・Vercel env 待ちは不要になった。現ブランチの実装を前提に、DB 保存化・不要実装削除・長尺 QA を含め **1週間前後** で見積もる。

**重い理由（要約）**: 既存が `systemPrompt: string` 前提（`llmService` / `anthropic/stream` / Canvas stream / LP 後段 `replaceVariables`）。入口を `buildKnowledgeSystemBlocksForRequest` + `toAnthropicSystemBlocks` に寄せる **横断配線** が工数の中心。

---

## カオル Doc メモリ層（コンテキスト管理・必須）

共通 Doc が長文化すると **コンテキストオーバーは確実**。対策は **カオル Doc レイヤーだけ** に閉じ込める。テンプレ・事業者情報・チャット履歴のリファクタは本件スコープ外。

### 前提


| 要因      | 備考                                         |
| ------- | ------------------------------------------ |
| ベースモデル  | `claude-sonnet-4-6`（コンテキスト 1M）             |
| カオル Doc | NotebookLM ソース並みに **長文化しやすい**（最大リスク）       |
| テンプレ    | LP・ブログ step は既に大きい                         |
| チャット履歴  | step7 で **青天井**（Doc 管理では解決しない）             |
| 出力予約    | step7: `maxTokens: 64000`（`MODEL_CONFIGS`） |


**原則**: DB には全文（**M②**）、LLM には **budget 内の断片のみ（M①）**。L2 テンプレ全文は切らない。

### メモリ4タイプ（カオル Doc に限定）

> **記号**: 以下 **M①〜M④** は AI メモリ分類。**L1/L2 注入レイヤー** や **Anthropic Memory Tool** とは別体系。


| タイプ              | 本機能での対応                                                                                    | 採否         |
| ---------------- | ------------------------------------------------------------------------------------------ | ---------- |
| **M①** コンテキスト内   | `trimKnowledgeForGeneration()` — **共通注入 budget（15,000 token）** 内のみ                         | **採用**     |
| **M②** 外部メモリ     | `prompt_templates.content` の共通 Doc 専用行 — 管理者が保存した共通 Doc テキストの **全文**（保存時に切り詰めない） | **採用**     |
| **M③** 再学習       | —                                                                                          | **不採用**    |
| **M④** キャッシュ（KV） | L1 Doc ブロックのみ `cache_control: ephemeral`（[付録 A](#付録-a-anthropic-prompt-caching現状と-mvp-差分)） | **採用（推奨）** |


### 2層モデル（M② コールド / M① ホット）

```
管理者入力の共通 Doc テキスト
    ↓ /admin/prompts で保存
[M② コールド] prompt_templates.content（全文・切り詰め保存禁止）
    ↓ そのまま取得
[M① ホット]   trimKnowledgeForGeneration(raw)  ← 共通 budget 15,000 token
    ↓ budget 内に切り詰め（注入時のみ。step7 ガードでさらに縮小可）
buildKnowledgeSystemBlocksForRequest(L2, { modelKey, userRole })
    ↓
LLM system = Block A(L1, cache) + Block B(L2)
```

**L2 テンプレ・brief・履歴はこのパイプラインに入れない。** オーバー時に削るのは **L1 Doc ホット層（M①）だけ**。

### M② 保存方針（全文 vs 上限）


| 層                | 方針                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M② `content`** | 管理者が入力した共通 Doc テキストを **そのまま全文保存**。NotebookLM 相当の長文を想定し、**保存時 trim は禁止**（M② の意味が崩れるため）                                                                    |
| **M① 注入**        | 生成時のみ `trimKnowledgeForGeneration()` で budget 内に切り詰め                                                                                                              |
| **UI 警告**（保存後も可） | `content` **20,000字** — step7 overflow リスクの目安（バッジ表示）                                                                                           |
| **保存ハード拒否**      | `content` **150,000字** 超 → `**content` を更新しない**、エラー理由を返す（部分保存・切り詰め保存 **禁止**）。**既存 `content` は維持**（下記 §保存拒否時の既存 content） |


定数は `knowledgeBudget.ts` 等に集約。8,000/20,000 は **警告のみ**、**保存上限ではない**。

### 保存拒否時の既存 content（運用ポリシー）

50,000 字超等で保存が拒否された場合の **生成への影響** を明示する。


| 項目                 | 方針                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------- |
| DB `content`       | **更新しない**（拒否前の全文を **維持**）                                                                     |
| 専用行               | **削除しない**。空本文なら L1 未注入として扱う                                                                 |
| エラー理由             | Server Action から返し、管理 UI に **エラー表示**                                                        |
| 生成時                | **維持されている既存 `content` を引き続き M② として使用**（生成を止めない）                                               |
| 管理 UI              | エラー表示と未保存状態を明示。新規 Doc で `content` 空のまま拒否された場合のみ L1 空（テンプレのみ）                                 |


**意図**: 保存失敗で突然 Doc が消える運用事故を防ぐ。管理者は Doc 分割または文字数削減後に再保存する。

### Doc 注入 budget（MVP — 全 chat 系で統一）

MVP では **generation_type 別の細分化は行わない**。chat 系（広告・LP・ブログ step1〜7・タイトル系・Canvas 編集本体）は **同一 budget** を使う。


| 定数                                          | 値                | 備考                                    |
| ------------------------------------------- | ---------------- | ------------------------------------- |
| `DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS` | **15,000 token** | 全 chat 系共通。`estimateTextTokens()` で判定 |


**統一の理由**: 種別別 budget の差は実測前の過剰設計。**15,000 token ≒ 2〜3 万字**（日本語目安）を M① ホット層の上限とし、Lite 相当の「Doc ありき」を満たしやすくする。それでも M② 全文（最大 5 万字/Doc）の **全部は載らない** — 超過分は先頭優先 trim。overflow 対策の本体は **step7 ガード**（下記）。`maxTokens`（出力上限）は `MODEL_CONFIGS` ごとに維持し、本 budget とは別物。

**将来**: 実測で広告だけ Doc を薄くしたい等が判明したら `KNOWLEDGE_INJECTION_BUDGETS` への再分割または admin 設定化を検討（[将来拡張](#将来拡張doc-メモリ層のみ)）。

定数配置: `src/lib/knowledgeBudget.ts`（または `constants.ts` に export。MVP は1ファイルに集約可）。

### `trimKnowledgeForGeneration()`（M① ホット層）

```typescript
/** 全 chat 系共通（MVP） */
export const DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS = 15000;

function trimKnowledgeForGeneration(
  mergedContent: string,
  budgetTokens: number = DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS
): string {
  // 1) estimateTextTokens(mergedContent) が budget 以内 → そのまま返す
  // 2) 超過 → 共通 Doc 本文を先頭優先で載せ、見出し/区切り境界で切る
  //    同一 Doc 内は先頭から（見出し行 ## は可能な限り残す）
  // 3) 切り詰め発生時は server ログ（将来: メトリクス）
  return trimmed;
}
```

step7 ガードで budget を **50% に縮小**するときは、同関数に `budgetTokens: Math.floor(DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS / 2)` を渡して再 trim する。

**禁止**: テンプレ側の切り詰め、履歴の自動削除（本レイヤーの責務外）。

### step7 / 長尺セッション ガード（コンテキスト溢れの主防御）

**step7 は実測必須**（出力 64K 予約＋履歴＋L2 テンプレで最タイト）。40K/60K 判定は **融合後 system prompt だけでは不足** — `chatService.continueChat` が履歴要約を system に連結するため。

**判定対象（送信直前の総入力推定 token）**:

```
estimateRequestInputTokens({
  systemBlocks,           // L1 Block A + L2 Block B（toSystemPromptDebugString 相当でも可）
  historySummary,         // continueChat の「【直前までの会話要約】」
  recentMessages,         // 直近履歴（件数・文字数制限後）
  userMessage,            // 今回の user 入力
  toolDefinitions,        // Canvas Web 検索段など tools 定義（該当時）
  editorBody,             // Canvas 編集対象本文（該当時）
})
```

各要素は `estimateTextTokens()` で合算。出力 `maxTokens` 予約は **別途** API/モデル側に委ね、MVP ガードでは入力合算のみを見る。


| 条件                         | 動作                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------- |
| 総入力推定が **40K token 超**（目安） | `trimKnowledgeForGeneration(..., budgetTokens: 7500)` で L1 再 trim（共通 budget の **50%**） |
| 総入力推定が **60K token 超**（目安） | L1 Doc 注入 **スキップ**（L2 テンプレ + brief + 要約 + 履歴のみ）。サイレント失敗禁止 — ログ                         |
| リリース前                      | 長尺セッション（step1〜6 履歴あり）で **手動 QA**                                                       |


**適用経路**: 主に `blog_creation_step7` と Canvas 編集本体。step1〜6 でも履歴が長い場合は同関数で判定可（MVP は step7 必須、他は任意ログのみでも可）。

履歴オーバーそのものは Doc メモリ層では解決しない。本ガードは **L1 Doc 側の譲歩** のみ。通常 step（1〜6）・広告・LP は共通 15,000 token trim のみで足りる想定。

### Anthropic cache 分離（M④・MVP 推奨・**未実装**）

現状の Prompt Caching 利用状況・限界・将来検討は **[付録 A](#付録-a-anthropic-prompt-caching現状と-mvp-差分)** を参照。

**前提**: 単一 string の `fuseGlobalKnowledgeDocs()` では 2 ブロック cache を実現できない。MVP では `**buildKnowledgeSystemBlocksForRequest()` が生成入口の正本**（内部で `buildKnowledgeSystemBlocks` を呼ぶ。下記 §注入レイヤー）。

`llmService` および stream route の system を **2 ブロック** に分ける（Doc 更新時のみ Block A の cache 失効）:

```
Block A: L1 カオル Doc ホット層  … cache_control: ephemeral（M④）
Block B: L2 テンプレ + brief 置換後 … cache なし（ユーザーごとに変動）
```

L1 Doc は **paid/admin 間で同一内容**（ユーザー別ではない）→ Block A の cache 効率が最も高い。L2 テンプレ・brief 変更で L1 Doc cache を切らない。

### 管理 UI（Doc メモリの可視化）

`/admin/prompts` Doc セクション（**展開時・行展開時**）に表示:


| 表示    | 一覧行（常時）                    | 行展開（詳細）                              |
| ----- | -------------------------- | ------------------------------------ |
| 共通 Doc | 表示名・最終保存・状態（✅/⚠/❌） | 文字数 / 推定 token vs 20,000字・150,000字警告 |
| 空本文    | サマリー行に未設定表示              | L1 未注入になる旨                             |
| 注入    | —                          | budget 15,000 対比・trim される旨           |
| step7 | 合計が大きいとき一覧にバッジ             | overflow リスク説明                       |
| エラー   | エラー行に ⚠ アイコン               | 保存拒否理由 + 未保存状態                       |


折りたたみヘッダーには **保存済み/未設定・最終保存・エラー有無** のみ（token 詳細は行展開まで出さない）。

保存時に計算。**生成時のサイレント切り詰めだけ** にしない。

### 本レイヤーのスコープ外


| 対象                        | 理由                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic Memory Tool** | [クライアント側 `/memories` ツール](https://platform.claude.com/docs/ja/agents-and-tools/tool-use/memory-tool)。モデルが **必要時のみ** ファイルを読む JIT 方式。本件は **L1 Doc を毎回サーバーが強制注入** する要件と矛盾。M②→M① の思想は同型だが、実装は **サーバー主導 trim + fuse** が正。ツール往復によるレイテンシ・非決定論も不要 |
| `prompt_templates` の短縮    | 別課題                                                                                                                                                                                                                                       |
| 事業者情報（brief）              | 別課題                                                                                                                                                                                                                                       |
| チャット履歴のウィンドウ化             | step7 既存リスク。将来別チケット                                                                                                                                                                                                                       |
| RAG / ベクトル検索              | MVP 不採用。Doc オーバーが常態化したら **Doc レイヤーのみ** Phase 2 で検討                                                                                                                                                                                        |
| 保存毎 LLM 要約                | コスト・ブレ・遅延。**Memory Write Policy** により L1 自動要約は MVP 外                                                                                                                                                                                      |
| Context Poisoning         | **Memory Write Policy** — user/LLM 出力の共通 Doc 専用 `prompt_templates` 行への自動書込禁止                                                                                                                                                                         |


### 将来拡張（Doc メモリ層のみ）


| 拡張                                   | 条件                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `content_summary` 列（管理者承認の圧縮版）       | 全文が共通 budget 内に収まらないとき                                                   |
| generation_type 別 budget / admin 設定化 | 実測後に種別差が必要になったとき                                                         |
| Doc 単位 RAG                           | 複数長文 Doc が日常化したとき                                                        |
| **ページ内タブ**（プロンプト｜共通 Doc）             | Doc 管理頻度が高く折りたたみでは足りないとき                                                 |
| **Progressive Disclosure**           | Doc 全文が budget に収まらないとき。**L1 JIT 化はクライアント合意必須**（§Progressive Disclosure） |


---

## 注入レイヤーの設計

### 自動融合（MVP）

```
共通 Doc 専用 `prompt_templates` 行の content
        ↓
getGlobalKnowledgeContent()           ← M② 全文、React cache()
        ↓
trimKnowledgeForGeneration()          ← M① ホット層（共通 15,000 token。step7 ガード時 7,500）
        ↓
buildKnowledgeSystemBlocksForRequest(L2, { modelKey, userRole, budgetTokens? })
        ↓
anthropic/stream, llmService:
  // knowledgeBlock が空なら Block A を作らない（空 + cache_control は渡さない）
  system: knowledgeBlock.trim()
    ? [
        { text: knowledgeBlock, cache_control: ephemeral },  // Block A = L1
        { text: templateBlock },                             // Block B = L2
      ]
    : [{ text: templateBlock }]                             // L2 のみ
```

```typescript
// server-only
type KnowledgeSystemBlocks = {
  /** L1: trim 済み Doc。Anthropic Block A + M④ cache 対象 */
  knowledgeBlock: string;
  /** L2: テンプレ + brief 置換後の本文。Block B（cache なし） */
  templateBlock: string;
};

const getGlobalKnowledgeContent = cache(async (): Promise<string> => {
  // name='global_knowledge_source' の content を取得（M② 全文。空なら L1 なし）
  return merged ?? '';
});

async function buildKnowledgeSystemBlocks(
  templateBlock: string,
  options?: { budgetTokens?: number }
): Promise<KnowledgeSystemBlocks> {
  const raw = await getGlobalKnowledgeContent();
  const hot = trimKnowledgeForGeneration(
    raw,
    options?.budgetTokens ?? DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS
  );
  if (!hot.trim()) {
    return { knowledgeBlock: '', templateBlock };
  }
  const knowledgeBlock = [
    '## カオルさんの考え方・ノウハウ（有料 Pro ユーザー共通）',
    '',
    hot.trim(),
  ].join('\n');
  return { knowledgeBlock, templateBlock };
}

/** 生成入口から呼ぶ正本。allowlist + ロール判定を内包 */
async function buildKnowledgeSystemBlocksForRequest(
  templateBlock: string,
  options: { modelKey: string; userRole: UserRole; budgetTokens?: number }
): Promise<KnowledgeSystemBlocks> {
  if (!hasPaidFeatureAccess(options.userRole)) {
    return { knowledgeBlock: '', templateBlock };
  }
  if (!isKnowledgeInjectionModel(options.modelKey)) {
    return { knowledgeBlock: '', templateBlock };
  }
  return buildKnowledgeSystemBlocks(templateBlock, {
    budgetTokens: options.budgetTokens,
  });
}

/** Anthropic Messages API 用 system 配列（空 Block A 禁止） */
function toAnthropicSystemBlocks(blocks: KnowledgeSystemBlocks) {
  if (!blocks.knowledgeBlock.trim()) {
    return [{ type: 'text' as const, text: blocks.templateBlock }];
  }
  return [
    {
      type: 'text' as const,
      text: blocks.knowledgeBlock,
      cache_control: { type: 'ephemeral' as const },
    },
    { type: 'text' as const, text: blocks.templateBlock },
  ];
}

/** DB 保存・デバッグ用の単一 string（LLM 送信には使わない） */
function toSystemPromptDebugString(blocks: KnowledgeSystemBlocks): string {
  if (!blocks.knowledgeBlock.trim()) return blocks.templateBlock;
  return [blocks.knowledgeBlock, '---', blocks.templateBlock].join('\n\n');
}

/** @deprecated LLM 経路では使用しない。デバッグログ用に残す場合のみ */
function fuseGlobalKnowledgeDocs(templateContent: string, hotKnowledge: string): string {
  // 旧: 単一 string。2 ブロック cache と LP 後段 replaceVariables と両立しない
  ...
}
```

### 配線原則（テンプレ変数置換 vs L1 Doc）

**鉄則: L1（Doc）はいかなる `replaceVariables` / `replaceTemplateVariables` の対象外。**


| 順序  | 処理                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | L2 テンプレ本文を解決（`prompt_templates` / `generate*Prompt`）                                                                                           |
| 2   | L2 に対してのみ `replaceTemplateVariables` / `PromptService.replaceVariables`                                                                        |
| 3   | `**buildKnowledgeSystemBlocksForRequest(L2, { modelKey, userRole })`** — allowlist + ロール判定後に L1 付与。長尺ガードで budget 縮小時は `{ budgetTokens: 7500 }` |
| 4   | stream route / `llmChat` で `toAnthropicSystemBlocks()` 経由の 2 ブロック system を Anthropic に渡す                                                       |


### string systemPrompt 前提との分離（実装漏れ防止）

現行コードは **LLM 送信も DB 保存も `string` の `systemPrompt` 1 本** 前提:


| 箇所                          | 現状                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `chatService.startChat`     | `systemPrompt: string` → `llmChat` に `{ role: 'system', content: systemPrompt }`（L53, L78） |
| `chatService.continueChat`  | 同上（L175, L198 `finalSystemPrompt`）                                                         |
| `llmService.llmChat`        | `systemPrompt?: string` → 単一 `cache_control` ブロック（L37, L115-120）                           |
| `anthropic/stream/route.ts` | `getSystemPrompt()` の string を単一 system ブロックに載せる                                           |


**MVP 方針**: 型を2系統に分ける。


| 用途               | 型                                                   | 使い所                                               |
| ---------------- | --------------------------------------------------- | ------------------------------------------------- |
| **LLM 送信**       | `AnthropicSystemBlock[]`（`toAnthropicSystemBlocks`） | stream route、`llmService`（シグネチャ拡張または blocks 専用入口） |
| **DB / ログ / 互換** | `toSystemPromptDebugString(blocks)`                 | 既存 `string` API を壊さない箇所の保存・デバッグのみ                 |


`chatService` / `modelHandlers` が string のまま LLM まで届ける経路（LP 等）は、**stream 入口または `llmChat` 直前**で `buildKnowledgeSystemBlocksForRequest` → `toAnthropicSystemBlocks` に寄せる。string 連結で L1 を載せてから `startChat` に渡す実装は **禁止**。`**llmService.llmChat` 内での L1 自動注入は禁止**（allowlist 経由のみ）。

**LP 経路の注意（現行コード）**: `modelHandlers.ts` の `handleLPDraftModel` / `handleContinue`（`lp_draft_creation`）は `getSystemPrompt` 取得 **後** に `PromptService.replaceVariables(systemPrompt, variables)` を実行している（例: L166-167, L279-280）。  
Doc を L2 確定前に L1 と string 融合すると、Doc 内の `{{company}}` 等が意図せず置換される。**MVP では L1 付与を handler 後段（または stream 入口）に移し、replace 対象は L2 のみ**とする。

`**replaceTemplateVariables` は同期のまま**。DB アクセスは `getGlobalKnowledgeContent()` のみ（async は `buildKnowledgeSystemBlocksForRequest` 内）。

`**businessInfo=null`**: 対象ロール（`paid`/`admin`）かつ allowlist 合格時は、L2 の事業者ブロック除去後も **L1 Doc 注入を実行**（事業者情報未登録でも L1 は載せる）。

### 適用対象経路

**前提**: 下表の ✅ 経路のみ `buildKnowledgeSystemBlocksForRequest` を呼ぶ。`isKnowledgeInjectionModel(modelKey) && hasPaidFeatureAccess(role)` の両方を満たすこと。


| 経路                              | MVP | 備考                                                         |
| ------------------------------- | --- | ---------------------------------------------------------- |
| ブログ step1〜7（`anthropic/stream`） | ✅   | allowlist model + `paid`/`admin`                           |
| `generateTitleMetaPrompt`       | ✅   | `blog_title_meta_generation`                               |
| 広告（`ad_copy_creation`）          | ✅   | 同上                                                         |
| LP（`lp_draft_creation`）         | ✅   | **L2 のみ** `modelHandlers` で replace → その後 L1 付与            |
| Canvas **編集本体**                 | ✅   | 経路 allowlist（編集段のみ）。model は step 系                         |
| Canvas **Web 検索** 段             | ❌   | allowlist 外                                                |
| Canvas **分析** 段                 | ❌   | allowlist 外                                                |
| GSC / Google Ads                | ❌   | allowlist 外（`google_ads_ai_evaluation`, `gsc_insight_*` 等） |
| `trial` / `unavailable` ユーザー    | ❌   | ロール判定で L1 スキップ（chat 自体は trial 可）                           |


**Canvas 詳細**（`app/api/chat/canvas/stream/route.ts`）:


| 段                                        | 行付近                         | Doc 注入                  |
| ---------------------------------------- | --------------------------- | ----------------------- |
| Web 検索                                   | ~559                        | ❌                       |
| Canvas 編集（`apply_full_text_replacement`） | ~663 `finalSystemPrompt`    | ✅ L1 + テンプレ +（任意）Web 結果 |
| 編集分析                                     | ~930 `analysisSystemPrompt` | ❌                       |


### 読み取り権限

- **管理 CRUD**: 管理者 RLS（`prompt_templates` 同型）
- **生成時**: Service Role（`withServiceRoleClient`）。server-only。

---

## 既存資産マッピング


| 資産                                    | 活用                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `app/admin/prompts/PromptsClient.tsx` | Doc セクション追加のベース                                                                                  |
| `validateAdminAccessOrError`          | 同一 admin ガード                                                                                     |
| `prompt_templates` RLS パターン           | 共通 Doc 専用行の管理者保存にそのまま利用                                                                  |
| `getTemplateByName` + React `cache()` | `getGlobalKnowledgeContent` のパターン                                                                |
| Google 連携系ファイル                         | 本機能では使わない（GSC / Ads と独立）                                                                         |
| `src/types/user.ts`                   | `hasPaidFeatureAccess(role)` — L1 注入ロール判定                                                        |
| `chatService.ts`                      | `continueChat` 履歴要約 → ガードの `historySummary`。blocks 分離後 DB 用 string は `toSystemPromptDebugString` |
| `llmService.ts` / stream routes       | `toAnthropicSystemBlocks` → Anthropic system 配列（L1 cache 分離）。**L1 注入はここでは行わない**                  |


**新規依存**: Google Docs 取得を廃止したため `googleapis` は不要。

---

## 将来拡張（MVP 後）


| 拡張                            | 条件                     | 工数目安  |
| ----------------------------- | ---------------------- | ----- |
| テンプレ別 Doc | カオルさんが制作物別 Doc を運用するとき。制作物別の専用 `prompt_templates` 行を追加する | +2〜3日 |
| インポート補助                         | 将来 Google Docs や Markdown ファイルから手動インポートしたくなったとき | +2〜3日 |


---

## リスク／難所


| リスク                      | 対策                                                                        |
| ------------------------ | ------------------------------------------------------------------------- |
| 管理 UI の縦長化・ノイズ           | **折りたたみ Card + コンパクト一覧**（§管理 UI 実装方針）。常時フル展開禁止                            |
| 共通 Doc の長文化               | **Doc メモリ層**（budget + trim + UI 警告）。テンプレは切らない                             |
| 表・画像の情報落ち                | Doc はテキスト中心運用を推奨。必要な情報は Markdown 化して保存する                                |
| 誤内容の保存                    | 保存確認ダイアログ + 未保存差分表示                                                     |
| Doc 更新の反映遅れ              | 保存後の次回生成から反映。生成は DB の保存内容のみ参照                                           |
| Lite との内容乖離              | 運用で Doc 正本を Lite NotebookLM と揃える                                          |
| 保存拒否後の既存 content 混乱      | エラー表示 + 未保存状態を明示し、既存 `content` は維持                                      |
| GSC/Ads への誤注入            | allowlist + `**llmService` フック禁止**                                        |
| Context Poisoning        | **Memory Write Policy** — 共通 Doc 専用 `prompt_templates` 行への自動書込経路を作らない |
| trial への Doc 有無          | 要クライアント確認。現計画は除外                                                          |
| LP 後段 `replaceVariables` | L1 を replace 対象外にし、handler **後** に `buildKnowledgeSystemBlocksForRequest` |
| step7 コンテキスト溢れ           | **総入力推定** 40K/60K ガード + 長尺セッション実測 QA                                      |


---

## 推奨着手順

1. `prompt_templates` 共通 Doc 専用行 + 取得処理
2. `/admin/prompts` UI（Doc セクション + 本文保存 + token 警告）
3. Server Action（管理者 CRUD・本文保存・保存拒否時の既存 content 維持）
4. Doc メモリ層 + `buildKnowledgeSystemBlocksForRequest`（allowlist・ロール）+ 2 ブロック cache
5. step7 長尺セッション実測 QA
6. 手動検証（Lite に近い「カオルさん前提」が Pro 出力に出るか）
7. `npm run lint` / `build` / `knip`

---

## 検証方法

### 手動

- `**paid` / `admin` のみ** L1 融合。`trial` ユーザーは L1 なし（テンプレのみ）  
- `**trial` / `unavailable`**: L1 未注入を確認  
- 共通 Doc 専用行の保存内容が L1 として融合されること
- chat 系生成 → system prompt に Doc 内容 + テンプレ両方  
- 空本文 → L1 未注入
- 保存前後で内容差
- 保存上限超過 → 管理 UI にエラー
- `businessInfo=null` でも `**paid`/`admin` + allowlist 時** L1 融合  
- **step7 長尺セッション**: 総入力推定 overflow 時 L1 縮小 or スキップ（履歴要約込み）  
- **trim**: Doc 全文が 15,000 token 超でも注入が budget 内に収まること（広告・step1・step7 いずれも同一 budget）  
- 既存事業者変数（`{{company}}` `{{persona}}` 等）の回帰  
- GSC/Ads → Doc 未融合  
- **Doc 内 `{{placeholder}}`**: L1 が `replaceVariables` 対象にならず原文のまま載ること  
- **2 ブロック system**: 2 回目以降の生成で `cache_read_input_tokens > 0`（L1 Block A が効いていること）  
- **ハード拒否**: 50,000字超 Doc で保存拒否・`content` 未更新・UI エラー。**既存 content ありなら生成は継続**
- **Memory Write Policy**: user 入力 / LLM 出力 / Web 結果が共通 Doc 専用 `prompt_templates` 行に保存されないこと
- **allowlist**: `google_ads_ai_evaluation` / `gsc_insight_`* 生成に L1 が載らないこと  
- **LP 経路**: `modelHandlers` 後段 replace 後も L1 が付与され、Doc 内 `{{...}}` が brief で置換されないこと

### 単体テスト（最低限）


| 対象                                       | ケース                                                                |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `getGlobalKnowledgeContent()` 相当        | 専用行なし / 空 content / inactive / active content                         |
| `trimKnowledgeForGeneration()`           | budget 内 / 超過時先頭優先切り詰め / `budgetTokens` 上書き（step7 50% 縮小）          |
| `estimateTextTokens()`                   | 空文字 / 日本語混在 / 安全係数 / 境界値                                           |
| `buildKnowledgeSystemBlocksForRequest()` | allowlist 外 → L2 のみ / `trial` → L2 のみ / `paid` + allowlist → L1+L2 |
| `buildKnowledgeSystemBlocks()`           | hot 空 → templateBlock のみ / 非空 → Block A+B / L1 非置換                 |
| `toAnthropicSystemBlocks()`              | knowledgeBlock 空 → Block A なし（cache BP も付けない）                      |
| 長尺ガード                                    | 総入力 40K/60K で L1 縮小・スキップ（historySummary 含む）                        |
| 本文保存 Action                              | ハード上限超過 → 拒否・**既存 content 維持**                                  |
| 2 ブロック assembly                          | knowledgeBlock 非空時のみ Block A に cache BP。空時は templateBlock 1 ブロックのみ |


---

## 実装工数まとめ


| フェーズ      | 内容                                                                      | 理想人日     |
| --------- | ----------------------------------------------------------------------- | -------- |
| **MVP 残作業** | `prompt_templates` 保存化 + 不要実装削除 + Doc メモリ層の保存元差し替え + quality-gate | **3〜5** |
| テンプレ別 Doc | 将来                                                                      | **+2〜3** |


---

## 付録 A: Anthropic Prompt Caching（現状と MVP 差分）

**参照**: [Anthropic プロンプトキャッシング](https://platform.claude.com/docs/ja/build-with-claude/prompt-caching)

GrowMate は Anthropic API の Prompt Caching（**M④**）を **部分的に導入済み**。Doc 融合 MVP では **2 ブロック system 分離** を追加実装する（現状は単一ブロック）。

> **混同注意**: 本付録の Prompt Caching ≠ React `cache()`（`getGlobalKnowledgeContent`）≠ DB 保存（M②）。

### 現状（コードベース・2026-06 時点）


| 項目                 | 状態               | 根拠                                                                                                |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| API 利用             | ✅ 導入済み           | 全 Anthropic 呼び出しで `cache_control: { type: 'ephemeral' }`（5 分 TTL）                                 |
| 方式                 | 明示的キャッシュブレークポイント | トップレベル自動キャッシング（`cache_control` を request 直下に置く方式）は **未使用**                                        |
| 計測                 | ✅ あり             | `src/server/lib/anthropic-token-usage.ts` — `cache_creation_`* / `cache_read_input_tokens` を集計・ログ |
| system 構成          | ⚠️ **単一ブロック**    | L2 テンプレ + brief 置換後を **1 塊** でキャッシュ                                                               |
| 2 ブロック分離           | ❌ 未実装            | L1 Doc / L2 テンプレ+brief の cache 分離なし                                                               |
| マルチターン             | チャット SSE のみ最適化   | 履歴末尾メッセージにも BP。Canvas SSE は system のみ                                                             |
| React Cache との混同注意 | —                | `PromptService.invalidateAllCaches()` は **DB テンプレ取得用**（M④ とは無関係）                                  |


**キャッシュ配置（現行コード）**


| 経路         | ファイル                                     | `cache_control` 付与箇所                                         |
| ---------- | ---------------------------------------- | ------------------------------------------------------------ |
| 非ストリーム LLM | `src/server/services/llmService.ts`      | system ブロック全体                                                |
| チャット SSE   | `app/api/chat/anthropic/stream/route.ts` | system ブロック全体 ＋ 正規化済み履歴の **最後 1 メッセージ**                      |
| Canvas SSE | `app/api/chat/canvas/stream/route.ts`    | 各 API 呼び出しの system のみ（Web 検索 / 編集 / 分析の 3 箇所）。**履歴には BP なし** |


**現状の限界（Doc 導入前でも該当）**

1. **brief / 事業者変数が system 内に混在** — `{{company}}` 等が変わるたび system 全体の cache が無効化される。
2. **最小トークンしきい値** — 現行 `claude-sonnet-4-6`（`constants.ts`）は cache **書き込み** に **1,024 token** 以上が必要（[Anthropic 公式](https://platform.claude.com/docs/ja/build-with-claude/prompt-caching)）。L1 Doc ホット層は通常これを超える想定。
3. **実効 cache の未検証** — 2 ブロック system 導入後、本番ログの `cacheReadInputTokens > 0` を確認（`logTokenUsage` 出力）。

### MVP で追加する設計（本文 §Anthropic cache 分離）

L1 Doc は paid/admin 間で同一・大容量 → **Block A（L1）のみ cache** にしないと brief 変更のたび Doc 分も再課金される。

```
Block A: L1 カオル Doc ホット層  … cache_control: ephemeral（M④）
Block B: L2 テンプレ + brief 置換後 … cache なし（ユーザーごとに変動）
```

### 将来検討（MVP 外）


| 項目                    | 理由                                                                  |
| --------------------- | ------------------------------------------------------------------- |
| トップレベル自動キャッシング        | 20 ブロック超の長会話で手動 BP のルックバック限界を補える。チャット SSE で併用検討                     |
| モデル変更時の再確認            | cache 最小しきい値（現行 Sonnet 4.6 は **1,024 トークン**）と `constants.ts` の整合を確認 |
| Anthropic Memory Tool | 本文 §本レイヤーのスコープ外 参照。MVP 不採用                                          |
