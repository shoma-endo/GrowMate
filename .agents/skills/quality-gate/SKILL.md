---
name: quality-gate
description: GrowMate の品質ゲート。コード変更後の自動検証、手動検証、2パスセルフレビューに使う。
---

# 品質ゲート

検証・セルフレビューの統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| コーディング完了後の 2 パスセルフレビュー | [`self-review.md`](self-review.md) |
| 手動検証・画面別チェック | [`manual-testing.md`](manual-testing.md) |

## 基本フロー（コード変更後）

1. `npm run verify`（`audit` → `lint` → `test` → `build` → `knip` を順次実行する SSoT スクリプト）。
   個別に走らせる場合は `npm audit --audit-level=high` / `npm run lint` / `npm run test` / `npm run build` / `npm run knip`。
   **`tsc --noEmit` は `build` の代わりにならない**（Next.js の route segment config 静的解析や page data 収集が走らないため、過去に `maxDuration` 漏れが本番直前まで気付けなかった実例あり）。
2. 変更機能の手動確認（`manual-testing.md`）
3. 2 パスセルフレビュー（`self-review.md`）
