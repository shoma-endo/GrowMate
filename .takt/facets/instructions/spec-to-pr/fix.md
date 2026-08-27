下記に全文添付されたレビュー2本（`ai-antipattern-review.md` / `architecture-review.md`）を一次情報として、未解決の指摘だけをまとめて修正してください。実装規約の正本は implement ステップと同じ `.agents/skills/`（`implementation-guidelines` / `nextjs-server` / `growmate-ui-ux` / `react` / `supabase`）。

必須条件:
- 対象仕様書は添付 `plan.md` の `# タスク計画` 直後の `対象仕様書:` 行のパス。修正着手前にその現行版を確認し、レビュー指摘の範囲を超える仕様変更がないか確認する。`docs/plans/` を列挙・推測しない。ヘッダ欠落、またはレビュー指摘が plan.md ヘッダ欠落のみの場合は、コードを直さず `info_missing`。
- 両レビュアーの未解決指摘は `finding_id` 単位で扱い、指摘対象コードを直接修正する。approved 側のレポートに指摘が無ければそのレビュー系統の修正は不要。
- `fix-result.md`（coder-decisions）の先頭に、対応した `finding_id` ごとの表を必ず書く（後段 follow-up が突合する一次情報）:
  `| finding_id | disposition | 根拠 |`（disposition は `fixed` / `not_applicable` / `cannot_fix`）。その後に通常の決定ログを続けてよい。
- 修正対象が git hygiene / 不要ファイル混入 / レポート不足 / 検証証跡不足だけの場合は、その対象だけを直す。
- テストやドキュメント追加だけでレビュー指摘を回避しない。
- 簡易・形式的・低価値なユニットテストは追加しない。テスト追加は対象仕様書またはユーザー指示で明示されている場合に限る。
- 同種の潜在箇所がある場合は同時に修正する。
- 追加修正で閉じられない残件（仕様がテスト追加不要と明示、残置合意、無人では検証不能な手動確認のみ等）は、無理にコードやテストを増やさず `cannot_fix` として記録する。それ以外に未解決の実害指摘が残る場合だけ `stuck`。実害指摘をすべて処理でき、残が `cannot_fix` / `not_applicable` のみなら `fixed`。
- 検証: プロダクション影響パス（`app/` `src/` `tests/` `supabase/` `public/` `scripts/` および `package.json` / Next・ESLint・Vitest・tsconfig 等のビルド設定）を変更した場合だけ、ステップ内で `npm run verify`（または `npm run verify:changed`）を実行する。docs / README / `.takt` / `.agents` のみならフル verify は不要（`git diff --check` で足りる）。ステップ後の quality_gates も同じ差分判定（`npm run verify:changed`）なので、成功済みのフル verify をゲート前に二重実行しない。
- ここでは commit / push を行わない。最終ステップでまとめて実施する。

## plan.md（全文）
{report:plan.md}

## ai-antipattern-review.md（全文）
{report:ai-antipattern-review.md}

## architecture-review.md（全文）
{report:architecture-review.md}
