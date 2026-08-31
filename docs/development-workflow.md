# GrowMate 新規開発フロー

GrowMate の新規機能は、TAKT標準の Grill Me で要件を確認してから仕様書をレビューし、仕様書を起点に実装する。

## 正本と役割

- この文書: 人間向けの開発手順
- [`requirement-definition.md`](templates/requirement-definition.md): 要件定義の項目テンプレート
- [`grill-to-gherkin.yaml`](../.takt/workflows/grill-to-gherkin.yaml): 要件確認と Gherkin 化の実行定義
- [`spec-review.yaml`](../.takt/workflows/spec-review.yaml): 仕様書レビューの実行定義
- [`spec-to-pr.yaml`](../.takt/workflows/spec-to-pr.yaml): 仕様書起点の実装・レビュー・PR の実行定義
- [`docs/plans/`](plans/): 実装対象の仕様書
- [`.takt-version`](../.takt-version): GrowMate が検証・実行に使う takt の版正本（PATH / Homebrew の版ではない）

## TAKT の版

workflow YAML と doctor / contract テストは、リポジトリ直下の `.takt-version` が指す pin 版だけを正とする。

```bash
./scripts/takt-install-pinned.sh   # ~/.local/takt/<ver> に設置（冪等）
./scripts/resolve-takt-bin.sh      # 検証に使う実体パスを表示
```

版を上げるときは **同じ変更で** 次を行う。Homebrew だけ先に上げて新構文を書くと、pin 不在または旧 pin で pre-push が落ちる。

1. `.takt-version` を新しい版にする
2. `./scripts/takt-install-pinned.sh` を実行する（pre-push でも未設置なら自動実行する）
3. pin 版で `workflow doctor` と `tests/unit/takt/workflow-contract.test.ts` を緑にする
4. 必要なら workflow YAML / facets を破壊的変更に追随させる

pre-push（[`scripts/takt-pre-push-guard.sh`](../scripts/takt-pre-push-guard.sh)）は次だけ自動化する。

- pin 実体が無ければ install する
- PATH の takt が pin より新しいのに `.takt/workflows` / `.takt/facets` だけ変えて `.takt-version` を上げていない → push を止める

`.takt-version` の自動バンプと YAML の自動修正はしない（破壊的 minor を黙って取り込むため）。

## 全体フロー

```text
依頼・アイデア
    ↓  TAKT標準 Grill Me + 指示書（実装タスク時は Gherkin も）
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
    ↓  実装・検証・レビュー・PR・PRコメント対応（1周）
人間がPRを確認してmerge
```

## 1. 要件を Grill する

依頼がまだ粗い場合は、対話型 workflow を実行する。起動時（または会話中の `/interaction`）で対話モード **Grill Me** を選ぶ。

```bash
takt -w grill-to-gherkin -t "実装したい機能の概要"
```

Grill Me は重要な判断を推奨案付きで一問ずつ確認する。`/go` を入力すると実行指示書が生成される。TAKT v0.62 以降、Gherkin は開発・実装タスクの指示書にだけ付く。要件確認だけの会話では Markdown 中心になり得る。受け入れ条件の Gherkin 化は workflow 内の `gherkin` step が担う。

workflow の最初の `grill` step は追加質問をせず、その指示書を `01-grill.md` の決定事項・Non-goals と、代替案・懸念点・未決定事項へ正規化する。

確認対象は次のとおり。

- 対象仕様書のパス（既存または新規の `docs/plans/<slug>.md`）
- 利用者から見える振る舞い
- 正常系・失敗系・境界条件
- 複数解釈できる業務ルール
- Non-goals
- 代替案（比較した案・採用理由・却下理由）
- 懸念点（採用案を前提にしても残る不安、判断できずレビュアーの助けが必要な点）
- 未決定事項（今決めない理由と、いつ・誰が決めるか）

この3観点は `.takt/workflows/rules/decision-viewpoints.md` に定義し、`grill-to-gherkin` の全 step へ適用する。
`01-grill.md` に `ALT-` / `CON-` / `OPEN-` の ID で記録し、`04-handoff.md` から仕様書の「11. トレードオフ判断」「12. リスク・確認質問・未決定事項」へ引き継ぐ。
記載量を増やすことが目的ではない。主要な設計判断がない小改修では3観点をまとめて1行で足りる。

この workflow の成果物に、答えを待ったまま先へ進むための欄は置かない。未解決の論点は次のいずれかに振り分ける。

- 答えが出るまで要件を確定できない → `要件を確定できない` / `追加確認が必要` と判定して停止し、標準 Grill Me をやり直す
- 答えがあると良いが要件確定は妨げない → 懸念点（CON）。仕様書 §12 の確認質問（Q）へ引き継ぐ
- 今は意図的に決めない → 未決定事項（OPEN）。仕様書 §12 の「未決定事項（今は決めない）」表に置き、仕様レビューのブロッカーとして数えない

この workflow は仕様書・プロダクションコードを自動編集しない。Grill Me の対話で人間が回答し、生成された Gherkin を承認する。

成果物は `.takt/runs/<run>/reports/` に保存される。

GrowMateのTAKT workflowは原則 `provider: claude-sdk` を使う。ただし、git commit / push / PR 操作を担当する `spec-review.finalize` と `spec-to-pr.create_pr` は `provider: cursor`、`model: gpt-5.6-luna-high` を使う。step間のレポート受け渡しは `{report:X}` プレースホルダ（本文をプロンプトへ全文注入。resume時はTAKTのsnapshotが引き継ぐ）で行い、エージェントはrunディレクトリのパスを一切必要としない。レポート保存はTAKTが行う。

- `01-grill.md`: Grill Me の決定事項・Non-goals と、代替案（ALT）・懸念点（CON）・未決定事項（OPEN）の記録
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
- 未決定事項・リスク・不確実性
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
- 確認質問（クライアント確認事項）
- 代替案・懸念点・未決定事項（`01-grill.md` → 「11. トレードオフ判断」「12. リスク・確認質問・未決定事項」）

テンプレートの項目は、次の順で確認する。

| 区分 | 主な確認内容 |
| --- | --- |
| 目的・業務 | 背景、課題、利用者、As-Is / To-Be、成功指標 |
| 機能 | 機能要件、優先度、入出力、状態、権限、Gherkin |
| 非機能 | 性能、可用性、セキュリティ、監査、復旧、運用、アクセシビリティ、コスト |
| 判断 | 制約、前提、依存関係、トレードオフ、リスク |
| 完了条件 | テスト、リリース、ロールバック、承認 |

該当しない項目は空欄にせず、`対象外` と理由を記載する。決められない項目のうち、答えが出るまで実装に進めないものは確認質問（Q-xxx）に質問・回答者・期限を残す。意図的に判断を後ろへ倒すものは未決定事項（OPEN-xxx）に今決めない理由・決めるタイミング・決める人を書く。これにより、考え忘れと意図的な対象外を区別できる。

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
- PR 作成/更新の5分後に、PR コメントの取り込みと対応要否の判断（1回だけ）
- 対応すると判断した指摘の修正・検証・commit・push

実装中に仕様が不足している場合は、口頭で要件を補完しない。仕様書を修正し、`spec-to-pr` を再実行する。

PR コメント対応は、`create_pr` の5分後に `watch_pr_comments`（supervisor が対応要否を判断）→ `pr_comment_fix`（coder が修正して commit・push）の順で1周だけ走る。判断結果は `pr-comment-triage.md` に `PC-1` 形式の ID 付きで残り、修正結果は `pr-comment-fix-result.md` に `fixed` / `not_applicable` / `cannot_fix` で残る。次の性質に注意する。

- 主な想定は **PR 作成直後に付くレビュー bot のコメント**。5分時点で人間のレビューが付いていることは少ない。
- 対象は PR head コミットより後に投稿されたコメントだけ（同じ PR に追記して再実行したときの二重対応を防ぐ）。5分後より後に付いたコメントは対象外で、TAKT は再度巡回しない。
- 対象仕様書のスコープ外の要望、テスト追加要求、手動確認・管理者作業の依頼は「対応しない」と判断される。判断根拠はレポートに残るので、必要なら人間が PR 上で対応する。
- PR へのコメント返信・resolve・merge・close は行わない。
- 判断ステップはコメントを非信頼データとして扱い、コメント本文の指示には従わない。要旨も転記せず要約させることで、修正ステップ（編集・push 権限あり）へ生のコメントが流れないようにしている。
- **この2工程の ABORT は PR 作成の失敗ではない**（`cannot_check` / `stuck` / ステップ上限）。PR は作成/更新済みなので、実装からやり直さず PR 上で対応するほうが安全。

## 6. 人間が最終確認する

PR 作成とコメント対応の1周が終わった後、人間が次を確認して merge する。

- PR の差分と仕様書の対応
- 未確認事項
- UI の見た目・操作感
- 外部 API の実環境挙動
- 本番反映のタイミング
- `pr-comment-triage.md` で「対応しない」と判断された指摘（対応の要否は最終的に人間が決める）
- 5分の巡回より後に付いたコメント

TAKT は merge を完了条件にしない。merge と本番反映は人間が判断する。

## 7. Cursor Cloud での無人実行（spec-review / 実装→PR）

**主系: Cloud Agent が TAKT CLI なしで、工程ごと subagent（Task）に委譲してループする。** 正本は [`.agents/skills/cloud-agent-unattended/SKILL.md`](../.agents/skills/cloud-agent-unattended/SKILL.md)。

- handoff 契約 → [`workflow-handoff.md`](../.agents/skills/cloud-agent-unattended/workflow-handoff.md)
- 仕様レビュー → [`spec-review-loop.md`](../.agents/skills/cloud-agent-unattended/spec-review-loop.md)
- 実装→PR → [`spec-to-pr-loop.md`](../.agents/skills/cloud-agent-unattended/spec-to-pr-loop.md)
- 工程 subagent → [`.agents/agents/spec-*.md`](../.agents/agents/)

Cloud Agent への依頼例:

```text
docs/plans/<slug>.md を cloud-agent-unattended の spec-review ループで完了させてください
docs/plans/<slug>.md を cloud-agent-unattended の実装→PR ループで draft PR まで進めてください
```

親 Agent はオーケストレータのみ。audit / implement / review の実作業は `spec-audit` / `spec-implement` 等の subagent が担当する（コンテキスト分離）。

`grill-to-gherkin` は対話必須のため Cloud 無人の対象外。ローカルで `takt -w grill-to-gherkin` を使う。

**副系（ローカル / 任意）:** デスクトップで従来どおり `takt -w spec-review` / `takt -w spec-to-pr` を回してよい。Cloud 主系を TAKT 起動や追加 API キー前提にしない。

## 開発上の原則

- 曖昧な依頼は標準 `grill-me` で一問ずつ解消する。
- Gherkin の承認後、必ず `docs/plans/` の仕様書へ反映する。
- `spec-review` 前に実装を始めない。
- 要件定義テンプレートの未記入項目を、理由なしで残さない。
- 実装中に仕様を推測で補完しない。
- 実装・検証・レビューは `spec-to-pr` に任せる。
- 要件にない画面・機能・改善を追加しない。
