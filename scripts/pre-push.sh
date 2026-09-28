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
# build は src/env.ts でサーバーの必須キーが「空でないか」だけを検証する。値の中身は使わない。
# クラウド環境（Claude Code on the web）では ANTHROPIC_API_KEY が環境から外されるため、
# 未設定なら CI（.github/workflows/ci.yml の build ジョブ）と同じダミー値で補う。
# シェルに値があればそれを使う。.env.local にだけ書いてある環境ではダミーが優先される
# （Next.js は process.env を .env.* より優先する）が、CI と同じ条件で通るので build の検証には足りる。
# この build 成果物はデプロイしない。
SUPABASE_SERVICE_ROLE="${SUPABASE_SERVICE_ROLE:-dummy-service-role}" \
OPENAI_API_KEY="${OPENAI_API_KEY:-sk-dummy}" \
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-dummy}" \
  npm run build
npm run knip
