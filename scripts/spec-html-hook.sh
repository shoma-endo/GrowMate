#!/usr/bin/env sh
# Claude Code / Cursor / Codex の編集後フック。docs/plans/*.md が編集されたら図解 HTML を追従させる。
#
# 機械生成できるのは全文ビュー（04）と結合 HTML だけ。再構成ビュー（01〜03、および
# 05 画面仕様 / 06 UIモック）は core.yaml を LLM が解釈して書くので触らない。代わりに
# 整合性チェックが参照ズレを検出したら、その出力をエージェントへ差し戻す。
#
# 更新不要なら何も出力せず exit 0（無言）。失敗しても編集をブロックしない。
#
# エージェントごとの差分はここに吸収する（呼び出し側は同じスクリプトを指す）:
#   Claude Code  .claude/settings.json  PostToolUse(Edit|Write)  payload.tool_input.file_path
#   Cursor       .cursor/hooks.json     afterFileEdit            payload.file_path
#   Codex        .codex/hooks.json      PostToolUse(apply_patch) --all（apply_patch は
#                                       1回で複数ファイルを変更でき payload から絞れない）
set -eu

command -v python3 >/dev/null 2>&1 || exit 0

root="${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"
script="$root/scripts/spec-html.py"
[ -f "$script" ] || exit 0

event=""
if [ "${1:-}" = "--all" ]; then
  set -- --all
else
  payload=$(cat)
  # 1行目=編集されたファイル、2行目=フックイベント名（出力形式の分岐に使う）
  parsed=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
ti = d.get("tool_input") or {}
print(ti.get("file_path") or d.get("file_path") or "")
print(d.get("hook_event_name") or "")
' 2>/dev/null) || exit 0
  file=$(printf '%s\n' "$parsed" | sed -n 1p)
  event=$(printf '%s\n' "$parsed" | sed -n 2p)
  [ -n "$file" ] || exit 0
  set -- --spec "$file"
fi

# 対象外パス・バンドル無しは refresh 側が黙って捨てるので、ここでは絞り込まない
out=$(python3 "$script" refresh "$@" 2>&1) || true
[ -n "$out" ] || exit 0

# Cursor の afterFileEdit は fire-and-forget（追加コンテキストを受け取る口が無い）。
# 契約どおり空オブジェクトを返し、警告は stderr に出して人間の目に触れさせる。
case "$event" in
  afterFileEdit|afterTabFileEdit)
    printf '%s\n' "$out" >&2
    echo '{}'
    exit 0
    ;;
esac

OUT="$out" python3 <<'PY'
import json, os

out = os.environ["OUT"]
stale = "陳腐化" in out
print(json.dumps({
    "systemMessage": "図解 HTML を再生成しました" + ("（core.yaml の貼り直しが必要）" if stale else ""),
    "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": out},
}, ensure_ascii=False))
PY
