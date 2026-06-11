#!/usr/bin/env bash
#
# invoke-cron.sh - 毎時 cron エンドポイント共通呼び出しスクリプト
#
# 使い方:
#   CRON_SECRET=xxx scripts/invoke-cron.sh \
#     --url https://example.com/api/cron/foo \
#     --profile {gsc-batch|gsc-suggestions|count-batch}
#
# Validation Profile:
#   gsc-batch    : GSC 評価バッチ向け（stoppedReason / errors / totalSystemError を確認）
#   gsc-suggestions: GSC提案ジョブ向け（一時失敗は警告、最終失敗はエラー）
#   count-batch  : 件数集計バッチ向け（success / data.failed を確認）
#
# Exit:
#   0 : 成功（WARN は出力するが exit 0）
#   1 : 失敗（HTTP エラー / JSON 不正 / 部分失敗の致命カテゴリ）

set -u

URL=""
PROFILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      URL="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$URL" ] || [ -z "$PROFILE" ]; then
  echo "Usage: invoke-cron.sh --url <URL> --profile <gsc-batch|gsc-suggestions|count-batch>" >&2
  exit 1
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set" >&2
  exit 1
fi

RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

MAX_RETRIES=3
RETRY_COUNT=0

validate_gsc_batch() {
  local file="$1"

  IMPORT_FAILED=$(jq -r '.data.totalImportFailed // 0' "$file")
  SKIPPED_LIMIT=$(jq -r '.data.usersSkippedDueToLimit // 0' "$file")
  if [ "$IMPORT_FAILED" -gt 0 ]; then
    echo "::warning::GSC batch had import failures: totalImportFailed=$IMPORT_FAILED"
  fi
  if [ "$SKIPPED_LIMIT" -gt 0 ]; then
    echo "::warning::GSC batch skipped users due to limit: usersSkippedDueToLimit=$SKIPPED_LIMIT"
  fi

  STOPPED_REASON=$(jq -r '.data.stoppedReason // "completed"' "$file")
  if [ "$STOPPED_REASON" != "completed" ]; then
    echo "GSC batch did not complete: stoppedReason=$STOPPED_REASON" >&2
    cat "$file" >&2
    return 1
  fi

  SYSTEM_ERRORS=$(jq -r '.data.totalSystemError // 0' "$file")
  ERROR_COUNT=$(jq -r '.data.errors // [] | length' "$file")
  if [ "$SYSTEM_ERRORS" -gt 0 ] || [ "$ERROR_COUNT" -gt 0 ]; then
    echo "GSC batch reported failures (system_errors=$SYSTEM_ERRORS, errors=$ERROR_COUNT):" >&2
    cat "$file" >&2
    return 1
  fi

  return 0
}

validate_count_batch() {
  local file="$1"

  SKIPPED=$(jq -r '.data.skipped // 0' "$file")
  if [ "$SKIPPED" -gt 0 ]; then
    echo "::warning::Batch skipped items: skipped=$SKIPPED"
  fi

  SUCCESS=$(jq -r '.success // false' "$file")
  if [ "$SUCCESS" != "true" ]; then
    echo "Batch returned success=false:" >&2
    cat "$file" >&2
    return 1
  fi

  FAILED=$(jq -r '.data.failed // 0' "$file")
  if [ "$FAILED" -gt 0 ]; then
    echo "Batch reported failures (failed=$FAILED):" >&2
    cat "$file" >&2
    return 1
  fi

  return 0
}

validate_gsc_suggestions() {
  local file="$1"

  SUCCESS=$(jq -r '.success // false' "$file")
  if [ "$SUCCESS" != "true" ]; then
    echo "GSC suggestions returned success=false:" >&2
    cat "$file" >&2
    return 1
  fi

  FAILED=$(jq -r '.data.failed // 0' "$file")
  TERMINAL_FAILED=$(jq -r '.data.terminalFailed // 0' "$file")
  if [ "$FAILED" -gt 0 ]; then
    echo "::warning::GSC suggestion jobs will retry: failed=$FAILED"
  fi
  if [ "$TERMINAL_FAILED" -gt 0 ]; then
    echo "GSC suggestion jobs reached retry limit: terminalFailed=$TERMINAL_FAILED" >&2
    cat "$file" >&2
    return 1
  fi

  return 0
}

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  HTTP_CODE=$(curl -X GET "$URL" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Accept: application/json" \
    --max-time 310 \
    --output "$RESPONSE_FILE" \
    --write-out "%{http_code}" \
    --silent)
  CURL_EXIT_CODE=$?

  if [ $CURL_EXIT_CODE -eq 0 ] && [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    if ! jq -e . "$RESPONSE_FILE" > /dev/null 2>&1; then
      echo "Response is not valid JSON (HTTP $HTTP_CODE):" >&2
      cat "$RESPONSE_FILE" >&2
      exit 1
    fi

    case "$PROFILE" in
      gsc-batch)
        if ! validate_gsc_batch "$RESPONSE_FILE"; then
          exit 1
        fi
        ;;
      gsc-suggestions)
        if ! validate_gsc_suggestions "$RESPONSE_FILE"; then
          exit 1
        fi
        ;;
      count-batch)
        if ! validate_count_batch "$RESPONSE_FILE"; then
          exit 1
        fi
        ;;
      *)
        echo "Unknown profile: $PROFILE" >&2
        exit 1
        ;;
    esac

    echo "Success (HTTP $HTTP_CODE)"
    cat "$RESPONSE_FILE"
    exit 0
  elif [ $CURL_EXIT_CODE -eq 28 ] || [ "$HTTP_CODE" -eq 503 ] || [ "$HTTP_CODE" -eq 504 ]; then
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      WAIT_TIME=$((2 ** RETRY_COUNT * 2))
      if [ $CURL_EXIT_CODE -eq 28 ]; then
        echo "Request timeout. Retrying in ${WAIT_TIME}s... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
      else
        echo "HTTP $HTTP_CODE received. Retrying in ${WAIT_TIME}s... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
      fi
      sleep $WAIT_TIME
    else
      echo "Max retries reached (curl exit: $CURL_EXIT_CODE, HTTP: $HTTP_CODE)." >&2
      cat "$RESPONSE_FILE" >&2 2>/dev/null || true
      exit 1
    fi
  else
    echo "HTTP $HTTP_CODE received (curl exit: $CURL_EXIT_CODE)." >&2
    cat "$RESPONSE_FILE" >&2 2>/dev/null || true
    exit 1
  fi
done
