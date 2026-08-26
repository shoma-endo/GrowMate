#!/usr/bin/env bash
# `.takt-version` が指す版の takt を専用 prefix に設置する（冪等）。
#
# PATH / Homebrew / `npm install -g takt` は検証正本にしない。
# 実体は ${TAKT_RUNTIME_ROOT:-$HOME/.local/takt}/<version> に閉じ込める（約1GB）。
#
# 用法:
#   ./scripts/takt-install-pinned.sh          # pin 版を設置
#   ./scripts/takt-install-pinned.sh --prune  # 設置後、pin 以外の版を削除
#
# 版を上げる手順:
#   1. `.takt-version` を新しい版にする
#   2. このスクリプトを実行する
#   3. pin 版で `takt workflow doctor` と contract テストを緑にする
#   4. 同じ PR で workflow YAML も追随させる
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${ROOT}/.takt-version"
PRUNE=0
[[ "${1:-}" == "--prune" ]] && PRUNE=1

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ ! -f "${VERSION_FILE}" ]]; then
  printf '%s\n' "✗ GrowMate の版正本がありません: ${VERSION_FILE}" >&2
  exit 1
fi

WANT="$(tr -d '[:space:]' <"${VERSION_FILE}")"
if [[ ! "${WANT}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf '%s\n' "✗ ${VERSION_FILE} が semver ではありません: '${WANT}'" >&2
  exit 1
fi

RUNTIME_ROOT="${TAKT_RUNTIME_ROOT:-${HOME}/.local/takt}"
PREFIX="${RUNTIME_ROOT}/${WANT}"
BIN="${PREFIX}/bin/takt"

if command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
elif [[ -x /opt/homebrew/opt/node@24/bin/npm ]]; then
  NPM_BIN=/opt/homebrew/opt/node@24/bin/npm
else
  printf '%s\n' "✗ npm が見つかりません（Node.js >= 24.15.0 が必要）" >&2
  exit 1
fi

version_matches() {
  local bin="$1"
  [[ -x "${bin}" ]] || return 1
  local got
  got="$("${bin}" --version 2>/dev/null | head -n1 | tr -d '[:space:]')" || return 1
  [[ "${got}" == "${WANT}" ]]
}

if version_matches "${BIN}"; then
  echo "✓ takt ${WANT} は設置済み: ${BIN}"
else
  echo "=== takt ${WANT} を ${PREFIX} へ設置します（実体は約1GB） ==="
  mkdir -p "${PREFIX}"
  "${NPM_BIN}" install --prefix "${PREFIX}" --no-fund --no-audit --no-save "takt@${WANT}"
  if [[ ! -x "${BIN}" ]]; then
    mkdir -p "${PREFIX}/bin"
    ln -sfn "${PREFIX}/node_modules/takt/bin/takt" "${BIN}"
  fi
  if ! version_matches "${BIN}"; then
    printf '%s\n' "✗ 設置後の版が一致しません。${PREFIX} を削除して入れ直してください" >&2
    exit 1
  fi
  echo "✓ takt ${WANT} を設置しました: ${BIN}"
fi

if [[ "${PRUNE}" -eq 1 ]]; then
  shopt -s nullglob
  for d in "${RUNTIME_ROOT}"/*/; do
    name="$(basename "${d}")"
    [[ "${name}" == "${WANT}" ]] && continue
    echo "=== 古い版を削除: ${d} ==="
    rm -rf "${d}"
  done
fi

echo "実体: ${BIN}"
"${BIN}" --version
