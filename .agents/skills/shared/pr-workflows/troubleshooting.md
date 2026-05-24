# トラブルシューティング

## CodeRabbit CLIが動かない

```bash
# 認証確認
coderabbit auth login

# ステージング確認（git add が必要）
git status
```

## `coderabbit review` で "stopping cli" エラー

```bash
git add .
git status   # ファイルが追跡されているか確認
```

## PR作成で認証エラー

```bash
gh auth status
gh auth login
```

## CodeRabbitの自動レビューが走らない

`.coderabbit.yaml` の `auto_review.enabled` が `true` かを確認。またはPR上で `@coderabbitai review` とコメントして手動トリガーする。
