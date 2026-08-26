GrowMate のレビュー往復向け規則（初回・再レビュー共通）:

- 下記 `fix-result.md` が欠落文のみ、または実質空なら **初回レビュー** として扱う。
- `fix-result.md` に前回修正の記録がある場合は **follow-up レビュー** として扱う。
- follow-up では、前回レビューレポートの各指摘を `finding_id` で突合し、次だけを報告する。
  - `resolved`: 修正を確認できた
  - `persists`: 同じ問題が残っている（同じ `finding_id` を維持）
  - `new`: 今回初めて確認した実害（回帰、または前回未発見でコード根拠があるもの）
  - `reopened`: 解消済みだったものが今回の修正で再発
- `finding_id` が無い指摘は無効であり、それだけで `needs_fix` にしない。
- `fix-result.md` で対応済み・対象外・追加修正不能と記録された ID を、新しい根拠なく再指摘しない。
- `plan.md` に転記された spec-review 残置合意、および仕様書または GrowMate knowledge がテスト追加不要と明示する論点を再指摘しない。
- 新規指摘は、観測できる実害または回帰に限る。未変更領域の一般探索や、指摘のための指摘を増やさない。
- 初回レビューでも、各指摘に安定した `finding_id`（例: `ARCH-NEW-...` / `AI-NEW-...`）を付ける。

## fix-result.md（前回修正。初回は欠落文でよい）
{report:fix-result.md}

## 前回 ai-antipattern-review.md（初回は欠落文でよい）
{report:ai-antipattern-review.md}

## 前回 architecture-review.md（初回は欠落文でよい）
{report:architecture-review.md}
