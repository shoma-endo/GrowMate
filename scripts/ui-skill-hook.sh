#!/usr/bin/env sh
# UI 編集前に growmate-ui-ux の要点をエージェントの文脈へ差し込むフック。
# skill を読まずに UI を書き始めるのを防ぐため（2026-09-23、skill を読まずに Instagram タブを
# 実装し、ブログ一覧と見た目がずれた）。編集は止めない。
#
# エージェントごとの差分はここに吸収する（呼び出し側は同じスクリプトを指す）:
#   Claude Code  .claude/settings.json  PreToolUse(Edit|Write|MultiEdit)  tool_input.file_path
#   Codex        .codex/hooks.json      PreToolUse(apply_patch)           tool_input.command（パッチ本文）
#   Cursor       .cursor/hooks.json     sessionStart（--session-start）
#     Cursor の preToolUse は拒否したときしかエージェントへ文を返せず、afterFileEdit は文脈を
#     返す口が無い（https://cursor.com/docs/agent/hooks）。止めずに編集前へ届くのは sessionStart の
#     additional_context だけなので、セッション開始時に1回だけ差し込む。
#
# UI ファイル（app/**/*.tsx・src/components/**/*.tsx）が対象でなければ何も出力せず exit 0。
# shellgate: skip pipefail — POSIX sh で実行する（pipefail は無い）。パイプも使っていない。
# 失敗しても編集を止めないのが意図（fail-open）。
set -eu

command -v python3 >/dev/null 2>&1 || exit 0

MODE="${1:-}" python3 -c '
import json, os, re, sys

RULES = (
    ".agents/skills/growmate-ui-ux/SKILL.md に従うこと。未読なら編集前に読む。"
    "(1) 同種の既存 UI を grep で全件探し「UI 既存パターン対照表」（今回の要素 / 既存の file:line / "
    "そのまま使う・共通化・写す・新規 / 変える点と根拠）を作ってから書く。"
    "(2) 同種の既存 UI があれば、そのまま使う > 共通化 > マークアップとクラスを変えずに写す、の順。"
    "見出し・文言・色クラス・title / aria-label・アイコン・余白を自分の判断で変えない。"
    "既存が生の Tailwind 色なら、写す側だけをトークンへ置き換えてはならない。"
    "写すと生の色の違反が増えるので写さず、既存ファイル内で部品を export して共通化する（suppressions は増やさない）。"
    "(3) ユーザー向け文言は .agents/skills/growmate-ui-ux/ui-text.md の用語辞書に無い語を新造しない。"
)

if os.environ.get("MODE") == "--session-start":
    # Cursor sessionStart: 編集前に届く唯一の口。UI を触るかはまだ分からないので条件付きで書く
    print(json.dumps({
        "additional_context": "このリポジトリで UI（app/**/*.tsx・src/components/**/*.tsx）を変えるときは " + RULES,
    }, ensure_ascii=False))
    sys.exit(0)

try:
    d = json.load(sys.stdin)
    ti = d.get("tool_input") or {}
    # Claude Code は file_path、Codex の apply_patch はパッチ本文（command）にパスが入る。
    # パッチの書式に依存しないよう、どちらも文字列全体から UI ファイルのパスを探す
    candidates = [ti.get("file_path"), ti.get("command"), d.get("file_path")]
    event = d.get("hook_event_name") or "PreToolUse"
except Exception:
    sys.exit(0)

paths = []
for c in candidates:
    if isinstance(c, str):
        for m in re.finditer(r"(?:^|[/\s])((?:app|src/components)/[^\s\"]+?\.tsx)(?=$|[\s\"])", c, re.M):
            if m.group(1) not in paths:
                paths.append(m.group(1))
if not paths:
    sys.exit(0)

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": event,
        "additionalContext": "UI ファイル " + "・".join(paths) + " を編集する。" + RULES,
    },
}, ensure_ascii=False))
'
