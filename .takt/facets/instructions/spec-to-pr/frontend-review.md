GrowMate の UI 変更をフロントエンドの観点でレビューしてください。上の共通の観点に加えて、次を必ず行う。

- UI の正本は `.agents/skills/growmate-ui-ux/SKILL.md`。差分を「UI 既存パターン対照表」（添付 `plan.md`）の行ごとに既存ファイルと突き合わせる。
- 下記 `ui-evidence.md` の表で、**対象画面**にページ横はみ出しまたはセルのはみ出し（`scrollWidth > clientWidth`）が1件でもあれば `needs_fix` とし、画面・画面幅・列の見出しを `finding_id`（例: `FE-OVERFLOW-...`）付きで指摘する。既存の類似画面だけのはみ出しは今回の差分の回帰ではないので指摘しない。
- 表にある対象画面と既存の類似画面のスクリーンショット（PNG の絶対パス）を Read で開き、同じ画面幅どうしで見比べる。見出し・文言・色・余白・列幅・ボタンの並びに、対照表に根拠の無い違いがあれば `needs_fix` とする。
- `ui-evidence.md` が `not_applicable` なら UI 証跡の確認は不要。`cannot_capture` または欠落文なら、証跡が無いことを `FE-EVIDENCE-MISSING` として `needs_fix` にする（UI 変更があるのに見比べられないまま承認しない）。

## ui-evidence.md（最新・全文）
{report:ui-evidence.md}

## plan.md（全文）
{report:plan.md}
