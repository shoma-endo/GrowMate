実装内容をコミット・push し、`pr-summary.md` を正本として Pull Request を作成または更新してください。**プロダクションの挙動変更は禁止。** 許可する編集は git / gh 操作と、手順4の仕様書移動に伴う参照パス置換・ステータスメタデータ更新のみ。

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
4. `pr-summary.md` の `## 関連仕様書` に `docs/plans/<slug>.md` → `docs/specs/<slug>.md` への移動指示がある場合、次を **すべて** 実行し実装差分と同一コミットに含める。移動指示がなければ何もしない（部分実装・残置のときは触らない）。
   1. `git mv docs/plans/<slug>.md docs/specs/<slug>.md`
   2. **参照パス置換（必須）:** リポジトリ内で当該ファイルを指す古いパスを新しいパスへ置換する。対象は移動した `<slug>.md` だけ（他仕様書のパスは変えない）。
      - 置換する文字列: `docs/plans/<slug>.md` → `docs/specs/<slug>.md`、および相対リンクの `../plans/<slug>.md` → `../specs/<slug>.md`
      - 探索: `rg -l` で上記文字列を含むファイルを列挙し、該当箇所だけ置換する（コードコメント・テスト・migration コメント・README・他 docs・runbooks を含む）
      - 触らない: `.git/`、`.takt/runs/`、`node_modules/`、ロックファイル、バイナリ
      - 置換後に `rg 'docs/plans/<slug>\.md|\.\./plans/<slug>\.md'` で残件ゼロを確認する。残っていれば置換漏れとして直す
   3. **ステータスメタデータ更新（必須）:** 移動後の `docs/specs/<slug>.md` だけを編集する。
      - メタデータに離散のステータス欄がある場合（例: `- ステータス: \`approved\``、表の `| ステータス | ... |`）を **`implemented`（または「実装完了」と併記する既存体裁）** へ更新する
      - 長い叙述ステータス段落（経緯・未解決クライアント合意の列挙など）は書き換えない。離散欄が無い場合は、文書先頭のメタデータブロックに `- ステータス: \`implemented\`` を1行追加する（既存の体裁に合わせる）
      - 「クライアント合意待ち」等の残課題の記述は消さない（実装完了とクライアント合意は別）
   4. **図解バンドル削除（必須）:** `docs/plans/_html/<slug>/` と `docs/plans/_html/<slug>.html` を削除する（削除対象はこの2つだけ。他仕様のバンドルは触らない）。`scripts/spec-html.py` の `refresh` は `docs/plans/` 直下しか受け付けないため、残すと二度と更新されないバンドルが開ける。`.gitignore` 済みのため commit には通常含まれない。削除した旨を報告に含める
5. `git add` で変更をステージし、`git diff --cached` で最終確認する。無関係なローカル変更を混ぜない。
6. `pr-summary.md` のコミットメッセージ案（なければ Why 中心の日本語1行）で `git commit` する。変更がなければ新規コミットは作らず、既存 tip で PR 更新へ進む。
7. `git push -u origin HEAD` を実行する。
8. base は `develop`（ブランチが `develop` の場合のみ `main`）。
9. PR を冪等に作成または更新する（auto-pr とのレースに耐える。既存 PR への追記を含む）:
   a. 下記添付の pr-summary からタイトル行を除いた本文を一時ファイルに書き出して `--body-file` に渡す（シェル展開で壊さない）。
   b. **画面キャプチャ添付（条件付き・soft-fail）:**
      - 判定: 本文に `## 画面キャプチャ` があり内容が「対象外」だけではない、または `![...](.takt/artifacts/pr-screenshots/...)` がある → UI 対象。それ以外は非UIとして添付スキップ。
      - UI 対象時のみ `.takt/artifacts/pr-screenshots/` を列挙する。許可拡張子: `.png` `.jpg` `.jpeg` `.webp` `.gif` `.mp4` `.webm`。該当ファイルがある場合、各ファイルに `--attach '相対パス#alt'` を付ける（alt は拡張子を除いたファイル名。動画は `#alt` を付けない）。`gh pr create` と `gh pr edit` の両方で同じフラグを使う。
      - body 内の同一ローカルパス参照は gh が in-place で URL に書き換える。本文未参照の添付は末尾追記でよい。
      - ディレクトリ無し・0件・upload 失敗・フラグ非対応は **ABORT しない**。報告に理由を残し、`--attach` なしで create/edit にフォールバックして続行する（偽の検証済みにしない）。
      - スクショの新規撮影・生成はしない。図解 HTML（`docs/plans/_html/`）は添付しない。画像を git にコミットしない。
   c. `gh pr list --head <branch> --base <base> --state open` で既存 PR を確認する。
   d. 既存があれば `gh pr edit <number> --title "..." --body-file ...`（＋該当時 `--attach`）で更新する（TAKT が正本。追記コミット後も本文を最新化する）。
   e. 既存がなければ `gh pr create --base ... --head ... --title "..." --body-file ...`（＋該当時 `--attach`）で作成する。
   f. `gh pr create` が「already exists」等で失敗した場合は ABORT せず、再度 `gh pr list` して番号を取得し、`gh pr edit` で本文・タイトルを更新する（step b と同じ `--attach` 条件を edit にも付ける）。edit 成功なら完了とする。
   g. auto-pr の完了は待たない。再 list → edit（＋該当時 `--attach`）で吸収する。
   h. 再 list でも PR が見つからない、または edit も失敗した場合のみ失敗とする（`--attach` 失敗だけの理由では失敗にしない）。
10. 作成/更新した PR の URL・番号・ブランチ・コミット SHA を報告する。画面キャプチャは「添付 N 件」または「スキップ（未配置/非UI/upload失敗）」を含める。CI 完了は待たない。移動した場合は、参照置換件数（おおよそ）とステータス更新の有無も報告する。

やらないこと:
- `@codex` レビュー依頼コメントの投稿。
- PR のマージ・クローズ。
- プロダクションの挙動変更（ロジック・UI・スキーマ・設定の変更）。手順4以外の docs / コメント編集。
- `.takt/runs/` 配下のレポートを git にコミットすること。
- `.takt/artifacts/pr-screenshots/` の画像を git にコミットすること。
- 画面キャプチャの新規撮影・生成。
- 人間への確認待ち。
- git 書き込み不可が分かったあとに、同じ `git add` / `commit` / `push` を繰り返すこと。
- 移動指示が無いのに仕様書を `docs/specs/` へ移すこと。
- キャプチャ未配置や `--attach` 失敗だけで create_pr を失敗扱いすること。

## pr-summary.md（全文）
{report:pr-summary.md}
