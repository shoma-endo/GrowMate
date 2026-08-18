#!/usr/bin/env bash
# spec-to-pr の runtime.prepare で run 開始前に外部 CLI provider の認証を検査する。
# 認証切れのまま走ると途中の step（cursor: review / create_pr、codex: coder 系・
# supervisor・内部エージェント）が死んで run 全体が無駄になるため fail-fast させる
# （prepare の非0終了は takt が throw して step 実行前に止まる）。
#
# 制約:
# - prepare の stdout は KEY=VALUE の env 注入として解析されるため、
#   ログはすべて stderr に出す。
# - 検査できるのは認証のみ。クォータ枯渇（resource_exhausted 等）は
#   実呼び出しでしか分からないのでここでは検知しない。
set -euo pipefail

failed=0

check() {
  local label="$1"; shift
  local login_hint="$1"; shift
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[check-provider-auth] ${label}: $1 が PATH にありません" >&2
    failed=1
    return
  fi
  if ! "$@" >&2 2>&1; then
    echo "[check-provider-auth] ${label}: 未認証です。'${login_hint}' を実行してから再 run してください" >&2
    failed=1
  fi
}

check "Cursor" "cursor-agent login" cursor-agent status
check "Codex" "codex login" codex login status

exit "$failed"
