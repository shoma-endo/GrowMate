#!/usr/bin/env sh
# Claude Code / Codex の PostToolUse フック。docs/plans/*.md が編集されたら図解 HTML を追従させる。
#
# 機械生成できるのは全文ビュー（04）と結合 HTML だけ。再構成ビュー（01〜03）は
# core.yaml を LLM が解釈して書くので触らない。代わりに整合性チェックが参照ズレを
# 検出したら、その出力を additionalContext としてエージェントに差し戻す。
#
# 更新不要なら何も出力せず exit 0（無言）。失敗しても編集をブロックしない。
set -eu

command -v python3 >/dev/null 2>&1 || exit 0

root="${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"
script="$root/scripts/spec-html.py"
[ -f "$script" ] || exit 0

if [ "${1:-}" = "--all" ]; then
  set -- --all
else
  payload=$(cat)
  file=$(printf '%s' "$payload" | python3 -c \
    'import json,sys; print((json.load(sys.stdin).get("tool_input") or {}).get("file_path") or "")' \
    2>/dev/null) || exit 0
  [ -n "$file" ] || exit 0
  set -- --spec "$file"
fi

# 対象外パス・バンドル無しは refresh 側が黙って捨てるので、ここでは絞り込まない
out=$(python3 "$script" refresh "$@" 2>&1) || true
[ -n "$out" ] || exit 0

OUT="$out" python3 <<'PY'
import json, os

out = os.environ["OUT"]
stale = "陳腐化" in out
print(json.dumps({
    "systemMessage": "図解 HTML を再生成しました" + ("（core.yaml の貼り直しが必要）" if stale else ""),
    "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": out},
}, ensure_ascii=False))
PY
