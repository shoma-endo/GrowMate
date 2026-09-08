#!/usr/bin/env bash
# pre-push 本体。`.husky/pre-push` から `bash` 明示で呼ばれる。
#
# なぜ本体を分けているか:
#   husky v9 は `.husky/_/h` の中でフックを `sh -e "$hook"` として起動する。
#   シェバンは無視されるので、bash 専用構文（`set -o pipefail` など）をフックに直接書くと
#   `/bin/sh` が dash の環境（Linux コンテナ / Claude Code on the web / CI イメージ）で
#   `set: Illegal option -o pipefail` になり、push が必ず失敗する。
#   macOS の `/bin/sh` は bash なので手元では再現しない。
#
# 内容: pin 実体の自動設置 + workflow 変更時の版ズレ検知のあと、test:coverage / build / knip。
# 詳細は scripts/takt-pre-push-guard.sh。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash scripts/takt-pre-push-guard.sh
npm run test:coverage
npm run build
npm run knip
