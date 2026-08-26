#!/usr/bin/env bash
# GrowMate の pin 版 takt パスを stdout に出す。無ければ理由を stderr に出して exit 1。
#
# 正本: リポジトリ直下の `.takt-version`（ai-os / Homebrew / PATH の takt は見ない）。
# 実体: ${TAKT_RUNTIME_ROOT:-$HOME/.local/takt}/<version>/bin/takt
# 上書き: TAKT_BIN（絶対パス）。名乗る版が `.takt-version` と一致しない場合は拒否する。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${ROOT}/.takt-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  printf '%s\n' "✗ GrowMate の版正本がありません: ${VERSION_FILE}" >&2
  exit 1
fi

WANT="$(tr -d '[:space:]' <"${VERSION_FILE}")"
if [[ ! "${WANT}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf '%s\n' "✗ ${VERSION_FILE} が semver ではありません: '${WANT}'" >&2
  exit 1
fi

assert_version() {
  local bin="$1"
  local got
  got="$("${bin}" --version 2>/dev/null | head -n1 | tr -d '[:space:]')" || {
    printf '%s\n' "✗ takt の版を取得できません: ${bin}" >&2
    return 1
  }
  if [[ "${got}" != "${WANT}" ]]; then
    printf '%s\n' "✗ takt の版が一致しません: want=${WANT} got=${got} (${bin})" >&2
    printf '%s\n' "  設置する: ${ROOT}/scripts/takt-install-pinned.sh" >&2
    return 1
  fi
}

if [[ -n "${TAKT_BIN:-}" ]]; then
  if [[ ! -x "${TAKT_BIN}" ]]; then
    printf '%s\n' "✗ TAKT_BIN が実行できません: ${TAKT_BIN}" >&2
    exit 1
  fi
  assert_version "${TAKT_BIN}" || exit 1
  printf '%s\n' "${TAKT_BIN}"
  exit 0
fi

RUNTIME_ROOT="${TAKT_RUNTIME_ROOT:-${HOME}/.local/takt}"
BIN="${RUNTIME_ROOT}/${WANT}/bin/takt"

if [[ ! -x "${BIN}" ]]; then
  printf '%s\n' "✗ GrowMate は takt ${WANT} 固定。未設置: ${BIN}" >&2
  printf '%s\n' "  実行: ${ROOT}/scripts/takt-install-pinned.sh" >&2
  exit 1
fi

assert_version "${BIN}" || exit 1
printf '%s\n' "${BIN}"
