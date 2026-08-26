#!/usr/bin/env bash
# pre-push 用: pin 実体の自動設置 + workflow 変更時の版ズレ検知。
#
# やること:
#   1. `.takt-version` の実体が無ければ takt-install-pinned.sh を実行する
#   2. 今回 push する差分に `.takt/workflows` 等が含まれ、かつ PATH 上の takt が
#      `.takt-version` より新しいのに `.takt-version` 自体を上げていない → 失敗
#
# やらないこと:
#   - `.takt-version` の自動バンプ
#   - workflow YAML の自動修正
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION_FILE="${ROOT}/.takt-version"
INSTALL_SCRIPT="${ROOT}/scripts/takt-install-pinned.sh"
RESOLVE_SCRIPT="${ROOT}/scripts/resolve-takt-bin.sh"

if [[ ! -f "${VERSION_FILE}" ]]; then
  printf '%s\n' "✗ GrowMate の版正本がありません: ${VERSION_FILE}" >&2
  exit 1
fi

WANT="$(tr -d '[:space:]' <"${VERSION_FILE}")"

# --- 1. pin 実体を保証する（未設置なら install） ---
if ! TAKT_BIN="$("${RESOLVE_SCRIPT}" 2>/dev/null)"; then
  echo "→ takt ${WANT} の pin 実体が無いため設置します（初回は時間がかかります）"
  "${INSTALL_SCRIPT}"
  TAKT_BIN="$("${RESOLVE_SCRIPT}")"
fi
echo "✓ takt pin: ${TAKT_BIN} (${WANT})"

# --- 2. push 差分の版ズレ検知 ---
# husky / git は stdin に <local_ref> <local_sha> <remote_ref> <remote_sha> を流す。
# 引数や環境から渡されたときはそれを使う（テスト用）。
version_gt() {
  local a="$1" b="$2"
  [[ "${a}" != "${b}" ]] && [[ "$(printf '%s\n%s\n' "${a}" "${b}" | sort -V | head -n1)" == "${b}" ]]
}

collect_changed_files() {
  local local_sha remote_sha
  if [[ -n "${TAKT_HOOK_LOCAL_SHA:-}" && -n "${TAKT_HOOK_REMOTE_SHA:-}" ]]; then
    local_sha="${TAKT_HOOK_LOCAL_SHA}"
    remote_sha="${TAKT_HOOK_REMOTE_SHA}"
    if [[ "${remote_sha}" =~ ^0+$ ]]; then
      git diff-tree --no-commit-id --name-only -r "${local_sha}"
    else
      git diff --name-only "${remote_sha}..${local_sha}"
    fi
    return 0
  fi

  if [[ -t 0 ]]; then
    # stdin が TTY のときは「これから push する予定の tip vs upstream」を見る
    local upstream
    if upstream="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
      git diff --name-only "${upstream}...HEAD"
    else
      git diff --name-only "origin/develop...HEAD" 2>/dev/null || git diff --name-only HEAD
    fi
    return 0
  fi

  while read -r _local_ref local_sha _remote_ref remote_sha; do
    [[ -z "${local_sha}" ]] && continue
    if [[ "${local_sha}" =~ ^0+$ ]]; then
      continue
    fi
    if [[ "${remote_sha}" =~ ^0+$ ]]; then
      git diff-tree --no-commit-id --name-only -r "${local_sha}"
    else
      git diff --name-only "${remote_sha}..${local_sha}"
    fi
  done
}

CHANGED="$(collect_changed_files | sort -u || true)"
if [[ -z "${CHANGED}" ]]; then
  exit 0
fi

workflow_touched=0
version_touched=0
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  case "${file}" in
    .takt/workflows/* | .takt/facets/*)
      workflow_touched=1
      ;;
    .takt-version)
      version_touched=1
      ;;
  esac
done <<<"${CHANGED}"

if [[ "${workflow_touched}" -eq 0 ]]; then
  exit 0
fi

PATH_TAKT="$(command -v takt 2>/dev/null || true)"
if [[ -z "${PATH_TAKT}" ]]; then
  exit 0
fi

PATH_VER="$("${PATH_TAKT}" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
if [[ ! "${PATH_VER}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  exit 0
fi

if version_gt "${PATH_VER}" "${WANT}" && [[ "${version_touched}" -eq 0 ]]; then
  cat >&2 <<EOF
✗ PATH の takt (${PATH_VER} @ ${PATH_TAKT}) が GrowMate pin (${WANT}) より新しいのに、
  workflow / facets を変えて .takt-version を上げていません。

  Homebrew 等の新構文を旧 pin の doctor に掛けると pre-push で落ちます。
  同じ変更で次を行ってください:

  1. .takt-version を ${PATH_VER}（または採用する版）にする
  2. ./scripts/takt-install-pinned.sh
  3. pin 版で workflow doctor / contract テストを緑にする
  4. 必要なら YAML を破壊的変更に追随させる

  意図的に旧 pin のまま直す場合は、PATH の takt を使わず pin 実体で編集・検証してください:
    \$(./scripts/resolve-takt-bin.sh) workflow doctor .takt/workflows/<file>.yaml
EOF
  exit 1
fi

exit 0
