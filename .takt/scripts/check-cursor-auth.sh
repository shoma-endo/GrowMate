#!/usr/bin/env bash
# spec-to-pr の runtime.prepare で run 開始前に Cursor CLI の認証を検査する。
# 認証切れのまま走ると review / create_pr ステップ（provider: cursor）が
# 途中死して run 全体が無駄になるため、ここで fail-fast させる
# （prepare の非0終了は takt が throw して step 実行前に止まる）。
#
# 制約:
# - prepare の stdout は KEY=VALUE の env 注入として解析されるため、
#   ログはすべて stderr に出す。
# - 検査できるのは認証のみ。クォータ枯渇（resource_exhausted）は
#   実呼び出しでしか分からないのでここでは検知しない。
set -euo pipefail

if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "[check-cursor-auth] cursor-agent が PATH にありません" >&2
  exit 1
fi

if ! cursor-agent status >&2; then
  echo "[check-cursor-auth] Cursor CLI が未認証です。'cursor-agent login' を実行してから再 run してください" >&2
  exit 1
fi
