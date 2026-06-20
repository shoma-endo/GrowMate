---
name: growmate-ui-ux
description: GrowMate 専用 UI/UX 開発ガイド。広告運用・コンテンツマーケ初心者向けの画面設計・コンポーネント実装を始める前とコーディング中に使う。shadcn/ui トークン遵守、段階的開示、用語平易化、AI 挙動の透明化を正本とする。新規ページ、フォーム、モーダル、セットアップ、ダッシュボードの UI 実装時に参照する。事後レビュー専用ではない。オンボーディング UI は対象外（docs/plans/* を正本とする）。
---

# GrowMate UI/UX

本 Skill は **UI 実装の開発時ガイド** である。PR レビューや事後監査の代替ではない。コーディング着手前に読み、実装中の判断に使う。完了後の検証は `quality-gate` に委譲する。

GrowMate は **広告運用・コンテンツマーケティング初心者** が、専門知識なしで AI 支援ワークスペースを使える SaaS である。UI/UX の判断は「見た目の新しさ」より **迷わない・信頼できる・次に何をすればよいか分かる** を優先する。

## 正本の優先順位

判断がぶつかったときは、上から順に従う。下位は上位を上書きしない。

| 優先 | 正本 | 用途 |
|------|------|------|
| 1 | `docs/specs/*`, `docs/plans/*` | 機能別の合意済み UX（モーダル禁止、カード形式等） |
| 2 | `docs/context/client-vision-from-lark.md` | クライアント合意・運用思想（§1.6〜1.8） |
| 3 | 本 Skill + [`beginner-principles.md`](beginner-principles.md) | プロダクト横断の UX 原則 |
| 4 | `app/globals.css`, `components.json` | デザイントークン・shadcn 設定 |
| 5 | `implementation-guidelines` | コンポーネント再利用・実装ポリシー |
| 6 | 外部 `ui-ux-pro-max` | **a11y / フォーム / ローディングのチェックリスト参照のみ** |

**禁止**: `ui-ux-pro-max` のカラーパレット・フォントペア・glassmorphism 等のスタイル提案を、そのまま GrowMate に適用すること。ビジュアル刷新はクライアント合意と UI たたき台合意後のみ。

## プロダクト文脈（要約）

- **ユーザー像**: 自社メディア・広告運用を始めたばかり、または外注前の事業者。GSC / GA4 / Google Ads 等の用語に不慣れな人が多い。
- **提供価値**: 7 ステップのブログ作成、広告/LP 生成、各種ダッシュボード、WordPress 連携 — いずれも **ガイド付きの作業** として提示する。
- **トーン**: 実用 B2B SaaS。派手な装飾より、読みやすさと操作の予測可能性。

詳細な初心者向け原則は [`beginner-principles.md`](beginner-principles.md) を読む。

## 本 Skill の対象外

**オンボーディング**（`/business-info` の初回フロー等）の UI 仕様は本 Skill に載せない。正本は `docs/plans/*` / `docs/specs/*`（例: `docs/plans/google-docs-knowledge-source-plan.md`）。

## デザインシステム（固定）

| 項目 | 正本 | ルール |
|------|------|--------|
| コンポーネント | `src/components/ui/`（shadcn/ui） | 新規 UI は既存 primitives を優先。独自 `<button>` 等を増やさない |
| スタイル | `components.json` → `new-york`, `neutral` | 変更は合意後のみ |
| 色・半径 | `app/globals.css` の CSS 変数（oklch） | `bg-green-600` 等の生 Tailwind 色は避け、セマンティックトークンを使う |
| アイコン | lucide-react | emoji を UI アイコンに使わない |
| 通知 | Sonner（`src/components/ui/sonner.tsx`） | 成功/失敗/進行中を一貫して toast で伝える |
| グラフ | Recharts + `--chart-*` トークン | 色だけに依存しない（凡例・ラベル必須） |
| 日本語 UI | 全画面 | マーケ用語は初出で補足。英語ラベルはユーザー向けに使わない |

## いつ本 Skill を使うか

**Must（開発時）**: UI 実装タスクの **着手前** と **コーディング中**。新規ページ、主要コンポーネント、セットアップウィザード、モーダル/フォーム、ダッシュボード。

**Skip**: 純バックエンド、DB のみ、文言 1 行、ロジックのみリファクタ、**オンボーディング UI**（→ `docs/plans/*`）、**完了後の PR レビュー単独**（→ `quality-gate`）。

## 開発ワークフロー

UI 実装タスクでは、以下の順で本 Skill を使う。

1. **着手前 — 読む**: 本 Skill + `beginner-principles.md`。対象の `docs/plans/*` / `docs/specs/*` と `client-vision-from-lark.md` を読む。
2. **着手前 — 調査**: 同種画面（`/setup/*`, ダッシュボード等）の既存パターンを grep で確認し、踏襲する。
3. **着手前 — たたき台**（中〜大規模のみ）: ワイヤーまたは主要状態を提示し合意（§1.8）。合意前にコードを書かない。
4. **コーディング中 — 判断**: デザインシステム・画面種別指針・AI 連携 UI の鉄則に沿って実装。迷ったら [`implementation-checklist.md`](implementation-checklist.md) を参照。
5. **完了後 — 検証**: `quality-gate`（lint/build・セルフレビュー）。本 Skill はここでは再読しない。

## 画面種別の指針

| 種別 | 例 | UX の要点 |
|------|-----|-----------|
| ホーム / ハブ | `/`, `/setup` | カードで「次にやること」を 1 画面に整理。1 カード 1 主アクション |
| セットアップ | `/setup/gsc`, `/setup/google-ads` | ステップ表示、完了/未完了の明示、OAuth 失敗時の復帰導線 |
| チャット + キャンバス | `/chat` | **メッセージ UI に操作を集約**、キャンバスは文章編集に集中（§1.6）。ステップ感を維持 |
| ダッシュボード | `/ga4-dashboard`, `/gsc-dashboard` | 指標は平易な日本語ラベル。空状態・未取得・エラーを区別して表示 |
| 分析 | `/analytics` | 表は横スクロール最小化。列の意味をヘッダまたはツールチップで補足 |
| 管理 | `/admin` | 一般ユーザー向けより情報密度高くてよいが、破壊的操作は確認ダイアログ必須 |

## AI 連携 UI の鉄則

GrowMate は AI 出力が中心のため、**実装時に最初から** 以下を組み込む。

- **待ち時間**: 300ms 超の AI 処理は skeleton または spinner + 文言（「生成中です…」）。30 秒超はステップ進捗を見せる。
- **途中切れ・失敗**: ブラックボックスにしない。原因と **次のアクション**（続き生成、再試行、設定確認）をセットで表示。
- **挙動変更の開示**: 出力トーンや AI 挙動が変わる機能は、設定 UI でオン/オフまたは効果を説明する。
- **連打防止**: セッション作成・課金リソース消費操作はボタン disabled + ローディング。
- **モーダル**: モーダル on モーダル禁止。履歴→編集は閉じてから開く（合意済み仕様）。

## ui-ux-pro-max の使い方（開発時の補助のみ）

コーディング中に a11y 等で迷った場合のみ、**以下の Priority** を参照してよい。

| Priority | 開発時に組み込む観点 |
|----------|---------------------|
| 1 Accessibility | コントラスト、focus-visible、aria-label、フォーム label |
| 2 Touch & Interaction | 44px タッチターゲット、ローディング中 disabled |
| 3 Performance | CLS 回避、skeleton、画像 dimensions |
| 8 Forms & Feedback | フィールド横エラー、空状態、確認ダイアログ |

Priority 4 以降の **配色・フォント・スタイル刷新は採用しない**。

## 関連 Skill

| タイミング | Skill |
|------------|-------|
| 実装規約（本 Skill と併用） | `implementation-guidelines`, `react` |
| 完了後の検証 | `quality-gate` |
| 仕様→PR | TAKT `.takt/workflows/spec-to-pr.yaml` |
| 合意確認 | `agent-workflow-core` → `client-alignment-auditor` |
| 命名 | `project-naming` |

## 参照ドキュメント

- プロダクト概要: `README.md`
- クライアント思想: `docs/context/client-vision-from-lark.md`
- UX 設計判断の例: `docs/plans/google-ads-evaluation-design.md` Section 16.12
- 機能別 UI（オンボーディング含む）: `docs/plans/*`, `docs/specs/*`
