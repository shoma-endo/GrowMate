# GrowMate 新規開発フロー

GrowMate の新規機能は、TAKT標準の Grill Me で要件を確認してから仕様書をレビューし、仕様書を起点に実装する。

## 正本と役割

- この文書: 人間向けの開発手順
- [`requirement-definition.md`](templates/requirement-definition.md): 要件定義の項目テンプレート
- [`grill-to-gherkin.yaml`](../.takt/workflows/grill-to-gherkin.yaml): 要件確認と Gherkin 化の実行定義
- [`spec-review.yaml`](../.takt/workflows/spec-review.yaml): 仕様書レビューの実行定義
- [`spec-to-pr.yaml`](../.takt/workflows/spec-to-pr.yaml): 仕様書起点の実装・レビュー・PR の実行定義
- [`docs/plans/`](plans/): 実装対象の仕様書

## 全体フロー

```text
依頼・アイデア
    ↓  TAKT標準 Grill Me + Markdown/Gherkin 指示書
    grill-to-gherkin
    ↓  要件記録と Gherkin を検証・承認
05-rough-estimate.md
    ↓
06-estimate-confirmation.md
    ↓  人間が着手承認
docs/plans/<slug>.md に仕様書化
    ↓
spec-review
    ↓  仕様書レビューと必要な修正
spec-to-pr
    ↓  実装・検証・レビュー・PR
人間がPRを確認してmerge
```

## 1. 要件を Grill する

依頼がまだ粗い場合は、対話型 workflow を実行する。`grill-to-gherkin` は TAKT 標準の Grill Me を既定モードにしている。

```bash
takt -w grill-to-gherkin -t "実装したい機能の概要"
```

Grill Me は重要な判断を推奨案付きで一問ずつ確認する。`/go` を入力すると、`assistant.gherkin: true` により Markdown + Gherkin の実行指示書が生成される。

workflow の最初の `grill` step は追加質問をせず、その指示書を `01-grill.md` の決定事項・未確定事項・Non-goals へ正規化する。

確認対象は次のとおり。

- 対象仕様書のパス（既存または新規の `docs/plans/<slug>.md`）
- 利用者から見える振る舞い
- 正常系・失敗系・境界条件
- 複数解釈できる業務ルール
- Non-goals

この workflow は仕様書・プロダクションコードを自動編集しない。Grill Me の対話で人間が回答し、生成された Gherkin を承認する。

成果物は `.takt/runs/<run>/reports/` に保存される。

GrowMateのTAKT providerは全workflowの全stepに `provider: claude-sdk` を明示して統一している（headless CLI providerはtmux必須でハングするため。呼び出し方に依存させず、workflow yaml自体で固定する）。step間のレポート受け渡しは `{report:X}` プレースホルダ（本文をプロンプトへ全文注入。resume時はTAKTのsnapshotが引き継ぐ）で行い、エージェントはrunディレクトリのパスを一切必要としない。レポート保存はTAKTが行う。

- `01-grill.md`: Grill Me の決定事項・未確定事項・Non-goals の記録
- `02-gherkin.md`: Gherkin 形式の受け入れ条件
- `03-confirmation.md`: 人間承認の結果
- `05-rough-estimate.md`: 概算工数・前提・不確実性
- `06-estimate-confirmation.md`: 概算に対する着手判断
- `04-handoff.md`: 仕様書へ反映して次の workflow を実行する手順

## 2. 概算工数を確認する

Gherkinを承認したら、workflowが概算工数を作成する。

概算は正式見積もりではない。着手判断・優先順位付けに使うため、次を範囲で記録する。

- 機能・工程別の概算（人日）
- 合計工数と想定スケジュール
- 算出の前提
- 未確定事項・リスク
- 対象外
- 信頼度

この段階では、金額・単価・契約条件は扱わない。DB変更、外部API、権限、移行、AI評価、UI確認など、後で工数が変わる要素は不確実性として残す。

成果物は `05-rough-estimate.md`。概算できない場合も理由を記録して、次の着手判断へ進む。

概算作成後、workflow は自動で仕様書作成へ進まない。人間が概算・前提・不確実性を確認し、次のいずれかを判断する。

- `着手承認`: 仕様書作成へ進む
- `要件再確認が必要`: workflow を終了し、標準 Grill Me を再実行して要件または前提を見直す
- `見送り`: workflow を終了する

判断結果は `06-estimate-confirmation.md` に記録する。`着手承認` がない限り、`spec-review` と実装へ進めない。

## 3. 仕様書へ反映する

新規機能では、[`要件定義テンプレート`](templates/requirement-definition.md) をコピーして対象の [`docs/plans/`](plans/) 仕様書を作る。既存仕様書を更新する場合も、テンプレートの項目をチェックリストとして不足を確認する。

承認済みの Gherkin を、対象仕様書の受け入れ条件へ反映する。

Gherkin は受け入れ条件であり、仕様書全体ではない。仕様書には必要に応じて次も記載する。

- 対象範囲と Non-goals
- UI・API・DB の設計
- 権限・エラー・外部連携の挙動
- データフローと既存実装の再利用方針
- テスト方針
- 未確定事項とクライアント確認事項

テンプレートの項目は、次の順で確認する。

| 区分 | 主な確認内容 |
| --- | --- |
| 目的・業務 | 背景、課題、利用者、As-Is / To-Be、成功指標 |
| 機能 | 機能要件、優先度、入出力、状態、権限、Gherkin |
| 非機能 | 性能、可用性、セキュリティ、監査、復旧、運用、アクセシビリティ、コスト |
| 判断 | 制約、前提、依存関係、トレードオフ、リスク |
| 完了条件 | テスト、リリース、ロールバック、承認 |

該当しない項目は空欄にせず、`対象外` と理由を記載する。決められない項目は `未確定` とし、質問・回答者・期限を残す。これにより、考え忘れと意図的な対象外を区別できる。

既存仕様書なら更新し、新規機能なら `docs/plans/<slug>.md` を作成する。

## 4. 仕様書をレビューする

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

## 5. 仕様書を起点に実装する

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

## 6. 人間が最終確認する

PR 作成後、人間が次を確認して merge する。

- PR の差分と仕様書の対応
- 未確認事項
- UI の見た目・操作感
- 外部 API の実環境挙動
- 本番反映のタイミング

TAKT は merge を完了条件にしない。merge と本番反映は人間が判断する。

## 開発上の原則

- 曖昧な依頼は標準 `grill-me` で一問ずつ解消する。
- Gherkin の承認後、必ず `docs/plans/` の仕様書へ反映する。
- `spec-review` 前に実装を始めない。
- 要件定義テンプレートの未記入項目を、理由なしで残さない。
- 実装中に仕様を推測で補完しない。
- 実装・検証・レビューは `spec-to-pr` に任せる。
- 要件にない画面・機能・改善を追加しない。
