#!/usr/bin/env bash
# UI 表示文言の表記揺れ検出。
#
# 正本: .agents/skills/growmate-ui-ux/ui-text.md
# 変数名・関数名の命名規則は対象外（そちらは project-naming / eslint の担当）。
#
# 検査するのは「機械判定しても誤検出がほぼ出ない」項目に限る。
# スペースの有無・句点・略語の初出・文体は人が見る（quality-gate の手動確認）。
#
# 使い方:
#   bash scripts/check-ui-text.sh              # app/ src/ を全走査
#   bash scripts/check-ui-text.sh a.tsx b.ts   # 指定ファイルのみ（pre-commit 用）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

errors=0

# 走査対象から外すファイル。
#   prompts.ts / prompt-descriptions.ts は LLM への指示文であり画面表示ではない。
EXCLUDES=(
  '!src/lib/prompts.ts'
  '!src/lib/prompt-descriptions.ts'
  '!**/*.test.ts'
  '!**/*.test.tsx'
)

# ルール定義: <正規表現>@@<指摘文>
# 「誤」の表記だけにマッチさせ、正しい表記にはマッチさせないこと。
# 正規表現に | を含められるよう、区切りは @@ を使う。
RULES=(
  'Google ?広告@@「Google広告」→「Google Ads」（製品名は英字表記に統一）'
  'グーグル広告@@「グーグル広告」→「Google Ads」'
  'サーチコンソール@@「サーチコンソール」→「Google Search Console」'
  '(^|[^A-Za-z])Wordpress@@「Wordpress」→「WordPress」（P は大文字）'
  'ワードプレス@@「ワードプレス」→「WordPress」'
  'サインイン@@「サインイン」→「ログイン」'
  'サインアウト@@「サインアウト」→「ログアウト」'
  'サーバ[^ー]@@「サーバ」→「サーバー」（語尾の長音符を省略しない）'
  'ユーザ[^ーz]@@「ユーザ」→「ユーザー」（語尾の長音符を省略しない）'
  '下さい@@「下さい」→「ください」（補助動詞はひらく）'
  '出来(る|ま|な|た|ず)@@「出来る」→「できる」（補助的な語はひらく）'
  '無い場合@@「無い場合」→「ない場合」'
  '(中|しています)…@@進行中表現の三点リーダは半角ピリオド 3 つ「...」に統一（文字列を途中で切る「…」は対象外）'
  # ラベルとして終端するものだけを対象にする。文中の「削除処理中です。時間をおいて…」は
  # 普通の説明文なので対象外。
  '(取得|保存|読み込み|送信|生成|分析|同期|削除|検索|更新|作成|処理|実行|抽出|要約|インポート)中です(\.\.\.)?["'"'"'`<]@@進行中ラベルは「◯◯中です」→「◯◯中...」'
  '再度お試し@@「再度お試しください」→「もう一度お試しください」'
  '[ぁ-んァ-ヶ一-龥]！@@感嘆符は使わない（成功通知も事実を述べる）'
  '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}]@@絵文字を UI に使わない（アイコンは lucide-react）'
)

targets=()
if [[ $# -gt 0 ]]; then
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    case "$f" in
      app/*|src/*) ;;
      *) continue ;;
    esac
    case "$f" in
      *.ts|*.tsx) targets+=("$f") ;;
    esac
  done
  [[ ${#targets[@]} -eq 0 ]] && exit 0
else
  targets=(app src)
fi

echo "=== UI 文言 表記統一チェック ==="

# 開発者向けの記述（コメント）を落とす。ここを残すと `// ✅ 対応済み` のような
# コメントが UI 文言として誤検出される。
strip_comments() {
  # s コマンドの区切りは # を使う（正規表現側で | を素のまま書くため）
  printf '%s' "$1" | sed -E \
    -e 's#\{/\*.*\*/\}##g' \
    -e 's#/\*.*\*/##g' \
    -e 's#^[[:space:]]*(//|\*).*$##' \
    -e 's#([^:])//.*$#\1#'
}

for rule in "${RULES[@]}"; do
  pattern="${rule%%@@*}"
  message="${rule#*@@}"

  matched=()
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    # file:line:content → content
    rest="${hit#*:}"
    content="${rest#*:}"
    # console.* は開発者向け出力なので対象外
    [[ "$content" == *console.* ]] && continue
    # 正規表現リテラルの文字クラス（例: /^[✅✓]\s/）は表示文言ではない
    if [[ "$content" =~ \.(test|match|exec|split|replace)\(|RegExp\( ]]; then
      continue
    fi
    # コメントを除いた後もマッチするものだけを違反とみなす
    printf '%s' "$(strip_comments "$content")" | rg -q -e "$pattern" || continue
    matched+=("$hit")
  done < <(
    rg --line-number --with-filename --no-heading --color=never \
       --glob '*.ts' --glob '*.tsx' \
       "${EXCLUDES[@]/#/--glob=}" \
       -e "$pattern" "${targets[@]}" 2>/dev/null || true
  )

  [[ ${#matched[@]} -eq 0 ]] && continue

  echo -e "${RED}✗${NC} $message"
  for hit in "${matched[@]}"; do
    echo "    $hit"
    errors=$((errors + 1))
  done
done

if [[ "$errors" -gt 0 ]]; then
  echo
  echo "正本: .agents/skills/growmate-ui-ux/ui-text.md"
  echo "対処のいずれか:"
  echo "  1. 正本の表記に直す"
  echo "  2. 正本側を変える場合は ui-text.md の用語辞書を先に更新し、全画面をまとめて統一する"
  echo
  echo "errors: $errors"
  exit 1
fi

echo -e "${GREEN}✓${NC} 表記揺れはありません。"
exit 0
