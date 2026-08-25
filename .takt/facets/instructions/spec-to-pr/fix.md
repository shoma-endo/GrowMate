下記に全文添付されたレビュー2本（`ai-antipattern-review.md` / `architecture-review.md`）を一次情報として、未解決の指摘だけをまとめて修正してください。実装規約の正本は implement ステップと同じ `.agents/skills/`（`implementation-guidelines` / `nextjs-server` / `growmate-ui-ux` / `react` / `supabase`）。

必須条件:
- 対象仕様書は添付 `plan.md` の `# タスク計画` 直後の `対象仕様書:` 行のパス。修正着手前にその現行版を確認し、レビュー指摘の範囲を超える仕様変更がないか確認する。`docs/plans/` を列挙・推測しない。ヘッダ欠落、またはレビュー指摘が plan.md ヘッダ欠落のみの場合は、コードを直さず `info_missing`。
- 両レビュアーの未解決指摘は、指摘対象コードを直接修正する。approved 側のレポートに指摘が無ければそのレビュー系統の修正は不要。
- 修正対象が git hygiene / 不要ファイル混入 / レポート不足 / 検証証跡不足だけの場合は、その対象だけを直す。
- テストやドキュメント追加だけでレビュー指摘を回避しない。
- 簡易・形式的・低価値なユニットテストは追加しない。テスト追加は対象仕様書またはユーザー指示で明示されている場合に限る。
- 同種の潜在箇所がある場合は同時に修正する。
- プロダクションコードを変更した場合は `npm run verify` を再実行する。
- ここでは commit / push を行わない。最終ステップでまとめて実施する。

## plan.md（全文）
{report:plan.md}

## ai-antipattern-review.md（全文）
{report:ai-antipattern-review.md}

## architecture-review.md（全文）
{report:architecture-review.md}
