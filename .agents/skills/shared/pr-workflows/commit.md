# コミット

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
- `[Self-Review: Passed]` などをコミットメッセージに含めない
