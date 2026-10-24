#!/usr/bin/env bash
# 夜通しの takt run を、preflight と実行時間の上限つきで回す（docs/runbooks/takt-overnight-preflight.md）。
#
#   ./scripts/takt-overnight.sh [--limit-minutes N] [--ui] [--verify]   # 既定は 480 分
#
# TAKT には run 全体の実行時間の上限キーが無い（max_steps は step 数、guards.call_timeout_ms は無応答時間）。
# 上限に達したら SIGINT で中断させる。中断した run は takt の通常の中断扱いになり、翌朝 resume できる。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

limit_minutes=480
preflight_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit-minutes)
      limit_minutes="${2:?--limit-minutes に分数を指定する}"
      shift 2
      ;;
    --ui | --verify)
      preflight_args+=("$1")
      shift
      ;;
    *)
      printf '不明な引数: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done
if ! [[ "$limit_minutes" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s\n' "--limit-minutes は正の整数で指定する: ${limit_minutes}" >&2
  exit 2
fi

./scripts/takt-preflight.sh "${preflight_args[@]+"${preflight_args[@]}"}"
TAKT_BIN="$(./scripts/resolve-takt-bin.sh)"

limit_seconds=$((limit_minutes * 60))
# takt が SIGINT を受けてから後始末を終えるまで待つ時間
grace_seconds=120

"$TAKT_BIN" run &
takt_pid=$!

(
  sleep "$limit_seconds"
  if kill -0 "$takt_pid" 2>/dev/null; then
    printf '✗ 実行時間の上限（%s 分）に達したので中断します\n' "$limit_minutes" >&2
    kill -INT "$takt_pid" 2>/dev/null || true
    sleep "$grace_seconds"
    kill -TERM "$takt_pid" 2>/dev/null || true
  fi
) &
watchdog_pid=$!

status=0
wait "$takt_pid" || status=$?
# 見張りの sleep ごと止める（残すと上限まで sleep が残る）
pkill -P "$watchdog_pid" 2>/dev/null || true
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true

if [[ "$status" -eq 0 ]]; then
  echo "✓ takt run 終了"
else
  printf '✗ takt run が終了コード %s で止まりました（.takt/runs/ の最新 run を確認）\n' "$status" >&2
fi
exit "$status"
