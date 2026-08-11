# GrowMate 新規開発フロー

GrowMate の新規機能は、要件を確認してから仕様書をレビューし、仕様書を起点に実装する。

## 正本と役割

- この文書: 人間向けの開発手順
- [`grill-to-gherkin.yaml`](../.takt/workflows/grill-to-gherkin.yaml): 要件確認と Gherkin 化の実行定義
- [`spec-review.yaml`](../.takt/workflows/spec-review.yaml): 仕様書レビューの実行定義
- [`spec-to-pr.yaml`](../.takt/workflows/spec-to-pr.yaml): 仕様書起点の実装・レビュー・PR の実行定義
- [`docs/plans/`](plans/): 実装対象の仕様書

## 全体フロー

```text
依頼・アイデア
    ↓
grill-to-gherkin
    ↓  Grill の回答と Gherkin を承認
docs/plans/<slug>.md に仕様書化
    ↓
spec-review
    ↓  仕様書レビューと必要な修正
spec-to-pr
    ↓  実装・検証・レビュー・PR
人間がPRを確認してmerge
```

## 1. 要件を Grill する

依頼がまだ粗い場合は、対話型 workflow を実行する。

```bash
takt -w grill-to-gherkin -t "実装したい機能の概要"
```

Grill は次を確認する。

- 対象仕様書のパス（既存または新規の `docs/plans/<slug>.md`）
- 利用者から見える振る舞い
- 正常系・失敗系・境界条件
- 複数解釈できる業務ルール
- Non-goals

この workflow は仕様書・プロダクションコードを自動編集しない。人間が質問に回答し、生成された Gherkin を承認する。

成果物は `.takt/runs/<run>/reports/` に保存される。

- `01-grill.md`: 質問・決定事項・未確定事項
- `02-gherkin.md`: Gherkin 形式の受け入れ条件
- `03-confirmation.md`: 人間承認の結果
- `04-handoff.md`: 仕様書へ反映して次の workflow を実行する手順

## 2. 仕様書へ反映する

承認済みの Gherkin を、対象の [`docs/plans/`](plans/) 仕様書へ反映する。

Gherkin は受け入れ条件であり、仕様書全体ではない。仕様書には必要に応じて次も記載する。

- 対象範囲と Non-goals
- UI・API・DB の設計
- 権限・エラー・外部連携の挙動
- データフローと既存実装の再利用方針
- テスト方針
- 未確定事項とクライアント確認事項

既存仕様書なら更新し、新規機能なら `docs/plans/<slug>.md` を作成する。

## 3. 仕様書をレビューする

仕様書がまとまったら、`spec-review` を実行する。

```bash
takt -w spec-review -t "docs/plans/<slug>.md をレビューしてください"
```

この workflow は次を行う。

- 要件完全性の確認
- 既存コードとの整合確認
- セキュリティ・非機能レビュー
- 必要な仕様書修正
- 仕様書の図解 HTML 更新
- 仕様書変更の commit

クライアント判断が必要な質問が残った場合は、回答を仕様書へ反映してから再レビューする。

## 4. 仕様書を起点に実装する

`spec-review` 完了後、`spec-to-pr` を実行する。

```bash
takt -w spec-to-pr -t "docs/plans/<slug>.md 仕様書に沿って実装してください"
```

この workflow は次を行う。

- 実装計画
- コード実装
- 必要なテスト
- `npm run verify`
- AI アンチパターンレビュー
- アーキテクチャレビュー
- 指摘修正と再レビュー
- README 同期判断
- PR 作成・更新

実装中に仕様が不足している場合は、口頭で要件を補完しない。仕様書を修正し、`spec-to-pr` を再実行する。

## 5. 人間が最終確認する

PR 作成後、人間が次を確認して merge する。

- PR の差分と仕様書の対応
- 未確認事項
- UI の見た目・操作感
- 外部 API の実環境挙動
- 本番反映のタイミング

TAKT は merge を完了条件にしない。merge と本番反映は人間が判断する。

## 開発上の原則

- 曖昧な依頼は `grill-to-gherkin` で止める。
- Gherkin の承認後、必ず `docs/plans/` の仕様書へ反映する。
- `spec-review` 前に実装を始めない。
- 実装中に仕様を推測で補完しない。
- 実装・検証・レビューは `spec-to-pr` に任せる。
- 要件にない画面・機能・改善を追加しない。
