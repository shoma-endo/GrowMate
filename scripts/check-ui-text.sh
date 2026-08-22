#!/usr/bin/env bash
# UI 表示文言の表記揺れ検出。
#
# 正本: .agents/skills/growmate-ui-ux/ui-text.md
# 変数名・関数名の命名規則は対象外（そちらは project-naming / eslint の担当）。
#
# 検査するのは「機械判定しても誤検出がほぼ出ない」項目に限る。
# スペースの有無・句点・略語の初出・文体は人が見る（quality-gate の手動確認）。
#
# 必要なコマンド: ripgrep (rg)。日本語の文字クラスと \x{...} を正しく扱うため使用する。
#
# 使い方:
#   bash scripts/check-ui-text.sh                     # app/ src/ を全走査（ワークツリー）
#   bash scripts/check-ui-text.sh a.tsx b.ts          # 指定ファイルのみ（ワークツリー）
#   bash scripts/check-ui-text.sh --staged a.tsx ...  # 指定ファイルのステージ済み内容（pre-commit 用）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

errors=0

# rg が無い環境では全ての検索が空振りし、違反ゼロ＝成功として終了してしまう。
# 「検査できなかった」を「問題なし」と報告しないよう、ここで落とす。
if ! command -v rg >/dev/null 2>&1; then
  echo -e "${RED}✗${NC} ripgrep (rg) が見つかりません。UI 文言チェックを実行できません。" >&2
  echo "    インストール: brew install ripgrep / apt-get install -y ripgrep" >&2
  exit 1
fi

# 走査対象から外すファイル。
#   prompts.ts / prompt-descriptions.ts は LLM への指示文であり画面表示ではない。
# パターンは rg の --glob と bash の case の両方で使うため、`**/` を付けず
# 「区切りを含まないパターンはベース名に一致する」形で書く。
EXCLUDE_PATHS=(
  'src/lib/prompts.ts'
  'src/lib/prompt-descriptions.ts'
  '*.test.ts'
  '*.test.tsx'
)

# ディレクトリ走査時の除外（rg にファイルを明示的に渡した場合、rg は --glob を
# 適用しないため、これだけでは per-file モードで効かない。is_excluded と併用する）
EXCLUDES=("${EXCLUDE_PATHS[@]/#/!}")

is_excluded() {
  local path="$1" pattern
  for pattern in "${EXCLUDE_PATHS[@]}"; do
    # shellcheck disable=SC2254
    case "$path" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

# ルール定義: <正規表現>@@<指摘文>
# 「誤」の表記だけにマッチさせ、正しい表記にはマッチさせないこと。
# 正規表現に | を含められるよう、区切りは @@ を使う。
#
# 用語（Google Ads / WordPress 等）のルールはここに書かない。
# 正本 ui-text.md の「用語辞書」テーブルから load_dictionary_rules() が生成する。
# ここに置くのは、語の対応表では表せない表記ルールだけ。
RULES=(
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

DICTIONARY='.agents/skills/growmate-ui-ux/ui-text.md'

# 正本の「用語辞書」テーブルから <正><TAB><誤> の組を取り出す。
# 「機械チェック」列が ✅ の行だけが対象（目視の行は誤検出が出るため検査しない）。
dictionary_pairs() {
  # LC_ALL=C で byte 比較に固定する。macOS の /usr/bin/awk は UTF-8 ロケールだと
  # 文字列比較に strcoll() を使い、CJK 同士（例: "事業者情報" == "正"）が true に
  # なるため、正列が日本語の行が全てヘッダ行として捨てられる。
  LC_ALL=C awk -F'|' '
    /^## 用語辞書/ { in_table = 1; next }
    in_table && /^#/ { in_table = 0 }
    !in_table { next }
    $0 !~ /^\|/ { next }
    {
      correct = $2; wrong = $3; machine = $4
      gsub(/^[ \t]+|[ \t]+$/, "", correct)
      gsub(/^[ \t]+|[ \t]+$/, "", wrong)
      gsub(/^[ \t]+|[ \t]+$/, "", machine)
      if (correct == "" || correct == "正") next   # ヘッダ行
      if (correct ~ /^[-: ]+$/) next               # 区切り行
      if (machine !~ /✅/) next                    # 目視の行
      # mawk はマルチバイト非対応のため [、/] のような文字クラスは使えない
      # （バイト単位で分割され「グーグル広告」が壊れる）。区切りごとに 2 段で split する。
      n = split(wrong, parts, "、")
      for (i = 1; i <= n; i++) {
        m = split(parts[i], subs, "/")
        for (j = 1; j <= m; j++) {
          term = subs[j]
          gsub(/^[ \t]+|[ \t]+$/, "", term)
          if (term != "") print correct "\t" term
        }
      }
    }
  ' "$DICTIONARY"
}

# 用語辞書からルールを生成して RULES に足す。
load_dictionary_rules() {
  if [[ ! -f "$DICTIONARY" ]]; then
    echo -e "${RED}✗${NC} 用語辞書が見つかりません: $DICTIONARY" >&2
    exit 1
  fi

  local count=0 correct term escaped pattern
  while IFS=$'\t' read -r correct term; do
    [[ -z "${term:-}" ]] && continue
    # 辞書の語をそのまま正規表現に入れるため、メタ文字をエスケープする
    escaped="$(printf '%s' "$term" | sed -E 's#([].[$()*+?^{}\\|])#\\\1#g')"
    # 英数字で始まる／終わる語は、識別子の一部（useWordpressSync、GoogleAdsSetupClient 等）に
    # 当たらないよう前後に境界を付ける。日本語の語には境界を付けない（助詞が直後に来るため）。
    pattern="$escaped"
    [[ "$term" =~ ^[A-Za-z0-9] ]] && pattern="(^|[^A-Za-z0-9])${pattern}"
    [[ "$term" =~ [A-Za-z0-9]$ ]] && pattern="${pattern}([^A-Za-z0-9]|$)"
    RULES+=("${pattern}@@「${term}」→「${correct}」（ui-text.md の用語辞書）")
    count=$((count + 1))
  done < <(dictionary_pairs)

  if [[ "$count" -eq 0 ]]; then
    echo -e "${RED}✗${NC} 用語辞書から 1 件もルールを生成できませんでした（$DICTIONARY のテーブル形式を確認）" >&2
    exit 1
  fi
  dictionary_rule_count="$count"
}

dictionary_rule_count=0
load_dictionary_rules

staged_mode=false
if [[ "${1:-}" == "--staged" ]]; then
  staged_mode=true
  shift
fi

targets=()
if [[ $# -gt 0 ]]; then
  for f in "$@"; do
    case "$f" in
      app/*|src/*) ;;
      *) continue ;;
    esac
    case "$f" in
      *.ts|*.tsx) ;;
      *) continue ;;
    esac
    # rg は明示指定されたファイルに --glob を適用しないので、ここで除外する
    is_excluded "$f" && continue
    # ワークツリー検査時のみ実在を確認する。--staged ではインデックス側を見るため、
    # ステージ後にワークツリーから消したファイルも検査対象に残す必要がある。
    if [[ "$staged_mode" == false && ! -f "$f" ]]; then
      continue
    fi
    targets+=("$f")
  done
  [[ ${#targets[@]} -eq 0 ]] && exit 0
elif [[ "$staged_mode" == true ]]; then
  echo -e "${RED}✗${NC} --staged にはファイルの指定が必要です" >&2
  exit 1
else
  targets=(app src)
fi

# --staged: コミットされるのはワークツリーではなくインデックスの内容。
# ファイル名だけ受け取ってワークツリーを検査すると、`git add -p` などで一部だけ
# ステージした場合に、禁止表記をステージ済みなのに検査を通す（逆に、直したのに
# 落とす）ことが起きる。インデックスの内容を取り出してそちらを検査する。
if [[ "$staged_mode" == true ]]; then
  staged_dir="$(mktemp -d)"
  trap 'rm -rf "$staged_dir"' EXIT

  materialized=()
  for f in "${targets[@]}"; do
    mkdir -p "$staged_dir/$(dirname "$f")"
    if git show ":$f" > "$staged_dir/$f" 2>/dev/null; then
      materialized+=("$f")
    else
      # インデックスに存在しない（ステージされていない）ものは対象外
      rm -f "$staged_dir/$f"
    fi
  done
  [[ ${#materialized[@]} -eq 0 ]] && exit 0
  targets=("${materialized[@]}")

  # 相対パスのまま検査できるよう作業ディレクトリごと移す。
  # これで --glob と出力パスがワークツリー検査時と同じ形になる。
  # 用語辞書は読み込み済みなので、ここで cd しても影響しない。
  cd "$staged_dir"
fi

echo "=== UI 文言 表記統一チェック（用語辞書 ${dictionary_rule_count} 語 + 表記ルール $(( ${#RULES[@]} - dictionary_rule_count )) 件）==="

# 表示文言ではない部分を落とす。
#   - コメント: 残すと `// ✅ 対応済み` のような開発者向け記述が誤検出される
#   - 文字クラスを含む正規表現リテラル: `/^[✅✓☑️]\s/` のような記号の列挙が誤検出される
#     リテラルが現れる文脈（行頭、`(`、`=`、`||` の直後など）に限定する。これが無いと
#     `'手順 1/3 [必須] 保存中です/次へ'` のような文言まで剥がして見逃す。
# 行全体を捨てるのではなく該当部分だけを落とすので、同じ行に表示文言があれば検査される。
strip_non_ui() {
  # s コマンドの区切りは # を使う（正規表現側で | を素のまま書くため）
  printf '%s' "$1" | sed -E \
    -e 's#\{/\*.*\*/\}##g' \
    -e 's#/\*.*\*/##g' \
    -e 's#^[[:space:]]*(//|\*).*$##' \
    -e 's#([^:])//.*$#\1#' \
    -e 's#(^|[[:space:]=(,:|&!?+])/[^/]*\[[^]]*\][^/]*/[gimsuy]*#\1#g'
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
    # 表示文言でない部分（コメント・正規表現リテラル）を除いてもなお
    # マッチするものだけを違反とみなす
    printf '%s' "$(strip_non_ui "$content")" | rg -q -e "$pattern" || continue
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
