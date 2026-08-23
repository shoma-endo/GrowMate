レビュー結果を確定し、仕様書に変更がある場合は現在のブランチに commit してください。新しいブランチの作成・push・PR 操作は行わないでください。

前提: このステップに到達した時点で、直前の audit の structured verdict は `approved` である（`needs_fix` / `approved_with_questions` ではここに来ない）。

手順:
1. `git status` / `git diff` で変更内容を確認する。`docs/` 以外の dirty があっても ABORT しない。それらはステージせず、最終レポートに「作業ツリーに残した未コミット変更」としてパスを列挙する。
2. **メタデータ `ステータス` を `approved` に更新する（必須）:**
   - 対象は本ランの対象仕様書（`docs/plans/<slug>.md`）。`docs/templates/requirement-definition.md` のメタデータ形式（`- ステータス: ...`）を持つ文書が対象。
   - 値がすでに `approved` または `implemented` なら触らない（`implemented` を下げない）。
   - それ以外（`draft` / `review` / 空欄 / 表記ゆれ）は **`approved` に書き換える**。あわせて `- 最終更新日:` を当日（YYYY-MM-DD）にする。
   - 仕様書に「仕様レビュー（spec-review）通過」類のチェックポイント行があれば、状態を通過済みに更新してよい（無ければ作らない）。
   - この更新は revise 差分の有無に依存しない。**指摘ゼロの approved でも必ず行う。**
3. 仕様書に変更がある場合（revise 差分、または手順2のステータス更新を含む）: 本ランで直した `docs/` 配下だけを `git add` する（対象仕様書と、revise が直した付随 docs。判断できなければ対象仕様書だけ）。`docs/plans/_html/` は `.gitignore` 済みなので add しない。現在のブランチのまま、日本語1行メッセージで commit する。ブランチ作成（`git checkout -b` / `git switch -c` 等）と `git push` は行わない。
4. 仕様書に変更が全くない場合: 手順2のあとでも差分がゼロなら commit は行わない（すでに `approved`/`implemented` で他変更なし）。他の dirty の有無は問わない。
5. 最終レポートに以下を含める: 指摘サマリ（重大度別件数）、メタデータ `ステータス` の更新有無（更新前→更新後）、未解決のクライアント確認質問、公式ドキュメント照合の実施可否（下記添付の `spec-audit.md` 冒頭の記載を転記。未実施ならその理由）と照合した URL・確認日（未確認のまま残った URL があれば明記）、図解 HTML の更新有無とパス（`docs/plans/_html/<slug>.html`。commit 対象外）、作業ツリーに残した未コミット変更（なければ「なし」）、次アクション（質問回答 → 必要なら人間が push/PR → `.takt/workflows/spec-to-pr.yaml` で実装）。

やらないこと:
- 新しいブランチの作成・切り替え。
- `git push`（`-u` 含む）。
- PR の作成・更新・マージ・クローズ（`gh pr create` / `gh pr edit` / `gh pr comment` 含む）。
- `docs/` 以外の編集・ステージ・コミット。
- `docs/` 以外が dirty であることだけを理由にした ABORT。

## spec-audit.md（最新・全文）
{report:spec-audit.md}
