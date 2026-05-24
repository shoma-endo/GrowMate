# ブランチ準備

```bash
# 現在のブランチを確認
git status
git branch

# develop から新ブランチを切る
git checkout develop && git pull
git checkout -b <branch-name>
```

ブランチ名は作業内容に応じて付ける（例: `feature/google-ads-evaluation`, `fix/react-security-issues`）。
