下記に全文添付された `plan.md` と対象仕様書に従い、GrowMate の既存パターンに合わせて最小差分で実装してください。要件にない画面・UI・機能・改善を追加せず、ついで修正や将来対応は別タスクへ切り出してください。

規約の正本は `.agents/skills/` にある。着手前に該当する SKILL.md を読み、そこに従う（本 instruction には再掲しない）:
- 全実装（TypeScript / any禁止 / Zod / 機密情報 / 自動生成ファイル / ページ種別制約）: `implementation-guidelines`
- Server Actions / Route Handlers / エラー処理: `nextjs-server`
- UI 変更: `growmate-ui-ux` と `react`
- Supabase / migration / RLS / Service Role のスコープ条件: `supabase`。未適用マイグレーションは `service-usage.md` §6 の Pending Migration Types パターンで実装を継続する（型が無いことを理由に停止・ABORT しない）
- テスト方針: `docs/specs/testing-strategy.md`（自動テスト対象のみ Vitest を追加・更新。簡易・形式的・低価値なテストは追加しない。実行は `npm run test`、`npx vitest` 直接実行は不可）

{{include:instructions/unattended-operation}}

運用前提（このステップ固有）:
- 既存 WIP / 既存ブランチがある場合はそれを継続し、無関係な作り直しをしない。
- 実装開始前に対象仕様書の現行版を再読し、`plan.md` 作成時点の内容と食い違いがないか確認する。食い違いがあれば実装を進めず plan への差し戻しを判断する。
- UI 実装が対象で `plan.md` または仕様が UIモックを正本としている場合、着手前に `docs/plans/_html/<slug>.html` の **UIモック** タブ（なければ `views/06-ui-mock.html`）を開き、見た目・文言・状態別UIをそれに合わせる。モックと仕様の画面設計が食い違うときは **仕様書の明示を優先**し、差分を implement レポートに書く。モックが無いのに UI を新規に「それっぽく」作らない（計画へ差し戻し）。
- 変更差分が対象仕様書と `plan.md` の対象範囲内に収まっていることを確認する。対象外の差分が必要になった場合は実装を進めず ABORT する。
- 実装後に `npm run verify` を実行し、失敗した場合は修正して再実行する。

## plan.md（全文）
{report:plan.md}
