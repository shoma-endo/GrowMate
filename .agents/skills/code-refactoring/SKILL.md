---
name: code-refactoring
description: ふるまいを保ったままコードを簡潔化・整理し、明瞭さを高めて複雑さを下げる。複雑・重複したコードの整理、新機能追加前の下準備、バグ修正後の根本原因除去、技術的負債の解消、Extract Method / DRY / SOLID / デザインパターン適用のときに使う。
metadata:
  tags: refactoring, code-quality, DRY, SOLID, design-patterns, clean-code, simplification, behavior-preservation
  platforms: Claude, ChatGPT, Gemini, Codex
---

# Code Refactoring

ふるまいを保ったままコードを簡潔化・整理する。**該当するサブファイルのみ**読む（段階的開示）。

## いつ使うか

- コードレビューで複雑・重複コードを発見したとき
- 新機能追加の前に既存コードを整理するとき
- バグ修正後に根本原因を除去するとき
- 技術的負債を定期的に解消するとき

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| リファクタリング手法（Extract Method / DRY / ポリモーフィズム / Parameter Object / SOLID）・チェックリスト | [`patterns.md`](patterns.md) |
| ふるまい保証・検証手順・記録・トラブルシューティング | [`behavior-validation.md`](behavior-validation.md) |

## 必須ルール（MUST）

1. **テストファースト**: リファクタ前にテスト（または検証手順）を用意する
2. **小さなステップ**: 一度に1つだけ変更する
3. **ふるまい保存**: 機能変更を伴わない

## 禁止（MUST NOT）

1. **同時実施の禁止**: リファクタと機能追加を同時に行わない
2. **無検証リファクタの禁止**: テスト／検証なしで変更しない（リグレッションのリスク）

## 関連スキル

- `quality-gate`（`self-review.md`）— リファクタ後の 2 パスセルフレビュー
- `implementation-guidelines` — プロジェクト実装ポリシー
- `project-naming` — 命名規則
