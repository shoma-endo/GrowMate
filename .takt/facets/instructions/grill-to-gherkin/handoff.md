下記に全文添付された `01-grill.md`、`02-gherkin.md`、`03-confirmation.md`、`05-rough-estimate.md`、`06-estimate-confirmation.md` をもとに、仕様書レビューへ渡す引き継ぎレポートを作成してください。

必須条件:
- 対象仕様書のパスを明記する。パスは `docs/plans/<slug>.md` であること。
- 承認済み Gherkin の反映先が分かるようにする。
- 概算工数の結果と、概算に含まれない不確実性を引き継ぐ。
- `01-grill.md` の「推奨実装方針（再利用・拡張）」を引き継ぎ、仕様書の「技術前提 > 再利用する既存実装」および必要なトレードオフ判断へ落とすよう次アクションに書く。
- `01-grill.md` の代替案・懸念点・未決定事項を引き継ぎ、仕様書の反映先を明記する。
  - 代替案 → 「11. トレードオフ判断」（比較した案・採用案・採用理由・却下理由・将来変更する条件）
  - 懸念点 → 「12. リスク・未確定事項・確認質問 > リスク」（判断できず助けが必要なものは確認質問として残す）
  - 未決定事項 → 「12. リスク・未確定事項・確認質問 > 未確定事項」（今決めない理由・決めるタイミング・決める人を残す）
- `06-estimate-confirmation.md` が `着手承認` であることを確認する。
- 新規仕様書の場合は `docs/templates/requirement-definition.md` をコピーして、要件定義の全項目を埋めるよう明記する。該当なし・未確定の項目には理由または確認事項を残す。
- 次の手順を明記する。
  1. 新規仕様書なら `docs/templates/requirement-definition.md` を `docs/plans/<slug>.md` にコピーする。
  2. `02-gherkin.md` の Gherkin を対象仕様書の受け入れ条件へ反映する。
  3. `01-grill.md` の推奨実装方針を、仕様書の「再利用する既存実装」と（必要な場合）トレードオフ判断へ反映する。おすすめ案を採用しない場合は却下理由を書く。
  4. `01-grill.md` の代替案・懸念点・未決定事項を、仕様書の「11. トレードオフ判断」「12. リスク・未確定事項・確認質問」へ反映する。
  5. `05-rough-estimate.md` の概算工数・前提・不確実性を確認する。
  6. `06-estimate-confirmation.md` の着手承認を確認する。
  7. `takt -w spec-review -t "docs/plans/<slug>.md をレビューしてください"` を実行する。
  8. spec-review 完了後、`takt -w spec-to-pr -t "docs/plans/<slug>.md 仕様書に沿って実装してください"` を実行する。
- この step では仕様書・プロダクションコードを編集せず、後続 workflow を自動実行しない。
- 対象仕様書パス、承認済み Gherkin、次アクションが揃った場合は、最後に `引き継ぎ情報を作成` と明記する。

## 01-grill.md（全文）
{report:01-grill.md}

## 02-gherkin.md（全文）
{report:02-gherkin.md}

## 03-confirmation.md（全文）
{report:03-confirmation.md}

## 05-rough-estimate.md（全文）
{report:05-rough-estimate.md}

## 06-estimate-confirmation.md（全文）
{report:06-estimate-confirmation.md}
