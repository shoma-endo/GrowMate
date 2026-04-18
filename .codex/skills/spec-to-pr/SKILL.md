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

```bash
# 現在のブランチを確認
git status
git branch

# develop から新ブランチを切る（命名規則: feature/xxx, fix/xxx など）
git checkout develop && git pull
git checkout -b feature/<spec-name>
```

ブランチ名は仕様書ファイル名または機能名から英語で付ける（例: `feature/google-ads-evaluation`）。

---

## Phase 3: 実装

### 3-1. 実装指針

以下のスキルを読んで実装方針に反映する:
- `implementation-guidelines` — TypeScript/Next.js/Supabase の実装ポリシー
- `server-actions-and-routes` — Server Actions vs Route Handlers の使い分け
- `supabase-rls` — RLS・セキュリティ関連の変更がある場合
- `project-naming` — 新規ファイル・変数の命名規則

### 3-2. 実装ルール

- 既存コードのスタイル・パターンに忠実に合わせる
- `any` 禁止。`unknown` + narrowing または Zod スキーマを使う
- 自動生成ファイル（`database.types.ts` など）を直接編集しない
- エラーは `error-handling-and-messages` スキルのパターンに従う

---

## Phase 4: 品質チェック

実装完了後、必ず実行する:

```bash
npm run lint
npm run build
```

エラーが出た場合は即座に修正し、再実行して確認する。**エラーがある状態でCodeRabbitレビューに進まない**。

---

## Phase 5: CodeRabbit CLI レビュー

### 5-1. ステージング

レビューしたいファイルをステージングする:

```bash
git add .
git status   # 対象ファイルを確認
```

### 5-2. レビュー実行

```bash
coderabbit review --prompt-only --type uncommitted
```

### 5-3. 指摘対応ループ

CodeRabbit の指摘を分類して対応する:

| 分類 | 対応方針 |
|------|----------|
| **Actionable Comments**（バグ・セキュリティ）| 必ず修正 |
| **Nitpick Comments**（品質改善） | 原則修正。合理的な理由があれば判断 |
| **Additional Context**（ベストプラクティス）| プロジェクト方針と照合して判断 |

修正後、再度レビューを実行する:

```bash
coderabbit review --prompt-only --type uncommitted
```

**「Actionable Comments: 0」になるまでループを続ける**。

---

## Phase 6: セルフレビュー

`self-review` スキルの2パスチェックリストを実行する。

- Pass 1: `npm run lint` / `npm run build` / 型安全 / 命名規則
- Pass 2: 実装指針 / セキュリティ / エラー処理 / コード品質

---

## Phase 7: コミット

```bash
git add .
git diff --cached   # 変更内容を最終確認

git commit -m "$(cat <<'EOF'
<日本語1行で変更内容を要約>
EOF
)"
```

**コミットメッセージルール**:
- 日本語1行（AGENTS.md の規約）
- 例: `GSC初回評価をベースライン記録のみに変更し改善提案生成を防止`
- `[Self-Review: Passed]` などをコミットメッセージに含めない

---

## Phase 8: PR作成

```bash
git push -u origin HEAD

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

## 動作確認

- [ ] `npm run lint` 通過
- [ ] `npm run build` 通過
- [ ] CodeRabbit CLI レビュー Actionable Comments: 0

## スクリーンショット（UI変更がある場合）

<!-- before / after の画像を貼る -->
EOF
)"
```

PR作成後、GitHub上でCodeRabbitの自動レビューが走るのを確認する（`.coderabbit.yaml` の `auto_review.enabled: true` により自動実行）。

---

## チェックリスト（完了基準）

- [ ] 仕様書の全要件が実装されている
- [ ] `npm run lint` エラーなし
- [ ] `npm run build` エラーなし
- [ ] CodeRabbit CLI Actionable Comments: 0
- [ ] `self-review` 2パス完了
- [ ] コミットメッセージが日本語1行
- [ ] PR本文に仕様書へのリンクと動作確認チェックリストがある
- [ ] PR作成後にCodeRabbitの自動レビューが表示される

---

## トラブルシューティング

### CodeRabbit CLIが動かない

```bash
# 認証確認
coderabbit auth login

# ステージング確認（git add が必要）
git status
```

### `coderabbit review` で "stopping cli" エラー

```bash
git add .
git status   # ファイルが追跡されているか確認
```

### PR作成で認証エラー

```bash
gh auth status
gh auth login
```

### CodeRabbitの自動レビューが走らない

`.coderabbit.yaml` の `auto_review.enabled` が `true` かを確認。またはPR上で `@coderabbitai review` とコメントして手動トリガーする。
