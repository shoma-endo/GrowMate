下記に全文添付された `01-grill.md`、`02-gherkin.md`、`03-confirmation.md`、`05-rough-estimate.md`、`06-estimate-confirmation.md` をもとに、仕様書レビューへ渡す引き継ぎレポートを作成してください。

必須条件:
- 対象仕様書のパスを明記する。パスは `docs/plans/<slug>.md` であること。
- 承認済み Gherkin の反映先が分かるようにする。
- 概算工数の結果と、概算に含まれない不確実性を引き継ぐ。
- `06-estimate-confirmation.md` が `着手承認` であることを確認する。
- 新規仕様書の場合は `docs/templates/requirement-definition.md` をコピーして、要件定義の全項目を埋めるよう明記する。該当なし・未確定の項目には理由または確認事項を残す。
- 次の手順を明記する。
  1. 新規仕様書なら `docs/templates/requirement-definition.md` を `docs/plans/<slug>.md` にコピーする。
  2. `02-gherkin.md` の Gherkin を対象仕様書の受け入れ条件へ反映する。
  3. `05-rough-estimate.md` の概算工数・前提・不確実性を確認する。
  4. `06-estimate-confirmation.md` の着手承認を確認する。
  5. `takt -w spec-review -t "docs/plans/<slug>.md をレビューしてください"` を実行する。
  6. spec-review 完了後、`takt -w spec-to-pr -t "docs/plans/<slug>.md 仕様書に沿って実装してください"` を実行する。
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
