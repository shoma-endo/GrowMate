`docs/plans/` の仕様書を起点に、GrowMate の実装計画を作成してください。

{{include:instructions/unattended-operation}}

運用前提（このステップ固有）:
- 人間の介在点は `docs/plans/` の仕様確定のみ。
- `spec-review` が対象スコープの未解決質問・実装判断・外部入力・承認ゲートなしで approved 完了していることが実装開始の前提。仕様不足・曖昧さ・未回答事項がある場合は実装に進まず ABORT し、人間が仕様書を直して `spec-review` から再実行する前提の確認事項を残す。

必須手順:
1. ユーザー指示から対象仕様書を特定する。曖昧な場合は `docs/plans/` を列挙し、候補を示して ABORT する。
2. 対象仕様書、`AGENTS.md`、`.takt/facets/knowledge/growmate.md`、`.agents/skills/implementation-guidelines/SKILL.md` を読む。
3. Server Actions / Route Handlers / Zod / エラー処理が関わる場合は `.agents/skills/nextjs-server/SKILL.md` を読む。
4. UI 実装が関わる場合は `.agents/skills/growmate-ui-ux/SKILL.md` と `.agents/skills/react/SKILL.md` を読む。
5. Supabase / migration / RLS / Service Role が関わる場合は `.agents/skills/supabase/SKILL.md` を読む。
6. 再実行 / 途中再開の現状を確認する（新規一発前提で計画しない）:
   - 現在ブランチ、`git status`、未コミット差分の有無。
   - 対象仕様に対応しそうな既存リモートブランチ（`feature/*` / `fix/*`）と、その open PR（`gh pr list`）。
   - 既存 WIP / 既存 PR がある場合は「差分追記」計画にし、ゼロからの作り直しを避ける。前回までの経緯は既存ブランチの差分・PR 本文・対象仕様書から把握する（`.takt/runs/` 配下は探索しない）。
7. 仕様要件と現行コード（および既存 WIP）の差分、変更対象、検証方法、PR本文に記載すべき関連仕様書を整理する。仕様書の対象範囲と Non-goals から実装許可範囲を定義し、対象外の画面・UI・機能・改善を `plan.md` に含めない。
   - 純粋関数、境界値・分岐の多いロジック、正規化・集計・日付処理、分離済みZodスキーマ、既知バグの回帰に関わる場合は `docs/specs/testing-strategy.md` を読み、追加・更新するVitestケースと期待結果を計画に含める。
   - UIコンポーネント、外部API、Supabase / RLS / RPC、LLM出力そのものは同戦略の自動テスト対象外として扱い、仕様書または手動確認へ振り分ける。
8. 対象仕様書内の spec-review 反映内容を取り込む（spec-review workflow はレビュー結果を仕様書本体の「レビュー記録」「未確定事項（クライアント確認中）」セクションに記録する。`.takt/runs/` 配下は探索しない）:
   - これらのセクションが無い場合はブロックしないが、計画レポートに「spec-review 記録なし」と明記する。
   - 記録がある場合、**理由付きで残置合意された指摘（approved の 🟡 残置）を `plan.md` に転記する**。後段の `review` が同じ論点を再指摘して review -> fix ループを空回りさせないため。`approved_with_questions` はレビュー未完了なので、対象スコープの未解決質問・実装判断・外部入力・承認ゲートがあれば ABORT する。
   - 仕様書に「公式ドキュメント照合: 未実施」と記録されている場合、その旨を `plan.md` に明記する（実装時に前提が未検証であることを PR の未確認事項へ回すため）。
9. 仕様が新規マイグレーション（新規テーブル・新規列）を要求し、それがまだリモートDBに未適用（`database.types.ts` に反映されていない）場合、これ単体は ABORT 理由にしない。`.agents/skills/supabase/service-usage.md` §6 の Pending Migration Types パターン（`src/types/database.types.pending.ts` + `asPendingClient()`）を計画に含め、最後まで実装する前提で進める。リモートへの適用と `npm run supabase:types` は管理者が本PRマージ後に行う運用とし、完了条件にしない。
10. `plan.md` は要点のみに絞る（上限目安 15KB）。仕様書・レビュー記録・既存コードは本文を転記せず、章番号・行番号・パスで参照する。`plan.md` は後段の implement / review / self_review / prepare_pr_summary へ全文添付されるため、肥大がそのまま全ステップの入力コストになる。
