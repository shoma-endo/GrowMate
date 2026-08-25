下記に全文添付された `self-review.md` の未解決指摘を一次情報として修正してください。architecture review は収束済みのため、同じ確認を繰り返さないでください。新しい architecture / antipattern 指摘を発明しないでください。

必須条件:
- 対象仕様書は添付 `plan.md` の `# タスク計画` 直後の `対象仕様書:` 行のパス。修正着手前にその現行版を確認し、指摘の範囲を超える仕様変更がないか確認する。`docs/plans/` を列挙・推測しない。ヘッダ欠落、または指摘が plan.md ヘッダ欠落のみの場合は、コードを直さず `info_missing`。
- self-review.md の該当項目を優先して修正する。指摘に ID がある場合は `finding_id` 単位で扱い、`fix-result.md` 先頭に `| finding_id | disposition | 根拠 |`（`fixed` / `not_applicable` / `cannot_fix`）を残す。
- 修正対象が git hygiene / 不要ファイル混入 / レポート不足 / 検証証跡不足だけの場合は、その対象だけを直す。
- 簡易・形式的・低価値なユニットテストは追加しない。テスト追加は対象仕様書またはユーザー指示で明示されている場合に限る。
- 同種の潜在箇所がある場合は同時に修正する。
- 追加修正で閉じられない残件だけが残る場合（手動ブラウザ確認未実施、管理者のマイグレーション適用・型再生成・pending削除、仕様がテスト追加不要と明示する論点、残置合意）は、コードを増やさず `cannot_fix` として記録し、verdict は `fixed` とする（後段ループが抜けられるようにする）。
- `stuck` は、指摘内容が矛盾・不明で進行不能な場合、またはコード修正が必要と分かっているのに根拠不足で触れない場合に限る。台帳・再発メタ作業だけで回転させない。
- プロダクションコードを変更した場合は `npm run verify` を再実行する。
- ここでは commit / push を行わない。最終ステップでまとめて実施する。

## plan.md（全文）
{report:plan.md}

## self-review.md（全文）
{report:self-review.md}

## architecture-review.md（全文・参考。APPROVE 済みの前提を崩さない）
{report:architecture-review.md}

## 前回 fix-result.md（あれば。欠落文なら無視）
{report:fix-result.md}
