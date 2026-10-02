#!/usr/bin/env bash
# pin 版 takt で grill-to-gherkin を起動し、Grill Me の対話中に論点ツリーを表示させる。
# 使い方: ./scripts/takt-grill.sh "実装したい機能の概要"
set -euo pipefail

if [[ $# -eq 0 || -z "$*" ]]; then
  printf '%s\n' "✗ 実装したい機能の概要を引数で渡してください: ./scripts/takt-grill.sh \"概要\"" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAKT_BIN="$("${ROOT}/scripts/resolve-takt-bin.sh")"

# Grill Me の system prompt は TAKT 本体に固定され、プロジェクトから差し替えられない。
# 最初のユーザーメッセージは会話履歴に残り続けるため、表示ルールは -t の末尾に付ける。
TASK="$*

---
[対話中の表示ルール。/go で作る指示書には含めない]
- 最初の質問の前に、論点ツリーをテキストのインデントで出す（Mermaid は使わない）
- 各論点に [確定] / [未解決] / [OPEN: 今は決めない] / [CON: 懸念] を付ける。[確定] は結論を1行だけ。次に聞く論点に「← 次」を付ける
- 論点が追加・分割・削除・保留されたターンだけ、質問の前に最新のツリー全体を出す
- それ以外のターンは、質問の前に「確定 n / 未解決 n / OPEN n / CON n」の1行だけを出す"

exec "${TAKT_BIN}" -w grill-to-gherkin -t "${TASK}"
