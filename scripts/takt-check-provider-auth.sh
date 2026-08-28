#!/usr/bin/env bash
# TAKT runtime.prepare 用: 無人 workflow（spec-review / spec-to-pr）の認証を fail-fast 検査する。
#
# - 相対パス `scripts/takt-check-provider-auth.sh` で参照する（cwd = リポジトリ根）。
# - Cloud / CI は CLI ログインが無い前提。claude-sdk は API キーで起動する。
# - TAKT が注入する KEY=value は、prepare 実行時（TAKT_RUNTIME_ROOT あり）だけ stdout へ出す。
# - 秘密の有無だけを検査し、キー本体をログや手動実行の端末へ出さない。
set -euo pipefail

has_nonempty() {
  local name="$1"
  [[ -n "${!name:-}" ]]
}

# GrowMate / Next の ANTHROPIC_API_KEY が既にあれば TAKT 向けへ橋渡しする。
# ファイル（.env.local 等）は読まない。環境に載っている変数だけ使う。
if [[ -n "${TAKT_RUNTIME_ROOT:-}" ]]; then
  if ! has_nonempty TAKT_ANTHROPIC_API_KEY && has_nonempty ANTHROPIC_API_KEY; then
    printf 'TAKT_ANTHROPIC_API_KEY=%s\n' "${ANTHROPIC_API_KEY}"
  fi
  if ! has_nonempty TAKT_OPENAI_API_KEY && has_nonempty OPENAI_API_KEY; then
    printf 'TAKT_OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
  fi
fi

anthropic_ok=0
if has_nonempty TAKT_ANTHROPIC_API_KEY || has_nonempty ANTHROPIC_API_KEY; then
  anthropic_ok=1
elif command -v claude >/dev/null 2>&1; then
  # ローカル: Claude Code CLI ログイン済みなら API キー無しでも可
  anthropic_ok=1
fi

if [[ "${anthropic_ok}" -ne 1 ]]; then
  printf '%s\n' "✗ TAKT 無人実行の Anthropic 認証がありません。" >&2
  printf '%s\n' "  Cloud/CI: 環境変数 TAKT_ANTHROPIC_API_KEY を設定してください。" >&2
  printf '%s\n' "  ローカル: claude ログイン、または TAKT_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY。" >&2
  exit 1
fi

# create_pr / finalize は bash + gh で足りる（claude-sdk 可）。
# Cursor provider を使う場合のみ追加認証が要る。欠落は警告に留め、起動は止めない。
if ! has_nonempty TAKT_CURSOR_API_KEY && ! command -v cursor-agent >/dev/null 2>&1 && ! command -v agent >/dev/null 2>&1; then
  printf '%s\n' "ℹ Cursor CLI / TAKT_CURSOR_API_KEY は未検出（claude-sdk のみで継続）。" >&2
fi

printf '%s\n' "✓ TAKT provider auth check passed" >&2
