# テスト戦略 — GrowMate

## 背景と目的

AI エージェント（Claude Code など）によるコード生成が主流になる中、開発速度と品質を両立するためにテストの役割が変化している。

従来のテストは「人間が書いたコードを検証する安全網」だったが、AI 開発時代においては次の 2 つの意味が加わる。

1. **ガードレール**: AI が生成したコードが既存機能を壊していないかを自動検知する仕組み
2. **文脈伝達**: 「テスト駆動で実装して」という指示が、AI に対して保守性・責務分離を含む開発アプローチを効果的に伝える

このプロジェクトは Next.js App Router + Supabase + 外部 API + Server Actions + Route Handlers で構成が広く、現状は手動確認 + lint / build に依存している。AI が関与する変更が増えるほど、人間の確認だけに頼るコストが高くなる。

この戦略が自動化するのは **「純ロジックと入力バリデーションの回帰テスト」** に限定する。外部 API（Google Ads / GA4 等）や E2E は引き続き手動確認の対象だが、これは「先送り」ではなく費用対効果の判断だ。モック維持・flaky テスト対策・CI 環境整備のコストが初期段階では効果を上回る。

テストを最小セットから導入し、**AI → 実装 → テスト通過** のサイクルをまず純ロジック層で確立する。その後、手動確認コストが実際に問題になった箇所から順次自動化を拡張する。

参考: [AIエージェント時代のTDD（Uzabase Agile Journey）](https://agilejourney.uzabase.com/entry/2025/08/29/103000)

---

## ツール選定

**Vitest** を採用する。理由：

- 設定が軽く、TypeScript / ESM との相性が良い
- Jest 互換 API で学習コストが低い
- ESM / TypeScript をネイティブサポート

---

## テスト対象の原則

### テストする

- 副作用のない**純粋関数**（入力 → 出力が決定的）
- **境界値・分岐**が多く、バグが出やすいロジック
- **PostgreSQL 関数と同一挙動を保証する必要がある**コード（乖離するとDB整合性が壊れる）
- Server Actions の **Zod バリデーション層**（壊れると UI 側で無言エラーになる）

### テストしない

| 対象 | 理由 |
|---|---|
| Supabase クライアント直結処理 | RLS の正しさはユニットテストでは検証不可。local dev + migration テストで担保する |
| 外部 API（Google Ads / GA4 / GSC / WordPress） | モック維持コストが高い。E2E か手動確認で代替 |
| React コンポーネント | 現段階では導入しない。UIの正しさはブラウザ確認で担保 |
| E2E（Playwright） | Vitest が安定してから判断する |

---

## フェーズ計画

### Phase 1: セットアップ + 純関数テスト（目安: 1〜2日）

**目標**: Vitest を動かし、最もリスクの高い純関数を 15〜20 本カバーする。

#### 優先ターゲット

| ファイル | 対象関数 | テスト観点 |
|---|---|---|
| `src/lib/normalize-url.ts` | `normalizeUrl` | PostgreSQL `normalize_url()` との同一挙動保証。`https://`, `www.`, 末尾スラッシュ, `null` 入力 |
| `src/lib/normalize-query.ts` | `normalizeQuery` | NFKC 正規化、全角半角、空白の畳み込み、`null`/空文字 |
| `src/lib/date-utils.ts` | `addDaysISO`, `formatJstDateISO`, `buildLocalDateRange`, `buildGscDateRange` | JST/UTC 境界（特に UTC+9 で日付が変わるケース）、ゼロ日・負値エラー |
| `src/lib/ga4-utils.ts` | `normalizeToPath`, `ga4DateStringToIso` | `?`, `#`, `www.`, フルURL→パス変換の境界値 |
| `src/lib/google-ads-utils.ts` | `calculateCampaignSummary` | ゼロ除算ガード、空配列、`searchImpressionShare` が null のキャンペーン混在 |
| `src/lib/validators/common.ts` | `validateTitle`, `validateDateRange`, `dateStringSchema` | 空文字、最大長、不正日付フォーマット、開始日 > 終了日 |

#### セットアップ手順（実装時に参照）

```bash
npm install -D vitest
```

`@vitejs/plugin-react` / `@testing-library/react` はコンポーネントテストを追加するタイミングまで入れない。

`vitest.config.ts` を root に配置し、`tsconfig.json` のパスエイリアス（`@/`）を解決する設定を入れる。

テストファイルの配置は **`src/lib/__tests__/`** に集約する（ファイル名: `<対象ファイル名>.test.ts`）。

---

### Phase 2: 分離済みスキーマのバリデーションテスト（目安: 半日）

**目標**: `src/server/schemas/` の分離済みスキーマが壊れたときに即検知できる状態にする。

**対象ファイル（固定）**:

| ファイル | テスト観点 |
|---|---|
| `src/server/schemas/brief.schema.ts` | 必須フィールド、`optionalUrl` / `optionalEmail` の境界値、`paymentEnum` の不正値 |
| `src/server/schemas/chat.schema.ts` | `role` の enum バリデーション、空メッセージ配列 |
| `src/server/schemas/ga4.schema.ts` | 日付フォーマット、カスタム refine の境界値 |
| `src/server/schemas/googleAds.schema.ts` | `customerIdSchema` / `campaignIdSchema` の形式チェック |

**対象外（Phase 2 では触らない）**: `chat.actions.ts` / `heading-flow.actions.ts` / `ga4Dashboard.actions.ts` 等にインライン定義されたスキーマ。スキーマの抽出リファクタリングが必要になるため、半日見積もりに収まらない。必要なら Phase 4 以降で判断する。

---

### Phase 3: CI 組み込み（目安: 1時間）

現在の `.github/workflows/ci.yml` は `build` ステップのみ（lint は CI 未導入）。`build` ステップの**前**に `test` ステップを追加する。

```yaml
- name: Run tests
  run: npx vitest run
```

lint の CI 追加は今回のスコープ外。vitest の green を確認してから別途判断する。

---

### Phase 4以降: 判断ベースで拡張

Phase 1〜3 が安定したら、以下を**そのとき判断する**（現時点では計画しない）：

- `src/server/services/` の副作用なし処理の一部
- `src/lib/heading-extractor.ts`（`extractHeadingsFromMarkdown`, `stripLeadingHeadingLine` は分岐が多い）
- `src/lib/markdown-decoder.ts`（ストリーミングデコーダーは境界値が特殊）
- E2E（ログイン / チャット開始 / 主要設定保存）

---

## AI 開発サイクルでの使い方

実装タスクを AI（Claude Code）に依頼する際は、以下のフローを基本とする：

1. **テストを先に書く（または AI に書かせる）**: 「この関数のテストを境界値分析で書いて」と指示
2. **テストを通す実装を依頼**: 「このテストが通るように実装して」
3. **`npx vitest run` で確認**: CI に投げる前にローカルで通過を確認
4. **リグレッションも自動検知**: 既存テストが通ることで副作用がないことを担保

AI への指示例：
```
src/lib/date-utils.ts の addDaysISO 関数について、
境界値分析を使ってテストケースを vitest 形式で書いてください。
対象: YYYY-MM-DD バリデーション、月末日の繰り上がり、負値、うるう年
```

---

## カバレッジ目標

カバレッジ率は「目標達成のための指標」ではなく、「テストが薄い箇所を発見するための手がかり」として使う（グッドハートの法則：指標が目標になると良い指標でなくなる）。

| スコープ | 目標 | 備考 |
|---|---|---|
| `src/lib/` + `src/lib/validators/` | **75%+** | 純関数が集中するコアロジック層。高い目標を設定する価値がある |
| プロジェクト全体 | **60%+** | Supabase・外部 API 直結コードは対象外のため、数値は参考程度 |

**運用方針**:
- カバレッジが目標を下回った場合は「テストを追加すべきか / 対象外とすべきか」を判断する。数値合わせのためだけのテストは書かない
- `vitest --coverage` で定期確認する。CI での強制は Phase 3 以降に判断する

---

## 完了基準

| フェーズ | 完了条件 |
|---|---|
| Phase 1 | `npx vitest run` が green。対象 6 ファイル全てにテストが存在し、各ファイルの主要分岐（正常系・境界値・エラー系）がカバーされている |
| Phase 2 | `src/server/schemas/` の 4 ファイル全てにテストが存在し、`npx vitest run` が green |
| Phase 3 | CI の `build` + `vitest` が全て green で merge 可能 |
