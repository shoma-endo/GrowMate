# コアロジックテスト戦略 — GrowMate

## 背景と目的

AI エージェント（Claude Code など）によるコード生成が増える中、人間の画面確認だけでは、純ロジックや入力境界の回帰を継続的に検知することが難しい。

本戦略では、GrowMate の品質保証を次のように分担する。

1. **自動テスト**: 純粋関数、日付・正規化・集計ロジック、Zod バリデーションの回帰を検知する
2. **静的・ビルド検証**: lint / build / knip で型・構成・未使用コード等を検知する
3. **人間の目視確認**: UI の表示、操作感、導線、外部 API を含む実画面の挙動を確認する

最初から広範な E2E やコンポーネントテストを導入せず、まず変更頻度と再利用性が高いコアロジックに限定して、**AI → 実装 → 自動テスト通過**のサイクルを確立する。

この文書は GrowMate 全体の品質を自動テストだけで保証するものではなく、**コアロジック回帰テストの導入計画**を定義する。

参考: [AIエージェント時代のTDD（Uzabase Agile Journey）](https://agilejourney.uzabase.com/entry/2025/08/29/103000)

---

## スコープ

### 自動テストする

- 副作用のない純粋関数
- 境界値・分岐が多く、誤りがデータや集計結果に波及するロジック
- PostgreSQL 関数と同じ契約を維持する必要がある TypeScript 関数
- Server Actions / Route Handlers から分離済みの Zod スキーマ
- 過去に不具合が発生したコアロジックの回帰ケース

### 今回は自動テストしない

| 対象 | 今回の扱い |
|---|---|
| React コンポーネント | 自動テスト対象外。表示・操作感・導線は人間がブラウザで確認する |
| E2E（Playwright） | 今回は導入しない。主要フローの手動確認コストや回帰事故が増えた場合に判断する |
| Supabase / RLS / RPC | 今回の Vitest 対象外。現時点で自動担保済みとは扱わず、変更時の手動検証対象とする |
| 外部 API（Google Ads / GA4 / GSC / WordPress） | API 自体のモックテストは行わず、変更機能の手動確認対象とする |
| LLM 出力品質 | ユニットテストでは保証しない。固定 fixture や eval の導入は別仕様で判断する |

UI・外部 API・Supabase を含む変更は、`spec-to-pr` によるPR作成後、PR本文の「未確認事項」に必要な手動確認を記載する。**該当する手動確認が完了するまでマージしない**。

---

## ツールと実行コマンド

テストランナーは **Vitest**、カバレッジプロバイダーは **`@vitest/coverage-v8`** を採用する。

`package.json` に次のスクリプトを追加する。

```json
{
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "verify": "npm run lint && npm run test && npm run build && npm run knip"
  }
}
```

`npm run verify` をローカル・TAKT共通の品質ゲートとする。テストだけを実行する場合も、直接 `npx vitest` を呼ばず `npm run test` を使用する。

---

## テスト記述の原則

### 期待結果を実装から推測しない

テストケースは、対象コードの現在の実装だけを見て期待値を決めない。仕様書、本書に定義した契約、DB関数などの一次情報から期待結果を決める。

各テストには最低限、次を含める。

- 入力
- 期待する戻り値または `safeParse` の成否
- 例外を期待する場合はその条件
- 境界値を選んだ理由

現行挙動を意図的に固定する characterization test の場合は、その旨をテスト名またはコメントで明示する。

### 時刻依存を固定する

現在時刻に依存する関数では `vi.useFakeTimers()` と `vi.setSystemTime()` を使用し、テスト終了時に `vi.useRealTimers()` へ戻す。CI 実行日時や実行環境のタイムゾーンに結果を依存させない。

### プロダクションコードをテスト都合で変更しない

Phase 1〜2では、テスト追加のためだけの責務分割・export追加・スキーマ抽出を行わない。現状の公開関数・公開スキーマを対象に最小差分でテストする。

---

## Phase 1: セットアップと純関数テスト

**目安**: 1〜2日

### セットアップ

```bash
npm install -D vitest @vitest/coverage-v8
```

- `vitest.config.ts` をリポジトリルートに配置する
- `@/` パスエイリアスを解決できるよう設定する
- テスト環境はNodeとし、DOM環境やReact Testing Libraryは導入しない
- テストファイルは `tests/unit/lib/` に配置し、`<対象ファイル名>.test.ts` とする
- `src/lib/validators/common.ts` のテストファイル名は、他の`common.ts`との混同を避けるため`validators-common.test.ts`とする
- `tsconfig.json` の `include` へ `tests/**/*` を追加し、`vitest run` では行われないテストコードの型チェックを `npm run build` で担保する
- カバレッジ出力先 `coverage/` は `.gitignore` と `eslint.config.mjs` の `ignores` の両方で除外する
- `npm ci`、`npm run test`、`npm run build`を実行し、採用したVitestとNode 20、既存の`esbuild` overrideに互換性があることを確認する

### 優先ターゲットと期待する契約

| 対象 | 必須ケースと期待結果 |
|---|---|
| `normalizeUrl` | `null` / `undefined` /空文字は`null`。入力全体を小文字化した後、プロトコル・先頭`www.`・文字列末尾の連続スラッシュを除去する。クエリ・フラグメント自体は保持するが、その内部も小文字化され、文字列全体が`/`で終わる場合はクエリ値末尾の`/`も除去される |
| `normalizeQuery` | `null` / `undefined` /空白のみは空文字。NFKC正規化、小文字化、連続空白の単一スペース化を行う |
| `formatJstDateISO` | UTC 14:59と15:00、月末、年末でJST日付を返す |
| `addDaysISO` | 月末・年末・うるう年を繰り上げる。負の整数は減算として受理する。不正形式・整数以外は例外にする |
| `buildLocalDateRange` | 固定時刻に対して今日を含むN日間を返す。`days = 1`を受理し、0・負数・整数以外は例外にする |
| `buildGscDateRange` | 固定時刻に対して2日前を終了日とし、指定日数分の範囲を返す。正の整数を正常系とする。非整数は内部の`addDaysISO`を通じて例外となり、0以下は開始日 > 終了日の逆転範囲を返す現行挙動をcharacterization testとして確認する |
| `normalizeToPath` | 空入力、ドメインのみ、クエリ・フラグメントのみは`/`。フルURLはクエリ・フラグメント・末尾スラッシュを除いた小文字パスを返す |
| `ga4DateStringToIso` | 8桁文字列は`YYYY-MM-DD`へ変換し、それ以外は入力をそのまま返す。実在日付の検証関数としては扱わない |
| `calculateCampaignSummary` | 空配列、ゼロ除算、合計値、各平均、`ENABLED`かつshare非nullだけを使う平均を確認する |
| `validateTitle` / `validateDateRange` / `dateStringSchema` | `validateTitle`はtrim後の空文字・空白のみを拒否し、trim後60文字を受理、61文字を拒否する。日付は実在しない日付、開始日 > 終了日、正常範囲の成否を確認する |

### PostgreSQL `normalize_url()`との契約

`normalizeUrl` の期待値は `supabase/migrations/20251105090000_add_chat_session_search.sql` に定義された `public.normalize_url(text)` を根拠とする。

VitestはPostgreSQL関数自体を実行しないため、「DBとの同一挙動を自動保証済み」とは扱わない。将来どちらかの実装を変更する場合は、上表の契約ケースを両方へ適用できるか確認する。DB実行を含む契約テストは別フェーズで判断する。

`src/server/services/googleAdsAiAnalysisService.ts` には、クエリ・フラグメントも除去する非export関数`normalizeUrlKey`が存在する。`normalizeUrl`とは異なる契約であり、Phase 1のテスト対象には含めない。将来の統合・改名時に両者を同一ロジックとして扱わない。

### Phase 1 完了条件

- 上表の全対象に正常系・境界値・エラー系のテストが存在する
- 時刻依存テストが固定時刻で再現可能である
- `npm run test` が成功する
- `npm run knip`がVitest関連ファイル・依存を未使用として誤検知せず成功する。誤検知時はテストディレクトリ全体を無条件にignoreせず、実際のエラーに対応する最小限のknip設定を追加する
- テスト追加のみを目的としたプロダクションコード変更がない

---

## Phase 2: 分離済みZodスキーマのテスト

**目安**: 半日〜1日

現行コードに実在する公開スキーマを対象とする。

テストファイルは `tests/unit/server/schemas/` に配置し、`<対象ファイル名>.test.ts` とする。

| 対象ファイル・スキーマ | 必須ケースと期待結果 |
|---|---|
| `brief.schema.ts` / `briefInputSchema`, `paymentEnum` | serviceが1件以上なら成功、0件なら失敗。不正UUID、不正URL、不正メール、不正支払方法は失敗する |
| `chat.schema.ts` / `startChatSchema`, `continueChatSchema` | 必須フィールド欠落と不正roleは失敗する。`messages: []`は現行スキーマに`min`がないため受理するcharacterization testとする |
| `ga4.schema.ts` / `ga4SettingsSchema` | `propertyId`必須、engagementは0〜86400の整数、read rateは0〜1、conversion eventsは最大50件という境界を確認する。各閾値とconversion eventsの`undefined`は正常系として受理する |
| `googleAds.schema.ts` / `getKeywordMetricsSchema` | 実在日付、開始日 <= 終了日、数字のみのcampaign IDを受理し、不正日付・逆転範囲・非数字IDを拒否する |
| `googleAds.schema.ts` / `keywordMetricsQuerySchema` | startDate / endDateだけを対象に、実在日付と開始日 <= 終了日を受理し、不正日付・逆転範囲を拒否する。campaign IDのテスト対象にはしない |

インライン定義されたServer Action内スキーマは対象外とし、Phase 2で抽出リファクタリングを行わない。

### Phase 2 完了条件

- 上表4ファイルの公開スキーマに、正常系・境界値・拒否ケースが存在する
- characterization test と仕様上の必須制約が区別されている
- `npm run test` が成功する

---

## Phase 3: 品質ゲートとCIへの組み込み

### ローカル・TAKT品質ゲート

- `package.json` の `verify` に `npm run test` を組み込む
- `.agents/skills/quality-gate/SKILL.md` の品質ゲート記述を、lint → test → build → knipへ同期する
- `spec-to-pr` は既存どおり `npm run verify` を実行することでテストを必須通過する
- `.agents/skills/spec-review/SKILL.md` の完全性チェックへ「純関数・正規化・集計・日付・分離済みZodスキーマを変更する場合、仕様書に追加・更新するテストケースと期待結果が明記されているか」を追加し、将来の仕様書に対する確認ルールの正本とする
- Skill更新後に `npm run verify:agent-skills` を実行する
- `.husky/pre-push` を `npm run test && npm run build && npm run knip` に更新し、push前にもコアロジックテストを実行する。pre-commitは既存どおりlintのみとする
- TAKT `spec-to-pr` の `create_pr` は `git push --no-verify` でpre-pushフックを省略する。`npm run verify` の成功証跡をself_reviewで確認済みであり、CIが最終ゲートとなるため二重実行を避ける

### CI

現在の `.github/workflows/ci.yml` にはaudit・lint・build・knipジョブが存在する。これらと並列の独立した`test`ジョブを追加する。

```yaml
test:
  name: Test
  runs-on: ubuntu-latest
  if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - name: Install dependencies
      run: npm ci
    - name: Run tests
      run: npm run test
```

通知ジョブでは次の両方を更新し、テスト失敗をLark通知でも失敗として扱う。

- `needs`を`[audit, lint, test, build, knip]`へ変更する
- `STATUS`判定式へ`needs.test.result == 'success'`を追加する

### Phase 3 完了条件

- `npm run verify` がlint・test・build・knipを実行して成功する
- CIのaudit・lint・test・build・knipが成功する
- testジョブ失敗時に、notifyジョブの`STATUS`が`failure`となり、Larkへ失敗状態を通知できる構成になっている
- pre-pushでtest・build・knipが順番に実行される
- `npm run verify:agent-skills`が成功する

---

## AI開発サイクルでの運用

コアロジックを追加・変更する仕様書には、対象関数と期待結果を記載する。

1. 仕様書の期待結果からテストを書く
2. 新規テストが意図した理由で失敗することを確認する。ただし既存挙動を固定するcharacterization testでは必須としない
3. 最小差分で実装する
4. `npm run test`で対象テストと既存回帰テストを確認する
5. `npm run verify`で全品質ゲートを確認する

テストを通すために仕様を変更しない。仕様と現行実装が矛盾した場合は、実装者の判断で期待値を変えず、仕様確認のためABORTする。

---

## カバレッジの扱い

導入初期はプロジェクト全体のカバレッジ率を完了条件にしない。Supabase、外部API、Reactコンポーネントを対象外とするため、全体率はコアロジックの品質を正しく表さない。

`npm run test:coverage`は次の用途に限定する。

- 対象に選んだ関数の未実行分岐を発見する
- 重要な境界値のテスト漏れをレビューする
- テスト対象の拡大判断に使う基準値を収集する

数値合わせだけのテストは追加しない。将来カバレッジ閾値をCIで強制する場合は、実測値と保守コストを確認したうえで別仕様として合意する。

---

## 将来の拡張判断

Phase 1〜3の運用後、次の事象が発生した領域から追加自動化を検討する。

- 同種の回帰不具合が複数回発生した
- PRごとの手動確認負荷が継続的に大きい
- 認証・RLS・主要RPCの変更頻度が上がった
- ログイン、チャット開始、設定保存など主要フローの回帰が目視確認だけでは不安定になった
- LLM出力の構造違反、途中切れ、大量入力時の品質低下を定量的に追跡する必要が生じた

候補はSupabaseローカル環境でのRLS・RPC統合テスト、少数のPlaywrightスモークテスト、LLM evalとする。Reactコンポーネントの網羅的なユニットテストは、明確な費用対効果が確認できるまで優先しない。

---

## 仕様全体の完了基準

- Phase 1〜3の完了条件をすべて満たす
- `npm run verify`とCIの両方で自動テストが必須実行される
- UI・外部API・Supabase変更に対する人間の手動確認責任がPR上で明示される
- 自動テストで保証する範囲と保証しない範囲が混在していない
- 本仕様の実装によって、既存UI・API・DBのプロダクション挙動を変更していない
