#!/usr/bin/env bash
# 肥大化ファイルの上位を Markdown 表で出す。月次メンテ（docs/runbooks/monthly-maintenance.md）の
# hotspot レビュー入力。eslint max-lines と同じく空行・コメント行を除いた実行行数で並べる。
#
# 使い方:
#   bash scripts/hotspots.sh        # 上位 5 件
#   bash scripts/hotspots.sh 10     # 上位 10 件
#   npm run hotspots
#
# 列: 実行行数 / 90日 churn（git log の出現回数） / テスト有無（tests/ に basename の参照があるか）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TOP="${1:-5}"
CHURN_SINCE="${HOTSPOT_CHURN_SINCE:-90.days}"

# 実行行数: 空行と、// または /* * */ で始まるコメント行を除く（eslint max-lines の skipBlankLines/skipComments 相当の近似）
code_lines() {
  grep -cvE '^\s*$|^\s*//|^\s*/\*|^\s*\*' "$1" || true
}

churn_file="$(mktemp)"
trap 'rm -f "$churn_file"' EXIT
git log --since="$CHURN_SINCE" --name-only --format= -- src app \
  | grep -E '\.tsx?$' | sort | uniq -c | awk '{print $2"\t"$1}' > "$churn_file"

churn_of() {
  awk -F'\t' -v f="$1" '$1==f {print $2; found=1} END {if(!found) print 0}' "$churn_file"
}

has_test() {
  local base
  base="$(basename "$1")"
  base="${base%.*}"
  if grep -rlF --include='*.ts' --include='*.tsx' -- "$base" tests >/dev/null 2>&1; then
    echo "あり"
  else
    echo "なし"
  fi
}

echo "## hotspots 上位 ${TOP}（実行行数順 / churn は直近 ${CHURN_SINCE}）"
echo
echo "| # | ファイル | 実行行数 | 90日 churn | テスト |"
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
