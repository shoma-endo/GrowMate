#!/usr/bin/env bash
# TAKT runtime.prepare 用: HEAD が origin/develop を含むことを fail-fast 検査する。
#
# - 相対パス `scripts/takt-check-base-branch.sh` で参照する（cwd = リポジトリ根）。
# - fetch 失敗時は古い origin/develop で通さない。
# - 通過時の1行は stdout へ出すが KEY=value 形式にはしない（prepare の環境注入と衝突させない）。
# - スキップ用 env は置かない（ゲートの抜け道を作らない）。
set -euo pipefail

if ! git fetch origin develop --quiet; then
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

# KEY=value ではないプレーン1行（parseScriptOutput は '=' 無し行を無視する）
printf '%s\n' "基準ブランチ: origin/develop@${develop_sha} / HEAD: ${branch}@${head_sha}"
