実装内容をコミット・push し、`pr-summary.md` を正本として Pull Request を作成または更新してください。プロダクションコードの編集は行わず、git / gh コマンドのみを実行してください。

手順:
0. **git 書き込み可否を先に確認する（必須・1回だけ）:**
   - `git status` が通ること、および `git add --dry-run`（対象ファイル）または `git update-index --refresh` で index 書き込みを試す。
   - `.git/index.lock` 作成や stage が `Operation not permitted` / `Read-only file system` / permission denied で失敗する場合は **commit / push / PR を再試行しない**。報告に「環境が `.git` 書き込み不可のため create_pr 未完了」と残差分を書いて失敗扱いとする（同じ git 操作をループしない）。
1. 下記に全文添付された pr-summary を正本とする。先頭の `# ` 行を PR タイトル、それ以降を PR 本文とする。
2. `git status` / `git diff` で変更内容を確認する。
3. ブランチを決める（再実行・追記を優先）:
   - 既に `feature/*` または `fix/*` にいて、対象仕様の作業ブランチならそのまま使う。
   - `develop` / `main` にいる場合、対象仕様に対応する既存リモートブランチがあれば checkout して継続する。
   - 既存がなければ仕様書名または機能名から `feature/...` または `fix/...` の英語ブランチを新規作成する。
4. `pr-summary.md` の `## 関連仕様書` に `docs/plans/xxx.md` → `docs/specs/xxx.md` への移動指示がある場合、`git mv docs/plans/xxx.md docs/specs/xxx.md` を実行し実装差分と同一コミットに含める。移動指示がなければ何もしない。
   - 移動した場合、図解バンドル `docs/plans/_html/<slug>/` と `docs/plans/_html/<slug>.html` を削除する（`<slug>` は移動した仕様書のファイル名から `.md` を除いたもの。削除対象はこの2つだけで、`docs/plans/_html/` 配下の他の仕様書のバンドルには触らない）。`scripts/spec-html.py` の `refresh` は `docs/plans/` 直下の仕様書しか受け付けないため、残すと二度と更新されないバンドルが開ける状態で残り、古い仕様を最新と誤読する。`.gitignore` 済みのため commit には影響しない。削除した旨を報告に含める。
5. `git add` で変更をステージし、`git diff --cached` で最終確認する。無関係なローカル変更を混ぜない。
6. `pr-summary.md` のコミットメッセージ案（なければ Why 中心の日本語1行）で `git commit` する。変更がなければ新規コミットは作らず、既存 tip で PR 更新へ進む。
7. `git push -u origin HEAD` を実行する。
8. base は `develop`（ブランチが `develop` の場合のみ `main`）。
9. PR を冪等に作成または更新する（auto-pr とのレースに耐える。既存 PR への追記を含む）:
   a. 下記添付の pr-summary からタイトル行を除いた本文を一時ファイルに書き出して `--body-file` に渡す（シェル展開で壊さない）。
   b. `gh pr list --head <branch> --base <base> --state open` で既存 PR を確認する。
   c. 既存があれば `gh pr edit <number> --title "..." --body-file ...` で更新する（TAKT が正本。追記コミット後も本文を最新化する）。
   d. 既存がなければ `gh pr create --base ... --head ... --title "..." --body-file ...` で作成する。
   e. `gh pr create` が「already exists」等で失敗した場合は ABORT せず、再度 `gh pr list` して番号を取得し、`gh pr edit` で本文・タイトルを更新する。edit 成功なら完了とする。
   f. auto-pr の完了は待たない。再 list → edit で吸収する。
   g. 再 list でも PR が見つからない、または edit も失敗した場合のみ失敗とする。
10. 作成/更新した PR の URL・番号・ブランチ・コミット SHA を報告する。CI 完了は待たない。

やらないこと:
- `@codex` レビュー依頼コメントの投稿。
- PR のマージ・クローズ。
- プロダクションコード編集。
- `.takt/runs/` 配下のレポートを git にコミットすること。
- 人間への確認待ち。
- git 書き込み不可が分かったあとに、同じ `git add` / `commit` / `push` を繰り返すこと。

## pr-summary.md（全文）
{report:pr-summary.md}
