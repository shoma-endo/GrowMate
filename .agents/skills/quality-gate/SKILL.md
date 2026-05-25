---
name: quality-gate
description: GrowMate の品質ゲート。コーディング完了後の2パスセルフレビュー、手動検証（lint/build・画面別チェック）、障害トラブルシューティング。コード変更後の検証、セルフレビュー、動作確認、障害調査のときに使う。
---

# 品質ゲート

検証・セルフレビュー・障害対応の統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| コーディング完了後の 2 パスセルフレビュー | [`self-review.md`](self-review.md) |
| 手動検証・画面別チェック・マイグレーション確認 | [`manual-testing.md`](manual-testing.md) |
| 障害調査・トラブルシューティング | [`troubleshooting.md`](troubleshooting.md) |

## 基本フロー（コード変更後）

1. `npm run lint` / `npm run build` / `npm run knip`（CI で `knip` が独立ジョブとして実行され、失敗すると CI がブロックされるため）
2. 変更機能の手動確認（`manual-testing.md`）
3. 2 パスセルフレビュー（`self-review.md`）

## 関連スキル

- 実装ポリシー: `implementation-guidelines`
- PR ワークフロー: `spec-to-pr` / `react-doctor-to-pr`（セルフレビュー Phase は `.agents/skills/shared/pr-workflows/self-review-phase.md`）
