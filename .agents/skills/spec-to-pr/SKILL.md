---
name: spec-to-pr
description: docs/plans/ の仕様書を起点に、実装・CodeRabbitレビュー・修正・コミット・PR作成までを一気通貫で自動化する。「仕様を実装してPRにして」「spec-to-pr でこの機能を作って」「docs/plans/xxx.md を実装して」と言われたとき、または実装タスクを開始するときに必ず使う。
disable-model-invocation: true
argument-hint: [spec-file-name-or-keyword]
---

# Spec → PR 自動化ワークフロー

`docs/plans/` の仕様書を読んで実装し、CodeRabbitレビューをパスしてPRを作成するまでの完全フロー。

## フロー概要

```
仕様書参照 → ブランチ作成 → 実装 → Lint/Build → CodeRabbit CLIレビュー → 修正ループ → コミット → PR作成
```

共通フェーズの詳細は `.agents/skills/shared/pr-workflows/` を参照する。

---

## Phase 1: 仕様確認

### 1-1. 仕様書を特定する

引数またはユーザー指示から対象仕様書を特定する:

```bash
ls docs/plans/
```

対象が曖昧な場合はユーザーに確認する。複数ある場合は関連しそうなものをすべて読む。

### 1-2. 仕様書を読む

`implementation-guidelines` スキルも参照し、実装方針を整理する。

---

## Phase 2: ブランチ準備

→ [`.agents/skills/shared/pr-workflows/branch-prep.md`](../shared/pr-workflows/branch-prep.md)

ブランチ名は仕様書ファイル名または機能名から英語で付ける（例: `feature/google-ads-evaluation`）。

---

## Phase 3: 実装

### 3-1. 実装指針

以下のスキルを読んで実装方針に反映する:

| スキル | 参照タイミング |
|--------|--------------|
| `implementation-guidelines` | **必須**。TypeScript/Next.js/Supabase の実装ポリシー全般 |
| `nextjs-server` | **必須**。Server Actions / Route Handlers / Zod / エラーハンドリング |
| `project-naming` | **必須**。新規ファイル・変数の命名規則 |
| `react` | フロント実装がある場合。`patterns.md`（Context / use() / Suspense / 最適化） |
| `supabase` | DB ポリシー・RLS・Service Role の利用がある場合 |

### 3-2. 実装ルール

- 既存コードのスタイル・パターンに忠実に合わせる
- `any` 禁止。`unknown` + narrowing または Zod スキーマを使う
- 自動生成ファイル（`database.types.ts` など）を直接編集しない
- エラーは `nextjs-server` の `error-handling.md` に従う

---

## Phase 4: 品質チェック

→ [`.agents/skills/shared/pr-workflows/quality-check.md`](../shared/pr-workflows/quality-check.md)

**エラーがある状態でCodeRabbitレビューに進まない**。

---

## Phase 5: CodeRabbit CLI レビュー

→ [`.agents/skills/shared/pr-workflows/coderabbit-loop.md`](../shared/pr-workflows/coderabbit-loop.md)

---

## Phase 6: セルフレビュー

→ [`.agents/skills/shared/pr-workflows/self-review-phase.md`](../shared/pr-workflows/self-review-phase.md)

---

## Phase 7: コミット

→ [`.agents/skills/shared/pr-workflows/commit.md`](../shared/pr-workflows/commit.md)

**コミットメッセージ例**: `GSC初回評価をベースライン記録のみに変更し改善提案生成を防止`

---

## Phase 8: PR作成

→ [`.agents/skills/shared/pr-workflows/pr-create.md`](../shared/pr-workflows/pr-create.md)

PR本文テンプレート:

```bash
gh pr create \
  --title "<変更内容を端的に表す英語タイトル>" \
  --body "$(cat <<'EOF'
## 概要

<!-- 変更の目的と背景を2〜3行で -->

## 変更内容

- 
- 

## 関連仕様書

`docs/plans/<spec-file>.md`

## 開発プロセス記録

> レビュアーが実装の品質担保過程を確認できるよう、各ステップの結果を記載する。

### Lint / Build

- `npm run lint`: ✅ エラーなし
- `npm run build`: ✅ エラーなし

### CodeRabbit CLI レビュー

- 実施回数: X 回
- 最終結果: Actionable Comments: 0
- 主な指摘と対応:
  - <!-- 指摘内容と対応策を箇条書きで。なければ「指摘なし」 -->

### セルフレビュー（2パス）

- Pass 1（lint / build / 型安全 / 命名）: ✅ 完了
- Pass 2（実装指針 / セキュリティ / エラー処理）: ✅ 完了

## スクリーンショット（UI変更がある場合）

<!-- before / after の画像を貼る -->
EOF
)"
```

---

## チェックリスト（完了基準）

- [ ] 仕様書の全要件が実装されている
- [ ] `npm run lint` エラーなし
- [ ] `npm run build` エラーなし
- [ ] CodeRabbit CLI Actionable Comments: 0
- [ ] `quality-gate` 2パスセルフレビュー完了
- [ ] コミットメッセージが日本語1行
- [ ] PR本文に仕様書へのリンクと動作確認チェックリストがある
- [ ] PR作成後にCodeRabbitの自動レビューが表示される

---

## トラブルシューティング

→ [`.agents/skills/shared/pr-workflows/troubleshooting.md`](../shared/pr-workflows/troubleshooting.md)
