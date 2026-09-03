#!/usr/bin/env bash
# 肥大化ファイルの上位を Markdown 表で出す。月次メンテ（docs/runbooks/monthly-maintenance.md）の
# hotspot レビュー入力。空行・コメント行を除いた実行行数で並べる（eslint max-lines の
# skipBlankLines/skipComments の近似。JSX 内コメントやテンプレートリテラル内の /* */ で数行ズレる）。
#
# 使い方:
#   bash scripts/hotspots.sh        # 上位 5 件
#   bash scripts/hotspots.sh 10     # 上位 10 件
#   npm run hotspots
#
# 列: 実行行数 / churn（git log の出現回数、既定 90 日） / テスト参照
#   テスト参照は tests/ 配下に「そのモジュールパスを import する行」があるか。
#   vi.mock() だけの行は数えない（丸ごと差し替えているファイルは検証していないため）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TOP="${1:-5}"
CHURN_SINCE="${HOTSPOT_CHURN_SINCE:-90.days}"

code_lines() {
  grep -cvE '^\s*$|^\s*//|^\s*/\*|^\s*\*' "$1" || true
}

churn_file="$(mktemp)"
trap 'rm -f "$churn_file"' EXIT
git log --since="$CHURN_SINCE" --name-only --format= -- src app \
  | { grep -E '\.tsx?$' || true; } | sort | uniq -c | awk '{print $2"\t"$1}' > "$churn_file"

churn_of() {
  awk -F'\t' -v f="$1" '$1==f {print $2; found=1} END {if(!found) print 0}' "$churn_file"
}

# src/server/services/x.ts → server/services/x（@/server/services/x で import される形）
# app/api/x/route.ts        → app/api/x/route
has_test() {
  local key="$1"
  key="${key#src/}"
  key="${key%.*}"
  if grep -rF --include='*.ts' --include='*.tsx' -- "$key" tests 2>/dev/null \
      | grep -vF 'vi.mock(' | grep -q .; then
    echo "あり"
  else
    echo "なし"
  fi
}

echo "## hotspots 上位 ${TOP}（実行行数順 / churn は直近 ${CHURN_SINCE}）"
echo
echo "| # | ファイル | 実行行数 | churn | テスト参照 |"
echo "| ---: | --- | ---: | ---: | --- |"

i=0
while IFS=$'\t' read -r lines file; do
  i=$((i + 1))
  echo "| ${i} | \`${file}\` | ${lines} | $(churn_of "$file") | $(has_test "$file") |"
done < <(
  find src app -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name 'database.types.ts' ! -name '*.d.ts' -print0 \
    | while IFS= read -r -d '' f; do
        printf '%s\t%s\n' "$(code_lines "$f")" "${f#./}"
      done \
    | sort -t$'\t' -k1,1nr \
    | head -n "$TOP"
)

echo
echo "判定は 1 件 1 行で \`分割する / 今回は放置 / 次回再判定\` と理由を書く。\`分割する\` は docs/plans/<slug>.md を起こして spec-review へ。"
