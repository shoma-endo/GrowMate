#!/usr/bin/env bash
# src/types/database.types.ts をリモート DB から再生成する（npm run supabase:types）。
#
# 生成が失敗・空のときは元のファイルを残して非0で終わる。
# リダイレクトで直接書くと、CLI が失敗しても出力先がエラー出力（stdout の JSON）や空で上書きされるため一時ファイルを挟む。
#
# --linked ではなく project ref を渡すのは、supabase/.temp（link 情報）が gitignore されていて
# worktree には無いため。本番と開発は同じプロジェクトを共有している（README「Supabase 注意」）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT_REF='rnmljzdsncucvkcmoaun'
OUT='src/types/database.types.ts'

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! supabase gen types typescript --project-id "$PROJECT_REF" --schema public > "$tmp"; then
  echo "✗ supabase gen types が失敗しました。$OUT は変更していません。" >&2
  echo "  認証エラーなら supabase login か SUPABASE_ACCESS_TOKEN を設定してから再実行してください。" >&2
  exit 1
fi

if ! grep -q '^export type Database = ' "$tmp"; then
  echo "✗ 生成結果が空か想定外の内容です。$OUT は変更していません。" >&2
  exit 1
fi

# mv だと mktemp の 0600 が引き継がれるため、既存ファイルへ上書きコピーして権限を保つ
cp "$tmp" "$OUT"
echo "✓ $OUT を再生成しました。"
