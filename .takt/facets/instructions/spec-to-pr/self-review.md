`.agents/skills/quality-gate/SKILL.md` と `.agents/skills/quality-gate/self-review.md` に従い、2パスセルフレビューを実施してください。

確認対象:
- 仕様書の全要件が実装されていること。マイグレーションがリモート未適用のため `Pending Migration Types`（`src/types/database.types.pending.ts`）を使っている場合、それ自体は未実装・スコープ外を意味しない。`npm run verify` が通っていれば実装完了として扱い、「型未反映」のみを理由に `needs_fix` にしない。
- 対象仕様書（`docs/plans/` 配下）が本PRのスコープで完全実装されたか（未実装フェーズ・TODO・スコープ外セクションが残っていないか）を判定し、`self-review.md` に明記する。Pending Migration Types を使っている場合は、その旨と「管理者によるマイグレーション適用・型再生成・pendingファイル削除」が残タスクである旨を明記する（実装未完了とは区別する）。
- `npm run verify` が成功していること。
- architecture-reviewer の open findings がないこと。
- `readme-sync.md` に README の更新要否と根拠が記録され、更新要の場合は実装差分と `README.md` が同期していること。
- 変更差分が対象仕様書と `plan.md` の対象範囲内であり、余計な差分や機密情報の露出がないこと。
- PR確認用の要約に関連仕様書、検証結果、architecture review / self-review 結果、完了判断理由を含められること。

{{include:instructions/unattended-operation}}

- UI 変更がある場合は「手動ブラウザ確認未実施」を未確認事項候補として記録する。

## plan.md（全文）
{report:plan.md}
