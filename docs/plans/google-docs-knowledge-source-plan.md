# Google Docs 知識ソース機能 実装可否判断 ＆ 段階的ロードマップ

> **Pro 記憶レイヤーの正本（2026-06）**  
> Pro の「考え方・ノウハウ」は **管理者指定のカオルさん共通 Google Doc（全 Pro ユーザー共通）** のみ。ユーザー別哲学プロファイルは **採用しない**。本書が唯一の実装計画。

## Context（なぜ）

### クライアント要望（原文・確定）

> Claude のプロジェクト同様に、指定の Google ドキュメントを読み込むように設定できませんか。  
> ユーザーが個別で設定するのではなく、**あくまでこちら側（管理者）だけで設定**する。NotebookLM のようなやり方。  
> ユーザー側の出力は、**こちらが指定したドキュメントありき**。

**解釈（合意）**

| 項目 | 内容 |
|------|------|
| 誰が設定するか | **管理者のみ**（ユーザー個別設定なし） |
| 何を読むか | 指定 Google ドキュメント（カオルさんの考え方・ノウハウ） |
| 誰に効くか | **全 Pro ユーザー共通** |
| Lite との関係 | NotebookLM 相当を Pro 生成パイプラインに載せる |
| 出力の前提 | 指定 Doc ありき（毎回サーバーが注入） |

### 背景：GrowMate Lite とのギャップ

- **GrowMate Lite** は NotebookLM にカオルさんの考え方・ノウハウを読み込ませた「カオルさん AI」として提供され、回答精度が評価されている。
- **GrowMate Pro** にはそのレイヤーがなく、ユーザーは Pro で明確な回答が得られない場合 Lite に逃げている。
- 本機能は **Lite の NotebookLM 相当（カオルさん共通の「脳」）を Pro の生成パイプラインに載せる** ことが目的。

### 読み込む内容（確定）

- **カオルさん自身の考え方・ノウハウ** をまとめた Google ドキュメント（複数可）。
- **制作物（ブログ／広告／LP）ごとに Doc を分ける要件ではない**（制作物の型は既存 `prompt_templates` が担う）。
- 「運用マニュアル」「禁止表現リスト」などの一般ラベルではなく、**Lite と同種のナレッジ** として扱う。

### 2 レイヤー（Pro の正）

> **記号**: **L1 / L2** = 生成時に連結する **注入レイヤー**（本節）。後述の **M①〜M④（メモリ4タイプ）** とは別体系。

| レイヤー | 内容 | 設定者 | 保存・注入 |
|----------|------|--------|------------|
| **L1 カオルさん共通 Doc** | 考え方・ノウハウ（本機能） | **管理者** | `knowledge_sources` → 全 chat 系生成に **自動融合** |
| **L2 制作物プロンプト** | step 構成・制約・フォーマット ＋ 事業者変数 | 管理者 ＋ ユーザー（事業者情報） | 既存 `prompt_templates` ＋ `replaceTemplateVariables` |

**ユーザー別「哲学プロファイル」レイヤーは Pro では設けない。**

**融合イメージ（生成時）:**

```
system prompt =
  [L1 カオル Doc ホット層（budget 内）]
  + [L2 選択中テンプレの content（{{company}} {{persona}} 等の事業者変数置換後）]
```

※ L1 の全文は DB（**M② 外部メモリ**）に保持。LLM には **M① コンテキスト内**（budget 内断片）のみ注入。詳細は **カオル Doc メモリ層** を参照。  
※ 事業者情報（5W2H・ペルソナ等）は **ユーザー別の事実データ**（L2 テンプレ変数）。**考え方・ノウハウ** は L1（管理者 Doc）のみ。

NotebookLM 公開 API はない。**Docs API 取得 + DB キャッシュ + プロンプト先頭への自動連結** で再現する。

---

## 結論

**実装可能。** Pro の記憶レイヤー要件はクライアント原文どおり **「管理者だけが Google Doc を指定し、全ユーザーの出力はその Doc ありき」**。

**MVP 正体**: `/admin/prompts` に Google Doc 管理を統合 → URL 登録 → Docs API 取得 → DB キャッシュ → chat 系生成時に L1 Doc + L2 テンプレを **自動融合**。

| 項目 | 方針 |
|------|------|
| 取得 | URL 登録 + サービスアカウント + Docs API readonly |
| キャッシュ | DB（生成のたび API は叩かない） |
| 反映 | 管理画面「更新」ボタンで手動リフレッシュ |
| 管理 UI | **別画面 `/admin/knowledge` は作らない**。`/admin/prompts` 上部に Doc 一覧 |
| テンプレ別 Doc | **MVP では不要**（将来拡張） |
| `{{knowledgeBase}}` | **管理者に書かせない**。コード側で自動融合 |
| Doc メモリ層 | **M② 全文 DB（切り詰め禁止）** + **M①** budget 注入。L2 テンプレ・履歴は対象外 |
| Google 審査 | SA + Doc 共有方式のため **OAuth アプリ審査不要** |

認証は **サービスアカウント**（`googleapis` 新規導入）。Ads/GSC の **ユーザー OAuth**（`google-auth.ts`）とは別経路。

---

## クライアント合意・確認状況

| 項目 | 状態 |
|------|------|
| 管理者のみ設定・全 Pro ユーザー共通 | ✅ |
| 内容 = カオルさんの考え方・ノウハウ（Lite NotebookLM 同種） | ✅ |
| Google Doc は **複数** | ✅ |
| URL 登録 + 自動取得 | ✅ |
| UI = 既存プロンプト管理 + Doc 読み込み | ✅ |
| テンプレ別 Doc（制作物ごと） | ❌ MVP スコープ外 |
| 更新頻度 | 初期は **手動「更新」** 固定（定期バッチは任意拡張） |

---

## MVP 実装

### 方針

1. `/admin/prompts` 画面上部に **「カオルさん共通 Google ドキュメント」** セクションを追加（複数行: 名前・URL・有効/無効・更新・状態）。  
2. Docs API でフェッチし `knowledge_sources` にキャッシュ。  
3. chat 系生成時に **`buildKnowledgeSystemBlocks()`** で L1（Doc ホット）と L2（テンプレ）を **分離**。Anthropic は 2 ブロック system で渡す。  
4. 管理者はテンプレに変数を追記する必要なし（既存プロンプト編集 UI はそのまま）。

### 管理 UI イメージ

```
/admin/prompts
┌─ カオルさん共通 Google ドキュメント ─────────────────────┐
│ [+ Doc を追加]                                           │
│ ┌ Doc 1 ─────────────────────────────────────────────┐ │
│ │ 表示名: [カオルさんノウハウ 2026]                      │ │
│ │ URL:    [https://docs.google.com/document/d/...]     │ │
│ │ 状態: ✅ 取得済み 2026-06-16  [更新] [有効/無効]       │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌ Doc 2 ... ┐                                            │
└──────────────────────────────────────────────────────────┘

┌─ 既存: カテゴリ / テンプレ選択 / プロンプト本文 ─────────┐
│ （現行 PromptsClient と同じ）                            │
└──────────────────────────────────────────────────────────┘
```

GSC / Google Ads カテゴリでは Doc 融合対象外（注入経路も対象外）。

### 運用セットアップ（初回・インフラ）

| # | 作業 | 備考 |
|---|------|------|
| 1 | GCP で **Google Docs API** 有効化 | Ads/GSC と同一プロジェクト可 |
| 2 | **サービスアカウント**の JSON キーを **Vercel 環境変数**に設定 | GitHub バックアップ用 SA（`GCP_SERVICE_ACCOUNT_KEY`）とは別用途推奨。Vercel には現状 SA 変数なし |
| 3 | 各 Doc を **SA メールに「閲覧者」で共有** | 未共有 → 403 |
| 4 | 管理画面で URL 登録 → 「更新」 | |

`.env` 直書き禁止。環境変数例（実装時に `.env.example` 追記）:

- `GOOGLE_DOCS_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_DOCS_SERVICE_ACCOUNT_PRIVATE_KEY`（改行は `\n` エスケープ）

### MVP スコープ

| 区分 | 内容 | やる / やらない |
|------|------|----------------|
| 管理 UI | `/admin/prompts` 上部に共通 Doc 一覧（CRUD・更新・有効/無効・確認ダイアログ） | ✅ |
| 管理 UI | 別画面 `/admin/knowledge` | ❌ |
| Google Docs | URL → document ID → Docs API → プレーンテキスト | ✅ |
| 認証 | サービスアカウント + `googleapis` | ✅ |
| 融合 | `buildKnowledgeSystemBlocks()`（L1/L2 分離）+ `trimKnowledgeForGeneration` | ✅ |
| Doc メモリ層 | M② 全文保存 + M① generation_type 別 budget + step7 ガード | ✅ |
| Anthropic cache | L1 Doc ブロックのみ `cache_control: ephemeral`（2 ブロック system） | ✅ MVP 推奨（**現状未実装** → [付録 A](#付録-a-anthropic-prompt-caching現状と-mvp-差分)） |
| Anthropic Memory Tool | モデル主導 JIT（`/memories`） | ❌ 不採用（下記スコープ外） |
| DB | `knowledge_sources`（下記スキーマ） | ✅ |
| 複数 Doc | `scope='global'` の有効行を **sort_order 順** に連結 | ✅ |
| バリデーション | 警告閾値（UI）+ フェッチ **ハード拒否**（部分保存禁止。下記 §M② 保存方針） | ✅ |
| `businessInfo=null` | 共通 Doc 融合は **事業者情報の有無に依存しない** | ✅ |
| コピペ直接入力 | API 未設定時の開発用フォールバック | ⚪ 任意 |
| テンプレ別 Doc | `scope='template'` + `prompt_template_id` | ❌ 将来 |
| 定期バッチ | cron 自動リフレッシュ | ❌ 将来 |
| RAG | ベクトル検索 | ❌ |
| Canvas Doc 注入 | **編集本体**（`getBlogCreationTemplatePrompt` 経由）のみ ✅ | Web 検索・分析用 system には ❌ |
| GSC / Google Ads | 注入対象外 | ❌ |

### DB スキーマ（`knowledge_sources`）

```sql
-- 概念（マイグレーション時に RLS・インデックスを追加）
knowledge_sources (
  id              UUID PRIMARY KEY,
  name            VARCHAR NOT NULL,          -- 管理用表示名
  source_url      TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  scope           TEXT NOT NULL DEFAULT 'global',  -- MVP は 'global' のみ
  prompt_template_id UUID NULL,              -- 将来: scope='template' 用
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  last_fetch_error TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
```

- MVP: `scope = 'global'` かつ `is_active = true` の行を `sort_order ASC` で連結。
- シングルトン制約は **設けない**（複数 Doc 前提）。

### MVP ユーザーフロー

```
[初回] GCP: Docs API 有効化 → SA キーを Vercel に設定 → 各 Doc を SA に共有
         ↓
管理者: /admin/prompts 上部で Doc URL 登録 → 「更新」でフェッチ → 有効化
         ↓
管理者: 同画面で従来どおりテンプレ（プロンプト）を編集・保存
         ↓
一般ユーザー: 通常どおり生成
         → [共通 Doc 群] + [テンプレ + 事業者変数] が system prompt に載る
         ↓
Doc 編集後: 管理者が「更新」で再フェッチ（生成 API は叩かない）
```

### MVP 工数

| 項目 | 理想人日 |
|------|----------|
| DB + RLS + 型 | 0.5日 |
| SA 認証 + Docs 取得サービス（`googleapis`）+ Vercel  env | 1〜1.5日 |
| Server Action（CRUD・フェッチ・バリデーション） | 1日 |
| `/admin/prompts` UI 拡張（Doc 一覧 + token 見える化・警告） | 1.5〜2日 |
| Doc メモリ層（`trimKnowledgeForGeneration`・budget 定数・step7 ガード） | 0.5〜1日 |
| `getGlobalKnowledgeContent()` + `buildKnowledgeSystemBlocks()` + LP 配線 + 2 ブロック cache | 1.5〜2日 |
| テスト + quality-gate（trim / step7 フォールバック含む） | 0.5〜1日 |
| **合計** | **約 7〜9 理想人日** |

---

## カオル Doc メモリ層（コンテキスト管理・必須）

複数 Doc を全文融合すると **コンテキストオーバーは確実**。対策は **カオル Doc レイヤーだけ** に閉じ込める。テンプレ・事業者情報・チャット履歴のリファクタは本件スコープ外。

### 前提

| 要因 | 備考 |
|------|------|
| ベースモデル | `claude-sonnet-4-6`（コンテキスト 1M） |
| カオル Doc | NotebookLM ソース並みに **長文化しやすい**（最大リスク） |
| テンプレ | LP・ブログ step は既に大きい |
| チャット履歴 | step7 で **青天井**（Doc 管理では解決しない） |
| 出力予約 | step7: `maxTokens: 64000`（`MODEL_CONFIGS`） |

**原則**: DB には全文（**M②**）、LLM には **budget 内の断片のみ（M①）**。L2 テンプレ全文は切らない。

### メモリ4タイプ（カオル Doc に限定）

> **記号**: 以下 **M①〜M④** は AI メモリ分類。**L1/L2 注入レイヤー** や **Anthropic Memory Tool** とは別体系。

| タイプ | 本機能での対応 | 採否 |
|--------|----------------|------|
| **M①** コンテキスト内 | `trimKnowledgeForGeneration()` — generation_type 別 **注入 budget** 内のみ | **採用** |
| **M②** 外部メモリ | `knowledge_sources.content` — Docs API 取得結果の **全文**（フェッチ時に切り詰めない） | **採用** |
| **M③** 再学習 | — | **不採用** |
| **M④** キャッシュ（KV） | L1 Doc ブロックのみ `cache_control: ephemeral`（[付録 A](#付録-a-anthropic-prompt-caching現状と-mvp-差分)） | **採用（推奨）** |

### 2層モデル（M② コールド / M① ホット）

```
Google Doc
    ↓ Docs API（登録時・「更新」ボタンのみ）
[M② コールド] knowledge_sources.content（全文・切り詰め保存禁止）
    ↓ sort_order 順に連結
[M① ホット]   trimKnowledgeForGeneration(raw, generationType)
    ↓ budget 内に切り詰め（注入時のみ）
buildKnowledgeSystemBlocks(L2 templateBlock, hotL1)
    ↓
LLM system = Block A(L1, cache) + Block B(L2)
```

**L2 テンプレ・brief・履歴はこのパイプラインに入れない。** オーバー時に削るのは **L1 Doc ホット層（M①）だけ**。

### M② 保存方針（全文 vs 上限）

| 層 | 方針 |
|----|------|
| **M② `content`** | Docs API の取得結果を **そのまま全文保存**。NotebookLM 相当の長文を想定し、**保存時 trim は禁止**（M② の意味が崩れるため） |
| **M① 注入** | 生成時のみ `trimKnowledgeForGeneration()` で budget 内に切り詰め |
| **UI 警告**（保存後も可） | 1 Doc **8,000字** / 有効 Doc 合計 **20,000字** — step7 overflow リスクの目安（バッジ表示） |
| **フェッチ ハード拒否** | 1 Doc **50,000字** / 有効 Doc 合計 **150,000字** 超 → **`content` を更新しない**、`last_fetch_error` に理由を記録（部分保存・切り詰め保存 **禁止**）。管理者は Doc 分割または定数見直し |

定数は `knowledgeBudget.ts` 等に集約。8,000/20,000 は **警告のみ**、**保存上限ではない**。

### generation_type 別注入 budget（MVP 初期値）

文字数は目安。実装は **token カウント**（`claude` 向け推定）を正とする。

| generation_type | Doc 注入 budget（目安） | 理由 |
|-----------------|-------------------------|------|
| `ad_copy_creation` | **2,000 token** | 出力 4K。Doc が主役化しない |
| `lp_draft_creation` | **6,000 token** | テンプレ自体が大きい |
| `blog_creation_step1`〜`step4` | **5,000 token** | 履歴はまだ短い |
| `blog_creation_step5`〜`step6` | **5,000 token** | 構成・書き出し |
| `blog_creation_step7` / 見出し系 | **6,000 token** | 履歴 + 出力 64K で最タイト。**要実測** |
| `blog_title_meta_generation` 等 | **3,000 token** | 短い出力 |

定数は `src/lib/constants.ts` または `knowledgeBudget.ts` に集約（MVP は定数ファイルで可、将来 admin 設定化）。

### `trimKnowledgeForGeneration()`（M① ホット層）

```typescript
type KnowledgeGenerationType =
  | 'ad_copy_creation'
  | 'lp_draft_creation'
  | 'blog_creation_step'
  | 'blog_creation_step7'
  | 'blog_title_meta'
  | 'default';

function trimKnowledgeForGeneration(
  mergedContent: string,
  generationType: KnowledgeGenerationType
): string {
  const budgetTokens = KNOWLEDGE_INJECTION_BUDGETS[generationType];
  // 1) 推定 token が budget 以内 → そのまま返す
  // 2) 超過 → sort_order 済み merged を先頭優先で載せ、Doc 境界で切る
  //    同一 Doc 内は先頭から（見出し行 ## は可能な限り残す）
  // 3) 切り詰め発生時は server ログ（将来: メトリクス）
  return trimmed;
}
```

**禁止**: テンプレ側の切り詰め、履歴の自動削除（本レイヤーの責務外）。

### step7 専用ガード

**step7 は実測必須**（出力 64K 予約＋履歴＋L2 テンプレで最タイト）。

| 条件 | 動作 |
|------|------|
| 融合後 system prompt が **40K token 超**（目安） | Doc 注入 budget を **50% に縮小**して再 trim |
| **60K token 超**（目安） | Doc 注入 **スキップ**（テンプレ + brief のみ）。サイレント失敗禁止 — ログ |
| リリース前 | 長尺セッション（step1〜6 履歴あり）で **手動 QA** |

履歴オーバーは Doc メモリ層では解決しない。step7 ガードは **Doc 側の譲歩** のみ。

### Anthropic cache 分離（M④・MVP 推奨・**未実装**）

現状の Prompt Caching 利用状況・限界・将来検討は **[付録 A](#付録-a-anthropic-prompt-caching現状と-mvp-差分)** を参照。

**前提**: 単一 string の `fuseGlobalKnowledgeDocs()` では 2 ブロック cache を実現できない。MVP では **`buildKnowledgeSystemBlocks()` が正**（下記 §注入レイヤー）。

`llmService` および stream route の system を **2 ブロック** に分ける（Doc 更新時のみ Block A の cache 失効）:

```
Block A: L1 カオル Doc ホット層  … cache_control: ephemeral（M④）
Block B: L2 テンプレ + brief 置換後 … cache なし（ユーザーごとに変動）
```

L1 Doc は全ユーザー共通 → Block A の cache 効率が最も高い。L2 テンプレ・brief 変更で L1 Doc cache を切らない。

### 管理 UI（Doc メモリの可視化）

`/admin/prompts` Doc セクションに追加:

| 表示 | 用途 |
|------|------|
| 各 Doc: 文字数 / 推定 token | M② 全文 vs 警告閾値（8,000字）・ハード拒否閾値（50,000字） |
| 有効 Doc 合計 | 警告 20,000字 / ハード 150,000字 |
| 種別別 budget 対比 | 「step7 で overflow リスク」バッジ |
| 最終フェッチ日時 / エラー | 既存 |

フェッチ・保存時に計算。**生成時のサイレント切り詰めだけ** にしない。

### 本レイヤーのスコープ外

| 対象 | 理由 |
|------|------|
| **Anthropic Memory Tool** | [クライアント側 `/memories` ツール](https://platform.claude.com/docs/ja/agents-and-tools/tool-use/memory-tool)。モデルが **必要時のみ** ファイルを読む JIT 方式。本件は **L1 Doc を毎回サーバーが強制注入** する要件と矛盾。M②→M① の思想は同型だが、実装は **サーバー主導 trim + fuse** が正。ツール往復によるレイテンシ・非決定論も不要 |
| `prompt_templates` の短縮 | 別課題 |
| 事業者情報（brief） | 別課題 |
| チャット履歴のウィンドウ化 | step7 既存リスク。将来別チケット |
| RAG / ベクトル検索 | MVP 不採用。Doc オーバーが常態化したら **Doc レイヤーのみ** Phase 2 で検討 |
| フェッチ毎 LLM 要約 | コスト・ブレ・遅延 |

### 将来拡張（Doc メモリ層のみ）

| 拡張 | 条件 |
|------|------|
| `content_summary` 列（管理者承認の圧縮版） | 全文 budget 内に収まらないとき |
| budget の admin 設定化 | 定数調整が運用で足りないとき |
| Doc 単位 RAG | 複数長文 Doc が日常化したとき |

---

## 注入レイヤーの設計

### 自動融合（MVP）

```
有効な global Doc（sort_order 順に M② content 連結）
        ↓
getGlobalKnowledgeContent()           ← M② 全文、React cache()
        ↓
trimKnowledgeForGeneration()          ← M① ホット層
        ↓
buildKnowledgeSystemBlocks(L2, hotL1) ← L1 / L2 を分離（string 連結は LLM 経路では使わない）
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
  // is_active=true, scope='global' を sort_order 順に連結（M② 全文）
  return merged ?? '';
});

async function buildKnowledgeSystemBlocks(
  templateBlock: string,
  generationType: KnowledgeGenerationType
): Promise<KnowledgeSystemBlocks> {
  const raw = await getGlobalKnowledgeContent();
  const hot = trimKnowledgeForGeneration(raw, generationType);
  if (!hot.trim()) {
    return { knowledgeBlock: '', templateBlock };
  }
  const knowledgeBlock = [
    '## カオルさんの考え方・ノウハウ（全ユーザー共通）',
    '',
    hot.trim(),
  ].join('\n');
  return { knowledgeBlock, templateBlock };
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

| 順序 | 処理 |
|------|------|
| 1 | L2 テンプレ本文を解決（`prompt_templates` / `generate*Prompt`） |
| 2 | L2 に対してのみ `replaceTemplateVariables` / `PromptService.replaceVariables` |
| 3 | **`buildKnowledgeSystemBlocks(L2, generationType)`** — L1 を付与 |
| 4 | stream route / `llmChat` で `toAnthropicSystemBlocks()` 経由の 2 ブロック system を Anthropic に渡す |

### string systemPrompt 前提との分離（実装漏れ防止）

現行コードは **LLM 送信も DB 保存も `string` の `systemPrompt` 1 本** 前提:

| 箇所 | 現状 |
|------|------|
| `chatService.startChat` | `systemPrompt: string` → `llmChat` に `{ role: 'system', content: systemPrompt }`（L53, L78） |
| `chatService.continueChat` | 同上（L175, L198 `finalSystemPrompt`） |
| `llmService.llmChat` | `systemPrompt?: string` → 単一 `cache_control` ブロック（L37, L115-120） |
| `anthropic/stream/route.ts` | `getSystemPrompt()` の string を単一 system ブロックに載せる |

**MVP 方針**: 型を2系統に分ける。

| 用途 | 型 | 使い所 |
|------|-----|--------|
| **LLM 送信** | `AnthropicSystemBlock[]`（`toAnthropicSystemBlocks`） | stream route、`llmService`（シグネチャ拡張または blocks 専用入口） |
| **DB / ログ / 互換** | `toSystemPromptDebugString(blocks)` | 既存 `string` API を壊さない箇所の保存・デバッグのみ |

`chatService` / `modelHandlers` が string のまま LLM まで届ける経路（LP 等）は、**stream 入口または `llmChat` 直前**で `buildKnowledgeSystemBlocks` → `toAnthropicSystemBlocks` に寄せる。string 連結で L1 を載せてから `startChat` に渡す実装は **禁止**。

**LP 経路の注意（現行コード）**: `modelHandlers.ts` の `handleLPDraftModel` / `handleContinue`（`lp_draft_creation`）は `getSystemPrompt` 取得 **後** に `PromptService.replaceVariables(systemPrompt, variables)` を実行している（例: L166-167, L279-280）。  
Doc を L2 確定前に L1 と string 融合すると、Doc 内の `{{company}}` 等が意図せず置換される。**MVP では L1 付与を handler 後段（または stream 入口）に移し、replace 対象は L2 のみ**とする。

**`replaceTemplateVariables` は同期のまま**。DB アクセスは `getGlobalKnowledgeContent()` のみ（async は `buildKnowledgeSystemBlocks` 内）。

**`businessInfo=null`**: L2 の事業者ブロック除去後も、**L1 Doc 注入は必ず実行**。

### 適用対象経路

| 経路 | MVP | 備考 |
|------|-----|------|
| ブログ step1〜7（`anthropic/stream`） | ✅ | `buildKnowledgeSystemBlocks` → 2 ブロック system |
| `generateTitleMetaPrompt` | ✅ | 同上 |
| 広告（`ad_copy_creation`） | ✅ | 同上 |
| LP（`lp_draft_creation`） | ✅ | **L2 のみ** `modelHandlers` で replace → その後 L1 付与（上記 §配線原則） |
| Canvas **編集本体** | ✅ | `getBlogCreationTemplatePrompt` → `finalSystemPrompt` 構築時に L1 注入 |
| Canvas **Web 検索** 段 | ❌ | 専用 system（`web_search` ツール用）。Doc 不要 |
| Canvas **分析** 段 | ❌ | 編集結果の検証用短 system。Doc 不要 |
| GSC / Google Ads | ❌ | |

**Canvas 詳細**（`app/api/chat/canvas/stream/route.ts`）:

| 段 | 行付近 | Doc 注入 |
|----|--------|----------|
| Web 検索 | ~559 | ❌ |
| Canvas 編集（`apply_full_text_replacement`） | ~663 `finalSystemPrompt` | ✅ L1 + テンプレ +（任意）Web 結果 |
| 編集分析 | ~930 `analysisSystemPrompt` | ❌ |

### 読み取り権限

- **管理 CRUD**: 管理者 RLS（`prompt_templates` 同型）
- **生成時**: Service Role（`withServiceRoleClient`）。server-only。

---

## 既存資産マッピング

| 資産 | 活用 |
|------|------|
| `app/admin/prompts/PromptsClient.tsx` | Doc セクション追加のベース |
| `validateAdminAccessOrError` | 同一 admin ガード |
| `prompt_templates` RLS パターン | `knowledge_sources` 設計 |
| `getTemplateByName` + React `cache()` | `getGlobalKnowledgeContent` のパターン |
| GCP プロジェクト | Docs API 有効化 |
| GitHub `GCP_SERVICE_ACCOUNT_KEY` | バックアップ専用。**Docs 用は Vercel に別設定** |
| `google-auth.ts` | Docs には **使わない** |
| `chatService.ts` | `startChat` / `continueChat` の `systemPrompt: string` — blocks 分離後も DB 用 string は `toSystemPromptDebugString` |
| `llmService.ts` / stream routes | `toAnthropicSystemBlocks` → Anthropic system 配列（L1 cache 分離） |

**新規**: npm `googleapis`（Google API Client Library。Cloud Client Library ではない）。

---

## 将来拡張（MVP 後）

| 拡張 | 条件 | 工数目安 |
|------|------|----------|
| テンプレ別 Doc（`scope='template'`） | カオルさんが制作物別 Doc を運用するとき | +2〜3日 |
| 定期バッチ自動リフレッシュ | 更新頻度が高く手動が破綻するとき | +2〜3日 |
| コピペフォールバック | ローカル/API 未設定開発 | +0.5日 |

---

## リスク／難所

| リスク | 対策 |
|--------|------|
| Doc 未共有 → 403 | `last_fetch_error` 表示。セットアップ手順を共有 |
| 複数 Doc でトークン肥大 | **Doc メモリ層**（budget + trim + UI 警告）。テンプレは切らない |
| 表・画像の情報落ち | Doc はテキスト中心運用を推奨 |
| SA キー漏洩 | Vercel env・Docs 専用 SA・最小権限 |
| 誤内容の有効化 | 有効/無効 + 確認ダイアログ |
| Doc 更新の反映遅れ | 手動「更新」。生成は DB キャッシュのみ |
| Lite との内容乖離 | 運用で Doc 正本を Lite NotebookLM と揃える |
| LP 後段 `replaceVariables` | L1 を replace 対象外にし、handler **後** に `buildKnowledgeSystemBlocks`（§配線原則） |
| step7 コンテキスト溢れ | Doc 自動縮小 / スキップガード + 長尺セッション実測 QA |

---

## 推奨着手順

1. GCP: Docs API 有効化 + SA キーを Vercel に設定 + Doc 共有  
2. DB マイグレーション + フェッチサービス  
3. `/admin/prompts` UI（Doc セクション + token 警告）  
4. Doc メモリ層 + `buildKnowledgeSystemBlocks` 配線 + 2 ブロック cache  
5. step7 長尺セッション実測 QA  
6. 手動検証（Lite に近い「カオルさん前提」が Pro 出力に出るか）  
7. `npm run lint` / `build` / `knip`

---

## 検証方法

### 手動

- 複数 Doc 登録 → 有効なものだけ sort_order 順で融合  
- chat 系生成 → system prompt に Doc 内容 + テンプレ両方  
- 無効化 → 当該 Doc のみ除外  
- 「更新」前後で内容差  
- 403 → 管理 UI にエラー  
- `businessInfo=null` でも Doc 融合  
- **step7 長尺セッション**: overflow 時 Doc 縮小 or スキップが動くこと  
- **trim**: 広告 budget より長い Doc でも注入が budget 内に収まること  
- 既存事業者変数（`{{company}}` `{{persona}}` 等）の回帰  
- GSC/Ads → Doc 未融合  
- **Doc 内 `{{placeholder}}`**: L1 が `replaceVariables` 対象にならず原文のまま載ること  
- **2 ブロック system**: 2 回目以降の生成で `cache_read_input_tokens > 0`（L1 Block A が効いていること）  
- **ハード拒否**: 50,000字超 Doc でフェッチ失敗・`content` 未更新・UI にエラー表示。部分保存なし  
- **LP 経路**: `modelHandlers` 後段 replace 後も L1 が付与され、Doc 内 `{{...}}` が brief で置換されないこと  

### 単体テスト（最低限）

| 対象 | ケース |
|------|--------|
| `getGlobalKnowledgeContent()` | 0件 / 1件 / 複数 / 無効除外 / sort_order |
| `trimKnowledgeForGeneration()` | budget 内 / 超過時先頭優先切り詰め / generation_type 別 |
| `buildKnowledgeSystemBlocks()` | hot 空 → `toAnthropicSystemBlocks` が templateBlock のみ / 非空 → Block A+B / **L1 Doc** に `{{x}}` 含む場合 L1 非置換 |
| `toAnthropicSystemBlocks()` | knowledgeBlock 空 → Block A なし（cache BP も付けない） |
| step7 ガード | 40K/60K 閾値で縮小・スキップ |
| Docs URL パース | 正常 / 不正 |
| フェッチ Action | ハード上限超過 → 拒否・`last_fetch_error` / 403 |
| 2 ブロック assembly | knowledgeBlock 非空時のみ Block A に cache BP。空時は templateBlock 1 ブロックのみ |

---

## 実装工数まとめ

| フェーズ | 内容 | 理想人日 |
|---------|------|---------|
| **MVP** | `/admin/prompts` 統合 + Doc メモリ層 + 自動融合 + Docs API | **7〜9** |
| テンプレ別 Doc | 将来 | **+2〜3** |
| 定期バッチ | 将来 | **+2〜3** |

---

## 付録 A: Anthropic Prompt Caching（現状と MVP 差分）

**参照**: [Anthropic プロンプトキャッシング](https://platform.claude.com/docs/ja/build-with-claude/prompt-caching)

GrowMate は Anthropic API の Prompt Caching（**M④**）を **部分的に導入済み**。Doc 融合 MVP では **2 ブロック system 分離** を追加実装する（現状は単一ブロック）。

> **混同注意**: 本付録の Prompt Caching ≠ React `cache()`（`getGlobalKnowledgeContent`）≠ DB 保存（M②）。

### 現状（コードベース・2026-06 時点）

| 項目 | 状態 | 根拠 |
|------|------|------|
| API 利用 | ✅ 導入済み | 全 Anthropic 呼び出しで `cache_control: { type: 'ephemeral' }`（5 分 TTL） |
| 方式 | 明示的キャッシュブレークポイント | トップレベル自動キャッシング（`cache_control` を request 直下に置く方式）は **未使用** |
| 計測 | ✅ あり | `src/server/lib/anthropic-token-usage.ts` — `cache_creation_*` / `cache_read_input_tokens` を集計・ログ |
| system 構成 | ⚠️ **単一ブロック** | L2 テンプレ + brief 置換後を **1 塊** でキャッシュ |
| 2 ブロック分離 | ❌ 未実装 | L1 Doc / L2 テンプレ+brief の cache 分離なし |
| マルチターン | チャット SSE のみ最適化 | 履歴末尾メッセージにも BP。Canvas SSE は system のみ |
| React Cache との混同注意 | — | `PromptService.invalidateAllCaches()` は **DB テンプレ取得用**（M④ とは無関係） |

**キャッシュ配置（現行コード）**

| 経路 | ファイル | `cache_control` 付与箇所 |
|------|----------|---------------------------|
| 非ストリーム LLM | `src/server/services/llmService.ts` | system ブロック全体 |
| チャット SSE | `app/api/chat/anthropic/stream/route.ts` | system ブロック全体 ＋ 正規化済み履歴の **最後 1 メッセージ** |
| Canvas SSE | `app/api/chat/canvas/stream/route.ts` | 各 API 呼び出しの system のみ（Web 検索 / 編集 / 分析の 3 箇所）。**履歴には BP なし** |

**現状の限界（Doc 導入前でも該当）**

1. **brief / 事業者変数が system 内に混在** — `{{company}}` 等が変わるたび system 全体の cache が無効化される。
2. **最小トークンしきい値** — 現行 `claude-sonnet-4-6`（`constants.ts`）は cache **書き込み** に **1,024 token** 以上が必要（[Anthropic 公式](https://platform.claude.com/docs/ja/build-with-claude/prompt-caching)）。L1 Doc ホット層は通常これを超える想定。
3. **実効 cache の未検証** — 2 ブロック system 導入後、本番ログの `cacheReadInputTokens > 0` を確認（`logTokenUsage` 出力）。

### MVP で追加する設計（本文 §Anthropic cache 分離）

L1 Doc は全ユーザー共通・大容量 → **Block A（L1）のみ cache** にしないと brief 変更のたび Doc 分も再課金される。

```
Block A: L1 カオル Doc ホット層  … cache_control: ephemeral（M④）
Block B: L2 テンプレ + brief 置換後 … cache なし（ユーザーごとに変動）
```

### 将来検討（MVP 外）

| 項目 | 理由 |
|------|------|
| トップレベル自動キャッシング | 20 ブロック超の長会話で手動 BP のルックバック限界を補える。チャット SSE で併用検討 |
| モデル変更時の再確認 | cache 最小しきい値（現行 Sonnet 4.6 は **1,024 トークン**）と `constants.ts` の整合を確認 |
| Anthropic Memory Tool | 本文 §本レイヤーのスコープ外 参照。MVP 不採用 |
