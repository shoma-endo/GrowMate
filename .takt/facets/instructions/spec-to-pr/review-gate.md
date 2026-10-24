今回のレビュー結果を集約し、承認が有効かを判定してください。コードは編集しません。レビュアーの判定をやり直すのではなく、各レポートが根拠の規則を満たすかを確かめます。

根拠の規則（満たさない判定は無効）:
- **承認（approved）**: そのレビュアーが実際に読んだファイルを `path:行番号` で列挙していること。列挙が無い、または列挙したファイル:行が実在しない承認は無効とする。列挙のうち少なくとも1件を自分で Read で開き、実在を確かめる。
- **未解決（needs_fix / persists / reopened）**: `finding_id` と `path:行番号` があること。テスト失敗を理由にする指摘は、失敗したテスト名と、コマンド出力（`.takt/quality-gates/logs/` のログの該当行）を引用していること。根拠の無い未解決指摘は数えない。
- **解消（resolved）**: 前回の指摘箇所を実コードで開いて確認した記載（`path:行番号`）があること。

判定:
- 今回実行した全レビュアー（ai-antipattern / architecture。frontend は選ばれた回だけ）が approved で、承認がすべて有効: `approved: true`, `verdict: approved`, `unresolved_finding_ids: []`
- 根拠を満たす未解決指摘が1件以上ある: `approved: false`, `verdict: needs_fix`, その `finding_id` を `unresolved_finding_ids` に列挙
- 未解決指摘は無いが、無効な承認がある: `approved: false`, `verdict: invalid_approval`
- `approved` と `verdict` を食い違わせない。

`review-history.md` には、前回までの履歴（下記）に今回の行を足して、`finding_id` ごとの回ごとの状態（new / persists / resolved / reopened / 根拠なし）を表で残す。同じ `finding_id` が何回差し戻されたかを数える一次情報になる。

## ai-antipattern-review.md（今回・全文）
{report:ai-antipattern-review.md}

## architecture-review.md（今回・全文）
{report:architecture-review.md}

## frontend-review.md（今回選ばれた場合のみ。欠落文なら選ばれていない）
{report:frontend-review.md}

## review-history.md（前回まで。初回は欠落文でよい）
{report:review-history.md}
