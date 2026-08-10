---
name: quality-gate
description: GrowMateのコード変更後・commit前・push前・PR前に必ず使う品質ゲート。npm run verify（audit、lint、test、build、knip）、UI手動確認、非機能チェック、2パスセルフレビュー、残存リスク整理を扱う。テスト失敗、lint/build/knip失敗、レビュー観点の確認、完了判定を行うときにも使う。
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
2. **UI 表示文言を追加・変更した場合**は `npm run verify:ui-text`（表記揺れ検出）。
   正本は [`growmate-ui-ux/ui-text.md`](../growmate-ui-ux/ui-text.md)。pre-commit で staged 分は自動実行されるが、既存分を含めて確認する場合は手動で全走査する。
3. 変更機能の手動確認（`manual-testing.md`）
4. 2 パスセルフレビュー（`self-review.md`）
