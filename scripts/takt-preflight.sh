#!/usr/bin/env bash
#   ./scripts/takt-preflight.sh [--ui] [--verify]
#   --ui: UI 証跡の前提を必須にする / --verify: 土台で npm run verify が通るかも見る（約10分）
# 夜通しのログに残るので、秘密の値は読まない・出さない。env ファイルとログイン状態は存在だけを見る。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

require_ui=0
run_verify=0
for arg in "$@"; do
  case "$arg" in
    --ui) require_ui=1 ;;
    --verify) run_verify=1 ;;
    *) printf '不明な引数: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

errors=0
ok() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; errors=$((errors + 1)); }
warn() { printf '! %s\n' "$1" >&2; }

echo "--- git ---"
branch="$(git rev-parse --abbrev-ref HEAD)"
# develop / main 上で回すと create_pr が土台ブランチへ直接 push する
if [[ "$branch" == "develop" || "$branch" == "main" || "$branch" == "HEAD" ]]; then
  fail "作業ブランチが ${branch}。feature ブランチに切り替えてから回す"
else
  ok "ブランチ: ${branch}"
fi
if [[ -n "$(git status --porcelain)" ]]; then
  fail "作業ツリーに未 commit の変更がある"
else
  ok "作業ツリーは clean"
fi
if bash scripts/takt-check-base-branch.sh >/dev/null; then
  ok "origin/develop を含んでいる"
else
  fail "origin/develop を含んでいない（scripts/takt-check-base-branch.sh）"
fi

echo "--- takt ---"
if TAKT_BIN="$(./scripts/resolve-takt-bin.sh)"; then
  ok "takt pin: ${TAKT_BIN}"
else
  fail "takt pin 未解決（./scripts/takt-install-pinned.sh）"
  TAKT_BIN=""
fi
if [[ -n "$TAKT_BIN" ]]; then
  if "$TAKT_BIN" workflow doctor .takt/workflows/spec-review.yaml .takt/workflows/spec-to-pr.yaml >/dev/null 2>&1; then
    ok "workflow doctor"
  else
    fail "workflow doctor が失敗（${TAKT_BIN} workflow doctor .takt/workflows/spec-to-pr.yaml）"
  fi

  echo "--- 権限 ---"
  for workflow in spec-review spec-to-pr; do
    if ! inspect="$("$TAKT_BIN" workflow inspect "$workflow" 2>&1)"; then
      fail "${workflow}: workflow inspect が失敗（${TAKT_BIN} workflow inspect ${workflow}）"
      continue
    fi
    providers="$(grep -E '^\[INFO\] +provider: ' <<<"$inspect" | sed -E 's/.*provider: ([^ ]+).*/\1/' | sort -u | tr '\n' ' ' || true)"
    if [[ "$providers" == "claude-sdk " ]]; then
      ok "${workflow}: 全 step が claude-sdk"
    else
      fail "${workflow}: claude-sdk 以外の provider が解決される（${providers:-解決結果なし}）。.takt/runtime.yaml を確認"
    fi
    if grep -qE '^\[INFO\] +permissionMode: full' <<<"$inspect"; then
      fail "${workflow}: permissionMode: full（Claude では bypassPermissions）に解決される step がある"
    else
      ok "${workflow}: full / bypassPermissions の step なし"
    fi
  done
  if grep -rnE '^[^#]*(required_permission_mode: *full|permission_mode: *full|bypassPermissions)' .takt/workflows .takt/config.yaml .takt/runtime.yaml >/dev/null; then
    fail ".takt に full / bypassPermissions の指定がある"
  fi
fi
requeue="${TAKT_AUTO_REQUEUE_MAX_ATTEMPTS:-$(sed -nE 's/^auto_requeue_max_attempts: *([0-9]+).*/\1/p' .takt/config.yaml)}"
if [[ "$requeue" == "1" ]]; then
  ok "auto_requeue_max_attempts: 1"
else
  fail "auto_requeue_max_attempts が 1 でない（${requeue:-未設定}。TAKT_AUTO_REQUEUE_MAX_ATTEMPTS の上書きも確認）"
fi

echo "--- 認証 ---"
# TAKT_RUNTIME_ROOT があると、この検査は API キーを stdout に出す
if bash scripts/takt-check-provider-auth.sh >/dev/null 2>&1; then
  ok "Anthropic 認証"
else
  fail "Anthropic 認証がない（scripts/takt-check-provider-auth.sh）"
fi
if gh auth status >/dev/null 2>&1; then
  ok "gh auth"
else
  fail "gh が未ログイン（gh auth login）"
fi

echo "--- テスト準備 ---"
if npm ls --depth=0 >/dev/null 2>&1; then
  ok "package.json の依存が node_modules に揃っている"
else
  fail "package.json の依存が node_modules に揃っていない（npm ci）"
fi
if node -e "require('playwright').chromium.launch().then((browser) => browser.close())" >/dev/null 2>&1; then
  ok "Playwright Chromium が起動する"
elif [[ "$require_ui" -eq 1 ]]; then
  fail "Playwright の Chromium が無い（npx playwright install chromium）"
else
  warn "Playwright の Chromium が無い（UI 変更のある仕様を流すなら npx playwright install chromium）"
fi

echo "--- 環境 ---"
for name in TAKT_UI_ENV_FILE TAKT_UI_STORAGE_STATE; do
  value="${!name:-}"
  # takt run は clone の中で動くため、相対パスだと見つからない
  if [[ "$value" == /* && -f "$value" ]]; then
    ok "${name} のファイルあり"
  elif [[ "$require_ui" -eq 1 ]]; then
    fail "${name} が未設定、絶対パスでない、またはファイルが無い（takt run の clone には .env.local とログイン状態が無い）"
  else
    warn "${name} が未設定（UI 変更のある仕様は ui_evidence で止まる）"
  fi
done
if [[ -n "${TAKT_NOTIFY_WEBHOOK:-}" ]]; then
  ok "TAKT_NOTIFY_WEBHOOK あり"
else
  warn "TAKT_NOTIFY_WEBHOOK が未設定（失敗しても通知されない）"
fi

if [[ "$run_verify" -eq 1 ]]; then
  echo "--- npm run verify ---"
  if npm run verify >/dev/null 2>&1; then
    ok "npm run verify"
  else
    fail "npm run verify が土台の時点で失敗する（夜通し回しても implement の quality gate で止まる）"
  fi
fi

echo
if [[ "$errors" -gt 0 ]]; then
  printf '✗ preflight: %d 件の問題。直してから回す\n' "$errors" >&2
  exit 1
fi
echo "✓ preflight 通過"
