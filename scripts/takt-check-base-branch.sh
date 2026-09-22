#!/usr/bin/env bash
set -euo pipefail

export GIT_TERMINAL_PROMPT=0

if ! git fetch origin '+refs/heads/develop:refs/remotes/origin/develop' --quiet; then
  printf '%s\n' "✗ origin/develop の fetch に失敗しました。ネットワークを確認してから再実行してください。" >&2
  exit 1
fi

if ! git merge-base --is-ancestor origin/develop HEAD; then
  behind="$(git rev-list --count HEAD..origin/develop 2>/dev/null || printf '%s' '?')"
  printf '%s\n' "✗ HEAD が origin/develop を含んでいません（behind=${behind}）。" >&2
  printf '%s\n' "  git rebase origin/develop（または merge）してから再実行してください。" >&2
  exit 1
fi

develop_sha="$(git rev-parse --short origin/develop)"
head_sha="$(git rev-parse --short HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "${branch}" || "${branch}" == "HEAD" ]]; then
  branch="detached"
fi
# prepare の parseScriptOutput は '=' 行を KEY=value と解釈する。ブランチ名の '=' を潰す。
branch="${branch//=/_}"

printf '%s\n' "基準ブランチ: origin/develop@${develop_sha} / HEAD: ${branch}@${head_sha}"
