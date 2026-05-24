# CodeRabbit CLI レビュー

## ステージング

レビューしたいファイルをステージングする:

```bash
git add .
git status   # 対象ファイルを確認
```

## レビュー実行

```bash
coderabbit review --prompt-only --type uncommitted
```

## 指摘対応ループ

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
