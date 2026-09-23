#!/usr/bin/env sh
# Claude Code の編集前フック（PreToolUse: Edit|Write|MultiEdit）。
# UI ファイル（app/**/*.tsx・src/components/**/*.tsx）を編集する直前に、growmate-ui-ux の
# 要点をエージェントの文脈へ差し込む。skill を読まずに UI を書き始めるのを防ぐため
# （2026-09-23、skill を読まずに Instagram タブを実装し、ブログ一覧と見た目がずれた）。
#
# 編集は止めない（permissionDecision を返さない）。UI 以外のファイルでは何も出力せず exit 0。
# Cursor の afterFileEdit は編集後で文脈を返す口が無く、Codex は未検証のため Claude Code だけに
# 配線している。他のエージェントには AGENTS.md の Core Rules で同じ前提を読ませる。
# shellgate: skip pipefail — POSIX sh で実行する（pipefail は無い）。パイプも使っていない。
# 失敗しても編集を止めないのが意図（fail-open）。
set -eu

command -v python3 >/dev/null 2>&1 || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

ROOT="$root" python3 -c '
import json, os, sys

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
path = (d.get("tool_input") or {}).get("file_path") or ""
if not path:
    sys.exit(0)
cwd = d.get("cwd") or ""
rel = path
for base in (cwd, os.environ.get("ROOT", "")):
    if base and rel.startswith(base.rstrip("/") + "/"):
        rel = rel[len(base.rstrip("/")) + 1:]
        break
if not rel.endswith(".tsx") or not (rel.startswith("app/") or rel.startswith("src/components/")):
    sys.exit(0)

text = (
    f"UI ファイル {rel} を編集する。.agents/skills/growmate-ui-ux/SKILL.md に従うこと。"
    "未読なら編集前に読む。"
    "(1) 同種の既存 UI を grep で全件探し「UI 既存パターン対照表」（今回の要素 / 既存の file:line / "
    "そのまま使う・共通化・写す・新規 / 変える点と根拠）を作ってから書く。"
    "(2) 同種の既存 UI があれば、そのまま使う > 共通化 > マークアップとクラスを変えずに写す、の順。"
    "見出し・文言・色クラス・title / aria-label・アイコン・余白を自分の判断で変えない。"
    "既存が生の Tailwind 色なら写す側も同じ色にし、トークンへ置き換えない"
    "（eslint --suppress-rule shadcn/no-raw-colors で抑制）。"
    "(3) ユーザー向け文言は .agents/skills/growmate-ui-ux/ui-text.md の用語辞書に無い語を新造しない。"
)
print(json.dumps({
    "hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": text},
}, ensure_ascii=False))
'
