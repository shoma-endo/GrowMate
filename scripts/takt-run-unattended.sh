#!/usr/bin/env bash
# GrowMate 無人 TAKT workflow（spec-review / spec-to-pr）を Cloud / CI / ローカルで起動する。
#
# 用法:
#   ./scripts/takt-run-unattended.sh spec-review -t "docs/plans/<slug>.md をレビューしてください"
#   ./scripts/takt-run-unattended.sh spec-to-pr -t "docs/plans/<slug>.md 仕様書に沿って実装してください"
#
# - pin 版 takt を解決（無ければ設置）
# - --pipeline --quiet で非対話実行（Grill Me 系は対象外）
# - provider 既定はプロジェクト .takt/config.yaml の claude-sdk
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

WORKFLOW="${1:-}"
shift || true

if [[ -z "${WORKFLOW}" ]]; then
  printf '%s\n' "用法: $0 <spec-review|spec-to-pr> [takt 追加引数...]" >&2
  printf '%s\n' "例:   $0 spec-review -t \"docs/plans/foo.md をレビューしてください\"" >&2
  exit 2
fi

case "${WORKFLOW}" in
  spec-review | spec-to-pr) ;;
  grill-to-gherkin)
    printf '%s\n' "✗ grill-to-gherkin は interactive_only のため無人ラッパー対象外です。" >&2
    exit 2
    ;;
  *)
    printf '%s\n' "✗ 未対応 workflow: ${WORKFLOW}（spec-review / spec-to-pr のみ）" >&2
    exit 2
    ;;
esac

if ! TAKT_BIN="$("${ROOT}/scripts/resolve-takt-bin.sh")"; then
  echo "=== pin 版 takt を設置します ==="
  "${ROOT}/scripts/takt-install-pinned.sh"
  TAKT_BIN="$("${ROOT}/scripts/resolve-takt-bin.sh")"
fi

exec "${TAKT_BIN}" --pipeline --quiet -w "${WORKFLOW}" "$@"
