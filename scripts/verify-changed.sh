#!/usr/bin/env bash
# Working tree（HEAD との差分 + untracked）にプロダクション影響パスが
# 含まれるときだけ `npm run verify` を実行する。
# docs / README / .takt / .agents 等のみの変更ではスキップして 0 終了。
#
# 用途: TAKT spec-to-pr の fix / self_review_fix quality_gates。
# implement 初回ゲートはフル `npm run verify` のまま（本スクリプトを使わない）。
#
# 使い方:
#   bash scripts/verify-changed.sh           # 差分判定
#   bash scripts/verify-changed.sh --force   # 常にフル verify
#   npm run verify:changed
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# cwd がリポジトリ内ならそれを優先（npm run の cwd=. と一致）。
# スクリプトが別場所にあっても、親ディレクトリが GrowMate ルートならそこへ。
if ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  :
elif ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  echo "verify-changed: git リポジトリを特定できない" >&2
  exit 1
fi
cd "$ROOT"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

# プロダクション影響ありとみなすパス（先頭一致 / ファイル名一致）
is_production_path() {
  local f="$1"
  f="${f#./}"
  case "$f" in
    app/*|src/*|tests/*|supabase/*|public/*|scripts/*)
      return 0
      ;;
    proxy.ts|next.config.ts|next.config.js|next.config.mjs| \
    tsconfig.json|vitest.config.ts|vitest.config.mts| \
    eslint.config.mjs|eslint.config.js|knip.config.ts|postcss.config.mjs| \
    package.json|package-lock.json|components.json|next-env.d.ts)
      return 0
      ;;
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx)
      return 0
      ;;
  esac
  case "$f" in
    tsconfig.*.json)
      return 0
      ;;
  esac
  return 1
}

collect_changed_paths() {
  {
    git diff --name-only HEAD
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } | awk 'NF' | sort -u
}

if [[ "$FORCE" -eq 1 ]]; then
  echo "verify-changed: --force → npm run verify"
  exec npm run verify
fi

changed_list="$(collect_changed_paths || true)"
if [[ -z "${changed_list}" ]]; then
  echo "verify-changed: working tree に差分なし → verify スキップ"
  exit 0
fi

prod_hits=""
other_hits=""
prod_count=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if is_production_path "$f"; then
    prod_hits="${prod_hits}${f}"$'\n'
    prod_count=$((prod_count + 1))
  else
    other_hits="${other_hits}${f}"$'\n'
  fi
done <<< "${changed_list}"

if [[ "$prod_count" -eq 0 ]]; then
  echo "verify-changed: プロダクション影響パスなし → verify スキップ"
  echo "  変更例:"
  echo "${other_hits}" | head -n 8 | sed '/^$/d' | sed 's/^/    /'
  if git diff --name-only HEAD | grep -q .; then
    git diff --check HEAD || exit $?
  fi
  exit 0
fi

echo "verify-changed: プロダクション影響 ${prod_count} 件 → npm run verify"
echo "${prod_hits}" | sed '/^$/d' | head -n 20 | sed 's/^/  /'
if [[ "$prod_count" -gt 20 ]]; then
  echo "  ... 他 $((prod_count - 20)) 件"
fi
exec npm run verify
