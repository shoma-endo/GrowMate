`review-arch` 相当の観点で、アーキテクチャ、責務分離、データ境界、セキュリティ、仕様充足、既存パターンとの整合性をレビューしてください。

{{include:instructions/unattended-operation}}

GrowMate 固有条件:
- 対象仕様書は添付 `plan.md` の `# タスク計画` 直後の `対象仕様書:` 行のパス。その現行ファイルを読む。`docs/plans/` を列挙・推測しない。ヘッダ欠落なら、コード修正ではなく plan 再作成が必要である旨を明記して `needs_fix` とする（`fix` が `info_missing` で plan へ戻す）。
- 変更差分が対象仕様書と `plan.md` の `対象スコープ:` 内か確認する。混入があれば `needs_fix` とする。
- 自動テスト対象の変更では、仕様書または `plan.md` に定義したVitestケースが追加・更新され、`npm run test` が成功していることを確認する。対象外の変更にテスト不在を理由として `needs_fix` にしない。
- `plan.md` に spec-review で残置合意された指摘が転記されている場合、**その論点を再指摘して `needs_fix` にしない**（仕様書レビュー段階で理由付きの残置が合意済みのため）。実装が仕様書の記述どおりかだけを見る。
- 対象仕様書または GrowMate knowledge がテスト追加不要を明示している場合、テスト不在のみを理由に `needs_fix` にしない。
- 簡易・形式的・低価値なユニットテストの追加を要求しない。
- 逆に、追加・変更されたテストが「実行するだけで検証しない」形なら `needs_fix` にする。判定基準: 戻り値や状態を照合しない（`toBeDefined` / `not.toThrow` / `toBeTruthy` だけ）、実装と同じ式を期待値に書き写している、ビジネスロジック側を丸ごと mock して呼び出し回数しか見ていない。カバレッジ閾値通過のためだけに見えるテストは、その旨を指摘に書く。
- 代替検証として `npm run verify` が実行されているかを確認する。
- UI変更がある場合は `.agents/skills/growmate-ui-ux/SKILL.md` を正本として、対象差分が既存の同種画面・`src/components/ui/`・`app/globals.css` から逸脱していないことを確認する。判断に迷った新規パターン、要件にないUI刷新、新しいデザインパターンの追加は `needs_fix` とする。
- UI変更があるのに `plan.md` に「UI 既存パターン対照表」が無い場合は `needs_fix` とする。表がある場合は行ごとに、差分が表の方法どおりか（「写す」ならマークアップとクラスが既存と同じか、「そのまま使う」「共通化」なら既存コンポーネントを import しているか）を既存ファイルと突き合わせる。表に根拠の無い見出し・文言・色クラス・`title` / `aria-label`・アイコン・余白の違いは `needs_fix` とする。生の Tailwind 色を既存に合わせて使っていること自体は指摘しない（`growmate-ui-ux` の優先順位）。
- `.agents/skills/supabase/service-usage.md` §6 の Pending Migration Types パターンは、マイグレーション未適用時の許容された実装パターンである。パターンに従っている（合成 `Database` 型が対象マイグレーションSQLと一致し、キャスト箇所が1箇所に閉じている）限り、キャスト自体を理由に `needs_fix` にしない。
- 実装上の correctness / security / data integrity / architecture 問題がある場合は具体的に `needs_fix` とする。
- 指摘には必ず `finding_id` を付ける。follow-up 時の突合・再指摘禁止は後続の共有規則に従う。

## plan.md（全文）
{report:plan.md}
