レビュー結果を確定し、仕様書に変更がある場合は現在のブランチに commit してください。新しいブランチの作成・push・PR 操作は行わないでください。

前提: このステップに到達した時点で、直前の audit の structured verdict は `approved` である（`needs_fix` / `approved_with_questions` ではここに来ない）。

手順:
0. **git 書き込み可否を先に確認する（必須）:**
   - `git status` が通ること、および `docs/` 配下の一時ファイルを stage できるかを試す（例: 対象外の空ファイルは作らず、`git update-index --refresh` や `git add -n -- docs/plans/<slug>.md` の dry-run、もしくは既存の変更に対する `git add --dry-run`）。
   - `.git/index.lock` 作成や `git add` が `Operation not permitted` / `Read-only file system` / permission denied で失敗する場合は **commit を再試行しない**。手順2のメタデータ `approved` 更新だけ行い（ファイル編集は可能なら実施）、最終レポートに「レビュー完了・commit 未実施（環境が `.git` 書き込み不可）」と残差分パスを書いて完了する。この場合は **ABORT しない**（レビュー本体は成立している）。
1. `git status` / `git diff` で変更内容を確認する。`docs/` 以外の dirty があっても ABORT しない。それらはステージせず、最終レポートに「作業ツリーに残した未コミット変更」としてパスを列挙する。
2. **メタデータ `ステータス` を `approved` に更新する（必須）:**
   - 対象は本ランの対象仕様書（`docs/plans/<slug>.md`）。`docs/templates/requirement-definition.md` のメタデータ形式（`- ステータス: ...`）を持つ文書が対象。実装メモも `- ステータス:` があれば同様。
   - 値がすでに `approved` または `implemented` なら触らない（`implemented` を下げない）。
   - それ以外（`draft` / `review` / 空欄 / 表記ゆれ）は **`approved` に書き換える**。あわせて `- 最終更新日:` を当日（YYYY-MM-DD）にする。
   - 仕様書に「仕様レビュー（spec-review）通過」類のチェックポイント行があれば、状態を通過済みに更新してよい（無ければ作らない）。
   - この更新は revise 差分の有無に依存しない。**指摘ゼロの approved でも必ず行う。**
   - **「現在地と次の一手」を上書きする:** ステータスを手順2で書き換えた、または revise 差分がある場合に行う（ステータスが元から `approved` / `implemented` で revise 差分も無ければ触らない）。工程が既に `実装 PR レビュー待ち` なら工程欄は戻さず、更新日・更新した工程だけを直す。それ以外は現在の工程=`spec-review 通過`。次の一手は、実装前ゲートが未承認なら「誰が何を承認するか」、それ以外は `takt -w spec-to-pr -t "docs/plans/<slug>.md 仕様書に沿って実装してください"`。止まっている理由・待っている人、更新日・更新した工程（spec-review finalize）も埋める。節が無い既存仕様書では、メタデータの直後に `docs/templates/requirement-definition.md` と同じ体裁で作る。
   - **変更履歴に1行追加する:** 上と同じ条件で行う。列は 日付=当日、変更内容=「spec-review 通過」と revise で直した指摘の要約（指摘ゼロなら「指摘なし」）、変更理由=「仕様レビュー」、変更者=`spec-review`。変更履歴の表が無い既存仕様書では、末尾に `### 変更履歴` の表を作る。
3. 手順0で git 書き込み不可だった場合: 手順2のファイル更新まで行い、commit はせず最終レポートへ進む（完了扱い）。
4. 仕様書に変更がある場合（revise 差分、または手順2のステータス更新を含む）かつ手順0で書き込み可: 本ランで直した `docs/` 配下だけを `git add` する（対象仕様書と、revise が直した付随 docs。判断できなければ対象仕様書だけ）。`docs/plans/_html/` は `.gitignore` 済みなので add しない。現在のブランチのまま、日本語1行メッセージで commit する。ブランチ作成（`git checkout -b` / `git switch -c` 等）と `git push` は行わない。
5. 仕様書に変更が全くない場合: 手順2のあとでも差分がゼロなら commit は行わない（すでに `approved`/`implemented` で他変更なし）。他の dirty の有無は問わない。
6. 最終レポートに以下を含める: 指摘サマリ（重大度別件数）、メタデータ `ステータス` の更新有無（更新前→更新後）、未解決のクライアント確認質問、公式ドキュメント照合の実施可否（下記添付の `spec-audit.md` 冒頭の記載を転記。未実施ならその理由）と照合した URL・確認日（未確認のまま残った URL があれば明記）、図解 HTML の更新有無とパス（`docs/plans/_html/<slug>.html`。commit 対象外。実装メモでスキップした場合はその旨。UIたたき台CPがある場合は UIモックタブの有無も）、作業ツリーに残した未コミット変更（なければ「なし」）、次アクション。
   - 次アクションの書き方: 未解決のクライアント質問があれば「回答を仕様書へ反映 → `spec-review` 再実行」。commit 未実施（権限）なら「人間が対象 docs を commit → 必要なら push/PR」。それ以外で質問無しなら「必要なら人間が push/PR」。
   - **実装前ゲート（UIたたき台／UIモック等）が未確認のまま残っている場合は、`spec-to-pr` へ進ませない。** 「図解 HTML の UIモックを PO が承認し、仕様の当該 CP を承認済みに更新してから `.takt/workflows/spec-to-pr.yaml`」と書く。
   - 実装前ゲートが無い、または承認済みなら「`.takt/workflows/spec-to-pr.yaml` で実装」でよい。
   - 注: 本 workflow の `approved`（メタ `ステータス: approved`）は仕様レビュー完了を意味する。UIたたき台などの**実装前ゲート未承認でも finalize してよい**が、その場合 `spec-to-pr` の plan が ABORT する。レビュー通過 ≠ 実装着手可。

やらないこと:
- 新しいブランチの作成・切り替え。
- `git push`（`-u` 含む）。
- PR の作成・更新・マージ・クローズ（`gh pr create` / `gh pr edit` / `gh pr comment` 含む）。
- `docs/` 以外の編集・ステージ・コミット。
- `docs/` 以外が dirty であることだけを理由にした ABORT。
- git 書き込み不可が分かったあとに、同じ `git add` / `commit` を繰り返すこと。

## spec-audit.md（最新・全文）
{report:spec-audit.md}
