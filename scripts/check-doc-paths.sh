#!/usr/bin/env bash
# 仕様書が参照するコードパスの陳腐化検出。
#
# docs 配下の .md が参照する src/ app/ supabase/ scripts/ のパスのうち、
# 実在しないものを検出する。ただし設計書は「これから作る／消すファイル」も書くため、
# そのパスに言及している行のいずれかに意図マーカー（新規 / 削除 / 不要 / 廃止 / 未実装）が
# あれば正常とみなす。マーカーが無いまま実在しないパスは、改名・移動の取りこぼし
# （＝ spec-to-pr が存在しないファイルへの変更を指示する事故）とみなして落とす。
#
# 使い方:
#   bash scripts/check-doc-paths.sh              # docs 配下を全走査
#   bash scripts/check-doc-paths.sh a.md b.md    # 指定ファイルのみ（pre-commit 用）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

errors=0

fail() { echo -e "${RED}✗${NC} $1"; errors=$((errors + 1)); }

# 参照先として追跡するコードパス
PATH_RE='(src|app|supabase|scripts)/[A-Za-z0-9_/.@-]*\.(tsx?|sql|sh|py|json|yml|yaml)'
# 「実在しないのが正しい」ことを示す意図マーカー
MARKER_RE='新規|削除|不要|廃止|未実装'

targets=()
if [[ $# -gt 0 ]]; then
  for f in "$@"; do
    [[ -f "$f" && "$f" == *.md ]] && targets+=("$f")
  done
else
  while IFS= read -r f; do
    targets+=("$f")
  done < <(find docs -name '*.md' -type f | sort)
fi

if [[ ${#targets[@]} -eq 0 ]]; then
  exit 0
fi

echo "=== 仕様書パス参照チェック（${#targets[@]} ファイル）==="

for doc in "${targets[@]}"; do
  while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    # 実在すれば OK
    [[ -e "$ref" ]] && continue
    # YYYYMMDD 等のプレースホルダは対象外
    [[ "$ref" == *YYYY* ]] && continue
    # そのパスに言及している行のどれかに意図マーカーがあれば OK
    if grep -F -- "$ref" "$doc" | grep -qE "$MARKER_RE"; then
      continue
    fi
    fail "$doc: 実在しないパス \`$ref\`（改名・移動の取りこぼしの疑い）"
  done < <(grep -ohE "$PATH_RE" "$doc" 2>/dev/null | sort -u)
done

if [[ "$errors" -gt 0 ]]; then
  echo
  echo "対処のいずれか:"
  echo "  1. パスを実在するものに直す（改名・移動があった場合）"
  echo "  2. 意図的に未作成／削除予定なら、その行に 新規 / 削除 / 不要 / 廃止 / 未実装 を明記する"
  echo "  3. 一時的に回避する場合のみ git commit --no-verify"
  echo
  echo "errors: $errors"
  exit 1
fi

echo -e "${GREEN}✓${NC} 陳腐化した参照はありません。"
exit 0
