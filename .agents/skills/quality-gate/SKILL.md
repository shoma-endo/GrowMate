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

1. `npm run verify`（`lint` → `test` → `build` → `knip` を順次実行する SSoT スクリプト）。
   個別に走らせる場合は `npm run lint` / `npm run test` / `npm run build` / `npm run knip`。
   **`tsc --noEmit` は `build` の代わりにならない**（Next.js の route segment config 静的解析や page data 収集が走らないため、過去に `maxDuration` 漏れが本番直前まで気付けなかった実例あり）。
2. 変更機能の手動確認（`manual-testing.md`）
3. 2 パスセルフレビュー（`self-review.md`）

## husky フック構成

| Hook | 実行内容 | 役割 |
|------|---------|------|
| `pre-commit` | `npm run lint` | commit 単位の高速チェック。エラー即時検知 |
| `pre-push` | `npm run test && npm run build && npm run knip` | push 前のテストと重い検証。CI 到達前の早期検知 |

`pre-push` には lint を入れていない（pre-commit と二重実行になるため）。
**`--no-verify` でフックを回避した場合は CI 側 (`lint` / `test` / `build` / `knip` ジョブ) で必ず止まる**。逆に言えば、フックは早期検知の補助であって、CI が最終ゲート。

## 関連スキル

- 実装ポリシー: `implementation-guidelines`
- PR ワークフロー: TAKT `.takt/workflows/spec-to-pr.yaml` / `.takt/workflows/react-doctor-to-pr.yaml`
