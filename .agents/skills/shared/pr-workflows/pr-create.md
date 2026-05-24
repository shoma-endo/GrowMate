# PR作成

```bash
git push -u origin HEAD

gh pr create \
  --title "<変更内容を端的に表す英語タイトル>" \
  --body "$(cat <<'EOF'
<PR本文テンプレートは各フローの SKILL.md を参照>
EOF
)"
```

PR作成後、GitHub上でCodeRabbitの自動レビューが走るのを確認する（`.coderabbit.yaml` の `auto_review.enabled: true` により自動実行）。
