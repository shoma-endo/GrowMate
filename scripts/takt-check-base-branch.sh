#!/usr/bin/env bash
# TAKT runtime.prepare: fail-fast unless HEAD contains origin/develop.
set -euo pipefail

# Explicit refmap so a remote.origin.fetch that omits develop cannot leave
# origin/develop stale while only FETCH_HEAD advances.
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

# Plain line (no KEY=value) so prepare's parseScriptOutput does not inject it.
printf '%s\n' "基準ブランチ: origin/develop@${develop_sha} / HEAD: ${branch}@${head_sha}"
