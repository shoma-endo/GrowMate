下記に全文添付された `01-grill.md`、`02-gherkin.md`、`03-confirmation.md`、`05-rough-estimate.md`、`06-estimate-confirmation.md` をもとに、仕様書レビューへ渡す引き継ぎレポートを作成してください。

必須条件:
- 対象仕様書のパスを明記する。パスは `docs/plans/<slug>.md` であること。
- 承認済み Gherkin の反映先が分かるようにする。
- 概算工数の結果と、概算に含まれない不確実性を引き継ぐ。
- `01-grill.md` の「推奨実装方針（再利用・拡張）」を引き継ぎ、仕様書の「技術前提 > 再利用する既存実装」および必要なトレードオフ判断へ落とすよう次アクションに書く。
- `01-grill.md` の代替案・懸念点・未決定事項を引き継ぎ、仕様書の反映先を明記する。`03-confirmation.md` にユーザー判断がある項目はそちらを優先する。
  - 代替案（ALT-xxx） → 「トレードオフ判断」（見出しを `ALT-xxx: 判断名` にして ID を残す。比較した案・採用案・採用理由・却下理由・将来変更する条件。`影響` と `判断者・判断日` は仕様書作成時に埋める）
  - 懸念点（CON-xxx、種別=不安が残る） → 「リスク・確認質問・未決定事項 > リスク」（R-xxx）
  - 懸念点（CON-xxx、種別=判断できず助けが必要） → 「リスク・確認質問・未決定事項 > 確認質問」（Q-xxx、状態=未回答）。`01-grill.md` の「誰なら答えられるか」を Q-xxx の `回答者` へ写し、`期限` は仕様書作成時に埋める。答えが必要な事項なので、仕様レビューで未解決として扱われて正しい。ただし `03-confirmation.md` で回答が得られた CON は Q-xxx にせず、決定事項として仕様書本文へ反映し、`04-handoff.md` の「ユーザー判断による上書き」行に ID を残す。
  - スケール前提 → 「8. 非機能要件 > 拡張性・互換性」
  - 未決定事項（OPEN-xxx） → 「リスク・確認質問・未決定事項 > 未決定事項（今は決めない）」（今決めない理由・決めるタイミング・決める人）。Q-xxx の表へ書かない。取り違えると、意図的に決めない項目が仕様レビューのブロッカーとして誤検知される。
- `06-estimate-confirmation.md` が `着手承認` であることを確認する。
- 新規仕様書の場合は `docs/templates/requirement-definition.md` をコピーして、要件定義の全項目を埋めるよう明記する。該当なし・未確定の項目には理由または確認事項を残す。
- 次の手順を明記する。
  1. 新規仕様書なら `docs/templates/requirement-definition.md` を `docs/plans/<slug>.md` にコピーする。
  2. `02-gherkin.md` の Gherkin を対象仕様書の受け入れ条件へ反映する。
  3. `01-grill.md` の推奨実装方針を、仕様書の「10. 制約・前提・依存関係 > 技術前提 > 再利用する既存実装」へ反映する。おすすめ案を採用しない場合は却下理由を書く。複数案を比較して却下した判断は「11. トレードオフ判断」に一度だけ書き、§10 には採用結果（再利用/拡張/新規と根拠 path）だけを残す。
  4. `01-grill.md` の代替案・懸念点・未決定事項を、上記の反映先へ振り分ける。
  5. 要件定義の未記入項目を埋める。対象外は理由を記載する。
  6. `05-rough-estimate.md` の概算工数・前提・不確実性を確認する。
  7. `06-estimate-confirmation.md` の着手承認を確認する。
  8. `takt -w spec-review -t "docs/plans/<slug>.md をレビューしてください"` を実行する。
  9. spec-review 完了後、`takt -w spec-to-pr -t "docs/plans/<slug>.md 仕様書に沿って実装してください"` を実行する。
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
