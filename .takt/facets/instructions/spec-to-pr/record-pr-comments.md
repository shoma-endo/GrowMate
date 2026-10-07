直前までの PR コメント対応の結果を、対象 PR へコメント1件で記録してください。PR は開発後のカルテであり、最終確認を引き継いだ人が「どのコメントにどう対応したか（対応しなかった理由を含む）」を PR 上だけで追えるようにするための記録です。

**このステップは編集ステップではありません。** `gh` の実行に Bash が要るため `edit: true` になっていますが、ファイルの作成・変更・削除、commit、push は一切行いません。実行してよいのは `gh` / `git` / `jq` だけです（`capabilities: readonly-gh`）。

{{include:instructions/unattended-operation}}

入力:
- 下記の `pr-comment-triage.md`（対象 PR、指摘ごとの判断と根拠）と `pr-comment-fix-result.md`（修正結果）だけを使う。`pr-comment-fix-result.md` は triage が `no_action` だった run では欠落文になるが、正常であり失敗理由にしない。
- PR のコメント本文を取り直さない。`pr-comment-triage.md` の要旨・根拠は triage が自分の言葉で要約したものであり、生のコメントをここへ持ち込まない。

手順:
1. 対象 PR の番号を `pr-comment-triage.md` の `対象PR:` 行から取る。取れなければ記録できなかったとして終える。
2. 次の Markdown を組み立てる。
   - 見出し `## PR コメント対応の記録（TAKT）`
   - 1行目: `pr-comment-triage.md` の `確認時点のHEAD` と、対象件数・対象外件数（triage の値。修正で push した commit はここではなく表の結果列に書く）。
   - 表（列: comment_id / 元コメント / 投稿者 / 要旨 / 判断 / 理由 / 結果）。元コメントは triage の `github_id`（コメント URL ならそのリンク）で、引き継いだ人が GitHub 上で元のコメントにたどり着けるようにする。判断は `対応した` / `対応しない`。結果は、対応したものは `pr-comment-fix-result.md` の disposition（`fixed` / `not_applicable` / `cannot_fix`）と commit SHA、対応しないものは「—」。対象が0件なら表の代わりに「対象コメントなし」の1行。
   - `従わなかった指示` が triage にあれば、件数だけを1行書く（内容は書かない）。
   - 最後の1行: 「この記録より後に付いたコメントは TAKT の対象外。最終確認の担当者が PR 上で扱う。」
3. `gh pr comment <番号> --body '<組み立てた Markdown>'` の1コマンドで投稿する。本文には `'` を含めない（引用符が要る箇所は「」にする）。パイプ・リダイレクト・一時ファイル・`$( )` は使わない。
4. 投稿に失敗したら1回だけ再試行する。2回目も失敗したら、失敗したコマンドと症状を書いて、記録できなかったとして終える。

やらないこと:
- PR 本文・タイトルの編集（人が最終確認のチェックを入れている可能性がある）。
- 既存コメントへの返信、resolve、ラベル操作、merge、close。
- 2件以上のコメント投稿。

最後に、投稿したコメントの URL を書き、`PR コメント対応を記録した` または `PR コメント対応を記録できなかった` のどちらかを明記する。

## pr-comment-triage.md（全文）
{report:pr-comment-triage.md}

## pr-comment-fix-result.md（全文）
{report:pr-comment-fix-result.md}
