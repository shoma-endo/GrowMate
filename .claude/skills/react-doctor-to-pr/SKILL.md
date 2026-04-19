---
name: react-doctor-to-pr
description: React Doctor を実行してReactコードの問題を診断・修正し、ブランチ作成からPR作成までを一気通貫で自動化する。「React Doctorを実行してPRにして」「react-doctor-to-pr で品質改善して」「Reactの問題を直してPRを作って」と言われたときに使う。
disable-model-invocation: true
argument-hint: [target-directory-or-description]
---

# React Doctor → PR 自動化ワークフロー

`react-doctor` でReactコードの問題を診断し、修正・CodeRabbitレビューをパスしてPRを作成するまでの完全フロー。

## フロー概要

```
React Doctor 診断 → ブランチ作成 → 修正実装 → Lint/Build → React Doctor 再診断 → CodeRabbit CLI レビュー → 修正ループ → コミット → PR作成
```

---

## Phase 1: 事前診断

### 1-1. 現状スコアを記録する

まず修正前のベースラインスコアを取得する:

```bash
npx -y react-doctor@latest . --verbose --diff
```

出力されたスコア（0-100）と Actionable Issues の一覧を記録しておく。

### 1-2. 修正対象を整理する

診断結果を以下の優先度で分類する:

| 優先度 | カテゴリ | 対応方針 |
|--------|---------|---------|
| **必須** | Security（セキュリティ）| 必ず修正 |
| **必須** | Correctness（バグ・動作不正）| 必ず修正 |
| **推奨** | Performance（パフォーマンス）| 原則修正 |
| **判断** | Architecture（設計）| プロジェクト方針と照合して判断 |

---

## Phase 2: ブランチ準備

```bash
# 現在のブランチを確認
git status
git branch

# develop から新ブランチを切る
git checkout develop && git pull
git checkout -b fix/react-doctor-improvements
```

ブランチ名は修正内容に応じて変更する（例: `fix/react-security-issues`, `perf/react-optimization`）。

---

## Phase 3: 修正実装

### 3-1. 実装指針

以下のスキルを読んで修正方針に反映する:

| スキル | 参照タイミング |
|--------|--------------|
| `react19-patterns` | **必須**。Context / use() / useMemo禁止 / Suspense / 最適化パターン |
| `implementation-guidelines` | **必須**。TypeScript/Next.js の実装ポリシー全般 |
| `project-naming` | 新規ファイル・変数のリネームがある場合 |

### 3-2. 修正ルール

- `react-doctor` が指摘した箇所のみを最小編集で修正する（スコープ外の変更を混入させない）
- `any` 禁止。`unknown` + narrowing または Zod スキーマを使う
- `useMemo / useCallback / memo()` は React Compiler が自動最適化するため削除する
- `useContext()` → `use(Context)` に置き換える
- `<Context.Provider value={...}>` → `<Context value={...}>` に置き換える

---

## Phase 4: 品質チェック

修正完了後、必ず実行する:

```bash
npm run lint
npm run build
```

エラーが出た場合は即座に修正し、再実行して確認する。**エラーがある状態でReact Doctor再診断に進まない**。

---

## Phase 5: React Doctor 再診断

修正効果を確認する:

```bash
npx -y react-doctor@latest . --verbose --diff
```

**スコアが上がっていること、修正対象の Issues が解消されていることを確認する**。

スコアが下がった場合や新たな問題が出た場合は Phase 3 に戻って修正する。

---

## Phase 6: CodeRabbit CLI レビュー

### 6-1. ステージング

```bash
git add .
git status   # 対象ファイルを確認
```

### 6-2. レビュー実行

```bash
coderabbit review --prompt-only --type uncommitted
```

### 6-3. 指摘対応ループ

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

## Phase 7: セルフレビュー

`self-review` スキルの2パスチェックリストを実行する。

- Pass 1: `npm run lint` / `npm run build` / 型安全 / 命名規則
- Pass 2: 実装指針 / セキュリティ / エラー処理 / コード品質

---

## Phase 8: コミット

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
- 例: `React DoctoによりuseContext→use()置き換えおよびContext.Provider構文を修正`
- `[Self-Review: Passed]` などをコミットメッセージに含めない

---

## Phase 9: PR作成

```bash
git push -u origin HEAD

gh pr create \
  --title "<変更内容を端的に表す英語タイトル>" \
  --body "$(cat <<'EOF'
## 概要

<!-- React Doctor で検出された問題の修正内容を2〜3行で -->

## 変更内容

- 
- 

## React Doctor スコア

| | スコア | Actionable Issues |
|---|---|---|
| 修正前 | <!-- X --> | <!-- N 件 --> |
| 修正後 | <!-- Y --> | <!-- 0 件 --> |

## 開発プロセス記録

> レビュアーが実装の品質担保過程を確認できるよう、各ステップの結果を記載する。

### Lint / Build

- `npm run lint`: ✅ エラーなし
- `npm run build`: ✅ エラーなし

### React Doctor 再診断

- スコア変化: <!-- X → Y -->
- 解消した Issues: <!-- 箇条書きで -->

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

PR作成後、GitHub上でCodeRabbitの自動レビューが走るのを確認する（`.coderabbit.yaml` の `auto_review.enabled: true` により自動実行）。

---

## チェックリスト（完了基準）

- [ ] React Doctor スコアが修正前より上昇している
- [ ] 修正対象の Actionable Issues がすべて解消されている
- [ ] `npm run lint` エラーなし
- [ ] `npm run build` エラーなし
- [ ] CodeRabbit CLI Actionable Comments: 0
- [ ] `self-review` 2パス完了
- [ ] コミットメッセージが日本語1行
- [ ] PR本文にスコア変化と修正内容が記載されている
- [ ] PR作成後にCodeRabbitの自動レビューが表示される

---

## トラブルシューティング

### react-doctor が動かない

```bash
# npx キャッシュをクリアして再実行
npx clear-npx-cache
npx -y react-doctor@latest . --verbose --diff
```

### スコアが改善しない

- `--diff` オプションを外して全体スコアを確認する
- 修正したファイルが正しく保存されているか確認する
- `npm run build` でビルドエラーがないか確認する（ビルドエラーがあると診断精度が落ちる場合がある）

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
